// Semantic card icons (Fable S2, 2026-11-01): named by a point's label, never
// after a negation, all or none per card, distinct within it, at most two
// cards per icon, rendered as a recoloured transparent PNG.
import assert from 'node:assert/strict';
import {iconForPoint,planCardIcons,cardIconImage} from './lib/ppt-card-icons.mjs';
import {flattenPath} from './lib/ppt-icon-raster.mjs';
import {cardShape} from './lib/ppt-card-pages.mjs';
import {sanitizeCardTopic} from './lib/ppt-outline-cards.mjs';

assert.equal(iconForPoint({label:'数据存储'}),'Database');
assert.equal(iconForPoint({label:'安全隔离'}),'ShieldCheck');
assert.equal(iconForPoint({label:'不安全的默认值'}),null,'a negated word names nothing');
assert.equal(iconForPoint({label:'模型推理'}),'Brain','the head word of a compound wins a tie');
assert.equal(iconForPoint({label:'Resource'}),null,'no confident match, no icon');
assert.equal(iconForPoint({text:'客户端通过插件连接服务器'}),null,'text counts only when one icon is named');
assert.equal(iconForPoint({text:'内容全部加密后保存'}),'Lock');
assert.equal(iconForPoint({text:'所有凭证都加密保存'}),null,'two icons named in the text: none');

// The writer's own pick from the catalogue comes first; a label that negates
// the icon's words rejects it, an unknown name is ignored.
assert.equal(iconForPoint({label:'连接器',icon:'Plug'}),'Plug','the writer names what no keyword does');
assert.equal(iconForPoint({label:'数据存储',icon:'Lock'}),'Lock','the writer\'s pick wins over the keyword');
assert.equal(iconForPoint({label:'不安全的默认值',icon:'ShieldCheck'}),null,'a label negating the icon\'s words rejects the pick');
assert.equal(iconForPoint({label:'数据存储',icon:'Nope'}),'Database','an unknown pick falls back to the keyword');

// The sanitizer keeps a catalogue name on a labelled point and nothing else.
{const p={source:{extension:'xlsx',semantic:{inventory:{items:[{id:'u',type:'MechanismBlock',text:'x',sectionPath:['A']}]}}},planningContract:{},inputUnderstanding:{primaryLanguage:'zh'}};
 const task={card:{title:'能力'},ids:['u'],objectIds:[],requiredIds:[],quota:1};
 const {reply:{pages:[page]}}=sanitizeCardTopic(p,task,{pages:[{title:'三类能力',visualIntent:'relation',points:[{text:'由应用决定读取的数据',label:'数据读取',icon:'Database',sourceUnitIds:['u']},{text:'由模型决定何时调用的工具',label:'工具调用',icon:'NotAnIcon',sourceUnitIds:['u']}],objects:[]}]});
 assert.deepEqual(page.points.map(point=>point.icon),['Database',undefined]);}

const card=(id,labels)=>({id,visualIntent:{type:'relation'},keyPoints:labels.map(label=>({label,text:label+'的说明'}))});
const pages=[{id:'cover'},card('a',['数据存储','安全隔离','模型推理']),card('b',['数据存储','Resource','模型推理']),card('c',['数据存储','安全隔离','团队协作']),card('d',['数据存储','部署上线','团队协作']),card('e',['数据存储','数据存储','团队协作'])];
const planned=planCardIcons(pages,cardShape).map(page=>page.cardIcons||null);
assert.deepEqual(planned[1],['Database','ShieldCheck','Brain']);
assert.equal(planned[2],null,'all or none: one unmatched label leaves the card without icons');
assert.deepEqual(planned[3],['Database','ShieldCheck','UsersThree']);
assert.equal(planned[4],null,'an icon serves at most two cards');
assert.equal(planned[5],null,'never the same icon twice on a card');

const png=cardIconImage('ShieldCheck','#6b7d5c'),bytes=Buffer.from(png.split(',')[1],'base64');
assert.ok(png.startsWith('data:image/png;base64,')&&bytes.subarray(1,4).toString()==='PNG'&&bytes.readUInt32BE(16)===192,'a 192 px PNG');
assert.ok(flattenPath('M10,10H50V50H10Z')[0].length>=4,'paths flatten to polygons');
assert.equal(cardIconImage('Nope','#000000'),null);
console.log('PASS card icons: label-named, negation-safe, all or none, distinct, two cards per icon, PNG');

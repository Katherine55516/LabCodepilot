// Tables follow the hand deck (the user, 2026-11-02 evening): none is drawn or
// written row by row; at most four comparison points per table on the slide,
// the whole table in the speaker notes. Shapes still name a table's kind.
import assert from 'node:assert/strict';
import {tableShape,tableRoles,twoCardTable,documentTableRule} from './lib/ppt-table-roles.mjs';
import {writtenTable} from './lib/ppt-spreadsheet-cards.mjs';
import {sanitizeCardTopic,primaryHalf} from './lib/ppt-outline-cards.mjs';
import {pointLines,keyNumber,cardShape} from './lib/ppt-card-pages.mjs';

const table=(id,rows)=>({id,type:'TableBlock',sectionPath:['A'],text:rows.map(row=>'| '+row.join(' | ')+' |').join('\n'),rows});
const kv=table('kv',[['**入口**','**用途**'],['/ppt','挂载独立 PPT 工作区。'],['/api/ppt/*','登录验证与代理。']]);
const kvLong=table('kvLong',[['术语','含义'],...Array.from({length:8},(_,k)=>[`术语${k}`,`含义说明${k}`])]);
const numbers=table('num',[['指标','数值'],['准确率','91.2%'],['召回率','88.0%']]);
const grid=table('grid',[['字段','解释','后果'],['revision','草稿修订','编辑后递增'],['publishedRevision','发布修订','发布后更新']]);
const wide=k=>table('wide'+k,[['方法','A','B','C'],...Array.from({length:4+k},(_,r)=>[`m${r}`,`${r}.1`,`${r}.2`,`${r}.3`])]);
const long=table('long',[['路径','含义'],...Array.from({length:20},(_,k)=>[`/p${k}`,'x'.repeat(50)])]);

assert.equal(tableShape(kv),'keyvalue','two short columns read as labelled points');
assert.equal(tableShape(numbers),'table','a column of numbers is data and stays a table');
assert.equal(tableShape(grid),'grid','a small three-column table becomes a grid');
assert.equal(tableShape(long),'appendix','a long table goes to the appendix');
assert.ok(twoCardTable(kvLong)&&!twoCardTable(kv),'7-10 rows take two cards');

const items=[kv,kvLong,numbers,grid,long,...[0,1,2,3,4].map(wide)];
const project=cards=>({inputUnderstanding:{primaryLanguage:'zh'},source:{extension:'docx',semantic:{inventory:{items}}},planningContract:{logicalCards:[{},...Array.from({length:cards},()=>({quota:1}))]}});
// The hand deck (the user, 2026-11-02 evening): no table is drawn or written
// row by row, whatever its shape or the length; every table is written.
const roles=tableRoles(project(9));
assert.ok(Object.values(roles).every(role=>role.role==='written'&&role.reason==='comparison_cards'),JSON.stringify(roles));
const doc=project(9);doc.planningContract.length={preset:'standard'};
assert.ok(writtenTable(doc,kv)&&writtenTable(doc,long)&&writtenTable(doc,wide(4)));
const full={...doc,planningContract:{...doc.planningContract,length:{preset:'full'}}};
assert.ok(writtenTable(full,kv)&&writtenTable(full,long),'the full length too');
assert.match(documentTableRule(doc,[kv,long]),/Tables kv, long are never drawn and never written row by row/u);
assert.match(documentTableRule(doc,[kv]),/at most 4 comparison points/u);

// A pasted table is no point: the card keeps its other points, the table is in its notes.
const task={card:{title:'入口'},ids:['kv'],objectIds:[],requiredIds:[],quota:1};
{const {reply:{pages}}=sanitizeCardTopic(doc,task,{pages:[{title:'入口',points:[{text:kv.text.replace(/\n/gu,' '),sourceUnitIds:['kv']},{text:'入口由代理统一校验登录。',sourceUnitIds:['kv']}],objects:[]}]});
 assert.deepEqual(pages[0].points.map(point=>point.text),['入口由代理统一校验登录。']);
 assert.deepEqual(pages[0].notePoints.map(note=>note.text),['表 A：入口 | 用途','/ppt：挂载独立 PPT 工作区。','/api/ppt/*：登录验证与代理。'],'the whole table, every row, in the notes');}
// Comparison points the writer wrote stay; a fifth for one table goes to the notes.
{const point=(label,text)=>({label,text,sourceUnitIds:['kvLong']}),t2={...task,card:{title:'术语'},ids:['kvLong']};
 const {reply:{pages:[page]},advisories}=sanitizeCardTopic(doc,t2,{pages:[{title:'术语',points:[0,1,2,3,4].map(k=>point('术语'+k,'含义说明'+k)),objects:[]}]});
 assert.equal(page.points.length,4);assert.ok(advisories.some(note=>note.code==='card_table_points_to_notes'));
 assert.equal(page.notePoints.filter(note=>note.sourceUnitIds?.[0]==='kvLong').length,1+1+8,'the fifth point, the header and all 8 rows');}
// Pipes split only a genuine language pair (Fable F1); a KPI number leads its point (F2).
const piped='| 协议限制 | 值 | | --- | --- | | 提示词字节上限 | 2,000,000 bytes |';
assert.equal(pointLines(piped,'zh'),piped,'table pipes are not a language pair: nothing is dropped or broken');
assert.equal(primaryHalf(piped,'zh'),piped);
assert.equal(pointLines('Data flows | 数据流动','zh'),'数据流动\nData flows','a real pair still splits');
assert.equal(keyNumber(piped),'','a number deep in the text is no headline');
assert.equal(keyNumber('提示词字节上限：2,000,000 bytes'),'2,000,000');
assert.equal(cardShape({keyPoints:[{text:'机制的当前行为是在超过限制后返回 400 状态'},{text:'2,000,000 bytes 为上限'}]}),'points','every point must lead with its number to be a KPI');
console.log('PASS table roles: every table written as comparison points, the whole table in the notes, pasted tables dropped');

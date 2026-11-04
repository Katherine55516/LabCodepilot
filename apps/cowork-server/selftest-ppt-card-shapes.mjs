// Card shapes follow the writer's visualIntent and the deck keeps them varied
// (Fable M1-M3, 2026-11-01, MCP解读 on Mood-Board: ten of eleven content pages
// were separate text boxes although the writer named process, comparison and
// relation). Labels a point leads with ("名称：说明") name its part.
import assert from 'node:assert/strict';
import {cardShape,eligibleCardShapes,balanceCardShapes} from './lib/ppt-card-pages.mjs';
import {sanitizeCardTopic} from './lib/ppt-outline-cards.mjs';

let n=0;
const page=(count,intent,extra={})=>({id:'p'+(n++),visualIntent:{type:intent},keyPoints:Array.from({length:count},(_,k)=>({text:`第${k}点的说明文字`,...extra}))});

assert.equal(cardShape(page(5,'process')),'steps','a process of 3-7 points is a flow of steps, numbered or not');
assert.equal(cardShape(page(8,'process')),'points','more than seven steps stay points');
assert.equal(cardShape(page(4,'comparison')),'compare','a comparison of 2-4 points is columns');
assert.equal(cardShape(page(4,'relation',{label:'组件'})),'grid','labelled related parts are a grid');
assert.equal(cardShape(page(4,'relation')),'points','without labels a relation stays points');
assert.equal(cardShape(page(2,'table',{label:'项'})),'points','a table grid needs three parts');
assert.deepEqual(eligibleCardShapes(page(4,'process',{label:'阶段'})),['steps','grid','points'],'its own shape first, then the alternatives');

// Variety: at most 40% of 5+ content pages per shape, never three in a row.
const deck=[{id:'cover'},...Array.from({length:7},()=>page(4,'process',{label:'阶段'})),{id:'end',role:'closing',keyPoints:[]}];
const shapes=balanceCardShapes(deck).slice(1,-1).map(cardShape);
assert.ok(shapes.filter(shape=>shape==='steps').length<=Math.ceil(.4*7),'steps on at most 40% of the pages: '+shapes);
assert.ok(!shapes.some((shape,k)=>k>=2&&shape===shapes[k-1]&&shape===shapes[k-2]),'no shape three pages in a row: '+shapes);
assert.ok(shapes.includes('grid'),'the next eligible shape takes the page');
assert.deepEqual(balanceCardShapes(deck.slice(0,4)),deck.slice(0,4),'fewer than five content pages keep their own shapes');
// A numbered procedure keeps its steps whatever the budget (live Portfolio, 2026-11-02).
{const numbered=[{id:'cover'},...Array.from({length:7},()=>({...page(4,'process',{label:'阶段'}),numberedPoints:true})),{id:'end',role:'closing',keyPoints:[]}];
 assert.ok(balanceCardShapes(numbered).slice(1,-1).every(item=>cardShape(item)==='steps'));}

// "名称：说明" points of a comparison card become labelled; generic labels are dropped.
const p={source:{extension:'xlsx',semantic:{inventory:{items:[{id:'u',type:'MechanismBlock',text:'x',sectionPath:['A']}]}}},planningContract:{},inputUnderstanding:{primaryLanguage:'zh'}};
const task={card:{title:'能力'},ids:['u'],objectIds:[],requiredIds:[],quota:1};
const {reply:{pages:[cmp]}}=sanitizeCardTopic(p,task,{pages:[{title:'三类能力',visualIntent:'comparison',points:[{text:'Tool：由模型决定何时调用',sourceUnitIds:['u']},{text:'Resource：由应用决定读取',sourceUnitIds:['u']},{text:'Prompt：由用户选择模板',sourceUnitIds:['u']}],objects:[]}]});
assert.deepEqual(cmp.points.map(point=>point.label),['Tool','Resource','Prompt']);
const {reply:{pages:[generic]}}=sanitizeCardTopic(p,task,{pages:[{title:'能力',visualIntent:'text',points:[{text:'由模型决定何时调用工具',label:'其他',sourceUnitIds:['u']},{text:'由应用决定读取资源',label:'资源读取',sourceUnitIds:['u']}],objects:[]}]});
assert.deepEqual(generic.points.map(point=>point.label),[undefined,'资源读取'],'a generic label is no label');
console.log('PASS card shapes: intent-led steps, compare and grid, a varied deck, labelled points');

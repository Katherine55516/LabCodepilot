// A Latin word is never broken inside by a code-drawn layout (Fable should-fix,
// 2026-11-02; MCP解读 p8: a 4-column flow drew "notifications/initiali|zed").
// The measurer counts units wider than their line (brokenWords); the step flow
// and the card grid prefer a column count, then a smaller step size, that keeps
// every word whole.
import assert from 'node:assert/strict';
import {measureText,textContract,CARD_PADDING} from './lib/ppt/render-contract.mjs';
import {processCardPlan} from './lib/ppt-process-cards.mjs';
import {diagramCardPlan} from './lib/ppt-diagram-cards.mjs';
import {themeComponents,labelledPoint} from './lib/ppt-card-pages.mjs';
import {tableRowPoints} from './lib/ppt-table-roles.mjs';

const IN=914400;
const fit=(width,text,pt=14)=>{const element={kind:'text',bounds:{width:width*IN,height:1e12},content:{text},style:{fontSizePt:pt,lineHeight:1.18}};return measureText(element,textContract(element,CARD_PADDING));};
assert.equal(fit(1.9,'发送 notifications/initialized').brokenWords,1,'a unit wider than its line is a broken word');
assert.equal(fit(3.2,'发送 notifications/initialized').brokenWords,0);
assert.equal(fit(1.2,'这是一段很长的中文说明文字没有英文单词').brokenWords,0,'Chinese wraps anywhere: no broken word');

// Four steps: four columns break the word, three keep it whole: the flow leaves one row.
const steps=['建立连接后发送 notifications/initialized 通知','发现能力并获取清单','缓存与更新策略','形成最终回答'];
const flow=processCardPlan({processSource:true,items:steps.map(text=>({text}))},{width:10*IN,height:4.5*IN},14);
assert.ok(flow&&!flow.overflow,'fixture fits');
assert.ok(flow.columns<4&&flow.brokenWords===0,`columns ${flow.columns}, broken ${flow.brokenWords}`);
// Without the long word the one-row flow stays.
const plain=processCardPlan({processSource:true,items:['建立连接','发现能力','缓存更新','形成回答'].map(text=>({text}))},{width:10*IN,height:4.5*IN},14);
assert.equal(plain.columns,4,'four short steps stay one arrowed row');

// A card grid: fewer columns, or a smaller step size, before a broken word.
const grid=diagramCardPlan({diagram:{version:1,kind:'card-grid'},items:[{heading:'连接',body:'成功后发送 notifications/initialized 通知'},{heading:'发现',body:'获取工具清单'},{heading:'执行',body:'区分错误类型'}]},{width:7.2*IN,height:4*IN},16);
assert.ok(grid&&!grid.overflow&&grid.brokenWords===0,`grid columns ${grid?.columns} at ${grid?.fontSizePt} pt, broken ${grid?.brokenWords}`);
// Steps and KPI cards keep their point's label (MCP xlsx on Mood-Board,
// 2026-11-02: table-row steps read "理解要点：…" without their names); a
// source term keeps its case; joined cells carry no doubled punctuation.
{const project={inputUnderstanding:{primaryLanguage:'zh'},generationPolicy:{language:{mode:'output',locale:'zh-CN'}}};
 const page={id:'p',visualIntent:{type:'process'},keyPoints:[{label:'建立连接',text:'协商版本与能力',rowLabel:true},{label:'发现能力',text:'获取工具清单',rowLabel:true},{label:'执行与返回',text:'区分错误类型',rowLabel:true}]};
 const [steps]=themeComponents(project,page);
 assert.equal(steps.type,'timeline');assert.deepEqual(steps.content.items.map(item=>item.text),['建立连接：协商版本与能力','发现能力：获取工具清单','执行与返回：区分错误类型']);
 assert.equal(labelledPoint({label:'epoch',text:'页级变更代次',rowLabel:true},'zh').label,'epoch','a source term keeps its case');
 assert.equal(labelledPoint({label:'data storage',text:'x'},'en').label,'Data Storage','a written label is still title-cased');
 assert.equal(tableRowPoints({id:'t',rows:[['项','理解要点','依据类型'],['建立连接','以版本为例。','版本示例。']]})[0].text,'理解要点：以版本为例；依据类型：版本示例','no "。；"');}
console.log('PASS word breaks: units wider than a line are counted; flows and grids keep Latin words whole; steps keep their labels');

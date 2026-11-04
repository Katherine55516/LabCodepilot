/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic backend contract fixtures. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const backend=(name:string)=>import(process.cwd()+'/apps/cowork-server/lib/'+name+'.mjs');

test('source relation proofs and actual scene binding reject missing nodes/edges',()=>{
 const result=execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-editorial-relational.mjs'],{encoding:'utf8',timeout:30000});
 assert.match(result,/PASS complete-input delivery/);
});
test('code identifiers do not take over a Chinese page title; code-only pages use the deck',async()=>{
 const {dominantInputLanguage}=await backend('ppt-topic-language'),{pageTopicLanguage}=await backend('ppt-presentation-contract');
 const prose='这段中文说明输入、约束和校验。'.repeat(8)+'\n'+('sourceRegistry API HTTP JSON forecastModel prediction_value `sklearn.fit(X)` '.repeat(40));
 assert.equal(dominantInputLanguage({source:{text:prose}}),'zh');
 const p={generationPolicy:{version:2,language:{mode:'source',body:'both'}},source:{text:'这份演示文稿解释来源与验证。'.repeat(10),semantic:{inventory:{items:[{id:'code',type:'CodeBlock',text:'def forecast_model(x): return x'}]}}}};
 assert.equal(pageTopicLanguage(p,{sourceUnitIds:['code']}),'zh');
 const mixed:any=structuredClone(p);mixed.source.semantic.inventory.items.push({id:'prose',text:'本页解释卡片如何关联，布局由语义关系决定。'},{id:'graph',type:'TableBlock',diagramSource:{graph:{}},text:'Component Responsibility Next component '.repeat(50)});
 assert.equal(pageTopicLanguage(mixed,{sourceUnitIds:['prose','graph']}),'zh','English projection headers and graph labels do not override actual prose');
 mixed.source.semantic.inventory.items[2].diagramSource.text='卡片\n ├─ 标题\n └─ 正文';assert.equal(pageTopicLanguage(mixed,{sourceUnitIds:['graph']}),'zh','diagram-only pages use original labels, never generated English relation-table headers');
});
test('validated reader intent is consumed by every owned page and repeated answers stay diagnostic',async()=>{
 const {withEditorialContext,editorialDiagnostics}=await backend('ppt-editorial-context');
 const p:any={inputUnderstanding:{groups:[{question:'Which facts support this?',coreMessage:'Independent modules jointly explain the result.',sourceUnitIds:['a','b']}]},outline:[{id:'s1'},{id:'s2'}],deck:{slides:[{id:'s1'},{id:'s2'}]}};
 p.planning={slidePlan:withEditorialContext([{slideId:'s1',role:'mechanism',message:'A sufficiently long shared planned answer.',sourceUnitIds:['a']},{slideId:'s2',role:'mechanism',message:'A sufficiently long shared planned answer.',sourceUnitIds:['b']}],p)};
 assert.equal(p.planning.slidePlan[1].editorialContext.groups[0].readerQuestion,'Which facts support this?');
 const findings=editorialDiagnostics(p);assert.equal(findings[0].severity,'warning');assert.deepEqual(findings[0].slideIds,['s1','s2']);
 p.outline[1].repeatSourceUnitIds=['a'];assert.deepEqual(editorialDiagnostics(p),[]);
});
test('all ordered steps retain connectors across row changes',async()=>{
 const {flowConnectors}=await backend('ppt-diagram-cards');
 const boxes=[{x:0,y:0,w:.4,h:.4},{x:.6,y:0,w:.4,h:.4},{x:0,y:.6,w:.4,h:.4}];
 const edges=flowConnectors(boxes);assert.equal(edges.length,2);assert.equal(edges[1].points.length,4);assert.deepEqual(edges.map((e:any)=>[e.from,e.to]),[[0,1],[1,2]]);
});

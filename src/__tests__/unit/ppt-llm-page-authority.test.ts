/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated partial source fixtures. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
const lib=process.cwd()+'/apps/cowork-server/lib/';
function fixture():any{return {id:'fixture',pages:4,status:'input_ready',pageDecision:{mode:'auto',source:'estimate'},generationPolicy:{version:2,content:'overview',selection:'editorial',detail:'concise',archive:'none',language:{mode:'source'}},inputUnderstanding:{recommended:4,min:3,max:5,reason:'Complete reading',groups:[]},source:{text:'Evidence and conditions',semantic:{inventory:{items:['a','b','c'].map(id=>({id,type:'MechanismBlock',text:'Original '+id,source_ref:[],chunkRefs:[],sectionPath:['Evidence']})),relationships:[]}}}};}
const slide=(title:string,ids:string[]=[])=>({title,focus:'Explain '+title,sourceUnitIds:ids});
const countIssue=(requested:number,actual:number)=>[{code:'exact_page_budget_conflict',details:{pageCountConflict:{requested,actual}}}];
test('wrong initial page count supports scoped merge and split; cover, locks and all owners remain',async()=>{
 const {outlineDeltaPrompt,applyOutlineDelta,outlineResponseSchema}=await import(lib+'ppt-outline-protocol.mjs');
 const p=fixture(),cover=slide('Evidence'),locked={...slide('Limitations',['c']),titleLocked:true};
 const raw={version:2,slides:[cover,slide('Definition',['a']),slide('Validation',['b']),slide('Optional context'),locked]};
 const prompt=outlineDeltaPrompt(p,raw,countIssue(4,5));assert.match(prompt,/<permitted_indexes>\[1,2,3\]/);assert.equal(outlineResponseSchema(prompt).properties.replacements.items.properties.slides.minItems,0);
 const merged=applyOutlineDelta(p,raw,{version:2,replacements:[{index:1,slides:[slide('Validation chain',['a','b'])]},{index:2,slides:[]}]},prompt);
 assert.equal(merged.slides.length,4);assert.deepEqual(merged.slides[0],cover);assert.deepEqual(merged.slides.at(-1),locked);assert.equal(raw.slides.length,5);assert.equal(p.pages,4);
 const short={version:2,slides:[cover,slide('Chain',['a','b']),locked]};
 const split=applyOutlineDelta(p,short,{version:2,replacements:[{index:1,slides:[slide('Definition',['a']),slide('Validation',['b'])]}]},outlineDeltaPrompt(p,short,countIssue(4,3)));
 assert.equal(split.slides.length,4);assert.deepEqual(split.slides.at(-1),locked);
 assert.throws(()=>applyOutlineDelta(p,raw,{version:2,replacements:[{index:2,slides:[]}]},prompt),(e:any)=>e.code==='coverage_invalid');
 assert.throws(()=>applyOutlineDelta(p,raw,{version:2,replacements:[{index:1,slides:[raw.slides[1]]}]},prompt),(e:any)=>e.details.reason==='page_count_repair_must_reduce_difference');
 assert.throws(()=>applyOutlineDelta(p,raw,{version:2,replacements:[{index:4,slides:[]}]},prompt),/schema_invalid/);
});
test('normal capacity repairs cannot add pages even with a historical auto decision',async()=>{
 const {outlineDeltaPrompt,applyOutlineDelta}=await import(lib+'ppt-outline-protocol.mjs');const p=fixture();p.pages=3;
 const raw={version:2,slides:[slide('Evidence'),slide('Condition',['a','b']),slide('Limits',['c'])]};
 const prompt=outlineDeltaPrompt(p,raw,[{code:'planned_density_overflow',pageIndex:1}]);
 assert.doesNotMatch(prompt,/<page_count_repair>/);assert.throws(()=>applyOutlineDelta(p,raw,{version:2,replacements:[{index:1,slides:[raw.slides[1],slide('Extra')]}]},prompt),(e:any)=>e.code==='capacity_invalid');
});
test('old calibrated GET projections show reading 13, while existing 34-page deck stays intact',async()=>{
 const {liveProjectView}=await import(lib+'ppt/project-view.mjs');const p=fixture();p.pages=34;p.outline=[];p.nodes={};p.inputUnderstanding={...p.inputUnderstanding,recommended:13,min:11,max:15};p.pageBudget={recommended:34,range:{min:33,max:46},measured:{structuralPages:46},adjusted:true};p.planning={pageRecommendation:{recommended:34,range:[33,46],reason:'Code calibration',reasonBase:'Code calibration 34 (33–46)',compressionRisk:true}};
 const before=structuredClone(p),view=liveProjectView(p);assert.equal(view.pageBudget.recommended,13);assert.deepEqual(view.planning.pageRecommendation.range,[11,15]);assert.equal(view.pageCounts.estimated,13);assert.equal(view.pages,34);assert.equal(view.planning.pageRecommendation.reasonBase,p.inputUnderstanding.reason);assert.equal(view.planning.pageRecommendation.compressionRisk,false);assert.equal(view.pageBudget.measured,undefined);assert.deepEqual(p,before);
});
test('reading cache preserves an explicit user page target; auto uses model only and confirmed decks are never resized',async()=>{
 const {applyReadingPageBudget}=await import(lib+'ppt-page-floor.mjs');const p=fixture();p.pages=9;p.pageDecision.mode='explicit';applyReadingPageBudget(p,'key');assert.equal(p.pages,9);assert.equal(p.pageBudget.requested,9);assert.equal(p.pageBudget.recommended,4);
 p.pageDecision={mode:'auto',source:'estimate'};applyReadingPageBudget(p,'key');assert.equal(p.pages,4);
 p.pages=34;p.confirmedOutline={pages:34};applyReadingPageBudget(p,'key');assert.equal(p.pages,34);assert.equal(p.pageBudget.confirmed,true);
});
test('reading supplies complete input and geometry, then planner receives complete source rows and exact schema',async()=>{
 const {prepareInputUnderstanding}=await import(lib+'ppt-input-understanding.mjs');const {skeletonPrompt,outlineResponseSchema}=await import(lib+'ppt-outline-protocol.mjs');const p=fixture();delete p.inputUnderstanding;
 const tail='UNTRUNCATED_TAIL_FACT_9427';p.source.semantic.inventory.items[0].text='Long evidence '.repeat(40)+tail;p.source.text=p.source.semantic.inventory.items.map((i:any)=>i.text).join('\n');
 let prompt='';await prepareInputUnderstanding(p,async(value:string)=>{prompt=value;return {version:1,subject:'Evidence',primaryLanguage:'en',groups:[{question:'What supports the claim?',coreMessage:'Validate before use.',relations:['condition'],sourceUnitIds:['a','b','c']}],recommended:4,min:3,max:5,reason:'Read all evidence.'};});assert.match(prompt,/First form semantic reader groups/);assert.match(prompt,/bodyGeometryEMU/);assert.ok(prompt.includes(tail));assert.equal(p.pages,4);
 const planned=skeletonPrompt(p,'Exactly 4 pages.');const data=JSON.parse(planned.match(/<planning_source_content>([\s\S]*?)<\/planning_source_content>/u)![1]);assert.ok(data.units[0].text.endsWith(tail));assert.equal(data.targetPages,4);assert.equal(outlineResponseSchema(planned).properties.slides.minItems,4);assert.equal(outlineResponseSchema(planned).properties.slides.maxItems,4);assert.doesNotMatch(planned,/允许.*进入.*speaker notes/);
});
test('fixed model count consumes one whole-deck reading blueprint before page writers',async()=>{
 const {automaticPages}=await import(lib+'ppt-density-profile.mjs');const {needsSemanticGroups}=await import(lib+'ppt-semantic-groups.mjs');const {skeletonBatches}=await import(lib+'ppt-outline-protocol.mjs');const p=fixture();p.source.semantic.inventory.items=Array.from({length:30},(_,i)=>({id:'unit'+i,type:'MechanismBlock',text:'Meaningful source-supported mechanism '+i,sectionPath:['Evidence '+Math.floor(i/10)],source_ref:[],chunkRefs:[]}));
 assert.equal(automaticPages(p),false);assert.equal(needsSemanticGroups(p),true,'an incomplete legacy reading still needs decomposition');assert.deepEqual(skeletonBatches(p),[],'validated v2 reading uses a complete outline, not independently budgeted local batches');p.inputUnderstanding.groups=[{question:'Which evidence supports the claim?',coreMessage:'Evidence supports the claim.',sourceUnitIds:p.source.semantic.inventory.items.map((i:any)=>i.id)}];assert.equal(needsSemanticGroups(p),false,'the full reading supplies semantic intent in explicit mode too');p.pageDecision={...p.pageDecision,mode:'auto'};assert.deepEqual(skeletonBatches(p),[]);assert.equal(needsSemanticGroups(p),false);
});

test('a model page-count mismatch is a model contract failure, never a template capacity verdict',async()=>{
 const {_internals}=await import(lib+'ppt-api.mjs');const p=fixture();
 assert.throws(()=>_internals.assessOutlineCandidate(p,{version:2,slides:[slide('Cover'),slide('Body'),slide('Limits')]}),(e:any)=>e.code==='schema_invalid'&&e.origin==='model_contract'&&e.details.pageCountConflict.requested===4&&e.details.pageCountConflict.actual===3);
});

/* eslint-disable @typescript-eslint/no-explicit-any -- Native ESM fixtures intentionally mutate invalid schema shapes. */
import test,{before} from 'node:test';
import assert from 'node:assert/strict';
// Server modules are native ESM; import through the runtime path.
let engine:any,reader:any;
before(async()=>{engine=await import(process.cwd()+'/apps/cowork-server/lib/ppt-outline-first.mjs');reader=await import(process.cwd()+'/apps/cowork-server/lib/ppt-input-understanding.mjs');});
const policy={version:2,detail:'standard',content:'overview',selection:'editorial',knowledge:'source_only',language:{mode:'source',body:'both'},sourceTypography:'bounded'};
function fixture(){return {id:'test',model:'fixture',configId:'fixture',pages:12,prompt:'All source',templateSpec:{},generationPolicy:structuredClone(policy),source:{text:'Only under C. Practical limits D.',sha256:'source',semantic:{inventory:{items:[{id:'a',type:'MechanismBlock',text:'Only under C.'},{id:'b',type:'WarningBlock',text:'Practical limits D.'}],relationships:[]}}},inputUnderstanding:{recommended:12,min:10,max:14,readManifest:{status:'complete_delivery'}},planningContract:{version:3,phase:'reading',contentMode:null,logicalCards:[]},outline:[]};}
function semantic(){return{cards:[{title:'Cover',titleSecondary:'',intent:'Orient the reader',points:['Scope'],sourceUnitIds:[],optionalSourceUnitIds:[],dependsOn:[]},{title:'Mechanism',titleSecondary:'',intent:'Why it works',points:['Necessary condition'],sourceUnitIds:['a'],optionalSourceUnitIds:[],dependsOn:[]},{title:'Practice',titleSecondary:'',intent:'Where it fails',points:['Practical limits'],sourceUnitIds:['b'],optionalSourceUnitIds:[],dependsOn:[1]}]};}
function planned(){const p:any=fixture();p.planningContract=engine.acceptSemantic(p,semantic());p.planningContract.contentMode='standard';p.planningContract.pagePreference={mode:'adaptive',target:12,max:14};return p;}
test('light semantic outline partitions the full source without a physical acceptance',()=>{
 const p:any=fixture();
 const contract=engine.acceptSemantic(p,semantic());assert.equal(contract.phase,'semantic_ready');assert.equal(contract.contentMode,null);
 p.planningContract=contract;assert.throws(()=>engine.assertPlanningReady(p),{code:'capacity_plan_required'});
 const visible=engine.publicLogicalOutline(p);assert.equal(visible.length,3);assert.equal(visible[1].sourceUnitIds,undefined);
 for(const mutate of [(x:any)=>x.cards[1].sourceUnitIds=[],(x:any)=>x.cards[2].sourceUnitIds=['a','b'],(x:any)=>x.cards[0].points=['No source content units owned on this page'],(x:any)=>x.cards[1].points=['x'.repeat(161)]]){const reply=semantic();mutate(reply);assert.throws(()=>engine.acceptSemantic(p,reply));}
 // A dependency on a later card is advisory context: dropped and listed, not fatal (3143, 0e1d532f).
 const forward=semantic();forward.cards[1].dependsOn=[2,1,-1];const relaxed=engine.acceptSemantic(p,forward);
 assert.deepEqual(relaxed.logicalCards[1].dependsOn,[]);assert.deepEqual(relaxed.semanticAdvisories,[{code:'semantic_dependency_dropped',cardIndex:1,dropped:[2,1,-1]}]);
});
test('mode and template changes retain reading but invalidate capacity; source changes invalidate reading',()=>{
 const p=planned(),initial=reader.understandingIdentity(p),sem=engine.semanticIdentity(p),cap=engine.capacityIdentity(p);
 const next=structuredClone(p);next.generationPolicy.detail='detailed';next.planningContract.contentMode='detailed';next.templateSpec={fonts:{body:'Roboto'}};
 assert.equal(reader.understandingIdentity(next),initial);assert.equal(engine.semanticIdentity(next),sem);assert.notEqual(engine.capacityIdentity(next),cap);
 next.source.text+=' Changed source.';assert.notEqual(reader.understandingIdentity(next),initial);assert.notEqual(engine.semanticIdentity(next),sem);
 assert.throws(()=>engine.newPlanningContract({...p,confirmedOutline:{hash:'old'}}));
});
test('bilingual pairs stay on one topic; edits keep the cover first and the dependency order',()=>{
 const p=planned();
 const pair:any=fixture();pair.source.semantic.inventory.items.forEach((i:any)=>i.languagePairId='same');assert.throws(()=>engine.acceptSemantic(pair,semantic()),/bilingual/);
 const edits=engine.publicLogicalOutline(p);assert.throws(()=>engine.editSemantic(p,[edits[1],edits[0],edits[2]]),/cover/);const reordered=engine.editSemantic(p,[edits[0],edits[2],edits[1]]);assert.ok(reordered.logicalCards.every((c:any,i:number)=>c.dependsOn.every((d:number)=>d<i)),'a reorder drops a dependency it turns forward');
});
test('semantic ready cannot confirm/export and stale physical revisions cannot generate',()=>{
 const p=planned();p.planningContract.phase='page_plan_ready';p.outlineAcceptance={confirmable:true};p.outline=p.planningContract.logicalCards.map((c:any)=>({id:'page_'+c.id,logicalCardId:c.id,title:c.title,sourceUnitIds:c.sourceUnitIds}));p.planningContract.capacityRevision=engine.capacityIdentity(p);p.planningContract.actualPageIds=p.outline.map((s:any)=>s.id);
 engine.assertPlanningReady(p);p.planningContract.contentMode='detailed';assert.throws(()=>engine.assertPlanningReady(p),{code:'capacity_plan_required'});
 p.planningContract.capacityRevision=engine.capacityIdentity(p);p.outline.reverse();assert.throws(()=>engine.assertPlanningReady(p),{code:'capacity_plan_stale'});
 engine.assertPlanningReady({outline:[]});
});

test('new planning API caches reading and rejects stale commands and transport-as-capacity misclassification',async()=>{
 const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-outline-first-api.mjs'],{cwd:process.cwd(),stdio:'pipe'});
});
test('continuation preserves exact table rows, unaffected identities and transaction epochs',async()=>{
 const m=await import(process.cwd()+'/apps/cowork-server/lib/ppt-outline-continuation.mjs');
 const p=planned();p.source.semantic.inventory.items[0]={id:'a',type:'TableBlock',rows:[['Header'],['A'],['B'],['C']],text:'Table'};
 const base={version:2,slides:[{id:'cover',title:'Cover',sourceUnitIds:[]},{id:'first',title:'Mechanism',focus:'Compare rows',sourceUnitIds:['a']},{id:'last',title:'Practice',focus:'Limits',sourceUnitIds:['b']}],selection:[{sourceUnitId:'a',destination:'slides',primaryPageIndex:1},{sourceUnitId:'b',destination:'slides',primaryPageIndex:2}]};
 const task=m.continuationTask(p,base,1);assert.ok(task);
 const reply={reason:'Continue the comparison with the remaining rows.',pages:[{title:'Rows A–B',focus:'Compare A and B',sourceUnitIds:['a'],sourceArtifactRanges:[{sourceUnitId:'a',rowStart:1,rowEnd:3}]},{title:'Row C',focus:'Explain C',sourceUnitIds:['a'],sourceArtifactRanges:[{sourceUnitId:'a',rowStart:3,rowEnd:4}]}]};
 const proposal=m.applyContinuation(p,base,reply,task);assert.equal(proposal.raw.slides.length,4);assert.equal(proposal.raw.slides[1].id,'first');assert.deepEqual(proposal.raw.slides[3],base.slides[2]);assert.equal(proposal.raw.selection[1].primaryPageIndex,3);
 const overlap=structuredClone(reply);overlap.pages[1].sourceArtifactRanges[0].rowStart=2;assert.throws(()=>m.applyContinuation(p,base,overlap,task),/overlap/);
 const missing=structuredClone(reply);missing.pages[0].sourceArtifactRanges[0].rowEnd=2;assert.throws(()=>m.applyContinuation(p,base,missing,task),/dropped/);
 p.status='generating';p.outline=base.slides;p.nodes={last:{status:'done',slide:{title:'Visible limits'}}};p.runtime={slides:{last:{phase:'validated'}}};p.currentRunId='run';p.revision=1;
 const revision=m.continuationRevision(p),next=m.commitContinuation(p,{outline:proposal.raw.slides},proposal.change,revision);
 assert.deepEqual(next.nodes.last,p.nodes.last);assert.deepEqual(next.runtime.slides.last,p.runtime.slides.last);assert.equal(next.editing.epochs.first,1);assert.equal(next.quality.exportable,false);assert.equal(p.pages,12,'transaction does not mutate its input');
 p.revision=2;assert.throws(()=>m.commitContinuation(p,{outline:proposal.raw.slides},proposal.change,revision),/revision/);
 p.planningContract.pagePreference={mode:'fixed',exact:3};assert.equal(m.continuationTask(p,base,1),null);
});

test('native fourteen-point body stays readable; joint capacity cannot be certified by separate objects',async()=>{
 const {fitComponents,contentCanvas,INCH}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-density-capacity.mjs');
 const body={nativeRef:{shapeId:1},style:{fontSizePt:14},geometry:{x:INCH,y:2*INCH,width:8*INCH,height:2*INCH}};
 const native={generationPolicy:{sourceTypography:'bounded'},outline:[{id:'cover'},{id:'body'}],templateFidelity:{mode:'preserve',width:13.333*INCH,height:7.5*INCH,slides:[{}, {nodes:[body],slots:[{role:'content',shapeId:1}]}]}};
 assert.equal(contentCanvas(native,1).fontSizePt,14);
 const short=[{type:'text',content:{text:'Necessary condition C.'}}];assert.equal(fitComponents(short,native,1,{boundedTypography:true,fontSizePt:14}).fontSizePt,14);assert.throws(()=>fitComponents(short,native,1,{boundedTypography:true,fontSizePt:13.5}),/bounded/);
 const geometry=contentCanvas(native,1).geometry;
 const long={type:'text',content:{text:'Mechanism and necessary condition. '.repeat(500)}};
 assert.equal(fitComponents([long,...short],native,1).capacity_ok,false);
 assert.ok(geometry.height>0);assert.equal(fitComponents(short,native,1).capacity_ok,true);
 const locked={...native,editing:{epochs:{body:1}}};assert.throws(()=>fitComponents(short,locked,1,{boundedTypography:true,fontSizePt:14}),/bounded/);
});

test('large global source allocation cannot silently lose late practical topics',()=>{
 const p:any=fixture();p.source.semantic.inventory.items=Array.from({length:182},(_,i)=>({id:'source-'+i,type:'TextBlock',text:`Claim ${i} only under condition ${i}.`}));
 const cards=Array.from({length:15},(_,i)=>({title:i?'Topic '+i:'Cover',titleSecondary:'',intent:i?'Explain topic '+i:'Orient',points:['Distinct task'],sourceUnitIds:i?p.source.semantic.inventory.items.slice((i-1)*13,i*13).map((x:any)=>x.id):[],optionalSourceUnitIds:[],dependsOn:i>1?[i-1]:[]}));
 p.planningContract=engine.acceptSemantic(p,{cards});assert.equal(p.planningContract.logicalCards.length,15);
 const missing=structuredClone({cards});missing.cards[14].sourceUnitIds=[];assert.throws(()=>engine.acceptSemantic(p,missing),{code:'semantic_coverage_invalid'});
 const verbose=structuredClone({cards});verbose.cards[7].points=['No source content units owned on this page'];const repair=engine.semanticMetadataRepairTask(verbose);
 const patched=engine.applySemanticMetadataRepair(verbose,repair,{patches:[{cardIndex:7,field:'points',values:['Explain mechanism and its condition']}]});
 assert.deepEqual(patched.cards.slice(0,7),cards.slice(0,7));assert.deepEqual(patched.cards[7].sourceUnitIds,cards[7].sourceUnitIds);engine.acceptSemantic(p,patched);
 assert.throws(()=>engine.applySemanticMetadataRepair(verbose,repair,{patches:[{cardIndex:8,field:'title',values:['Changed unrelated topic']}]}),/unrequested/);
});

test('a semantic reply without a cover gets a model-written cover; content cards stay frozen',()=>{
 const p:any=fixture(),full=semantic(),noCover={cards:full.cards.slice(1).map((c:any)=>({...c,dependsOn:c.dependsOn.map((n:number)=>n-1)}))};
 assert.throws(()=>engine.acceptSemantic(p,{cards:[...noCover.cards,{...noCover.cards[1],title:'Extra',sourceUnitIds:[],dependsOn:[]}]}),/cover cannot own/);
 assert.equal(engine.semanticCoverRepairTask(p,full),null,'a reply that already has a cover needs no repair');
 const task=engine.semanticCoverRepairTask(p,noCover);assert.ok(task&&/no cover card/.test(task.prompt));
 const repaired=engine.applySemanticCoverRepair(noCover,task,{title:'Mechanism and practice',titleSecondary:'',intent:'Orient the reader',points:['Scope']});
 assert.deepEqual(repaired.cards[0].sourceUnitIds,[]);assert.deepEqual(repaired.cards[0].dependsOn,[]);
 assert.deepEqual(repaired.cards.slice(1).map((c:any)=>c.sourceUnitIds),noCover.cards.map((c:any)=>c.sourceUnitIds),'ownership unchanged');
 assert.deepEqual(repaired.cards[2].dependsOn,[1],'dependencies shift with the inserted cover');
 assert.equal(engine.acceptSemantic(p,repaired).logicalCards.length,3);
 assert.throws(()=>engine.applySemanticCoverRepair(noCover,task,{title:'X',titleSecondary:'',intent:'Y',points:['a'],sourceUnitIds:['a']}),/fields/,'the cover cannot carry source ownership');
 assert.throws(()=>engine.applySemanticCoverRepair(noCover,task,{title:'X',titleSecondary:'',intent:'Y',points:['No source content units owned on this page']}),/Invalid public/);
});
test('unassigned source units are owned through a bounded repair that cannot move other owners',()=>{
 const p:any=fixture(),full=semantic(),partial=structuredClone(full);partial.cards[2].sourceUnitIds=[];
 assert.throws(()=>engine.acceptSemantic(p,partial),{code:'semantic_coverage_invalid'});
 assert.equal(engine.semanticCoverageRepairTask(p,full),null,'complete coverage needs no repair');
 const task=engine.semanticCoverageRepairTask(p,partial);assert.deepEqual(task.missing,['b']);assert.match(task.prompt,/index 0 is the cover/);
 const repaired=engine.applySemanticCoverageRepair(partial,task,{assignments:[{sourceUnitId:'b',cardIndex:2,optional:false}]});
 assert.deepEqual(repaired.cards[2].sourceUnitIds,['b']);assert.deepEqual(repaired.cards[1],partial.cards[1],'other cards stay frozen');engine.acceptSemantic(p,repaired);
 assert.deepEqual(engine.applySemanticCoverageRepair(partial,task,{assignments:[{sourceUnitId:'b',cardIndex:1,optional:true}]}).cards[1].optionalSourceUnitIds,['b']);
 for(const bad of [{assignments:[]},{assignments:[{sourceUnitId:'a',cardIndex:2,optional:false}]},{assignments:[{sourceUnitId:'b',cardIndex:0,optional:false}]},{assignments:[{sourceUnitId:'b',cardIndex:9,optional:false}]}])
  assert.throws(()=>engine.applySemanticCoverageRepair(partial,task,bad),{code:'semantic_coverage_invalid'});
});

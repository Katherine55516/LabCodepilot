/* eslint-disable @typescript-eslint/no-explicit-any -- Contract fixtures intentionally supply partial and malformed wire objects. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generationPageStarted,currentGenerationDraft,generationPageStage} from '../../lib/ppt-generation-view';

test('generation visibility follows real execution, not a pre-bound template; stale drafts stay hidden',()=>{
 const p:any={nodes:{queued:{status:'pending'},writing:{status:'running'},done:{status:'done'}},runtime:{slides:{done:{phase:'render_ready'}}},generationStages:{pages:{}},editing:{epochs:{writing:2}},currentRunId:'r',drafts:{}};
 assert.equal(generationPageStarted(p,'queued'),false);
 assert.equal(generationPageStage(p,'writing'),'writing');assert.equal(generationPageStage(p,'done'),'ready');assert.equal(generationPageStage(p,'queued'),'waiting');assert.equal(generationPageStarted(p,'writing'),true);assert.equal(generationPageStarted(p,'done'),true);
 assert.equal(currentGenerationDraft(p,'writing',{runId:'old',epoch:2} as any),undefined);
 assert.equal(currentGenerationDraft(p,'writing',{runId:'r',epoch:1} as any),undefined);
 assert.ok(currentGenerationDraft(p,'writing',{runId:'r',epoch:2,typing:'actual partial text'} as any));
});

test('semantic v2 owns one core message and one support role per source, and resumes a failed contract candidate',async()=>{
 const {normalizeSemanticGroups,prepareSemanticGroups}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-semantic-groups.mjs');
 const items=Array.from({length:26},(_,i)=>({id:'u'+i,text:'source '+i,type:'MechanismBlock',sectionPath:['Source','Topic'],chunkRefs:['c'+i]}));
 const p:any={pages:10,model:'configured-model',pageDecision:{mode:'auto'},generationPolicy:{content:'overview',details:'notes'},source:{sha256:'s',text:'Original',semantic:{inventory:{items,relationships:[]}}}};
 const raw:any={version:2,groups:[0,1].map(i=>({title:'Topic '+i,readerQuestion:'Question '+i,coreMessage:'Distinct supported answer '+i,narrativeRole:i?'conclusion':'orientation',pages:1,sourceUnitIds:items.slice(i*13,(i+1)*13).map(x=>x.id),supportRoles:items.slice(i*13,(i+1)*13).map(x=>({sourceUnitId:x.id,role:'mechanism'}))}))};
 assert.equal(normalizeSemanticGroups(p,raw).version,2);
 for(const mutate of [(r:any)=>r.groups[1].coreMessage=r.groups[0].coreMessage,(r:any)=>r.groups[0].supportRoles.pop(),(r:any)=>r.groups[0].supportRoles.forEach((x:any)=>x.role='reference')]){const bad=structuredClone(raw);mutate(bad);assert.throws(()=>normalizeSemanticGroups(p,bad),/semantic_groups_invalid/);}
 let checkpoint:any;
 await assert.rejects(prepareSemanticGroups(p,async(_prompt:string,stage:string)=>{if(stage.endsWith(':contract'))throw Object.assign(Error('network'),{code:'network'});return {...raw,groups:[]};},undefined,(c:any)=>{checkpoint=c;}),/network/);
 assert.ok(checkpoint);let calls=0;
 await prepareSemanticGroups(p,async(prompt:string,stage:string)=>{calls++;if(stage==='outline:semantic-editorial')return {version:1,merges:[]};assert.equal(stage,'outline:semantic-groups:contract');assert.ok(prompt.includes('group_contract_repair'));return raw;});
 assert.equal(calls,2);assert.equal(p.semanticGroupingCandidate,undefined);assert.equal(p.semanticGrouping.version,2);assert.equal(p.semanticGrouping.editorialReview.version,1);
 const {applySemanticEditorialMerges,assertEditorialRepairScope,applyEditorialMetadataDelta,editorialDeltaResponseSchema}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-semantic-editorial.mjs');
 const merge={groupIndexes:[0,1],title:'Coherent chain',readerQuestion:'How do these related mechanisms work?',coreMessage:'A source-supported mechanism with its conditions',narrativeRole:'explanation',pages:1,reason:'Two short steps form one explanation'};
 const merged=applySemanticEditorialMerges(normalizeSemanticGroups(p,raw),{version:1,merges:[merge]});assert.equal(merged.groups.length,1);assert.deepEqual(merged.groups[0].sourceUnitIds,raw.groups.flatMap((g:any)=>g.sourceUnitIds));assert.deepEqual(merged.groups[0].supportRoles,raw.groups.flatMap((g:any)=>g.supportRoles));assert.throws(()=>applySemanticEditorialMerges(normalizeSemanticGroups(p,raw),{version:1,merges:[merge,merge]}),/at most one/);
 const fresh=structuredClone(p);delete fresh.semanticGrouping;let initialCalls=0;
 await assert.rejects(prepareSemanticGroups(fresh,async(_prompt:string,stage:string)=>{if(stage==='outline:semantic-groups'){initialCalls++;return raw;}throw Error('editorial transport');}),/editorial transport/);
 assert.ok(fresh.semanticGrouping);assert.equal(fresh.semanticGrouping.editorialReview,undefined);
 await prepareSemanticGroups(fresh,async(_prompt:string,stage:string)=>{assert.equal(stage,'outline:semantic-editorial');return {version:1,merges:[]};});assert.equal(initialCalls,1,'editorial retry reuses the accepted source/message assignment');
 const fieldFailure=structuredClone(p);delete fieldFailure.semanticGrouping;const overlong={...merge,coreMessage:'x'.repeat(321)};
 assert.throws(()=>assertEditorialRepairScope({version:1,merges:[overlong]},{version:1,merges:[{...merge,title:'Unrequested rewrite'}]},[{index:0,field:'coreMessage'}]),/changed untouched/);assert.doesNotThrow(()=>assertEditorialRepairScope({version:1,merges:[overlong]},{version:1,merges:[merge]},[{index:0,field:'coreMessage'}]));
 const deltaApplied=applyEditorialMetadataDelta({version:1,merges:[overlong]},{version:1,updates:[{index:0,field:'coreMessage',value:merge.coreMessage}]},[{index:0,field:'coreMessage'}]);assert.deepEqual(deltaApplied,{version:1,merges:[merge]});assert.equal(overlong.coreMessage.length,321);assert.throws(()=>applyEditorialMetadataDelta({version:1,merges:[overlong]},{version:1,updates:[{index:0,field:'title',value:'Unauthorized'}]},[{index:0,field:'coreMessage'}]),/Unknown or repeated/);
 const deltaSchema=editorialDeltaResponseSchema('Review the WHOLE narrative before parallel page planning. <editorial_metadata_delta>{"invalidFields":[{"index":0,"field":"coreMessage"}]}</editorial_metadata_delta>');assert.equal(deltaSchema.properties.updates.items.properties.value.maxLength,320);

 assert.throws(()=>applySemanticEditorialMerges(normalizeSemanticGroups(p,raw),{version:1,merges:[overlong]}),/coreMessage.*320.*321/);
 assert.throws(()=>applySemanticEditorialMerges(normalizeSemanticGroups(p,raw),{version:1,merges:[{...overlong,title:'x'.repeat(81)}]}),(error:Error)=>error.message.includes('title max 80')&&error.message.includes('coreMessage max 320'),'all invalid metadata fields are reported in one local repair');
 await assert.rejects(prepareSemanticGroups(fieldFailure,async(_prompt:string,stage:string)=>{if(stage==='outline:semantic-groups')return raw;if(stage==='outline:semantic-editorial')return {version:1,merges:[overlong]};throw Error('repair transport');}),/repair transport/);
 assert.ok(fieldFailure.semanticGrouping.editorialCandidate);let fieldRepairCalls=0;
 await prepareSemanticGroups(fieldFailure,async(prompt:string,stage:string)=>{fieldRepairCalls++;assert.equal(stage,'outline:semantic-editorial:contract');assert.ok(prompt.includes('coreMessage'));assert.ok(prompt.includes('321'));assert.ok(prompt.includes('DO NOT return merges'));return {version:1,updates:[{index:0,field:'coreMessage',value:merge.coreMessage}]};});assert.equal(fieldRepairCalls,1);assert.equal(fieldFailure.semanticGrouping.groups.length,1);
 const formatOnly=structuredClone(p);delete formatOnly.semanticGrouping;const badCore=structuredClone(raw);badCore.groups[0].coreMessage='';
 await prepareSemanticGroups(formatOnly,async(_prompt:string,stage:string)=>{if(stage==='outline:semantic-groups')return badCore;if(stage==='outline:semantic-editorial')return {version:1,merges:[]};assert.equal(stage,'outline:semantic-groups:metadata');return {version:1,updates:[{index:0,field:'coreMessage',value:raw.groups[0].coreMessage}]};});assert.equal(formatOnly.semanticGrouping.groups.length,2,'a metadata delta preserves all other groups and ownership');


});

test('negative finding batches retain full source/witness authority and fail closed on transport',async()=>{
 const {confirmReviewFindings}=await import(process.cwd()+'/apps/cowork-server/lib/ppt/review-findings-confirmation.mjs');
 const p:any={source:{text:'Immutable original authority'},deck:{slides:[{id:'s',nodes:[{id:'n',type:'text',content:{text:'Actual visible witness'}}]}]}};
 const review:any={evaluation:'evaluated',missing:Array.from({length:7},(_,i)=>({slideIds:['s'],detail:'Finding '+i})),repeated:[],conflicts:[],unsupported:[],claimAudit:{status:'complete',checks:[]}};
 let calls=0;const answer=async(prompt:string)=>{calls++;const packet=JSON.parse(prompt.match(/<finding_confirmation_packet>([\s\S]*?)<\/finding_confirmation_packet>/)![1]);assert.equal(packet.immutableOriginalSource,p.source.text);assert.equal(packet.visible[0].text,'Actual visible witness');assert.ok(packet.findings.length<=3);return {version:1,checks:packet.findings.map((f:any)=>({findingId:f.id,status:'confirmed',reason:'Actual omission',visibleEvidence:[]}))};};
 const result=await confirmReviewFindings(p,review,answer);assert.equal(calls,3);assert.equal(result.missing.length,7);assert.equal(result.findingConfirmation.batches.length,3);assert.deepEqual(result.claimAudit,review.claimAudit);
 calls=0;await assert.rejects(confirmReviewFindings(p,review,async(prompt:string)=>{if(calls===1)throw Object.assign(Error('transport'),{code:'transport'});return answer(prompt);}),/transport/);assert.equal(review.missing.length,7);
 const cache=new Map();calls=0;
 await assert.rejects(confirmReviewFindings(p,review,async(prompt:string)=>{if(calls===1)throw Error('transient');return answer(prompt);},{checkpoint:{load:(key:string)=>cache.get(key),save:(key:string,value:any)=>cache.set(key,value)}}),/transient/);
 const completedCalls=calls;const resumed=await confirmReviewFindings(p,review,answer,{checkpoint:{load:(key:string)=>cache.get(key),save:(key:string,value:any)=>cache.set(key,value)}});
 assert.equal(calls-completedCalls,2,'the first completed batch is reused after the second batch transport failure');assert.equal(resumed.missing.length,7);
});

test('model queue carries only safe diagnostic fields and retry archives the old failure',async()=>{
 const {createPptModelJobs}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-model-jobs.mjs');
 const {safeModelDiagnostic,archiveModelFailure}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-model-diagnostics.mjs');
 const q=createPptModelJobs({timeoutMs:1000}),p={uid:'u',id:'p',configId:'byok:provider',model:'m'};
 const pending=q.request(p,'prompt',()=>true,{stage:'outline:semantic-groups'}),job=q.claim('u',q.list('u')[0].id);
 const rejected=assert.rejects(pending,(error:any)=>{assert.equal(error.modelStage,'outline:semantic-groups');assert.deepEqual(error.diagnostic,{httpStatus:503,origin:'execution',elapsedMs:100,receivedChars:0});assert.ok(!JSON.stringify(error).includes('SECRET'));return true;});
 q.complete('u',job.id,{lease:job.lease,error:'model_unavailable',diagnostic:{httpStatus:503,origin:'execution',elapsedMs:100,receivedChars:0,url:'SECRET',message:'SECRET',networkCode:'SECRET'}});await rejected;
 assert.deepEqual(safeModelDiagnostic({httpStatus:200,elapsedMs:-1,sdkName:'SECRET',firstTokenMs:999999999}),{});
 const state:any={failure:{code:'timeout'},error:'old'};archiveModelFailure(state);assert.equal(state.failure,undefined);assert.equal(state.error,'');assert.equal(state.failureHistory[0].code,'timeout');
 const timeout=q.request(p,'prompt');q.complete('u',q.claim('u',q.list('u')[0].id).id,{lease:'wrong',text:'{}'});await assert.rejects(timeout,(e:any)=>e.diagnostic.origin==='execution'||e.diagnostic.origin==='queue');
});


test('native slot text drafts reveal only writing fields, including an incomplete current value',async()=>{
 const {draftFromPartialJson}=await import(process.cwd()+'/apps/cowork-server/lib/ppt/draft-store.mjs');
 const partial=draftFromPartialJson('{"title":"Plan","slotTexts":{"42":"First complete text","43":"Growing native text');
 assert.equal(partial.blocks[0].text,'First complete text');assert.equal(partial.typing,'Growing native text');
 const other=draftFromPartialJson('{"sourceArtifacts":{"42":"not a text slot');assert.equal(other.typing,'');assert.equal(other.blocks.length,0);
 const labelled=draftFromPartialJson('{"slotTexts":{"42":[{"label":"Mechanism","body":"A complete explanation"}]}}');assert.ok(labelled.blocks.some((b:any)=>b.text==='A complete explanation'));
});

test('nested checkouts keep their source watched and validate the real local execution route',async()=>{
 const imported=await import(process.cwd()+'/next.config.ts'),config=imported.default?.default||imported.default;
 assert.equal(config.turbopack.root,process.cwd());assert.equal(config.outputFileTracingRoot,process.cwd());assert.ok(config.outputFileTracingExcludes['**/*'].includes('outputs/**'));assert.ok(config.outputFileTracingExcludes['**/*'].includes('.ppt-build/**'));
 const ignored=config.webpack({watchOptions:{}},{dev:true}).watchOptions.ignored;
 assert.equal(ignored.test(process.cwd()+'/src/app/api/ppt/model-jobs/run/route.ts'),false);assert.equal(ignored.test(process.cwd()+'/outputs/generated.json'),true);
 const {probePptFrontend}=await import(process.cwd()+'/scripts/ppt/ppt-frontend-readiness.mjs');
 let calls=0;const request=async(url:URL,options:any)=>{calls++;if(url.pathname==='/ppt')return new Response('PPT');if(url.pathname.endsWith('/projects'))throw new Error('the probe never lists projects');if(url.pathname.endsWith('/health'))return Response.json({ok:true});assert.equal(JSON.parse(options.body).id,'readiness-invalid-id');return Response.json({error:'Invalid model job ID'},{status:400});};
 assert.deepEqual(await probePptFrontend('http://127.0.0.1:3143/ppt',request),{ok:true});assert.equal(calls,3);
 assert.deepEqual(await probePptFrontend('http://127.0.0.1:3143',async(url:URL,options:any)=>url.pathname.endsWith('/health')?Response.json({ok:false,error:'store_unavailable'},{status:503}):request(url,options)),{ok:false,kind:'project_api',status:503});
 assert.deepEqual(await probePptFrontend('http://127.0.0.1:3143',async(url:URL,options:any)=>url.pathname.endsWith('/run')?new Response('<html>404</html>',{status:404}):request(url,options)),{ok:false,kind:'model_execution_route',status:404});
 const {pptModelJobError}=await import('../../lib/ppt-model-job-response');assert.equal(await pptModelJobError(new Response('<html>private</html>',{status:404})),'PPT model execution failed (HTTP 404)');
});


test('editorial correction cannot copy a different group message with minor wording changes',async()=>{
 const {repeatsCoreMessage}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-core-message.mjs');
 const message='Creation modes normalize distinct inputs so pre-existing structure bypasses unnecessary steps. Raw prompts are compressed into a structured brief with goal, audience, tone, and story arc, preventing downstream pipelines from repeatedly reinterpreting the original request.';
 assert.equal(repeatsCoreMessage(message,message.replace('a structured brief','a structured Presentation Brief')),true);
 assert.equal(repeatsCoreMessage(message,'A semantic document tree separates content meaning from geometry. A deterministic renderer applies theme and layout constraints to produce editable slides.'),false);
 const {applySemanticEditorialMerges}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-semantic-editorial.mjs');
 const plan={version:2,groups:[{coreMessage:message,sourceUnitIds:['a'],supportRoles:[]},{coreMessage:'Semantic tree',sourceUnitIds:['b'],supportRoles:[]},{coreMessage:'Deterministic layout',sourceUnitIds:['c'],supportRoles:[]}]};
 assert.throws(()=>applySemanticEditorialMerges(plan,{version:1,merges:[{groupIndexes:[1,2],title:'IR and rendering',readerQuestion:'How does rendering use semantic meaning?',coreMessage:message.replace('a structured brief','a structured Presentation Brief'),narrativeRole:'explanation',pages:1,reason:'A coherent mechanism'}]}),(error:any)=>error.invalidFields[0].index===0&&error.invalidFields[0].field==='coreMessage'&&error.message.includes('another topic'));
});


test('automatic overview keeps a plain bibliography in full notes without demoting annotated claims or explicit display requests',async()=>{
 const {selectionConstraints,referenceNotesContract,mandatorySelectionFacts}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-content-selection.mjs');
 const item={id:'refs',type:'TaxonomyBlock',sectionPath:['References'],text:'- [Official documentation](https://example.org/docs)\n- [Engineering reference](https://example.org/engineering)',must_preserve_structure:true};
 const p={pageDecision:{mode:'auto'},generationPolicy:{content:'overview',details:'notes'},source:{semantic:{inventory:{items:[item],relationships:[]}}}};
 assert.equal(referenceNotesContract(p,item),true);assert.equal(mandatorySelectionFacts(p).length,0,'URL digits and slugs are bibliography provenance, not main-deck numeric claims');assert.ok(selectionConstraints({...p,confirmedOutline:[],pageDecision:{mode:'explicit',confirmedAt:'now'}})[0].allowedDestinations.includes('notes'),'a notes disposition remains legal after outline confirmation');assert.deepEqual(selectionConstraints(p)[0].allowedDestinations,['notes']);assert.equal(selectionConstraints(p)[0].notesWithoutVisibleEquivalentAllowed,true);
 for(const project of [{...p,userRequirements:'Show the bibliography'}, {...p,generationPolicy:{content:'full_source',details:'notes'}},{...p,confirmedOutline:[]}])assert.equal(referenceNotesContract(project,item),false);
 assert.equal(referenceNotesContract(p,{...item,mustDisplay:true}),false);assert.equal(referenceNotesContract(p,{...item,text:'- [Only verified evidence supports this conclusion](https://example.org/docs)\n- [Engineering reference](https://example.org/engineering)'}),false,'a claim or condition in the link label remains protected');
 assert.equal(referenceNotesContract(p,{...item,text:item.text+'\n- The result holds only when the source is verified.'}),false);
});


test('whole-narrative constrained decoding uses the actual group budget, IDs and support enums',async()=>{
 const {semanticPlanningResponseSchema}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-semantic-groups.mjs');
 const p={pages:10,pageDecision:{mode:'auto'},generationPolicy:{content:'overview',details:'notes'},source:{semantic:{inventory:{items:Array.from({length:26},(_,i)=>({id:'u'+i}))}}}};
 const schema=semanticPlanningResponseSchema(p,'outline:semantic-groups');assert.equal(schema.properties.groups.maxItems,9);assert.equal(schema.properties.groups.items.properties.coreMessage.maxLength,320);assert.equal(schema.properties.groups.items.properties.sourceUnitIds.items.enum.length,26);assert.ok(!schema.properties.groups.items.properties.supportRoles.items.properties.role.enum.includes('process'));
 assert.equal(semanticPlanningResponseSchema(p,'content:s1'),undefined);
});

test('production compile hook excludes only root test artifacts from instrumentation trace',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const {prunePptTestBuildTrace}=await import('../../../scripts/ppt/ppt-build-trace-policy');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ppt-trace-'));
 try{const dist=path.join(root,'.next'),file=path.join(dist,'server','instrumentation.js.nft.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({version:1,files:['../../outputs/local/profile.db','../../.ppt-build/test.json','../../src/lib/runtime-log.ts','../../src/outputs/helper.ts']}));const result=await prunePptTestBuildTrace({projectDir:root,distDir:dist});assert.equal(result.removed,2);assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')).files,['../../src/lib/runtime-log.ts','../../src/outputs/helper.ts']);}
 finally{await fs.rm(root,{recursive:true,force:true});}
});


test('table row diagnostics respect a hash-valid summary but still detect missing selected rows',async()=>{
 const {compileContentSelection}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-content-selection.mjs');const {inspectContent}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-content-qa.mjs');
 const rows=[['Label','Description'],['Alpha','Source alpha'],['Beta','Source beta'],['Gamma','Source gamma']],text='| Label | Description |\n| --- | --- |\n| Alpha | Source alpha |\n| Beta | Source beta |\n| Gamma | Source gamma |';
 const item={id:'b',type:'TableBlock',text,rows,chunkRefs:['c'],sectionPath:['Topic']};
 const p:any={pages:3,pageDecision:{mode:'auto'},generationPolicy:{content:'overview',details:'notes'},source:{text,semantic:{inventory:{items:[item],relationships:[]},blocks:[{id:'b',type:'table',text}],chunks:[{id:'c',sourceBlocks:['b']}]}}};
 p.contentSelection=compileContentSelection(p,{version:2,slides:[{sourceUnitIds:['b']}],selection:[{sourceUnitId:'b',destination:'summary',rowIndices:[1,3],reason:'Representative original rows; complete table in notes'}]});p.originalSourceInventory=p.source.semantic.inventory;
 p.outline=[{id:'s',chunkRefs:['c'],visualIntent:{type:'table'}}];const deck={slides:[{id:'s',title:'Selected task families',nodes:[{id:'n',type:'text',content:{text:'Alpha Gamma'}}]}]};
 assert.equal(inspectContent(p,deck).issues.some((i:any)=>i.code==='source_table_rows_missing'),false);
 deck.slides[0].title='3 categories';assert.ok(inspectContent(p,deck).issues.some((i:any)=>i.code==='source_table_cardinality'),'a summary cannot keep a complete-table count promise');deck.slides[0].title='Selected task families';
 deck.slides[0].nodes[0].content.text='Alpha';assert.ok(inspectContent(p,deck).issues.some((i:any)=>i.code==='source_table_rows_missing'));
 p.contentSelection.hash='stale';deck.slides[0].nodes[0].content.text='Alpha Gamma';assert.ok(inspectContent(p,deck).issues.some((i:any)=>i.code==='source_table_rows_missing'),'a stale selection cannot waive original rows');
});

test('qualitative evidence needs an actual full source binding; results and required atoms remain strict',async()=>{
 const {inspectContent}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-content-qa.mjs');
 const text='Public architectural statements are distinguished from explicitly unknown private implementation details.';
 const p:any={source:{text,segments:[{id:'r',text}],semantic:{inventory:{items:[{id:'u',type:'MechanismBlock',text}],relationships:[]},evidenceAtoms:[{id:'e',sourceRefs:['r'],exactText:'A separate exact source clause',kind:'constraint',measurements:[]}]}}};
 const slide:any={id:'s',title:'Evidence boundaries',sourceRefs:['r'],nodes:[{id:'n',type:'text',sourceArtifact:{sourceUnitId:'u'},content:{text}}]};
 assert.equal(inspectContent(p,{slides:[slide]}).issues.some((i:any)=>i.code==='evidence_page_without_evidence'),false);
 delete slide.nodes[0].sourceArtifact;assert.ok(inspectContent(p,{slides:[slide]}).issues.some((i:any)=>i.code==='evidence_page_without_evidence'));
 slide.nodes[0].sourceArtifact={sourceUnitId:'u'};slide.title='Benchmark results';assert.ok(inspectContent(p,{slides:[slide]}).issues.some((i:any)=>i.code==='evidence_page_without_evidence'));
});


test('a formula after a prose lead and an example marker inside an aside is checked on its own (mlq-r25)',async()=>{
 const {inspectContent}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-content-qa.mjs');
 const text='- **Upper barrier** — a profit-take level, e.g. $+2\\sigma_i$ (a multiple of trailing volatility).\n- **Lower barrier** — a stop-loss level.';
 const p:any={source:{text,segments:[{id:'r',text}]}};
 const slide=(body:string):any=>({id:'s',title:'Triple barrier',sourceRefs:['r'],nodes:[{id:'n',type:'text',content:{text:body}}]});
 const unverified=(body:string)=>inspectContent(p,{slides:[slide(body)]}).issues.filter((i:any)=>i.code==='visible_formula_unverified');
 assert.deepEqual(unverified('Upper barrier (profit-take, e.g. +2σi), lower (stop-loss).'),[]);
 assert.ok(unverified('Upper barrier (profit-take, e.g. +3σi), lower (stop-loss).').length,'a formula absent from the source still blocks');
});

test('confirmed page count does not turn an authorized field-example value into a new mandatory deck fact',async()=>{
 const {compileContentSelection,mandatorySelectionFacts,schemaExampleSelection}=await import(process.cwd()+'/apps/cowork-server/lib/ppt-content-selection.mjs');
 const item={id:'brief',type:'TableBlock',text:'Field | Value\ngoal | Explain architecture\naudience | Engineering\nlength | 10 slides',rows:[['Field','Value'],['goal','Explain architecture'],['audience','Engineering'],['length','10 slides']],priority:'high',mustDisplay:true,sourceStructureOrigin:'parsed-source-diagram',diagramSource:{kind:'schema',relation:'field-value',text:'Original complete field example'},chunkRefs:['c']};
 const p:any={pageDecision:{mode:'auto'},generationPolicy:{content:'overview',details:'notes',knowledge:'source_only'},source:{text:item.text,semantic:{inventory:{items:[item],relationships:[]}}}};
 p.contentSelection=compileContentSelection(p,{version:2,slides:[{sourceUnitIds:['brief']}],selection:[{sourceUnitId:'brief',destination:'summary',rowIndices:[1,2],reason:'Representative field example; full original in notes'}]});p.originalSourceInventory=p.source.semantic.inventory;
 assert.equal(mandatorySelectionFacts(p).some((f:any)=>f.text.includes('10 slides')),false);
 p.confirmedOutline={hash:'accepted'};p.pageDecision={mode:'explicit',confirmedAt:'now'};
 assert.ok(schemaExampleSelection(p,item),'confirmation freezes the valid selection instead of silently invalidating its authorization');assert.equal(mandatorySelectionFacts(p).some((f:any)=>f.text.includes('10 slides')),false);
 p.contentSelection.hash='stale';assert.equal(schemaExampleSelection(p,item),null,'a stale ledger does not preserve the exception');assert.ok(mandatorySelectionFacts(p).some((f:any)=>f.text.includes('10 slides')));
});

test('production NFT limits unknown runtime roots while retaining explicit and rooted dynamic assets',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {createRequire}=await import('node:module');const require=createRequire(path.join(process.cwd(),'package.json'));
 const {nodeFileTrace}=require('next/dist/compiled/@vercel/nft');
 const {TraceEntryPointsPlugin}=require('next/dist/build/webpack/plugins/next-trace-entrypoints-plugin');
 const picomatch=require('next/dist/compiled/picomatch');
 const {limitUnresolvedRuntimeTrace}=await import('../../../scripts/ppt/ppt-build-trace-policy');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ppt-host-trace-'));
 try{
  for(const [file,body]of [['tools/npm','explicit npm runtime'],['other/npm','unresolved candidate'],['other/.claude/skills/guide.txt','user runtime skill'],['builtin/.claude/skills/guide.txt','explicit bundled skill'],['assets/darwin/native.node','rooted dynamic native asset'],['sdk-runtime/cli.js','actual SDK entry'],['node_modules/npm/package.json','{"name":"npm"}'],['assets/logo.svg','<svg/>']]){const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,body);}
  const entry=path.join(root,'entry.cjs');await fs.writeFile(entry,`const fs=require('fs'),path=require('path');fs.readFileSync(path.join(process.cwd(),process.argv[2],'npm'));fs.readFileSync(path.join(__dirname,'tools','npm'));fs.readFileSync(path.join(__dirname,'sdk-runtime','cli.js'));fs.readFileSync(path.join(__dirname,'node_modules','npm','package.json'));fs.readFileSync(path.join(__dirname,'assets','logo.svg'));fs.readFileSync(path.join(process.cwd(),process.argv[3],'.claude','skills','guide.txt'));fs.readFileSync(path.join(__dirname,'builtin','.claude','skills','guide.txt'));fs.readFileSync(path.join(__dirname,'assets',process.argv[4],'native.node'));`);
  const baseline=await nodeFileTrace([entry],{base:root,processCwd:root});assert.ok(baseline.fileList.has('other/npm'),'the real tracer reproduces the recursive unresolved search');
  const plugin=new TraceEntryPointsPlugin({rootDir:root,appDir:root,traceIgnores:[],compilerType:'server',appDirEnabled:true});
  const config={plugins:[plugin]};assert.equal(limitUnresolvedRuntimeTrace(config),1);assert.equal(limitUnresolvedRuntimeTrace(config),0,'idempotent for repeated compiler hooks');
  const matcher=picomatch(plugin.traceIgnores,{contains:true,dot:true});assert.equal(matcher('**/*/npm'),true);assert.equal(matcher('**/*/.claude/skills'),true);assert.equal(matcher('assets/**/*/native.node'),false);assert.equal(matcher('lib/**/*/npm'),false);assert.equal(matcher('tools/npm'),false);assert.equal(matcher('node_modules/npm/package.json'),false);
  const traced=await nodeFileTrace([entry],{base:root,processCwd:root,ignore:matcher});assert.equal(traced.fileList.has('other/npm'),false);assert.equal(traced.fileList.has('other/.claude/skills/guide.txt'),false);
  for(const file of ['entry.cjs','tools/npm','sdk-runtime/cli.js','node_modules/npm/package.json','assets/logo.svg','builtin/.claude/skills/guide.txt','assets/darwin/native.node'])assert.ok(traced.fileList.has(file),'retain explicitly referenced '+file);
  assert.equal(limitUnresolvedRuntimeTrace({plugins:[{constructor:{name:'SomeOtherPlugin'}}]}),0);
  assert.throws(()=>limitUnresolvedRuntimeTrace({plugins:[{constructor:{name:'TraceEntryPointsPlugin'}}]}),/contract changed/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

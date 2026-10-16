import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-quality-routing-'));
process.env.COWORK_STATE_DIR=dir;
const store=await import('./lib/ppt-store.mjs');
const {normalizeExecutionPolicy,resolveTaskRoute}=await import('./lib/ppt-execution-policy.mjs');
const {_internals,handlePpt}=await import('./lib/ppt-api.mjs');
const {pptModelJobs}=await import('./lib/ppt-model-jobs.mjs');
const uid='quality-routing-test',id='a'.repeat(32);
const ref=model=>({configId:'byok:configured',model,thinkingControl:true});
const p={id,uid,title:'Source-grounded workflow',configId:'byok:configured',model:'default',status:'generating',stage:'generation',revision:1,currentRunId:'run_test',source:{sha256:'source',semantic:{inventory:{items:[]}}},outline:[{id:'simple',title:'Team introduction'},{id:'complex',title:'Formula',description:'$x=\\frac{a}{b}$'}],executionPolicy:normalizeExecutionPolicy({version:1,qualityLevel:'balanced',roleRoutes:{writer_fast:{primary:ref('fast'),fallbacks:[]},writer_reasoning:{primary:ref('reasoning'),fallbacks:[]},critic:{primary:ref('reviewer'),fallbacks:[]}}})};
try{
 store.save(p);
 const observed=[];
 for(const stage of ['content:simple','content:complex','review:deck','content:simple:contract-repair:1','content:simple:critic:1']){
  const response=_internals.defaultDeps.modelCall(p,(stage.includes('contract-repair')?'<writer_local_repair>Repair an exact title string.</writer_local_repair>':'')+'Return {"ok":true}',()=>{},()=>{},{nodeKey:stage});
  let job;
  for(let n=0;n<100&&!job;n++){const candidate=pptModelJobs.list(uid)[0];if(candidate)job=pptModelJobs.claim(uid,candidate.id);else await new Promise(r=>setTimeout(r,5));}
  assert.ok(job,'a real production job must reach the desktop bridge');
  observed.push([job.model,job.options.role]);assert.equal(job.options.thinkingMode,stage==='content:complex'?'enabled':'disabled','actual wire effort follows complexity; a strong-model upgrade alone does not require hidden reasoning');
  pptModelJobs.complete(uid,job.id,{lease:job.lease,text:'{"ok":true}',telemetry:{inputTokens:10,outputTokens:4,wireAttempts:1}});
  assert.deepEqual(await response,{ok:true});
 }
 assert.deepEqual(observed,[['fast','writer_fast'],['reasoning','writer_reasoning'],['reviewer','critic'],['fast','writer_fast'],['reasoning','writer_reasoning']]);
 let saved=store.get(uid,id);assert.equal(saved.executionHistory.length,5);assert.ok(saved.executionHistory.every(row=>row.status==='completed'&&row.inputTokens===10&&row.outputHash));assert.deepEqual(saved.executionHistory.map(row=>row.thinkingMode),['disabled','enabled','disabled','disabled','disabled'],'the real execution trace records the chosen effort');
 const witness=_internals.defaultDeps.modelCall(p,'Return {"ok":true}',()=>{},()=>{},{nodeKey:'review:deck:source-witness:1'});
 let witnessJob;for(let n=0;n<100&&!witnessJob;n++){const candidate=pptModelJobs.list(uid)[0];if(candidate)witnessJob=pptModelJobs.claim(uid,candidate.id);else await new Promise(r=>setTimeout(r,5));}
 assert.ok(witnessJob);assert.equal(witnessJob.options.thinkingMode,'enabled');assert.equal(witnessJob.options.role,'critic');
 pptModelJobs.complete(uid,witnessJob.id,{lease:witnessJob.lease,text:'{"ok":true}',telemetry:{inputTokens:10,outputTokens:4,wireAttempts:1}});await witness;
 saved=store.get(uid,id);const reviews=saved.executionHistory.filter(row=>row.role==='critic');assert.equal(reviews.length,2);assert.equal(reviews[0].taskKey,reviews[1].taskKey,'source adjudication shares the original review attempt budget');assert.equal(reviews[1].attempt,2);assert.ok(reviews[1].complexity.reasons.includes('disputed_source_verdict'));
 // A transient wire failure consumes budget but says nothing about semantic
 // difficulty; retry the same selected role/model without a hidden upgrade.
 p.outline.push({id:'transient',title:'Known team schedule'});saved.outline=p.outline;store.save(saved);
 const retried=_internals.defaultDeps.modelCall(p,'Return {"ok":true}',()=>{},()=>{},{nodeKey:'content:transient'});
 for(let attempt=0;attempt<2;attempt++){
  let job;for(let n=0;n<500&&!job;n++){const candidate=pptModelJobs.list(uid)[0];if(candidate)job=pptModelJobs.claim(uid,candidate.id);else await new Promise(r=>setTimeout(r,5));}
  assert.ok(job,'bounded transport retry reaches the real queue');assert.equal(job.model,'fast');assert.equal(job.options.role,'writer_fast');
  pptModelJobs.complete(uid,job.id,{lease:job.lease,...(attempt?{text:'{"ok":true}',telemetry:{wireAttempts:1,inputTokens:10,outputTokens:4}}:{error:'transport',telemetry:{wireAttempts:1}})});
 }
 assert.deepEqual(await retried,{ok:true});saved=store.get(uid,id);const transient=saved.executionHistory.filter(row=>row.stage==='content:transient');assert.equal(transient.length,2);assert.equal(transient[0].errorCode,'transport');assert.equal(transient[1].routingReason.previousAttempts,1);assert.equal(transient[1].routingReason.previousSemanticAttempts,0);assert.equal(transient[1].attempt,2,'the failed wire request remains charged to attempt budget');

 // A schema correction cannot consume a second semantic repair round.
 p.outline.push({id:'budget',title:'Routine operations'});saved=store.get(uid,id);saved.outline=p.outline;store.save(saved);
 async function budgetCall(suffix,contract=false){
  const pending=_internals.defaultDeps.modelCall(p,(contract?'<writer_contract_error>format only</writer_contract_error>':'')+'Return {"ok":true}',()=>{},()=>{},{nodeKey:'content:budget'+suffix});
  let job;for(let n=0;n<100&&!job;n++){const candidate=pptModelJobs.list(uid)[0];if(candidate)job=pptModelJobs.claim(uid,candidate.id);else await new Promise(r=>setTimeout(r,5));}assert.ok(job,'this allowed repair round must reach the production bridge');
  pptModelJobs.complete(uid,job.id,{lease:job.lease,text:'{"ok":true}',telemetry:{inputTokens:10,outputTokens:4,wireAttempts:1}});return pending;
 }
 await budgetCall('');await budgetCall(':repair');await budgetCall(':repair:contract-repair:1',true);await budgetCall(':repair');
 await assert.rejects(_internals.defaultDeps.modelCall(p,'Return {"ok":true}',()=>{},()=>{},{nodeKey:'content:budget:repair'}),e=>e.code==='execution_repair_limit');
 await budgetCall(':repair:contract-repair:2',true);
 await assert.rejects(_internals.defaultDeps.modelCall(p,'<writer_contract_error>format only</writer_contract_error>',()=>{},()=>{},{nodeKey:'content:budget:repair:contract-repair:3'}),e=>e.code==='execution_attempt_limit');
 saved=store.get(uid,id);const budgetRows=saved.executionHistory.filter(row=>row.stage?.startsWith('content:budget'));assert.equal(budgetRows.length,5);assert.equal(budgetRows.filter(row=>row.routingReason.repairKind==='contract').length,2);assert.equal(new Set(budgetRows.map(row=>row.taskKey)).size,1);assert.equal(budgetRows.at(-1).attempt,5);assert.equal(budgetRows[3].routingReason.previousSemanticAttempts,2,'format correction is not a model-capability failure');
 const escalation={...p,executionPolicy:normalizeExecutionPolicy({version:1,qualityLevel:'balanced',roleRoutes:{writer_fast:{primary:ref('fast'),fallbacks:[ref('fast-backup')]},writer_reasoning:{primary:ref('strong-primary'),fallbacks:[ref('strong-backup')]}}})};assert.equal(resolveTaskRoute(escalation,'writer_fast',{level:'simple'},1).model,'strong-primary');assert.equal(resolveTaskRoute(escalation,'writer_fast',{level:'simple'},2).model,'strong-backup');
 saved.status='paused';store.save(saved);
 const req=Readable.from([Buffer.from(JSON.stringify({baseRevision:1,executionPolicy:{...p.executionPolicy,qualityLevel:'rigorous',budget:{maxAttemptsPerTask:5,maxOutputTokens:200000}}}))]);req.method='PATCH';
 let result;await handlePpt(req,new URL('http://local/ppt/projects/'+id+'/execution-policy'),{uid,log:console.log,send:(status,body)=>{result={status,body};return true;}});
 assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(store.get(uid,id).executionPolicy.qualityLevel,'rigorous');assert.deepEqual(store.get(uid,id).outline,p.outline);assert.equal(store.get(uid,id).revision,1);
 // Reparse uses the same validation as upload and always cleans its worker.
 const templateId='b'.repeat(32),templateHash='fixture-template';
 store.writeTemplate(uid,templateId,Buffer.from('PKfixture'));
 store.saveTemplates(uid,[{id:templateId,kind:'uploaded',name:'Report',extension:'pptx',sha256:templateHash,compatibility:'reference',pages:2,version:1}]);
 store.writeTemplateIR(uid,templateId,{schemaVersion:1,parserVersion:'pptx-ir-8',sha256:templateHash,imported:{deck:{slides:[]}}});
 let cleaned=0,invalid=true;
 const templateDeps={analyzeTemplate:async()=>({compatibility:'mapped',pages:invalid?101:3,palette:{background:'#ffffff',accent:'#000000',foreground:'#111111',muted:'#888888'},fonts:{title:'Arial',body:'Arial',titleEastAsia:'Arial',bodyEastAsia:'Arial'}}),importTemplateIR:async()=>({deck:{slides:[]}}),removeContainer:async()=>{cleaned++;}};
 async function templateRequest(method,suffix,data){
  const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;let response;
  await handlePpt(req,new URL('http://local/ppt/templates/'+suffix),{uid,deps:templateDeps,send:(status,body)=>{response={status,body};return true;}});return response;
 }
 assert.equal((await templateRequest('GET','violet?view=objects')).status,200);
 store.writeTemplateIR(uid,templateId,{schemaVersion:1,parserVersion:'pptx-ir-8',sha256:templateHash,imported:{externalPptx:{width:12000,height:7000},deck:{slides:[{nodes:[{id:'fixed_logo',type:'image',nativeRef:{name:'Approved logo'},geometry:{x:100,y:100,width:300,height:200},content:{mediaRole:'brand'}}]}]}}});
 const objects=await templateRequest('GET',templateId+'?view=objects');assert.deepEqual(objects.body.size,{width:12000,height:7000});assert.deepEqual(objects.body.objects[0].geometry,{x:100,y:100,width:300,height:200});assert.equal(objects.body.objects[0].id,'fixed_logo');
 const before=JSON.stringify(store.listTemplates(uid));
 assert.equal((await templateRequest('PATCH',templateId,{reparse:true})).status,422);assert.equal(cleaned,1);assert.equal(JSON.stringify(store.listTemplates(uid)),before);
 invalid=false;const reparsed=await templateRequest('PATCH',templateId,{reparse:true});assert.equal(reparsed.status,200);assert.equal(reparsed.body.template.pages,3);assert.equal(reparsed.body.template.version,2);assert.equal(cleaned,2);
 console.log('PASS: production model transport routes fast/reasoning/critic separately, records actual usage, and updates only future execution policy on pause. This is a bridge fixture, not a live provider benchmark.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

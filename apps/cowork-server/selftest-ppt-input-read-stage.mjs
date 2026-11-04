// Input read stage (card flow, 2026-10-23): a pasted text, a file and a
// version update are read by code and stop at input_ready for the settings
// form; nothing is planned or written before the author writes the outline,
// and the export and the writer are closed until then.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-input-ready-'));process.env.COWORK_STATE_DIR=root;
const [{handlePpt,_internals},store,{normalizePaste},{defaultGenerationPolicy},{countsAgainstLibraryQuota},{cardDeckReply}]=await Promise.all([import('./lib/ppt-api.mjs'),import('./lib/ppt-store.mjs'),import('./lib/ppt-source.mjs'),import('./lib/ppt-generation-policy.mjs'),import('./lib/ppt-library.mjs'),import('./ppt-scope-test-helpers.mjs')]);
const uid='input-ready',calls=[];
const deps={..._internals.defaultDeps,removeContainer:async()=>{},extractFile:async(_p,name,bytes)=>({...normalizePaste(bytes.toString()),name,kind:'file'}),modelCall:async(p,prompt,_a,_l,options)=>{
 calls.push(options.nodeKey);const reply=cardDeckReply(p,prompt,options);if(reply)return reply;throw Object.assign(Error('no writer in this test'),{code:'transport'});
}};
async function call(method,url,data){let result;const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;await handlePpt(req,new URL('http://local'+url),{uid,deps,activity:()=>{},log:()=>{},send:(status,body)=>{result={status,body};return true;}});return result;}
async function settle(id,status){for(let i=0;i<500;i++){const p=store.get(uid,id);if(p?.status===status)return p;if(p?.status==='failed'&&status!=='failed')throw Error(p.error+' '+JSON.stringify(p.failure?.details||{}).slice(0,600));await new Promise(r=>setTimeout(r,10));}throw Error('state did not settle: '+store.get(uid,id)?.status);}
const text='# Release evidence\n\n## Records\n\nRecords must be validated before release.\n\n## Evidence\n\nKeep the original evidence and all release conditions.\n\n## Review\n\nA reviewer signs off on every release.\n\n## Archive\n\nArchive the evidence with the release.';
try{
 for(const inputKind of ['paste','file']){
  const before=calls.length;
  const created=await call('POST','/ppt/projects',{inputKind,text:inputKind==='paste'?text:undefined,...(inputKind==='file'?{fileName:'source.md',fileBase64:Buffer.from(text).toString('base64')}:{}),readOnlyInput:true,generationPolicy:defaultGenerationPolicy(),configId:'fixture',model:'fixture',template:'light'});
  assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.project.id;
  let p=await settle(id,'input_ready');
  assert.equal(calls.length,before,'the input is read by code, with no model call');assert.equal(p.outline.length,0);assert.ok(countsAgainstLibraryQuota(p));
  assert.equal(p.inputUnderstanding.basis,'code_statistics');assert.equal(p.inputUnderstanding.sections.length,4);
  assert.equal(p.planning.pageRecommendation.recommended,p.inputUnderstanding.recommended);assert.ok(p.inputUnderstanding.presets.standard.total>=6);
  const view=(await call('GET',`/ppt/projects/${id}?view=live`)).body.project;assert.deepEqual(view.planningContract.settings.presets,p.inputUnderstanding.presets,'the settings form shows the presets');
  assert.equal((await call('POST',`/ppt/projects/${id}/generate`,{})).status,409,'reading is not outline confirmation');assert.equal((await call('GET',`/ppt/projects/${id}/export`)).status,409,'an input task has no formal export');
  const saved=p.inputUnderstanding.sourceIdentity;
  assert.equal((await call('POST',`/ppt/projects/${id}/planning`,{command:'outline',length:{preset:'quick'}})).status,202);p=await settle(id,'outline_ready');
  assert.equal(p.id,id);assert.equal(p.inputUnderstanding.sourceIdentity,saved,'the same reading is kept');
  assert.deepEqual(calls.slice(before).map(key=>key.split(':').slice(0,2).join(':')),['outline:cards','outline:finish','outline:retitle','outline:retitle'],'with the title standard retry (N5)');
 }
 // A version update stops at the same reading boundary.
 const baseId=store.newId();store.save({id:baseId,uid,title:'Approved release',status:'completed',pages:3,template:'light',revision:1,publishedRevision:1,outline:[{id:'base-slide',title:'Release rules'}],deck:{slides:[{id:'base-slide',title:'Release rules',bullets:['Validate the original records before release.']}]},generationPolicy:defaultGenerationPolicy(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 for(const progressKind of ['paste','file']){
  const before=calls.length,latest='Keep the new review condition with the original release evidence.';
  const result=await call('POST','/ppt/updates',{baseProjectId:baseId,progressKind,...(progressKind==='file'?{progressFileName:'latest.md',progressFileBase64:Buffer.from(latest).toString('base64')}:{progressText:latest}),generationPolicy:defaultGenerationPolicy(),configId:'fixture',model:'fixture',template:'light'});
  assert.equal(result.status,201,JSON.stringify(result.body));let update=await settle(result.body.project.id,'input_ready');
  assert.equal(calls.length,before,'an update is read by code too');assert.equal(update.outline.length,0);assert.equal(update.version.parentId,baseId);
  assert.ok(update.source.text.includes('original records'));assert.ok(update.source.text.includes('new review condition'));assert.ok(update.planningContract,'an update is a card deck');
  assert.equal((await call('POST',`/ppt/projects/${update.id}/planning`,{command:'outline'})).status,202);update=await settle(update.id,'outline_ready');
  assert.equal(update.outline[0].title,'Approved release','an update\'s cover is the base deck\'s title');assert.ok(update.outline.slice(1).every(slide=>!/[\u3400-\u9fff]/u.test(slide.section)),'its part labels follow the deck language');
  assert.equal(update.diff,null,'an update deck has no keep/rewrite mapping');
 }
 console.log('Input read checkpoint (card flow): paste/file/update read by code, no model call or writer before the outline, presets in the settings view, same reading kept, quota and export gates: OK');
}finally{fs.rmSync(root,{recursive:true,force:true});}

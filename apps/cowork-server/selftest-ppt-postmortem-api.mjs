import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {Readable} from 'node:stream';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-batched-plan-'));process.env.COWORK_STATE_DIR=dir;
const store=await import('./lib/ppt-store.mjs');const {handlePpt,_internals}=await import('./lib/ppt-api.mjs');
let injectedFailure=1,observedLiveTurns=0;const calls=[];
const {cardDeckReply}=await import('./ppt-scope-test-helpers.mjs');
const deps={..._internals.defaultDeps,modelCall:async(p,prompt,_a,_l,options={})=>{
 setImmediate(()=>{if(store.get(p.uid,p.id)?.status==='outlining')observedLiveTurns++;});
 calls.push(options.nodeKey);
 // The first deck chunk fails on transport; its topics are then written one by one.
 if(/:deck:0$/u.test(options.nodeKey)&&injectedFailure>0){injectedFailure--;throw Object.assign(new Error('ppt_transport'),{code:'transport'});}
 const reply=cardDeckReply(p,prompt,options);if(reply)return reply;
 throw Error('Unexpected model step '+options.nodeKey);
}};
const invoke=async(method,pathname,data)=>{const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;let reply;await handlePpt(req,new URL('http://local'+pathname),{uid:'batch-test',deps,send:(status,body)=>{reply={status,body};return true;},log:()=>{}});return reply;};
async function settle(id){for(let i=0;i<500;i++){const p=store.get('batch-test',id);if(['failed','outline_ready'].includes(p.status))return p;await new Promise(r=>setTimeout(r,10));}throw Error('API did not settle');}
try{
 // A proven source arithmetic conflict is an advisory source warning (Fable,
 // 2026-10-23): the project is saved with its original text unchanged and the
 // warning, worded from its figures, exists before any model call; nothing
 // waits on it. Isolated deps keep the shared fixture's failure counters untouched.
 const modelCallsBefore=calls.length,seenWarnings=[];
 const isolated={..._internals.defaultDeps,modelCall:async p=>{seenWarnings.push((p.source?.mediaWarnings||[]).map(w=>w.code));throw Object.assign(new Error('ppt_cancelled'),{code:'cancelled'});}};
 const invokeIsolated=async(method,pathname,data)=>{const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;let reply;await handlePpt(req,new URL('http://local'+pathname),{uid:'batch-test',deps:isolated,send:(status,body)=>{reply={status,body};return true;},log:()=>{}});return reply;};
 const invalidText='# Portfolio groups\n2\\times3\\times3$ sorts on size, investment and ROE (27 portfolios).';
 const invalidSource=await invokeIsolated('POST','/ppt/projects',{inputKind:'paste',text:invalidText,template:'light',configId:'byok:test-provider',model:'test-model'});
 assert.equal(invalidSource.status,201);const conflictId=invalidSource.body.project.id;
 for(let i=0;i<500&&!['failed','outline_ready','input_ready','outlining'].includes(store.get('batch-test',conflictId)?.status);i++)await new Promise(r=>setTimeout(r,10));
 const conflict=store.get('batch-test',conflictId),warning=(conflict.source?.mediaWarnings||[]).find(w=>w.code==='source_arithmetic_conflict');
 assert.equal(warning?.required,false,'the conflict is advisory');assert.deepEqual(warning.params,{expression:'2×3×3',calculated:18,claimed:27});assert.match(warning.message,/2×3×3 = 18/u);
 assert.ok(conflict.source.text.includes('27 portfolios'),'the original is never rewritten');
 assert.ok(seenWarnings.every(codes=>codes.includes('source_arithmetic_conflict')),'the warning is attached before any model call');
 assert.equal(calls.length,modelCallsBefore,'the shared fixture model was not used');
 store.remove('batch-test',conflictId);assert.equal(store.list('batch-test').length,0);
 // A long source (over 30k characters) is written in parallel chunks of whole
 // topics; a chunk whose deck call fails falls back to per-topic calls for its
 // topics only, and the outline stays live (the event loop is not starved).
 const sentence=n=>`Condition ${n} applies only when evidence ${n} is checked before use. `;
 const text=Array.from({length:65},(_,i)=>`## Topic ${i}\n${sentence(i).repeat(8)}`).join('\n\n');
 const created=await invoke('POST','/ppt/projects',{inputKind:'paste',text,readOnlyInput:false,template:'light',configId:'byok:test-provider',model:'test-model'});assert.equal(created.status,201);const id=created.body.project.id;
 const accepted=await settle(id);assert.equal(accepted.status,'outline_ready',accepted.error);
 const deckCalls=calls.filter(key=>/:deck:\d+$/u.test(key)),topicCalls=calls.filter(key=>/:topic:\d+$/u.test(key));
 assert.ok(deckCalls.length>=2,'a long source is written in chunks: '+deckCalls.join());
 assert.ok(topicCalls.length>0,'the failed chunk is written topic by topic');
 assert.ok(topicCalls.length<accepted.planningContract.logicalCards.length-1,'only the failed chunk\'s topics are written again');
 assert.equal(accepted.outline.length,19,'a long source at the standard length: 16 cards, cover, one table of contents and closing (the user, 2026-10-31)');
 assert.ok(accepted.outline[1].cardFrame==='divider'&&accepted.outline[1].keyPoints.length>=3&&accepted.outline[1].keyPoints.every(point=>point.navigation),'the table of contents follows the cover');
 assert.equal(accepted.outline.filter(slide=>slide.cardFrame).length,1,'one contents page, no dividers and no takeaway');
 // A short prompt with no source is written from the brief in one call.
 calls.length=0;
 const pure=await invoke('POST','/ppt/projects',{inputKind:'prompt',prompt:'Explain regression models',readOnlyInput:false,template:'light',configId:'byok:test-provider',model:'test-model'});assert.equal(pure.status,201);
 const promptReady=await settle(pure.body.project.id);assert.equal(promptReady.status,'outline_ready',promptReady.error);assert.equal(promptReady.inputUnderstanding.brief,true);
 assert.equal(promptReady.generationPolicy.knowledge,'source_plus_explanation');assert.deepEqual(calls.map(key=>key.split(':').slice(0,2).join(':')+':'+key.split(':').at(-1).replace(/^[0-9a-f]{8,}$/u,'')),['outline:cards:brief','outline:finish:','outline:retitle:','outline:retitle:standard']);
 assert.ok(observedLiveTurns>0,'resolved model calls and assessments must yield while the outline remains live');
 console.log('Card outline API: an advisory source warning before any model call, chunked deck calls with a per-topic fallback for the failed chunk, the 40-page cap, the brief, event-loop fairness: OK');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

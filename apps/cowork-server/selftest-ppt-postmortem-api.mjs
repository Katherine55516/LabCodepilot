import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {Readable} from 'node:stream';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-batched-plan-'));process.env.COWORK_STATE_DIR=dir;
const store=await import('./lib/ppt-store.mjs');const {handlePpt,_internals}=await import('./lib/ppt-api.mjs');
let injectedFailure=2,observedLiveTurns=0;/* fails the group and its one automatic retry */const calls=[];
const deps={..._internals.defaultDeps,modelCall:async(p,prompt)=>{
 setImmediate(()=>{if(store.get(p.uid,p.id)?.status==='outlining')observedLiveTurns++;});
 if(prompt.includes('Navigation Plan Schema=')){const ledger=JSON.parse(prompt.match(/<chapter_ledger>(.*?)<\/chapter_ledger>/su)[1]);return {version:1,groups:[{label:'Evidence topics',memberIndexes:ledger.map(e=>e.index)}]};}
 if(prompt.includes('Navigation Audit Schema='))return {version:1,checks:[{groupIndex:0,faithful:true,reason:'All fixture sections concern evidence topics.'}]};
 const directory=JSON.parse(prompt.match(/<source_directory>(.*?)<\/source_directory>/su)?.[1]||'[]');if(!directory.length){assert.ok(prompt.includes('JSON Schema v2='),'pure prompt must use scoped skeleton protocol');return {version:2,slides:['Regression models','Mechanism','Limitations'].map(title=>({title,focus:'Explain '+title+' and its distinct applicability.',sourceUnitIds:[]}))};}assert.ok(directory.length<=64);const index=Number(prompt.match(/source group (\d+)\//u)?.[1]||0)-1;calls.push(index);
 if(index===0&&injectedFailure>0){injectedFailure--;throw Object.assign(new Error('ppt_transport'),{code:'transport'});}
 return {version:2,slides:[...(index===0?[{title:'Evidence cover',role:'cover',sourceUnitIds:[],focus:'Introduce the evidence'}, {title:'Evidence navigation',role:'navigation',section:'Navigation',sourceUnitIds:[],focus:'Budgeted navigation linked to final slide IDs'}]:[]),...Array.from({length:3},(_,n)=>({title:'Evidence group '+index+' '+n,focus:'Explain the unique conditions for evidence group '+index+' page '+n,section:'Evidence '+index,sourceUnitIds:directory.filter((_,i)=>i%3===n).map(item=>item.id)}))]};
}};
const invoke=async(method,pathname,data)=>{const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;let reply;await handlePpt(req,new URL('http://local'+pathname),{uid:'batch-test',deps,send:(status,body)=>{reply={status,body};return true;},log:()=>{}});return reply;};
async function settle(id){for(let i=0;i<500;i++){const p=store.get('batch-test',id);if(['failed','outline_ready'].includes(p.status))return p;await new Promise(r=>setTimeout(r,10));}throw Error('API did not settle');}
try{
 const modelCallsBefore=calls.length;
 const invalidSource=await invoke('POST','/ppt/projects',{inputKind:'paste',text:'# Portfolio groups\n2\\times3\\times3$ sorts on size, investment and ROE (27 portfolios).',template:'light',configId:'byok:test-provider',model:'test-model'});
 assert.equal(invalidSource.status,422);assert.match(invalidSource.body.error,/18/);assert.match(invalidSource.body.error,/27/);assert.equal(calls.length,modelCallsBefore,'a proven source arithmetic conflict is reported before any outline or page model call');assert.equal(store.list('batch-test').length,0,'the rejected input is not silently saved as a modified project');
 const text=Array.from({length:65},(_,i)=>`## Topic ${i}\nCondition ${i} applies only when evidence ${i} is checked before use.`).join('\n\n');
 const created=await invoke('POST','/ppt/projects',{inputKind:'paste',text,prompt:'Explain evidence and conditions',template:'light',configId:'byok:test-provider',model:'test-model',generationPolicy:{version:1,detail:'balanced',language:{mode:'source'},knowledge:'source_only',content:'full_source'}});assert.equal(created.status,201);const id=created.body.project.id;
 const failed=await settle(id);assert.equal(failed.status,'failed');assert.equal(failed.failure.code,'transport');assert.ok(failed.candidateOutline.candidatePages>=3);assert.equal(failed.candidateOutline.accepted,false);assert.ok(failed.outlineBatches.length>=1);assert.equal(failed.outline.length,0);
 const successfulIndexes=failed.outlineBatches.map(item=>item.index),counts=new Map(successfulIndexes.map(index=>[index,calls.filter(i=>i===index).length]));
 const retry=await invoke('POST',`/ppt/projects/${id}/retry`,{});assert.ok(retry.status<400);const accepted=await settle(id);assert.equal(accepted.status,'outline_ready',accepted.error);assert.equal(accepted.candidateOutline.accepted,true);assert.equal(accepted.planning.contentDistribution.unassignedIds.length,0);
 for(const index of successfulIndexes)assert.equal(calls.filter(i=>i===index).length,counts.get(index),'restart must reuse only matching prompt/model checkpoints');
 const pure=await invoke('POST','/ppt/projects',{inputKind:'prompt',prompt:'Explain regression models',template:'light',configId:'byok:test-provider',model:'test-model'});assert.equal(pure.status,201);const promptReady=await settle(pure.body.project.id);assert.equal(promptReady.status,'outline_ready',JSON.stringify({error:promptReady.error,issues:promptReady.candidateOutline?.issues,profile:promptReady.inputProfile}));
 assert.ok(observedLiveTurns>0,'resolved model calls and capacity assessments must yield while the outline remains live');
 console.log('Production batched outline API: partial failure, safe transport code, candidate retained, hash-scoped retry, event-loop fairness, global ownership and accepted outline passed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

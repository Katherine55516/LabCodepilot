import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';

const state=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-task-record-delete-'));
process.env.COWORK_STATE_DIR=state;
const [store,{handlePpt},{taskEligible,libraryEligible}]=await Promise.all([
 import('./lib/ppt-store.mjs'),import('./lib/ppt-api.mjs'),import('./lib/ppt-library.mjs'),
]);
const uid='task-record-delete',at='2026-10-19T00:00:00Z';
const make=(status='completed')=>({id:store.newId(),uid,title:'Retained presentation',prompt:'Source facts',pages:3,template:'light',inputKind:'prompt',status,stage:status,createdAt:at,updatedAt:at,revision:1,publishedRevision:status==='completed'?1:0,outline:[],nodes:{},source:{text:'Retained source facts'},deck:status==='completed'?{slides:[{id:'s',title:'Original content',nodes:[]}]}:null});
async function request(method,route,account=uid){
 let result;
 const req=Readable.from([]);req.method=method;
 await handlePpt(req,new URL('http://test'+route),{uid:account,activity:()=>{},log:()=>{},deps:{},send:(status,body)=>{result={status,body};return true;}});
 return result;
}
try{
 const completed=make();store.save(completed);const savedAt=store.get(uid,completed.id).updatedAt;
 assert.equal((await request('DELETE',`/ppt/projects/${completed.id}/task-record`,'other-account')).status,404);
 assert.ok(taskEligible(store.get(uid,completed.id)));
 const deleted=await request('DELETE',`/ppt/projects/${completed.id}/task-record`);
 assert.equal(deleted.status,200);assert.equal(deleted.body.project.taskEligible,false);
 const retained=store.get(uid,completed.id);
 assert.ok(!taskEligible(retained)&&libraryEligible(retained));
 assert.deepEqual(retained.deck,completed.deck);assert.deepEqual(retained.source,completed.source);
 assert.equal(retained.publishedRevision,1);assert.equal(retained.updatedAt,savedAt);
 assert.ok((await request('GET','/ppt/projects?view=workspace')).body.projects.some(project=>project.id===completed.id&&project.libraryEligible&&!project.taskEligible));
 for(const status of ['input_ready','outline_ready','failed','paused']){
  const project=make(status);store.save(project);
  assert.equal((await request('DELETE',`/ppt/projects/${project.id}/task-record`)).status,200);
  const after=store.get(uid,project.id);assert.ok(!taskEligible(after));assert.deepEqual(after.source,project.source);
  if(['input_ready','outline_ready'].includes(status))assert.equal(after.status,'cancelled');
 }
 for(const status of ['ingesting','outlining','generating']){
  const project=make(status);store.save(project);
  assert.equal((await request('DELETE',`/ppt/projects/${project.id}/task-record`)).status,409);
  assert.ok(taskEligible(store.get(uid,project.id)));
 }
 console.log('Task record deletion retains published files and sources, protects active tasks and scopes accounts: OK');
}finally{fs.rmSync(state,{recursive:true,force:true});}

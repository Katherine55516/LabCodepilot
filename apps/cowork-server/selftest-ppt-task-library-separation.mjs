import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Readable} from 'node:stream';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-library-separation-'));process.env.COWORK_STATE_DIR=root;
const [store,{handlePpt},{libraryEligible,taskEligible,countsAgainstLibraryQuota}]=await Promise.all([import('./lib/ppt-store.mjs'),import('./lib/ppt-api.mjs'),import('./lib/ppt-library.mjs')]);
const uid='task-library';const at='2026-10-18T12:00:00Z';
const make=(status='completed')=>({id:store.newId(),uid,title:'Retained generation',prompt:'Source',pages:3,template:'light',inputKind:'prompt',status,stage:'completed',createdAt:at,updatedAt:at,revision:1,publishedRevision:status==='completed'?1:0,outline:[],nodes:{},deck:status==='completed'?{slides:[{id:'s',title:'Source',nodes:[]}]}:null});
async function request(method,route,data,as=uid){let result;const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;await handlePpt(req,new URL('http://test'+route),{uid:as,log:()=>{},activity:()=>{},deps:{removeContainer:async()=>{}},send:(status,body)=>{result={status,body};return true;}});return result;}
try{
 const p=make();p.publishedRenderTree={slides:[{id:'published',elements:[{kind:'text',content:{text:'Published cover'}}]}]};p.renderTree={slides:[{id:'draft',elements:[{kind:'text',content:{text:'Unverified draft'}}]}]};store.save(p);
 assert.equal((await request('GET',`/ppt/projects/${p.id}/cover`)).body.slide.id,'published','library uses published scene, never unverified draft');
 assert.equal((await request('GET',`/ppt/projects/${p.id}/cover`,undefined,'other')).status,404);
 assert.ok(libraryEligible(p)&&taskEligible(p),'success retains its generation task');
 assert.equal((await request('GET','/ppt/projects?view=workspace')).body.projects.length,1);
 const hidden=await request('DELETE',`/ppt/projects/${p.id}/task-record`);assert.equal(hidden.status,200);assert.equal(hidden.body.project.taskEligible,false);assert.equal(store.get(uid,p.id).deck.slides.length,1);assert.ok(libraryEligible(store.get(uid,p.id)),'deleting task does not delete file');
 const kept=make();store.save(kept);
 assert.equal((await request('POST',`/ppt/projects/${kept.id}/trash`)).status,200);
 const workspace=(await request('GET','/ppt/projects?view=workspace')).body.projects;
 assert.equal(workspace.find(x=>x.id===kept.id).libraryEligible,false);assert.ok(workspace.find(x=>x.id===kept.id).taskEligible,'file trash keeps generation record');
 assert.equal((await request('DELETE',`/ppt/projects/${kept.id}/permanent`)).status,200);
 const record=store.get(uid,kept.id);assert.ok(record.taskRecordOnly&&record.presentationDeletedPermanentlyAt);assert.equal(record.deck,null);assert.ok(taskEligible(record));assert.equal((await request('GET',`/ppt/projects/${kept.id}?view=live`)).status,404,'deleted PPT cannot be reopened from task history');
 assert.equal((await request('DELETE',`/ppt/projects/${kept.id}/task-record`)).status,200,'history can be deleted independently after permanent file deletion');
 const running=make('generating');store.save(running);assert.equal((await request('DELETE',`/ppt/projects/${running.id}/task-record`)).status,409,'active task cannot be hidden while it executes');
 assert.equal((await request('DELETE',`/ppt/projects/${p.id}/task-record`,undefined,'other')).status,404);
 for(const status of ['input_ready','outline_ready']){const waiting=make(status);waiting.source={text:'Retained source checkpoint',segments:[]};store.save(waiting);assert.ok(countsAgainstLibraryQuota(waiting));assert.equal((await request('DELETE',`/ppt/projects/${waiting.id}/task-record`)).status,200);const hidden=store.get(uid,waiting.id);assert.equal(hidden.status,'cancelled');assert.equal(hidden.source.text,'Retained source checkpoint');assert.ok(!countsAgainstLibraryQuota(hidden),'deleting a waiting unpublished task releases its reservation');}
 const quotaUid='quota';
 for(let i=0;i<60;i++)store.save({...make('failed'),uid:quotaUid});
 for(let i=0;i<50;i++)store.save({...make(i===49?'outlining':'completed'),uid:quotaUid});
 assert.throws(()=>store.save({...make('generating'),uid:quotaUid}),e=>e.code==='ppt_library_capacity'&&e.statusCode===409,'50 files/reservations prevent a 51st');
 const failed=store.list(quotaUid).find(x=>x.status==='failed');assert.ok(!countsAgainstLibraryQuota(failed));
 assert.throws(()=>store.save({...failed,status:'generating'}),/library limit/,'resume/retry reacquires released reservation');
 const release=store.list(quotaUid).find(x=>x.status==='outlining');release.status='failed';store.save(release);
 store.save({...failed,status:'generating'});assert.equal(store.list(quotaUid).filter(countsAgainstLibraryQuota).length,50,'failed task releases exactly one reservation');
 console.log('Task/file projections, independent deletion/history and atomic service-process quota reservations: OK');
}finally{fs.rmSync(root,{recursive:true,force:true});}

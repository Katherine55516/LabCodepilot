import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-version-summaries-'));process.env.COWORK_STATE_DIR=dir;
const store=await import('./lib/ppt-store.mjs');const {handlePpt}=await import('./lib/ppt-api.mjs');
const uid='version-summaries';
const request=async(method,route,data)=>{let reply;const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;await handlePpt(req,new URL('http://local/ppt/'+route),{uid,activity:()=>{},send:(status,body)=>{reply={status,body};return true;}});return reply;};
try{
 const made=await request('POST','projects',{inputKind:'prompt',prompt:'Explain the research process.',template:'light',configId:'fixture'});
 assert.equal(made.status,201,JSON.stringify(made.body));const root=store.get(uid,made.body.project.id);
 const child={...structuredClone(root),id:store.newId(),title:'Second version',version:{rootId:root.id,parentId:root.id,number:2}};store.save(child);
 const deleted={...structuredClone(child),id:store.newId(),deletedAt:new Date().toISOString(),version:{...child.version,number:3}};store.save(deleted);
 const unrelated=Array.from({length:5},()=>({...structuredClone(root),id:store.newId(),title:'Other project'}));for(const p of unrelated)store.save(p);
 // Warm the persistent summary projection, then prohibit unrelated full
 // snapshots. A version-family read needs metadata, never other decks/media.
 store.listProjected(uid,'task-summary-v1',()=>{throw Error('registered projector expected');});
 const read=fs.readFileSync;let blocked=0;
 try{
  fs.readFileSync=(file,...args)=>{if(unrelated.some(p=>new RegExp('/'+p.id+'\\.json(?:\\.gz)?$').test(String(file)))){blocked++;throw Error('version lookup read an unrelated full deck');}return read(file,...args);};
  const result=await request('GET',`projects/${root.id}/versions`);
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(blocked,0);
  assert.deepEqual(result.body.versions.map(p=>[p.id,p.number]),[[root.id,1],[child.id,2]]);
 }finally{fs.readFileSync=read;}
 child.title='Updated second version';store.save(child);
 const result=await request('GET',`projects/${root.id}/versions`);assert.equal(result.body.versions[1].title,child.title,'saving invalidates the summary');
 console.log('PASS version families: summary-only lookup, no unrelated deck reads, deleted filtering and save invalidation');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

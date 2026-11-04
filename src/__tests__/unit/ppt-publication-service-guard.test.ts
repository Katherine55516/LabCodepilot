import {it} from 'node:test';
import assert from 'node:assert/strict';
it('service stop protects active editor publication even when the previous revision is completed',async()=>{const {assertPptServiceIdle}=await import(process.cwd()+'/scripts/ppt/ppt-service-guard.mjs');for(const phase of ['reviewing','publishing'])assert.throws(()=>assertPptServiceIdle([{id:'p',status:'completed',runtime:{publication:{phase,pid:42}}}],{servicePid:42}),/活动任务/);for(const phase of ['published','blocked','failed'])assert.doesNotThrow(()=>assertPptServiceIdle([{id:'p',status:'completed',runtime:{publication:{phase,pid:42}}}],{servicePid:42}));assert.doesNotThrow(()=>assertPptServiceIdle([{id:'p',status:'completed',runtime:{publication:{phase:'reviewing',pid:41}}}],{servicePid:42}));});
it('publication records an active lease, rejects duplicates and cleans up failure without reverting newer edits',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-publish-lease-')),prior=process.env.COWORK_STATE_DIR;process.env.COWORK_STATE_DIR=dir;
 try{
  const {getProject,saveProject}=await import(process.cwd()+'/apps/cowork-server/lib/ppt/repository.mjs');
  const {publishProject}=await import(process.cwd()+'/apps/cowork-server/lib/ppt/publish-service.mjs');
  const uid='publish-lease-test',id='a'.repeat(32),now=new Date().toISOString();
  saveProject({uid,id,status:'completed',revision:1,createdAt:now,updatedAt:now,template:'light',pages:1,prompt:'A short topic.',generationPolicy:{content:'overview',details:'notes',knowledge:'source_only'},outline:[{id:'s',title:'A short topic.',sourceUnitIds:[]}],deck:{slides:[{id:'s',title:'A short topic.',layoutId:'summary',nodes:[]}]},runtime:{}});
  let rejectCall:(reason:Error)=>void=()=>{},started:()=>void=()=>{};const ready=new Promise<void>(r=>started=r);
  const first=publishProject(uid,id,{modelCall:async()=>{started();return new Promise((_resolve,reject)=>{rejectCall=reject;});}},()=>{},()=>{});
  await ready;assert.equal(getProject(uid,id).runtime.publication.phase,'reviewing');
  await assert.rejects(publishProject(uid,id,{},()=>{},()=>{}),/already in progress/);
  const changed=getProject(uid,id);changed.revision=2;changed.deck.slides[0].title='Newer user title';saveProject(changed);
  rejectCall(Error('test network interruption'));await assert.rejects(first,/network interruption/);
  const final=getProject(uid,id);assert.equal(final.runtime.publication.phase,'failed');assert.equal(final.revision,2);assert.equal(final.deck.slides[0].title,'Newer user title');assert.ok(final.runtime.publication.completedAt);
 }finally{if(prior===undefined)delete process.env.COWORK_STATE_DIR;else process.env.COWORK_STATE_DIR=prior;fs.rmSync(dir,{recursive:true,force:true});}
});

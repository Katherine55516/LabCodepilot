import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-live-cache-'));process.env.COWORK_STATE_DIR=directory;
const {currentSlidePreview,taskSummary,generationStages,liveProjectView}=await import('./lib/ppt/project-view.mjs');
const {withVerifiedWorkingDeck}=await import('./lib/ppt/working-deck.mjs');
const preview={id:'s',elements:[]},p={id:'p',uid:'u',status:'generating',pages:1,revision:0,currentRunId:'new',source:{sha256:'source'},outline:[{id:'s'}],nodes:{},editing:{epochs:{s:0}},runtime:{slides:{s:{epoch:0,phase:'render_ready',preview}}}};
assert.equal(currentSlidePreview(p,'s'),null);assert.equal(taskSummary(p).progress.previewReady,0);assert.equal(generationStages(p).pages.s,'waiting');
p.nodes.s={status:'done',slide:{id:'s'}};assert.equal(currentSlidePreview(p,'s'),preview);assert.equal(taskSummary(p).progress.previewReady,1);
p.editing.epochs.s=1;assert.equal(currentSlidePreview(p,'s'),null);p.runtime.slides.s.epoch=1;assert.equal(currentSlidePreview(p,'s'),preview);
p.nodes={};p.runtime.slides.s={phase:'writing',epoch:1,preview,renderHash:'scene',componentCommit:{runId:'new',sourceHash:'source',baseRevision:0,renderHash:'scene'}};
assert.equal(currentSlidePreview(p,'s'),preview);assert.equal(taskSummary(p).progress.previewReady,0);
for(const patch of [{currentRunId:'old'},{revision:1},{source:{sha256:'other'}},{editing:{epochs:{s:2}}}])assert.equal(currentSlidePreview({...p,...patch},'s'),null);
console.log('PASS: stale previews never count or replace skeletons; real current-epoch page and validated source-component previews remain visible; late run/revision/source/epoch changes reject old scenes.');
const failed={...p,status:'failed',stage:'generation',deck:null,outline:[{id:'s',title:'Verified'},{id:'pending',title:'Pending'}],nodes:{s:{status:'done',slide:{id:'s'}}},editing:{epochs:{s:0}},runtime:{slides:{s:{phase:'render_ready',epoch:0,quality:{issues:[]},preview:{id:'s',slideId:'s',elements:[{id:'t',kind:'text',content:{text:'Verified'}}]},canonicalSlide:{id:'s',title:'Verified',nodes:[{id:'t',type:'text',semanticRole:'title',content:{text:'Verified'}}]}}}}};
const working=withVerifiedWorkingDeck(failed);assert.equal(working.deck.slides.length,2);assert.equal(failed.deck,null,'a read projection cannot persist or publish');const live=liveProjectView(working);assert.equal(live.renderTree.slides.length,2);assert.equal(live.renderTree.slides[0].elements.length,1);assert.equal(live.renderTree.slides[1].elements.length,0);assert.equal(live.runtime.slides.s.canonicalSlide,undefined,'lean runtime must not transmit duplicated native objects/media');
assert.equal(withVerifiedWorkingDeck({...failed,stage:'outline'}).deck,null);assert.equal(withVerifiedWorkingDeck({...failed,editing:{epochs:{s:1}}}).deck,null);

{
 const store=await import('./lib/ppt-store.mjs'),{handlePpt}=await import('./lib/ppt-api.mjs'),{updateDraft,clearDraft}=await import('./lib/ppt/draft-store.mjs'),{Readable}=await import('node:stream');
 const id='c'.repeat(32),uid='cached-live',project={...failed,id,uid,title:'Verified cached deck',status:'generating',currentRunId:'run_cached',source:{sha256:'source'},nodes:{...failed.nodes,pending:{status:'running'}}};
 const read=async()=>{let reply;const req=Readable.from([]);req.method='GET';await handlePpt(req,new URL('http://local/ppt/projects/'+id+'?view=live'),{uid,send:(status,body)=>{reply={status,body};return true;}});return reply;};
 try{
  store.save(project);const first=await read();assert.equal(first.status,200);assert.equal(first.body.project.renderTree.slides[0].elements.length,1);
  updateDraft(project,'pending',{text:'{"title":"Actual new draft","blocks":[{"id":"point","body":"New content"}',chars:90,seq:1,jobId:'job'});
  const second=await read();assert.equal(second.body.project.drafts.pending.title,'Actual new draft','transient progress stays fresh while the durable snapshot is cached');
  project.editing.epochs.pending=1;store.save(project);const edited=await read();assert.equal(edited.body.project.drafts.pending,undefined,'an epoch edit rejects the previous transient draft');
  const svg=async slideId=>{let status,body,headers;const req=Readable.from([]);req.method='GET';const res={writeHead:(s,h)=>{status=s;headers=h;},end:value=>{body=value;}};await handlePpt(req,new URL('http://local/ppt/projects/'+id+'/slides/'+slideId+'/preview?format=svg'),{uid,res,send:(s,b)=>{status=s;body=b;return true;}});return {status,body,headers};};
  const current=await svg('pending');assert.equal(current.status,200,'resume current-page image requests cannot race into a missing-preview response');assert.match(current.headers['content-type'],/image\/svg/);assert.ok(current.body.includes('Pending'));assert.ok(!current.body.includes('Unrelated old report'));
  assert.equal((await svg('unknown')).status,404,'unknown pages remain genuinely absent');
  store.remove(uid,id);assert.equal((await read()).status,404,'deletion invalidates the live snapshot');
  console.log('PASS cached live API: verified scene retained, transient progress stays current, epoch edits/deletion invalidate snapshots');
 }finally{clearDraft(id,'pending');fs.rmSync(directory,{recursive:true,force:true});}
}

const {buildPendingSlidePreview}=await import('./lib/ppt/generation-skeleton.mjs');
const pendingProject={id:'pending',status:'generating',revision:2,outline:[{id:'done',title:'Done'},{id:'writing',title:'Current source topic'},{id:'future',title:'Future'}],nodes:{done:{status:'done'},writing:{status:'pending'}},templateSpec:{palette:{background:'#ffffff',foreground:'#222222'},fonts:{title:'Arial'}}};
const pendingBefore=JSON.stringify(pendingProject),pendingPreview=buildPendingSlidePreview(pendingProject,'writing');assert.ok(pendingPreview?.draft);assert.equal(pendingPreview.elements[0].content.text,'Current source topic');assert.equal(buildPendingSlidePreview(pendingProject,'future'),null);assert.equal(buildPendingSlidePreview(pendingProject,'missing'),null);assert.equal(buildPendingSlidePreview({...pendingProject,status:'completed'},'writing'),null);assert.equal(JSON.stringify(pendingProject),pendingBefore,'resume preview fallback cannot become committed or published state');

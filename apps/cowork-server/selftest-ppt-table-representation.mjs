// A source table shown as cards switches to the original table and back
// (Fable plan T5) as an undoable command (integration plan step 5, from the
// representation contract of codex/ppt-gamma-factor-zoo-20261020): the choice
// is recorded with its version, undo puts back the exact page, redo applies it
// again, and each change moves the page's generation epoch so a late writer
// result for that page is ignored. A locked table is not switched.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPptHttpHarness}from'./test/ppt-http-harness.mjs';import{pipelineModelFixture,PIPELINE_SOURCE}from'./test/ppt-pipeline-model-fixture.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-table-form-'));const h=await createPptHttpHarness({root,modelCall:pipelineModelFixture()});
try{
 const made=await h.request('POST','projects',{inputKind:'prompt',prompt:PIPELINE_SOURCE,readOnlyInput:true,template:'light',configId:'simulation-only',model:'controlled-model',generationPolicy:{version:2,detail:'standard',selection:'editorial',archive:'none',content:'overview',language:{mode:'source',body:'both'},knowledge:'source_only'}});
 const id=made.body.project.id;let p=await h.settle(id,['input_ready','failed']);assert.equal(p.status,'input_ready',p.error);
 assert.equal((await h.request('POST',`projects/${id}/planning`,{command:'outline',length:{exact:6},contentMode:'standard'})).status,202);
 p=await h.settle(id,['outline_ready','failed']);assert.equal(p.status,'outline_ready',p.error);
 assert.equal((await h.request('POST',`projects/${id}/generate`,{})).status,202);p=await h.settle(id,['completed','failed','quality_blocked']);assert.equal(p.status,'completed',p.error);
 const index=p.deck.slides.findIndex(slide=>(slide.sourceArtifactNodes||[]).some(node=>node.sourceArtifact&&p.source.semantic.inventory.items.find(item=>item.id===node.sourceArtifact.sourceUnitId)?.type==='TableBlock'));
 assert.ok(index>0,'a source table is on a page');
 const slideId=p.deck.slides[index].id,table=p.deck.slides[index].sourceArtifactNodes.find(node=>node.sourceArtifact).sourceArtifact,sourceUnitId=table.sourceUnitId;
 const shown=table.tableRepresentation==='table'?'table':'diagram',other=shown==='table'?'diagram':'table';
 const page=q=>q.deck.slides.find(slide=>slide.id===slideId),form=q=>page(q).sourceArtifactNodes.find(node=>node.sourceArtifact?.sourceUnitId===sourceUnitId).sourceArtifact,epoch=q=>Number(q.editing?.epochs?.[slideId]||0);
 const before=structuredClone(page(p)),epoch0=epoch(p);
 // Switch: the choice is recorded with its version and the page epoch moves.
 let r=await h.request('POST',`projects/${id}/table-representation`,{slideId,sourceUnitId,representation:other,baseRevision:p.revision});assert.equal(r.status,200,JSON.stringify(r.body).slice(0,300));
 p=h.store.get(h.uid,id);assert.equal(form(p).tableRepresentation,other);assert.equal(form(p).representationVersion,1);assert.equal(form(p).representationBasis,'user');assert.ok(epoch(p)>epoch0,'the page epoch moves');
 assert.notDeepEqual(page(p).sourceArtifactNodes,before.sourceArtifactNodes,'the page is rebound');
 // Undo puts back the exact page; redo applies the choice again.
 r=await h.request('POST',`projects/${id}/undo`,{});assert.equal(r.status,200,JSON.stringify(r.body).slice(0,300));p=h.store.get(h.uid,id);
 assert.deepEqual(page(p).sourceArtifactNodes,before.sourceArtifactNodes,'undo restores the page snapshot');const epoch1=epoch(p);
 r=await h.request('POST',`projects/${id}/redo`,{});assert.equal(r.status,200,JSON.stringify(r.body).slice(0,300));p=h.store.get(h.uid,id);
 assert.equal(form(p).tableRepresentation,other,'redo applies the choice again');assert.ok(epoch(p)>epoch1);
 // The snapshot command is not public, and a stale base or a locked table is refused.
 assert.equal((await h.request('POST',`projects/${id}/commands`,{type:'slide.restoreRepresentation',baseRevision:p.revision,payload:{slideId,slide:before}})).status,400);
 assert.equal((await h.request('POST',`projects/${id}/table-representation`,{slideId,sourceUnitId,representation:shown,baseRevision:p.revision-1})).status,409);
 assert.equal((await h.request('POST',`projects/${id}/table-representation`,{slideId,sourceUnitId:'not-on-this-page',representation:shown,baseRevision:p.revision})).status,400,'a source table not on the page is refused');
 const locked=structuredClone(p);for(const node of page(locked).sourceArtifactNodes)if(node.sourceArtifact?.sourceUnitId===sourceUnitId)node.locked=true;h.store.save(locked);
 assert.equal((await h.request('POST',`projects/${id}/table-representation`,{slideId,sourceUnitId,representation:shown,baseRevision:locked.revision})).status,409,'a locked table keeps its form');
 console.log('PASS table form switch: versioned choice, undo restores the page snapshot, redo reapplies, page epoch moves, snapshot command internal, stale, wrong source and locked refused');
}finally{await h.close();fs.rmSync(root,{recursive:true,force:true});}
process.exit(0);

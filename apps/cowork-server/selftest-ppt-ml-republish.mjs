/** Re-publish a retained accepted project through production HTTP after a
 * renderer upgrade. Source, approved selection, geometry and N stay frozen. */
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';
import{createPptHttpHarness}from'./test/ppt-http-harness.mjs';import{mlModelFixture}from'./test/ppt-ml-model-fixture.mjs';import{assertMlEditorial}from'./test/ppt-ml-acceptance.mjs';import{publishedPdfIdentity}from'./lib/ppt-export-integrity.mjs';import{RENDER_CONTRACT_VERSION}from'./lib/ppt/render-contract.mjs';
const directory=process.env.PPT_ML_PUBLISH_ROOT,id=process.env.PPT_ML_PUBLISH_ID;
if(!directory||!id){console.log('SKIP retained publish: PPT_ML_PUBLISH_ROOT and PPT_ML_PUBLISH_ID required');process.exit(0);}
const root=path.resolve(directory),out=path.resolve(process.env.PPT_ML_PUBLISH_OUTPUT||path.join(root,'renderer-upgrade'));fs.mkdirSync(out,{recursive:true});
for(const name of ['http-requests.json','model-calls.json'])if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(out,name+'.before-upgrade'));
const h=await createPptHttpHarness({root,modelCall:mlModelFixture()});
try{
 const response=await h.request('GET',`projects/${id}`);assert.equal(response.status,200);const before=response.body.project;assert.equal(before.status,'completed');
 const publication=await h.request('POST',`projects/${id}/publish`,{});assert.equal(publication.status,200,JSON.stringify(publication.body));
 const after=await h.settle(id,['completed','quality_blocked','failed'],900000);assert.equal(after.status,'completed',after.error);assert.equal(after.publishedRevision,after.revision);assert.equal(after.quality.exportVerification.renderContractVersion,RENDER_CONTRACT_VERSION);assert.equal(after.quality.exportable,true);
 assert.equal(after.source.sha256,before.source.sha256);assert.equal(after.contentSelection.hash,before.contentSelection.hash);assert.equal(after.pages,before.pages);const physical=p=>p.deck.slides.map(({id,title,section,nodes,nodeOrder})=>({id,title,section,nodes,nodeOrder}));assert.deepEqual(physical(after),physical(before),'renderer upgrade must not edit approved source objects, fonts or geometry; legacy blocks are a derived view cache');
 const editorial=assertMlEditorial(after,after.pages);
 for(const [action,ext]of [['export','pptx'],['pdf','pdf']]){const file=await h.request('GET',`projects/${id}/${action}`);assert.equal(file.status,200);fs.writeFileSync(path.join(out,`ML-Quant-Mood-Board-${after.pages}p-Final.${ext}`),file.body);}
 const pdfProject=h.store.get(h.uid,id);assert.equal(pdfProject.pdfSourceIdentity,publishedPdfIdentity(pdfProject));assert.ok(pdfProject.pdfArtifactPath.includes(pdfProject.pdfSourceIdentity.slice(0,20)));if(!before.pdfSourceIdentity)assert.notEqual(pdfProject.pdfArtifactPath,before.pdfArtifactPath,'legacy revision-only PDF cache must be replaced');fs.writeFileSync(path.join(out,'final-project.json'),JSON.stringify(pdfProject));fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify({projectId:id,editorial,renderContractVersion:RENDER_CONTRACT_VERSION,revision:after.revision,publishedRevision:after.publishedRevision,source:after.source.sha256,selection:after.contentSelection.hash,deckUnchanged:true,pdfSourceIdentity:pdfProject.pdfSourceIdentity,pdfArtifactPath:pdfProject.pdfArtifactPath,boundary:'actual production publication and PPTX/PDF; model calls simulated'},null,2));
 console.log('PASS retained accepted project → renderer upgrade → production re-publication → native PPTX/PDF; source/selection/N/deck unchanged.');
}finally{await h.close();}

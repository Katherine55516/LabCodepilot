/** Resume an isolated retained engineering project through the real retry API.
 * Never edits the saved project, source, selection, page count or gate result. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createPptHttpHarness}from'./test/ppt-http-harness.mjs';import{mlModelFixture}from'./test/ppt-ml-model-fixture.mjs';import{assertMlEditorial}from'./test/ppt-ml-acceptance.mjs';
const directory=process.env.PPT_ML_RESUME_ROOT;if(!directory){console.log('SKIP retained ML retry: PPT_ML_RESUME_ROOT required');process.exit(0);}
const root=path.resolve(directory),snapshot=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'));
for(const file of ['http-requests.json','model-calls.json','project.json'])if(fs.existsSync(path.join(root,file))&&!fs.existsSync(path.join(root,file+'.before-retry')))fs.copyFileSync(path.join(root,file),path.join(root,file+'.before-retry'));
const h=await createPptHttpHarness({root,modelCall:mlModelFixture()});
try{
 const before=h.store.get(h.uid,snapshot.id);assert.ok(before);assert.ok(['quality_blocked','failed'].includes(before.status),before.status);
 const response=await h.request('POST',`projects/${before.id}/retry`,{repairSourceSummaries:false});assert.equal(response.status,202,JSON.stringify(response.body));
 const final=await h.settle(before.id,['completed','quality_blocked','failed'],900000);fs.writeFileSync(path.join(root,'retried-project.json'),JSON.stringify(final));
 assert.equal(final.status,'completed',JSON.stringify({error:final.error,hard:final.quality?.deterministic?.issues?.filter(i=>i.severity==='error')}));assert.equal(final.source.sha256,before.source.sha256);assert.equal(final.contentSelection.hash,before.contentSelection.hash);assert.equal(final.pages,before.pages);
 const editorial=assertMlEditorial(final,before.pages);
 const exported=await h.request('GET',`projects/${final.id}/export`);assert.equal(exported.status,200,JSON.stringify(exported.body));fs.writeFileSync(path.join(root,`ML-Quant-Mood-Board-${final.pages}p-Final.pptx`),exported.body);
 const pdf=await h.request('GET',`projects/${final.id}/pdf`);assert.equal(pdf.status,200,JSON.stringify(pdf.body));fs.writeFileSync(path.join(root,`ML-Quant-Mood-Board-${final.pages}p-Final.pdf`),pdf.body);
 fs.writeFileSync(path.join(root,'retry-acceptance.json'),JSON.stringify({id:final.id,editorial,exportBytes:exported.body.length,axes:final.quality.acceptanceAxes,export:final.quality.exportVerification,boundary:'same retained real project and production API; modelCall simulated',preserved:{source:final.source.sha256,selection:final.contentSelection.hash,pages:final.pages}},null,2));console.log('PASS retained production retry, immutable source/selection/N, independent editorial assertions, native PPTX/PDF export.');
}finally{await h.close();}

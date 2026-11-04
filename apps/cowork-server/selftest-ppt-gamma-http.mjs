import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createPptHttpHarness}from'./test/ppt-http-harness.mjs';import{gammaModelFixture}from'./test/ppt-gamma-model-fixture.mjs';
const sourcePath=process.env.PPT_GAMMA_INPUT||'/Users/dongli/Documents/ChatGPT/CodePilot/gamma.md';
if(!fs.existsSync(sourcePath)){console.log('Gamma input unavailable (set PPT_GAMMA_INPUT); optional replay skipped.');process.exit(0);}
const root=path.resolve(process.env.PPT_GAMMA_OUTPUT||'outputs/ppt-fixture-implementation-20261019/gamma-http');
import {cardModel} from './ppt-scope-test-helpers.mjs';
// Card outline (2026-10-23): the deck/finish/writer doubles first, the Gamma fixture for the rest.
const h=await createPptHttpHarness({root,modelCall:cardModel(gammaModelFixture())});
try{const made=await h.request('POST','projects',{inputKind:'prompt',prompt:fs.readFileSync(sourcePath,'utf8'),readOnlyInput:true,template:'light',configId:'simulation-only',model:'controlled-gamma-model',generationPolicy:{version:2,detail:'standard',selection:'editorial',archive:'none',content:'overview',sourceTypography:'bounded',language:{mode:'source',body:'both'},knowledge:'source_only',code:{presentation:'omit'}}});assert.equal(made.status,201,JSON.stringify(made.body));const id=made.body.project.id;
 let p=await h.settle(id,['input_ready','failed']);fs.writeFileSync(root+'/read.json',JSON.stringify(p,null,2));assert.equal(p.status,'input_ready',p.error);
 assert.equal(p.outline.length,0);assert.equal((await h.request('POST',`projects/${id}/planning`,{command:'outline',length:{preset:'standard'}})).status,202);
 p=await h.settle(id,['outline_ready','failed']);fs.writeFileSync(root+'/outline.json',JSON.stringify(p,null,2));assert.equal(p.status,'outline_ready',JSON.stringify({error:p.error,failure:p.failure}));
 {const confirmed=await h.request('PATCH',`projects/${id}/outline`,{slides:p.outline,finalPageCount:p.outline.length});assert.equal(confirmed.status,200,JSON.stringify(confirmed.body).slice(0,400));}
 const start=await h.request('POST',`projects/${id}/generate`,{});fs.writeFileSync(root+'/generate-response.json',JSON.stringify(start,null,2));assert.equal(start.status,202,JSON.stringify(start.body));
 p=await h.settle(id,['completed','failed','quality_blocked'],300000);fs.writeFileSync(root+'/project.json',JSON.stringify(p,null,2));assert.equal(p.status,'completed',JSON.stringify({error:p.error,failure:p.failure,issues:p.quality?.deterministic?.issues?.filter(i=>i.severity==='error')}));
 const file=await h.request('GET',`projects/${id}/export`);assert.equal(file.status,200);fs.writeFileSync(root+'/Gamma-Architecture-Simulated.pptx',file.body);console.log(JSON.stringify({status:p.status,id,pages:p.pages,sourceItems:p.originalSourceInventory?.items.length,bytes:file.body.length,basis:'real business pipeline; modelCall simulated'}));
}finally{await h.close();}

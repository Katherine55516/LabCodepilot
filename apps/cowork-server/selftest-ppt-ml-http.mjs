import {assertMlEditorial} from './test/ppt-ml-acceptance.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {createPptHttpHarness} from './test/ppt-http-harness.mjs';import {mlModelFixture} from './test/ppt-ml-model-fixture.mjs';
const input=process.env.PPT_ML_INPUT,template=process.env.PPT_ML_TEMPLATE;
if(!input||!template){console.log('SKIP full ML HTTP: provide PPT_ML_INPUT and PPT_ML_TEMPLATE (user artifacts, not bundled fixtures).');process.exit(0);}
const output=process.env.PPT_ML_OUTPUT,root=output?path.resolve(output):fs.mkdtempSync(path.join(os.tmpdir(),'ppt-ml-http-')),results=[];
function expectGraph(project,id){const item=project.source.semantic.inventory.items.find(i=>i.id===id);assert.equal(item?.diagramSource?.kind,'prose','approved graph must survive compilation and materialization: '+id);}
const bytes=fs.readFileSync(template),text=fs.readFileSync(input,'utf8');
try {for(const pages of (process.env.PPT_ML_BUDGETS||'24,18,19').split(',').map(Number)) {
 const dir=path.join(root,String(pages)),h=await createPptHttpHarness({root:dir,modelCall:mlModelFixture()});
 try {
  const upload=await h.request('POST','templates',{fileName:path.basename(template),fileBase64:bytes.toString('base64')});assert.ok([200,201].includes(upload.status),JSON.stringify(upload.body));
  const made=await h.request('POST','projects',{inputKind:'prompt',prompt:text,readOnlyInput:true,template:upload.body.template.id,templateContentMode:'design_only',configId:'simulation-only',model:'controlled-ml',generationPolicy:{version:2,content:'overview',detail:'standard',selection:'editorial',archive:'none',sourceTypography:'bounded',language:{mode:'source',body:'primary'},knowledge:'source_only',code:{presentation:'omit'}}});assert.equal(made.status,201,JSON.stringify(made.body));const id=made.body.project.id;
  let p=await h.settle(id,['input_ready','failed'],300000);fs.writeFileSync(path.join(dir,'read.json'),JSON.stringify(p,null,2));assert.equal(p.status,'input_ready',p.error);assert.equal(p.inputUnderstanding.recommended,18);assert.equal(p.inputUnderstanding.readManifest.inputCharacters,p.source.text.length);assert.equal(p.source.text.trim(),text.trim());
  assert.equal((await h.request('POST',`projects/${id}/outline`,{pages,pageSource:'user',generationPolicy:p.generationPolicy})).status,202);p=await h.settle(id,['outline_ready','failed'],300000);fs.writeFileSync(path.join(dir,'outline.json'),JSON.stringify(p,null,2));assert.equal(p.status,'outline_ready',JSON.stringify({error:p.error,failure:p.failure,capacity:p.outlineCapacityDiagnostic}));assert.equal(p.outline.length,pages);assert.equal(p.planning.editorialBlueprint.total,pages);assert.equal(p.inputUnderstanding.recommended,18);
  if(pages===19){
   // Deliberately overpacked compact outline: the UI must stop before writer
   // calls, retaining the unique reader recommendation and the user's N.
   assert.ok(p.outlineCorrections.warnings.some(w=>w.blocking&&w.code==='planned_frozen_source_capacity'));
   const blocked=await h.request('POST',`projects/${id}/generate`,{});assert.equal(blocked.status,409,JSON.stringify(blocked.body));
   fs.writeFileSync(path.join(dir,'expected-capacity-block.json'),JSON.stringify(blocked.body,null,2));
   const kept=h.store.get(h.uid,id);assert.equal(kept.pages,19);assert.equal(kept.inputUnderstanding.recommended,18);assert.equal(h.calls.filter(c=>c.nodeKey?.startsWith('content:')).length,0);
   results.push({projectId:id,pages,readerRecommendation:18,status:'expected_capacity_block',basis:'deliberately overpacked semantic merge; not a claim that every 19-page plan is infeasible',blockedPages:blocked.body.issues.map(i=>i.pageIndex+1)});continue;
  }
  assert.ok(!p.outlineCorrections.warnings.some(w=>w.blocking),'successful native source binding must not leave a contradictory generic capacity veto');
  for(const unit of ['b_0070','b_0213','b_0219','b_0243'])expectGraph(p,unit);
  if(process.env.PPT_ML_OUTLINE_ONLY==='1'){results.push({pages,readerRecommendation:18,status:'outline_accepted'});continue;}
  const generating=await h.request('POST',`projects/${id}/generate`,{});assert.equal(generating.status,202,JSON.stringify(generating.body));p=await h.settle(id,['completed','failed','quality_blocked'],900000);fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(p,null,2));assert.equal(p.status,'completed',JSON.stringify({error:p.error,issues:p.quality?.deterministic?.issues}));
  const editorial=assertMlEditorial(p,pages);
  const exported=await h.request('GET',`projects/${id}/export`);assert.equal(exported.status,200,JSON.stringify(exported.body));fs.writeFileSync(path.join(dir,`ML-Quant-Mood-Board-${pages}p.pptx`),exported.body);
  results.push({editorial,projectId:id,pages,readerRecommendation:p.inputUnderstanding.recommended,outline:p.outline.length,deck:p.deck.slides.length,render:p.renderTree.slides.length,exportBytes:exported.body.length,sourceHash:crypto.createHash('sha256').update(text).digest('hex'),templateHash:crypto.createHash('sha256').update(bytes).digest('hex'),quality:p.quality.acceptanceAxes});
 }finally{await h.close();}
 }
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({boundary:'modelCall simulated; real HTTP/source/template/native export and publication gates; not real LLM quality',results},null,2));console.log(JSON.stringify(results));
}finally{if(!output)fs.rmSync(root,{recursive:true,force:true});}

// Plan ppt-pipeline-unblocked phase 3, carried onto the card deck (option D
// mainline, 2026-10-26), through production HTTP handlers. A card deck is
// written without a model review (D3) and every generation call is recorded by
// stage family. The AI check the author runs lists a model-judged finding as a
// review advisory the editor shows; it never blocks publication. (The critic
// rewrite rounds and their call budget were removed with option D, T1.)
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPptHttpHarness}from'./test/ppt-http-harness.mjs';import{pipelineModelFixture,PIPELINE_SOURCE}from'./test/ppt-pipeline-model-fixture.mjs';
import {scopeReview} from './ppt-scope-test-helpers.mjs';

const UNSUPPORTED='"Adopted by every fund" is not stated in the source.';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-judged-review-'));
const policy={version:2,detail:'standard',selection:'editorial',archive:'none',content:'overview',language:{mode:'source',body:'both'},knowledge:'source_only'};
const cards=pipelineModelFixture(),reviewed=[];
// The deck reviewer flags the second content page; the confirmation keeps it.
const model=async(p,prompt,activity,log,meta={})=>{
 const key=meta.nodeKey||'';
 if(key.includes(':findings_confirmation')){const packet=JSON.parse(prompt.match(/<finding_confirmation_packet>(.*?)<\/finding_confirmation_packet>/su)[1]);
  return {version:1,checks:packet.findings.map(f=>({findingId:f.id,status:'confirmed',reason:'Controlled double: the claim is absent from the source.',visibleEvidence:[]}))};}
 if(key.startsWith('review:')){reviewed.push(key);return scopeReview(p,{unsupported:[{slideIds:[p.deck.slides[2].id],detail:UNSUPPORTED}]});}
 return cards(p,prompt,activity,log,meta);
};

const h=await createPptHttpHarness({root,modelCall:model});
try{
 const made=await h.request('POST','projects',{inputKind:'prompt',prompt:PIPELINE_SOURCE,readOnlyInput:true,template:'light',configId:'simulation-only',model:'controlled-model',generationPolicy:policy});assert.equal(made.status,201,JSON.stringify(made.body));const id=made.body.project.id;
 let p=await h.settle(id,['input_ready','failed']);assert.equal(p.status,'input_ready',p.error);
 assert.equal((await h.request('POST',`projects/${id}/planning`,{command:'outline',length:{exact:6},contentMode:'standard'})).status,202);
 p=await h.settle(id,['outline_ready','failed']);assert.equal(p.status,'outline_ready',JSON.stringify({error:p.error}));
 assert.equal((await h.request('POST',`projects/${id}/generate`,{})).status,202);
 p=await h.settle(id,['completed','failed','quality_blocked']);
 assert.equal(p.status,'completed',JSON.stringify({status:p.status,error:p.error,det:p.quality?.deterministic?.issues?.filter(i=>i.severity==='error')}));
 assert.deepEqual(reviewed,[],'a card deck is written without a model review (D3)');

 // The run's calls are recorded by family, once each; nothing is budgeted.
 const calls=p.generationCalls,run=h.calls.filter(c=>c.projectId===id&&c.runId===p.currentRunId&&!/^(?:input|outline):/u.test(c.nodeKey||''));
 assert.ok(calls&&calls.version===1&&!('budget' in calls),JSON.stringify(calls));
 assert.equal(calls.total,run.length,'every generation call is recorded once');
 assert.equal(Object.values(calls.byFamily).reduce((a,b)=>a+b,0),calls.total);
 assert.ok(Object.keys(calls.byFamily).every(family=>!/page_|slide_|node_|:\d+$/u.test(family)),'page IDs and numbers fold into stage families: '+JSON.stringify(calls.byFamily));

 // The AI check lists the judged finding as an advisory; the deck stays published.
 const checked=await h.request('POST',`projects/${id}/ai-check`,{});assert.equal(checked.status,200,JSON.stringify(checked.body).slice(0,300));
 assert.equal(checked.body.checked,true);assert.ok(reviewed.length>0,'the check runs the model review');
 const after=h.store.get(h.uid,id);
 assert.equal(after.status,'completed');assert.equal(after.quality.publishEligible,true);
 const advisory=after.quality.modelIssues.find(i=>i.code==='model_unsupported');
 assert.ok(advisory&&advisory.advisory&&advisory.requiresReview&&advisory.severity==='warning',JSON.stringify(after.quality.modelIssues));
 assert.equal(advisory.detail,UNSUPPORTED);assert.equal(after.quality.reviewAdvisories,1);
 console.log('PASS judged review on card decks: generation calls recorded by family without a model review; the AI check lists a judged finding as a review advisory and the deck stays published');
}finally{await h.close?.();fs.rmSync(root,{recursive:true,force:true});}
process.exit(0);

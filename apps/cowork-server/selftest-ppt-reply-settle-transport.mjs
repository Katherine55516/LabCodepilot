// Plan ppt-pipeline-unblocked phase 4: a reply that comes back through the real
// desktop-bridge job queue is settled against the stage schema before the
// caller's validator sees it (a real coverage verdict repeated b_0020).
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.COWORK_STATE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-reply-settle-'));
const store=await import('./lib/ppt-store.mjs');
const {_internals}=await import('./lib/ppt-api.mjs');
const {pptModelJobs}=await import('./lib/ppt-model-jobs.mjs');
// A verdict schema of the shape the outline coverage reviewer used (that review
// was removed with option D; the transport rule does not depend on it).
const coverageVerdictSchema=reviewable=>({type:'object',additionalProperties:false,required:['sufficient','missingSourceUnitIds','reason'],properties:{sufficient:{type:'boolean'},missingSourceUnitIds:{type:'array',items:{type:'string',enum:reviewable}},reason:{type:'string',minLength:1,maxLength:2000}}});
const uid='reply-settle-test',id='e'.repeat(32);
const p={id,uid,title:'Settle',configId:'byok:configured',model:'default',status:'outlining',stage:'outline',revision:1,source:{sha256:'source',semantic:{inventory:{items:[]}}},outline:[]};
async function reply(text,options){
 const logs=[],pending=_internals.defaultDeps.modelCall(p,'Return the verdict.',()=>{},message=>logs.push(String(message)),options);
 let job;for(let n=0;n<200&&!job;n++){const candidate=pptModelJobs.list(uid)[0];if(candidate)job=pptModelJobs.claim(uid,candidate.id);else await new Promise(r=>setTimeout(r,5));}
 assert.ok(job,'the request reaches the production job queue');
 assert.deepEqual(job.options.jsonSchema,options.jsonSchema,'the stage schema goes to the provider');
 pptModelJobs.complete(uid,job.id,{lease:job.lease,text,telemetry:{inputTokens:10,outputTokens:4,wireAttempts:1}});
 return {value:await pending,logs};
}
try{
 store.save(p);
 const jsonSchema=coverageVerdictSchema(['b_0020','b_0022']);
 const settled=await reply('{"sufficient":false,"missingSourceUnitIds":["b_0020","b_0020"],"reason":"The risk list is not visible."}',{nodeKey:'outline:editorial-coverage-audit:4:test',jsonSchema});
 assert.deepEqual(settled.value,{sufficient:false,missingSourceUnitIds:['b_0020'],reason:'The risk list is not visible.'});
 assert.ok(settled.logs.some(line=>/settled reply: duplicate_ids_removed@missingSourceUnitIds/u.test(line)),settled.logs.join('\n'));
 // Without a schema the reply is returned exactly as parsed.
 const raw=await reply('{"ids":["a","a"]}',{nodeKey:'outline:free-form:test'});
 assert.deepEqual(raw.value,{ids:['a','a']});assert.ok(!raw.logs.some(line=>/settled reply/u.test(line)));
 console.log('PASS reply settle transport: a schema-bound reply from the job queue is settled before its validator; a free-form reply is untouched');
}finally{fs.rmSync(process.env.COWORK_STATE_DIR,{recursive:true,force:true});}
process.exit(0);

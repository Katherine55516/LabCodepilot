// Compatibility/role POC only. Passing does not promote a model into evaluated
// PPT defaults; full source/deck and repeated benchmarks remain required.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
const root=process.cwd(),out=path.resolve(process.env.PPT_IMPLEMENTATION_OUTPUT||'outputs/ppt-experience-quality-20261014/live');
const service=JSON.parse(fs.readFileSync(out+'/service-ready.json','utf8'));process.env.CLAUDE_GUI_DATA_DIR=out+'/profile';
const {executeDesktopModelJob}=await import(root+'/src/lib/ppt-desktop-model-worker.ts');
const db=createRequire(import.meta.url)(root+'/src/lib/db.ts');
const models=(process.env.PPT_PROBE_MODELS||'qwen3.8-flash,qwen3.8-max').split(',');
const probes=[
 {id:'simple-writer-v2',role:'writer_fast',prompt:'Return JSON only: {"completed":number,"planned":number,"pending":number,"authenticationRequired":boolean,"rollbackRehearsalRequired":boolean,"conditionOperator":"AND"|"OR"}. Source: 10 of 12 migrations are complete; 2 remain pending. Completion requires customer acceptance of authentication AND rollback rehearsal. Do not add any fact.',check:x=>x.completed===10&&x.planned===12&&x.pending===2&&x.authenticationRequired===true&&x.rollbackRehearsalRequired===true&&x.conditionOperator==='AND'},
 {id:'reasoning-audit-v2',role:'critic',prompt:'Return JSON only: {"valid":boolean,"score":number,"missingInputAllowed":boolean,"renormalizationAllowed":boolean}. Source: w=(0.25,0.75), x=(2,4), s=sum(w_i*x_i). All required inputs must be present; never renormalize when one is missing. Candidate says s=4 and that a missing input may be skipped. Is the candidate valid? Give the correct score and source-required missing-input rules.',check:x=>x.valid===false&&x.score===3.5&&x.missingInputAllowed===false&&x.renormalizationAllowed===false},
 {id:'source-organization-v2',role:'source_organizer',prompt:'Return JSON only: {"pairs":[[string,string]],"extraSourceId":string,"rollbackMustRemainAvailable":boolean}. Group translations without dropping an unpaired fact. Source IDs: CN1=发布前必须通过权限检查。 EN1=Permission checks must pass before launch. CN2=试点只面向支持团队。 EN2=The pilot targets the support team only. EN3=Rollback must remain available during the pilot. pairs contains only translation ID pairs; extraSourceId identifies the unpaired fact and the boolean preserves its meaning.',check:x=>Array.isArray(x.pairs)&&x.pairs.length===2&&JSON.stringify(x.pairs.map(pair=>[...pair].sort().join(':')).sort())==='["CN1:EN1","CN2:EN2"]'&&x.extraSourceId==='EN3'&&x.rollbackMustRemainAvailable===true}
];
fs.mkdirSync(out,{recursive:true});
for(const model of models)for(const probe of probes){
 const id=crypto.randomBytes(16).toString('hex'),started=Date.now();let result;
 const upstream=async(route,body)=>{
  if(route.endsWith('/claim'))return Response.json({id,configId:'byok:'+service.providerId,model,prompt:probe.prompt,lease:'poc-lease',options:{stage:'content:poc',role:probe.role,maxOutputTokens:4096,maxWireAttempts:2,...(process.env.PPT_PROBE_THINKING_MODE?{thinkingMode:process.env.PPT_PROBE_THINKING_MODE}:model===service.model&&process.env.PPT_PROBE_VERIFIED_THINKING==='1'?{thinkingMode:'disabled'}:{})}});
  if(route.endsWith('/complete'))result={text:body.text,telemetry:body.telemetry};
  if(route.endsWith('/fail'))result={error:body.code||body.error,telemetry:body.telemetry};
  return Response.json({ok:true});
 };
 const status=await executeDesktopModelJob(id,upstream);let value,passed=false;
 try{value=JSON.parse(result?.text||'');passed=status.status===200&&probe.check(value);}catch{}
 const record={at:new Date().toISOString(),model,probe:probe.id,role:probe.role,thinkingModeRequested:process.env.PPT_PROBE_THINKING_MODE||'provider_default',sourceHash:crypto.createHash('sha256').update(probe.prompt).digest('hex'),elapsedMs:Date.now()-started,status:status.status,passed,error:result?.error,telemetry:result?.telemetry,value,evidence:'real SDK compatibility/role POC; not a complete PPT quality evaluation',promoted:false};
 fs.appendFileSync(out+'/model-probes.jsonl',JSON.stringify(record)+'\n');console.log(JSON.stringify(record));
}
db.closeDb();

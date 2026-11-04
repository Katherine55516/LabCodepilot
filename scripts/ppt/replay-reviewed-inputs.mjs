// Same-source regression against an already running manual service. Creates
// new projects, preserving the reviewed artifacts. No credentials are read.
// node scripts/ppt/replay-reviewed-inputs.mjs <base> <manifest.json> <output>
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const [base,manifestPath,out]=process.argv.slice(2);if(!base||!manifestPath||!out)throw Error('base, manifest and output are required');
fs.mkdirSync(out,{recursive:true});const samples=JSON.parse(fs.readFileSync(manifestPath)),results=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET',body){
 for(let attempt=0;;attempt++){
  try{
   const r=await fetch(base+'/api/ppt/'+route,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(300000)});
   const value=await r.json();
   if(!r.ok)throw Object.assign(Error(`${method} ${route}: ${r.status} ${String(value.error||'').slice(0,600)}`),{status:r.status,value});
   return value;
  }catch(error){
   // A read may transiently fail while native publication uses the local
   // runtime. Mutations are never retried with an unknown outcome.
   if(method!=='GET'||attempt>=4||error.status&&![502,503,504].includes(error.status))throw error;
   console.warn('READ_RETRY',route,attempt+1);await wait(1000*(attempt+1));
  }
 }
}
const project=async id=>(await api(`projects/${id}?view=live`)).project;
async function until(id,done,label){let last='';const started=Date.now();for(;;){const p=await project(id),state=[p.status,p.stage,p.planningContract?.phase,p.progress?.completed,p.progress?.total].join('/');if(state!==last){console.log(new Date().toISOString(),label,id,state);last=state;}if(done(p))return p;if(['failed','cancelled'].includes(p.status))throw Error(`${label}: ${p.error}`);if(Date.now()-started>3600000)throw Error(label+' timed out');await wait(3000);}}
async function run(s){
 const start=Date.now(),bytes=fs.readFileSync(s.sourcePath),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 if(sha!==s.sourceSha256)throw Error(s.sample+': source bytes differ from reviewed input');
 const input=s.inputKind==='file'?{inputKind:'file',fileName:s.sourceName||path.basename(s.sourcePath),fileBase64:bytes.toString('base64')}:s.inputKind==='prompt'?{inputKind:'prompt',prompt:bytes.toString('utf8')}:{inputKind:'paste',text:bytes.toString('utf8')};
 const original=s.reparseFromProjectId?(await api(`projects/${s.reparseFromProjectId}`)).project:null;
 const created=s.resumeProjectId?(await api(`projects/${s.resumeProjectId}`)).project:(await api('projects','POST',original?{reparseFrom:original.id,baseRevision:original.revision}:{...input,readOnlyInput:true,generationPolicy:s.generationPolicy,template:s.template,templateContentMode:'design_only',configId:s.configId,model:s.model})).project;
 if((s.resumeProjectId||original)&&created.source?.sha256!==sha)throw Error('Resume source hash differs from the manifest');
 const row={sample:s.sample,baseProjectId:s.baseProjectId,projectId:created.id,sourceSha256:sha,template:s.template,policy:s.generationPolicy,model:s.model,status:'running'};results.push(row);save();
 let p=await until(created.id,p=>['input_ready','outline_ready'].includes(p.status),'read');
 // Only reuse actual prior acknowledgements for this exact source, never
 // auto-approve a newly discovered loss/ambiguity.
 for(const warning of p.sourceMediaWarnings||[])if(warning.required&&!warning.resolved){
  if(!(s.acknowledgedWarningKeys||[]).includes(warning.key))throw Error(`New required source warning needs review: ${warning.code} ${warning.key}`);
  await api(`projects/${p.id}/source-warnings`,'POST',{keys:[warning.key],reason:'Same-input regression: reuse the author acknowledgement for this exact source hash and warning key.'});
 }
 const language=s.generationPolicy.language.mode==='output'?(s.generationPolicy.language.locale.startsWith('zh')?'zh':'en'):'bilingual';
 if(p.status==='input_ready')await api(`projects/${p.id}/planning`,'POST',{command:'outline',template:s.template,contentMode:s.generationPolicy.detail,length:s.settings.length||{preset:'standard'},language});
 p=await until(p.id,p=>p.status==='outline_ready'&&p.planningContract?.phase==='page_plan_ready','outline');
 fs.writeFileSync(path.join(out,s.sample+'-outline.json'),JSON.stringify(p.planningContract));
 try{await api(`projects/${p.id}/generate`,'POST');}catch(error){
  if(error.status!==409||error.value.code==='source_warnings_unresolved')throw error;
  // Confirm this newly generated outline as the acceptance run's chosen plan;
  // the original projects are never touched.
  await api(`projects/${p.id}/outline`,'PATCH',{slides:p.outline,finalPageCount:p.outline.length});
  await api(`projects/${p.id}/generate`,'POST');
 }
 p=await until(p.id,p=>['completed','quality_blocked'].includes(p.status)&&!['publishing','reviewing'].includes(p.runtime?.publication?.phase),'generate');
 const full=(await api(`projects/${p.id}`)).project,issues=full.quality?.deterministic?.issues||[];
 Object.assign(row,{status:full.status,publishedRevision:full.publishedRevision,pages:full.deck?.slides?.length,seconds:Math.round((Date.now()-start)/1000),blocking:issues.filter(i=>i.severity==='error'),warnings:issues.filter(i=>i.severity==='warning').length,renderContractVersion:full.renderTree?.renderContractVersion});
 fs.writeFileSync(path.join(out,s.sample+'-quality.json'),JSON.stringify({projectId:p.id,quality:full.quality,outline:full.outline,modelUsage:full.modelUsage},null,2));
 save();if(row.blocking.length||!row.publishedRevision)throw Error(s.sample+': did not publish without blockers');
 console.log('PUBLISHED',JSON.stringify(row));
}
function save(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({base,results},null,2));}
// Keep only two full model pipelines active; each pipeline already has its
// own bounded stage concurrency. Every sample records its result/failure.
let cursor=0;await Promise.all(Array.from({length:2},async()=>{while(cursor<samples.length){const s=samples[cursor++];try{await run(s);}catch(error){const row=results.find(r=>r.sample===s.sample)||{sample:s.sample};if(!results.includes(row))results.push(row);Object.assign(row,{status:'failed',error:String(error.message)});save();console.error('FAILED',s.sample,error.message);}}}));
if(results.some(r=>r.status!=='completed'||!r.publishedRevision))process.exitCode=1;

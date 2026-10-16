// Persistent manual PPT testing: production API/model queue, local host file IO.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import {createServer} from 'node:http';import {Readable} from 'node:stream';
const writeJsonAtomic=(target,data)=>{const tmp=target+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,target);};
const backendPort=Number(process.env.PPT_BACKEND_PORT||3140),frontendPort=Number(process.env.PPT_FRONTEND_PORT||3141);
if(!Number.isInteger(backendPort)||!Number.isInteger(frontendPort)||backendPort<1024||frontendPort<1024||backendPort===frontendPort)throw Error('Invalid PPT test ports');
const root=process.cwd(),out=process.env.PPT_IMPLEMENTATION_OUTPUT||path.join(root,'outputs/ppt-report-implementation-20261011/live-ui'),require=createRequire(import.meta.url),db=require(root+'/src/lib/db.ts');
const moduleFiles=[];function codeFiles(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())codeFiles(file);else if(entry.name.endsWith('.mjs'))moduleFiles.push(file);}}
codeFiles(root+'/apps/cowork-server/lib');moduleFiles.push(root+'/src/lib/ppt-desktop-model-worker.ts',root+'/src/lib/ai-provider.ts');
const codeManifest=Object.fromEntries(moduleFiles.sort().map(file=>[path.relative(root,file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const codeHash=crypto.createHash('sha256').update(JSON.stringify(codeManifest)).digest('hex');fs.mkdirSync(out,{recursive:true,mode:0o700});writeJsonAtomic(out+'/service-code.json',{at:new Date().toISOString(),root,codeHash,files:codeManifest});
const original=process.env.PPT_LLM_API_KEY?{api_key:process.env.PPT_LLM_API_KEY,base_url:process.env.PPT_LLM_BASE_URL,protocol:'openai-compatible',provider_type:'custom'}:db.getProvider(db.getSetting('global_default_model_provider'));if(!original?.api_key)throw Error('Configured provider unavailable');db.closeDb();
process.env.CLAUDE_GUI_DATA_DIR=out+'/profile';fs.mkdirSync(process.env.CLAUDE_GUI_DATA_DIR,{recursive:true,mode:0o700});
const provider=db.getProvider(db.getSetting('global_default_model_provider'))||db.createProvider({name:'PPT verification',protocol:original.protocol,provider_type:original.provider_type,base_url:original.base_url,api_key:original.api_key});original.api_key='';
const model=process.env.PPT_LLM_MODEL||'qwen3.8-max',uid=process.env.PPT_TEST_UID||'ppt-report-implementation-real-ui',token=db.getSetting('cowork_remote_token')||crypto.randomBytes(32).toString('hex');
const existingModel=db.getModelsForProvider(provider.id).find(item=>item.model_id===model);
db.upsertProviderModel({...existingModel,provider_id:provider.id,model_id:model,display_name:existingModel?.display_name||model});
for(const [k,v] of Object.entries({current_user_uid:uid,cowork_remote_url:'http://127.0.0.1:'+backendPort,cowork_remote_token:token,global_default_model_provider:provider.id,global_default_model:model,locale:'zh'}))db.setSetting(k,v);db.closeDb();
process.env.COWORK_STATE_DIR=out+'/state';const lib=n=>import(root+'/apps/cowork-server/lib/'+n+'.mjs');
const [api,store,template,imports,fidelity,render,source,pdf,{localPptRuntime}]=await Promise.all([...['ppt-api','ppt-store','ppt-template','ppt/import-pptx','ppt-template-fidelity','ppt-render','ppt-source','ppt-pdf'].map(lib),import(root+'/apps/cowork-server/test/ppt-local-runtime.mjs')]);
const runtime=localPptRuntime(out+'/workspace',process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const log=(kind,value={})=>fs.appendFileSync(out+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),kind,...value})+'\n');
const deps={...api._internals.defaultDeps,modelCall:async(...args)=>{const result=await api._internals.defaultDeps.modelCall(...args);const key=args[4]?.nodeKey||args[0].stage;fs.mkdirSync(out+'/model-responses',{recursive:true});fs.writeFileSync(out+'/model-responses/'+Date.now()+'-'+String(key).replace(/[^a-z0-9_-]/gi,'-')+'.json',JSON.stringify({at:new Date().toISOString(),projectId:args[0].id,stage:key,promptSha256:crypto.createHash('sha256').update(args[1]).digest('hex'),result},null,2));return result;},analyzeTemplate:(u,id,e,b)=>template.analyzeTemplate(u,id,e,b,runtime.io),importTemplateIR:(p,b,h)=>imports.importEditablePptx(p,b,h,runtime.io),prepareTemplateFidelity:(p,b,h,t)=>fidelity.prepareTemplateFidelity(p,b,h,t,{writeFile:runtime.writeFile,importPptx:(p,b,h)=>imports.importEditablePptx(p,b,h,runtime.io)}),renderPptx:p=>p.templateFidelity?.mode==='preserve'?fidelity.renderTemplatePptx(p,runtime.io):render.renderPptx(p,runtime.io),renderPdf:p=>pdf.renderPdf(p,runtime.io),extractFile:(p,n,b)=>source.extractFile(p,n,b,runtime.io),removeContainer:async()=>{},readFile:async(id,v)=>{const b=await runtime.readFile(id,v);return {stream:Readable.from(b),size:b.length};}};
const server=createServer(async(req,res)=>{if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end();return;}const url=new URL(req.url,'http://local');log('http',{path:url.pathname,method:req.method});try{const send=(s,b)=>{if(url.pathname.endsWith('/claim')&&b?.prompt)log('model.claim.metadata',{attempt:process.env.PPT_RUN_ATTEMPT,projectId:b.projectId,jobId:b.id,stage:b.options?.stage,promptCharacters:b.prompt.length,promptBytes:Buffer.byteLength(b.prompt),promptSha256:crypto.createHash('sha256').update(b.prompt).digest('hex'),maxOutputTokens:b.options?.maxOutputTokens,timeoutMs:b.options?.timeoutMs});res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(b));return true;};if(!await api.handlePpt(req,url,{uid,res,send,deps,activity:e=>log('activity',e),log:m=>log('production.log',{message:String(m).replace(/sk-[A-Za-z0-9_-]{12,}/g,'[redacted]').slice(0,3000)})}))send(404,{error:'Not found'});}catch(e){log('server.error',{message:e.message});if(!res.headersSent){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}}});
await new Promise(r=>server.listen(backendPort,'127.0.0.1',r));
api.recoverPptJobs(e=>log('activity',e),()=>{},deps);log('backend.recovery',{implementation:'production startup recoverPptJobs'});
// API-only acceptance uses the same production queue and desktop SDK worker.
// It avoids starting a second frontend while a UI instance is compiling.
if(process.env.PPT_BACKEND_ONLY==='1'){
 const {executeDesktopModelJob}=await import(root+'/src/lib/ppt-desktop-model-worker.ts');
 const {pptModelJobs}=await lib('ppt-model-jobs');
 const active=new Set();
 const externalWorker=process.env.PPT_TEST_EXTERNAL_WORKER==='1';
 const timer=externalWorker?null:setInterval(()=>{for(const job of pptModelJobs.list(uid)){if(active.size>=2)break;if(active.has(job.id))continue;active.add(job.id);executeDesktopModelJob(job.id,async(route,body)=>fetch(`http://127.0.0.1:${backendPort}/ppt/${route}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})).catch(()=>log('worker.failed',{jobId:job.id})).finally(()=>active.delete(job.id));}},250);
 process.prependListener('SIGTERM',()=>{clearInterval(timer);server.closeAllConnections();server.close();process.exit(0);});
 writeJsonAtomic(out+'/service-ready.json',{base:`http://127.0.0.1:${backendPort}`,model,providerId:provider.id,uid,startedAt:new Date().toISOString(),backendOnly:true,workerMode:externalWorker?'browser':'api-sdk',codeHash});
 console.log('Production PPT API ready on '+backendPort+'; execution: '+(externalWorker?'browser desktop worker':'real SDK worker'));
}else{
const nextRoot=process.env.PPT_NEXT_SOURCE||root;
const fd=fs.openSync(out+'/next.log','a'),app=spawn(process.execPath,[root+'/node_modules/next/dist/bin/next',process.env.PPT_NEXT_MODE==='production'?'start':'dev',...(process.env.PPT_NEXT_MODE!=='production'&&process.env.PPT_DEV_COMPILER==='webpack'?['--webpack']:[]),'--hostname','127.0.0.1','--port',String(frontendPort)],{cwd:nextRoot,detached:true,env:{...process.env,CODEPILOT_NEXT_DIST_DIR:process.env.PPT_NEXT_DIST_DIR||'.next-ppt-alpha-'+(process.env.PPT_RUN_ATTEMPT||'run')},stdio:['ignore',fd,fd]});
const shutdown=()=>{server.closeAllConnections();server.close();try{process.kill(-app.pid,'SIGTERM');}catch{}fs.closeSync(fd);process.exit(0);};
process.prependListener('SIGTERM',shutdown);process.prependListener('SIGINT',shutdown);
app.on('exit',code=>{log('next.exited',{code});shutdown();});
const base='http://127.0.0.1:'+frontendPort;let ready=false;for(let n=0;n<120;n++){try{if((await fetch(base+'/ppt')).ok){const probe=await fetch(base+'/api/ppt/projects');if(probe.ok&&probe.headers.get('content-type')?.includes('application/json')){ready=true;break;}}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready){log('service.readiness_failed',{reason:'PPT route and production API did not become ready'});shutdown();}
const warmPaths=['/api/setup','/api/settings/app','/api/settings/workspace','/api/workspace/summary','/api/routines/count','/api/cowork/status','/api/providers','/api/providers/models','/api/providers/options?providerId=__global__','/api/ppt/templates','/api/ppt/folders','/api/chat/sessions','/api/tasks/notify','/chat','/settings','/settings/api'];
for(let offset=0;offset<warmPaths.length;offset+=3)await Promise.all(warmPaths.slice(offset,offset+3).map(async path=>{const start=Date.now();try{const response=await fetch(base+path,{signal:AbortSignal.timeout(120000)});await response.arrayBuffer();log('service.route_warmup',{path,http:response.status,milliseconds:Date.now()-start});}catch{log('service.route_warmup',{path,error:'bounded warmup failed'});}}));
writeJsonAtomic(out+'/service-ready.json',{base,model,providerId:provider.id,uid,startedAt:new Date().toISOString(),persistent:true,codeHash});
console.log('Persistent production PPT service ready at '+base+'/ppt');

await new Promise(()=>{});

}

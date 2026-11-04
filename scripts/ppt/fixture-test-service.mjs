/** Isolated UI + production HTTP backend, only modelCall is simulated.
 * Does not read/copy user credentials or modify the service on 3141/3143. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import net from'node:net';import {createRequire}from'node:module';import{spawn,spawnSync,execFileSync}from'node:child_process';
import{createPptHttpHarness}from'../../apps/cowork-server/test/ppt-http-harness.mjs';
import{pipelineModelFixture,PIPELINE_SOURCE}from'../../apps/cowork-server/test/ppt-pipeline-model-fixture.mjs';
import{gammaModelFixture}from'../../apps/cowork-server/test/ppt-gamma-model-fixture.mjs';
import{editorialModelFixture,EDITORIAL_SOURCE}from'../../apps/cowork-server/test/ppt-editorial-model-fixture.mjs';
import{mlModelFixture}from'../../apps/cowork-server/test/ppt-ml-model-fixture.mjs';
const root=process.cwd(),out=path.resolve(process.env.PPT_FIXTURE_OUTPUT||'outputs/ppt-fixture-implementation-20261019/ui'),port=Number(process.env.PPT_FIXTURE_PORT||3153),backendPort=Number(process.env.PPT_FIXTURE_BACKEND_PORT||3152);
if(!Number.isInteger(port)||!Number.isInteger(backendPort)||port<1024||backendPort<1024||port>65535||backendPort>65535||port===backendPort||[3141,3140,3142].includes(port)||port===3143&&process.env.PPT_FIXTURE_USE_3143!=='1'||[3141,3140,3143,3142].includes(backendPort))throw Error('Use isolated distinct ports. 3141 and its backend are always protected; 3143 requires explicit PPT_FIXTURE_USE_3143=1 after an idle guarded stop.');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
const pythonProbe=spawnSync(process.env.PPT_TEST_PYTHON||'python3',['-I','-c','import pptx, pdfplumber; from PIL import Image'],{encoding:'utf8',timeout:10000});
if(pythonProbe.status!==0)throw Error('Fixture export dependencies unavailable. Set PPT_TEST_PYTHON to the configured runtime with python-pptx/pdfplumber/Pillow. '+String(pythonProbe.stderr||pythonProbe.error||'').slice(-500));
fs.mkdirSync(out,{recursive:true});process.env.CLAUDE_GUI_DATA_DIR=out+'/profile';delete process.env.CLAUDE_GUI_SECRET_KEY; // The fixture token is not a real provider credential.
const small=pipelineModelFixture({wrongCountOnce:true}),gamma=gammaModelFixture(),editorial=editorialModelFixture(),ml=mlModelFixture();
const gammaInput=fs.readFileSync(process.env.PPT_GAMMA_INPUT||'/Users/dongli/Documents/ChatGPT/CodePilot/gamma.md','utf8');
const mlInput=fs.existsSync(process.env.PPT_ML_INPUT||'')?fs.readFileSync(process.env.PPT_ML_INPUT,'utf8'):null;
const h=await createPptHttpHarness({root:out,port:backendPort,modelCall:(p,...args)=>{const input=String(p.prompt||p.source?.text||'').trim();if(input===gammaInput.trim()||p.source?.sha256===crypto.createHash('sha256').update(gammaInput).digest('hex'))return gamma(p,...args);if(mlInput&&(input===mlInput.trim()||p.source?.sha256===crypto.createHash('sha256').update(mlInput).digest('hex')))return ml(p,...args);if(input===PIPELINE_SOURCE.trim())return small(p,...args);if(input===EDITORIAL_SOURCE.trim())return editorial(p,...args);throw Object.assign(Error('Simulation fixture input not registered. Use the registered full ML input, gamma.md, PIPELINE_SOURCE or EDITORIAL_SOURCE; no real LLM fallback is enabled.'),{code:'schema_invalid'});}});
const db=createRequire(import.meta.url)(root+'/src/lib/db.ts');
const provider=db.createProvider({name:'SIMULATION · modelCall fixture',protocol:'openai-compatible',provider_type:'custom',base_url:'http://127.0.0.1:9/never-called',api_key:'simulation-no-network'});
db.upsertProviderModel({provider_id:provider.id,model_id:'controlled-model',display_name:'SIMULATION · controlled model'});
for(const[k,v]of Object.entries({current_user_uid:h.uid,cowork_remote_url:h.base,cowork_remote_token:h.token,global_default_model_provider:provider.id,global_default_model:'controlled-model',locale:'zh'}))db.setSetting(k,v);db.closeDb();
const log=fs.openSync(out+'/next.log','a');const child=spawn(process.execPath,[root+'/node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,detached:true,env:{...process.env,PPT_FIXTURE_NO_WEBPACK_CACHE:'1',CODEPILOT_NEXT_DIST_DIR:'.next-ppt-fixture-dev-'+port},stdio:['ignore',log,log]});
const owned=new Set([child.pid]);
function captureOwned(){try{const rows=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/u).map(Number));for(let changed=true;changed;){changed=false;for(const[pid,parent]of rows)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);changed=true;}}}catch{}}
// Database shutdown listeners can call process.exit before an asynchronous
// signal handler finishes. Remember descendants first and clean them on exit.
for(const signal of ['SIGINT','SIGTERM'])process.prependListener(signal,captureOwned);
process.on('exit',()=>{captureOwned();for(const pid of [...owned].reverse())try{process.kill(pid,'SIGKILL');}catch{}});
fs.writeFileSync(out+'/service.json',JSON.stringify({base:'http://127.0.0.1:'+port,backend:h.base,pid:process.pid,modelBoundary:'modelCall test double',profile:'isolated, no real credentials',startedAt:new Date().toISOString()}));
let closing=false;async function close(){if(closing)return;closing=true;
 // Next can detach its server into another process group. Capture only this
 // launcher's descendants BEFORE stopping their parent; never kill by port.
 captureOwned();
 for(const pid of [...owned].reverse())try{process.kill(pid,'SIGTERM');}catch{}
 await new Promise(resolve=>setTimeout(resolve,800));
 for(const pid of [...owned].reverse())try{process.kill(pid,'SIGKILL');}catch{}
 await h.close();fs.closeSync(log);
}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());child.on('exit',code=>{if(!closing)process.exitCode=code||1;void close();});child.on('error',()=>{process.exitCode=1;void close();});
console.log('Preparing isolated simulation UI; see '+out+'/next.log');
let ready=false;for(let attempt=0;attempt<60&&!closing;attempt++){try{const response=await fetch('http://127.0.0.1:'+port+'/api/ppt/projects?view=workspace',{signal:AbortSignal.timeout(10000)});if(response.ok&&Array.isArray((await response.json()).projects)){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
// Warm actual UI/provider routes before announcing readiness. A cold dev
// compile otherwise exceeds the workspace's normal 15s model-menu timeout.
if(ready)try{for(const route of ['/ppt','/api/providers','/api/providers/models','/api/providers/options?providerId=__global__']){const r=await fetch('http://127.0.0.1:'+port+route,{signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error(route+' HTTP '+r.status);}}catch(error){ready=false;console.error('Fixture warm-up failed: '+error.message);}
if(!ready){console.error('Fixture frontend/backend readiness failed. No acceptance is recorded.');process.exitCode=1;await close();}else console.log('SIMULATION UI: http://127.0.0.1:'+port+'/ppt — actual API/parser/gates/export, isolated profile');

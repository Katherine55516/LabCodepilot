/** Model-only simulation boundary. Every business request uses production
 * handlers/storage/validation; there is no fabricated project or publish state. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {localPptRuntime} from './ppt-local-runtime.mjs';
export async function createPptHttpHarness({root,modelCall,uid='ppt-model-simulation',port=0,python=process.env.PPT_TEST_PYTHON||'python3'}){
 if(!root||typeof modelCall!=='function')throw new Error('An isolated root and explicit model double are required.');
 fs.mkdirSync(root,{recursive:true});process.env.COWORK_STATE_DIR=path.join(root,'state');
 const lib=name=>import('../lib/'+name+'.mjs');
 const [api,store,source,template,imports,fidelity,renderer,pdf]=await Promise.all(['ppt-api','ppt-store','ppt-source','ppt-template','ppt/import-pptx','ppt-template-fidelity','ppt-render','ppt-pdf'].map(lib));
 const runtime=localPptRuntime(path.join(root,'workspace'),python),calls=[],requests=[],token=crypto.randomBytes(24).toString('hex');
 const deps={...api._internals.defaultDeps,
  modelCall:async(project,prompt,activity,log,options={})=>{
   const record={projectId:project.id,nodeKey:options.nodeKey,sourceHash:project.source?.sha256,promptSha256:crypto.createHash('sha256').update(prompt).digest('hex'),basis:'model_test_double',revision:project.revision,runId:project.currentRunId,planHash:project.planRevision?.hash,sourceIdentity:project.inputUnderstanding?.sourceIdentity,epoch:project.editing?.epochs?.[String(options.nodeKey||'').replace(/^content:/u,'')],startedAt:new Date().toISOString()};calls.push(record);
   try{const result=await modelCall(project,prompt,activity,log,options);record.status='completed';record.response=result;return result;}catch(error){record.status='failed';record.errorCode=error.code||'unknown';throw error;}finally{fs.writeFileSync(path.join(root,'model-calls.json'),JSON.stringify(calls,null,2));}
  },removeContainer:async()=>{},
  readFile:async(id,value)=>{const bytes=await runtime.readFile(id,value);return {stream:Readable.from(bytes),size:bytes.length};},
  extractFile:(p,name,bytes)=>source.extractFile(p,name,bytes,runtime.io),
  analyzeTemplate:(u,id,ext,bytes)=>template.analyzeTemplate(u,id,ext,bytes,runtime.io),
  importTemplateIR:(p,bytes,hash)=>imports.importEditablePptx(p,bytes,hash,runtime.io),
  prepareTemplateFidelity:(p,bytes,hash,t)=>fidelity.prepareTemplateFidelity(p,bytes,hash,t,{writeFile:runtime.writeFile,importPptx:(q,b,h)=>imports.importEditablePptx(q,b,h,runtime.io)}),
  renderPptx:p=>p.templateFidelity?.mode==='preserve'?fidelity.renderTemplatePptx(p,runtime.io):renderer.renderPptx(p,runtime.io),renderPdf:p=>pdf.renderPdf(p,runtime.io)};
 const log=message=>fs.appendFileSync(path.join(root,'backend.jsonl'),JSON.stringify({at:new Date().toISOString(),message:String(message)})+'\n');
 const server=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+token){res.writeHead(401);res.end();return;}
  const url=new URL(req.url,'http://local'),record={method:req.method,path:url.pathname,startedAt:Date.now()};requests.push(record);res.on('finish',()=>{record.status=res.statusCode;record.elapsedMs=Date.now()-record.startedAt;const match=url.pathname.match(/^\/ppt\/projects\/([a-f0-9]{32})\/export$/u);if(match){const p=store.get(uid,match[1]);record.artifact={revision:p?.publishedRevision,path:p?.publishedArtifactPath,sha256:p?.quality?.exportVerification?.sha256};}fs.writeFileSync(path.join(root,'http-requests.json'),JSON.stringify(requests,null,2));});
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));return true;};
  try{if(!await api.handlePpt(req,url,{uid,res,send,deps,activity:()=>{},log}))send(404,{error:'Not found'});}catch(error){log(error.stack||error.message);if(!res.headersSent)send(error.statusCode||error.status||500,{error:error.message});else res.destroy(error);}
 });
 // Client and server share one event loop. After a long synchronous pipeline
 // step the server's idle timeout and the next request can fire in the same
 // tick, and fetch reuses a socket the server just closed (ECONNRESET). The
 // harness closes every connection itself, so idle sockets never expire.
 server.keepAliveTimeout=0;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});const base='http://127.0.0.1:'+server.address().port;
 const request=async(method,route,data)=>{const response=await fetch(base+'/ppt/'+route,{method,headers:{authorization:'Bearer '+token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const type=response.headers.get('content-type')||'';return {status:response.status,headers:Object.fromEntries(response.headers),body:type.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer())};};
 // Poll lightweight persisted state; hydrating all template media every 30ms
 // starved the generation event loop on real uploaded decks.
 const settle=async(id,statuses=['input_ready','outline_ready','completed','quality_blocked','failed'],timeout=180000)=>{const end=Date.now()+timeout;let p;do{p=store.get(uid,id,{hydrate:false});if(statuses.includes(p?.status))return store.get(uid,id);if(Date.now()>=end)break;await new Promise(r=>setTimeout(r,200));}while(true);throw new Error('Pipeline did not settle: '+id+' '+p?.status);};
 return {base,uid,token,runtime,calls,requests,request,settle,deps,store,close:async()=>{fs.writeFileSync(path.join(root,'http-requests.json'),JSON.stringify(requests,null,2));server.closeAllConnections();await new Promise(r=>server.close(r));}};
}

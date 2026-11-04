/* eslint-disable @typescript-eslint/no-explicit-any -- Wire fixtures are partial OpenAI-compatible stream chunks. */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-stall-'));
process.env.CLAUDE_GUI_DATA_DIR=dir;
process.env.CLAUDE_GUI_SECRET_KEY='b'.repeat(64);
/* eslint-disable @typescript-eslint/no-require-imports */
const db=require('../../lib/db') as typeof import('../../lib/db');
const {executeDesktopModelJob,classifyModelFailure,readWithIdleLimit,pptStreamIdleMs}=require('../../lib/ppt-desktop-model-worker') as typeof import('../../lib/ppt-desktop-model-worker');
after(()=>{db.closeDb();fs.rmSync(dir,{recursive:true,force:true});});
const never=new Promise<never>(()=>{});

describe('model stream watchdog',()=>{
 it('idle window is 90 s by default and only accepts sane overrides',()=>{
  assert.equal(pptStreamIdleMs(undefined),90000);assert.equal(pptStreamIdleMs('1500'),1500);assert.equal(pptStreamIdleMs('5'),90000);assert.equal(pptStreamIdleMs('x'),90000);
 });
 it('a read that never settles is abandoned after the idle window as a retriable stall',async()=>{
  let aborted:Error|undefined;const started=Date.now();
  await assert.rejects(readWithIdleLimit(never,40,never,e=>{aborted=e;}),(e:any)=>e.code==='network'&&e.stalled==='idle');
  assert.ok(Date.now()-started<1000);assert.equal((aborted as any)?.stalled,'idle');
  const c=classifyModelFailure(aborted);assert.equal(c.code,'network');assert.equal(c.diagnostic?.kind,'stalled');
 });
 it('the request deadline also ends a pending read, and a settled read clears its idle timer',async()=>{
  const deadline=new Promise<never>((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('deadline'),{name:'TimeoutError'})),20));deadline.catch(()=>{});
  await assert.rejects(readWithIdleLimit(never,5000,deadline,()=>{throw Error('must not stall');}),/deadline/);
  let stalled=false;assert.equal(await readWithIdleLimit(Promise.resolve(7),20,never,()=>{stalled=true;}),7);
  await new Promise(r=>setTimeout(r,40));assert.equal(stalled,false);
 });
 it('a provider stream that goes silent after its first token fails fast as a stalled network error, not after the full deadline',async()=>{
  const sockets=new Set<any>();
  const server=http.createServer(async(req,res)=>{
   for await(const _ of req){/* drain */}
   res.writeHead(200,{'content-type':'text/event-stream'});
   res.write(`data: ${JSON.stringify({id:'s',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content:'{"partial":'},finish_reason:null}]})}\n\n`);
   // Upstream stalls: the connection stays open and nothing more is sent.
  });
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const prior=process.env.PPT_STREAM_IDLE_MS;process.env.PPT_STREAM_IDLE_MS='1500';
  try{
   const provider=db.createProvider({name:'Stall fixture',provider_type:'custom',protocol:'openai-compatible',base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,api_key:'test-only'});
   const id='d'.repeat(32);let completion:any;const started=Date.now();
   const result=await executeDesktopModelJob(id,async(route,body)=>{if(route.endsWith('/claim'))return Response.json({id,configId:'byok:'+provider.id,model:'fixture',prompt:'Read fragments',lease:'nonce',options:{stage:'input:semantic:0:abc',maxOutputTokens:8192}});if(route.endsWith('/complete'))completion=body;return Response.json({ok:true});});
   const elapsed=Date.now()-started;
   assert.equal(result.status,502);assert.equal(completion.error,'network');assert.equal(completion.diagnostic.kind,'stalled');
   assert.ok(elapsed<10000,`stall detected in ${elapsed} ms, far below the 240 s deadline`);
  }finally{
   if(prior===undefined)delete process.env.PPT_STREAM_IDLE_MS;else process.env.PPT_STREAM_IDLE_MS=prior;
   for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));
  }
 });
});

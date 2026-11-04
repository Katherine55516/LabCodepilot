import {it} from 'node:test';
import assert from 'node:assert/strict';
import {pptJsonRequest} from '../../lib/ppt-json-request';
const noWait=async()=>{};
it('reconnects a readonly projection after a transport failure and a 503',async()=>{
 let calls=0;const fetcher=(async()=>{calls++;if(calls===1)throw new TypeError('Failed to fetch');return calls===2?Response.json({error:'unavailable'},{status:503}):Response.json({project:{id:'existing',status:'outline_ready'}});}) as typeof fetch;
 const x=await pptJsonRequest('/api/ppt/projects/existing',{method:'GET'},fetcher,noWait);assert.equal(calls,3);assert.equal(x.data.project.id,'existing');
});
it('also reconnects a readonly response whose JSON body is interrupted',async()=>{
 let calls=0;const fetcher=(async()=>{calls++;return calls===1?{ok:true,json:async()=>{throw new TypeError('Failed to fetch');}}:Response.json({ready:true});}) as typeof fetch;
 assert.equal((await pptJsonRequest('/api/ppt/projects/existing',{},fetcher,noWait)).data.ready,true);assert.equal(calls,2);
});
it('never retries a mutation or a nontransient authentication error',async()=>{
 for(const method of ['POST','PATCH','DELETE']){let calls=0;const f=(async()=>{calls++;throw new TypeError('Failed to fetch');}) as typeof fetch;await assert.rejects(pptJsonRequest('/api/ppt/projects',{method},f,noWait));assert.equal(calls,1);}
 let calls=0;const f=(async()=>{calls++;return Response.json({error:'sign in'},{status:401});}) as typeof fetch;
 assert.equal((await pptJsonRequest('/api/ppt/projects',{},f,noWait)).response.status,401);assert.equal(calls,1);
});
it('bounds exhausted retries and respects cancellation',async()=>{
 let calls=0;const f=(async()=>{calls++;throw new TypeError('network');}) as typeof fetch;
 await assert.rejects(pptJsonRequest('/api/ppt/projects',{},f,noWait));assert.equal(calls,3);
 calls=0;const controller=new AbortController();controller.abort();await assert.rejects(pptJsonRequest('/api/ppt/projects',{signal:controller.signal},f,noWait));assert.equal(calls,1);
});

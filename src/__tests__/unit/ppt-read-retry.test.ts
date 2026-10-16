import {it} from 'node:test';import assert from 'node:assert/strict';
import {retryPptRead,retryPptUpstreamRead} from '../../lib/ppt-read-retry';
it('PPT reads recover temporary proxy/network interruptions without replacing a valid outline',async()=>{
 let calls=0;const delays:number[]=[],outline={status:'outline_ready',id:'existing',pages:18};
 const result=await retryPptRead(async()=>{calls++;if(calls===1)throw Object.assign(new Error('Busy'),{status:503});if(calls===2)throw new TypeError('Failed to fetch');return outline;},{wait:async ms=>{delays.push(ms);}});
 assert.equal(result,outline);assert.equal(calls,3);assert.deepEqual(delays,[500,1000]);
});
it('PPT read retries are bounded and do not retry permanent status/schema failures',async()=>{
 for(const status of [400,401,403,404,409,422]){let calls=0;await assert.rejects(retryPptRead(async()=>{calls++;throw Object.assign(new Error('Permanent'),{status});},{wait:async()=>{}}));assert.equal(calls,1);}
 let calls=0;await assert.rejects(retryPptRead(async()=>{calls++;throw Object.assign(new Error('Still busy'),{status:503});},{retries:2,wait:async()=>{}}),/Still busy/);assert.equal(calls,3);
 calls=0;await assert.rejects(retryPptRead(async()=>{calls++;throw new SyntaxError('Invalid response');},{wait:async()=>{}}));assert.equal(calls,1);
});

it('PPT proxy retries a dropped GET once before a response, without retrying writes or received errors',async()=>{
 const drop=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});let calls=0;const delays:number[]=[];
 const response=new Response('accepted');assert.equal(await retryPptUpstreamRead('GET',async()=>{if(++calls===1)throw drop();return response;},{wait:async ms=>{delays.push(ms);}}),response);assert.equal(calls,2);assert.deepEqual(delays,[500]);
 for(const method of ['POST','PATCH','DELETE']){calls=0;await assert.rejects(retryPptUpstreamRead(method,async()=>{calls++;throw drop();},{wait:async()=>{}}));assert.equal(calls,1);}
 calls=0;const denied=new Response('denied',{status:401});assert.equal(await retryPptUpstreamRead('GET',async()=>{calls++;return denied;}),denied);assert.equal(calls,1);
 calls=0;await assert.rejects(retryPptUpstreamRead('GET',async()=>{calls++;throw drop();},{wait:async()=>{}}));assert.equal(calls,2);
});
it('PPT proxy preserves aborts and permanent configuration errors',async()=>{
 for(const error of [new SyntaxError('bad configuration'),Object.assign(new TypeError('Invalid URL'),{cause:{code:'ERR_INVALID_URL'}})]){let calls=0;await assert.rejects(retryPptUpstreamRead('GET',async()=>{calls++;throw error;},{wait:async()=>{}}));assert.equal(calls,1);}
 const c=new AbortController();c.abort();let calls=0;await assert.rejects(retryPptUpstreamRead('GET',async()=>{calls++;throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});},{signal:c.signal,wait:async()=>{}}));assert.equal(calls,1);
});

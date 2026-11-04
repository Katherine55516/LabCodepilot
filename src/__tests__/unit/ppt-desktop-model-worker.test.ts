/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures intentionally exercise dynamic or malformed model/API payloads. */
import { after, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
type WireRequest={model:string;response_format:{type:string};max_tokens:number;stream?:boolean;thinking?:{type:string};reasoning_effort?:string;enable_thinking?:boolean};
type JobOutput={text:string;telemetry:{outputMode:string;inputTokens:number;outputTokens:number}};
type ProgressBody={lease:string;chars:number;text:string};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-byok-'));
process.env.CLAUDE_GUI_DATA_DIR = dir;
process.env.CLAUDE_GUI_SECRET_KEY = 'a'.repeat(64);
/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const { executeDesktopModelJob } = require('../../lib/ppt-desktop-model-worker') as typeof import('../../lib/ppt-desktop-model-worker');
const {classifyModelFailure}=require('../../lib/ppt-desktop-model-worker') as typeof import('../../lib/ppt-desktop-model-worker');
after(() => { db.closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });
describe('PPT desktop model worker', () => {
  it('classifies safe output/transport failures while retaining whitelisted usage',()=>{
    assert.equal(classifyModelFailure({name:'AI_NoObjectGeneratedError',text:'',finishReason:'stop'}).code,'empty_visible_output');
    assert.equal(classifyModelFailure({name:'AI_NoObjectGeneratedError',text:'{',finishReason:'length'}).code,'truncated_output');
    assert.equal(classifyModelFailure({statusCode:401,message:'key echo'}).code,'auth');
    assert.equal(classifyModelFailure({statusCode:503}).code,'model_unavailable');
    const result=classifyModelFailure({name:'AI_NoObjectGeneratedError',text:'{',usage:{inputTokens:17,outputTokens:8,outputTokenDetails:{reasoningTokens:5}},finishReason:'stop',response:{headers:{Authorization:'secret'}}});
    assert.equal(result.telemetry?.reasoningTokens,5);assert.ok(!JSON.stringify(result).includes('secret'));
    const timeout=classifyModelFailure({message:'secret',cause:{code:'UND_ERR_HEADERS_TIMEOUT',url:'secret'}});
    assert.equal(timeout.diagnostic?.kind,'timeout');assert.ok(!JSON.stringify(timeout).includes('secret'));
    assert.equal(classifyModelFailure({cause:{statusCode:429,responseBody:'secret'}}).diagnostic?.httpStatus,429);
    const connect=classifyModelFailure({message:'secret',cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});
    assert.equal(connect.code,'network','a connect timeout never reached the gateway and is retried as a network failure');
  });
  it('uses the schema and stage budget on the wire, falling back only for an explicit unsupported schema',async()=>{
    const requests:WireRequest[]=[];let rejectSchema=true,responseText='{"ok":true}';
    const schema={type:'object',additionalProperties:false,properties:{ok:{type:'boolean'}},required:['ok']};
    const server=http.createServer(async(req,res)=>{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
      if(rejectSchema&&body.response_format.type==='json_schema'){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'response_format json_schema is unsupported',type:'invalid_request_error'}}));return;}
      if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});for(const delta of [{content:responseText},{}])res.write(`data: ${JSON.stringify({id:'schema-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:delta.content?null:'stop'}],...(!delta.content?{usage:{prompt_tokens:21,completion_tokens:4,total_tokens:25}}:{})})}\n\n`);res.end('data: [DONE]\n\n');return;}
      res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'schema-fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:21,completion_tokens:4,total_tokens:25}}));
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const provider=db.createProvider({name:'Schema fixture',provider_type:'custom',protocol:'openai-compatible',base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,api_key:'test-only'});
      const id='c'.repeat(32);let completion={} as JobOutput;
      const run=(model:string,stage='outline',extra:Record<string,unknown>={})=>executeDesktopModelJob(id,async(route,body)=>{if(route.endsWith('/claim'))return Response.json({id,configId:'byok:'+provider.id,model,prompt:'Server schema request',lease:'nonce',options:{stage,maxOutputTokens:8192,jsonSchema:schema,...extra}});completion=body as JobOutput;return Response.json({ok:true});});
      assert.equal((await run('schema-fallback')).status,200);assert.equal(requests.length,2);assert.equal(requests[0].response_format.type,'json_schema');assert.equal(requests[1].response_format.type,'json_object');assert.equal(requests[0].max_tokens,8192);assert.equal(completion.telemetry.outputMode,'json_fallback');
      rejectSchema=false;assert.equal((await run('schema-supported')).status,200);assert.equal(completion.telemetry.outputMode,'schema');assert.equal(completion.telemetry.inputTokens,21);
      assert.equal((await run('deepseek-v4-flash')).status,200);assert.equal(requests.at(-1)!.thinking!.type,'disabled');assert.ok(!requests[0].thinking);assert.ok(!requests[0].reasoning_effort);
      assert.equal((await run('deepseek-v4-flash','review:deck:batch:1')).status,200);assert.equal(requests.at(-1)!.thinking!.type,'disabled');assert.equal(requests.at(-1)!.stream,true);assert.equal(completion.text,'{"ok":true}');
      assert.equal((await run('deepseek-v4-flash','content:slide_one')).status,200);assert.ok(!requests.at(-1)!.thinking);assert.equal(requests.at(-1)!.stream,true);assert.equal(requests.at(-1)!.response_format.type,'json_schema');
      assert.equal((await run('qwen3.8-max','outline')).status,200);assert.equal(requests.at(-1)!.enable_thinking,false);assert.ok(!requests.at(-1)!.thinking);
      assert.equal((await run('qwen3.8-max','content:slide_one')).status,200);assert.equal(requests.at(-1)!.enable_thinking,false);
      // A user's AI edit is a short structured rewrite: no thinking (live r35: gateway 504 at 122 s).
      assert.equal((await run('qwen3.8-max','ai:proposal_0123')).status,200);assert.equal(requests.at(-1)!.enable_thinking,false);
      assert.equal((await run('qwen3.8-max','input:understand',{role:'source_organizer'})).status,200);assert.equal(requests.at(-1)!.enable_thinking,false);assert.equal(requests.at(-1)!.stream,true);
      assert.equal((await run('qwen3.8-max','planning:navigation:0')).status,200);assert.equal(requests.at(-1)!.enable_thinking,false);
      assert.equal(requests.at(-1)!.stream,true,'navigation keeps the model transport open');
      assert.equal((await run('qwen3.8-max','planning:language-pairs:0')).status,200);assert.equal(requests.at(-1)!.stream,true,'language-pair audits stream transport without becoming page drafts');
      assert.equal((await run('qwen3.8-max','planning:navigation:audit:0')).status,200);assert.equal(requests.at(-1)!.enable_thinking,false);
      assert.equal((await run('gpt-6.1-sol','review:deck')).status,200);assert.ok(!requests.at(-1)!.thinking);assert.ok(!requests.at(-1)!.reasoning_effort);
      responseText='{"ok":"wrong type"}';
      assert.equal((await run('schema-supported')).status,200);
      assert.equal(completion.text,responseText,'the authoritative server receives original valid JSON to compile or reject');
      assert.equal(completion.telemetry.outputMode,'schema','a compatible provider may ignore shape constraints; server compilation/validation remains authoritative');
      responseText='{';assert.equal((await run('schema-supported')).status,502,'incomplete JSON never becomes an accepted model result');
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('streams writer pages and reports bounded progress with the lease, completing with the full validated text',async()=>{
    const requests:WireRequest[]=[];const parts=['{"title":"核心张力",','"blocks":[{"body":"候选极多时',"，最优 IC 是极值\"}]}"];
    const server=http.createServer(async(req,res)=>{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
      res.writeHead(200,{'content-type':'text/event-stream'});
      for(const content of parts){res.write(`data: ${JSON.stringify({id:'s',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{content},finish_reason:null}]})}\n\n`);await new Promise(r=>setTimeout(r,20));}
      res.write(`data: ${JSON.stringify({id:'s',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:12,total_tokens:42}})}\n\n`);
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const provider=db.createProvider({name:'Stream fixture',provider_type:'custom',protocol:'openai-compatible',base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,api_key:'test-only'});
      const id='e'.repeat(32),progress:ProgressBody[]=[];let completion={} as JobOutput;
      const outcome=await executeDesktopModelJob(id,async(route,body)=>{
        if(route.endsWith('/claim'))return Response.json({id,configId:'byok:'+provider.id,model:'writer-model',prompt:'Write page',lease:'nonce',options:{stage:'content:slide_a',maxOutputTokens:8192}});
        if(route.endsWith('/progress')){progress.push(body as ProgressBody);return Response.json({ok:true});}
        completion=body as JobOutput;return Response.json({ok:true});
      });
      assert.equal(outcome.status,200);
      assert.equal(requests[0].stream,true,'writer stages stream');
      assert.ok(progress.length>=1);assert.ok(progress.every(item=>item.lease==='nonce'&&item.chars>0&&item.text.length<=60000));
      assert.ok(progress[0].text.startsWith('{"title":"核心张力"'));
      assert.equal(completion.text,parts.join(''),'the final text is the complete stream');
      assert.equal(completion.telemetry.outputTokens,12);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('coalesces slow progress delivery while flushing the final real fragment before completion',async()=>{
    const provider=db.createProvider({name:'Progress contract fixture',provider_type:'custom',protocol:'openai-compatible',base_url:'http://127.0.0.1:1/v1',api_key:'test-only'});
    const id='f'.repeat(32),fragments:{seq:number;text:string}[]=[],text=JSON.stringify({title:'x'.repeat(100)});
    const outcome=await executeDesktopModelJob(id,async(route,body:any)=>{
      if(route.endsWith('/claim'))return Response.json({id,configId:'byok:'+provider.id,model:'fixture',prompt:'Fixture only',lease:'nonce'});
      if(route.endsWith('/progress')){await new Promise(resolve=>setTimeout(resolve,15));fragments.push(body);return Response.json({ok:true});}
      assert.equal(fragments.at(-1)?.text,text);return Response.json({ok:true});
    },async(_job,_provider,progress)=>{for(let i=1;i<=text.length;i++)progress?.({chars:i,text:text.slice(0,i)});return text;});
    assert.equal(outcome.status,200);assert.equal(fragments.length,2,'slow delivery keeps only the in-flight and most recent fragment');assert.ok(fragments[1].seq>fragments[0].seq);
  });
  it('retains encrypted BYOK across startup and uses real SDK Chat Completions against a local fixture', async () => {
    let actualPath = ''; let requestedModel = ''; let auth = ''; let finishReason = 'stop'; let payload = '{"slides":[]}';
    const server = http.createServer(async (req, res) => {
      actualPath = req.url || ''; auth = req.headers.authorization || '';
      const parts: Buffer[] = []; for await (const chunk of req) parts.push(chunk);
      const body = JSON.parse(Buffer.concat(parts).toString()); requestedModel = body.model;
      assert.equal(body.messages[0].content, 'Server-owned prompt');
      assert.equal(body.max_tokens, 32768, 'large template outlines need the full worker output budget on the wire');
      assert.deepEqual(body.response_format, { type: 'json_object' }, 'PPT jobs request native JSON transport without relaxing module schemas');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: payload }, finish_reason: finishReason }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const provider = db.createProvider({ name: 'Fixture', provider_type: 'custom', protocol: 'openai-compatible', base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test-only-not-real', role_models_json: JSON.stringify({ default: 'ppt应用测试' }) });
      const raw = db.getDb().prepare('SELECT api_key FROM api_providers WHERE id=?').get(provider.id) as { api_key: string };
      assert.ok(raw.api_key.startsWith('enc:v1:')); assert.ok(!raw.api_key.includes('test-only-not-real'));
      const { providerRequiresNative, predictNativeRuntime, resolveRuntime, registerRuntime } = require('../../lib/runtime/registry') as typeof import('../../lib/runtime/registry');
      const native = { id: 'native', isAvailable: () => true } as import('../../lib/runtime/types').AgentRuntime;
      registerRuntime(native);
      assert.equal(providerRequiresNative(provider.id), true);
      assert.equal(predictNativeRuntime(provider.id), true);
      assert.equal(resolveRuntime('claude-code-sdk', provider.id).id, 'native', 'unsupported wire protocol must not enter Claude Code');
      db.closeDb(); assert.equal(db.getProvider(provider.id)?.api_key, 'test-only-not-real', 'startup must not delete OpenAI-compatible provider');
      const id = 'a'.repeat(32); let complete: Record<string, unknown> = {};
      const result = await executeDesktopModelJob(id, async (route, body) => {
        if (route.endsWith('/claim')) return Response.json({ id, configId: `byok:${provider.id}`, model: 'ppt应用测试', prompt: 'Server-owned prompt', lease: 'nonce' });
        complete = body as Record<string, unknown>; return Response.json({ ok: true });
      });
      assert.equal(result.status, 200); assert.equal(actualPath, '/v1/chat/completions');
      assert.equal(requestedModel, 'ppt应用测试'); assert.equal(auth, 'Bearer test-only-not-real');
      assert.equal(complete.text, '{"slides":[]}'); assert.equal(complete.lease, 'nonce');
      assert.ok(!JSON.stringify(complete).includes('test-only-not-real'));
      finishReason = 'length';
      const truncated = await executeDesktopModelJob(id, async (route, body) => {
        if (route.endsWith('/claim')) return Response.json({ id, configId: `byok:${provider.id}`, model: 'ppt应用测试', prompt: 'Server-owned prompt', lease: 'nonce' });
        complete = body as Record<string, unknown>; return Response.json({ ok: true });
      });
      assert.equal(truncated.status, 502, 'even valid-looking JSON must be rejected when truncated');
      assert.equal(complete.error, 'truncated_output'); assert.equal(complete.text, undefined);
      finishReason = 'stop'; payload = '{"slides":[}';
      const malformed = await executeDesktopModelJob(id, async (route, body) => {
        if (route.endsWith('/claim')) return Response.json({ id, configId: `byok:${provider.id}`, model: 'ppt应用测试', prompt: 'Server-owned prompt', lease: 'nonce' });
        complete = body as Record<string, unknown>; return Response.json({ ok: true });
      });
      assert.equal(malformed.status, 502, 'an upstream ignoring JSON mode must still fail strict SDK parsing');
      assert.equal(complete.error, 'invalid_json'); assert.equal(complete.text, undefined);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('rejects managed/unknown providers and never sends SDK errors or credentials back', async () => {
    const id = 'b'.repeat(32); let invoked = false; let completed: unknown;
    const response = await executeDesktopModelJob(id, async (route, body) => {
      if (route.endsWith('/claim')) return Response.json({ id, configId: 'managed-other', model: 'model', prompt: 'prompt', lease: 'nonce' });
      completed = body; return Response.json({ ok: true });
    }, async () => { invoked = true; throw new Error('SECRET'); });
    assert.equal(invoked, false); assert.equal(response.status, 502); assert.ok(!JSON.stringify(completed).includes('SECRET'));
    const unavailable = await executeDesktopModelJob(id, async () => Response.json({}, { status: 409 }));
    assert.equal(unavailable.status, 409);
    assert.equal((await executeDesktopModelJob('../path', async () => { throw new Error('must not fetch'); })).status, 400);
  });
});

test('Schema compiler errors permit one format fallback, never auth/rate/semantic errors',async()=>{
 const {pptSchemaFallback}=await import('../../lib/ppt-desktop-model-worker');
 assert.equal(pptSchemaFallback({cause:{statusCode:500}},true),'schema_server_error');
 assert.equal(pptSchemaFallback({statusCode:400,message:'response_format unsupported'},true),'unsupported_schema');
 for(const error of [{statusCode:401},{statusCode:403},{statusCode:429},{statusCode:400,message:'invalid content'},{message:'invalid source ownership'}])assert.equal(pptSchemaFallback(error,true),null);
 assert.equal(pptSchemaFallback({statusCode:500},false),null);
});

test('PPT vision reaches the SDK wire and failed schema fallbacks retain the real attempt count',async()=>{
 const requests:Record<string,unknown>[]=[];let reject=false;
 const server=http.createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);res.setHeader('content-type','application/json');if(reject){res.statusCode=400;res.end(JSON.stringify({error:{message:body.response_format?.type==='json_schema'?'response_format json_schema unsupported':'Invalid request',type:'invalid_request_error'}}));return;}res.end(JSON.stringify({id:'vision',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:'{"description":"source figure","uncertain":false}'},finish_reason:'stop'}],usage:{prompt_tokens:17,completion_tokens:8,total_tokens:25}}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const provider=db.createProvider({name:'Vision wire fixture',provider_type:'custom',protocol:'openai-compatible',base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,api_key:'test-only'});
  const id='f'.repeat(32),image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB5kAAAAASUVORK5CYII=';let completion:{telemetry?:{wireAttempts?:number};error?:string}={};
  const run=(model:string,maxWireAttempts:number)=>executeDesktopModelJob(id,async(route,body)=>{if(route.endsWith('/claim'))return Response.json({id,configId:'byok:'+provider.id,model,prompt:'Read the attached source',lease:'vision-lease',options:{stage:'vision:source',role:'vision_reader',images:[{id:'source',dataUrl:image}],maxOutputTokens:2048,maxWireAttempts,jsonSchema:{type:'object',properties:{description:{type:'string'},uncertain:{type:'boolean'}},required:['description','uncertain']}}});completion=body as typeof completion;return Response.json({ok:true});});
  assert.equal((await run('vision-fixture',2)).status,200);
  const content=(requests[0].messages as {content:{type:string;image_url?:{url:string}}[]}[])[0].content;
  assert.ok(content.some(part=>part.type==='image_url'&&part.image_url?.url===image),'image bytes reach the provider');assert.equal(requests[0].max_tokens,2048);assert.ok(!requests[0].thinking&&!requests[0].enable_thinking,'unknown reasoning controls stay off the wire');
  reject=true;const before=requests.length;assert.equal((await run('one-attempt-fixture',1)).status,502);assert.equal(requests.length-before,1);assert.equal(completion.telemetry?.wireAttempts,1);
  const second=requests.length;assert.equal((await run('two-attempt-fixture',2)).status,502);assert.equal(requests.length-second,2);assert.equal(completion.telemetry?.wireAttempts,2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

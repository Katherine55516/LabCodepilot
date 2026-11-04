import { generateText, streamText, Output, jsonSchema } from 'ai';
import { createModel } from '@/lib/ai-provider';
import { getProvider, getSetting } from '@/lib/db';
import { generateTextViaSdk } from '@/lib/claude-client';

type Job = { id: string; configId: string; model: string; prompt: string; lease: string; options?: {images?:{id:string;dataUrl:string}[];role?:string;thinkingMode?:'enabled'|'disabled';maxWireAttempts?:number;timeoutMs?: number;stage?: string;maxOutputTokens?: number;jsonSchema?: Record<string, unknown>} };
type JobRequest = (path: string, body: unknown, options?:{freshConnection?:boolean}) => Promise<Response>;

export const PPT_DESKTOP_MODEL_MAX_OUTPUT_TOKENS = 32768;
export const PPT_DESKTOP_MODEL_JSON_OUTPUT = true;
const schemaSupport=new Map<string,boolean>();

/** An optional role is not an explicit thinking preference. Preserve the
 * established fast structured-task mode when a catalogue has no preference.
 * A user's AI edit (stage ai:) is a short structured rewrite like a page write
 * (live r35: qwen's default thinking took 60-115 s and the gateway answered 504 at 122 s). */
export function pptThinkingOptions(job:Pick<Job,'model'|'options'>):{thinkingMode?:'enabled'|'disabled'} {
 if(job.options?.thinkingMode)return {thinkingMode:job.options.thinkingMode};
 const stage=job.options?.stage||'';
 const structured=/^deepseek(?:-|\/)/i.test(job.model)&&/^(?:input:|outline|source|planning:|review:|content:.*:postwriter)/.test(stage)
  ||/^qwen(?:3[.\/-]|-)/i.test(job.model)&&/^(?:input:|outline|source|translation:|planning:|review:|content:|ai:)/.test(stage);
 return structured?{thinkingMode:'disabled'}:{};
}

/** Silence after visible output began that marks an upstream stream as stalled
 * (90 s; PPT_STREAM_IDLE_MS overrides for tests/diagnostics, 1 s – 10 min). */
export function pptStreamIdleMs(value=process.env.PPT_STREAM_IDLE_MS){const n=Number(value);return Number.isInteger(n)&&n>=1000&&n<=600000?n:90000;}
/** Races one stream read against an idle window and the request deadline. On
 * idle expiry it calls onStall (which aborts the request) and rejects with a
 * retriable network failure marked `stalled`, so the server's existing
 * transient retry re-runs the job instead of waiting for the full deadline. */
export async function readWithIdleLimit<T>(read:Promise<T>,idleMs:number,deadline:Promise<never>,onStall:(error:Error)=>void):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 const idle=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{const stall=Object.assign(new Error('Model stream stalled'),{code:'network',stalled:'idle'});onStall(stall);reject(stall);},idleMs);});
 try{return await Promise.race([read,idle,deadline]);}finally{clearTimeout(timer);}
}

/** Claims the account-owned server prompt. Browser-supplied prompts/URLs/keys are never used. */
type Progress = (progress: {chars:number;text:string}) => void;
type GenerateResult={text:string;telemetry?:{retryAfterMs?:number;wireAttempts?:number;finishReason?:string;inputTokens?:number;outputTokens?:number;reasoningTokens?:number;outputMode?:string}};
/** The direct channel: the provider's own API through the AI SDK. */
export const directGenerate=async (job: Job, providerId: string, progress?: Progress):Promise<GenerateResult> => {
  // Source/outline and structured deck findings have finite JSON contracts.
  // DeepSeek's optional hidden reasoning otherwise consumes the wall-clock
  // budget before findings arrive; writer requests keep their default mode.
  const { languageModel } = createModel({providerId,model:job.model,...pptThinkingOptions(job)});
  const modelInput=job.options?.images?.length?{messages:[{role:'user' as const,content:[{type:'text' as const,text:job.prompt},...job.options.images.map(image=>({type:'image' as const,image:image.dataUrl}))]}]}:{prompt:job.prompt};
  const provider = getProvider(providerId);
  const jsonOutput = PPT_DESKTOP_MODEL_JSON_OUTPUT && ['openai-compatible', 'openrouter'].includes(provider?.protocol || '');
  const supportsSchema=Boolean(job.options?.jsonSchema) && schemaSupport.get(providerId+':'+job.model)!==false;
  const requestStarted=performance.now();let firstTokenMs:number|undefined;
  let outputMode=supportsSchema?'schema':jsonOutput?'json':'text';
  const promptBytes=new TextEncoder().encode(job.prompt).byteLength;
  const extended=job.options?.timeoutMs===420000&&(/^review:deck(?:$|:)/.test(job.options.stage||'')&&promptBytes>=90000||/^outline(?:$|:)/.test(job.options.stage||'')&&promptBytes>=120000);
  const timeoutMs=extended?420000:240000;
  // A strongly referenced timer and an explicit race: an SDK read that is
  // already pending does not always settle when only its signal aborts (live:
  // a stream stalled after 45 s and the worker waited 26 min, not 240 s).
  const deadlineController=new AbortController(),deadlineSignal=deadlineController.signal;
  const deadlineTimer=setTimeout(()=>deadlineController.abort(Object.assign(new Error('Model request deadline exceeded'),{name:'TimeoutError'})),timeoutMs);
  const deadline=new Promise<never>((_,reject)=>deadlineSignal.addEventListener('abort',()=>reject(deadlineSignal.reason),{once:true}));deadline.catch(()=>{});
  const bounded=<T,>(work:Promise<T>)=>Promise.race([work,deadline]);
  try{
  const call=(schema:boolean)=>bounded(generateText({model:languageModel,...modelInput,...(schema?{output:Output.object({schema:jsonSchema(job.options!.jsonSchema!)})}:jsonOutput?{output:Output.json()}:{}),maxOutputTokens:job.options?.maxOutputTokens&&Number.isInteger(job.options.maxOutputTokens)&&job.options.maxOutputTokens>=256&&job.options.maxOutputTokens<=32768?job.options.maxOutputTokens:PPT_DESKTOP_MODEL_MAX_OUTPUT_TOKENS,maxRetries:0,abortSignal:deadlineSignal}));
  // Writer pages stream so the editor can show a live draft (V-P0-3). The
  // final text is validated exactly like a non-streamed result; only a bounded
  // partial text is reported, at most every 700 ms.
  const stream=async(schema:boolean)=>{
    let streamError:unknown;
    const streamed=streamText({model:languageModel,...modelInput,...(schema?{output:Output.object({schema:jsonSchema(job.options!.jsonSchema!)})}:jsonOutput?{output:Output.json()}:{}),maxOutputTokens:job.options?.maxOutputTokens&&Number.isInteger(job.options.maxOutputTokens)&&job.options.maxOutputTokens>=256&&job.options.maxOutputTokens<=32768?job.options.maxOutputTokens:PPT_DESKTOP_MODEL_MAX_OUTPUT_TOKENS,maxRetries:0,abortSignal:deadlineSignal,onError:({error})=>{streamError=error;}});
    let text='',sent=0;
    // After the first visible token, silence longer than the idle window is a
    // stalled upstream: abort and surface a retriable network failure. Before
    // the first token only the total deadline applies (thinking may be silent).
    const reader=streamed.textStream[Symbol.asyncIterator]();
    for(;;){
     const next=await (text?readWithIdleLimit(reader.next(),pptStreamIdleMs(),deadline,stall=>deadlineController.abort(stall)):bounded(reader.next()));
     if(next.done)break;const delta=next.value;
if(firstTokenMs===undefined&&delta)firstTokenMs=Math.round(performance.now()-requestStarted);text+=delta;const now=Date.now();if(progress&&now-sent>=700){sent=now;progress({chars:text.length,text:text.slice(0,60000)});}
    }
    if(streamError)throw streamError;
    if(schema||jsonOutput)await bounded(Promise.resolve(streamed.output));
    if(progress&&text)progress({chars:text.length,text:text.slice(0,60000)});
    return {text:await bounded(Promise.resolve(streamed.text)),finishReason:await bounded(Promise.resolve(streamed.finishReason)),usage:await bounded(Promise.resolve(streamed.usage))};
  };
  // Reviews also stream at the transport layer: a large non-streamed response
  // can time out before the gateway sends headers. Review fragments never
  // enter a slide draft; only the final structured findings complete the job.
  // Language-pair audits and navigation are also real PPT model calls. Keeping
  // these non-streamed left the gateway silent until the entire JSON arrived;
  // the live Factor Zoo audit timed out before planning could even start.
  // Only callers with a draft consumer display progress; every final response
  // still passes the same schema and source validators.
  const invoke=(schema:boolean)=>/^(?:input:|review:|planning:|translation:)/.test(job.options?.stage||'')||progress&&/^(?:content:|outline)/.test(job.options?.stage||'')?stream(schema):call(schema);
  let result; let wireAttempts=1;
  try{result=await invoke(supportsSchema);if(supportsSchema)schemaSupport.set(providerId+':'+job.model,true);}
  catch(error){
    const fallback=pptSchemaFallback(error,supportsSchema);
    if(!fallback||job.options?.maxWireAttempts===1)throw Object.assign(error instanceof Error?error:new Error('Model request failed'),{telemetry:{wireAttempts,...(classifyModelFailure(error).telemetry||{})}});
    wireAttempts++;
    // A schema compiler 500 gets exactly one JSON retry. Original server
    // validators remain mandatory; transient failures do not disable schemas.
    if(fallback==='unsupported_schema')schemaSupport.set(providerId+':'+job.model,false);
    outputMode=fallback==='schema_server_error'?'json_after_schema_server_error':'json_fallback';try{result=await invoke(false);}catch(secondError){throw Object.assign(secondError instanceof Error?secondError:new Error('Model request failed'),{telemetry:{wireAttempts,...(classifyModelFailure(secondError).telemetry||{})}});}
  }
  const telemetry={wireAttempts,firstTokenMs,finishReason:result.finishReason,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,reasoningTokens:result.usage.outputTokenDetails?.reasoningTokens,outputMode};
  if (result.finishReason === 'length') throw Object.assign(new Error('truncated_output'),{code:'truncated_output',telemetry});
  if(!result.text?.trim())throw Object.assign(new Error('empty_visible_output'),{code:'empty_visible_output',telemetry});
  return {text:result.text,telemetry};
  }finally{clearTimeout(deadlineTimer);}
};

/** Which channel a job takes (Fable 2026-11-03, Q1/Q2): an Anthropic-protocol
 * provider goes through AIMate's Claude Agent SDK helper (the bundled Claude
 * Code), unless the setting ppt_model_channel is "direct"; providers AIMate runs
 * only natively (openai-compatible, openrouter, google) and jobs with images
 * stay direct. */
export function pptModelChannel(job:Pick<Job,'options'>,provider:{protocol?:string}|undefined,forced=getSetting('ppt_model_channel')):'agent_sdk'|'direct'{
 if(forced==='direct'||job.options?.images?.length)return 'direct';
 return provider?.protocol==='anthropic'?'agent_sdk':'direct';
}
/** At most three SDK calls at once: each is a Claude Code subprocess (Fable Q5). */
export const PPT_AGENT_SDK_CONCURRENCY=3;
let sdkActive=0;const sdkWaiting:(()=>void)[]=[];
export async function withSdkSlot<T>(work:()=>Promise<T>):Promise<T>{
 if(sdkActive>=PPT_AGENT_SDK_CONCURRENCY)await new Promise<void>(resolve=>sdkWaiting.push(resolve));
 sdkActive++;
 try{return await work();}finally{sdkActive--;sdkWaiting.shift()?.();}
}
/** A failure of the SDK's own machinery (the subprocess, its binary, the CLI),
 * not of the model: the job falls back to the direct channel once (Fable Q3). */
export function sdkInfrastructureFailure(error:unknown):boolean{
 const e=error as {code?:string;message?:string;stderr?:string};
 if(['timeout','auth','rate_limit','model_not_found','model_unavailable','request_invalid','truncated_output','empty_visible_output','invalid_json'].includes(e?.code||''))return false;
 return ['ENOENT','EACCES','EPIPE','ERR_CHILD_PROCESS'].includes(e?.code||'')||/spawn|ENOENT|executable|Claude Code (?:process|native binary)|exited with code|process exited/i.test(String(e?.message||''));
}
/** The Agent SDK channel: one single-turn, tool-free query with the job's JSON
 * schema. No live draft on this channel yet (Fable Q4): only the final text. */
export async function agentSdkGenerate(job:Job,providerId:string,sdk:{generateTextViaSdk:(params:Parameters<typeof generateTextViaSdk>[0])=>Promise<string>}={generateTextViaSdk}):Promise<GenerateResult>{
 const promptBytes=new TextEncoder().encode(job.prompt).byteLength;
 const extended=job.options?.timeoutMs===420000&&(/^review:deck(?:$|:)/.test(job.options?.stage||'')&&promptBytes>=90000||/^outline(?:$|:)/.test(job.options?.stage||'')&&promptBytes>=120000);
 const started=performance.now(),schema=Boolean(job.options?.jsonSchema);
 try{
  const text=await sdk.generateTextViaSdk({providerId,model:job.model,system:'You are one step of a presentation pipeline. Answer exactly as the prompt asks, with the requested JSON only.',prompt:job.prompt,timeoutMs:extended?420000:240000,
   ...(schema?{outputFormat:{type:'json_schema' as const,schema:job.options!.jsonSchema as Record<string,unknown>}}:{})});
  if(!text?.trim())throw Object.assign(new Error('empty_visible_output'),{code:'empty_visible_output'});
  return {text,telemetry:{wireAttempts:1,outputMode:schema?'agent_sdk_schema':'agent_sdk'}};
 }catch(error){
  const message=String((error as Error)?.message||'');
  // Name the model's own failures as the direct channel does, so the server's retries apply.
  if(/timed out after/i.test(message))throw Object.assign(error as Error,{code:'timeout'});
  if(/not logged in|invalid api key|authentication|401|403/i.test(message))throw Object.assign(error as Error,{code:'auth'});
  if(/rate.?limit|429/i.test(message))throw Object.assign(error as Error,{code:'rate_limit'});
  throw Object.assign(error instanceof Error?error:new Error('Agent SDK request failed'),{elapsedMs:Math.round(performance.now()-started)});
 }
}
/** The PPT model call: the Agent SDK channel where it applies, else direct; an
 * SDK machinery failure falls back to direct once for this job, logged. */
export const pptGenerate=async (job:Job,providerId:string,progress?:Progress):Promise<GenerateResult>=>{
 if(pptModelChannel(job,getProvider(providerId))==='agent_sdk'){
  try{return await withSdkSlot(()=>agentSdkGenerate(job,providerId));}
  catch(error){
   if(!sdkInfrastructureFailure(error))throw error;
   console.warn('[ppt-agent-sdk-fallback]',JSON.stringify({stage:job.options?.stage,reason:String((error as Error)?.message||'').slice(0,120)}));
  }
 }
 return directGenerate(job,providerId,progress);
};

export async function executeDesktopModelJob(id: string, upstream: JobRequest, generate: (job:Job,providerId:string,progress?:Progress)=>Promise<string|GenerateResult> = pptGenerate) {
  if (!/^[a-f0-9]{32}$/.test(id)) return { status: 400, error: 'Invalid model job ID' };
  const claim = await upstream(`model-jobs/${id}/claim`, {});
  if (!claim.ok) return { status: claim.status, error: 'Model job unavailable' };
  const job: Job = await claim.json();
  const started=performance.now();let phase='model';let firstTokenMs:number|undefined,receivedChars=0;
  try {
    if (job.id !== id || !/^byok:[a-zA-Z0-9_-]{1,100}$/.test(job.configId) || typeof job.prompt !== 'string' || job.prompt.length > 2000000 || typeof job.model !== 'string' || !job.model || job.model.length > 120) throw new Error('Invalid server job');
    const providerId = job.configId.slice(5);
    const provider = getProvider(providerId);
    if (!provider || provider.source === 'managed' || !provider.api_key || !['openai-compatible', 'anthropic', 'google', 'openrouter'].includes(provider.protocol || '')) throw new Error('Local provider is unavailable');
    let progressSeq=0,draining=false;let queuedProgress:{lease:string;seq:number;chars:number;text:string}|undefined,pendingProgress:Promise<void>=Promise.resolve();
    const drainProgress=async()=>{draining=true;try{while(queuedProgress){const packet=queuedProgress;queuedProgress=undefined;await upstream(`model-jobs/${id}/progress`,packet).catch(()=>{});}}finally{draining=false;}};
    // One in-flight and one latest packet, never an unbounded FIFO. A slow
    // progress endpoint must not keep a finished model job waiting for minutes.
    const progress: Progress = value => {firstTokenMs??=Math.round(performance.now()-started);receivedChars=value.chars;queuedProgress={lease:job.lease,seq:++progressSeq,chars:value.chars,text:value.text};if(!draining)pendingProgress=drainProgress();};
    const generated = await generate(job, providerId, progress);
    await pendingProgress;
    const text = typeof generated === 'string' ? generated : generated.text;
    const telemetry = typeof generated === 'string' ? undefined : generated.telemetry;
    phase='delivery';
    // The result POST can hit a pooled socket the server just closed after a
    // long synchronous step; retry on a fresh connection (lease keeps it idempotent).
    let complete:Response|undefined;
    for(let attempt=0;attempt<3;attempt++){
      try{complete=await upstream(`model-jobs/${id}/complete`, {lease:job.lease,text,telemetry},{freshConnection:attempt>0});break;}
      catch(error){if(classifyModelFailure(error).code!=='network'||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));}
    }
    if(!complete)throw new Error('Model result delivery unavailable');
    if (!complete.ok) return { status: complete.status, error: 'Model job expired before completion' };
    return { status: 200 };
  } catch (error) {
    const safe=classifyModelFailure(error);
    const diagnostic={...safe.diagnostic,origin:'execution',elapsedMs:Math.round(performance.now()-started),firstTokenMs,receivedChars};
    // Log only allowlisted transport metadata, never upstream bodies, URLs,
    // headers or SDK messages (which can echo credentials).
    console.warn('[ppt-model-failure]',JSON.stringify({stage:job.options?.stage,phase,elapsedMs:Math.round(performance.now()-started),code:safe.code,...safe.diagnostic}));
    await upstream(`model-jobs/${id}/complete`, { lease: job.lease, error: safe.code, diagnostic, telemetry:safe.telemetry }).catch(() => {});
    // No SDK/upstream error bodies escape: these may contain URLs, headers or key echoes.
    return { status: 502, error: `PPT model failure: ${safe.code}${safe.diagnostic?.httpStatus?` (HTTP ${safe.diagnostic.httpStatus})`:safe.diagnostic?.kind?` (${safe.diagnostic.kind})`:''}` };
  }
}

export function classifyModelFailure(error:unknown){
  const e=error as {code?:string;name?:string;text?:string;usage?:{inputTokens?:number;outputTokens?:number;outputTokenDetails?:{reasoningTokens?:number}};statusCode?:number;finishReason?:string;telemetry?:{retryAfterMs?:number;wireAttempts?:number;finishReason?:string;inputTokens?:number;outputTokens?:number;reasoningTokens?:number;outputMode?:string}};
  const codes=['transport','timeout','network','rate_limit','request_invalid','auth','model_not_found','model_unavailable','empty_visible_output','truncated_output','invalid_json','input_budget'];
  const initialCode=e?.finishReason==='length'?'truncated_output':codes.includes(e?.code||'')?e.code!:e?.statusCode===401||e?.statusCode===403?'auth':e?.statusCode===404||e?.statusCode===503?'model_unavailable':/NoOutputGenerated/.test(e?.name||'')||/NoObjectGenerated/.test(e?.name||'')&&!e?.text?.trim()?'empty_visible_output':/NoObjectGenerated|JSONParse/.test(e?.name||'')?'invalid_json':'transport';
  const t=e?.telemetry|| (e?.usage?{finishReason:e.finishReason,inputTokens:e.usage.inputTokens,outputTokens:e.usage.outputTokens,reasoningTokens:e.usage.outputTokenDetails?.reasoningTokens}:undefined);
  const chain:unknown[]=[error];for(let i=0;i<3;i++){const cause=(chain.at(-1) as {cause?:unknown})?.cause;if(!cause)break;chain.push(cause);}
  const status=chain.map(x=>(x as {statusCode?:number})?.statusCode).find(n=>Number.isInteger(n)&&Number(n)>=400&&Number(n)<=599);
  // A connect timeout means the request never reached the gateway: it is a
  // network failure that is safe to retry, unlike a model that stopped answering.
  const timeout=chain.some(x=>['AbortError','TimeoutError'].includes((x as {name?:string})?.name||'')||['UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT'].includes((x as {code?:string})?.code||''));
  const network=chain.some(x=>['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes((x as {code?:string})?.code||''));
  const stalled=chain.some(x=>(x as {stalled?:string})?.stalled==='idle');
  const diagnostic=status||timeout||network||stalled?{httpStatus:status,kind:stalled?'stalled':timeout?'timeout':network?'network':undefined}:undefined;
  const code=codes.includes(e?.code||'')?e.code!:status===401||status===403?'auth':status===404?'model_not_found':status===429?'rate_limit':status===400?(chain.some(x=>/context.{0,20}(?:length|window)|maximum.{0,12}tokens|too many tokens|input.{0,20}(?:long|limit)/i.test(String((x as {message?:string})?.message||'')))?'input_budget':'request_invalid'):timeout?'timeout':network?'network':initialCode;
  let retryAfterMs:number|undefined;
  for(const item of chain){const headers=(item as {responseHeaders?:Record<string,string>})?.responseHeaders;const value=headers?.['retry-after'];if(value){const seconds=Number(value);const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-Date.now();if(Number.isFinite(delay)&&delay>0)retryAfterMs=Math.min(60000,delay);}}
  return {code,diagnostic,telemetry:t||retryAfterMs?{retryAfterMs,...(t?{wireAttempts:Number.isInteger(t.wireAttempts)&&Number(t.wireAttempts)>=1&&Number(t.wireAttempts)<=5?t.wireAttempts:undefined,outputMode:['schema','json','json_fallback','json_after_schema_server_error','text'].includes(t.outputMode||'')?t.outputMode:undefined,finishReason:['stop','length','error','other','unknown'].includes(t.finishReason||'')?t.finishReason:undefined,inputTokens:Number.isFinite(t.inputTokens)&&(t.inputTokens||0)>=0?t.inputTokens:undefined,outputTokens:Number.isFinite(t.outputTokens)&&(t.outputTokens||0)>=0?t.outputTokens:undefined,reasoningTokens:Number.isFinite(t.reasoningTokens)&&(t.reasoningTokens||0)>=0?t.reasoningTokens:undefined}:{})}:undefined};
}

export function pptSchemaFallback(error:unknown,supportsSchema:boolean):'unsupported_schema'|'schema_server_error'|null {
 if(!supportsSchema)return null;const chain:unknown[]=[error];
 for(let i=0;i<3;i++){const cause=(chain.at(-1) as {cause?:unknown})?.cause;if(!cause)break;chain.push(cause);}
 if(chain.some(e=>(e as {statusCode?:number}).statusCode===500))return 'schema_server_error';
 if(chain.some(e=>{const value=e as {statusCode?:number;message?:string};return value.statusCode===400&&/json_schema|response_format|structured output/i.test(value.message||'');}))return 'unsupported_schema';
 return null;
}

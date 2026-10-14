import { generateText, streamText, Output, jsonSchema } from 'ai';
import { createModel } from '@/lib/ai-provider';
import { getProvider } from '@/lib/db';

type Job = { id: string; configId: string; model: string; prompt: string; lease: string; options?: {timeoutMs?: number;stage?: string;maxOutputTokens?: number;jsonSchema?: Record<string, unknown>} };
type JobRequest = (path: string, body: unknown) => Promise<Response>;

export const PPT_DESKTOP_MODEL_MAX_OUTPUT_TOKENS = 32768;
export const PPT_DESKTOP_MODEL_JSON_OUTPUT = true;
const schemaSupport=new Map<string,boolean>();

/** Claims the account-owned server prompt. Browser-supplied prompts/URLs/keys are never used. */
type Progress = (progress: {chars:number;text:string}) => void;
export async function executeDesktopModelJob(id: string, upstream: JobRequest, generate: (job:Job,providerId:string,progress?:Progress)=>Promise<string|{text:string;telemetry?:{finishReason?:string;inputTokens?:number;outputTokens?:number;reasoningTokens?:number;outputMode?:string}}> = async (job: Job, providerId: string, progress?: Progress) => {
  // Source/outline and structured deck findings have finite JSON contracts.
  // DeepSeek's optional hidden reasoning otherwise consumes the wall-clock
  // budget before findings arrive; writer requests keep their default mode.
  const { languageModel } = createModel({ providerId, model: job.model,...((/^deepseek(?:-|\/)/i.test(job.model)&&/^(?:outline|source|planning:|review:|content:.*:postwriter)/.test(job.options?.stage||'')||/^qwen(?:3[.\/-]|-)/i.test(job.model)&&/^(?:outline|source|translation:|planning:|review:|content:)/.test(job.options?.stage||''))?{thinkingMode:'disabled' as const}:{}) });
  const provider = getProvider(providerId);
  const jsonOutput = PPT_DESKTOP_MODEL_JSON_OUTPUT && ['openai-compatible', 'openrouter'].includes(provider?.protocol || '');
  const supportsSchema=Boolean(job.options?.jsonSchema) && schemaSupport.get(providerId+':'+job.model)!==false;
  let outputMode=supportsSchema?'schema':jsonOutput?'json':'text';
  const promptBytes=new TextEncoder().encode(job.prompt).byteLength;
  const extended=job.options?.timeoutMs===420000&&(/^review:deck(?:$|:)/.test(job.options.stage||'')&&promptBytes>=90000||/^outline(?:$|:)/.test(job.options.stage||'')&&promptBytes>=120000);
  const timeoutMs=extended?420000:240000;
  const deadlineSignal=AbortSignal.timeout(timeoutMs);
  const call=(schema:boolean)=>generateText({model:languageModel,prompt:job.prompt,...(schema?{output:Output.object({schema:jsonSchema(job.options!.jsonSchema!)})}:jsonOutput?{output:Output.json()}:{}),maxOutputTokens:job.options?.maxOutputTokens&&[8192,16384,32768].includes(job.options.maxOutputTokens)?job.options.maxOutputTokens:PPT_DESKTOP_MODEL_MAX_OUTPUT_TOKENS,maxRetries:0,abortSignal:deadlineSignal});
  // Writer pages stream so the editor can show a live draft (V-P0-3). The
  // final text is validated exactly like a non-streamed result; only a bounded
  // partial text is reported, at most every 700 ms.
  const stream=async(schema:boolean)=>{
    let streamError:unknown;
    const streamed=streamText({model:languageModel,prompt:job.prompt,...(schema?{output:Output.object({schema:jsonSchema(job.options!.jsonSchema!)})}:jsonOutput?{output:Output.json()}:{}),maxOutputTokens:job.options?.maxOutputTokens&&[8192,16384,32768].includes(job.options.maxOutputTokens)?job.options.maxOutputTokens:PPT_DESKTOP_MODEL_MAX_OUTPUT_TOKENS,maxRetries:0,abortSignal:deadlineSignal,onError:({error})=>{streamError=error;}});
    let text='',sent=0;
    for await(const delta of streamed.textStream){text+=delta;const now=Date.now();if(progress&&now-sent>=700){sent=now;progress({chars:text.length,text:text.slice(0,60000)});}}
    if(streamError)throw streamError;
    if(schema||jsonOutput)await streamed.output;
    if(progress&&text)progress({chars:text.length,text:text.slice(0,60000)});
    return {text:await streamed.text,finishReason:await streamed.finishReason,usage:await streamed.usage};
  };
  // Reviews also stream at the transport layer: a large non-streamed response
  // can time out before the gateway sends headers. Review fragments never
  // enter a slide draft; only the final structured findings complete the job.
  const invoke=(schema:boolean)=>/^review:/.test(job.options?.stage||'')||progress&&/^(?:content:|outline)/.test(job.options?.stage||'')?stream(schema):call(schema);
  let result;
  try{result=await invoke(supportsSchema);if(supportsSchema)schemaSupport.set(providerId+':'+job.model,true);}
  catch(error){
    const fallback=pptSchemaFallback(error,supportsSchema);
    if(!fallback)throw error;
    // A schema compiler 500 gets exactly one JSON retry. Original server
    // validators remain mandatory; transient failures do not disable schemas.
    if(fallback==='unsupported_schema')schemaSupport.set(providerId+':'+job.model,false);
    outputMode=fallback==='schema_server_error'?'json_after_schema_server_error':'json_fallback';result=await invoke(false);
  }
  const telemetry={finishReason:result.finishReason,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,reasoningTokens:result.usage.outputTokenDetails?.reasoningTokens,outputMode};
  if (result.finishReason === 'length') throw Object.assign(new Error('truncated_output'),{code:'truncated_output',telemetry});
  if(!result.text?.trim())throw Object.assign(new Error('empty_visible_output'),{code:'empty_visible_output',telemetry});
  return {text:result.text,telemetry};
}) {
  if (!/^[a-f0-9]{32}$/.test(id)) return { status: 400, error: 'Invalid model job ID' };
  const claim = await upstream(`model-jobs/${id}/claim`, {});
  if (!claim.ok) return { status: claim.status, error: 'Model job unavailable' };
  const job: Job = await claim.json();
  try {
    if (job.id !== id || !/^byok:[a-zA-Z0-9_-]{1,100}$/.test(job.configId) || typeof job.prompt !== 'string' || job.prompt.length > 2000000 || typeof job.model !== 'string' || !job.model || job.model.length > 120) throw new Error('Invalid server job');
    const providerId = job.configId.slice(5);
    const provider = getProvider(providerId);
    if (!provider || provider.source === 'managed' || !provider.api_key || !['openai-compatible', 'anthropic', 'google', 'openrouter'].includes(provider.protocol || '')) throw new Error('Local provider is unavailable');
    let progressSeq=0;
    const progress: Progress = value => { void upstream(`model-jobs/${id}/progress`, { lease: job.lease, seq:++progressSeq, chars: value.chars, text: value.text }).catch(() => {}); };
    const generated = await generate(job, providerId, progress);
    const text = typeof generated === 'string' ? generated : generated.text;
    const telemetry = typeof generated === 'string' ? undefined : generated.telemetry;
    const complete = await upstream(`model-jobs/${id}/complete`, { lease: job.lease, text, telemetry });
    if (!complete.ok) return { status: complete.status, error: 'Model job expired before completion' };
    return { status: 200 };
  } catch (error) {
    const safe=classifyModelFailure(error);
    // Log only allowlisted transport metadata, never upstream bodies, URLs,
    // headers or SDK messages (which can echo credentials).
    console.warn('[ppt-model-failure]',JSON.stringify({stage:job.options?.stage,code:safe.code,...safe.diagnostic}));
    await upstream(`model-jobs/${id}/complete`, { lease: job.lease, error: safe.code, telemetry:safe.telemetry }).catch(() => {});
    // No SDK/upstream error bodies escape: these may contain URLs, headers or key echoes.
    return { status: 502, error: `PPT model failure: ${safe.code}${safe.diagnostic?.httpStatus?` (HTTP ${safe.diagnostic.httpStatus})`:safe.diagnostic?.kind?` (${safe.diagnostic.kind})`:''}` };
  }
}

export function classifyModelFailure(error:unknown){
  const e=error as {code?:string;name?:string;text?:string;usage?:{inputTokens?:number;outputTokens?:number;outputTokenDetails?:{reasoningTokens?:number}};statusCode?:number;finishReason?:string;telemetry?:{finishReason?:string;inputTokens?:number;outputTokens?:number;reasoningTokens?:number;outputMode?:string}};
  const codes=['transport','timeout','network','rate_limit','request_invalid','auth','model_unavailable','empty_visible_output','truncated_output','invalid_json','input_budget'];
  const initialCode=e?.finishReason==='length'?'truncated_output':codes.includes(e?.code||'')?e.code!:e?.statusCode===401||e?.statusCode===403?'auth':e?.statusCode===404||e?.statusCode===503?'model_unavailable':/NoOutputGenerated/.test(e?.name||'')||/NoObjectGenerated/.test(e?.name||'')&&!e?.text?.trim()?'empty_visible_output':/NoObjectGenerated|JSONParse/.test(e?.name||'')?'invalid_json':'transport';
  const t=e?.telemetry|| (e?.usage?{finishReason:e.finishReason,inputTokens:e.usage.inputTokens,outputTokens:e.usage.outputTokens,reasoningTokens:e.usage.outputTokenDetails?.reasoningTokens}:undefined);
  const chain:unknown[]=[error];for(let i=0;i<3;i++){const cause=(chain.at(-1) as {cause?:unknown})?.cause;if(!cause)break;chain.push(cause);}
  const status=chain.map(x=>(x as {statusCode?:number})?.statusCode).find(n=>Number.isInteger(n)&&Number(n)>=400&&Number(n)<=599);
  const timeout=chain.some(x=>['AbortError','TimeoutError'].includes((x as {name?:string})?.name||'')||['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT'].includes((x as {code?:string})?.code||''));
  const network=chain.some(x=>['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes((x as {code?:string})?.code||''));
  const diagnostic=status||timeout||network?{httpStatus:status,kind:timeout?'timeout':network?'network':undefined}:undefined;
  const code=codes.includes(e?.code||'')?e.code!:status===429?'rate_limit':status===400?(chain.some(x=>/context.{0,20}(?:length|window)|maximum.{0,12}tokens|too many tokens|input.{0,20}(?:long|limit)/i.test(String((x as {message?:string})?.message||'')))?'input_budget':'request_invalid'):timeout?'timeout':network?'network':initialCode;
  return {code,diagnostic,telemetry:t?{outputMode:['schema','json','json_fallback','text'].includes(t.outputMode||'')?t.outputMode:undefined,finishReason:['stop','length','error','other','unknown'].includes(t.finishReason||'')?t.finishReason:undefined,inputTokens:Number.isFinite(t.inputTokens)&&(t.inputTokens||0)>=0?t.inputTokens:undefined,outputTokens:Number.isFinite(t.outputTokens)&&(t.outputTokens||0)>=0?t.outputTokens:undefined,reasoningTokens:Number.isFinite(t.reasoningTokens)&&(t.reasoningTokens||0)>=0?t.reasoningTokens:undefined}:undefined};
}

export function pptSchemaFallback(error:unknown,supportsSchema:boolean):'unsupported_schema'|'schema_server_error'|null {
 if(!supportsSchema)return null;const chain:unknown[]=[error];
 for(let i=0;i<3;i++){const cause=(chain.at(-1) as {cause?:unknown})?.cause;if(!cause)break;chain.push(cause);}
 if(chain.some(e=>(e as {statusCode?:number}).statusCode===500))return 'schema_server_error';
 if(chain.some(e=>{const value=e as {statusCode?:number;message?:string};return value.statusCode===400&&/json_schema|response_format|structured output/i.test(value.message||'');}))return 'unsupported_schema';
 return null;
}

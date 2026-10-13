import { outlineError, OUTLINE_ERROR_CODES } from './ppt-outline-protocol.mjs';
/** Desktop BYOK model bridge. Keys stay on the desktop; jobs hold only prompts/results.
 * Transient queue: a restart fails in-flight calls and normal PPT checkpoints retry them. */
import crypto from 'node:crypto';

export const PPT_BYOK_CAPABILITIES = Object.freeze({
  protocolVersion: 1, transport: 'desktop-model-jobs',
  credentialLocation: 'desktop', requiresOpenClient: true,
  maxPromptBytes: 2000000, maxResultBytes: 4000000,
  jobTimeoutMs: 300000, largeReviewJobTimeoutMs: 450000, largeOutlineJobTimeoutMs:450000, concurrency: 3,
});

export function createPptModelJobs({ timeoutMs, limit = 1000 } = {}) {
  const jobs = new Map(),clients=new Map();
  const eligible = configId => typeof configId === 'string' && /^byok:[a-zA-Z0-9_-]{1,100}$/.test(configId);
  function request(project, prompt, canStart = () => true, options = {}) {
    if (!eligible(project.configId)) return Promise.reject(new Error('Invalid local provider reference'));
    if (jobs.size >= limit || [...jobs.values()].filter(job => job.uid === project.uid).length >= 12) return Promise.reject(new Error('Desktop model queue is full'));
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 2000000) return Promise.reject(outlineError('input_budget'));
    // Real review batches of about 100 KiB / 30k input tokens can exceed four
    // minutes, particularly after the one permitted schema transport fallback.
    const largeReview = /^review:deck(?:$|:)/u.test(options.stage||'') && Buffer.byteLength(prompt) >= 90000;
    const largeOutline = /^outline(?:$|:)/u.test(options.stage||'') && Buffer.byteLength(prompt) >= 120000;
    const modelTimeoutMs = largeReview||largeOutline ? 420000 : 240000;
    const jobTimeoutMs = timeoutMs ?? (largeReview||largeOutline ? 450000 : 300000);
    return new Promise((resolve, reject) => {
      const id = crypto.randomBytes(16).toString('hex');
      const job = { id, uid: project.uid, projectId: project.id, configId: project.configId, model: project.model, prompt, options:{timeoutMs:modelTimeoutMs,stage:String(options.stage||'').slice(0,80),maxOutputTokens:[8192,16384,32768].includes(options.maxOutputTokens)?options.maxOutputTokens:/^outline/.test(options.stage||'')?(/^deepseek(?:-|\/)/i.test(project.model)?16384:8192):32768,...(options.jsonSchema?{jsonSchema:options.jsonSchema}:{})}, onTelemetry:options.onTelemetry, lease: null, createdAt: Date.now() };
      if (typeof options.onProgress === 'function') job.onProgress = options.onProgress;
      const finish = (error, result) => { clearTimeout(job.timer); clearInterval(job.check); jobs.delete(id); error ? reject(error) : resolve(result); };
      job.finish = finish;
      job.jobTimeoutMs=jobTimeoutMs;
      job.timer = setTimeout(() => finish(outlineError('timeout')), jobTimeoutMs);
      job.check = setInterval(() => { if (!canStart()) finish(outlineError('cancelled')); }, 1000);
      jobs.set(id, job);
    });
  }
  function list(uid) { clients.set(uid,Date.now());return [...jobs.values()].filter(job => job.uid === uid && !job.lease).slice(0, 3).map(({ id, projectId }) => ({ id, projectId })); }
  function claim(uid, id) {
    const job = jobs.get(id);
    if (!job || job.uid !== uid || job.lease) return null;
    job.lease = crypto.randomBytes(24).toString('hex');
    clearTimeout(job.timer);
    // Waiting for an available client slot is separate from model execution.
    // Both are bounded; queue time must not consume the claimed model budget.
    job.timer=setTimeout(()=>job.finish(outlineError('timeout')),job.jobTimeoutMs);
    const { prompt, configId, model, projectId, lease, options } = job;
    return { id, prompt, configId, model, projectId, lease, options };
  }
  function complete(uid, id, data) {
    const job = jobs.get(id);
    if (!job || job.uid !== uid || !job.lease || job.lease !== data?.lease) return false;
    if(data.telemetry && job.onTelemetry){const t=data.telemetry;job.onTelemetry({finishReason:['stop','length','error','other','unknown'].includes(t.finishReason)?t.finishReason:undefined,outputMode:['schema','json','json_fallback','json_after_schema_server_error','text'].includes(t.outputMode)?t.outputMode:undefined,inputTokens:Number.isFinite(t.inputTokens)&&t.inputTokens>=0?t.inputTokens:undefined,outputTokens:Number.isFinite(t.outputTokens)&&t.outputTokens>=0?t.outputTokens:undefined,reasoningTokens:Number.isFinite(t.reasoningTokens)&&t.reasoningTokens>=0?t.reasoningTokens:undefined});}
    if (data.error) job.finish(outlineError(OUTLINE_ERROR_CODES.has(data.error)?data.error:'transport'));
    else if (typeof data.text !== 'string' || !data.text.trim() || Buffer.byteLength(data.text) > 4000000) job.finish(outlineError('empty_visible_output'));
    else job.finish(null, data.text);
    return true;
  }
  /** Streaming writer progress from the lease holder. Only a bounded partial
   * text and a character count are accepted; it never completes the job. */
  function progress(uid, id, data) {
    const job = jobs.get(id);
    if (!job || job.uid !== uid || !job.lease || job.lease !== data?.lease) return false;
    const text = typeof data.text === 'string' ? data.text.slice(0, 60000) : '';
    const chars = Number.isFinite(data.chars) && data.chars >= 0 ? Math.min(data.chars, 4000000) : text.length;
    const seq=data.seq===undefined?(job.progressSeq||0)+1:data.seq;
    if(!Number.isSafeInteger(seq)||seq<1||seq<=(job.progressSeq||0)||chars<(job.progressChars||0)||!text.startsWith(job.progressText||''))return false;
    job.progressSeq=seq;job.progressChars=chars;job.progressText=text;
    try { job.onProgress?.({ chars, text, seq, jobId:id }); } catch { /* a draft preview must never fail the job */ }
    return true;
  }
  return { request, list, claim, complete, progress, eligible, state:(uid,projectId)=>{const own=[...jobs.values()].filter(j=>j.uid===uid&&j.projectId===projectId);return {pending:own.filter(j=>!j.lease).length,leased:own.filter(j=>j.lease).length,lastSeen:clients.get(uid)||0};} };
}
export const pptModelJobs = createPptModelJobs();

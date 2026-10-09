/** Desktop BYOK model bridge. Keys stay on the desktop; jobs hold only prompts/results.
 * Transient queue: a restart fails in-flight calls and normal PPT checkpoints retry them. */
import crypto from 'node:crypto';

export const PPT_BYOK_CAPABILITIES = Object.freeze({
  protocolVersion: 1, transport: 'desktop-model-jobs',
  credentialLocation: 'desktop', requiresOpenClient: true,
  maxPromptBytes: 2000000, maxResultBytes: 4000000,
  jobTimeoutMs: 300000, concurrency: 3,
});

export function createPptModelJobs({ timeoutMs = 300000, limit = 1000 } = {}) {
  const jobs = new Map();
  const eligible = configId => typeof configId === 'string' && /^byok:[a-zA-Z0-9_-]{1,100}$/.test(configId);
  function request(project, prompt, canStart = () => true) {
    if (!eligible(project.configId)) return Promise.reject(new Error('Invalid local provider reference'));
    if (jobs.size >= limit || [...jobs.values()].filter(job => job.uid === project.uid).length >= 12) return Promise.reject(new Error('Desktop model queue is full'));
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 2000000) return Promise.reject(new Error('Model prompt exceeds its limit'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomBytes(16).toString('hex');
      const job = { id, uid: project.uid, projectId: project.id, configId: project.configId, model: project.model, prompt, lease: null, createdAt: Date.now() };
      const finish = (error, result) => { clearTimeout(job.timer); clearInterval(job.check); jobs.delete(id); error ? reject(error) : resolve(result); };
      job.finish = finish;
      job.timer = setTimeout(() => finish(new Error('Desktop model worker timed out; keep the PPT page open')), timeoutMs);
      job.check = setInterval(() => { if (!canStart()) finish(new Error('PPT model job cancelled')); }, 1000);
      jobs.set(id, job);
    });
  }
  function list(uid) { return [...jobs.values()].filter(job => job.uid === uid && !job.lease).slice(0, 3).map(({ id, projectId }) => ({ id, projectId })); }
  function claim(uid, id) {
    const job = jobs.get(id);
    if (!job || job.uid !== uid || job.lease) return null;
    job.lease = crypto.randomBytes(24).toString('hex');
    const { prompt, configId, model, projectId, lease } = job;
    return { id, prompt, configId, model, projectId, lease };
  }
  function complete(uid, id, data) {
    const job = jobs.get(id);
    if (!job || job.uid !== uid || !job.lease || job.lease !== data?.lease) return false;
    if (data.error) job.finish(new Error('Desktop model request failed; check local API settings'));
    else if (typeof data.text !== 'string' || !data.text.trim() || Buffer.byteLength(data.text) > 4000000) job.finish(new Error('Desktop model returned invalid text'));
    else job.finish(null, data.text);
    return true;
  }
  return { request, list, claim, complete, eligible };
}
export const pptModelJobs = createPptModelJobs();

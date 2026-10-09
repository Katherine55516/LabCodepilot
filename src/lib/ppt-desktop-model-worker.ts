import { generateText } from 'ai';
import { createModel } from '@/lib/ai-provider';
import { getProvider } from '@/lib/db';

type Job = { id: string; configId: string; model: string; prompt: string; lease: string };
type JobRequest = (path: string, body: unknown) => Promise<Response>;

/** Claims the account-owned server prompt. Browser-supplied prompts/URLs/keys are never used. */
export async function executeDesktopModelJob(id: string, upstream: JobRequest, generate = async (job: Job, providerId: string) => {
  const { languageModel } = createModel({ providerId, model: job.model });
  const result = await generateText({ model: languageModel, prompt: job.prompt, maxOutputTokens: 16384, maxRetries: 0, abortSignal: AbortSignal.timeout(240000) });
  if (result.finishReason === 'length') throw new Error('Model output was truncated');
  return result.text;
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
    const text = await generate(job, providerId);
    const complete = await upstream(`model-jobs/${id}/complete`, { lease: job.lease, text });
    if (!complete.ok) return { status: complete.status, error: 'Model job expired before completion' };
    return { status: 200 };
  } catch {
    await upstream(`model-jobs/${id}/complete`, { lease: job.lease, error: 'local_api_failed' }).catch(() => {});
    // No SDK/upstream error bodies escape: these may contain URLs, headers or key echoes.
    return { status: 502, error: 'Local model request failed. Check key permissions, model ID and connection in API settings.' };
  }
}

/** Explicit Chat Completions transport; never silently switch to /messages or /responses. */
export function compatibleConnectionSuggestion(message: string): string {
  if (message === 'API HTTP 401') return 'Check the API key and whether it is expired or revoked';
  if (message === 'API HTTP 403') return 'Check token permissions, allowed models and IP restrictions';
  if (message === 'API HTTP 429') return 'Check quota and rate limits; retry later';
  if (/^API HTTP 5\d\d$/.test(message)) return 'Gateway or upstream model unavailable. Sync API models and check the exact model ID and channel availability';
  if (message === 'API returned no text') return 'The API returned no visible text. Check model compatibility and generation limits';
  if (/timeout/i.test(message)) return 'Model response timed out. Retry or check upstream latency and model availability';
  return 'Check Base URL, key permissions and exact model ID';
}

export function compatibleBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid API Base URL');
  const base = url.href.replace(/\/+$/, '');
  return url.pathname === '/' ? `${base}/v1` : base;
}

export async function compatibleRequest(base: string, key: string, path: '/models' | '/chat/completions', body?: unknown, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${compatibleBaseUrl(base)}${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  // Do not include upstream bodies in errors: gateways sometimes echo credentials.
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  return response.json();
}

export async function discoverCompatibleModels(base: string, key: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const data = await compatibleRequest(base, key, '/models', undefined, fetcher);
  if (!Array.isArray(data.data)) throw new Error('Invalid models response');
  return [...new Set<string>(data.data.flatMap((item: { id?: unknown }) => typeof item.id === 'string' && item.id.trim() && item.id.length <= 120 ? [item.id.trim()] : []))].slice(0, 1000);
}

export async function probeCompatibleModel(base: string, key: string, model: string, fetcher: typeof fetch = fetch) {
  if (!model.trim()) throw new Error('Model ID is required');
  const data = await compatibleRequest(base, key, '/chat/completions', {
    // Reasoning models may spend part of this budget before producing visible text.
    model, messages: [{ role: 'user', content: 'Reply only with OK.' }], max_tokens: 128, stream: false,
  }, fetcher);
  if (!data.choices?.length || typeof data.choices[0]?.message?.content !== 'string' || !data.choices[0].message.content.trim()) throw new Error('API returned no text');
  return { success: true, model, actualModel: typeof data.model === 'string' ? data.model : model };
}

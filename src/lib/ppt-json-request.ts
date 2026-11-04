/** Retry only read-only PPT projections, including an interrupted JSON body.
 * Creation/edit requests are never replayed after an unknown network outcome. */
export async function pptJsonRequest(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const readOnly = (init.method || 'GET').toUpperCase() === 'GET';
  const limit = readOnly ? 3 : 1;
  for (let attempt = 0; attempt < limit; attempt++) {
    try {
      const response = await fetcher(url, init);
      if (readOnly && [408, 429, 502, 503, 504].includes(response.status) && attempt + 1 < limit) {
        await response.body?.cancel(); await wait(250 * (attempt + 1)); continue;
      }
      const data = await response.json().catch(error => { if (response.ok) throw error; return {}; });
      return { response, data };
    } catch (error) {
      if (!readOnly || init.signal?.aborted || attempt + 1 === limit
          || !(error instanceof TypeError || error instanceof SyntaxError)) throw error;
      await wait(250 * (attempt + 1));
    }
  }
  throw new Error('PPT read retries exhausted');
}

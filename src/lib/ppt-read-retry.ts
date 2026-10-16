/** Retry only idempotent reads during a transient proxy/model-load interruption. */
export async function retryPptRead<T>(read: () => Promise<T>, options: {
  retries?: number; wait?: (milliseconds: number) => Promise<void>;
} = {}): Promise<T> {
  const retries = options.retries ?? 4;
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      const status = (error as {status?: number})?.status;
      const transient = status !== undefined ? [429, 502, 503, 504].includes(status)
        : error instanceof TypeError || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      if (!transient || attempt >= retries) throw error;
      await wait(Math.min(4000, 500 * 2 ** attempt));
    }
  }
}

/** A dropped keep-alive socket can fail before an upstream GET returns any
 * response. Retry that read once inside the proxy, so a recovered connection
 * is not exposed as a false HTTP 503. Writes and received HTTP errors pass
 * through unchanged; a returned streaming body is never replayed. */
export async function retryPptUpstreamRead<T>(method: string, read: () => Promise<T>, options: {
  signal?: AbortSignal; wait?: (milliseconds: number) => Promise<void>;
} = {}): Promise<T> {
  try { return await read(); }
  catch (error) {
    const code = (error as {cause?: {code?: string}})?.cause?.code;
    const dropped = error instanceof TypeError && (code
      ? ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
      : error.message === 'fetch failed');
    if (method !== 'GET' || options.signal?.aborted || !dropped) throw error;
    await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(500);
    if (options.signal?.aborted) throw options.signal.reason;
    return read();
  }
}

import { EngineError } from './engine';
import { DeckConflictError } from './store';

/** Shared JSON error mapping for the /api/decks routes (route files export handlers only). */
export async function respond(fn: () => Promise<unknown> | unknown, status = 200): Promise<Response> {
  try {
    const body = await fn();
    if (body instanceof Response) return body;
    return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof EngineError) return Response.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    if (error instanceof DeckConflictError) return Response.json({ error: error.message, code: 'version_conflict' }, { status: 409 });
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Deck not found') return Response.json({ error: message }, { status: 404 });
    console.error('[decks]', error);
    return Response.json({ error: message || 'Decks request failed' }, { status: 500 });
  }
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try { return (await request.json()) as T; } catch { throw new EngineError(400, 'The request body must be JSON.'); }
}

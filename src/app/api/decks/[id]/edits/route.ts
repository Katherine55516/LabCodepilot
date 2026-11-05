import { EngineError, startEdit } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import type { AiEditRequest } from '@/lib/decks/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return respond(async () => {
    const body = await readJson<AiEditRequest>(request);
    const scope = body.scope;
    if (!scope || !['deck', 'card', 'block'].includes(scope.kind)) throw new EngineError(400, 'scope must be deck, card or block.');
    return { job: startEdit(id, scope, String(body.instruction || '')) };
  }, 202);
}

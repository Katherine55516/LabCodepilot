import { changeAccent, EngineError } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import type { AccentPosition } from '@/lib/decks/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; cardId: string }> };
export async function POST(request: Request, context: Context) {
  const { id, cardId } = await context.params;
  return respond(async () => {
    const body = await readJson<{ action?: string; position?: AccentPosition; mediaId?: string }>(request);
    if (body.action !== 'regenerate' && body.action !== 'clear' && body.action !== 'set') throw new EngineError(400, 'action must be regenerate, clear or set.');
    return { deck: await changeAccent(id, cardId, { action: body.action, position: body.position, mediaId: body.mediaId }) };
  });
}

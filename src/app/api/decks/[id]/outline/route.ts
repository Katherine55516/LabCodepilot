import { saveOutline, startOutline } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import type { SaveOutlineRequest } from '@/lib/decks/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
/** Save the author's outline edits (merge / add / reorder / per-card instructions). */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return respond(async () => { const body = await readJson<SaveOutlineRequest>(request); return { deck: saveOutline(id, body.outline || [], body.settings) }; });
}
/** Rewrite the outline, optionally with an instruction or a new card count. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return respond(async () => { const body = await readJson<{ instruction?: string; numCards?: number }>(request); return { job: startOutline(id, { instruction: typeof body.instruction === 'string' ? body.instruction.slice(0, 2000) : undefined, numCards: typeof body.numCards === 'number' ? body.numCards : undefined, keepTitle: true }) }; }, 202);
}

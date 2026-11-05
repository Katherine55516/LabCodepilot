import { saveDeck } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import { getDeck, latestJob, listMedia, listProposals, softDeleteDeck } from '@/lib/decks/store';
import type { SaveDeckRequest } from '@/lib/decks/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return respond(() => {
    const deck = getDeck(id);
    if (!deck) throw new Error('Deck not found');
    const job = latestJob(id) || undefined;
    return { deck, job, proposals: listProposals(id), media: listMedia(id) };
  });
}
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return respond(async () => ({ deck: saveDeck(id, await readJson<SaveDeckRequest>(request)) }));
}
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  return respond(() => { if (!softDeleteDeck(id)) throw new Error('Deck not found'); return { ok: true }; });
}

import { createDeck } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import { listDecks } from '@/lib/decks/store';
import type { CreateDeckRequest } from '@/lib/decks/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() { return respond(() => ({ decks: listDecks() })); }
export async function POST(request: Request) {
  return respond(async () => createDeck(await readJson<CreateDeckRequest>(request)), 201);
}

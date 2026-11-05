import { respond } from '@/lib/decks/http';
import { getDeck, listVersions } from '@/lib/decks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return respond(() => { if (!getDeck(id)) throw new Error('Deck not found'); return { versions: listVersions(id) }; });
}

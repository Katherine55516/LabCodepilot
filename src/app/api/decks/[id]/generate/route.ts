import { startBuild } from '@/lib/decks/engine';
import { respond } from '@/lib/decks/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  return respond(() => ({ job: startBuild(id) }), 202);
}

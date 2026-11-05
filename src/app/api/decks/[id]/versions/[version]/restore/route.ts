import { EngineError, restoreVersion } from '@/lib/decks/engine';
import { respond } from '@/lib/decks/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; version: string }> };
export async function POST(_request: Request, context: Context) {
  const { id, version } = await context.params;
  return respond(() => { const v = Number(version); if (!Number.isInteger(v)) throw new EngineError(400, 'Invalid version'); return { deck: restoreVersion(id, v) }; });
}

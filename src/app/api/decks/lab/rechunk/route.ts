import { EngineError } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import { rechunk } from '@/lib/decks/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/decks/lab/rechunk { uploadId, targetCards } → the chunking for another card target. */
export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson<{ uploadId?: string; targetCards?: number }>(request);
    const target = Number(body.targetCards);
    if (!body.uploadId || !Number.isFinite(target) || target < 2) throw new EngineError(400, 'uploadId and targetCards (≥ 2) are required.');
    return rechunk(String(body.uploadId), target);
  });
}

import { EngineError } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import { runLab, type LabRunRequest } from '@/lib/decks/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/decks/lab/run { sourceUploadId, templateUploadId?, targetCards?, settings?, model? } → 201 { deck, job } */
export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson<LabRunRequest>(request);
    if (!body.sourceUploadId) throw new EngineError(400, 'sourceUploadId is required.');
    return runLab(body);
  }, 201);
}

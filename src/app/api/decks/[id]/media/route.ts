import { EngineError } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';
import { fetchPublicImage, MAX_MEDIA_BYTES, storeImage } from '@/lib/decks/media';
import { getDeck } from '@/lib/decks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
/** Add an image from a public HTTPS URL ({ url }) or from the raw request body (upload). */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return respond(async () => {
    if (!getDeck(id)) throw new Error('Deck not found');
    const type = request.headers.get('content-type') || '';
    if (type.startsWith('application/json')) {
      const body = await readJson<{ url?: string }>(request);
      const result = await fetchPublicImage(String(body.url || ''));
      if (!result.ok) throw new EngineError(400, `That image could not be used: ${result.reason}.`);
      return { media: storeImage(id, result.data, 'url', { sourceUrl: String(body.url) }) };
    }
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) throw new EngineError(413, 'Images must be 10 MB or smaller.');
    const data = Buffer.from(await request.arrayBuffer());
    try { return { media: storeImage(id, data, 'upload') }; } catch (error) { throw new EngineError(400, error instanceof Error ? error.message : 'Unsupported image'); }
  }, 201);
}

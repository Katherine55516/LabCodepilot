import { labAsset } from '@/lib/decks/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ uploadId: string; asset: string }> };

/** GET /api/decks/lab/assets/:uploadId/:asset → a figure (F4), template image (img-3) or logo from a lab upload. */
export async function GET(_request: Request, context: Context) {
  const { uploadId, asset } = await context.params;
  const found = /^[\w-]{1,40}$/.test(uploadId) && /^[\w-]{1,20}$/.test(asset) ? labAsset(uploadId, asset) : null;
  if (!found) return Response.json({ error: 'Not found' }, { status: 404 });
  return new Response(new Uint8Array(found.data), { headers: {
    'content-type': found.mime, 'content-length': String(found.data.length), 'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
  } });
}

import { readMedia } from '@/lib/decks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ mediaId: string }> };

export async function GET(_request: Request, context: Context) {
  const { mediaId } = await context.params;
  const found = /^[\w-]{1,60}$/.test(mediaId) ? readMedia(mediaId) : null;
  if (!found) return Response.json({ error: 'Image not found' }, { status: 404 });
  // Raster images only (SVG is never stored); nosniff + a locked-down CSP keep the bytes inert.
  return new Response(new Uint8Array(found.data), { headers: {
    'content-type': found.item.mime, 'content-length': String(found.data.length), 'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
  } });
}

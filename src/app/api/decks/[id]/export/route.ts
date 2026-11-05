import { buildDeckPptx } from '@/lib/decks/export-pptx';
import { respond } from '@/lib/decks/http';
import { getDeck, readMedia } from '@/lib/decks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return respond(async () => {
    const format = new URL(request.url).searchParams.get('format') || 'pptx';
    if (format !== 'pptx') return Response.json({ error: 'PDF and PNG are exported from the app (print and image capture); this route serves pptx.' }, { status: 400 });
    const deck = getDeck(id);
    if (!deck) throw new Error('Deck not found');
    const file = await buildDeckPptx(deck, { readMedia: mediaId => { const m = readMedia(mediaId); return m ? { data: m.data, mime: m.item.mime } : null; } });
    const name = (deck.title || 'deck').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) || 'deck';
    return new Response(new Uint8Array(file), { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'content-disposition': `attachment; filename="deck.pptx"; filename*=UTF-8''${encodeURIComponent(name)}.pptx`,
      'cache-control': 'no-store',
    } });
  });
}

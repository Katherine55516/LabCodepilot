import { getDeck, latestJob, listMedia, listProposals } from '@/lib/decks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Server-sent deck snapshots: emits whenever the deck version, job or proposals change. */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!getDeck(id)) return Response.json({ error: 'Deck not found' }, { status: 404 });
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = '';
      let idle = 0;
      const tick = () => {
        try {
          const deck = getDeck(id);
          if (!deck) { controller.close(); clearInterval(timer); return; }
          const job = latestJob(id) || undefined;
          const proposals = listProposals(id);
          const key = `${deck.version}|${job?.id}|${job?.updatedAt}|${proposals.map(p => p.id + p.status).join(',')}`;
          if (key !== last) {
            last = key; idle = 0;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ deck, job, proposals, media: listMedia(id) })}\n\n`));
          } else if (++idle % 40 === 0) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch { clearInterval(timer); try { controller.close(); } catch { /* closed */ } }
      };
      tick();
      timer = setInterval(tick, 400);
      request.signal.addEventListener('abort', () => { clearInterval(timer); try { controller.close(); } catch { /* closed */ } });
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}

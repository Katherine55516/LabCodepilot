import { isPptProxyPath } from '@/lib/ppt-proxy-path';
import { getCurrentUserUid, getSetting } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ segments: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments } = await context.params;
  if (!isPptProxyPath(segments)) return Response.json({ error: 'Invalid PPT path' }, { status: 404 });
  if (!getCurrentUserUid()) return Response.json({ error: 'Please sign in' }, { status: 401 });
  const base = getSetting('cowork_remote_url')?.trim().replace(/\/+$/, '');
  const token = getSetting('cowork_remote_token')?.trim();
  if (!base || !token) return Response.json({ error: 'Cowork sandbox is not provisioned' }, { status: 503 });
  try {
    const legacyPreview = segments.length === 4 && segments[0] === 'projects' && segments[2] === 'preview' && segments[3].endsWith('.svg');
    const upstreamSegments = legacyPreview ? ['projects', segments[1], 'slides', segments[3].slice(0, -4), 'preview'] : segments;
    const search = legacyPreview ? '?format=svg' : (request.url.includes('?') ? new URL(request.url).search : '');
    const upstream = await fetch(`${base}/ppt/${upstreamSegments.join('/')}${search}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(request.headers.get('accept') ? { accept: request.headers.get('accept')! } : {}),
        ...(request.headers.get('last-event-id') ? { 'last-event-id': request.headers.get('last-event-id')! } : {}),
        ...(request.method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      body: request.method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
    });
    const headers = new Headers();
    for (const key of ['content-type', 'content-length', 'content-disposition', 'etag', 'x-accel-buffering']) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'PPT service unavailable' }, { status: 503 });
  }
}

export async function GET(request: Request, context: Context) { return proxy(request, context); }
export async function POST(request: Request, context: Context) { return proxy(request, context); }
export async function PATCH(request: Request, context: Context) { return proxy(request, context); }
export async function DELETE(request: Request, context: Context) { return proxy(request, context); }

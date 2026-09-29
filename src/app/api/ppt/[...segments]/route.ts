import { getCurrentUserUid, getSetting } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ segments: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments } = await context.params;
  const projectId = /^[a-f0-9]{32}$/i;
  const objectId = /^[a-zA-Z0-9_-]{1,80}$/;
  const legacyProject = segments[0] === 'projects' && segments.length <= 3 &&
    (segments.length === 1 || segments[1] === 'bulk' || projectId.test(segments[1])) &&
    (segments.length < 3 || (segments[1] !== 'bulk' && ['outline', 'generate', 'retry', 'export', 'pdf', 'source', 'duplicate', 'trash', 'restore', 'permanent', 'versions', 'rewrite', 'blank'].includes(segments[2])));
  const structuredProject = segments[0] === 'projects' && projectId.test(segments[1] || '') && (
    (segments.length === 3 && ['run', 'events', 'commands', 'undo', 'redo', 'publish', 'revisions', 'ai-edit'].includes(segments[2])) ||
    (segments.length === 4 && segments[2] === 'preview' && /^[a-zA-Z0-9_-]{1,80}\.svg$/.test(segments[3])) ||
    (segments.length === 5 && segments[2] === 'revisions' && /^\d+$/.test(segments[3]) && segments[4] === 'restore') ||
    (segments.length === 5 && segments[2] === 'slides' && objectId.test(segments[3]) && segments[4] === 'preview')
  );
  const run = segments[0] === 'runs' && segments.length === 2 && /^run_[a-f0-9]{24}$/i.test(segments[1]);
  const project = legacyProject || structuredProject || run;
  const folder = segments[0] === 'folders' && segments.length <= 2 &&
    (segments.length === 1 || /^[a-f0-9]{32}$/i.test(segments[1]));
  const template = segments[0] === 'templates' && segments.length <= 2 &&
    (segments.length === 1 || /^(violet|blue|light|marketing|education|[a-f0-9]{32})$/i.test(segments[1]));
  const update = segments[0] === 'updates' && segments.length === 1;
  if (!project && !folder && !template && !update) {
    return Response.json({ error: 'Invalid PPT path' }, { status: 404 });
  }
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

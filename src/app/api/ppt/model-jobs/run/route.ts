import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserUid, getSetting } from '@/lib/db';
import { executeDesktopModelJob } from '@/lib/ppt-desktop-model-worker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!getCurrentUserUid()) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
  const base = getSetting('cowork_remote_url')?.trim().replace(/\/+$/, '');
  const token = getSetting('cowork_remote_token')?.trim();
  if (!base || !token) return NextResponse.json({ error: 'Cowork sandbox is not provisioned' }, { status: 503 });
  try {
    const { id } = await request.json();
    const outcome = await executeDesktopModelJob(id, (path, body) => fetch(`${base}/ppt/${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
    }));
    return NextResponse.json({ ok: outcome.status === 200, ...(outcome.error ? { error: outcome.error } : {}) }, { status: outcome.status });
  } catch { return NextResponse.json({ error: 'Desktop model bridge unavailable' }, { status: 503 }); }
}

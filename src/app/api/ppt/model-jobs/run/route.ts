import {pptModelJobRequest} from '@/lib/ppt-model-job-request';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserUid, getSetting } from '@/lib/db';
import { executeDesktopModelJob } from '@/lib/ppt-desktop-model-worker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const accountUid=getCurrentUserUid();
  if (!accountUid) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
  const base = getSetting('cowork_remote_url')?.trim().replace(/\/+$/, '');
  const token = getSetting('cowork_remote_token')?.trim();
  if (!base || !token) return NextResponse.json({ error: 'Cowork sandbox is not provisioned' }, { status: 503 });
  try {
    const { id } = await request.json();
    const outcome = await executeDesktopModelJob(id, (path, body, options) => {
      if(getCurrentUserUid()!==accountUid)return Promise.resolve(NextResponse.json({error:'Account changed'},{status:401}));
      return pptModelJobRequest(`${base}/ppt/${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
    },options); });
    // A pause, cancellation or another client may retire a listed job before
    // this request claims/completes it. Acknowledge that expected no-op; real
    // authentication, provider and transport failures keep their error status.
    if ([404,409].includes(outcome.status) && ['Model job unavailable','Model job expired before completion'].includes(outcome.error || ''))
      return NextResponse.json({ok:true,skipped:true,reason:'superseded_model_job'});
    return NextResponse.json({ ok: outcome.status === 200, ...(outcome.error ? { error: outcome.error } : {}) }, { status: outcome.status });
  } catch { return NextResponse.json({ error: 'Desktop model bridge unavailable' }, { status: 503 }); }
}

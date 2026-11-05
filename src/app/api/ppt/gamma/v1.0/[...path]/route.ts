import { getCurrentUserUid, getPptGammaJob, getSetting, insertPptGammaJob, updatePptGammaJob } from '@/lib/db';
import { handleGammaRequest } from '@/lib/ppt-gamma-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  const { path } = await context.params;
  const base = getSetting('cowork_remote_url')?.trim().replace(/\/+$/, '');
  const token = getSetting('cowork_remote_token')?.trim();
  return handleGammaRequest(request, path, {
    apiKey: getSetting('ppt_gamma_api_key')?.trim() || process.env.PPT_GAMMA_API_KEY?.trim() || undefined,
    uid: getCurrentUserUid(),
    store: { insert: insertPptGammaJob, get: getPptGammaJob, update: updatePptGammaJob },
    upstream: async (target, init = {}) => {
      if (!base || !token) return Response.json({ error: 'Cowork sandbox is not provisioned' }, { status: 503 });
      return fetch(`${base}/ppt/${target}`, {
        method: init.method || 'GET',
        headers: { authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.accept ? { accept: init.accept } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store', redirect: 'error',
      });
    },
  });
}

export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }

import { getSetting } from '@/lib/db';
import { handleDecksGammaRequest } from '@/lib/decks/gamma-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

/** Gamma-compatible API v1.0 over Decks (docs/handover/decks-gamma-api.md); the same key as the /ppt facade. */
async function handle(request: Request, context: Context) {
  const { path } = await context.params;
  return handleDecksGammaRequest(request, path, {
    apiKey: getSetting('ppt_gamma_api_key')?.trim() || process.env.PPT_GAMMA_API_KEY?.trim() || undefined,
  });
}

export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }

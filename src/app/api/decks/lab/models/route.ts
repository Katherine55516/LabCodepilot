import { respond } from '@/lib/decks/http';
import { configureProviderFromEnv, labModels } from '@/lib/decks/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/decks/lab/models → configured chat providers and models (no secrets) + env status. */
export async function GET() {
  return respond(() => labModels());
}

/** POST /api/decks/lab/models → create/update the "Decks Lab (env)" provider from DECKS_LAB_* variables. */
export async function POST() {
  return respond(async () => ({ configured: await configureProviderFromEnv(), ...(await labModels()) }));
}

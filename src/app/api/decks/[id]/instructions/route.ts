import { queueInstruction } from '@/lib/decks/engine';
import { readJson, respond } from '@/lib/decks/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return respond(async () => { const body = await readJson<{ text?: string }>(request); return { job: queueInstruction(id, String(body.text || '')) }; }, 202);
}

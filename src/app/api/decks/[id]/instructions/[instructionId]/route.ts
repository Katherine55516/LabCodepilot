import { removeQueuedInstruction } from '@/lib/decks/engine';
import { respond } from '@/lib/decks/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; instructionId: string }> };
export async function DELETE(_request: Request, context: Context) {
  const { id, instructionId } = await context.params;
  return respond(() => ({ job: removeQueuedInstruction(id, instructionId) }));
}

import { applyProposal, discardProposal, EngineError } from '@/lib/decks/engine';
import { respond } from '@/lib/decks/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; proposalId: string; action: string }> };
export async function POST(_request: Request, context: Context) {
  const { id, proposalId, action } = await context.params;
  return respond(() => {
    if (action === 'apply') return { deck: applyProposal(id, proposalId) };
    if (action === 'discard') return { deck: discardProposal(id, proposalId) };
    throw new EngineError(404, 'Unknown action');
  });
}

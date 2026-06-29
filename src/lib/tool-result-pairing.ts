import type { MessageContentBlock } from '@/types';

/**
 * Ensure every tool_use block has a paired tool_result block.
 *
 * An "orphan" tool_use — a tool call that never produced a result (a permission
 * prompt the UI never surfaced, an aborted/timed-out stream, a crash mid-run) —
 * breaks the *next* turn: when the persisted assistant message is replayed to
 * the Vercel AI SDK (agent-loop / native runtime), the SDK validates that every
 * tool-call has a matching tool-result and throws AI_MissingToolResultsError
 * ("Tool results are missing for tool calls ...") before producing any output.
 *
 * This appends a synthetic error tool_result immediately after each orphan
 * tool_use, so call/result pairing is always complete. Used in two places:
 *   1. Persisting a finished/aborted stream (so bad data never enters the DB).
 *   2. Rebuilding history from the DB (so any pre-existing orphan — including
 *      ones left by a different runtime or older builds — is healed before it
 *      reaches the model).
 *
 * Idempotent and allocation-free on the happy path (returns the same array
 * reference when there is nothing to fix).
 */
export function sanitizeOrphanToolUses(blocks: MessageContentBlock[]): MessageContentBlock[] {
  if (blocks.length === 0) return blocks;

  const resolvedIds = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'tool_result' && b.tool_use_id) resolvedIds.add(b.tool_use_id);
  }

  let hasOrphan = false;
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.id && !resolvedIds.has(b.id)) {
      hasOrphan = true;
      break;
    }
  }
  if (!hasOrphan) return blocks; // fast path — every tool_use already paired

  const out: MessageContentBlock[] = [];
  for (const b of blocks) {
    out.push(b);
    if (b.type === 'tool_use' && b.id && !resolvedIds.has(b.id)) {
      out.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content: 'Tool did not complete (interrupted, timed out, or awaiting a permission that was never answered).',
        is_error: true,
      });
    }
  }
  return out;
}

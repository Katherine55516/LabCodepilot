/**
 * Shared renderer for the SSE `error` event payload emitted by claude-client.
 *
 * Three consumers need the SAME text, or the message the user sees during the
 * turn stops matching the one that comes back from the DB after a reload:
 *   - `useSSEStream.ts`      — live ChatView stream (in-memory message)
 *   - `stream-session-manager.ts` — final persisted-in-memory message content
 *   - `api/chat/route.ts`    — server-side tee that writes the row to SQLite
 *
 * Field consequence this exists for: an upstream gateway dropping a stream
 * mid-response ("API Error: Connection closed mid-response") was classified
 * correctly by error-classifier.ts and shipped to the client, but the note
 * was appended only to the flat accumulated text — which
 * buildFinalContentFromBlocks() uses solely as an empty-blocks fallback. Any
 * turn with a thinking or tool block (i.e. nearly all of them) dropped it,
 * and the server never wrote it to the DB at all. The user saw a reply that
 * simply stopped mid-sentence with no error anywhere.
 */

import type { MessageContentBlock } from '@/types';

/** Payload shape claude-client.ts puts in the SSE `error` event's `data`. */
interface ClassifiedErrorPayload {
  category?: string;
  userMessage?: string;
  actionHint?: string;
  details?: string;
  recoveryActions?: Array<{ label: string; url?: string; action?: string }>;
}

function parsePayload(rawData: string): ClassifiedErrorPayload | null {
  try {
    const parsed = JSON.parse(rawData) as ClassifiedErrorPayload;
    // Older/plain-text error frames parse to a string or lack the classifier
    // fields — those callers fall back to the raw text.
    if (parsed && typeof parsed === 'object' && parsed.category && parsed.userMessage) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Render a classified SSE error payload as user-facing markdown.
 * Falls back to the raw frame text for unstructured/legacy payloads.
 *
 * Callers add their own `**Error:** ` prefix — see ERROR_NOTE_PREFIX.
 */
export function formatSseErrorForDisplay(rawData: string): string {
  const parsed = parsePayload(rawData);
  if (!parsed) return rawData;

  let out = parsed.userMessage!;
  if (parsed.actionHint) out += `\n\n**What to do:** ${parsed.actionHint}`;
  if (parsed.details) out += `\n\nDetails: ${parsed.details}`;

  if (parsed.recoveryActions && parsed.recoveryActions.length > 0) {
    const links: string[] = [];
    for (const a of parsed.recoveryActions) {
      if (a.url) {
        links.push(`[${a.label}](${a.url})`);
      } else if (a.action === 'open_settings') {
        links.push(`[${a.label}](/settings#providers)`);
      } else if (a.action === 'new_conversation') {
        links.push(`[${a.label}](/chat)`);
      }
      // 'retry' is surfaced as a chip action, not a link.
    }
    if (links.length > 0) out += '\n\n' + links.join(' · ');
  }

  return out;
}

/** Prefix every surface uses so the error reads the same everywhere. */
export const ERROR_NOTE_PREFIX = '**Error:** ';

/** Full note (prefix + body) to append as a trailing text block. */
export function buildSseErrorNote(rawData: string): string {
  return ERROR_NOTE_PREFIX + formatSseErrorForDisplay(rawData);
}

/**
 * Append the error note to a tee's accumulated content blocks.
 *
 * Flushes any pending text first so the note lands last, in arrival order,
 * and carries its own blank-line separator: a text-only turn is persisted by
 * joining text blocks with '' (they are fragments of one message), so without
 * the gap the note would be glued onto the end of the truncated sentence.
 *
 * Mutates `blocks`; returns the new pending text (always '').
 */
export function pushErrorNoteBlock(
  blocks: MessageContentBlock[],
  pendingText: string,
  rawData: string,
): string {
  if (pendingText.trim()) {
    blocks.push({ type: 'text', text: pendingText });
  }
  const gap = blocks.length > 0 ? '\n\n' : '';
  blocks.push({ type: 'text', text: gap + buildSseErrorNote(rawData) });
  return '';
}

/**
 * Classifier category for an SSE error frame, when it carries one.
 * Drives category-specific affordances (e.g. offering a retry only for
 * transient stream drops, never for an upstream content block).
 */
export function readSseErrorCategory(rawData: string): string | undefined {
  return parsePayload(rawData)?.category;
}

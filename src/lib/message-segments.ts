/**
 * Pure conversion: ordered message content blocks → RenderSegment[] for the
 * interleaved conversation render. Extracted from MessageItem.tsx (a React
 * client component) so the ordering/pairing logic is unit-testable without a
 * DOM. Both the persisted render (MessageItem.parseOrderedSegments) and the
 * live render (StreamingMessage) delegate the new-format walk here.
 */
import type { MediaBlock, RenderSegment } from '@/types';

export interface OrderedBlockShape {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

/**
 * Walk ordered content blocks → RenderSegment[], pairing each tool_use with
 * its tool_result by id (works for parallel tools where results arrive out of
 * position). text / thinking / tool segments preserve the block array order =
 * the true chronological order they occurred.
 */
export function segmentsFromBlocks(blocks: OrderedBlockShape[]): RenderSegment[] {
  const segments: RenderSegment[] = [];

  const resultById = new Map<string, { content?: string; is_error?: boolean; media?: MediaBlock[] }>();
  for (const b of blocks) {
    if (b.type === 'tool_result' && b.tool_use_id) {
      resultById.set(b.tool_use_id, { content: b.content, is_error: b.is_error, media: b.media });
    }
  }

  for (const b of blocks) {
    if (b.type === 'thinking' && b.thinking) {
      segments.push({ kind: 'thinking', thinking: b.thinking });
    } else if (b.type === 'text' && b.text) {
      segments.push({ kind: 'text', text: b.text });
    } else if (b.type === 'tool_use') {
      const r = b.id ? resultById.get(b.id) : undefined;
      segments.push({
        kind: 'tool',
        id: b.id || '',
        name: b.name || 'tool',
        input: b.input,
        result: r?.content,
        isError: r?.is_error,
        media: r?.media,
      });
    } else if (b.type === 'tool_result') {
      // Orphan tool_result with no matching tool_use anywhere → bare row.
      const hasUse = blocks.some(x => x.type === 'tool_use' && x.id === b.tool_use_id);
      if (!hasUse) {
        segments.push({
          kind: 'tool',
          id: b.tool_use_id || '',
          name: 'tool_result',
          input: {},
          result: b.content,
          isError: b.is_error,
          media: b.media,
        });
      }
    }
    // 'code' blocks are not rendered as segments (no current UI).
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Tool detail formatting — pure helpers for the expandable tool row detail.
// Extracted here (no React/DOM) so they are unit-testable.
// ---------------------------------------------------------------------------

/**
 * Format a tool_use input object for display in the expanded detail.
 * Pretty-prints JSON objects; passes primitives through as strings; returns ''
 * for null/undefined/empty-object (caller hides the section). Caps length so a
 * huge Edit `new_string` can't blow up the DOM.
 */
export function formatToolInput(input: unknown, maxChars = 2000): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'object') return String(input);
  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length === 0) return '';
  let str: string;
  try {
    str = JSON.stringify(input, null, 2);
  } catch {
    return '';
  }
  if (str.length > maxChars) str = str.slice(0, maxChars) + '\n…';
  return str;
}

export interface TruncatedResult {
  /** The text to actually render. */
  text: string;
  /** True when the original was clipped (by line count or char count). */
  truncated: boolean;
  /** How many trailing lines were hidden (0 when clipped mid-line by char cap). */
  hiddenLines: number;
}

/**
 * Clip a tool result for inline display: cap lines first, then characters as a
 * safety net. Returns the shown text plus how much was hidden so the caller can
 * render a "… N more lines" / "… truncated" hint.
 */
export function truncateToolResult(text: string, maxLines = 200, maxChars = 8000): TruncatedResult {
  if (!text) return { text: '', truncated: false, hiddenLines: 0 };
  const allLines = text.split('\n');
  let shown = text;
  let truncated = false;
  if (allLines.length > maxLines) {
    shown = allLines.slice(0, maxLines).join('\n');
    truncated = true;
  }
  if (shown.length > maxChars) {
    shown = shown.slice(0, maxChars);
    truncated = true;
  }
  const hiddenLines = truncated ? Math.max(0, allLines.length - shown.split('\n').length) : 0;
  return { text: shown, truncated, hiddenLines };
}

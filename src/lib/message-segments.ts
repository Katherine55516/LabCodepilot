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

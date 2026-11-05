import type { Block, Card } from '@/lib/decks/types';
import { blockText, newId } from '@/lib/decks/blocks';

/** Pure helpers for manual editing. Blocks can nest one level deep (columns). */

export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function moveItemTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Deep copy with fresh ids, so a duplicate never shares block ids with its source. */
export function cloneBlock(block: Block): Block {
  const copy = structuredClone(block);
  copy.id = newId('blk');
  if (copy.type === 'columns') copy.columns = copy.columns.map(col => col.map(cloneBlock));
  return copy;
}

export function cloneCard(card: Card): Card {
  return { ...structuredClone(card), id: newId('card'), blocks: card.blocks.map(cloneBlock), stage: 'done', issues: undefined };
}

export function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.type === 'columns') {
      for (const col of block.columns) {
        const found = findBlock(col, id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/** Applies `fn` to the list that directly contains block `id` (top level or a column). */
function editContaining(blocks: Block[], id: string, fn: (list: Block[], index: number) => Block[]): Block[] {
  const index = blocks.findIndex(b => b.id === id);
  if (index >= 0) return fn(blocks, index);
  return blocks.map(block => block.type === 'columns'
    ? { ...block, columns: block.columns.map(col => editContaining(col, id, fn)) }
    : block);
}

export const replaceBlock = (blocks: Block[], id: string, next: Block) =>
  editContaining(blocks, id, (list, i) => list.map((b, j) => (j === i ? next : b)));

/**
 * Removes a block. Empty columns are dropped, and a columns block left with
 * fewer than two columns is unwrapped into its remaining blocks (the server's
 * sanitizer would otherwise discard the whole block).
 */
export function removeBlock(blocks: Block[], id: string): Block[] {
  return editContaining(blocks, id, (list, i) => list.filter((_, j) => j !== i)).flatMap(block => {
    if (block.type !== 'columns') return [block];
    const columns = block.columns.filter(col => col.length > 0);
    if (columns.length >= 2) return [{ ...block, columns }];
    return columns.flat();
  });
}

export const shiftBlock = (blocks: Block[], id: string, delta: number) =>
  editContaining(blocks, id, (list, i) => moveItem(list, i, delta));

export function duplicateBlock(blocks: Block[], id: string): { blocks: Block[]; newId?: string } {
  let created: string | undefined;
  const next = editContaining(blocks, id, (list, i) => {
    const copy = cloneBlock(list[i]);
    created = copy.id;
    return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
  });
  return { blocks: next, newId: created };
}

/** Inserts after the selected block (in the same list), or at the end. */
export function insertBlock(blocks: Block[], block: Block, afterId?: string | null): Block[] {
  if (afterId && findBlock(blocks, afterId)) {
    return editContaining(blocks, afterId, (list, i) => [...list.slice(0, i + 1), block, ...list.slice(i + 1)]);
  }
  return [...blocks, block];
}

/** First words of a block, for the AI scope chip and toolbar label. */
export function blockSnippet(block: Block, max = 28): string {
  const text = blockText(block).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Id of the top-level block that is or contains `id` (columns nest one level). */
export function topLevelId(blocks: Block[], id: string): string | undefined {
  return blocks.find(b => b.id === id || (b.type === 'columns' && b.columns.some(col => !!findBlock(col, id))))?.id;
}

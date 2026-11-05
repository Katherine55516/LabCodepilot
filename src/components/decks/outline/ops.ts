import type { OutlineCard } from '@/lib/decks/types';
import { newId } from '@/lib/decks/blocks';

/** Pure outline edits for the plan review (report 02 §5.1 "Plan": Merge, Add, reorder, per-card instruction). */

export const newOutlineCard = (): OutlineCard => ({ id: newId('oc'), title: '', points: [''] });

export function insertAfter(outline: OutlineCard[], index: number, card: OutlineCard = newOutlineCard()): OutlineCard[] {
  return [...outline.slice(0, index + 1), card, ...outline.slice(index + 1)];
}

export function removeAt(outline: OutlineCard[], index: number): OutlineCard[] {
  return outline.filter((_, i) => i !== index);
}

export function move(outline: OutlineCard[], index: number, delta: -1 | 1): OutlineCard[] {
  const target = index + delta;
  if (target < 0 || target >= outline.length) return outline;
  const next = [...outline];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Merges card `index` with the next one: keeps the first title, appends the second's title as a point when it differs. */
export function mergeWithNext(outline: OutlineCard[], index: number): OutlineCard[] {
  const a = outline[index];
  const b = outline[index + 1];
  if (!a || !b) return outline;
  const keep = (points: string[]) => points.filter(p => p.trim());
  const bTitle = b.title.trim();
  const points = [...keep(a.points), ...(bTitle && bTitle !== a.title.trim() ? [bTitle] : []), ...keep(b.points)];
  const instruction = [a.instruction, b.instruction].map(s => s?.trim()).filter(Boolean).join('\n');
  const merged: OutlineCard = { id: a.id, title: a.title.trim() || bTitle, points: points.length ? points : [''], ...(instruction ? { instruction } : {}) };
  return [...outline.slice(0, index), merged, ...outline.slice(index + 2)];
}

export function updateAt(outline: OutlineCard[], index: number, patch: Partial<OutlineCard>): OutlineCard[] {
  return outline.map((card, i) => (i === index ? { ...card, ...patch } : card));
}

/** The editor keeps at least one (possibly empty) point per card so there is always a field to type in. */
export const withEditablePoints = (outline: OutlineCard[]): OutlineCard[] =>
  outline.map(card => (card.points.length ? card : { ...card, points: [''] }));

import type { AccentPosition, Block, Card, CardDimensions, InlineText } from './types';
import { cardCapacity, cardLoad, plainText, visualLength } from './blocks';

/**
 * "Suggested layouts" (report 04 §2.2, report 06 §4): the same card with the
 * same content in different arrangements. Pure and deterministic: nothing is
 * rewritten or invented — list items are only split (at a colon, a spaced dash
 * or after the first words) and moved into another native block, and accent
 * variations only move the image slot. Ids of untouched blocks are kept; a
 * converted block keeps the id of the block it replaces.
 */

export type SuggestionKind =
  | 'grid' | 'steps' | 'columns' | 'timeline' | 'metrics' | 'callout' | 'table' | 'bullets'
  | 'accent-left' | 'accent-right' | 'accent-top' | 'accent-none';

export interface LayoutSuggestion { id: string; kind: SuggestionKind; label: string; card: Card }

export interface SuggestOptions {
  /** With fixed dimensions, suggestions that would overflow a card that currently fits are dropped. */
  dimensions?: CardDimensions;
  /** Column headers for list → table (structural labels in the UI language). */
  tableHeader?: [string, string];
  /** At most this many suggestions (default and ceiling 6). */
  max?: number;
}

export const SUGGESTION_LABELS: Record<SuggestionKind, string> = {
  grid: 'Card grid', steps: 'Steps', columns: 'Two columns', timeline: 'Timeline', metrics: 'Key numbers',
  callout: 'Callout', table: 'Table', bullets: 'List',
  'accent-left': 'Image left', 'accent-right': 'Image right', 'accent-top': 'Image top', 'accent-none': 'No image',
};

const MAX_SUGGESTIONS = 6;
const LIMITS = { grid: 9, steps: 9, timeline: 8, metrics: 6, table: 14 } as const;

// ── Splitting list items ──────────────────────────────────────────────────

export interface SplitItem { title: string; text?: InlineText; labelled: boolean }

const BOLD_LEAD = /^\s*\*\*([^*]+?)\*\*\s*[:：\-–—]?\s*([\s\S]*)$/;
const DASH = /^([\s\S]+?)\s+[–—-]\s+([\s\S]+)$/;
const CJK_CLAUSE = /^([^，、；。,;]+)[，、；。,;]\s*([\s\S]+)$/;

const cleanEnds = (s: string) => s.replace(/^[\s:：,，;；\-–—]+|[\s:：,，;；\-–—]+$/g, '');

/** Index of the first label colon: not inside a link or code, not a time like 10:30. */
function labelColon(item: string): number {
  for (let i = 1; i < item.length - 1; i++) {
    const ch = item[i];
    if (ch === '[' || ch === '`') return -1;
    if (ch !== ':' && ch !== '：') continue;
    if (ch === ':' && ((/\d/.test(item[i - 1]) && /\d/.test(item[i + 1])) || item.startsWith('//', i + 1))) continue;
    return i;
  }
  return -1;
}

/**
 * Splits a list item into a short title and the rest. "Label: rest",
 * "**Label** rest" and "Label — rest" are labelled; otherwise long items are
 * split after their first words (or first clause in CJK text).
 */
export function splitItem(item: InlineText): SplitItem {
  const bold = item.match(BOLD_LEAD);
  if (bold && bold[2].trim()) return { title: cleanEnds(bold[1]), text: bold[2].trim(), labelled: true };
  const colon = labelColon(item);
  if (colon > 0) {
    const title = cleanEnds(plainText(item.slice(0, colon)));
    const text = item.slice(colon + 1).trim();
    if (title && text && visualLength(title) <= 60) return { title, text, labelled: true };
  }
  const plain = plainText(item).trim();
  const dash = plain.match(DASH);
  if (dash && visualLength(dash[1]) <= 60) return { title: cleanEnds(dash[1]), text: dash[2].trim(), labelled: true };
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length > 6) return { title: cleanEnds(words.slice(0, 3).join(' ')), text: words.slice(3).join(' '), labelled: false };
  if (words.length <= 1 && visualLength(plain) > 24) {
    const clause = plain.match(CJK_CLAUSE);
    if (clause && visualLength(clause[1]) <= 24) return { title: clause[1].trim(), text: clause[2].trim(), labelled: false };
  }
  return { title: plain, labelled: false };
}

const joinItem = (title: string, text?: string) => (text ? `${title}: ${text}` : title);

// ── Dates and numbers ─────────────────────────────────────────────────────

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const YEAR = '(?:19|20)\\d{2}';
const DATE_LEAD = new RegExp(`^(${[
  `(?:${MONTHS})\\.?\\s+(?:\\d{1,2},?\\s+)?${YEAR}`,
  `${YEAR}[-/.]\\d{1,2}(?:[-/.]\\d{1,2})?`,
  `\\d{1,2}[-/.]\\d{1,2}[-/.]${YEAR}`,
  `Q[1-4]\\s*${YEAR}`,
  `${YEAR}\\s*(?:Q[1-4]|H[12])`,
  `${YEAR}\\s*年(?:\\s*\\d{1,2}\\s*月(?:\\s*\\d{1,2}\\s*日)?)?`,
  `${YEAR}s?`,
].join('|')})(?!\\d)`, 'i');

/** "2024: Launch", "Q3 2025 — Beta", "2023年3月 发布" → { label, rest }; null when the item does not start with a date. */
export function leadingDate(item: InlineText): { label: string; rest: string } | null {
  const plain = plainText(item).trim();
  const match = plain.match(DATE_LEAD);
  if (!match) return null;
  return { label: match[1].trim(), rest: cleanEnds(plain.slice(match[0].length).replace(/^[.)]/, '')) };
}

const NUMBER = /(?:[$€£¥₹]\s?)?[+\-−]?\d[\d,.]*(?:\s?(?:%|‰|×|x\b|k\b|K\b|M\b|B\b|bn\b|万|亿|倍|千))?/;

/** First number in the text with its currency and unit, and the text around it. */
export function findNumber(text: string): { value: string; rest: string } | null {
  const match = text.match(NUMBER);
  if (!match || match.index === undefined) return null;
  const value = match[0].replace(/[.,]+$/, '').trim();
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ');
  return { value, rest: cleanEnds(rest.replace(/\s+([,.:;，。：；])/g, '$1')) };
}

function toMetric(item: InlineText): { value: string; label: string; detail?: string } | null {
  const split = splitItem(item);
  if (split.labelled && split.text) {
    const inText = findNumber(plainText(split.text));
    if (inText) return { value: inText.value, label: split.title, ...(inText.rest ? { detail: inText.rest } : {}) };
    const inTitle = findNumber(split.title);
    if (inTitle && inTitle.rest) return { value: inTitle.value, label: inTitle.rest, detail: plainText(split.text) };
  }
  const found = findNumber(plainText(item));
  if (!found || !found.rest) return null;
  return { value: found.value, label: found.rest };
}

// ── Conversions ───────────────────────────────────────────────────────────

type ListBlock = Extract<Block, { type: 'bullets' | 'numbered' }>;
type Candidate = { kind: SuggestionKind; block: Block };

function fromList(block: ListBlock, options: SuggestOptions): Candidate[] {
  const { id, items } = block;
  const out: Candidate[] = [];
  const split = items.map(splitItem);
  const many = (max: number) => items.length >= 2 && items.length <= max;
  const gridLike = (type: 'grid' | 'steps'): Candidate => ({
    kind: type, block: { id, type, items: split.map(s => ({ title: s.title, ...(s.text ? { text: s.text } : {}) })) } as Block,
  });
  const dated = many(LIMITS.timeline) ? items.map(leadingDate) : [];
  const timeline = dated.length > 0 && dated.every(d => d && d.rest);
  if (timeline) {
    out.push({ kind: 'timeline', block: { id, type: 'timeline', items: dated.map(d => {
      const rest = splitItem(d!.rest);
      return { label: d!.label, title: rest.title, ...(rest.text ? { text: rest.text } : {}) };
    }) } });
  }
  // Dates are numbers too, but a dated list reads as a timeline, not as key numbers.
  const metrics = !timeline && many(LIMITS.metrics) ? items.map(toMetric) : [];
  if (metrics.length > 0 && metrics.every(m => m && m.value.length <= 24 && visualLength(m.label) <= 80)) {
    out.push({ kind: 'metrics', block: { id, type: 'metrics', items: metrics as { value: string; label: string; detail?: string }[] } });
  }
  if (block.type === 'numbered' && many(LIMITS.steps)) out.push(gridLike('steps'));
  if (many(LIMITS.grid)) out.push(gridLike('grid'));
  if (block.type === 'bullets' && many(LIMITS.steps)) out.push(gridLike('steps'));
  if (many(LIMITS.table) && split.every(s => s.labelled && s.text)) {
    out.push({ kind: 'table', block: { id, type: 'table', header: [...(options.tableHeader ?? ['Item', 'Detail'])], rows: split.map(s => [s.title, s.text!]) } });
  }
  if (block.type === 'bullets' && items.length >= 4) {
    const half = Math.ceil(items.length / 2);
    out.push({ kind: 'columns', block: { id, type: 'columns', columns: [items.slice(0, half), items.slice(half)].map((part, i) =>
      [{ id: deriveId(id, `c${i + 1}`), type: 'bullets', items: part } as Block]) } });
  }
  if (items.length === 1) {
    const s = split[0];
    out.push({ kind: 'callout', block: s.labelled && s.text ? { id, type: 'callout', tone: 'info', title: s.title, text: s.text } : { id, type: 'callout', tone: 'info', text: items[0] } });
  }
  return out;
}

function fromStructured(block: Block): Candidate[] {
  const { id } = block;
  switch (block.type) {
    case 'grid': case 'steps': {
      const other: 'grid' | 'steps' = block.type === 'grid' ? 'steps' : 'grid';
      const items = block.items.map(i => ({ title: i.title, ...(i.text ? { text: i.text } : {}) }));
      return [
        { kind: 'bullets', block: { id, type: block.type === 'steps' ? 'numbered' : 'bullets', items: block.items.map(i => joinItem(i.title, i.text)) } },
        ...(items.length <= LIMITS[other] ? [{ kind: other, block: { id, type: other, items } as Block } satisfies Candidate] : []),
      ];
    }
    case 'timeline':
      return [{ kind: 'bullets', block: { id, type: 'bullets', items: block.items.map(i =>
        i.label ? `${i.label}: ${i.title}${i.text ? ` — ${i.text}` : ''}` : joinItem(i.title, i.text)) } }];
    case 'metrics':
      return [{ kind: 'bullets', block: { id, type: 'bullets', items: block.items.map(i => `${i.label}: ${i.value}${i.detail ? ` — ${i.detail}` : ''}`) } }];
    default:
      return [];
  }
}

/** A child id derived from its parent, kept within the 40-character id limit. */
function deriveId(base: string, suffix: string): string {
  return `${base.slice(0, 40 - suffix.length - 1)}-${suffix}`;
}

const contentKey = (card: Pick<Card, 'blocks' | 'layout'>) => JSON.stringify([card.blocks, card.layout]);

/** Up to six distinct rearrangements of the card's own content, never the card as it is. */
export function suggestLayouts(card: Card, options: SuggestOptions = {}): LayoutSuggestion[] {
  const max = Math.min(options.max ?? MAX_SUGGESTIONS, MAX_SUGGESTIONS);
  const target = card.blocks.find(b => ['bullets', 'numbered', 'grid', 'steps', 'timeline', 'metrics'].includes(b.type));
  const candidates = !target ? [] : target.type === 'bullets' || target.type === 'numbered' ? fromList(target, options) : fromStructured(target);
  const content: LayoutSuggestion[] = candidates.map(c => ({
    id: `${c.kind}:${target!.id}`, kind: c.kind, label: SUGGESTION_LABELS[c.kind],
    card: { ...card, blocks: card.blocks.map(b => (b.id === target!.id ? c.block : b)) },
  }));
  const accents: LayoutSuggestion[] = (['left', 'right', 'top', 'none'] as AccentPosition[])
    .filter(position => position !== card.layout.accent)
    .map(position => {
      const kind = `accent-${position}` as SuggestionKind;
      return { id: kind, kind, label: SUGGESTION_LABELS[kind], card: { ...card, layout: { ...card.layout, accent: position } } };
    });

  const fits = (c: Card) => {
    if (!options.dimensions) return true;
    const capacity = cardCapacity(options.dimensions, c.layout);
    return capacity === null || cardLoad(c) <= capacity;
  };
  const guardOverflow = fits(card);
  const seen = new Set([contentKey(card)]);
  const accepted = (s: LayoutSuggestion) => {
    const key = contentKey(s.card);
    if (seen.has(key) || (guardOverflow && !fits(s.card))) return false;
    seen.add(key);
    return true;
  };
  const okContent = content.filter(accepted);
  const okAccents = accents.filter(accepted);
  // Rearrangements first, but leave room for two accent variations; then fill up with the remaining rearrangements.
  const head = okContent.slice(0, Math.max(0, max - Math.min(2, okAccents.length)));
  return [...head, ...okAccents, ...okContent.slice(head.length)].slice(0, max);
}

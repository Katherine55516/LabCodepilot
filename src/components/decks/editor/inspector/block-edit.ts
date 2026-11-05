import type { Block } from '@/lib/decks/types';

/**
 * Pure helpers behind the block inspector. Limits match the block sanitizer
 * in src/lib/decks/blocks.ts, so a manually edited block survives a later AI
 * edit of the same card.
 */

export type TableBlock = Extract<Block, { type: 'table' }>;
export type ChartBlock = Extract<Block, { type: 'chart' }>;

export const TABLE_LIMITS = { rows: 14, cols: 8 } as const;
export const CHART_LIMITS = { minLabels: 2, maxLabels: 12, maxSeries: 4 } as const;
export const ITEM_LIMITS = {
  timeline: { min: 2, max: 8 }, steps: { min: 2, max: 9 }, grid: { min: 2, max: 9 }, metrics: { min: 2, max: 6 },
} as const;

// ── Lists ─────────────────────────────────────────────────────────────────

export const setAt = <T>(list: T[], index: number, value: T): T[] => list.map((x, i) => (i === index ? value : x));
export const removeAt = <T>(list: T[], index: number): T[] => list.filter((_, i) => i !== index);
export function swap<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || index >= list.length || target >= list.length) return list;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── Tables ────────────────────────────────────────────────────────────────

export function setTableCell(block: TableBlock, row: number, col: number, value: string): TableBlock {
  return { ...block, rows: block.rows.map((r, i) => (i === row ? setAt(r, col, value) : r)) };
}
export const setTableHeader = (block: TableBlock, col: number, value: string): TableBlock => ({ ...block, header: setAt(block.header, col, value) });

export function addTableRow(block: TableBlock): TableBlock {
  if (block.rows.length >= TABLE_LIMITS.rows) return block;
  return { ...block, rows: [...block.rows, block.header.map(() => '')] };
}
export function removeTableRow(block: TableBlock, row: number): TableBlock {
  if (block.rows.length <= 1) return block;
  return { ...block, rows: removeAt(block.rows, row) };
}
export function addTableColumn(block: TableBlock, header: string): TableBlock {
  if (block.header.length >= TABLE_LIMITS.cols) return block;
  return { ...block, header: [...block.header, header], rows: block.rows.map(r => [...r, '']) };
}
export function removeTableColumn(block: TableBlock, col: number): TableBlock {
  if (block.header.length <= 1) return block;
  return { ...block, header: removeAt(block.header, col), rows: block.rows.map(r => removeAt(r, col)) };
}

// ── Charts ────────────────────────────────────────────────────────────────

/** A chart's data as typed text, so a half-typed number ("-", "1.") can stay on screen. */
export interface ChartDraft { labels: string[]; series: { name: string; values: string[] }[] }

/** Parses "1,234.5", "-3", ".5", "2e3"; null for anything else (including empty). */
export function parseNumber(text: string): number | null {
  const compact = text.trim().replace(/[\s,_]/g, '').replace(/^−/, '-');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(compact)) return null;
  const value = Number(compact);
  return Number.isFinite(value) ? value : null;
}

export function chartDraft(block: ChartBlock): ChartDraft {
  return {
    labels: block.labels.slice(),
    series: block.series.map(s => ({ name: s.name, values: block.labels.map((_, i) => (s.values[i] === undefined ? '' : String(s.values[i]))) })),
  };
}

/** The chart data the draft describes, or null while any value is not a number. */
export function chartFromDraft(draft: ChartDraft): Pick<ChartBlock, 'labels' | 'series'> | null {
  const series: ChartBlock['series'] = [];
  for (const s of draft.series) {
    const values = s.values.map(parseNumber);
    if (values.some(v => v === null)) return null;
    series.push({ name: s.name, values: values as number[] });
  }
  return { labels: draft.labels.slice(), series };
}

export const invalidCells = (draft: ChartDraft) => draft.series.map(s => s.values.map(v => parseNumber(v) === null));

export function addChartLabel(draft: ChartDraft, label: string): ChartDraft {
  if (draft.labels.length >= CHART_LIMITS.maxLabels) return draft;
  return { labels: [...draft.labels, label], series: draft.series.map(s => ({ ...s, values: [...s.values, '0'] })) };
}
export function removeChartLabel(draft: ChartDraft, index: number): ChartDraft {
  if (draft.labels.length <= CHART_LIMITS.minLabels) return draft;
  return { labels: removeAt(draft.labels, index), series: draft.series.map(s => ({ ...s, values: removeAt(s.values, index) })) };
}
export function addChartSeries(draft: ChartDraft, name: string): ChartDraft {
  if (draft.series.length >= CHART_LIMITS.maxSeries) return draft;
  return { ...draft, series: [...draft.series, { name, values: draft.labels.map(() => '0') }] };
}
export function removeChartSeries(draft: ChartDraft, index: number): ChartDraft {
  if (draft.series.length <= 1) return draft;
  return { ...draft, series: removeAt(draft.series, index) };
}

/** Same chart data as the block (used to tell our own commits from outside changes). */
export function sameChartData(draft: ChartDraft, block: ChartBlock): boolean {
  const parsed = chartFromDraft(draft);
  return !!parsed && JSON.stringify(parsed) === JSON.stringify({ labels: block.labels, series: block.series });
}

// ── Items (timeline / steps / grid / metrics) ─────────────────────────────

/** Sets a field; an emptied optional field is removed rather than stored as "". */
export function setItemField<T extends object>(item: T, key: keyof T & string, value: string, optional: boolean): T {
  const next = { ...item } as Record<string, unknown>;
  if (optional && value === '') delete next[key];
  else next[key] = value;
  return next as T;
}

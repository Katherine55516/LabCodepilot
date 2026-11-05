import type { Block, Card, CardDimensions, CardLayout } from './types';

/** Short random id; crypto-free so it works on client and server. */
export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export const DEFAULT_LAYOUT: CardLayout = { accent: 'none', align: 'left' };

export function emptyCard(blocks: Block[] = []): Card {
  return { id: newId('card'), blocks, layout: { ...DEFAULT_LAYOUT }, hidden: false, notes: '', stage: 'done' };
}

// ── Inline Markdown subset ────────────────────────────────────────────────

export type InlineSegment = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

/** Parses **bold**, *italic*, `code` and [text](https://url). Unknown syntax stays literal. */
export function parseInline(input: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*\s][^*]*)\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: input.slice(last, index) });
    if (match[2] !== undefined) out.push({ text: match[2], bold: true });
    else if (match[4] !== undefined) out.push({ text: match[4], italic: true });
    else if (match[6] !== undefined) out.push({ text: match[6], code: true });
    else if (match[8] !== undefined) out.push({ text: match[8], href: match[9] });
    last = index + match[0].length;
  }
  if (last < input.length) out.push({ text: input.slice(last) });
  return out.filter(segment => segment.text.length > 0);
}

export const plainText = (input: string) => parseInline(input).map(segment => segment.text).join('');

// ── Text extraction and capacity (checking pass, report 02 "checking") ───

export function blockText(block: Block): string {
  switch (block.type) {
    case 'heading': case 'paragraph': case 'quote': return plainText(block.text);
    case 'callout': return [block.title, plainText(block.text)].filter(Boolean).join(' ');
    case 'bullets': case 'numbered': return block.items.map(plainText).join(' ');
    case 'table': return [...block.header, ...block.rows.flat()].join(' ');
    case 'chart': return [...block.labels, ...block.series.map(s => s.name)].join(' ');
    case 'code': return block.code;
    case 'timeline': return block.items.map(i => `${i.label} ${i.title} ${plainText(i.text || '')}`).join(' ');
    case 'steps': case 'grid': return block.items.map(i => `${i.title} ${plainText(i.text || '')}`).join(' ');
    case 'metrics': return block.items.map(i => `${i.value} ${i.label} ${i.detail || ''}`).join(' ');
    case 'columns': return block.columns.flat().map(blockText).join(' ');
    case 'image': return [block.alt, block.caption].filter(Boolean).join(' ');
    case 'templateDiagram': return block.items.map(i => `${i.title} ${plainText(i.text || '')}`).join(' ');
    case 'divider': return '';
  }
}

export function cardTitle(card: Pick<Card, 'blocks'>): string {
  const heading = card.blocks.find(block => block.type === 'heading');
  return heading && heading.type === 'heading' ? plainText(heading.text) : '';
}

/** CJK characters take roughly two Latin character widths. */
export function visualLength(text: string): number {
  let n = 0;
  for (const ch of text) n += /[⺀-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
  return n;
}

/**
 * Rough "line units" a block occupies on the 1280-wide logical canvas at body
 * size, used to predict overflow on fixed-ratio cards. Deterministic, so the
 * checking pass and tests agree; the rendered card is the final truth.
 */
export function blockLoad(block: Block, columnFraction = 1): number {
  const perLine = 96 * columnFraction; // visual chars per body line at full width
  const lines = (text: string, scale = 1) => Math.max(1, Math.ceil((visualLength(text) * scale) / perLine));
  switch (block.type) {
    case 'heading': return block.level === 1 ? lines(block.text, 2.2) * 2.4 : block.level === 2 ? lines(block.text, 1.6) * 1.8 : lines(block.text, 1.25) * 1.4;
    case 'paragraph': case 'quote': return lines(block.text) + 0.4;
    case 'callout': return lines(`${block.title || ''} ${block.text}`) + 1.2;
    case 'bullets': case 'numbered': return block.items.reduce((sum, item) => sum + lines(item), 0) + 0.4;
    case 'table': return (block.rows.length + 1) * 1.5 + 0.5;
    case 'chart': return 9;
    case 'code': return block.code.split('\n').length * 1.1 + 1;
    case 'timeline': case 'steps': return Math.max(5, Math.ceil(block.items.length / 4) * 5);
    case 'metrics': return 4.5;
    case 'grid': return Math.ceil(block.items.length / 3) * 4.5;
    case 'columns': return Math.max(...block.columns.map(col => col.reduce((s, b) => s + blockLoad(b, columnFraction / block.columns.length), 0)), 1);
    case 'image': return block.height ? (block.height + (block.caption ? 52 : 0)) / 28 : 10;
    // Drawn at the column width and the component's shape, at most 400 px tall.
    // Drawn at the column width and the component's shape; columns grow with their items' text.
    case 'templateDiagram': return Math.max(Math.min(400, (1120 * columnFraction) / 2.6) / 28, block.items.reduce((sum, i) => sum + 1.3 + visualLength(plainText(i.text || '')) / (70 * columnFraction), 0)) + 0.6;
    case 'divider': return 0.6;
  }
}

/** Body-line capacity of a fixed card, after the accent slot takes its share. */
export function cardCapacity(dimensions: CardDimensions, layout: CardLayout): number | null {
  const base: Partial<Record<CardDimensions, number>> = { '16x9': 21, '4x3': 27, '1x1': 33, '4x5': 40, '9x16': 52, a4: 62, letter: 58 };
  const lines = base[dimensions];
  if (lines === undefined) return null; // fluid / pageless grow with content
  const band = layout.band ? 1 - layout.band.size : 1;
  if (layout.accent === 'top') return Math.round(lines * band * (1 - (layout.accentSize ?? 0.38)));
  return Math.round(lines * band);
}

export function cardLoad(card: Pick<Card, 'blocks' | 'layout'>): number {
  const fraction = card.layout.accent === 'left' || card.layout.accent === 'right' ? 1 - (card.layout.accentSize ?? 0.4) : 1;
  return card.blocks.reduce((sum, block) => sum + blockLoad(block, fraction), 0);
}

/** Validates and repairs a block list from a model; unknown or malformed blocks are dropped. */
export function sanitizeBlocks(input: unknown, depth = 0): Block[] {
  if (!Array.isArray(input)) return [];
  const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const strs = (v: unknown, max = 40) => (Array.isArray(v) ? v.map(x => str(x, 800)).filter(Boolean).slice(0, max) : []);
  const out: Block[] = [];
  for (const raw of input.slice(0, 40)) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    const id = typeof b.id === 'string' && /^[\w-]{1,40}$/.test(b.id) ? b.id : newId('blk');
    switch (b.type) {
      case 'heading': { const text = str(b.text, 300); if (text) out.push({ id, type: 'heading', level: b.level === 1 || b.level === 3 ? b.level : 2, text }); break; }
      case 'paragraph': { const text = str(b.text); if (text) out.push({ id, type: 'paragraph', text }); break; }
      case 'bullets': case 'numbered': { const items = strs(b.items); if (items.length) out.push({ id, type: b.type, items }); break; }
      case 'quote': { const text = str(b.text, 1000); if (text) out.push({ id, type: 'quote', text, ...(str(b.attribution, 200) ? { attribution: str(b.attribution, 200) } : {}) }); break; }
      case 'callout': { const text = str(b.text, 1200); const tone = ['info', 'warning', 'success', 'note'].includes(String(b.tone)) ? b.tone as 'info' : 'info'; if (text) out.push({ id, type: 'callout', tone, text, ...(str(b.title, 200) ? { title: str(b.title, 200) } : {}) }); break; }
      case 'code': { const code = str(b.code, 4000); if (code) out.push({ id, type: 'code', language: str(b.language, 30) || 'text', code }); break; }
      case 'table': {
        const header = strs(b.header, 8);
        const rows = Array.isArray(b.rows) ? b.rows.map(r => strs(r, header.length || 8)).filter(r => r.length).slice(0, 14) : [];
        if (header.length && rows.length) out.push({ id, type: 'table', header, rows: rows.map(r => header.map((_, i) => r[i] ?? '')) });
        break;
      }
      case 'chart': {
        const labels = strs(b.labels, 12);
        const series = Array.isArray(b.series) ? b.series.slice(0, 4).map(s => {
          const o = (s || {}) as Record<string, unknown>;
          return { name: str(o.name, 80) || 'Series', values: Array.isArray(o.values) ? o.values.map(Number).slice(0, labels.length) : [] };
        }).filter(s => s.values.length === labels.length && s.values.every(Number.isFinite)) : [];
        const chartType = b.chartType === 'line' || b.chartType === 'pie' ? b.chartType : 'bar';
        if (labels.length >= 2 && series.length) out.push({ id, type: 'chart', chartType, labels, series: chartType === 'pie' ? series.slice(0, 1) : series, ...(str(b.unit, 20) ? { unit: str(b.unit, 20) } : {}) });
        break;
      }
      case 'timeline': {
        const items = Array.isArray(b.items) ? b.items.slice(0, 8).map(i => { const o = (i || {}) as Record<string, unknown>; return { label: str(o.label, 40), title: str(o.title, 120), ...(str(o.text, 400) ? { text: str(o.text, 400) } : {}) }; }).filter(i => i.title) : [];
        if (items.length >= 2) out.push({ id, type: 'timeline', items });
        break;
      }
      case 'steps': case 'grid': {
        const items = Array.isArray(b.items) ? b.items.slice(0, 9).map(i => { const o = (i || {}) as Record<string, unknown>; return { title: str(o.title, 120), ...(str(o.text, 500) ? { text: str(o.text, 500) } : {}), ...(b.type === 'grid' && str(o.icon, 4) ? { icon: str(o.icon, 4) } : {}) }; }).filter(i => i.title) : [];
        if (items.length >= 2) out.push({ id, type: b.type, items } as Block);
        break;
      }
      case 'metrics': {
        const items = Array.isArray(b.items) ? b.items.slice(0, 6).map(i => { const o = (i || {}) as Record<string, unknown>; return { value: str(o.value, 24), label: str(o.label, 80), ...(str(o.detail, 200) ? { detail: str(o.detail, 200) } : {}) }; }).filter(i => i.value && i.label) : [];
        if (items.length >= 2) out.push({ id, type: 'metrics', items });
        break;
      }
      case 'columns': {
        if (depth > 0) break;
        const columns = Array.isArray(b.columns) ? b.columns.slice(0, 3).map(col => sanitizeBlocks(col, depth + 1)).filter(col => col.length) : [];
        if (columns.length >= 2) out.push({ id, type: 'columns', columns });
        break;
      }
      case 'image': {
        const mediaId = typeof b.mediaId === 'string' && /^[\w-]{1,60}$/.test(b.mediaId) ? b.mediaId : undefined;
        const height = Number(b.height);
        out.push({ id, type: 'image', alt: str(b.alt, 200), fit: b.fit === 'contain' ? 'contain' : 'cover', ...(mediaId ? { mediaId } : { placeholder: true }), ...(str(b.caption, 200) ? { caption: str(b.caption, 200) } : {}), ...(Number.isFinite(height) && height >= 80 && height <= 900 ? { height: Math.round(height) } : {}) });
        break;
      }
      case 'templateDiagram': {
        const componentId = typeof b.componentId === 'string' && /^K\d{1,3}$/.test(b.componentId) ? b.componentId : '';
        const items = Array.isArray(b.items) ? b.items.slice(0, 8).map(i => { const o = (i || {}) as Record<string, unknown>; return { title: str(o.title, 120), ...(str(o.text, 400) ? { text: str(o.text, 400) } : {}), ...(typeof o.mediaId === 'string' && /^[\w-]{1,60}$/.test(o.mediaId) ? { mediaId: o.mediaId } : {}) }; }).filter(i => i.title) : [];
        if (componentId && items.length >= 2) out.push({ id, type: 'templateDiagram', componentId, items });
        break;
      }
      case 'divider': out.push({ id, type: 'divider' }); break;
    }
  }
  return out;
}

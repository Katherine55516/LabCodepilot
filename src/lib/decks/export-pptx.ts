/**
 * Native PPTX export for Decks (server-side, Node only).
 *
 * Every block becomes native, editable PowerPoint content — text boxes with
 * real runs and bullets, native tables and charts, shapes for the smart
 * layouts — laid out like src/components/decks/CardView.tsx: the same 1280-wide
 * logical canvas, accent slot geometry, padding, gaps and type scale, mapped
 * proportionally onto the slide width.
 *
 * Layout runs in canvas px; `inch()` / `pt()` convert at emission time. Block
 * heights are estimated (deterministic text measurement), and a card whose
 * content would overflow a fixed slide is scaled down uniformly (fonts and
 * vertical rhythm) until it fits, with no font pushed below 10 pt by the fit.
 *
 * Two post-processing passes run on the generated zip:
 *  - pptxgenjs writes an `<a:pPr>` before every run of a multi-run paragraph,
 *    which is invalid OOXML (pPr may only open a paragraph); extra ones are
 *    stripped.
 *  - SVG images are embedded as `asvg:svgBlip` (rendered by PowerPoint 2016+ /
 *    Microsoft 365) with a PNG fallback for older viewers. pptxgenjs cannot
 *    rasterise SVG in Node and writes a "broken image" PNG there, so the
 *    fallback is replaced with a small gradient PNG in the art's own colours.
 */

import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import type { Block, Card, CardDimensions, Deck, DeckTheme, HeaderFooter, HeaderFooterSlot } from './types';
import { DIMENSION_RATIO } from './types';
import { parseInline, plainText, visualLength } from './blocks';
import { deckTheme } from './themes';
import { accentSvg } from './accent-art';
import { arrangeComponent, canArrange } from './component-layout';

export interface PptxMedia { data: Buffer; mime: string }
export interface BuildDeckPptxOptions { readMedia?: (mediaId: string) => PptxMedia | null }

type Slide = PptxGenJS.Slide;
type TextRun = PptxGenJS.TextProps;
type RunOptions = PptxGenJS.TextPropsOptions;
type FixedDimensions = Exclude<CardDimensions, 'fluid' | 'pageless'>;

/** Logical canvas width, as in CardView (CANVAS_WIDTH). */
const CANVAS = 1280;
const EMU_PER_INCH = 914400;
/** The fit never pushes a font below this (fonts already smaller stay as designed). */
const MIN_FIT_PT = 10;
const MIN_FIT_SCALE = 0.3;
/** Gap between blocks in the content column (CardView `gap: 20`). */
const BLOCK_GAP = 20;
const MONO_FACE = 'Consolas';

// ── Slide geometry ────────────────────────────────────────────────────────

const SLIDE_INCHES: Record<FixedDimensions, [number, number]> = {
  '16x9': [12192000 / EMU_PER_INCH, 6858000 / EMU_PER_INCH], // 13.333 × 7.5 (PowerPoint "Widescreen")
  '4x3': [10, 7.5],
  '1x1': [7.5, 7.5],
  '4x5': [8, 10],
  '9x16': [6858000 / EMU_PER_INCH, 12192000 / EMU_PER_INCH],
  a4: [210 / 25.4, 297 / 25.4],
  letter: [8.5, 11],
};

/**
 * Slide size for a deck. Fluid/pageless cards grow with content on screen; a
 * slide cannot, so they map to 16:9 for presentations and A4 portrait for
 * documents.
 */
export function slideSize(dimensions: CardDimensions, format: Deck['settings']['format']): { dimensions: FixedDimensions; width: number; height: number; fluid: boolean } {
  const fluid = DIMENSION_RATIO[dimensions] === null;
  const fixed: FixedDimensions = fluid ? (format === 'document' ? 'a4' : '16x9') : dimensions as FixedDimensions;
  const [width, height] = SLIDE_INCHES[fixed];
  return { dimensions: fixed, width, height, fluid };
}

// ── Colours and fonts ─────────────────────────────────────────────────────

const hex = (color: string) => {
  const c = color.replace('#', '').trim();
  return (c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c.slice(0, 6)).toUpperCase();
};

function mix(a: string, b: string, t: number): string {
  const pa = hex(a), pb = hex(b);
  const out = [0, 2, 4].map(i => {
    const va = parseInt(pa.slice(i, i + 2), 16), vb = parseInt(pb.slice(i, i + 2), 16);
    return Math.round(va + (vb - va) * t).toString(16).padStart(2, '0');
  });
  return out.join('').toUpperCase();
}

type FontKind = 'sans' | 'serif' | 'mono';
const fontKind = (stack: string): FontKind => /monospace/i.test(stack) ? 'mono' : /(^|[\s,])serif/i.test(stack) && !/sans-serif/i.test(stack) ? 'serif' : 'sans';
const GENERIC_FAMILIES = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system']);

/** One concrete face for PowerPoint: the stack's first real family (monospace stacks use Consolas, shipped with Office). */
function pickFace(stack: string): string {
  if (fontKind(stack) === 'mono') return MONO_FACE;
  const families = stack.split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).filter(f => f && !GENERIC_FAMILIES.has(f.toLowerCase()));
  return families[0] || 'Arial';
}

interface Fonts { heading: string; body: string; headingKind: FontKind; bodyKind: FontKind }

// ── Layout context ────────────────────────────────────────────────────────

interface ResolvedMedia { data: string; w?: number; h?: number }

interface Ctx {
  theme: DeckTheme;
  /** Inches per canvas px. */
  k: number;
  /** Points per canvas px (k × 72). */
  ptPerPx: number;
  /** Fit scale for this slide (1 = as designed). */
  s: number;
  fonts: Fonts;
  align: 'left' | 'center';
  media: (mediaId: string | undefined) => ResolvedMedia | null;
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const inch = (c: Ctx, px: number) => round(px * c.k, 4);
/** Font size in pt: the canvas size mapped to the slide, times the fit scale, floored at MIN_FIT_PT by the fit. */
const pt = (c: Ctx, px: number) => {
  const natural = px * c.ptPerPx;
  return round(Math.max(natural * c.s, Math.min(natural, MIN_FIT_PT)), 1);
};
/** Effective font size back in canvas px (what the measurement uses). */
const fpx = (c: Ctx, px: number) => pt(c, px) / c.ptPerPx;
/** Vertical spacing in canvas px, scaled with the fit. */
const v = (c: Ctx, px: number) => px * c.s;

// ── Text measurement ──────────────────────────────────────────────────────

const CJK = /[⺀-鿿가-힯＀-￯]/;
const TOKENS = /[⺀-鿿가-힯＀-￯]|[^\s⺀-鿿가-힯＀-￯]+\s*|\s+/g;

function charWidth(kind: FontKind, bold?: boolean): number {
  const base = kind === 'mono' ? 0.6 : kind === 'serif' ? 0.52 : 0.53;
  return bold ? base * 1.06 : base;
}

/** Greedy word-wrap estimate: number of lines `text` takes in a box `width` px wide. */
function countLines(text: string, fontPx: number, width: number, kind: FontKind, bold?: boolean): number {
  const maxUnits = Math.max(1, (width * 0.97) / (fontPx * charWidth(kind, bold)));
  let total = 0;
  for (const hard of text.split('\n')) {
    let lines = 1, cur = 0;
    for (const token of hard.match(TOKENS) || []) {
      const len = visualLength(token);
      const visible = visualLength(token.trimEnd());
      if (cur > 0 && cur + visible > maxUnits && !/^\s+$/.test(token)) { lines++; cur = 0; }
      if (len > maxUnits && !CJK.test(token)) { lines += Math.floor(len / maxUnits); cur = len % maxUnits; } else cur += len;
    }
    total += lines;
  }
  return total;
}

const textHeight = (text: string, fontPx: number, lineHeight: number, width: number, kind: FontKind, bold?: boolean) =>
  countLines(text, fontPx, width, kind, bold) * fontPx * lineHeight;

/** CardView renders inline text without pre-wrap: newlines collapse to spaces. */
const flat = (text: string) => text.replace(/\s*\n\s*/g, ' ');

// ── Runs ──────────────────────────────────────────────────────────────────

interface RunStyle { px: number; color: string; face: string; bold?: boolean; italic?: boolean; spacingPx?: number; upper?: boolean }

/** Inline Markdown (bold / italic / code / links) → PowerPoint text runs. */
function runsOf(c: Ctx, text: string, st: RunStyle, inline = true): TextRun[] {
  const source = st.upper ? text.toUpperCase() : text;
  const segments = inline ? parseInline(flat(source)) : [{ text: source }];
  const list = segments.length ? segments : [{ text: '' }];
  return list.map(seg => {
    const s = seg as { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };
    const options: RunOptions = {
      fontSize: pt(c, st.px),
      fontFace: s.code ? MONO_FACE : st.face,
      color: hex(s.href ? c.theme.colors.accent : st.color),
    };
    if (st.bold || s.bold) options.bold = true;
    if (st.italic || s.italic) options.italic = true;
    if (st.spacingPx) options.charSpacing = round(st.spacingPx * c.ptPerPx * c.s, 2);
    if (s.code) options.highlight = hex(c.theme.colors.surface);
    if (s.href) options.hyperlink = { url: s.href };
    return { text: s.text, options };
  });
}

/** Joins per-paragraph runs into one text body (breakLine ends a paragraph; bullet opens one). */
function joinParagraphs(paragraphs: TextRun[][], bullet?: RunOptions['bullet']): TextRun[] {
  const out: TextRun[] = [];
  paragraphs.forEach((runs, i) => runs.forEach((run, j) => {
    const options: RunOptions = { ...run.options };
    if (j === 0 && bullet) options.bullet = typeof bullet === 'object' ? { ...bullet } : bullet;
    if (j === runs.length - 1 && i < paragraphs.length - 1) options.breakLine = true;
    out.push({ text: run.text, options });
  }));
  return out;
}

// ── Drawing primitives (canvas px in, inches out) ─────────────────────────

interface TextBoxOptions { align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle'; lineHeight: number; paraGapPx?: number }

function addTextBox(slide: Slide, c: Ctx, runs: TextRun[], x: number, y: number, w: number, h: number, o: TextBoxOptions) {
  const options: RunOptions = {
    x: inch(c, x), y: inch(c, y), w: inch(c, Math.max(w, 1)), h: inch(c, Math.max(h, 1)),
    margin: 0, wrap: true, align: o.align || 'left', valign: o.valign || 'top',
    lineSpacingMultiple: round(o.lineHeight / 1.2, 3),
  };
  if (o.paraGapPx) options.paraSpaceAfter = round(v(c, o.paraGapPx) * c.ptPerPx, 1);
  slide.addText(runs, options);
}

interface BoxStyle { fill?: string; transparency?: number; line?: string; lineWidthPx?: number; dash?: boolean; radiusPx?: number }

function addBox(slide: Slide, c: Ctx, shape: 'rect' | 'roundRect' | 'ellipse', x: number, y: number, w: number, h: number, st: BoxStyle) {
  const radius = Math.min(st.radiusPx || 0, w / 2, h / 2);
  const kind = shape === 'roundRect' && radius <= 0 ? 'rect' : shape;
  const options: PptxGenJS.ShapeProps = {
    x: inch(c, x), y: inch(c, y), w: inch(c, Math.max(w, 0.5)), h: inch(c, Math.max(h, 0.5)),
    fill: st.fill ? { color: hex(st.fill), ...(st.transparency ? { transparency: st.transparency } : {}) } : { type: 'none' },
    line: st.line ? { color: hex(st.line), width: round((st.lineWidthPx || 1) * c.ptPerPx, 2), dashType: st.dash ? 'dash' : 'solid' } : { type: 'none' },
  };
  if (kind === 'roundRect') options.rectRadius = inch(c, radius);
  slide.addShape(kind, options);
}

function addHLine(slide: Slide, c: Ctx, x: number, y: number, w: number, color: string, widthPx: number) {
  slide.addShape('line', { x: inch(c, x), y: inch(c, y), w: inch(c, w), h: 0, line: { color: hex(color), width: round(widthPx * c.ptPerPx, 2) } });
}

// ── Block plans ───────────────────────────────────────────────────────────

/** A measured block: its height in canvas px and how to draw it at a position. */
interface Plan { h: number; draw: (slide: Slide, x: number, y: number) => void }

const TONES = { warning: '#d48a1f', success: '#2f9e5b' };

function planBlock(c: Ctx, block: Block, w: number): Plan {
  const { colors } = c.theme;
  const { fonts } = c;
  switch (block.type) {
    case 'heading': {
      const size = block.level === 1 ? 68 : block.level === 2 ? 46 : 32;
      const f = fpx(c, size);
      const h = textHeight(plainText(flat(block.text)), f, 1.15, w, fonts.headingKind, true);
      const runs = runsOf(c, block.text, { px: size, color: colors.text, face: fonts.heading, bold: true, spacingPx: block.level === 1 ? -1 : -0.4 });
      return { h, draw: (slide, x, y) => addTextBox(slide, c, runs, x, y, w, h, { align: c.align, lineHeight: 1.15 }) };
    }
    case 'paragraph': {
      const f = fpx(c, 26);
      const h = textHeight(plainText(flat(block.text)), f, 1.5, w, fonts.bodyKind);
      const runs = runsOf(c, block.text, { px: 26, color: colors.text, face: fonts.body });
      return { h, draw: (slide, x, y) => addTextBox(slide, c, runs, x, y, w, h, { align: c.align, lineHeight: 1.5 }) };
    }
    case 'bullets': case 'numbered': {
      const f = fpx(c, 26), indent = 40, gap = 10;
      const h = block.items.reduce((sum, item) => sum + textHeight(plainText(flat(item)), f, 1.45, w - indent, fonts.bodyKind), 0) + v(c, gap) * Math.max(0, block.items.length - 1);
      const indentPt = round(indent * c.ptPerPx, 1);
      const bullet: RunOptions['bullet'] = block.type === 'bullets' ? { indent: indentPt } : { type: 'number', indent: indentPt };
      const runs = joinParagraphs(block.items.map(item => runsOf(c, item, { px: 26, color: colors.text, face: fonts.body })), bullet);
      return { h, draw: (slide, x, y) => addTextBox(slide, c, runs, x, y, w, h, { lineHeight: 1.45, paraGapPx: gap }) };
    }
    case 'quote': {
      const pad = v(c, 8), textX = 34, tw = w - textX;
      const tf = fpx(c, 36), af = fpx(c, 22);
      const th = textHeight(plainText(flat(block.text)), tf, 1.35, tw, fonts.headingKind);
      const attribution = block.attribution ? `— ${block.attribution}` : '';
      const ah = attribution ? textHeight(attribution, af, 1.25, tw, fonts.bodyKind) : 0;
      const h = pad * 2 + th + (attribution ? v(c, 14) + ah : 0);
      const runs = runsOf(c, block.text, { px: 36, color: colors.text, face: fonts.heading, italic: true });
      return {
        h, draw: (slide, x, y) => {
          addBox(slide, c, 'rect', x, y, 6, h, { fill: colors.accent });
          addTextBox(slide, c, runs, x + textX, y + pad, tw, th, { align: c.align, lineHeight: 1.35 });
          if (attribution) addTextBox(slide, c, runsOf(c, attribution, { px: 22, color: colors.muted, face: fonts.body }, false), x + textX, y + pad + th + v(c, 14), tw, ah, { align: c.align, lineHeight: 1.25 });
        },
      };
    }
    case 'callout': {
      const tone = block.tone === 'info' ? colors.accent : block.tone === 'note' ? colors.accent2 : TONES[block.tone];
      const padY = v(c, 20), padX = 26, bar = 6;
      const iw = w - bar - padX * 2 - 1;
      const titleF = fpx(c, 24), textF = fpx(c, 23);
      const titleH = block.title ? textHeight(block.title, titleF, 1.25, iw, fonts.bodyKind, true) : 0;
      const titleGap = block.title ? v(c, 6) : 0;
      const textH = textHeight(plainText(flat(block.text)), textF, 1.45, iw, fonts.bodyKind);
      const h = padY * 2 + titleH + titleGap + textH + 2;
      return {
        h, draw: (slide, x, y) => {
          addBox(slide, c, 'roundRect', x, y, w, h, { fill: tone, radiusPx: c.theme.radius });
          addBox(slide, c, 'roundRect', x + bar, y, w - bar, h, { fill: colors.surface, line: colors.border, radiusPx: c.theme.radius });
          const tx = x + bar + padX;
          if (block.title) addTextBox(slide, c, runsOf(c, block.title, { px: 24, color: colors.text, face: fonts.body, bold: true }, false), tx, y + 1 + padY, iw, titleH, { lineHeight: 1.25 });
          addTextBox(slide, c, runsOf(c, block.text, { px: 23, color: colors.text, face: fonts.body }), tx, y + 1 + padY + titleH + titleGap, iw, textH, { lineHeight: 1.45 });
        },
      };
    }
    case 'code': {
      const padY = v(c, 20), padX = 24, f = fpx(c, 19);
      const code = block.code.replace(/\t/g, '    ').replace(/\s+$/, '');
      const th = textHeight(code, f, 1.45, w - padX * 2, 'mono');
      const h = padY * 2 + th;
      const lines = code.split('\n');
      const runs = joinParagraphs(lines.map(line => [{ text: line, options: { fontSize: pt(c, 19), fontFace: MONO_FACE, color: 'E8EAF0' } }]));
      return {
        h, draw: (slide, x, y) => {
          addBox(slide, c, 'roundRect', x, y, w, h, { fill: c.theme.dark ? '#0a0b14' : '#1c1f26', radiusPx: c.theme.radius });
          addTextBox(slide, c, runs, x + padX, y + padY, w - padX * 2, th, { lineHeight: 1.45 });
        },
      };
    }
    case 'table': return planTable(c, block, w);
    case 'chart': return planChart(c, block, w);
    case 'timeline': return planTimeline(c, block, w);
    case 'steps': return planSteps(c, block, w);
    case 'metrics': return planMetrics(c, block, w);
    case 'grid': return planGrid(c, block, w);
    case 'columns': {
      const n = block.columns.length || 1, gap = 36;
      const cw = (w - gap * (n - 1)) / n;
      const columns = block.columns.map(column => column.map(child => planBlock(c, child, cw)));
      const heights = columns.map(col => col.reduce((s, p) => s + p.h, 0) + v(c, 16) * Math.max(0, col.length - 1));
      return {
        h: Math.max(0, ...heights), draw: (slide, x, y) => columns.forEach((col, i) => {
          let cy = y;
          for (const p of col) { p.draw(slide, x + i * (cw + gap), cy); cy += p.h + v(c, 16); }
        }),
      };
    }
    case 'image': return planImage(c, block, w);
    case 'templateDiagram': return planTemplateDiagram(c, block, w);
    case 'divider': {
      const h = v(c, 10);
      return { h, draw: (slide, x, y) => addHLine(slide, c, x, y + h / 2, w, colors.border, 2) };
    }
  }
}

function planTable(c: Ctx, block: Extract<Block, { type: 'table' }>, w: number): Plan {
  const { colors } = c.theme;
  const f = fpx(c, 21), lh = 1.25, padX = 14;
  const cols = block.header.length || 1;
  // Auto column widths like a browser table: weighted by content, clamped around the even split.
  const weights = block.header.map((head, i) => {
    const longest = Math.max(visualLength(head), ...block.rows.map(row => visualLength(plainText(row[i] || ''))));
    return Math.min(2, Math.max(0.6, Math.sqrt(Math.max(1, longest) / 12)));
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const colW = weights.map(wt => (w * wt) / totalWeight);
  const rowHeight = (cells: string[], padY: number, bold: boolean) =>
    Math.max(...cells.map((cell, i) => textHeight(plainText(cell), f, lh, colW[i] - padX * 2, c.fonts.bodyKind, bold)), f * lh) + padY * 2;
  const headPad = v(c, 12), cellPad = v(c, 10);
  const heights = [rowHeight(block.header, headPad, true), ...block.rows.map(row => rowHeight(row, cellPad, false) + 1)];
  const h = heights.reduce((a, b) => a + b, 0);
  const margin = (padY: number): [number, number, number, number] => [inch(c, padY), inch(c, padX), inch(c, padY), inch(c, padX)];
  const none: PptxGenJS.BorderProps = { type: 'none' };
  const base = { fontSize: pt(c, 21), fontFace: c.fonts.body, valign: 'middle' as const, align: 'left' as const };
  const rows: PptxGenJS.TableRow[] = [
    block.header.map(cell => ({ text: cell, options: { ...base, bold: true, color: 'FFFFFF', fill: { color: hex(colors.accent) }, margin: margin(headPad), border: [none, none, none, none] } })),
    ...block.rows.map((row, r) => Array.from({ length: cols }, (_, i) => ({
      text: runsOf(c, row[i] || '', { px: 21, color: colors.text, face: c.fonts.body }) as PptxGenJS.TableCell[],
      options: {
        ...base, color: hex(colors.text), margin: margin(cellPad),
        ...(r % 2 ? { fill: { color: hex(colors.surface) } } : {}),
        border: [none, none, { type: 'solid', pt: round(c.ptPerPx, 2), color: hex(colors.border) }, none] as [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps],
      },
    }))),
  ];
  return {
    h, draw: (slide, x, y) => slide.addTable(rows, {
      x: inch(c, x), y: inch(c, y), w: inch(c, w), colW: colW.map(cw => inch(c, cw)), rowH: heights.map(rh => inch(c, rh)),
      fontFace: c.fonts.body, fontSize: pt(c, 21), color: hex(colors.text),
    }),
  };
}

function planChart(c: Ctx, block: Extract<Block, { type: 'chart' }>, w: number): Plan {
  const { colors } = c.theme;
  const palette = [colors.accent, colors.accent2, colors.muted, colors.text];
  // CardView draws charts in a 1000×360 viewBox at full block width.
  const h = w * 0.36 * c.s;
  const unit = (block.unit || '').replace(/["\\]/g, '');
  const format = unit ? `General"${unit}"` : 'General';
  const face = c.fonts.body;
  const common: PptxGenJS.IChartOpts = {
    showTitle: false,
    catAxisLabelColor: hex(colors.muted), catAxisLabelFontFace: face, catAxisLabelFontSize: pt(c, 20),
    catAxisLineShow: true, catAxisLineColor: hex(colors.border), catAxisMajorTickMark: 'none',
    valAxisHidden: true, valGridLine: { style: 'none' }, valAxisLabelFormatCode: format,
    dataLabelColor: hex(colors.text), dataLabelFontFace: face, dataLabelFontSize: pt(c, 18), dataLabelFormatCode: format,
    showLegend: block.series.length > 1, legendPos: 't', legendColor: hex(colors.text), legendFontFace: face, legendFontSize: pt(c, 18),
    altText: [block.chartType, ...block.series.map(s => s.name)].join(' · '),
  };
  const data = block.series.map(s => ({ name: s.name, labels: block.labels, values: s.values }));
  return {
    h, draw: (slide, x, y) => {
      const pos = { x: inch(c, x), y: inch(c, y), w: inch(c, w), h: inch(c, h) };
      if (block.chartType === 'pie') {
        const pieColors = block.labels.map((_, i) => mix(palette[i % palette.length], colors.background, Math.floor(i / palette.length) * 0.35));
        slide.addChart('pie', data.slice(0, 1), {
          ...pos, ...common, chartColors: pieColors, showLegend: true, legendPos: 'r',
          showPercent: true, showValue: false, showLabel: false, dataLabelColor: 'FFFFFF', dataLabelPosition: 'bestFit', dataLabelFormatCode: '0%',
        });
      } else if (block.chartType === 'line') {
        slide.addChart('line', data, {
          ...pos, ...common, chartColors: palette.slice(0, block.series.length).map(hex),
          lineSize: round(5 * c.ptPerPx, 1), lineDataSymbol: 'none', showValue: true, dataLabelPosition: 't',
        });
      } else {
        slide.addChart('bar', data, {
          ...pos, ...common, chartColors: palette.slice(0, block.series.length).map(hex),
          barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 43, showValue: true, dataLabelPosition: 'outEnd',
        });
      }
    },
  };
}

/** Rows of a CSS grid: item heights → row heights (items stretch to the tallest in their row). */
function gridRows(heights: number[], cols: number): number[] {
  const rows: number[] = [];
  heights.forEach((h, i) => { const r = Math.floor(i / cols); rows[r] = Math.max(rows[r] || 0, h); });
  return rows;
}

function gridDraw(c: Ctx, w: number, n: number, cols: number, gap: number, heights: number[], drawItem: (slide: Slide, i: number, x: number, y: number, cw: number, rh: number) => void, before?: (slide: Slide, x: number, y: number) => void): Plan {
  const cw = (w - gap * (cols - 1)) / cols;
  const rows = gridRows(heights, cols);
  const rowGap = v(c, gap);
  const h = rows.reduce((a, b) => a + b, 0) + rowGap * Math.max(0, rows.length - 1);
  return {
    h, draw: (slide, x, y) => {
      before?.(slide, x, y);
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), col = i % cols;
        const ry = y + rows.slice(0, r).reduce((a, b) => a + b, 0) + rowGap * r;
        drawItem(slide, i, x + col * (cw + gap), ry, cw, rows[r]);
      }
    },
  };
}

function planTimeline(c: Ctx, block: Extract<Block, { type: 'timeline' }>, w: number): Plan {
  const { colors } = c.theme;
  const cols = Math.max(1, Math.min(block.items.length, 5)), gap = 22;
  const cw = (w - gap * (cols - 1)) / cols;
  const dot = v(c, 28);
  const parts = block.items.map(item => {
    const labelH = item.label ? textHeight(item.label.toUpperCase(), fpx(c, 18), 1.2, cw, c.fonts.bodyKind, true) : fpx(c, 18) * 1.2;
    const titleH = textHeight(item.title, fpx(c, 23), 1.2, cw, c.fonts.bodyKind, true);
    const textH = item.text ? textHeight(plainText(flat(item.text)), fpx(c, 19), 1.4, cw, c.fonts.bodyKind) : 0;
    return { labelH, titleH, textH };
  });
  const heights = parts.map(p => dot + v(c, 14) + p.labelH + v(c, 4) + p.titleH + (p.textH ? v(c, 6) + p.textH : 0));
  return gridDraw(c, w, block.items.length, cols, gap, heights, (slide, i, x, y, colW) => {
    const item = block.items[i], p = parts[i];
    addBox(slide, c, 'ellipse', x + 2, y + 2, dot - 4, dot - 4, { fill: i % 2 ? colors.accent2 : colors.accent, line: colors.background, lineWidthPx: 4 });
    let cy = y + dot + v(c, 14);
    if (item.label) addTextBox(slide, c, runsOf(c, item.label, { px: 18, color: colors.accent, face: c.fonts.body, bold: true, spacingPx: 1, upper: true }, false), x, cy, colW, p.labelH, { lineHeight: 1.2 });
    cy += p.labelH + v(c, 4);
    addTextBox(slide, c, runsOf(c, item.title, { px: 23, color: colors.text, face: c.fonts.body, bold: true }, false), x, cy, colW, p.titleH, { lineHeight: 1.2 });
    cy += p.titleH + v(c, 6);
    if (item.text) addTextBox(slide, c, runsOf(c, item.text, { px: 19, color: colors.muted, face: c.fonts.body }), x, cy, colW, p.textH, { lineHeight: 1.4 });
  }, (slide, x, y) => addBox(slide, c, 'rect', x, y + v(c, 13), w, Math.max(v(c, 3), 1), { fill: colors.border }));
}

function planSteps(c: Ctx, block: Extract<Block, { type: 'steps' }>, w: number): Plan {
  const { colors, radius } = c.theme;
  const cols = Math.max(1, Math.min(block.items.length, 4)), gap = 18, padX = 22, padY = v(c, 20), cap = v(c, 5);
  const cw = (w - gap * (cols - 1)) / cols, iw = cw - padX * 2 - 2;
  const numH = fpx(c, 34) * 1.2;
  const parts = block.items.map(item => ({
    titleH: textHeight(item.title, fpx(c, 23), 1.2, iw, c.fonts.bodyKind, true),
    textH: item.text ? textHeight(plainText(flat(item.text)), fpx(c, 19), 1.4, iw, c.fonts.bodyKind) : 0,
  }));
  const heights = parts.map(p => cap + padY * 2 + numH + v(c, 6) + p.titleH + (p.textH ? v(c, 6) + p.textH : 0) + 1);
  return gridDraw(c, w, block.items.length, cols, gap, heights, (slide, i, x, y, colW, rh) => {
    const item = block.items[i], p = parts[i];
    addBox(slide, c, 'roundRect', x, y, colW, rh, { fill: colors.accent, radiusPx: radius });
    addBox(slide, c, 'roundRect', x, y + cap, colW, rh - cap, { fill: colors.surface, line: colors.border, radiusPx: radius });
    let cy = y + cap + padY;
    addTextBox(slide, c, runsOf(c, String(i + 1), { px: 34, color: colors.accent, face: c.fonts.heading, bold: true }, false), x + padX + 1, cy, iw, numH, { lineHeight: 1.2 });
    cy += numH + v(c, 6);
    addTextBox(slide, c, runsOf(c, item.title, { px: 23, color: colors.text, face: c.fonts.body, bold: true }, false), x + padX + 1, cy, iw, p.titleH, { lineHeight: 1.2 });
    cy += p.titleH + v(c, 6);
    if (item.text) addTextBox(slide, c, runsOf(c, item.text, { px: 19, color: colors.muted, face: c.fonts.body }), x + padX + 1, cy, iw, p.textH, { lineHeight: 1.4 });
  });
}

function planMetrics(c: Ctx, block: Extract<Block, { type: 'metrics' }>, w: number): Plan {
  const { colors } = c.theme;
  const cols = Math.max(1, Math.min(block.items.length, 4)), gap = 22;
  const cw = (w - gap * (cols - 1)) / cols;
  const parts = block.items.map(item => ({
    valueH: textHeight(item.value, fpx(c, 56), 1.05, cw, c.fonts.headingKind, true),
    labelH: textHeight(item.label, fpx(c, 22), 1.2, cw, c.fonts.bodyKind, true),
    detailH: item.detail ? textHeight(item.detail, fpx(c, 18), 1.25, cw, c.fonts.bodyKind) : 0,
  }));
  const heights = parts.map(p => v(c, 4) + v(c, 6) + v(c, 10) + p.valueH + v(c, 6) + p.labelH + (p.detailH ? v(c, 4) + p.detailH : 0) + v(c, 6));
  return gridDraw(c, w, block.items.length, cols, gap, heights, (slide, i, x, y, colW) => {
    const item = block.items[i], p = parts[i];
    addBox(slide, c, 'rect', x, y, colW, Math.max(v(c, 4), 1), { fill: i % 2 ? colors.accent2 : colors.accent });
    let cy = y + v(c, 4) + v(c, 6) + v(c, 10);
    addTextBox(slide, c, runsOf(c, item.value, { px: 56, color: colors.text, face: c.fonts.heading, bold: true }, false), x, cy, colW, p.valueH, { lineHeight: 1.05 });
    cy += p.valueH + v(c, 6);
    addTextBox(slide, c, runsOf(c, item.label, { px: 22, color: colors.text, face: c.fonts.body, bold: true }, false), x, cy, colW, p.labelH, { lineHeight: 1.2 });
    cy += p.labelH + v(c, 4);
    if (item.detail) addTextBox(slide, c, runsOf(c, item.detail, { px: 18, color: colors.muted, face: c.fonts.body }, false), x, cy, colW, p.detailH, { lineHeight: 1.25 });
  });
}

function planGrid(c: Ctx, block: Extract<Block, { type: 'grid' }>, w: number): Plan {
  const { colors, radius } = c.theme;
  const n = block.items.length;
  const cols = Math.max(1, n === 4 ? 2 : Math.min(n, 3)), gap = 18, padX = 22, padY = v(c, 20);
  const cw = (w - gap * (cols - 1)) / cols, iw = cw - padX * 2 - 2;
  const icon = v(c, 40), iconGap = 12;
  const parts = block.items.map(item => {
    const titleH = textHeight(item.title, fpx(c, 23), 1.2, iw - icon - iconGap, c.fonts.bodyKind, true);
    return {
      titleH, headH: Math.max(icon, titleH),
      textH: item.text ? textHeight(plainText(flat(item.text)), fpx(c, 19), 1.4, iw, c.fonts.bodyKind) : 0,
    };
  });
  const heights = parts.map(p => 2 + padY * 2 + p.headH + (p.textH ? v(c, 10) + p.textH : 0));
  return gridDraw(c, w, n, cols, gap, heights, (slide, i, x, y, colW, rh) => {
    const item = block.items[i], p = parts[i];
    addBox(slide, c, 'roundRect', x, y, colW, rh, { fill: colors.surface, line: colors.border, radiusPx: radius });
    const ix = x + 1 + padX, iy = y + 1 + padY;
    const iconY = iy + (p.headH - icon) / 2;
    addBox(slide, c, 'roundRect', ix, iconY, icon, icon, { fill: colors.accent, radiusPx: v(c, 10) });
    addTextBox(slide, c, runsOf(c, item.icon || String(i + 1), { px: 20, color: '#ffffff', face: c.fonts.body, bold: true }, false), ix, iconY, icon, icon, { align: 'center', valign: 'middle', lineHeight: 1.2 });
    addTextBox(slide, c, runsOf(c, item.title, { px: 23, color: colors.text, face: c.fonts.body, bold: true }, false), ix + icon + iconGap, iy, iw - icon - iconGap, p.headH, { valign: 'middle', lineHeight: 1.2 });
    if (item.text) addTextBox(slide, c, runsOf(c, item.text, { px: 19, color: colors.muted, face: c.fonts.body }), ix, iy + p.headH + v(c, 10), iw, p.textH, { lineHeight: 1.4 });
  });
}

/**
 * A template diagram component (template-components.ts) as native objects:
 * its pictures and shapes at their relative positions, item texts in the
 * template's slots (editable text boxes), scaled to the column width and at
 * most 400 px tall — the same box CardView draws.
 */
function planTemplateDiagram(c: Ctx, block: Extract<Block, { type: 'templateDiagram' }>, w: number): Plan {
  const found = c.theme.components?.find(k => k.id === block.componentId);
  const comp = found && canArrange(found, block.items.length) ? found : undefined;
  if (!comp) return planBlock(c, { id: block.id, type: 'grid', items: block.items.map(i => ({ title: i.title, ...(i.text ? { text: i.text } : {}) })) }, w);
  const arranged = arrangeComponent(comp, block.items.length, block.items);
  const maxH = (comp.kind === 'column' || arranged.aspect < comp.aspect * 0.9 ? 520 : 400) * c.s;
  const boxW = Math.min(w, maxH * arranged.aspect), boxH = boxW / arranged.aspect;
  const ptToPx = boxW / (comp.slideWidthPt * comp.box.w) / arranged.widthScale; // template pt → canvas px at this size
  return {
    h: boxH, draw: (slide, x0, y0) => {
      const x = x0 + (w - boxW) / 2;
      const at = (r: { x: number; y: number; w: number; h: number }) => ({ x: x + r.x * boxW, y: y0 + r.y * boxH, w: r.w * boxW, h: r.h * boxH });
      for (const layer of arranged.layers) {
        const b = at(layer);
        if (layer.type === 'image') {
          const figureId = layer.slot && layer.unit !== undefined ? block.items[layer.unit]?.mediaId : undefined;
          const media = c.media(figureId || layer.mediaId);
          if (media && figureId && media.w && media.h) {
            // A figure in a picture slot: shown whole, centred in the slot.
            const r = media.h / media.w, dw = Math.min(b.w, b.h / r), dh = dw * r;
            slide.addImage({ data: media.data, x: inch(c, b.x + (b.w - dw) / 2), y: inch(c, b.y + (b.h - dh) / 2), w: inch(c, dw), h: inch(c, dh), altText: block.items[layer.unit!]?.title || '' });
          } else if (media && layer.clip) {
            // Motif continuation: the picture at full size, cropped to its visible part (srcRect).
            const cl = layer.clip;
            // srcRect crops the source picture before the shape is flipped: mirror the crop for a flipped segment.
            const sx0 = layer.flip === 'x' ? 1 - cl.x1 : cl.x0, sy0 = layer.flip === 'y' ? 1 - cl.y1 : cl.y0;
            slide.addImage({ data: media.data, x: inch(c, b.x + b.w * cl.x0), y: inch(c, b.y + b.h * cl.y0), w: inch(c, b.w), h: inch(c, b.h), altText: '',
              ...(layer.flip === 'x' ? { flipH: true } : layer.flip === 'y' ? { flipV: true } : {}),
              sizing: { type: 'crop', x: inch(c, b.w * sx0), y: inch(c, b.h * sy0), w: inch(c, b.w * (cl.x1 - cl.x0)), h: inch(c, b.h * (cl.y1 - cl.y0)) } });
          } else if (media) slide.addImage({ data: media.data, x: inch(c, b.x), y: inch(c, b.y), w: inch(c, b.w), h: inch(c, b.h), altText: '' });
        } else if (layer.type === 'line') {
          if (b.w >= b.h) addHLine(slide, c, b.x, b.y + b.h / 2, b.w, layer.stroke, layer.strokeWidth * ptToPx);
          else addBox(slide, c, 'rect', b.x + b.w / 2 - 1, b.y, Math.max(1, layer.strokeWidth * ptToPx), b.h, { fill: layer.stroke });
        } else {
          addBox(slide, c, layer.geom, b.x, b.y, b.w, b.h, {
            ...(layer.fill ? { fill: layer.fill, ...(layer.fillAlpha !== undefined && layer.fillAlpha < 1 ? { transparency: Math.round((1 - layer.fillAlpha) * 100) } : {}) } : {}),
            ...(layer.stroke ? { line: layer.stroke, lineWidthPx: (layer.strokeWidth || 1) * ptToPx } : {}),
            radiusPx: layer.geom === 'roundRect' ? Math.min(b.w, b.h) * 0.2 : 0,
          });
        }
      }
      for (const slot of arranged.slots) {
        const item = block.items[slot.unit];
        const value = slot.role === 'number' ? numberLike(slot.sample, slot.unit) : slot.role === 'title' ? item?.title : item?.text;
        if (!value) continue;
        const b = at(slot);
        const px = Math.max(8, slot.size * ptToPx);
        const face = slot.role === 'body' ? c.fonts.body : c.fonts.heading;
        addTextBox(slide, c, runsOf({ ...c, s: 1 }, value, { px, color: slot.color || c.theme.colors.text, face, bold: slot.bold }, slot.role !== 'number'), b.x, b.y, Math.max(b.w, px * 2), Math.max(b.h, px * 1.3),
          { align: slot.align === 'ctr' ? 'center' : slot.align === 'r' ? 'right' : 'left', valign: slot.anchor === 'ctr' ? 'middle' : 'top', lineHeight: 1.15 });
      }
    },
  };
}

/** "1" → "3", "01" → "03": numbers in the template's own format. */
export function numberLike(sample: string, unit: number): string {
  const n = String(unit + 1);
  return /^\s*0\d/.test(sample) ? n.padStart(2, '0') : n;
}

function planImage(c: Ctx, block: Extract<Block, { type: 'image' }>, w: number): Plan {
  const { colors, radius } = c.theme;
  const media = c.media(block.mediaId);
  const capF = fpx(c, 18);
  const capH = block.caption ? textHeight(block.caption, capF, 1.3, w, c.fonts.bodyKind) : 0;
  const capGap = block.caption ? v(c, 8) : 0;
  const caption = (slide: Slide, x: number, y: number) => {
    if (block.caption) addTextBox(slide, c, runsOf(c, block.caption, { px: 18, color: colors.muted, face: c.fonts.body }, false), x, y + capGap, w, capH, { align: c.align, lineHeight: 1.3 });
  };
  if (!media) {
    const boxH = v(c, 300);
    return {
      h: boxH + capGap + capH, draw: (slide, x, y) => {
        addBox(slide, c, 'roundRect', x, y, w, boxH, { line: colors.border, lineWidthPx: 2, dash: true, radiusPx: radius });
        addTextBox(slide, c, runsOf(c, block.alt || 'Image', { px: 20, color: colors.muted, face: c.fonts.body }, false), x, y, w, boxH, { align: 'center', valign: 'middle', lineHeight: 1.3 });
        caption(slide, x + 0, y + boxH);
      },
    };
  }
  // CardView: width 100%, max-height (block.height ?? 420), object-fit cover|contain.
  const ratio = media.w && media.h ? media.h / media.w : 9 / 16;
  const boxH = (block.height && block.fit === 'contain' ? block.height : Math.min(block.height ?? 420, w * ratio)) * c.s;
  return {
    h: boxH + capGap + capH, draw: (slide, x, y) => {
      if (block.fit === 'contain' || !media.w || !media.h) {
        const dw = Math.min(w, boxH / ratio), dh = dw * ratio;
        slide.addImage({ data: media.data, x: inch(c, x + (w - dw) / 2), y: inch(c, y + (boxH - dh) / 2), w: inch(c, dw), h: inch(c, dh), altText: block.alt });
      } else {
        slide.addImage({ data: media.data, x: inch(c, x), y: inch(c, y), w: inch(c, w), h: inch(c, w * ratio), sizing: { type: 'cover', w: inch(c, w), h: inch(c, boxH) }, altText: block.alt });
      }
      caption(slide, x, y + boxH);
    },
  };
}

// ── Media and accent art ──────────────────────────────────────────────────

const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp', 'image/bmp']);

/** Intrinsic pixel size from the image header (no decoding). */
export function imageSize(buf: Buffer, mime: string): { w: number; h: number } | null {
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : null);
  try {
    if (mime === 'image/png' && buf.length >= 24) return ok(buf.readUInt32BE(16), buf.readUInt32BE(20));
    if (mime === 'image/gif' && buf.length >= 10) return ok(buf.readUInt16LE(6), buf.readUInt16LE(8));
    if (mime === 'image/bmp' && buf.length >= 26) return ok(buf.readInt32LE(18), Math.abs(buf.readInt32LE(22)));
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xff) { i++; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (mime === 'image/webp' && buf.length >= 30) {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return ok(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
      if (chunk === 'VP8 ') return ok(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return ok((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1); }
      return null;
    }
    if (mime === 'image/svg+xml') return svgSize(buf.toString('utf8'));
  } catch { /* malformed header → unknown size */ }
  return null;
}

function svgSize(svg: string): { w: number; h: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] || '';
  const viewBox = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(root);
  const attr = (name: string) => Number(new RegExp(`\\b${name}="([\\d.]+)(px)?"`, 'i').exec(root)?.[1]);
  const w = attr('width') || Number(viewBox?.[1]), h = attr('height') || Number(viewBox?.[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

function normaliseMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim();
  return m === 'image/jpg' || m === 'image/pjpeg' ? 'image/jpeg' : m === 'image/svg' ? 'image/svg+xml' : m;
}

function resolveMedia(media: PptxMedia | null | undefined): ResolvedMedia | null {
  if (!media || !media.data || !media.data.length) return null;
  const mime = normaliseMime(media.mime || '');
  if (!SUPPORTED_MIME.has(mime)) return null;
  const size = imageSize(media.data, mime);
  return { data: `data:${mime};base64,${media.data.toString('base64')}`, ...(size ? { w: size.w, h: size.h } : {}) };
}

/** The default accent artwork size (accentDataUrl's defaults, what CardView shows). */
const ART_W = 800, ART_H = 1000;

/**
 * The card's accent art sized to its slot. CardView shows the 800×1000 art
 * with `object-fit: cover`; here the SVG's viewBox is narrowed to exactly the
 * region cover would show, so the slide shows the same crop without relying on
 * PowerPoint honouring a picture crop on an SVG blip.
 */
export function accentArtForSlot(theme: DeckTheme, seed: string, slotW: number, slotH: number): string {
  const svg = accentSvg(theme, seed, ART_W, ART_H);
  const boxRatio = slotW / slotH, artRatio = ART_W / ART_H;
  const cw = boxRatio > artRatio ? ART_W : ART_H * boxRatio;
  const ch = boxRatio > artRatio ? ART_W / boxRatio : ART_H;
  const cx = (ART_W - cw) / 2, cy = (ART_H - ch) / 2;
  const original = `viewBox="0 0 ${ART_W} ${ART_H}" width="${ART_W}" height="${ART_H}"`;
  if (!svg.includes(original)) return accentSvg(theme, seed, Math.round(slotW), Math.round(slotH));
  return svg.replace(original, `viewBox="${round(cx, 2)} ${round(cy, 2)} ${round(cw, 2)} ${round(ch, 2)}" width="${Math.round(slotW)}" height="${Math.round(slotH)}"`);
}

function addAccent(slide: Slide, c: Ctx, card: Card, slot: { x: number; y: number; w: number; h: number }) {
  const media = card.layout.accentMediaId ? c.media(card.layout.accentMediaId) : null;
  const pos = { x: inch(c, slot.x), y: inch(c, slot.y), w: inch(c, slot.w), h: inch(c, slot.h) };
  if (media && card.layout.accentFit === 'contain') {
    // A figure: the whole image on the surface colour, caption underneath (CardView's contained accent).
    addBox(slide, c, 'rect', slot.x, slot.y, slot.w, slot.h, { fill: c.theme.colors.surface });
    const padX = card.layout.accent === 'top' ? 80 : 28, padY = card.layout.accent === 'top' ? 20 : 40;
    const caption = card.layout.accentCaption || '';
    const capF = 15, capW = slot.w - padX * 2;
    const capH = caption ? textHeight(caption, capF, 1.35, capW, c.fonts.bodyKind) : 0;
    const boxW = capW, boxH = slot.h - padY * 2 - (caption ? capH + 10 : 0);
    const ratio = media.w && media.h ? media.h / media.w : 0.75;
    const dw = Math.min(boxW, boxH / ratio), dh = dw * ratio;
    slide.addImage({ data: media.data, x: inch(c, slot.x + padX + (boxW - dw) / 2), y: inch(c, slot.y + padY + (boxH - dh) / 2), w: inch(c, dw), h: inch(c, dh), altText: caption });
    if (caption) addTextBox(slide, { ...c, s: 1 }, runsOf({ ...c, s: 1 }, caption, { px: capF, color: c.theme.colors.muted, face: c.fonts.body }, false), slot.x + padX, slot.y + slot.h - padY - capH, capW, capH, { lineHeight: 1.35 });
    return;
  }
  if (media) {
    if (media.w && media.h) slide.addImage({ data: media.data, x: pos.x, y: pos.y, w: pos.w, h: round(pos.w * (media.h / media.w), 4), sizing: { type: 'cover', w: pos.w, h: pos.h }, altText: '' });
    else slide.addImage({ data: media.data, ...pos, altText: '' });
    return;
  }
  const svg = accentArtForSlot(c.theme, card.layout.accentSeed || card.id, slot.w, slot.h);
  slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, ...pos, altText: '', objectName: 'Accent art' });
}

// ── Header / footer ───────────────────────────────────────────────────────

const HF_KEYS = ['topLeft', 'topCenter', 'topRight', 'bottomLeft', 'bottomCenter', 'bottomRight'] as const;
/** Logo heights on the 1280-wide canvas, matching CardView. */
const LOGO_PX = { sm: 24, md: 36, lg: 52, xl: 72 } as const;

function addHeaderFooter(slide: Slide, c: Ctx, hf: HeaderFooter, canvasH: number, cardNumber: number, cardCount: number, deckTitle: string) {
  if ((hf.hideFromFirstCard && cardNumber === 1) || (hf.hideFromLastCard && cardNumber === cardCount)) return;
  const render = (slot?: HeaderFooterSlot) => !slot ? '' : slot.type === 'cardNumber' ? String(cardNumber) : slot.type === 'logo' ? (slot.value || deckTitle || '') : slot.value || '';
  const boxW = CANVAS * 0.4, boxH = 16 * 1.3;
  const fixed: Ctx = { ...c, s: 1 };
  let usedSlideNumber = false;
  for (const key of HF_KEYS) {
    const top = key.startsWith('top');
    const align = key.endsWith('Left') ? 'left' : key.endsWith('Right') ? 'right' : 'center';
    // A logo slot with an uploaded image (report 05 §6: image element, sizes sm–xl); text logo otherwise.
    const slotDef = hf[key];
    const logo = slotDef?.type === 'logo' && slotDef.mediaId ? c.media(slotDef.mediaId) : null;
    if (logo) {
      const h = LOGO_PX[slotDef?.size || 'md'];
      const w = logo.w && logo.h ? Math.min(CANVAS * 0.3, h * (logo.w / logo.h)) : h;
      const x = align === 'left' ? 32 : align === 'right' ? CANVAS - 32 - w : (CANVAS - w) / 2;
      const y = top ? 20 : canvasH - 20 - h;
      slide.addImage({ data: logo.data, x: inch(fixed, x), y: inch(fixed, y), w: inch(fixed, w), h: inch(fixed, h), altText: 'Logo', objectName: 'Logo' });
      continue;
    }
    if (slotDef?.type === 'cardNumber' && !usedSlideNumber) {
      // A native slide-number field: PowerPoint renumbers it and importers recognise it.
      usedSlideNumber = true;
      const x = align === 'left' ? 32 : align === 'right' ? CANVAS - 32 - boxW : (CANVAS - boxW) / 2;
      const y = top ? 24 : canvasH - 24 - boxH;
      slide.slideNumber = { x: inch(fixed, x), y: inch(fixed, y), w: inch(fixed, boxW), h: inch(fixed, boxH), fontFace: c.fonts.body, fontSize: Math.round(16 * c.ptPerPx * 10) / 10, color: hex(c.theme.colors.muted), align };
      continue;
    }
    const value = render(slotDef);
    if (!value) continue;
    const x = align === 'left' ? 32 : align === 'right' ? CANVAS - 32 - boxW : (CANVAS - boxW) / 2;
    const y = top ? 24 : canvasH - 24 - boxH;
    addTextBox(slide, fixed, runsOf(fixed, value, { px: 16, color: c.theme.colors.muted, face: c.fonts.body }, false), x, y, boxW, boxH, { align, valign: top ? 'top' : 'middle', lineHeight: 1.2 });
  }
}

// ── Cards ─────────────────────────────────────────────────────────────────

interface Region { x: number; y: number; w: number; h: number }

function addCardSlide(pptx: PptxGenJS, deck: Deck, card: Card, base: Ctx, canvasH: number, fluid: boolean, cardNumber: number, cardCount: number) {
  const { theme } = base;
  const slide = pptx.addSlide();
  slide.background = { color: hex(theme.colors.background) };
  const accent = card.layout.accent;
  const share = card.layout.accentSize ?? (accent === 'top' ? 0.38 : 0.4);
  // A template-art band takes a strip at the top or bottom; the card body lays out in the rest (CardView does the same).
  const band = card.layout.band;
  const bandMedia = band ? base.media(band.mediaId) : null;
  const bandH = band && bandMedia ? canvasH * band.size : 0;
  const top0 = band?.position === 'top' ? bandH : 0;
  const bodyH = canvasH - bandH;
  if (band && bandMedia) {
    const by = band.position === 'top' ? 0 : canvasH - bandH;
    const pos = { x: inch(base, 0), y: inch(base, by), w: inch(base, CANVAS), h: inch(base, bandH) };
    if (bandMedia.w && bandMedia.h) slide.addImage({ data: bandMedia.data, x: pos.x, y: pos.y, w: pos.w, h: round(pos.w * (bandMedia.h / bandMedia.w), 4), sizing: { type: 'cover', w: pos.w, h: pos.h }, altText: '', objectName: 'Template band' });
    else slide.addImage({ data: bandMedia.data, ...pos, altText: '', objectName: 'Template band' });
  }
  let region: Region = { x: 0, y: top0, w: CANVAS, h: bodyH };
  let slot: Region | null = null;
  if (accent === 'left') { slot = { x: 0, y: top0, w: CANVAS * share, h: bodyH }; region = { x: CANVAS * share, y: top0, w: CANVAS * (1 - share), h: bodyH }; }
  else if (accent === 'right') { slot = { x: CANVAS * (1 - share), y: top0, w: CANVAS * share, h: bodyH }; region = { x: 0, y: top0, w: CANVAS * (1 - share), h: bodyH }; }
  else if (accent === 'top') { slot = { x: 0, y: top0, w: CANVAS, h: bodyH * share }; region = { x: 0, y: top0 + bodyH * share, w: CANVAS, h: bodyH * (1 - share) }; }
  else if (accent === 'background') slot = { x: 0, y: top0, w: CANVAS, h: bodyH };

  if (slot) addAccent(slide, base, card, slot);
  if (accent === 'background') addBox(slide, base, 'rect', 0, top0, CANVAS, bodyH, theme.dark ? { fill: '#000000', transparency: 45 } : { fill: '#ffffff', transparency: 28 });

  const pad = accent === 'background' ? { x: 96, y: 72 } : { x: 80, y: 64 };
  const contentW = region.w - pad.x * 2, availH = region.h - pad.y * 2;
  const layout = (s: number) => {
    const c: Ctx = { ...base, s, align: card.layout.align === 'center' ? 'center' : 'left' };
    const plans = card.blocks.map(block => planBlock(c, block, contentW));
    const total = plans.reduce((sum, p) => sum + p.h, 0) + v(c, BLOCK_GAP) * Math.max(0, plans.length - 1);
    return { c, plans, total };
  };
  let fit = layout(1);
  if (fit.total > availH) {
    let lo = MIN_FIT_SCALE, hi = 1;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (layout(mid).total <= availH) lo = mid; else hi = mid; }
    fit = layout(lo);
  }
  let y = region.y + pad.y + (!fluid && fit.total < availH ? (availH - fit.total) / 2 : 0);
  for (const p of fit.plans) { p.draw(slide, region.x + pad.x, y); y += p.h + v(fit.c, BLOCK_GAP); }

  addHeaderFooter(slide, base, deck.headerFooter || {}, canvasH, cardNumber, cardCount, deck.title);
  if (card.notes && card.notes.trim()) slide.addNotes(card.notes);
}

// ── Post-processing ───────────────────────────────────────────────────────

const PPR = /<a:pPr\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/a:pPr>)/g;

/** Keeps only a paragraph's leading <a:pPr> (pptxgenjs repeats one before every run). */
export function dedupeParagraphProps(xml: string): string {
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_, inner: string) => {
    const lead = /^<a:pPr\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/a:pPr>)/.exec(inner)?.[0] || '';
    return `<a:p>${lead}${inner.slice(lead.length).replace(PPR, '')}</a:p>`;
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let x = n; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; table[n] = x >>> 0; }
  return table;
})();

function crc32(buf: Buffer): number {
  let x = 0xffffffff;
  for (let i = 0; i < buf.length; i++) x = CRC_TABLE[(x ^ buf[i]) & 0xff] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal RGB PNG encoder (node:zlib only). */
function encodePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** PNG stand-in for an SVG (viewers without SVG support): the art's background with its accent gradient. */
export function svgFallbackPng(svg: string): Buffer {
  const size = svgSize(svg) || { w: 4, h: 5 };
  const long = 192;
  const w = Math.max(8, Math.round(size.w >= size.h ? long : (long * size.w) / size.h));
  const h = Math.max(8, Math.round(size.h >= size.w ? long : (long * size.h) / size.w));
  const stops = [...svg.matchAll(/stop-color="(#[0-9a-fA-F]{3,6})"/g)].map(m => m[1]);
  const bg = /<rect\b[^>]*fill="(#[0-9a-fA-F]{3,6})"/.exec(svg)?.[1] || '#d9dee7';
  const a = stops[0] || bg, b = stops[1] || a;
  const rgb = (c: string) => [0, 2, 4].map(i => parseInt(hex(c).slice(i, i + 2), 16)) as [number, number, number];
  const A = rgb(a), B = rgb(b), BG = rgb(bg);
  return encodePng(w, h, (x, y) => {
    const t = (x / w + y / h) / 2;
    const strength = 0.35 + 0.45 * Math.sin(Math.PI * t);
    return [0, 1, 2].map(i => Math.round(BG[i] + ((A[i] + (B[i] - A[i]) * t) - BG[i]) * strength)) as [number, number, number];
  });
}

async function finalise(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files);
  for (const name of files.filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
    const xml = await zip.file(name)!.async('string');
    zip.file(name, dedupeParagraphProps(xml));
  }
  for (const name of files) {
    const m = /^ppt\/media\/image-(\d+)-(\d+)\.svg$/.exec(name);
    if (!m) continue;
    const fallback = `ppt/media/image-${m[1]}-${Number(m[2]) - 1}.png`;
    if (!zip.file(fallback)) continue;
    zip.file(fallback, svgFallbackPng(await zip.file(name)!.async('string')));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function buildDeckPptx(deck: Deck, opts: BuildDeckPptxOptions = {}): Promise<Buffer> {
  const theme = deckTheme(deck);
  const size = slideSize(deck.settings.dimensions, deck.settings.format);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DECK', width: size.width, height: size.height });
  pptx.layout = 'DECK';
  pptx.title = deck.title || 'Untitled deck';
  pptx.subject = deck.title || '';
  pptx.author = 'AI Native Lab';
  pptx.company = 'AI Native Lab';
  const fonts: Fonts = {
    heading: pickFace(theme.fonts.heading), body: pickFace(theme.fonts.body),
    headingKind: fontKind(theme.fonts.heading), bodyKind: fontKind(theme.fonts.body),
  };
  pptx.theme = { headFontFace: fonts.heading, bodyFontFace: fonts.body };

  const cache = new Map<string, ResolvedMedia | null>();
  const media = (mediaId: string | undefined) => {
    if (!mediaId || !opts.readMedia) return null;
    if (!cache.has(mediaId)) {
      let resolved: ResolvedMedia | null = null;
      try { resolved = resolveMedia(opts.readMedia(mediaId)); } catch { resolved = null; }
      cache.set(mediaId, resolved);
    }
    return cache.get(mediaId) || null;
  };

  const k = size.width / CANVAS;
  const base: Ctx = { theme, k, ptPerPx: k * 72, s: 1, fonts, align: 'left', media };
  const canvasH = size.height / k;
  const visible = deck.cards.filter(card => !card.hidden);
  visible.forEach((card, i) => addCardSlide(pptx, deck, card, base, canvasH, size.fluid, i + 1, visible.length));
  if (visible.length === 0) pptx.addSlide().background = { color: hex(theme.colors.background) };

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return finalise(Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array));
}

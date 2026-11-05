import type { SourceBlock, SourceFigure } from './source';

/**
 * PDF → structured source (server only). Uses pdfjs-dist (already shipped for
 * the PDF viewer) to read positioned text, then rebuilds what a reader sees:
 *
 * - reading order across one- and two-column layouts (full-width lines such as
 *   wide captions split the page into bands; each band is read left column,
 *   then right column);
 * - headings from bold fonts and numbering ("2.1." → level 2, "A." → level 1);
 * - paragraphs from line spacing, with hyphenated line breaks re-joined;
 * - figure and table captions; table rows from cell gaps, so numbers survive;
 * - running headers, page numbers, footnotes, superscript markers and labels
 *   inside figures are left out (and counted).
 *
 * Figures are cropped from the rendered page (region above the caption), so
 * vector diagrams work as well as photos. Rendering needs @napi-rs/canvas
 * (pdfjs's optional Node canvas); without it figures keep their captions and
 * the result carries a warning.
 */

export interface PdfFigureImage { figureId: string; data: Buffer; mime: 'image/png'; width: number; height: number }
export interface ParsedPdf {
  title: string;
  authors?: string;
  pages: number;
  blocks: SourceBlock[];
  figures: SourceFigure[];
  images: PdfFigureImage[];
  dropped: { label: string; chars: number }[];
  /** A sample of what was left out, so the lab page can show it. */
  droppedSamples: { label: string; text: string; page: number }[];
  warnings: string[];
}
export interface PdfParseOptions { renderFigures?: boolean; maxPages?: number; maxFigures?: number; scale?: number }

export class PdfImportError extends Error {
  constructor(public status: number, message: string, public code = 'pdf_failed') { super(message); }
}

interface Item { str: string; x: number; x1: number; base: number; size: number; bold: boolean; italic: boolean }
interface Line {
  page: number; col: 'L' | 'R' | 'F'; x0: number; x1: number; top: number; bottom: number; size: number;
  text: string; cells: string[]; bold: boolean; italic: boolean; role?: 'body' | 'heading' | 'caption' | 'table' | 'drop';
}
interface PageInfo { width: number; height: number; lines: Line[] }

const CAPTION = /^(Figure|Fig\.|Table)\s*(\d+)\s*[.:]/i;
const NUMBERED_HEADING = /^((?:\d+|[A-Z])(?:\.\d+)*)\.?\s+\S/;
const TERMINAL = /[.!?:;]["”’)\]]?$/;
const round1 = (n: number) => Math.round(n * 10) / 10;

async function loadPdfjs() {
  try {
    // External at runtime (next.config serverExternalPackages); the legacy build runs in Node.
    return await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (error) {
    throw new PdfImportError(500, `The PDF reader is not available (${error instanceof Error ? error.message : String(error)}).`, 'pdf_reader_missing');
  }
}

export async function parsePdf(bytes: Buffer, opts: PdfParseOptions = {}): Promise<ParsedPdf> {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new PdfImportError(400, 'This file is not a PDF.', 'pdf_unreadable');
  const pdfjs = await loadPdfjs();
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0, stopAtErrors: false }).promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) throw new PdfImportError(400, 'This PDF is password-protected.', 'pdf_encrypted');
    throw new PdfImportError(400, `The PDF could not be read (${message}).`, 'pdf_unreadable');
  }
  const warnings: string[] = [];
  const maxPages = opts.maxPages ?? 120;
  const pageCount = Math.min(doc.numPages, maxPages);
  if (doc.numPages > maxPages) warnings.push(`Only the first ${maxPages} of ${doc.numPages} pages were read.`);

  // ── 1. Positioned items → lines, per page ──
  const pages: PageInfo[] = [];
  const sizeChars = new Map<number, number>();
  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    await page.getOperatorList(); // loads fonts, so bold/italic can be read from font names
    const fontStyle = (name: string) => {
      let real = '';
      try { real = page.commonObjs.has(name) ? String((page.commonObjs.get(name) as { name?: string })?.name || '') : ''; } catch { real = ''; }
      return { bold: /bold|medi|semibold|black|heavy|demi/i.test(real), italic: /italic|oblique|slant/i.test(real) };
    };
    const items: Item[] = [];
    for (const raw of content.items as { str?: string; transform?: number[]; width?: number; fontName?: string }[]) {
      if (!raw.str || !raw.transform || !raw.str.trim()) continue;
      const [a, b, c, d, e, f] = raw.transform;
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0) continue; // rotated (e.g. arXiv side stamp) or mirrored
      const size = round1(Math.hypot(c, d));
      const style = fontStyle(raw.fontName || '');
      items.push({ str: raw.str, x: e, x1: e + (raw.width || raw.str.length * size * 0.5), base: viewport.height - f, size, ...style });
      sizeChars.set(Math.round(size * 2) / 2, (sizeChars.get(Math.round(size * 2) / 2) || 0) + raw.str.length);
    }
    pages.push({ width: viewport.width, height: viewport.height, lines: buildLines(items, p, viewport.width) });
    page.cleanup();
  }
  const bodySize = [...sizeChars.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || 10;
  const allLines = pages.flatMap(pg => pg.lines);
  if (allLines.reduce((n, l) => n + l.text.length, 0) < 40) {
    throw new PdfImportError(422, 'No text was found in this PDF (it may be scanned images; OCR is not supported yet).', 'pdf_no_text');
  }

  // ── 2. Furniture: running headers / footers / page numbers ──
  const dropped = new Map<string, number>();
  const droppedSamples: ParsedPdf['droppedSamples'] = [];
  const drop = (line: Line, label: string) => {
    line.role = 'drop';
    dropped.set(label, (dropped.get(label) || 0) + line.text.length);
    if (droppedSamples.filter(d => d.label === label).length < 12) droppedSamples.push({ label, text: line.text.slice(0, 160), page: line.page });
  };
  const edgeCounts = new Map<string, number>();
  const edgeKey = (l: Line) => l.text.replace(/\d+/g, '#').toLowerCase();
  for (const pg of pages) for (const l of pg.lines) if (l.top < pg.height * 0.08 || l.bottom > pg.height * 0.93) edgeCounts.set(edgeKey(l), (edgeCounts.get(edgeKey(l)) || 0) + 1);
  for (const pg of pages) for (const l of pg.lines) {
    const atEdge = l.top < pg.height * 0.08 || l.bottom > pg.height * 0.93;
    if (atEdge && (/^[#\d\s\-–/]+$/.test(edgeKey(l)) || (pageCount >= 3 && (edgeCounts.get(edgeKey(l)) || 0) >= Math.max(2, pageCount * 0.3)))) drop(l, 'Running headers and page numbers');
  }

  // ── 3. Title and authors (first page, above the first heading) ──
  const first = pages[0];
  let title = '';
  let authors: string | undefined;
  /** Title and author lines: removed from the text, but still solid ground for figure regions. */
  const frontMatter = new Set<Line>();
  if (first) {
    const live = first.lines.filter(l => l.role !== 'drop');
    const biggest = Math.max(...live.map(l => l.size));
    if (biggest > bodySize * 1.2) {
      const titleLines = live.filter(l => l.size === biggest && l.top < first.height * 0.4);
      title = titleLines.map(l => l.text).join(' ').trim();
      titleLines.forEach(l => { l.role = 'drop'; frontMatter.add(l); });
      const below = live.filter(l => l.role !== 'drop' && l.top > (titleLines.at(-1)?.bottom ?? 0));
      const firstHeadingTop = Math.min(...below.filter(l => /^(abstract|introduction)\b/i.test(l.text) || (NUMBERED_HEADING.test(l.text) && /[A-Za-z]{3,}/.test(l.text)) || (l.text.length >= 45 && !l.bold)).map(l => l.top), first.height);
      const authorLines = below.filter(l => l.bottom <= firstHeadingTop);
      if (authorLines.length && authorLines.length <= 8) {
        authors = authorLines.map(l => l.text).join(' ').replace(/(^|\s)\d+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        authorLines.forEach(l => { l.role = 'drop'; frontMatter.add(l); });
      }
    }
  }
  try {
    const meta = await doc.getMetadata();
    const info = (meta?.info || {}) as { Title?: string; Author?: string };
    if (!title && info.Title) title = String(info.Title).trim();
    if (!authors && info.Author) authors = String(info.Author).trim().slice(0, 200);
  } catch { /* metadata is optional */ }

  // ── 4. Roles: headings, captions, tables, body, small text ──
  const figures: SourceFigure[] = [];
  const tables: { line: Line; label: string; caption: string; rows: string[][] }[] = [];
  const captionLines = new Map<Line, { kind: 'figure' | 'table'; number: number; label: string; text: string; lines: Line[] }>();
  for (const pg of pages) {
    const lines = pg.lines;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.role) continue;
      const cap = CAPTION.exec(l.text);
      if (cap && l.size <= bodySize + 0.6) {
        const group = [l];
        for (let j = i + 1; j < lines.length; j++) {
          const n = lines[j];
          const prev = group[group.length - 1];
          if (n.role || n.col !== l.col || Math.abs(n.size - l.size) > 0.4 || n.top - prev.bottom > l.size * 1.2 || CAPTION.test(n.text)) break;
          group.push(n);
        }
        group.forEach(g => { g.role = 'caption'; });
        const kind = /^t/i.test(cap[1]) ? 'table' : 'figure';
        const number = Number(cap[2]);
        const text = joinText(group.map(g => g.text)).replace(CAPTION, '').trim();
        captionLines.set(l, { kind, number, label: `${kind === 'table' ? 'Table' : 'Figure'} ${number}`, text, lines: group });
        continue;
      }
      if (l.size < bodySize - 0.4 && l.top > pg.height * 0.75) { drop(l, 'Footnotes and small print'); continue; }
      if (isHeading(l, bodySize)) { l.role = 'heading'; continue; }
      if (Math.abs(l.size - bodySize) <= 0.6 && l.cells.length === 1) { l.role = 'body'; continue; }
    }
  }

  // Tables: table-like rows next to a "Table N." caption, in the same column.
  for (const [capLine, cap] of captionLines) {
    if (cap.kind !== 'table') continue;
    const pg = pages[capLine.page - 1];
    const sameCol = pg.lines.filter(l => (l.col === capLine.col || l.col === 'F' || capLine.col === 'F') && !l.role?.match(/caption|heading/));
    const tableLike = (l: Line) => l.role !== 'drop' && (l.cells.length >= 2 || l.size < bodySize - 0.5);
    const collect = (dir: 1 | -1) => {
      const rows: Line[] = [];
      const ordered = sameCol.filter(l => (dir === 1 ? l.top > cap.lines.at(-1)!.bottom : l.bottom < capLine.top)).sort((a, b) => dir * (a.top - b.top));
      let edge = dir === 1 ? cap.lines.at(-1)!.bottom : capLine.top;
      for (const l of ordered) {
        const gap = dir === 1 ? l.top - edge : edge - l.bottom;
        if (gap > capLine.size * 2.5 || !tableLike(l)) break;
        rows.push(l);
        edge = dir === 1 ? l.bottom : l.top;
      }
      return dir === 1 ? rows : rows.reverse();
    };
    const above = collect(-1), below = collect(1);
    const rows = above.length >= below.length ? above : below;
    rows.forEach(r => { r.role = 'table'; });
    tables.push({ line: capLine, label: cap.label, caption: cap.text, rows: rows.map(r => r.cells) });
  }

  // Figures: the region above each caption, up to the nearest solid text.
  const regions: { figureId: string; page: number; x0: number; x1: number; top: number; bottom: number }[] = [];
  for (const [capLine, cap] of captionLines) {
    if (cap.kind !== 'figure') continue;
    const id = `F${cap.number}`;
    if (figures.some(f => f.id === id)) continue;
    figures.push({ id, label: cap.label, number: cap.number, caption: cap.text, page: capLine.page });
    const pg = pages[capLine.page - 1];
    const span = columnSpan(pg, capLine);
    const overlaps = (l: Line) => l.x1 > span.x0 + 4 && l.x0 < span.x1 - 4;
    const solid = (l: Line) => l !== capLine && l.bottom <= capLine.top + 1 && overlaps(l) &&
      ((l.role === 'body' && (l.text.length >= 30 || /[.:]$/.test(l.text))) || frontMatter.has(l) || l.role === 'heading' || l.role === 'caption' || l.role === 'table');
    const ceiling = Math.max(pg.height * 0.07, ...pg.lines.filter(solid).map(l => l.bottom));
    const region = { figureId: id, page: capLine.page, x0: span.x0, x1: span.x1, top: ceiling + 2, bottom: capLine.top - 2 };
    // Labels inside the figure are part of the picture, not body text.
    for (const l of pg.lines) if (!l.role || l.role === 'body') if (l.top >= region.top - 1 && l.bottom <= region.bottom + 2 && overlaps(l)) drop(l, 'Labels inside figures');
    if (region.bottom - region.top >= 24) regions.push(region);
  }
  if (opts.maxFigures !== undefined && regions.length > opts.maxFigures) regions.length = opts.maxFigures;

  // Everything else that is not body size: footnotes, superscripts, small notes.
  for (const l of allLines) if (!l.role) drop(l, l.size < bodySize ? 'Footnotes and small print' : 'Unclassified text');

  // ── 5. Reading-order blocks ──
  const blocks: SourceBlock[] = [];
  let para: Line[] = [];
  // Figures and tables float: one that interrupts an unfinished sentence is placed after the paragraph.
  let floats: SourceBlock[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', text: joinText(para.map(l => l.text)), page: para[0].page });
    para = [];
    blocks.push(...floats);
    floats = [];
  };
  const placeFloat = (block: SourceBlock) => {
    const open = para.at(-1);
    if (open && !TERMINAL.test(open.text)) floats.push(block);
    else { flush(); blocks.push(block); }
  };
  let pendingHeading: Line[] = [];
  const flushHeading = () => {
    if (!pendingHeading.length) return;
    const text = joinText(pendingHeading.map(l => l.text));
    blocks.push({ kind: 'heading', level: headingLevel(text, pendingHeading[0].size, bodySize), text, page: pendingHeading[0].page });
    pendingHeading = [];
  };
  for (const l of allLines) {
    if (l.role === 'heading') {
      flush();
      const prev = pendingHeading.at(-1);
      if (prev && (prev.page !== l.page || l.top - prev.bottom > l.size * 0.8 || NUMBERED_HEADING.test(l.text))) flushHeading();
      pendingHeading.push(l);
      continue;
    }
    if (l.role === 'caption' && captionLines.has(l)) {
      flushHeading();
      const cap = captionLines.get(l)!;
      if (cap.kind === 'figure') placeFloat({ kind: 'figure', figureId: `F${cap.number}`, page: l.page });
      else {
        const t = tables.find(x => x.line === l);
        placeFloat({ kind: 'table', label: cap.label, caption: cap.text, rows: t?.rows || [], page: l.page });
      }
      continue;
    }
    if (l.role !== 'body') continue;
    flushHeading();
    const prev = para.at(-1);
    if (prev) {
      const samePlace = prev.page === l.page && prev.col === l.col;
      const gap = l.top - prev.bottom;
      const listItem = /^(\d{1,2}[.)]|[•●▪◦\-–])\s+/.test(l.text);
      const prevEnded = TERMINAL.test(prev.text) || prev.x1 < columnRight(pages[prev.page - 1], prev) - l.size * 2;
      // An indented line starts a paragraph only after a finished line (list items wrap with a hanging indent).
      const newPara = samePlace ? (gap > l.size * 0.65 || listItem || (l.x0 - prev.x0 > l.size * 0.8 && prevEnded)) : (TERMINAL.test(prev.text) && prevEnded) || listItem;
      if (newPara) flush();
    }
    para.push(l);
  }
  flush();
  flushHeading();

  // ── 6. Figure images ──
  const images: PdfFigureImage[] = [];
  if (opts.renderFigures !== false && regions.length) {
    try {
      const scale = opts.scale ?? 2;
      const byPage = new Map<number, typeof regions>();
      for (const r of regions) byPage.set(r.page, [...(byPage.get(r.page) || []), r]);
      const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: CanvasLike; context: unknown } } }).canvasFactory;
      for (const [pageNo, list] of byPage) {
        const page = await doc.getPage(pageNo);
        const viewport = page.getViewport({ scale });
        const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: context as never, viewport, canvas: canvas as never }).promise;
        for (const r of list) {
          const sx = Math.max(0, Math.floor(r.x0 * scale)), sy = Math.max(0, Math.floor(r.top * scale));
          const sw = Math.min(Math.ceil(viewport.width) - sx, Math.ceil((r.x1 - r.x0) * scale));
          const sh = Math.min(Math.ceil(viewport.height) - sy, Math.ceil((r.bottom - r.top) * scale));
          if (sw < 20 || sh < 20) continue;
          const crop = factory.create(sw, sh);
          (crop.context as { drawImage(c: unknown, ...n: number[]): void }).drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
          const trimmed = trimWhitespace(crop.canvas, crop.context as Ctx2D, factory);
          const data = trimmed.canvas.toBuffer('image/png');
          images.push({ figureId: r.figureId, data, mime: 'image/png', width: trimmed.w, height: trimmed.h });
          const fig = figures.find(f => f.id === r.figureId);
          if (fig) { fig.width = trimmed.w; fig.height = trimmed.h; }
        }
        page.cleanup();
      }
    } catch (error) {
      warnings.push(`Figures could not be rendered (${error instanceof Error ? error.message : String(error)}); their captions were kept.`);
    }
  }
  const missing = figures.filter(f => !images.some(i => i.figureId === f.id)).length;
  if (missing && images.length) warnings.push(`${missing} figure${missing > 1 ? 's' : ''} had no picture area that could be cropped.`);
  await doc.destroy();

  return {
    title: title || 'Untitled document',
    ...(authors ? { authors } : {}),
    pages: doc.numPages,
    blocks,
    figures: figures.sort((a, b) => a.number - b.number),
    images,
    dropped: [...dropped.entries()].map(([label, chars]) => ({ label, chars })).sort((a, b) => b.chars - a.chars),
    droppedSamples,
    warnings,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

interface CanvasLike { toBuffer(mime: 'image/png'): Buffer; width: number; height: number }
interface Ctx2D { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } ; drawImage(c: unknown, ...n: number[]): void }

/** Crops near-white margins around a rendered figure (keeps a small border). */
function trimWhitespace(canvas: CanvasLike, ctx: Ctx2D, factory: { create(w: number, h: number): { canvas: CanvasLike; context: unknown } }) {
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const ink = (x: number, y: number) => { const i = (y * w + x) * 4; return data[i + 3] > 10 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235); };
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  const rowInk = (y: number) => { for (let x = 0; x < w; x += 2) if (ink(x, y)) return true; return false; };
  const colInk = (x: number) => { for (let y = top; y <= bottom; y += 2) if (ink(x, y)) return true; return false; };
  while (top < bottom && !rowInk(top)) top++;
  while (bottom > top && !rowInk(bottom)) bottom--;
  while (left < right && !colInk(left)) left++;
  while (right > left && !colInk(right)) right--;
  const pad = 6;
  top = Math.max(0, top - pad); left = Math.max(0, left - pad); bottom = Math.min(h - 1, bottom + pad); right = Math.min(w - 1, right + pad);
  const tw = right - left + 1, th = bottom - top + 1;
  if (tw >= w - 2 && th >= h - 2) return { canvas, w, h };
  const out = factory.create(tw, th);
  (out.context as Ctx2D).drawImage(canvas, left, top, tw, th, 0, 0, tw, th);
  return { canvas: out.canvas, w: tw, h: th };
}

/** Items → lines. Fragments break at wide gaps (column gutters, table cells); fragments on one baseline in one column form a line. */
function buildLines(items: Item[], page: number, pageWidth: number): Line[] {
  const sorted = [...items].sort((a, b) => a.base - b.base || a.x - b.x);
  // Group by baseline (tolerance scales with size).
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows.find(r => Math.abs(r[0].base - it.base) <= Math.max(r[0].size, it.size) * 0.35);
    if (row) row.push(it); else rows.push([it]);
  }
  const mid = pageWidth / 2;
  const lines: Line[] = [];
  const colOf = (x0: number, x1: number): Line['col'] => (x0 < mid - 12 && x1 > mid + 12 ? 'F' : x0 < mid ? 'L' : 'R');
  const fragText = (f: Item[]) => f.reduce((s, it, i) => {
    if (i === 0) return it.str;
    const gap = it.x - f[i - 1].x1;
    const needSpace = gap > Math.min(it.size, f[i - 1].size) * 0.18 && !/\s$/.test(s) && !/^\s/.test(it.str);
    return s + (needSpace ? ' ' : '') + it.str;
  }, '').replace(/\s+/g, ' ').trim();
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    // Split into fragments at wide gaps (column gutter, table cells).
    const frags: Item[][] = [];
    for (const it of row) {
      const cur = frags.at(-1);
      const last = cur?.at(-1);
      if (cur && last && it.x - last.x1 < Math.max(last.size, it.size) * 1.1) cur.push(it); else frags.push([it]);
    }
    // Fragments → columns; each column's line is measured on its own (a footnote can share a baseline with body text in the other column).
    const byCol = new Map<Line['col'], Item[][]>();
    for (const f of frags) {
      const col = colOf(f[0].x, f.at(-1)!.x1);
      byCol.set(col, [...(byCol.get(col) || []), f]);
    }
    for (const [col, fs] of byCol) {
      const weights = new Map<number, number>();
      for (const it of fs.flat()) weights.set(it.size, (weights.get(it.size) || 0) + it.str.length);
      const main = [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const mainBase = fs.flat().find(it => it.size === main)!.base;
      // Drop raised small items: footnote markers and superscripts.
      const kept = fs.map(f => f.filter(it => !(it.size < main * 0.85 && mainBase - it.base > main * 0.15))).filter(f => f.length);
      const all = kept.flat();
      if (!all.length) continue;
      const mainItems = all.filter(it => it.size === main);
      const cells = kept.map(f => composeAccents(fragText(f))).filter(Boolean);
      if (!cells.length) continue;
      lines.push({
        page, col, x0: Math.min(...all.map(i => i.x)), x1: Math.max(...all.map(i => i.x1)), top: mainBase - main * 0.85, bottom: mainBase + main * 0.2, size: main,
        text: cells.join(' '), cells, bold: mainItems.length > 0 && mainItems.every(i => i.bold), italic: mainItems.length > 0 && mainItems.every(i => i.italic),
      });
    }
  }
  return readingOrder(lines);
}

/** Bands split by full-width lines; within a band, left column then right column. */
function readingOrder(lines: Line[]): Line[] {
  const byTop = [...lines].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const out: Line[] = [];
  let left: Line[] = [], right: Line[] = [];
  for (const l of byTop) {
    if (l.col === 'F') { out.push(...left, ...right, l); left = []; right = []; }
    else if (l.col === 'L') left.push(l);
    else right.push(l);
  }
  out.push(...left, ...right);
  return out;
}

function isHeading(l: Line, body: number): boolean {
  if (!l.bold || l.cells.length > 1 || l.text.length > 90 || l.size < body - 0.3 || !/[A-Za-z]{3,}/.test(l.text)) return false;
  if (/^(abstract|references|bibliography|acknowledge?ments?|appendix|introduction|conclusions?|discussion|related work)\b/i.test(l.text)) return true;
  if (NUMBERED_HEADING.test(l.text) && !/^\d+[.)]\s+[a-z]/.test(l.text)) return true;
  return l.size >= body * 1.1 || (!TERMINAL.test(l.text) && l.text.length <= 70);
}

function headingLevel(text: string, size: number, body: number): 1 | 2 | 3 {
  const numbered = NUMBERED_HEADING.exec(text);
  if (numbered) { const depth = numbered[1].split('.').length; return Math.min(3, depth) as 1 | 2 | 3; }
  if (size >= body * 1.1) return 1;
  return 3;
}

function columnSpan(pg: PageInfo, l: Line): { x0: number; x1: number } {
  const body = pg.lines.filter(x => x.role === 'body' || x.role === 'heading');
  const lx0 = Math.min(...body.filter(x => x.col !== 'R').map(x => x.x0), l.x0);
  const rx1 = Math.max(...body.filter(x => x.col !== 'L').map(x => x.x1), l.x1);
  const mid = pg.width / 2;
  if (l.col === 'F') return { x0: lx0 - 4, x1: rx1 + 4 };
  if (l.col === 'L') return { x0: lx0 - 4, x1: Math.max(l.x1, mid - 8) + 2 };
  return { x0: Math.min(l.x0, mid + 8) - 2, x1: rx1 + 4 };
}

function columnRight(pg: PageInfo, l: Line): number {
  const same = pg.lines.filter(x => x.col === l.col && x.role === 'body');
  return same.length ? Math.max(...same.map(x => x.x1)) : l.x1;
}

const SPACING_ACCENTS: Record<string, string> = { '¨': '\u0308', '´': '\u0301', '`': '\u0300', 'ˆ': '\u0302', '˜': '\u0303', '¸': '\u0327', 'ˇ': '\u030c', '˚': '\u030a' };
/** TeX PDFs often place accents as separate glyphs ("J ¨urgen"); compose them onto the following letter. */
export function composeAccents(text: string): string {
  return text.replace(/\s?([¨´`ˆ˜¸ˇ˚])\s?([A-Za-z])/g, (whole, mark: string, letter: string) => (letter + SPACING_ACCENTS[mark]).normalize('NFC'));
}

/** Joins wrapped lines: re-joins hyphenated words, otherwise one space. */
export function joinText(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) { out = line; continue; }
    if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
    else out += ` ${line}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

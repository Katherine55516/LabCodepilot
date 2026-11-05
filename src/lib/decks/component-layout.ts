import type { TemplateComponent, TemplateComponentLayer, TemplateComponentSlot } from './types';

/**
 * A template component arranged for n items. Radial components (pieces of
 * one figure) only take their own count. Rows, columns and grids repeat or
 * drop whole units along the template's own spacing: unit k of the result is
 * drawn from unit (k mod units) of the template, shifted to its new place;
 * shared core layers (a connecting line, a backdrop) stretch with the span.
 * Geometry stays relative to the (new) component box; `aspect` changes with
 * the span. Shared by CardView, the PPTX exporter and the matcher.
 */

/** The items' texts, when known, let columns size each unit to its own content (flowColumn). */
export type ArrangeItems = { title: string; text?: string }[];

/** `widthScale`: the new box width in units of the template component's width (text sizes scale by its inverse). */
export interface ArrangedComponent { aspect: number; layers: TemplateComponentLayer[]; slots: TemplateComponentSlot[]; units: number; widthScale: number }

type Box = { x: number; y: number; w: number; h: number };

/**
 * The layout rule behind the units, as a repeating step pattern: the steps
 * between consecutive units (reading order) repeat with the smallest period
 * p (1 = equal steps along a line or staircase, 2 = zig-zag, columns = grid
 * rows, staggered or not). Unit k continues the pattern from unit k − p.
 * Equal steps are averaged so spacing is exactly equal. Null when the units
 * follow no repeating pattern.
 */
/** The smallest repeating period of the steps between units, or 0. */
export function stepPeriod(ub: Box[]): number {
  const d = ub.slice(1).map((b, i) => ({ x: b.x - ub[i].x, y: b.y - ub[i].y }));
  if (!d.length) return 0;
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.04 && Math.abs(a.y - b.y) < 0.04;
  // Any period that leaves at least one pair of steps to compare.
  for (let p = 1; p <= Math.max(1, d.length - 1); p++) if (d.every((v, i) => i + p >= d.length || close(v, d[i + p]))) return p;
  return d.length === 1 ? 1 : 0;
}

export function periodicPlaces(ub: Box[], n: number): { x: number; y: number }[] | null {
  const m = ub.length;
  if (m < 2) return null;
  const d = ub.slice(1).map((b, i) => ({ x: b.x - ub[i].x, y: b.y - ub[i].y }));
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.04 && Math.abs(a.y - b.y) < 0.04;
  let period = 0;
  for (let p = 1; p <= Math.max(1, d.length - 1); p++) {
    if (d.every((v, i) => i + p >= d.length || close(v, d[i + p]))) { period = p; break; }
  }
  if (!period && d.length === 1) period = 1;
  if (!period) return null;
  const places: { x: number; y: number }[] = [];
  if (period === 1) {
    // Equal steps: the average step from the first unit.
    const step = { x: d.reduce((a, v) => a + v.x, 0) / d.length, y: d.reduce((a, v) => a + v.y, 0) / d.length };
    for (let k = 0; k < n; k++) places.push({ x: ub[0].x + k * step.x, y: ub[0].y + k * step.y });
    return places;
  }
  const shift = { x: ub[period].x - ub[0].x, y: ub[period].y - ub[0].y };
  for (let k = 0; k < n; k++) {
    if (k < m) places.push({ x: ub[k].x, y: ub[k].y });
    else places.push({ x: places[k - period].x + shift.x, y: places[k - period].y + shift.y });
  }
  return places;
}

/** Shared layers covering much of the box mean the items sit around one figure (a clover, a chain): its count is fixed. */
function coreCentric(comp: TemplateComponent): boolean {
  const shared = comp.layers.filter(l => l.unit === undefined);
  const covered = shared.reduce((a, l) => a + l.w * l.h, 0);
  return covered >= 0.35;
}

/** Items per visual row (units whose top is within 60% of the smallest unit height share a row). */
function rowsOf(ub: Box[]): number[][] {
  const minH = Math.min(...ub.map(b => b.h));
  const rows: number[][] = [];
  ub.map((b, i) => ({ b, i })).sort((a, b) => a.b.y - b.b.y).forEach(({ b, i }) => {
    const row = rows.find(r => Math.abs(ub[r[0]].y - b.y) <= minH * 0.6);
    if (row) row.push(i); else rows.push([i]);
  });
  return rows.map(r => r.sort((a, b) => ub[a].x - ub[b].x));
}

/**
 * A motif: the items sit along one picture that repeats a pattern (a chain of
 * rings, an arrow strip, a drawn timeline) — the units step with a fixed
 * period along one axis across a shared picture. It grows by repeating the
 * pattern (motifExtend); it cannot shrink without cutting a link.
 */
function motifAxis(comp: TemplateComponent): 'x' | 'y' | null {
  return comp.motif && comp.layers[comp.motif.layer]?.type === 'image' ? comp.motif.axis : null;
}

export function canArrange(comp: TemplateComponent, n: number): boolean {
  if (n === comp.units) return true;
  if (coreCentric(comp) && !comp.fixed) return Boolean(motifAxis(comp)) && n >= 2 && n <= 8;
  if (comp.kind === 'radial' || comp.fixed || comp.units < 2 || !comp.unitBoxes?.length || coreCentric(comp)) return false;
  return n >= 2 && n <= 8;
}

/**
 * Regular re-layout for another item count: every unit the same size, equal
 * gaps, one unit (with its picture, marker, card) per item.
 * - row: the template's total width is kept; n units share it with equal
 *   gaps, each unit scaled uniformly (pictures keep their shape);
 * - grid: the template's column count, cell size and gutters; a short last
 *   row is centred; a staggered template keeps its per-column offset;
 * - column / zig-zag (one unit per visual row): flowColumn — heights by
 *   content, equal gaps, the template's left/right pattern kept.
 */
export function arrangeComponent(comp: TemplateComponent, n: number, items?: ArrangeItems): ArrangedComponent {
  const asIs = { aspect: comp.aspect, layers: comp.layers, slots: comp.slots, units: comp.units, widthScale: 1 };
  if (!canArrange(comp, n) || !comp.unitBoxes?.length) return asIs;
  if (coreCentric(comp) && n !== comp.units && motifAxis(comp)) return motifExtend(comp, n, motifAxis(comp)!);
  const ub = comp.unitBoxes;
  const rows = rowsOf(ub);
  const oneUnitPerRow = rows.every(r => r.length === 1);
  if (comp.kind === 'column' || (comp.kind !== 'row' && oneUnitPerRow)) {
    return flowColumn(comp, items && items.length === n ? items : Array.from({ length: n }, () => ({ title: 'x' })));
  }
  if (n === comp.units) return asIs;
  const unitW = Math.max(...ub.map(b => b.w)), unitH = Math.max(...ub.map(b => b.h));
  const layers: TemplateComponentLayer[] = [], slots: TemplateComponentSlot[] = [];
  const copyUnit = (src: number, to: { x: number; y: number }, scale: number) => {
    const o = ub[src];
    const map = <T extends Box>(b: T): T => ({ ...b, x: to.x + (b.x - o.x) * scale, y: to.y + (b.y - o.y) * scale, w: b.w * scale, h: b.h * scale });
    return { map };
  };
  let extentW: number, extentH: number;
  if (comp.kind === 'row' || rows.length === 1) {
    // Same total width, equal gaps, uniform scale.
    const left = Math.min(...ub.map(b => b.x)), right = Math.max(...ub.map(b => b.x + b.w));
    const total = right - left;
    const gaps = rows[0].slice(1).map((idx, i) => ub[idx].x - (ub[rows[0][i]].x + ub[rows[0][i]].w)).filter(g => g > 0);
    const gapRatio = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length) / unitW : 0.08;
    const w = total / (n + (n - 1) * gapRatio);
    const scale = Math.min(1.25, w / unitW);
    const gap = w * gapRatio;
    const top = Math.min(...ub.map(b => b.y));
    for (let k = 0; k < n; k++) {
      const src = k % comp.units;
      const { map } = copyUnit(src, { x: left + k * (w + gap), y: top + (ub[src].y - top) * scale }, scale);
      for (const l of comp.layers) if (l.unit === src) layers.push({ ...map(l), unit: k });
      for (const sl of comp.slots) if (sl.unit === src) slots.push({ ...map(sl), unit: k, size: sl.size * Math.max(0.8, Math.min(1, scale)) });
    }
    extentW = total; extentH = Math.max(...ub.map(b => b.y + b.h)) - top;
    extentH = Math.max(...[...layers, ...slots].map(b => b.y + b.h)) - top;
    // Shared layers keep the template width (it did not change).
    for (const l of comp.layers) if (l.unit === undefined) layers.unshift({ ...l });
  } else if (periodicPlaces(ub, n)) {
    // A repeating pattern (equal steps, zig-zag, staircase, grid rows with stagger): continue it.
    const places = periodicPlaces(ub, n)!;
    for (let k = 0; k < n; k++) {
      const src = k % comp.units;
      const { map } = copyUnit(src, places[k], 1);
      for (const l of comp.layers) if (l.unit === src) layers.push({ ...map(l), unit: k });
      for (const sl of comp.slots) if (sl.unit === src) slots.push({ ...map(sl), unit: k });
    }
    const placed = places.map((pl, k) => ({ ...pl, w: ub[k % comp.units].w, h: ub[k % comp.units].h }));
    const b0 = { x0: Math.min(...ub.map(b => b.x)), y0: Math.min(...ub.map(b => b.y)), x1: Math.max(...ub.map(b => b.x + b.w)), y1: Math.max(...ub.map(b => b.y + b.h)) };
    const b1 = { x0: Math.min(...placed.map(b => b.x)), y0: Math.min(...placed.map(b => b.y)), x1: Math.max(...placed.map(b => b.x + b.w)), y1: Math.max(...placed.map(b => b.y + b.h)) };
    for (const l of comp.layers) if (l.unit === undefined) {
      const kx = (b1.x1 - b1.x0) / Math.max(b0.x1 - b0.x0, 1e-6), ky = (b1.y1 - b1.y0) / Math.max(b0.y1 - b0.y0, 1e-6);
      layers.unshift({ ...l, x: b1.x0 + (l.x - b0.x0) * kx, w: l.w * kx, y: b1.y0 + (l.y - b0.y0) * ky, h: l.h * ky });
    }
    extentW = b1.x1 - b1.x0; extentH = b1.y1 - b1.y0;
  } else {
    // Grid: template columns, cell size and gutters; per-column stagger kept; short last row centred.
    const first = rows[0];
    const cols = first.length;
    const colX = first.map(i => ub[i].x);
    const colOffset = first.map(i => ub[i].y - Math.min(...first.map(j => ub[j].y)));
    const gapX = cols > 1 ? (colX[cols - 1] - colX[0] - (cols - 1) * unitW) / (cols - 1) : 0;
    const pitchY = rows.length > 1 ? Math.min(...rows[1].map(i => ub[i].y)) - Math.min(...first.map(i => ub[i].y)) : unitH * 1.15;
    const top = Math.min(...first.map(i => ub[i].y));
    const rowsN = Math.ceil(n / cols);
    for (let k = 0; k < n; k++) {
      const r = Math.floor(k / cols), c = k % cols;
      const inRow = r === rowsN - 1 ? n - r * cols : cols;
      const shift = ((cols - inRow) * (unitW + gapX)) / 2; // centre a short last row
      const src = first[c] !== undefined ? (rows[Math.min(r, rows.length - 1)][c] ?? first[c]) : k % comp.units;
      const { map } = copyUnit(src, { x: colX[0] + c * (unitW + gapX) + shift, y: top + r * pitchY + colOffset[c] }, 1);
      for (const l of comp.layers) if (l.unit === src) layers.push({ ...map(l), unit: k });
      for (const sl of comp.slots) if (sl.unit === src) slots.push({ ...map(sl), unit: k });
    }
    extentW = Math.max(...ub.map(b => b.x + b.w)) - Math.min(...ub.map(b => b.x));
    extentH = top + (rowsN - 1) * pitchY + Math.max(...colOffset) + unitH;
    const oldBottom = Math.max(...ub.map(b => b.y + b.h));
    for (const l of comp.layers) if (l.unit === undefined) {
      const k = extentH / Math.max(oldBottom, 1e-6);
      layers.unshift({ ...l, y: l.y * k, h: l.h * k });
    }
  }
  void extentW; void extentH;
  // Renormalise to the new box.
  const all = [...layers, ...slots];
  const x0 = Math.min(...all.map(b => b.x)), y0 = Math.min(...all.map(b => b.y));
  const x1 = Math.max(...all.map(b => b.x + b.w)), y1 = Math.max(...all.map(b => b.y + b.h));
  const sx = Math.max(x1 - x0, 1e-6), sy = Math.max(y1 - y0, 1e-6);
  const norm = <T extends Box>(b: T): T => ({ ...b, x: (b.x - x0) / sx, y: (b.y - y0) / sy, w: b.w / sx, h: b.h / sy });
  return { aspect: comp.aspect * (sx / sy), layers: layers.map(norm), slots: slots.map(norm), units: n, widthScale: sx };
}

/** Roughly how many characters fit on one line of a slot at its font size (for the matcher). */
export function slotCapacity(comp: TemplateComponent, role: 'title' | 'body'): number {
  const s = comp.slots.find(x => x.role === role);
  if (!s) return 0;
  const widthPt = s.w * comp.box.w * comp.slideWidthPt;
  const lines = role === 'title' ? 2 : 4;
  return Math.max(4, Math.floor((widthPt / (s.size * 0.55)) * lines));
}

const visualLen = (t: string) => [...t].reduce((n, ch) => n + (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 2 : 1), 0);

/**
 * A column (timeline, numbered list) laid out by content: each unit is as
 * tall as its own title and body need at the template's font sizes and slot
 * widths, units follow each other with the template's gap, unit furniture
 * (number box, connector, card) moves with its unit and a card behind the
 * unit grows with it, and lines spanning the whole column stretch to the new
 * height. Long items take more of the component, short ones less.
 */
function flowColumn(comp: TemplateComponent, items: ArrangeItems): ArrangedComponent {
  const ub = comp.unitBoxes;
  const n = items.length;
  // Template pt → component-relative units (x: of width, y: of height).
  const ptX = 1 / (comp.box.w * comp.slideWidthPt);
  const ptY = comp.aspect / (comp.box.w * comp.slideWidthPt);
  const gaps = ub.slice(1).map((b, i) => b.y - (ub[i].y + ub[i].h)).filter(g => g > 0);
  const gap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0.04;
  const linesFor = (slot: TemplateComponentSlot | undefined, text: string | undefined) => {
    if (!slot || !text) return 0;
    const perLine = Math.max(6, (slot.w / ptX) / (slot.size * 0.52));
    return Math.max(1, Math.ceil(visualLen(text) / perLine));
  };
  const layers: TemplateComponentLayer[] = [], slots: TemplateComponentSlot[] = [];
  let y = Math.min(...ub.map(b => b.y));
  for (let k = 0; k < n; k++) {
    const src = k % comp.units;
    const unit = ub[src];
    const title = comp.slots.find(s => s.unit === src && s.role === 'title');
    const body = comp.slots.find(s => s.unit === src && s.role === 'body');
    const titleH = title ? Math.max(title.h, linesFor(title, items[k].title) * title.size * 1.2 * ptY) : 0;
    const bodyH = body ? (items[k].text ? Math.max(body.size * 1.35 * ptY, linesFor(body, items[k].text) * body.size * 1.35 * ptY) : 0) : 0;
    const titleTop = title ? title.y - unit.y : 0;
    const bodyGap = title && body ? Math.max(0, body.y - (title.y + title.h)) : 0;
    const bottomPad = body ? Math.max(0, unit.y + unit.h - (body.y + body.h)) : title ? Math.max(0, unit.y + unit.h - (title.y + title.h)) : 0;
    const height = Math.max(title ? titleTop + titleH + (bodyH ? bodyGap + bodyH : 0) + bottomPad : unit.h, unit.h * 0.5);
    const dy = y - unit.y;
    for (const s of comp.slots) if (s.unit === src) {
      if (s.role === 'title') slots.push({ ...s, y: s.y + dy, h: titleH, unit: k });
      else if (s.role === 'body') { if (bodyH) slots.push({ ...s, y: y + titleTop + titleH + bodyGap, h: bodyH, unit: k }); }
      else slots.push({ ...s, y: s.y + dy, unit: k });
    }
    for (const l of comp.layers) if (l.unit === src) {
      // A card or bar as tall as the unit grows with it; markers keep their size and offset.
      const spans = l.h >= unit.h * 0.8;
      layers.push({ ...l, y: l.y + dy, h: spans ? l.h + (height - unit.h) : l.h, unit: k });
    }
    y += height + gap;
  }
  const top = Math.min(...ub.map(b => b.y));
  const total = y - gap; // bottom of the last unit, in old units
  const oldBottom = Math.max(...ub.map(b => b.y + b.h));
  for (const l of comp.layers) if (l.unit === undefined) {
    // Shared layers (a timeline line) stretch over the new extent.
    const k = (total - top) / Math.max(oldBottom - top, 1e-6);
    layers.unshift({ ...l, y: top + (l.y - top) * k, h: l.h * k });
  }
  const sy = Math.max(total, ...layers.map(l => l.y + l.h), ...slots.map(s => s.y + s.h));
  const norm = <T extends Box>(b: T): T => ({ ...b, y: b.y / sy, h: b.h / sy });
  return { aspect: comp.aspect / sy, layers: layers.map(norm), slots: slots.map(norm), units: n, widthScale: 1 };
}

/**
 * A motif component for any item count (grow or shrink), rebuilt from
 * segments of its own picture so every seam sits at the centre of a ring
 * (never at a crossing), where neighbouring segments show identical pixels:
 * - ring j sits at x_j = x_0 + j·pitch (pitch = period ÷ items per period,
 *   both measured from the pixels; x_0 from the content bounds);
 * - the first segment is the original picture (its start is clean);
 * - middle segments are copies shifted by whole periods (same phase);
 * - the last segment needs a clean far end: a whole-period copy when the new
 *   last ring has the original last ring's phase, else the picture mirrored
 *   along the axis, whose far end is the original's clean start (phase
 *   matches for two-ring patterns when the count is odd);
 * - otherwise (rare: longer periods) the tail is cut at the last ring's edge.
 * Labels follow the pattern: item k ≥ m continues item k − q one period on.
 */
function motifExtend(comp: TemplateComponent, n: number, axis: 'x' | 'y'): ArrangedComponent {
  const motif = comp.motif!;
  const ub = comp.unitBoxes;
  const m = comp.units;
  const q = motif.perPeriod;
  const P = motif.period;
  const pitch = P / q;
  const along = <T extends Box>(b: T) => (axis === 'x' ? b.x : b.y);
  const size = <T extends Box>(b: T) => (axis === 'x' ? b.w : b.h);
  const move = <T extends Box>(b: T, d: number): T => (axis === 'x' ? { ...b, x: b.x + d } : { ...b, y: b.y + d });
  // Items.
  const order = ub.map((b, i) => i).sort((a, b) => along(ub[a]) - along(ub[b]));
  const layers: TemplateComponentLayer[] = [], slots: TemplateComponentSlot[] = [];
  const sourceOf = (k: number): { src: number; shift: number } => (k < m ? { src: order[k], shift: 0 } : (() => { const s = sourceOf(k - q); return { src: s.src, shift: s.shift + P }; })());
  for (let k = 0; k < n; k++) {
    const { src, shift } = sourceOf(k);
    for (const l of comp.layers) if (l.unit === src) layers.push({ ...move(l, shift), unit: k });
    for (const s of comp.slots) if (s.unit === src) slots.push({ ...move(s, shift), unit: k });
  }
  for (let i = 0; i < comp.layers.length; i++) if (comp.layers[i].unit === undefined && i !== motif.layer) layers.push(comp.layers[i]);
  // The picture, as segments.
  const pic = comp.layers[motif.layer] as Extract<TemplateComponentLayer, { type: 'image' }>;
  const X0 = along(pic), X1 = along(pic) + size(pic);
  const cs = X0 + size(pic) * motif.start, ce = X0 + size(pic) * motif.end;
  const x0 = (cs + ce - (m - 1) * pitch) / 2;
  const ring = (j: number) => x0 + j * pitch;
  type Seg = { shift: number; flip: boolean; from: number; to: number };
  const segs: Seg[] = [];
  const endPlain = (n - m) % q === 0;
  const endFlip = !endPlain && (n - 1) % q === 0 && q <= 2;
  const endShift = endPlain ? (n - m) * pitch : endFlip ? cs + ce - X0 - X1 + (n - m) * pitch : 0;
  const endFirstRing = n - m; // the end segment holds rings n−m … n−1
  // Start with the original up to a ring both it and the next segment hold; add whole-period copies until the end segment reaches.
  let shift = 0, upTo = 0;
  const segments: { shift: number; flip: boolean; first: number; last: number }[] = [{ shift: 0, flip: false, first: 0, last: m - 1 }];
  while (endFirstRing > segments[segments.length - 1].last - 1 && segments.length < 12) {
    shift += P;
    const prev = segments[segments.length - 1];
    segments.push({ shift, flip: false, first: prev.first + q, last: prev.last + q });
  }
  segments.push({ shift: endShift, flip: endFlip, first: endFirstRing, last: n - 1 });
  // Seams: at the centre of a ring held by both neighbours.
  let from = cs;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i], next = segments[i + 1];
    const seamRing = next ? Math.max(next.first, Math.min(s.last - (next === segments[segments.length - 1] ? 0 : 0), upTo)) : n - 1;
    const to = next ? ring(Math.min(s.last, Math.max(next.first, Math.min(n - 1, s.last - 1)))) : (endPlain || endFlip ? ce + endShift + (endFlip ? 0 : 0) : ring(n - 1) + pitch * 0.5);
    void seamRing;
    if (to > from + 1e-6) segs.push({ shift: s.shift, flip: s.flip, from, to });
    from = to;
    upTo = s.last;
  }
  // Ends: the visible chain runs from the original's clean start to the clean end of the last segment.
  const last = segs[segs.length - 1];
  if (last && (endPlain || endFlip)) last.to = endFlip ? X0 + X1 - cs + endShift : ce + endShift;
  for (const g of segs) {
    const box = move(pic, g.shift);
    const lo = (g.from - along(box)) / size(pic), hi = (g.to - along(box)) / size(pic);
    const a = Math.max(0, Math.min(1, lo)), b = Math.max(a, Math.min(1, hi));
    if (b - a < 1e-4) continue;
    layers.unshift({ ...box, ...(axis === 'x' ? { clip: { x0: a, x1: b, y0: 0, y1: 1 } } : { clip: { x0: 0, x1: 1, y0: a, y1: b } }), ...(g.flip ? { flip: axis } : {}) });
  }
  const visible = (b: TemplateComponentLayer) => (b.type === 'image' && b.clip ? { x: b.x + b.w * b.clip.x0, y: b.y + b.h * b.clip.y0, w: b.w * (b.clip.x1 - b.clip.x0), h: b.h * (b.clip.y1 - b.clip.y0) } : b);
  const all: Box[] = [...layers.map(visible), ...slots];
  const bx0 = Math.min(...all.map(b => b.x)), by0 = Math.min(...all.map(b => b.y));
  const bx1 = Math.max(...all.map(b => b.x + b.w)), by1 = Math.max(...all.map(b => b.y + b.h));
  const sx = Math.max(bx1 - bx0, 1e-6), sy = Math.max(by1 - by0, 1e-6);
  const norm = <T extends Box>(b: T): T => ({ ...b, x: (b.x - bx0) / sx, y: (b.y - by0) / sy, w: b.w / sx, h: b.h / sy });
  return { aspect: comp.aspect * (sx / sy), layers: layers.map(norm), slots: slots.map(norm), units: n, widthScale: sx };
}

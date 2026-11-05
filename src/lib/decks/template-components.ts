import path from 'node:path';
import { PNG } from 'pngjs';
import { imageSize } from './export-pptx';
import { attr, decodeXml, type PartReader } from './import-pptx';
import type { TemplateComponent, TemplateComponentLayer, TemplateComponentSlot } from './types';

/**
 * Template components: the reusable diagrams inside a template's slides —
 * a four-petal numbered "clover", a donut with two sides, a numbered
 * timeline, a row of icon columns, a grid of cards. In an exported deck they
 * are pictures (often transparent PNG pieces stacked on one box), shapes,
 * number text boxes and item labels around them.
 *
 * Recognition, per slide:
 * 1. Flatten the shape tree (groups mapped through their child transforms).
 * 2. Leave out the slide title, wide intro paragraphs and edge artwork.
 * 3. Item titles: ≥ 2 short text boxes sharing a font size and colour.
 * 4. Each item gets its body text (below, smaller), its number (a "1"/"01"
 *    text box nearby), and its own marker/card shapes or icons.
 * 5. The core: graphic pictures and shapes inside the items' area that belong
 *    to no single item (the clover petals, the donut, a timeline line).
 * 6. Kind: radial (core pieces stacked on one box), row, column or grid.
 *
 * Everything is stored relative to the component's box, so it can be drawn
 * at any size with new item texts. Pictures are kept as hosted media; SVG
 * pieces are dropped (raster only), and a component that loses all its
 * pictures that way keeps its shapes and numbers.
 */

interface Box { x: number; y: number; w: number; h: number }
interface Prim {
  kind: 'pic' | 'shape' | 'text' | 'line';
  box: Box; z: number;
  target?: string; graphic?: boolean; svg?: boolean;
  geom?: string; fill?: string; fillAlpha?: number; line?: string; lineW?: number;
  text?: string; size?: number; color?: string; face?: string; bold?: boolean; align?: 'l' | 'ctr' | 'r'; anchor?: 't' | 'ctr' | 'b';
  title?: boolean;
}

const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);
const NUMBER = /^\s*0?\d{1,2}\s*$/;
const area = (b: Box) => b.w * b.h;
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const union = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (area(a) + area(b) - i || 1);
};
const contains = (outer: Box, p: { x: number; y: number }) => p.x >= outer.x && p.x <= outer.x + outer.w && p.y >= outer.y && p.y <= outer.y + outer.h;

/** Direct children of a shape tree / group: grpSp (balanced), sp, pic, cxnSp, in document order. */
function topLevel(xml: string): { tag: string; inner: string }[] {
  const out: { tag: string; inner: string }[] = [];
  const open = /<p:(grpSp|sp|pic|cxnSp)>/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const tag = m[1];
    const start = m.index + m[0].length;
    if (tag !== 'grpSp') {
      const close = xml.indexOf(`</p:${tag}>`, start);
      if (close < 0) break;
      out.push({ tag, inner: xml.slice(start, close) });
      open.lastIndex = close + tag.length + 5;
      continue;
    }
    // Balance nested groups.
    let depth = 1, i = start;
    const re = /<p:grpSp>|<\/p:grpSp>/g;
    re.lastIndex = start;
    let t: RegExpExecArray | null;
    while (depth && (t = re.exec(xml))) { depth += t[0] === '<p:grpSp>' ? 1 : -1; i = t.index; }
    if (depth) break;
    out.push({ tag, inner: xml.slice(start, i) });
    open.lastIndex = i + '</p:grpSp>'.length;
  }
  return out;
}

/** Reads one slide's primitives in drawing order, groups flattened. */
function primitives(xml: string, rels: { id: string; target: string }[], colorOf: (body: string) => { color: string; alpha: number } | null): Prim[] {
  const out: Prim[] = [];
  let z = 0;
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(xml)?.[1] || '';
  type Tx = (b: Box) => Box;
  const walk = (body: string, tx: Tx) => {
    for (const child of topLevel(body)) {
      if (child.tag === 'grpSp') {
        const g = child.inner;
        const x = /<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/.exec(g)?.[0] || '';
        const off = /<a:off\b[^>]*>/.exec(x)?.[0] || '', ext = /<a:ext\b[^>]*>/.exec(x)?.[0] || '';
        const choff = /<a:chOff\b[^>]*>/.exec(x)?.[0] || '', chext = /<a:chExt\b[^>]*>/.exec(x)?.[0] || '';
        const o = { x: num(attr(off, 'x')), y: num(attr(off, 'y')), cx: num(attr(ext, 'cx')), cy: num(attr(ext, 'cy')) };
        const c = { x: num(attr(choff, 'x')), y: num(attr(choff, 'y')), cx: num(attr(chext, 'cx')) || o.cx, cy: num(attr(chext, 'cy')) || o.cy };
        const sx = c.cx ? o.cx / c.cx : 1, sy = c.cy ? o.cy / c.cy : 1;
        walk(g.replace(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/, ''), b => tx({ x: o.x + (b.x - c.x) * sx, y: o.y + (b.y - c.y) * sy, w: b.w * sx, h: b.h * sy }));
        continue;
      }
      const kind = child.tag, el = child.inner;
      const xf = /<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/.exec(el)?.[0] || '';
      const off = /<a:off\b[^>]*>/.exec(xf)?.[0] || '', ext = /<a:ext\b[^>]*>/.exec(xf)?.[0] || '';
      const box = tx({ x: num(attr(off, 'x')), y: num(attr(off, 'y')), w: num(attr(ext, 'cx')), h: num(attr(ext, 'cy')) });
      if (!box.w && !box.h) continue;
      z++;
      if (kind === 'pic') {
        const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(el)?.[1];
        const target = embed ? rels.find(r => r.id === embed)?.target : undefined;
        if (target) out.push({ kind: 'pic', box, z, target, svg: /\.(svg|emf|wmf)$/i.test(target) });
        continue;
      }
      const spPr = /<p:spPr>[\s\S]*?<\/p:spPr>/.exec(el)?.[0] || '';
      const geom = /<a:prstGeom prst="([^"]+)"/.exec(spPr)?.[1] || (/<a:custGeom>/.test(spPr) ? 'custom' : 'rect');
      const fill = /<a:noFill\/>/.test(spPr.replace(/<a:ln[\s\S]*?<\/a:ln>/, '')) ? null : colorOf(spPr.replace(/<a:ln[\s\S]*?<\/a:ln>/, ''));
      const lnPart = /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(spPr)?.[0] || '';
      const ln = lnPart && !/<a:noFill\/>/.test(lnPart) ? colorOf(lnPart) : null;
      const lineW = num(attr(/<a:ln\b[^>]*>/.exec(lnPart)?.[0] || '', 'w')) / 12700;
      if (kind === 'cxnSp') { if (ln) out.push({ kind: 'line', box, z, line: ln.color, lineW: lineW || 1 }); continue; }
      const runs = [...el.matchAll(/<a:r>\s*(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))?\s*<a:t>([^<]*)<\/a:t>/g)];
      const text = decodeXml(runs.map(r => r[2]).join('')).replace(/\s+/g, ' ').trim();
      if (fill || ln) out.push({ kind: 'shape', box, z, geom, ...(fill ? { fill: fill.color, fillAlpha: fill.alpha } : {}), ...(ln ? { line: ln.color, lineW: lineW || 1 } : {}) });
      if (text) {
        const rPr = runs[0]?.[1] || '';
        const color = colorOf(rPr)?.color;
        const algn = /<a:pPr\b[^>]*algn="(l|ctr|r|just)"/.exec(el)?.[1];
        const anchor = /<a:bodyPr\b[^>]*anchor="(t|ctr|b)"/.exec(el)?.[1] as Prim['anchor'];
        out.push({
          kind: 'text', box, z, text, size: num(attr(/<a:rPr\b[^>]*>/.exec(rPr)?.[0] || '', 'sz')) / 100 || 18,
          ...(color ? { color } : {}), face: /<a:latin typeface="([^"]+)"/.exec(rPr)?.[1], bold: /\bb="1"/.test(rPr),
          align: algn === 'ctr' ? 'ctr' : algn === 'r' ? 'r' : 'l', anchor: anchor || 't', title: /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(el),
        });
      }
    }
  };
  walk(tree, b => b);
  return out;
}

function opaqueShare(data: Buffer): number {
  try {
    const png = PNG.sync.read(data);
    let opaque = 0, total = 0;
    const step = Math.max(1, Math.floor((png.width * png.height) / 20000));
    for (let i = 0; i < png.width * png.height; i += step) { total++; if (png.data[i * 4 + 3] > 200) opaque++; }
    return total ? opaque / total : 1;
  } catch { return 1; }
}

/** Few distinct colours in a 24×24 sample: a flat block exported as a picture. */
async function flatImage(data: Buffer): Promise<boolean> {
  try {
    const canvasMod = await import('@napi-rs/canvas');
    const img = await canvasMod.loadImage(data);
    const canvas = canvasMod.createCanvas(24, 24);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    const palette = new Set<number>();
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 40) palette.add(((px[i] >> 5) << 6) | ((px[i + 1] >> 5) << 3) | (px[i + 2] >> 5));
    return palette.size <= 4;
  } catch { return false; }
}

export interface ComponentImage { key: string; data: Buffer; mime: string; width?: number; height?: number }
export interface RecognizedComponents { components: (Omit<TemplateComponent, 'layers'> & { layers: (TemplateComponentLayer & { key?: string })[] })[]; images: ComponentImage[] }

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export async function recognizeComponents(
  reader: PartReader,
  slides: { index: number; xml: string; rels: { id: string; target: string }[] }[],
  size: { W: number; H: number },
  colorOf: (body: string) => { color: string; alpha: number } | null,
): Promise<RecognizedComponents> {
  const { W, H } = size;
  const images = new Map<string, ComponentImage>();
  const graphicCache = new Map<string, boolean>();
  const isGraphic = async (target: string, box: Box) => {
    const share = area(box) / (W * H);
    if (share < 0.006) return true; // icons and markers
    if (!graphicCache.has(target)) {
      const data = await reader.readBinary(target);
      // Transparent PNG pieces and flat colour blocks are graphics; real photos are not.
      graphicCache.set(target, data ? (/\.png$/i.test(target) && opaqueShare(data) < 0.6) || (await flatImage(data)) : false);
    }
    return graphicCache.get(target)!;
  };
  const components: RecognizedComponents['components'] = [];

  for (const slide of slides) {
    const prims = primitives(slide.xml, slide.rels, colorOf);
    for (const p of prims) if (p.kind === 'pic' && p.target) p.graphic = await isGraphic(p.target, p.box);
    const texts = prims.filter(p => p.kind === 'text');
    if (texts.length < 3) continue;
    // 2. Title and intro paragraphs stay out of components.
    const maxSize = Math.max(...texts.map(t => t.size || 0));
    const isTitle = (t: Prim) => t.title || (t.size === maxSize && maxSize >= 22);
    const isIntro = (t: Prim) => t.box.w >= W * 0.45 && (t.text || '').length > 80;
    // 3. Item titles: same size and colour, short, at least two.
    const groups = new Map<string, Prim[]>();
    for (const t of texts) {
      if (isTitle(t) || isIntro(t) || NUMBER.test(t.text || '')) continue;
      const len = (t.text || '').length;
      if (len < 2 || len > 90) continue;
      const key = `${Math.round((t.size || 0) * 2) / 2}|${t.color || ''}`;
      groups.set(key, [...(groups.get(key) || []), t]);
    }
    const ranked = [...groups.values()].filter(g => g.length >= 2 && g.length <= 8)
      .sort((a, b) => (b[0].size || 0) - (a[0].size || 0) || b.length - a.length);
    const titles = ranked[0];
    if (!titles) continue;
    const used = new Set<Prim>(titles);
    // 4. Per item: body, number, own shapes/icons.
    // Reading order: visual rows first (titles within a band of the slide height share a row, so staggered columns stay one row), then left to right.
    const rowOf = (t: Prim) => Math.round((t.box.y + t.box.h / 2) / (H * 0.14));
    const units = titles.sort((a, b) => rowOf(a) - rowOf(b) || a.box.x - b.box.x).map(title => ({ title, body: undefined as Prim | undefined, number: undefined as Prim | undefined, own: [] as Prim[] }));
    for (const u of units) {
      const body = texts.filter(t => !used.has(t) && !isTitle(t) && !NUMBER.test(t.text || '') && (t.size || 0) < (u.title.size || 0) &&
        t.box.y >= u.title.box.y && t.box.y - (u.title.box.y + u.title.box.h) < H * 0.12 &&
        Math.min(t.box.x + t.box.w, u.title.box.x + u.title.box.w) - Math.max(t.box.x, u.title.box.x) > Math.min(t.box.w, u.title.box.w) * 0.5)
        .sort((a, b) => a.box.y - b.box.y)[0];
      if (body && !(isIntro(body) && body.box.w > u.title.box.w * 1.6)) { u.body = body; used.add(body); }
    }
    const numbers = texts.filter(t => NUMBER.test(t.text || '') && !used.has(t));
    for (const n of numbers) {
      const c = center(n.box);
      const nearest = units.filter(u => !u.number).sort((a, b) => dist(center(a.title.box), c) - dist(center(b.title.box), c))[0];
      if (nearest) { nearest.number = n; used.add(n); }
    }
    const numbered = units.every(u => u.number);
    // Numbered components keep the template's reading order (a clover is numbered clockwise, not row by row).
    if (numbered) units.sort((a, b) => Number(a.number!.text) - Number(b.number!.text));
    else {
      // Zig-zag along a strip (labels alternating above and below a chain, an arrow, a line): read along the strip.
      const cx = units.map(u => center(u.title.box).x).sort((a, b) => a - b);
      const distinctX = cx.every((x, i) => i === 0 || x - cx[i - 1] > W * 0.03);
      const byX = [...units].sort((a, b) => center(a.title.box).x - center(b.title.box).x);
      const rowIdx = (u: typeof units[number]) => rowOf(u.title);
      const alternates = byX.length >= 3 && byX.every((u, i) => i === 0 || rowIdx(u) !== rowIdx(byX[i - 1]));
      if (distinctX && alternates) units.splice(0, units.length, ...byX);
    }
    const itemBoxes = units.map(u => union([u.title.box, ...(u.body ? [u.body.box] : []), ...(u.number ? [u.number.box] : [])]));
    const area0 = union(itemBoxes);
    const zone: Box = { x: area0.x - W * 0.03, y: area0.y - H * 0.05, w: area0.w + W * 0.06, h: area0.h + H * 0.1 };
    // Edge artwork (side images, bands, backgrounds: large and touching the slide edge) is not part of a component.
    const touchesEdge = (b: Box) => b.x <= W * 0.02 || b.y <= H * 0.02 || b.x + b.w >= W * 0.98 || b.y + b.h >= H * 0.98;
    const isEdgeArt = (p: Prim) => p.kind === 'pic' && !p.graphic && area(p.box) >= W * H * 0.04 && touchesEdge(p.box);
    // Picture slots: a photo aligned with one item, right above or below it (the item's own picture).
    const imageSlot = new Set<Prim>();
    for (const p of prims) {
      if (p.kind !== 'pic' || p.graphic || used.has(p) || isEdgeArt(p) || area(p.box) < W * H * 0.01) continue;
      const owner = units.findIndex((u, i) => {
        const b = itemBoxes[i];
        const overlap = Math.min(p.box.x + p.box.w, b.x + b.w) - Math.max(p.box.x, b.x);
        const gap = p.box.y >= b.y + b.h ? p.box.y - (b.y + b.h) : b.y - (p.box.y + p.box.h);
        return overlap >= Math.min(p.box.w, b.w) * 0.6 && gap >= -H * 0.01 && gap < H * 0.12;
      });
      if (owner >= 0 && !units[owner].own.some(q => imageSlot.has(q))) { units[owner].own.push(p); used.add(p); imageSlot.add(p); }
    }
    const candidates = prims.filter(p => !used.has(p) && p.kind !== 'text' && !isEdgeArt(p) && !(p.kind === 'shape' && area(p.box) >= W * H * 0.9) && contains(zone, center(p.box)));
    // Own elements: anything touching or near one item (a card behind it, an icon or bar beside or above it,
    // a number marker and its connector) and not larger than the item. Elements spanning several items
    // (a timeline line, a backdrop) and pieces stacked on one box (clover petals) are shared.
    const gapX = W * 0.03, gapY = H * 0.045;
    for (const p of candidates) {
      if (p.kind === 'pic' && candidates.some(q => q !== p && q.kind === 'pic' && iou(q.box, p.box) > 0.7)) continue;
      const near = units.map((u, i) => ({ i, d: boxGap(p.box, itemBoxes[i]) }))
        .filter(({ i, d }) => d.x <= gapX && d.y <= gapY && p.box.w <= itemBoxes[i].w * 1.6 + W * 0.02 && p.box.h <= Math.max(itemBoxes[i].h * 1.6, H * 0.3))
        .sort((a, b) => (a.d.x + a.d.y) - (b.d.x + b.d.y));
      if (!near.length) continue;
      if (near.length > 1 && Math.abs((near[0].d.x + near[0].d.y) - (near[1].d.x + near[1].d.y)) < 1 && p.box.w > itemBoxes[near[0].i].w * 0.5) continue; // equally close to two items: shared
      units[near[0].i].own.push(p); used.add(p);
    }
    const core = candidates.filter(p => !used.has(p));
    const visual = core.length > 0 || units.some(u => u.own.length > 0) || numbered;
    if (!visual) continue;
    // A thin strip of short labels with swatches is a chart legend, not a component.
    const thin = union(itemBoxes).h < H * 0.07 && !units.some(u => u.body) && !numbered;
    if (thin) continue;
    // 6. Kind.
    const stacked = core.filter(p => p.kind === 'pic').some((p, i, arr) => arr.some((q, j) => j !== i && iou(p.box, q.box) > 0.7));
    const centers = units.map(u => center(u.title.box));
    const sameY = centers.every(c => Math.abs(c.y - centers[0].y) < H * 0.04);
    const sameX = centers.every(c => Math.abs(c.x - centers[0].x) < W * 0.04);
    const kind: TemplateComponent['kind'] = stacked || (core.some(p => p.kind === 'pic') && numbered && !sameX && !sameY) ? 'radial' : sameY ? 'row' : sameX ? 'column' : 'grid';
    const unitBoxesAbs = units.map((u, i) => union([itemBoxes[i], ...u.own.map(p => p.box)]));
    const all = [...unitBoxesAbs, ...core.map(p => p.box)];
    const box = union(all);
    const unitOf = new Map<Prim, number>();
    units.forEach((u, i) => u.own.forEach(p => unitOf.set(p, i)));
    const rel = (b: Box) => ({ x: (b.x - box.x) / box.w, y: (b.y - box.y) / box.h, w: b.w / box.w, h: b.h / box.h });
    const layers: RecognizedComponents['components'][number]['layers'] = [];
    for (const p of [...core, ...units.flatMap(u => u.own)].sort((a, b) => a.z - b.z)) {
      if (p.kind === 'pic') {
        if (p.svg || !p.target) continue;
        const ext = path.posix.extname(p.target).toLowerCase();
        if (!MIME[ext]) continue;
        if (!images.has(p.target)) {
          const data = await reader.readBinary(p.target);
          if (!data || data.length > 4 * 1024 * 1024) continue;
          const sz = imageSize(data, MIME[ext]);
          images.set(p.target, { key: p.target, data, mime: MIME[ext], ...(sz ? { width: sz.w, height: sz.h } : {}) });
        }
        layers.push({ type: 'image', key: p.target, ...rel(p.box), ...(unitOf.has(p) ? { unit: unitOf.get(p) } : {}), ...(imageSlot.has(p) ? { slot: true } : {}) });
      } else if (p.kind === 'line') layers.push({ type: 'line', ...rel(p.box), stroke: p.line!, strokeWidth: p.lineW || 1, ...(unitOf.has(p) ? { unit: unitOf.get(p) } : {}) });
      else layers.push({ type: 'shape', geom: p.geom === 'ellipse' ? 'ellipse' : p.geom === 'roundRect' ? 'roundRect' : 'rect', ...rel(p.box), ...(p.fill ? { fill: p.fill, fillAlpha: p.fillAlpha ?? 1 } : {}), ...(p.line ? { stroke: p.line, strokeWidth: p.lineW || 1 } : {}), ...(unitOf.has(p) ? { unit: unitOf.get(p) } : {}) });
    }
    // Quality: overlapping item titles mean a misread slide (drop it); overlapping or unequal units mean an
    // irregular composition (keep it, but only at its own count).
    const titleBoxes = units.map(u => u.title.box);
    if (titleBoxes.some((a, i) => titleBoxes.some((b, j) => j > i && iou(a, b) > 0.02))) continue;
    const ws = unitBoxesAbs.map(b => b.w), hs = unitBoxesAbs.map(b => b.h);
    const overlapping = unitBoxesAbs.some((a, i) => unitBoxesAbs.some((b, j) => j > i && iou(a, b) > 0.05));
    void ws; void hs;
    const fixed = overlapping;
    const slot = (role: TemplateComponentSlot['role'], unit: number, t: Prim): TemplateComponentSlot => ({
      role, unit, ...rel(t.box), size: t.size || 16, color: t.color || '', ...(t.face ? { face: t.face } : {}), bold: Boolean(t.bold), align: t.align || 'l', anchor: t.anchor || 't', sample: (t.text || '').slice(0, 80),
    });
    const slots: TemplateComponentSlot[] = units.flatMap((u, i) => [slot('title', i, u.title), ...(u.body ? [slot('body', i, u.body)] : []), ...(u.number ? [slot('number', i, u.number)] : [])]);
    components.push({
      id: `K${components.length + 1}`, slide: slide.index, kind, units: units.length, numbered, hasBody: units.every(u => u.body),
      box: { x: box.x / W, y: box.y / H, w: box.w / W, h: box.h / H }, aspect: box.w / box.h, slideWidthPt: W / 12700, layers, slots,
      unitBoxes: unitBoxesAbs.map(rel), imageSlots: units.filter(u => u.own.some(p => imageSlot.has(p))).length, ...(fixed ? { fixed: true } : {}),
    });
  }
  // Motifs: a shared picture spanning the items whose pixels repeat with a period that carries whole items.
  for (const comp of components) {
    const ub = comp.unitBoxes;
    if (comp.kind === 'radial' || ub.length < 2) continue;
    const centers = ub.map(b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }));
    const spanX = Math.max(...centers.map(c => c.x)) - Math.min(...centers.map(c => c.x));
    const spanY = Math.max(...centers.map(c => c.y)) - Math.min(...centers.map(c => c.y));
    // The strip runs along the axis every step advances on (the other axis may alternate, as labels above/below do).
    const steps = centers.slice(1).map((c, i) => ({ x: c.x - centers[i].x, y: c.y - centers[i].y }));
    const monotonic = (k: 'x' | 'y') => steps.every(d => d[k] > 0.01) || steps.every(d => d[k] < -0.01);
    const axis: 'x' | 'y' = monotonic('x') && !monotonic('y') ? 'x' : monotonic('y') && !monotonic('x') ? 'y' : spanX >= spanY ? 'x' : 'y';
    const index = comp.layers.findIndex(l => l.type === 'image' && l.unit === undefined && (axis === 'x' ? l.w : l.h) >= (axis === 'x' ? spanX : spanY) * 0.5);
    if (index < 0) continue;
    const layer = comp.layers[index] as { key?: string; w: number; h: number };
    const data = layer.key ? images.get(layer.key)?.data : undefined;
    if (!data) continue;
    const share = await motifPeriod(data, axis);
    const bounds = share ? await contentBounds(data, axis) : null;
    if (!share || !bounds) continue;
    const period = share * (axis === 'x' ? layer.w : layer.h);
    const along = centers.map(c => (axis === 'x' ? c.x : c.y)).sort((a, b) => a - b);
    const pitch = (along[along.length - 1] - along[0]) / (along.length - 1);
    const perPeriod = Math.round(period / pitch);
    if (perPeriod >= 1 && Math.abs(period - perPeriod * pitch) < pitch * 0.3) comp.motif = { layer: index, axis, period, perPeriod, start: bounds[0], end: bounds[1] };
  }
  return { components, images: [...images.values()] };
}

/**
 * The repeat period of a picture along an axis, as a share of its length:
 * column (or row) signatures of colour and opacity, compared with the picture
 * shifted by each lag; the lag with the smallest difference wins if it is
 * clearly smaller than the picture's own variation. Null when nothing repeats.
 */
/** Where the picture's opaque content starts and ends along the axis (fractions). */
async function contentBounds(data: Buffer, axis: 'x' | 'y'): Promise<[number, number] | null> {
  try {
    const canvasMod = await import('@napi-rs/canvas');
    const img = await canvasMod.loadImage(data);
    const L = 960, B = 48;
    const cw = axis === 'x' ? L : B, ch = axis === 'x' ? B : L;
    const canvas = canvasMod.createCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, cw, ch).data;
    const ink = (i: number) => { for (let j = 0; j < B; j++) { const o = (axis === 'x' ? j * cw + i : i * cw + j) * 4; if (px[o + 3] > 40 && (px[o] < 245 || px[o + 1] < 245 || px[o + 2] < 245)) return true; } return false; };
    let a = 0, b = L - 1;
    while (a < b && !ink(a)) a++;
    while (b > a && !ink(b)) b--;
    return b > a ? [a / L, (b + 1) / L] : null;
  } catch { return null; }
}

async function motifPeriod(data: Buffer, axis: 'x' | 'y'): Promise<number | null> {
  try {
    const canvasMod = await import('@napi-rs/canvas');
    const img = await canvasMod.loadImage(data);
    const B = 32; // bins across the axis
    const signatures = (L: number) => {
      const cw = axis === 'x' ? L : B, ch = axis === 'x' ? B : L;
      const canvas = canvasMod.createCanvas(cw, ch);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      const px = ctx.getImageData(0, 0, cw, ch).data;
      const sig: number[][] = [];
      for (let i = 0; i < L; i++) {
        const v: number[] = [];
        for (let j = 0; j < B; j++) {
          const o = (axis === 'x' ? j * cw + i : i * cw + j) * 4;
          const a = px[o + 3] / 255;
          v.push((px[o] * a) / 255, (px[o + 1] * a) / 255, (px[o + 2] * a) / 255, a);
        }
        sig.push(v);
      }
      return sig;
    };
    const errorAt = (sig: number[][], lag: number) => {
      let e = 0;
      for (let i = 0; i + lag < sig.length; i++) for (let k = 0; k < sig[i].length; k++) e += (sig[i][k] - sig[i + lag][k]) ** 2;
      return e / (sig.length - lag);
    };
    // Coarse search over lags 12–70% of the length.
    const L = 240;
    const sig = signatures(L);
    const errs: { lag: number; err: number }[] = [];
    for (let lag = Math.round(L * 0.12); lag <= Math.round(L * 0.7); lag++) errs.push({ lag, err: errorAt(sig, lag) });
    const mean = errs.reduce((a, b) => a + b.err, 0) / errs.length;
    const best = errs.reduce((a, b) => (b.err < a.err ? b : a));
    // The ends of a strip never repeat (no neighbour beyond the first and last item), so the test is relative.
    if (!(best.err < mean * 0.6)) return null;
    // Refine at 4× resolution around the coarse lag, so seams line up within a few pixels.
    const fine = signatures(L * 4);
    let refined = { lag: best.lag * 4, err: Infinity };
    for (let lag = best.lag * 4 - 6; lag <= best.lag * 4 + 6; lag++) { const e = errorAt(fine, lag); if (e < refined.err) refined = { lag, err: e }; }
    return refined.lag / (L * 4);
  } catch { return null; }
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Horizontal and vertical gaps between two boxes (0 when they overlap on that axis). */
const boxGap = (a: Box, b: Box) => ({
  x: Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)),
  y: Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)),
});

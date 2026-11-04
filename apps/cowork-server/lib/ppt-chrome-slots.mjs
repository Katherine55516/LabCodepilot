/** Chrome slots of an uploaded template and the no-repeat rule (Fable + user,
 * 2026-11-02; plan docs/exec-plans/active/ppt-template-media-slots-20261102.md,
 * phases 4–5; replaces the 2026-10-31 "photos only on frame pages" rule).
 *
 * A chrome slot is a picture within 3% of a slide edge that spans at least 25%
 * of the slide's width or height: a band, a half-bleed panel, the cover hero.
 * It keeps its painting on every page type and is never left empty.
 * A painting appears on one page; it may show again only five or more pages
 * after its last use, at most paintingUseLimit times (2, or 3 in long decks). Otherwise its slot shows a flat panel
 * in the template's dark colour, so the frame keeps its shape without
 * repeating a picture. The decision uses the plan (each page's frame), so it
 * does not depend on the order in which pages finish. */
import zlib from 'node:zlib';
import { templateMediaRole } from './ppt-template-fidelity.mjs';
import { pictureCertificate } from './ppt-template-picture-read.mjs';
import { stableId } from './ppt/ir.mjs';
import { coverCrop } from './ppt-content-slot-pictures.mjs';

// Within 3% of a slide edge (the user's review, 2026-11-02: at 1% a side
// decoration set 2% in was no chrome slot, so a small layout difference
// changed the result).
const EDGE = .03, SPAN = .25, MIN_GAP = 5, NEAR = .08;
/** How often one painting may show (Fable 2026-11-02, Codex's Portfolio
 * decks: two paintings for 35 content pages): ceil(content pages / (5 ×
 * paintings of its size class)), at least 2, at most 3; the closing counts. */
export function paintingUseLimit(project, node, pool = contentPool(project)) {
  const pages = Math.max(1, (project.outline?.length || project.pages || 1) - 1), peers = Math.max(1, pool.filter(item => sameSlotSize(item.geometry, node.geometry)).length);
  return Math.min(3, Math.max(2, Math.ceil(pages / (5 * peers))));
}
/** Whether a template picture sits in a chrome slot (edge-touching, ≥25% span). */
export function chromeSlot(node, size) {
  const g = node?.geometry, W = Number(size?.width) || 12192000, H = Number(size?.height) || 6858000;
  if (!g) return false;
  const touches = g.x <= W * EDGE || g.y <= H * EDGE || g.x + g.width >= W * (1 - EDGE) || g.y + g.height >= H * (1 - EDGE);
  // A tall side column or a wide band set further in is still the frame (a
  // sidebar picture 0.4 in from the edge: the narrow-sidebar test template).
  const column = g.height >= H * .75 && (g.x <= W * NEAR || g.x + g.width >= W * (1 - NEAR));
  const band = g.width >= W * .75 && (g.y <= H * NEAR || g.y + g.height >= H * (1 - NEAR));
  return touches && (g.width >= W * SPAN || g.height >= H * SPAN) || column || band;
}
/** The chrome paintings a frame page shows: kept decoration in chrome slots. */
function framePaintings(project, frameIndex) {
  const spec = project.templateFidelity?.sourceCatalog?.[frameIndex] || null;
  return spec ? chromeOf(project, spec) : [];
}
const chromeMemo = new WeakMap();
function chromeOf(project, spec) {
  if (chromeMemo.has(spec)) return chromeMemo.get(spec);
  const paintings = chromePaintings(project, spec);
  chromeMemo.set(spec, paintings);
  return paintings;
}
function chromePaintings(project, spec) {
  const size = project.templateFidelity;
  // Repeats are decided on the certificate, never the role alone: some
  // uncertified pictures (monochrome panels) are decoration too (Fable).
  return (spec.nodes || []).filter(node => node.type === 'image' && node.content?.imageSha256 && chromeSlot(node, size)
    && pictureCertificate(node.content) && templateMediaRole(node, spec, size) === 'template_decoration');
}
/** For page `index`, the chrome paintings whose use breaks the rule. The rule
 * is played over the plan in page order (a page that shows a painting is a use;
 * a page that falls back to a panel is not), so every page reaches the same
 * decision whichever order the pages are bound in. */
/** Two chrome slots of one size class: same orientation, each side within 25%. */
export const sameSlotSize = (a, b) => ['width', 'height'].every(side => Math.abs(a[side] - b[side]) <= Math.max(a[side], b[side]) * .25);
/** The paintings content pages may show (Fable 2026-11-02): every certified
 * chrome painting of the template but those on the cover's and the closing's
 * frames, which those pages reserve. */
export function contentPool(project) {
  const catalog = project.templateFidelity?.sourceCatalog || [], map = project.templateFidelity?.slideMap || [];
  const reserved = new Set([map[0], ...(project.outline?.at(-1)?.role === 'closing' ? [map.at(-1)] : [])].filter(Number.isInteger));
  return catalog.flatMap((spec, k) => reserved.has(k) ? [] : chromeOf(project, spec).map(node => ({ hash: node.content.imageSha256, geometry: node.geometry, node })));
}
/** Page by page, what each chrome slot shows: its own painting, else an
 * unused painting of the template of its size class (the user, 2026-11-03:
 * template media that could apply were replaced by flat panels while other
 * paintings of the template never showed), else a flat panel (null). */
export function chromePlan(project, index) {
  const slides = project.templateFidelity?.slides || [];
  if (!slides[index]) return [];
  const uses = new Map(), pool = contentPool(project);
  const recordUse = (hash, j) => uses.set(hash, [...(uses.get(hash) || []), j]);
  const allowed = (item, j) => { const prior = uses.get(item.hash) || []; return prior.length < paintingUseLimit(project, item.node, pool) && (!prior.length || j - prior.at(-1) >= MIN_GAP); };
  // A second use waits until every painting of its size class in the pool has shown once.
  const poolLeft = node => pool.some(item => item.hash !== node.content.imageSha256 && !uses.has(item.hash) && sameSlotSize(item.geometry, node.geometry));
  let plan = [];
  for (let j = 0; j <= index; j++) {
    const spec = slides[j] || null, shown = [];
    const paintings = spec ? chromeOf(project, spec) : framePaintings(project, project.templateFidelity?.slideMap?.[j]);
    for (const node of paintings) {
      const hash = node.content.imageSha256, prior = uses.get(hash) || [];
      const repeat = prior.length >= paintingUseLimit(project, node, pool) || prior.length && (j - prior.at(-1) < MIN_GAP || poolLeft(node));
      if (!repeat) { recordUse(hash, j); shown.push({ node, show: node }); continue; }
      // An unused painting first, then the longest unseen; never one this page already shows.
      const candidates = pool.filter(item => item.hash !== hash && sameSlotSize(item.geometry, node.geometry) && allowed(item, j) && !shown.some(entry => entry.show?.content?.imageSha256 === item.hash));
      const pick = candidates.sort((a, b) => (uses.get(a.hash)?.length || 0) - (uses.get(b.hash)?.length || 0) || (uses.get(a.hash)?.at(-1) ?? -1) - (uses.get(b.hash)?.at(-1) ?? -1))[0];
      // None left: a painting repeats, two or more pages after its last use where
      // one can, never a flat panel (the user, 2026-11-03: Deal-Review p5/p18).
      const again = pick || pool.filter(item => sameSlotSize(item.geometry, node.geometry) && !shown.some(entry => entry.show?.content?.imageSha256 === item.hash) && j - ((uses.get(item.hash) || []).at(-1) ?? -Infinity) >= 2)
        .sort((a, b) => (uses.get(a.hash)?.length || 0) - (uses.get(b.hash)?.length || 0) || (uses.get(a.hash)?.at(-1) ?? -1) - (uses.get(b.hash)?.at(-1) ?? -1))[0];
      const show = again ? again.node : node;
      recordUse(show.content.imageSha256, j); shown.push({ node, show });
    }
    if (j === index) plan = shown;
  }
  return plan;
}
/** For page `index`, the chrome paintings that show a flat panel (no painting of the template can take their slot). */
export function repeatedChrome(project, index) {
  return chromePlan(project, index).filter(entry => !entry.show).map(entry => entry.node);
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buffer => { let c = -1; for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii'); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0); return Buffer.concat([head, data, tail]); };
/** A flat PNG in one colour with the slot's aspect (so "contain" fills it exactly). */
export function solidPng(color, width, height) {
  const hex = /^#[0-9a-f]{6}$/iu.test(color) ? color : '#333333', [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  const w = Math.max(1, Math.min(256, width)), h = Math.max(1, Math.min(256, height)), raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const at = y * (w * 3 + 1) + 1 + x * 3; raw[at] = r; raw[at + 1] = g; raw[at + 2] = b; } }
  const header = Buffer.alloc(13); header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const luminance = hex => { const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255); return .2126 * r + .7152 * g + .0722 * b; };
/** The panel colour: the template's own most-used dark fill (its dark cards
 * and shapes, Fable), so a half-bleed panel reads as the template's colour,
 * not as near-black text colour; else the darkest palette colour. */
export function chromeColour(project) {
  const fills = new Map(), hex = value => /^#[0-9a-f]{6}$/iu.test(String(value || '')) ? String(value).toLowerCase() : null;
  for (const spec of [...(project.templateFidelity?.sourceCatalog || []), ...(project.templateFidelity?.slides || [])])
    for (const node of spec?.nodes || []) {
      const fill = hex(node.style?.fill || node.style?.backgroundColor);
      if (node.type !== 'shape' || !fill || luminance(fill) > .35) continue;
      const g = node.geometry || {};
      fills.set(fill, (fills.get(fill) || 0) + (Number(g.width) || 0) * (Number(g.height) || 0));
    }
  const shared = [...fills].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (shared) return shared;
  const palette = project.templateSpec?.palette || {};
  const options = [palette.accent, palette.foreground, palette.muted].map(hex).filter(Boolean);
  return options.sort((a, b) => luminance(a) - luminance(b))[0] || '#2f3026';
}
/** Replace each repeated chrome painting on a bound page with a flat panel in
 * the template's dark colour (one ledger record per picture). */
export function applyChromeFallback(project, slide, index) {
  if (project.templateFidelity?.mode !== 'preserve') return [];
  const replaced = [];
  // A repeated painting gives its slot to another painting of the template: the
  // slot's own picture shape keeps its mask and frame, only its image changes
  // (an added picture would lose the mask: 3197 7d153b8a, native image mask changed).
  for (const { node, show } of chromePlan(project, index).filter(entry => entry.show && entry.show !== entry.node)) {
    const id = node.nativeRef?.shapeId, live = (slide.nodes || []).find(item => item.type === 'image' && String(item.nativeRef?.shapeId) === String(id));
    if (id === undefined || !live || !show.content?.dataUrl || !show.content?.imageSha256) continue;
    const g = live.geometry || node.geometry, aspect = g.width / Math.max(1, g.height), picture = (Number(show.content.width) || show.geometry.width) / Math.max(1, Number(show.content.height) || show.geometry.height);
    live.content = { ...live.content, dataUrl: show.content.dataUrl, imageSha256: show.content.imageSha256, ...(show.content.width ? { width: show.content.width, height: show.content.height } : {}),
      mediaReplacement: true, borrowedPicture: true, fit: 'cover', crop: coverCrop(aspect, picture), decorative: true, derivedFrom: 'chrome-rotated', replacesImageSha256: node.content?.imageSha256 };
    slide.chromeRotations = [...(slide.chromeRotations || []).filter(item => String(item.shapeId) !== String(id)), { shapeId: id, from: node.content?.imageSha256, to: show.content.imageSha256 }];
    replaced.push(id);
  }
  for (const node of repeatedChrome(project, index)) {
    const id = node.nativeRef?.shapeId;
    if (id === undefined || (slide.templateOmissions || []).some(item => String(item.shapeId) === String(id))) continue;
    const g = node.geometry, aspect = g.width / Math.max(1, g.height), w = aspect >= 1 ? 256 : Math.round(256 * aspect), h = aspect >= 1 ? Math.round(256 / aspect) : 256;
    slide.templateOmissions ||= [];
    slide.templateOmissions.push({ shapeId: id, reason: 'This template picture is shown on a nearby page; a flat panel in the template colour keeps the frame without repeating it.', automatic: true, approvalBasis: 'template_picture_repeat' });
    slide.nodes = (slide.nodes || []).filter(item => String(item.nativeRef?.shapeId) !== String(id));
    slide.nodes.push({ id: stableId('node', slide.id, 'chrome-fallback', id), type: 'image', semanticRole: 'visual', slotId: 'absolute', geometry: { ...g },
      content: { dataUrl: solidPng(chromeColour(project), w, h), width: w, height: h, fit: 'contain', decorative: true, derivedFrom: 'chrome-fallback', replacesShapeId: id }, zIndex: Number(node.zIndex) || 0 });
    replaced.push(id);
  }
  return replaced;
}

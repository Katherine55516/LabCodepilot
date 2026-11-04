/** Template pictures in content slots on text-only cards (Fable G2, 2026-11-02;
 * the hand-made world_models × Mood-Board deck, its page 14 borrowing an unused
 * painting; Copy-of-Professional-Portfolio decks used 2 to 6 of 24 pictures).
 *
 * In page order, a text-only content card (no figure, table, tile row, chart,
 * diagram or equation card; marker cards and rail steps are text-only) shows
 * each certified picture of its frame's content slots: the slot's own picture
 * when it is unused anywhere in the deck so far (chrome included, by image
 * hash), else an unused certified content-slot picture of the same aspect
 * class (within 25%), cropped to cover; a narrow strip only as its own slot's
 * original. Content slots never repeat; with nothing left the slot is retired
 * and its region goes to the card. Pictures of the cover's and the closing's
 * frames are reserved. Any other content card retires these pictures. */
import { keyNumber } from './ppt-key-number.mjs';
import { pictureCertificate } from './ppt-template-picture-read.mjs';
import { chromeSlot, chromePlan } from './ppt-chrome-slots.mjs';

export const SLOT_PICTURE_AREA = .02;
const ASPECT_TOLERANCE = .25, STRIP = 2.5;
const aspect = g => g.width / Math.max(1, g.height);
const hashOf = node => node.content?.imageSha256 || null;

/** A content card without objects, figures, tables or number tiles. */
export function textOnlyCard(project, index) {
  const page = project.outline?.[index];
  if (!page || index < 1 || page.cardFrame || page.role === 'closing' || page.figurePage) return false;
  if ((page.cardObjects || []).length || (page.sourceImageIds || []).length || page.cardFigureLayout) return false;
  const points = page.keyPoints || [];
  if (!points.length) return false;
  const numbers = points.filter(point => keyNumber(point.text));
  // Number tiles (a KPI page or a row of table tiles) are data, not text.
  if (points.length >= 2 && numbers.length === points.length) return false;
  if (points.filter(point => point.rowLabel && keyNumber(point.text)).length >= 2) return false;
  return true;
}

/** The certified pictures in a frame's content slots. */
export function slotPictures(spec, size) {
  const area = (size?.width || 12192000) * (size?.height || 6858000);
  return (spec?.nodes || []).filter(node => node.type === 'image' && node.geometry && node.nativeRef?.shapeId !== undefined && !node.content?.mustPreserve
    && hashOf(node) && !chromeSlot(node, size) && pictureCertificate(node.content) && node.geometry.width * node.geometry.height >= area * SLOT_PICTURE_AREA);
}

const plans = new WeakMap();
/** The slot pictures of every page: Map(page index → Map(shapeId → {own, picture} | null)). */
export function contentSlotPlan(project) {
  const fidelity = project.templateFidelity, slides = fidelity?.slides || [];
  if (fidelity?.mode !== 'preserve' || !slides.length) return new Map();
  const key = `${(fidelity.slideMap || []).join(',')}|${(project.outline || []).map(page => `${page?.id}:${textOnlyCard(project, project.outline.indexOf(page)) ? 1 : 0}`).join(',')}`;
  const memo = plans.get(fidelity);
  if (memo?.key === key) return memo.plan;
  const size = fidelity, catalog = fidelity.sourceCatalog || slides;
  // The pool: every certified content-slot picture of the template, once by hash.
  const pool = [...new Map(catalog.flatMap(spec => slotPictures(spec, size)).map(node => [hashOf(node), node])).values()];
  const last = slides.length - 1, closing = project.outline?.[last]?.role === 'closing';
  const reserved = new Set([0, ...(closing ? [last] : [])].flatMap(index => (slides[index]?.nodes || []).filter(node => node.type === 'image').map(hashOf)).filter(Boolean));
  const used = new Set(), plan = new Map();
  slides.forEach((spec, index) => {
    // Chrome pictures a page shows count as used (no picture twice in a deck).
    for (const node of (spec.nodes || []).filter(node => node.type === 'image' && chromeSlot(node, size))) if (hashOf(node)) used.add(hashOf(node));
    // A painting rotated into a chrome slot here is used too (chromePlan, 2026-11-03).
    for (const entry of chromePlan(project, index)) { const hash = entry.show && entry.show !== entry.node ? entry.show.content?.imageSha256 : null; if (hash) used.add(hash); }
    const pictures = slotPictures(spec, size);
    if (!pictures.length || index === 0 || (closing && index === last)) return;
    const page = new Map();
    for (const node of pictures) {
      if (!textOnlyCard(project, index)) { page.set(String(node.nativeRef.shapeId), null); continue; }
      const own = hashOf(node), strip = Math.max(aspect(node.geometry), 1 / aspect(node.geometry)) >= STRIP;
      if (!used.has(own) && !reserved.has(own)) { used.add(own); page.set(String(node.nativeRef.shapeId), { own: true, picture: node }); continue; }
      const want = aspect(node.geometry);
      const borrowed = strip ? null : pool.filter(other => !used.has(hashOf(other)) && !reserved.has(hashOf(other)) && Math.abs(aspect(other.geometry) / want - 1) <= ASPECT_TOLERANCE)
        .sort((a, b) => Math.abs(aspect(a.geometry) / want - 1) - Math.abs(aspect(b.geometry) / want - 1))[0];
      if (borrowed) used.add(hashOf(borrowed));
      page.set(String(node.nativeRef.shapeId), borrowed ? { own: false, picture: borrowed } : null);
    }
    plan.set(index, page);
  });
  plans.set(fidelity, { key, plan });
  return plan;
}

/** The plan's entry for one slot picture: undefined when the plan does not govern it. */
export function slotPictureEntry(project, index, node) {
  const page = contentSlotPlan(project).get(index);
  return page && page.has(String(node.nativeRef?.shapeId)) ? page.get(String(node.nativeRef.shapeId)) : undefined;
}

/** The cover crop that fills a slot of aspect `slot` with a picture of aspect `picture`. */
export function coverCrop(slot, picture) {
  if (!(slot > 0 && picture > 0) || Math.abs(picture / slot - 1) < .005) return [0, 0, 0, 0];
  if (picture > slot) { const cut = (1 - slot / picture) / 2; return [cut, 0, cut, 0]; }
  const cut = (1 - picture / slot) / 2; return [0, cut, 0, cut];
}

/** Show a borrowed picture in place of the slot's own on a bound page. */
export function applyContentSlotPictures(project, slide, index) {
  if (project.templateFidelity?.mode !== 'preserve' || !slide) return 0;
  let changed = 0;
  for (const node of slide.nodes || []) {
    if (node.type !== 'image' || node.nativeRef?.shapeId === undefined) continue;
    const entry = slotPictureEntry(project, index, node);
    if (!entry || entry.own) continue;
    const source = entry.picture;
    if (!source.content?.dataUrl || node.content?.imageSha256 === source.content.imageSha256) continue;
    node.content = { ...node.content, dataUrl: source.content.dataUrl, imageSha256: source.content.imageSha256, mediaReplacement: true,
      borrowedPicture: { sourceShapeId: source.nativeRef?.shapeId, sourceSlideIndex: source.nativeRef?.sourceSlideIndex ?? null },
      crop: coverCrop(aspect(node.geometry), aspect(source.geometry)) };
    changed++;
  }
  return changed;
}

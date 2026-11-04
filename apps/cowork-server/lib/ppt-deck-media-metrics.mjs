/** Deck-level media metrics for uploaded templates (Fable + user, 2026-11-02;
 * plan docs/exec-plans/active/ppt-template-media-slots-20261102.md, phase 1).
 * What every content page shows, which template pictures repeat, and how often
 * each template frame is used. Warnings only: they never block publishing. */
import { visibleNodes } from './ppt-visible-content.mjs';
import { chromeSlot, contentPool, sameSlotSize } from './ppt-chrome-slots.mjs';
import { FIGURE_TEXT_FLOOR_PT } from './ppt-card-figure-layout.mjs';

const FRAME_ROLES = new Set(['cover', 'closing', 'divider', 'toc', 'takeaway']);
/** A page that frames the deck (cover, contents, dividers, closing), not content. */
export function framePage(project, slide, index) {
  const page = project.outline?.[index] || {};
  return index === 0 || Boolean(page.cardFrame) || FRAME_ROLES.has(page.role) || FRAME_ROLES.has(slide?.cardPage?.mode);
}
/** The template page a deck page is built on (theme pages name it; native pages are it). */
export function templateFrame(project, slide, index) {
  // A layout-only page reuses no frame (Fable G5): frame "layout", uncapped.
  if (project.templateFidelity?.slides?.[index]?.layoutOnly) return 'layout';
  const value = slide?.cardPage?.templatePage ?? slide?.nativeSlideIndex ?? project.templateSlideMap?.[index];
  return Number.isInteger(value) ? value : null;
}
// A layout's page picture (Fable G1) is the page itself, not a visual of it:
// it is counted apart and never as coverage, a repeat or a chrome painting.
const visible = slide => visibleNodes(slide).filter(node => !node.hidden && Number(node.style?.opacity ?? 1) > 0 && node.content?.derivedFrom !== 'layout-picture');
/** A page's visual elements: content visuals (a source figure, a chart, a
 * diagram or process, an icon set) and chrome (a template picture). A table is
 * content, not a visual. */
export function pageVisuals(slide) {
  const content = [], chrome = [];
  for (const node of visible(slide)) {
    const c = node.content || {};
    if (node.type === 'chart' || c.diagram || c.processCards || (node.type === 'list' && c.pointLayout?.variant === 'flow')) content.push(node.id);
    else if (node.type === 'image' && (c.sourceImageId || node.sourceArtifact)) content.push(node.id);
    else if (node.type === 'image' && c.derivedFrom === 'card-icon') content.push(node.id);
    else if (node.type === 'image') chrome.push(node.id);
  }
  return { content, chrome };
}
/** Template pictures by image hash: the pages each appears on. */
function templatePictures(slides) {
  const pages = new Map();
  slides.forEach((slide, index) => {
    for (const node of visible(slide)) {
      const c = node.content || {};
      if (node.type !== 'image' || c.sourceImageId || node.sourceArtifact || c.derivedFrom === 'card-icon' || !c.imageSha256) continue;
      if (!pages.has(c.imageSha256)) pages.set(c.imageSha256, new Set());
      pages.get(c.imageSha256).add(index + 1);
    }
  });
  return pages;
}
export const layoutReuseCap = pages => Math.max(2, Math.floor(pages / 5));
export function deckMediaMetrics(project, slides = project.deck?.slides || []) {
  if (project.templateFidelity?.mode !== 'preserve' || !slides.length) return null;
  const content = slides.map((slide, index) => ({ slide, index })).filter(({ slide, index }) => !framePage(project, slide, index));
  const visuals = content.map(({ slide, index }) => ({ page: index + 1, ...pageVisuals(slide) }));
  const withVisual = visuals.filter(page => page.content.length || page.chrome.length);
  const withContentVisual = visuals.filter(page => page.content.length);
  // Each repeat names the same-size content pool it was allowed from (Fable 2026-11-02).
  const pool = contentPool(project), geometryOf = hash => slides.flatMap(slide => visible(slide)).find(node => node.content?.imageSha256 === hash)?.geometry;
  const repeats = [...templatePictures(slides)].filter(([, pages]) => pages.size > 1).map(([hash, pages]) => { const g = geometryOf(hash);
    return { hash: hash.slice(0, 16), pages: [...pages].sort((a, b) => a - b), ...(g ? { pool: [...new Set(pool.filter(item => sameSlotSize(item.geometry, g)).map(item => item.hash.slice(0, 16)))] } : {}) }; });
  // Chrome slots shown as paintings vs flat panels (Fable: more than a third as
  // panels moves the vision reader ahead, since only L2 paintings may rotate).
  let chromePictures = 0, chromePanels = 0;
  for (const slide of slides) for (const node of visible(slide)) {
    if (node.type !== 'image') continue;
    if (node.content?.derivedFrom === 'chrome-fallback') chromePanels++;
    else if (!node.content?.sourceImageId && !node.sourceArtifact && node.content?.derivedFrom !== 'card-icon' && chromeSlot(node, project.templateFidelity)) chromePictures++;
  }
  const frames = {};
  slides.forEach((slide, index) => { const frame = templateFrame(project, slide, index); if (frame !== null) frames[frame] = (frames[frame] || 0) + 1; });
  const cap = layoutReuseCap(slides.length);
  const pagesOf = frame => slides.flatMap((slide, index) => templateFrame(project, slide, index) === frame ? [index + 1] : []);
  const overCap = Object.entries(frames).filter(([frame, uses]) => frame !== 'layout' && Number(frame) > 0 && uses > cap).map(([frame, uses]) => ({ frame: Number(frame), uses, pages: pagesOf(Number(frame)) }));
  const layoutOnly = pagesOf('layout');
  // Each shown diagram's text size at its placed width (the legibility floor,
  // Fable 2026-11-02): measured (glyphs or OCR) in points, else the unread
  // fallback as a scale of the printed size; beside points it is enforced, on
  // a figure page it is a warning only.
  const images = new Map((project.source?.images || []).map(image => [image.id, image])), figureText = [];
  slides.forEach((slide, index) => { for (const node of visible(slide)) {
    const image = node.type === 'image' && images.get(node.content?.sourceImageId), text = image?.figureText;
    if (!text || !node.geometry?.width) continue;
    const placedPt = node.geometry.width / 12700;
    // OCR that read nothing is no proof of no text (the user, 2026-11-03): uncertain, never passed.
    const uncertain = text.source === 'ocr_unread' || text.source === 'ocr_failed';
    figureText.push({ page: index + 1, figure: image.id, basis: uncertain ? 'uncertain' : text.source, ...(text.share > 0 ? { pt: Math.round(text.share * placedPt * 10) / 10 } : text.boxWidthPt > 0 ? { scale: Math.round(placedPt / text.boxWidthPt * 100) / 100 } : {}) });
  } });
  return { version: 1, contentPages: content.length, withVisual: withVisual.length, withContentVisual: withContentVisual.length,
    coverage: content.length ? Math.round(withVisual.length / content.length * 100) / 100 : null,
    contentCoverage: content.length ? Math.round(withContentVisual.length / content.length * 100) / 100 : null,
    pagesWithoutVisual: visuals.filter(page => !page.content.length && !page.chrome.length).map(page => page.page),
    repeats, frames, cap, overCap, layoutOnly, chromePictures, chromePanels, figureText,
    panelShare: chromePictures + chromePanels ? Math.round(chromePanels / (chromePictures + chromePanels) * 100) / 100 : null };
}
/** The ledger's warnings for these metrics (never blocking). */
export function deckMediaIssues(metrics) {
  if (!metrics) return [];
  const issues = [];
  if (metrics.contentPages && metrics.withVisual < metrics.contentPages) issues.push({ code: 'media_coverage_low', severity: 'warning', repairable: true, pages: metrics.pagesWithoutVisual,
    message: `${metrics.contentPages - metrics.withVisual} of ${metrics.contentPages} content pages carry no visual element (pages ${metrics.pagesWithoutVisual.slice(0, 12).join(', ')}).` });
  for (const repeat of metrics.repeats) issues.push({ code: 'template_picture_repeat', severity: 'warning', repairable: true, pages: repeat.pages,
    message: `One template picture appears on pages ${repeat.pages.join(', ')}${repeat.pool ? ` (its size class has ${repeat.pool.length} painting${repeat.pool.length === 1 ? '' : 's'} for content pages, all shown first)` : ''}.` });
  // Layout-only pages on over a third of the content pages: the template has
  // too few content frames for the deck length (Fable G5).
  if ((metrics.layoutOnly || []).length * 3 > metrics.contentPages) issues.push({ code: 'template_frames_too_few', severity: 'warning', repairable: false, pages: metrics.layoutOnly,
    message: `${metrics.layoutOnly.length} of ${metrics.contentPages} content pages use the template's plain layout (pages ${metrics.layoutOnly.slice(0, 12).join(', ')}): the template has too few content frames for a deck this long.` });
  if (metrics.overCap.length) issues.push({ code: 'layout_reuse_cap_exceeded', severity: 'warning', repairable: true, frames: metrics.overCap,
    message: `Template pages used more than ${metrics.cap} times (no frame under the cap fit these pages): ${metrics.overCap.map(item => `page ${item.frame + 1} ×${item.uses} on pages ${item.pages.join(', ')}`).join('; ')}.` });
  for (const item of metrics.figureText || []) if (item.pt !== undefined && item.pt < FIGURE_TEXT_FLOOR_PT || item.scale !== undefined && item.scale < 1.75)
    issues.push({ code: 'figure_text_small', severity: 'warning', repairable: false, pages: [item.page], figure: item.figure,
      message: item.pt !== undefined ? `The text in this figure shows at about ${item.pt} pt on page ${item.page} (under ${FIGURE_TEXT_FLOOR_PT} pt); crop it by hand or accept it.` : `This figure's text could not be measured and shows at ${item.scale}× its printed size on page ${item.page}.` });
  // Text OCR could not read (the user, 2026-11-03): shown at the conservative size or on its own page, checked by eye.
  for (const item of metrics.figureText || []) if (item.basis === 'uncertain')
    issues.push({ code: 'figure_text_unmeasured', severity: 'warning', repairable: false, pages: [item.page], figure: item.figure,
      message: `OCR could not read the text in the figure on page ${item.page}, so its legibility is not confirmed; it is shown at a conservative size. Check any small lettering.` });
  return issues;
}

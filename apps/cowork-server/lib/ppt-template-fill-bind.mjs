/** Writing a filled card into the template page's own shapes (fill-template-
 * first MVP; the user, 2026-11-03; Fable's design). The main flow assigns a
 * card to a template page (outline item `templateFill`, status 'filled',
 * sticky) and writes its blocks (`fillBlocks` [{heading, body}], optional
 * `fillLead`, `fillSummary`) within that page's profile. Here those texts go
 * into the page's own text slots, so the template's font, size, colour and
 * alignment stay; its kickers take the block's ordinal; the blocks, lead,
 * summary, second bodies and group headings the card does not use are left
 * out with their decorations; the card's figures replace the sample pictures
 * in the page's figure slots, and the slots left over are removed (on a
 * text-only page the slot rule G2 shows an unused template picture instead).
 *
 * The result has the shape of a native slot plan ({texts, leaveOut, fonts}),
 * so scheduling, capacity checks, the writer-free draft and the export treat
 * a filled page as the native page it is. A page whose texts no longer fit
 * its profile is no filled page: it returns null and the card takes today's
 * theme layout with all its content (fill_fallback). */
import { fillProfiles, blocksFit, nativeFont } from './ppt-template-fill-profile.mjs';
import { slotPictureEntry } from './ppt-content-slot-pictures.mjs';
import { fillUnits } from './ppt-template-fill-profile.mjs';
import { pairedCaption, legibleBeside } from './ppt-card-figure-layout.mjs';
import { contentCanvas } from './ppt-density-capacity.mjs';
import { figurePills } from './ppt-density-packing.mjs';
import { displayCaption } from './ppt-figure-captions.mjs';
import { stableId } from './ppt/ir.mjs';

const memo = new WeakMap();
/** The fill profile of template page `page` (cached per source catalog). */
export function profileFor(project, page) {
  const catalog = project.templateFidelity?.sourceCatalog;
  if (!catalog) return null;
  if (!memo.has(catalog)) memo.set(catalog, fillProfiles(project));
  return memo.get(catalog)[page] || null;
}

/** A page the main flow filled and fixed: later passes keep it on its template page. */
export const filledPage = page => page?.templateFill?.status === 'filled' && page.templateFill.sticky === true && Number.isInteger(page.templateFill.page)
  && !(Number(page.templateFill.citedFigures) > Number(page.templateFill.figures || 0));

const ordinal = k => String(k + 1).padStart(2, '0');

/** A lead's text over `n` columns: whole sentences, balanced; else split at the comma nearest the middle. */
export function leadParts(text, n) {
  if (n <= 1) return [text];
  const sentences = text.match(/[^。！？.!?]+[。！？.!?]?/gu)?.map(part => part.trim()).filter(Boolean) || [text];
  if (sentences.length >= n) { const size = Math.ceil(sentences.length / n); return Array.from({ length: n }, (_, k) => sentences.slice(k * size, (k + 1) * size).join(/\p{Script=Han}/u.test(text) ? '' : ' ')).filter(Boolean); }
  if (n === 2) {
    const commas = [...text.matchAll(/[，,；;]/gu)].map(match => match.index).filter(index => index > 0 && index < text.length - 1);
    if (commas.length) { const at = commas.sort((a, b) => Math.abs(a - text.length / 2) - Math.abs(b - text.length / 2))[0]; return [text.slice(0, at + 1).trim(), text.slice(at + 1).trim()]; }
  }
  return [text];
}

/** Whether the filled page sits on its own template page and its texts fit the profile; why not, else. */
export function fillCheck(project, index, page) {
  if (!filledPage(page)) return { ok: false, reason: 'not_filled' };
  const spec = project.templateFidelity?.slides?.[index];
  if (!spec || spec.sourceIndex !== page.templateFill.page) return { ok: false, reason: 'bind_frame' };
  const profile = profileFor(project, page.templateFill.page);
  if (!profile?.kind) return { ok: false, reason: 'bind_shape' };
  // Every figure the card cites is shown on its page, else the card is no
  // filled page: pairing keeps its figures with their points (Fable 2026-11-03,
  // live Mood: seven figures left on pages without their explanation).
  const cited = Number(page.templateFill.citedFigures ?? (page.sourceImageIds || []).length);
  if (cited > profile.figures) return { ok: false, reason: 'figures_exceed_slots', detail: { cited, slots: profile.figures } };
  const blocks = page.fillBlocks || [];
  if (!blocks.length || blocks.length < profile.blocks - (profile.stackMayHoldFewer ? 1 : 0)) return { ok: false, reason: 'bind_shape' };
  const fit = blocksFit(profile, blocks, { lead: page.fillLead || '', summary: page.fillSummary || '' });
  return fit.ok ? { ok: true, profile, spec } : { ok: false, reason: 'bind_fit', detail: fit };
}

/** The native slot plan of a filled page, or null (then the page is no filled page). */
export function fillNativeSlots(project, index, page = project.outline?.[index]) {
  const check = fillCheck(project, index, page);
  if (!check.ok) return null;
  const { profile, spec } = check, blocks = page.fillBlocks, texts = {}, leaveOut = [], fonts = {};
  const slotOf = shapeId => (spec.slots || []).find(slot => String(slot.shapeId) === String(shapeId));
  const write = (shapeId, text) => { texts[String(shapeId)] = text; const font = nativeFont(spec, slotOf(shapeId)); if (font) fonts[String(shapeId)] = font; };
  const out = shapeId => { if (shapeId !== undefined && shapeId !== null) leaveOut.push(String(shapeId)); };
  // A procedure on a cards page keeps its order in its headings (Fable: cards numbered 1…N).
  const procedure = page.templateFill.segment?.kind === 'procedure' && profile.kind === 'cards' && !profile.blockSlots.some(slot => slot.kicker);
  profile.blockSlots.forEach((slot, k) => {
    const block = blocks[k];
    if (!block) { out(slot.body.shapeId); out(slot.heading?.shapeId); out(slot.kicker?.shapeId); (slot.extraShapeIds || []).forEach(out); return; }
    write(slot.body.shapeId, String(block.body));
    if (slot.heading) block.heading ? write(slot.heading.shapeId, procedure ? `${k + 1}. ${block.heading}` : String(block.heading)) : out(slot.heading.shapeId);
    if (slot.kicker) write(slot.kicker.shapeId, ordinal(k));
    (slot.extraShapeIds || []).forEach(out);
  });
  if (profile.lead.present) {
    // A lead set over two columns is spread over them, never half a band left
    // empty beside its divider (Codex, live Capabilities t3): by sentences, else
    // at the comma nearest the middle; one unbreakable phrase takes the first column.
    const columns = [profile.lead.shapeId, ...(profile.lead.extraShapeIds || [])], parts = page.fillLead ? leadParts(String(page.fillLead), columns.length) : [];
    columns.forEach((shapeId, k) => parts[k] ? write(shapeId, parts[k]) : out(shapeId));
    out(profile.lead.headingShapeId);
  }
  if (profile.summary.present) page.fillSummary ? write(profile.summary.shapeId, String(page.fillSummary)) : out(profile.summary.shapeId);
  (profile.groupHeadingShapeIds || []).forEach(out);
  // Figure slots the card's figures do not take, unless the slot rule shows a
  // template picture there. Never on a comparison: two borrowed landscapes
  // read as the two sides compared (Codex B2, 3197 JEPA p7).
  const figures = (page.sourceImageIds || []).length, compare = profile.kind === 'compare';
  profile.figureSlots.slice(figures).forEach(slot => { const node = spec.nodes?.find(node => String(node.nativeRef?.shapeId) === String(slot.shapeId)); if (compare || !slotPictureEntry(project, index, node)?.picture) out(slot.shapeId); });
  // A comparison's header pills keep no sample icon, so no ordinal marker takes its place (Codex B2).
  if (compare) {
    const area = (project.templateFidelity?.width || 12192000) * (project.templateFidelity?.height || 6858000), slots = new Set(profile.figureSlots.map(slot => String(slot.shapeId)));
    for (const node of spec.nodes || []) if (node.type === 'image' && node.geometry && !slots.has(String(node.nativeRef?.shapeId)) && !node.content?.mustPreserve && node.geometry.width * node.geometry.height <= area * .015) out(node.nativeRef?.shapeId);
  }
  // Bodies, lead and summary take the sample's body style: no bold label run, no bullet (Codex B1).
  const plain = [...profile.blockSlots.map(slot => slot.body.shapeId), profile.lead.present && profile.lead.shapeId, profile.summary.present && profile.summary.shapeId].filter(id => id !== false && id !== undefined && String(id) in texts).map(String);
  return { texts, leaveOut: [...new Set(leaveOut)], fonts, plain, fill: { profileId: profile.profileId, kind: profile.kind, page: profile.page } };
}

/** The caption a figure shows (one place, so the deck-language caption can take over here). */
// In the deck's language: a short caption with its figure number, the full one in the notes (Fable 2026-11-02).
const shownCaption = (project, image) => displayCaption(project, image);
const figureNumber = caption => /^\s*((?:Figure|Fig\.?|图|圖)\s*\d+)/iu.exec(caption)?.[1] || '';
const rowOrder = (a, b) => Math.abs(a.geometry.y - b.geometry.y) > .6 * 914400 ? a.geometry.y - b.geometry.y : a.geometry.x - b.geometry.x;

/** A figure page on a template page with picture slots (Fable 2026-11-03,
 * Codex's media audit M2: Mood t3/t7 slots were retired while the figures were
 * drawn beside them). Every figure takes a slot, in citation order along the
 * slots' reading order, when each one stays legible there (the 7 pt floor;
 * unread OCR at the 40% proxy); the block under a slot takes the figure's
 * label as its heading and its shortened caption as its body (whole in the
 * notes), else the caption sits inside the slot. Unused slots and blocks go.
 * One figure failing keeps the whole page code-drawn. */
export function figureSlotPlan(project, index, page = project.outline?.[index]) {
  if (!page?.figurePage || project.templateFidelity?.mode !== 'preserve') return null;
  const spec = project.templateFidelity.slides?.[index];
  const profile = spec && profileFor(project, spec.sourceIndex), ids = page.sourceImageIds || [];
  if (!profile?.kind || !ids.length || !profile.figureSlots.length) return null;
  // Every slot holds a figure: one figure in a two-slot frame left half the page empty (replay of 3197 1d8eb0d2 p4).
  if (ids.length !== profile.figureSlots.length) return { ok: false, reason: 'slot_count', figures: ids.length, slots: profile.figureSlots.length };
  const images = ids.map(id => project.source?.images?.find(image => image.id === id));
  if (images.some(image => !image?.width || !image.height || !image.dataUrl)) return { ok: false, reason: 'figure_unreadable' };
  const slots = [...profile.figureSlots].sort(rowOrder), blocks = [...profile.blockSlots];
  const contentWidth = contentCanvas(project, index)?.geometry?.width || project.templateFidelity.width;
  const texts = {}, leaveOut = [], fonts = {}, plain = [], placements = [];
  const slotOf = shapeId => (spec.slots || []).find(slot => String(slot.shapeId) === String(shapeId));
  const write = (shapeId, text) => { texts[String(shapeId)] = text; const font = nativeFont(spec, slotOf(shapeId)); if (font) fonts[String(shapeId)] = font; };
  const out = shapeId => { if (shapeId !== undefined && shapeId !== null) leaveOut.push(String(shapeId)); };
  const labels = figurePills(project, page) || [];
  for (const [k, image] of images.entries()) {
    const slot = slots[k], block = blocks[k], caption = shownCaption(project, image), g = slot.geometry;
    const inSlot = !block, height = inSlot ? g.height - (2 * LINE + GAP) : g.height, contain = image.role === 'diagram' || image.continuousTone === false;
    const width = contain ? Math.min(g.width, Math.max(0, height) * image.width / image.height) : g.width;
    if (!(height > 0) || !legibleBeside(image, width, contentWidth)) return { ok: false, reason: 'legibility', figure: image.id, slot: slot.shapeId };
    const entry = { imageId: image.id, slotShapeId: slot.shapeId, inSlot, placedWidthIn: Math.round(width / 914400 * 100) / 100 };
    if (block) {
      const label = labels[k] || figureNumber(caption);
      if (block.heading) label && fillUnits(label) <= block.heading.cap ? write(block.heading.shapeId, label) : out(block.heading.shapeId);
      const shown = caption ? pairedCaption(caption, text => fillUnits(text) <= block.body.cap ? 1 : 3) : null;
      if (shown && fillUnits(shown.text) > block.body.cap) return { ok: false, reason: 'caption_cap', figure: image.id };
      if (shown) { write(block.body.shapeId, shown.text); plain.push(String(block.body.shapeId)); entry.captionShapeId = block.body.shapeId; entry.captionShortened = shown.shortened; }
      else out(block.body.shapeId);
      if (block.kicker) write(block.kicker.shapeId, String(k + 1).padStart(2, '0'));
      (block.extraShapeIds || []).forEach(out);
    }
    placements.push(entry);
  }
  blocks.slice(images.length).forEach(block => { out(block.body.shapeId); out(block.heading?.shapeId); out(block.kicker?.shapeId); (block.extraShapeIds || []).forEach(out); });
  slots.slice(images.length).forEach(slot => out(slot.shapeId));
  if (profile.lead.present) { out(profile.lead.shapeId); out(profile.lead.headingShapeId); (profile.lead.extraShapeIds || []).forEach(out); }
  if (profile.summary.present) out(profile.summary.shapeId);
  (profile.groupHeadingShapeIds || []).forEach(out);
  // A comparison frame's pill icons go, as on a filled comparison (no ordinal markers).
  if (profile.kind === 'compare') {
    const area = (project.templateFidelity.width || 12192000) * (project.templateFidelity.height || 6858000), used = new Set(profile.figureSlots.map(slot => String(slot.shapeId)));
    for (const node of spec.nodes || []) if (node.type === 'image' && node.geometry && !used.has(String(node.nativeRef?.shapeId)) && !node.content?.mustPreserve && node.geometry.width * node.geometry.height <= area * .015) out(node.nativeRef?.shapeId);
  }
  return { ok: true, texts, leaveOut: [...new Set(leaveOut)], fonts, plain, placements, frame: spec.sourceIndex + 1 };
}

/** The writer-free draft of a figure page that uses its frame's picture slots, or null. */
export function figureSlotDraft(project, index, page) {
  const plan = figureSlotPlan(project, index, page);
  if (!plan?.ok) return null;
  const slots = project.templateFidelity.slides[index]?.slots || [];
  const header = Object.fromEntries(slots.filter(slot => ['title', 'section'].includes(slot.role)).map(slot => [String(slot.shapeId), slot.role === 'title' ? page.title : page.section]));
  return { title: page.title, slotTexts: { ...header, ...plan.texts }, slotFonts: plan.fonts, slotPlain: plan.plain, contentBlocks: [], sourceArtifacts: [], sourceCommentary: [], sourceEvidenceIds: [],
    omitTemplateShapes: plan.leaveOut.map(shapeId => ({ shapeId, reason: 'A picture slot or text block the figure page does not use.' })), cardPage: { mode: 'native' }, figureSlots: { frame: plan.frame, placements: plan.placements } };
}

const CAPTION_PT = 12, LINE = CAPTION_PT * 1.25 * 12700, GAP = .06 * 914400;
/** One source figure into a template picture slot: a diagram whole (contain), a
 * photo or screenshot filling it (cover); its caption inside the slot unless a
 * block body of the page carries it. */
function placeFigure(slide, node, image, id, { captionInSlot, bodyNode, captionNode, caption }) {
  const slotBox = node.geometry;
  const perLine = Math.max(8, slotBox.width / 12700 / CAPTION_PT * 1.8 * .55);
  const inSlot = captionInSlot && caption ? pairedCaption(caption, text => Math.ceil(fillUnits(text) / perLine)) : null;
  const lines = inSlot ? Math.min(2, Math.max(1, Math.ceil(fillUnits(inSlot.text) / perLine))) : 0;
  const box = { ...slotBox, height: Math.max(1, slotBox.height - (lines ? Math.round(lines * LINE + GAP) : 0)) };
  const aspect = image.width / Math.max(1, image.height), slotAspect = box.width / Math.max(1, box.height);
  const contain = image.role === 'diagram' || image.continuousTone === false;
  let geometry = { ...box }, crop = [0, 0, 0, 0];
  if (contain) {
    const width = aspect >= slotAspect ? box.width : Math.round(box.height * aspect), height = aspect >= slotAspect ? Math.round(box.width / aspect) : box.height;
    geometry = { x: Math.round(box.x + (box.width - width) / 2), y: Math.round(box.y + (box.height - height) / 2), width, height };
  } else if (Math.abs(aspect / slotAspect - 1) > .005) {
    const cut = aspect > slotAspect ? (1 - slotAspect / aspect) / 2 : (1 - aspect / slotAspect) / 2;
    crop = aspect > slotAspect ? [cut, 0, cut, 0] : [0, cut, 0, cut];
  }
  node.geometry = geometry;
  node.content = { ...node.content, dataUrl: image.dataUrl, imageSha256: image.sha256 || image.imageSha256 || null, mediaReplacement: true, sourceImageId: id, fillFigure: true, fit: contain ? 'contain' : 'cover', crop, decorative: false, mediaRole: 'source_figure' };
  node.sourceArtifact = { sourceUnitId: id, type: 'SourceImage' };node.sourceRefs = image.sourceRefs || [];node.semanticRole = 'source-media';
  if (captionNode) {
    // The block body under the slot is the figure's caption (its whole text in the notes).
    captionNode.content = { ...captionNode.content, sourceImageCaptionId: id, ...(String(captionNode.content?.text || '').trim() !== caption ? { captionShortened: true } : {}) };
    captionNode.sourceArtifact = { sourceUnitId: id, type: 'SourceImageCaption' };
  } else if (inSlot) slide.nodes.push({ id: stableId('node', slide.id, 'fill-caption', id), type: 'text', semanticRole: 'source-explanation', slotId: 'absolute', zIndex: (node.zIndex || 0) + 1,
    geometry: { x: slotBox.x, y: Math.round(geometry.y + geometry.height + GAP), width: slotBox.width, height: Math.round(lines * LINE) },
    content: { text: inSlot.text, sourceImageCaptionId: id, ...(inSlot.shortened ? { captionShortened: true } : {}), sourceRefs: image.sourceRefs || [], fillCaption: true },
    sourceArtifact: { sourceUnitId: id, type: 'SourceImageCaption' },
    style: { ...(bodyNode?.style || {}), fontSizePt: CAPTION_PT, fontBasis: 'figure_caption', align: 'center' } });
}

/** A lead band its text fills less than this share of is dropped; the text becomes the page subtitle. */
export const LEAD_MIN_SHARE = .3;
/** A short lead in a wide band reads as an empty band (Fable 2026-11-03, Q6
 * (b); live Capabilities 04e04491 p2 one sentence alone in a wide band, p5 two
 * near-empty cells): the text moves under the title as the card lead
 * (bindCardLead) and the band goes, its slots and the shapes framing them.
 * Only once the subtitle is placed; else the band keeps the text. */
function leadToSubtitle(project, slide, index, page, find) {
  const check = fillCheck(project, index, page), lead = String(page.fillLead || '').trim();
  if (!check.ok || !lead || !check.profile.lead.present || !bindLead) return false;
  // A card lead of its own other than the band's text keeps the subtitle; the band then keeps its text.
  if (String(page.lead || '').trim() && String(page.lead).trim() !== lead) return false;
  const columns = [check.profile.lead.shapeId, ...(check.profile.lead.extraShapeIds || [])].map(String);
  if (fillUnits(lead) >= LEAD_MIN_SHARE * check.profile.lead.cap * columns.length) return false;
  // The band: the lead's text boxes and the shapes framing them that frame no other text of the page.
  const boxes = columns.map(id => check.spec.nodes?.find(node => String(node.nativeRef?.shapeId) === id)?.geometry).filter(Boolean);
  if (!boxes.length) return false;
  const inside = (g, b) => g.x <= b.x + 914 && g.y <= b.y + 914 && g.x + g.width >= b.x + b.width - 914 && g.y + g.height >= b.y + b.height - 914;
  const centre = g => ({ x: g.x + g.width / 2, y: g.y + g.height / 2 }), holds = (g, p) => p.x >= g.x && p.x <= g.x + g.width && p.y >= g.y && p.y <= g.y + g.height;
  const leadNodes = (slide.nodes || []).filter(node => columns.includes(String(node.nativeRef?.shapeId)));
  const others = (slide.nodes || []).filter(node => !leadNodes.includes(node) && node.type === 'text' && node.geometry && String(node.content?.text || '').trim() && !['card-lead', 'template-title', 'title', 'title-translation'].includes(node.semanticRole));
  const free = node => ['shape', 'foreign'].includes(node.type) && node.geometry && node.nativeRef?.shapeId !== undefined && !node.content?.mustPreserve && !others.some(text => holds(node.geometry, centre(text.geometry)));
  const frames = (slide.nodes || []).filter(node => free(node) && boxes.some(b => inside(node.geometry, b)));
  // Thin rules lying in the band (the divider between two columns) go with it.
  const area = [...boxes, ...frames.map(node => node.geometry)], x = Math.min(...area.map(g => g.x)), y = Math.min(...area.map(g => g.y));
  const extent = { x, y, width: Math.max(...area.map(g => g.x + g.width)) - x, height: Math.max(...area.map(g => g.y + g.height)) - y };
  const band = [...frames, ...(slide.nodes || []).filter(node => free(node) && !frames.includes(node) && Math.min(node.geometry.width, node.geometry.height) <= .05 * 914400 && holds(extent, centre(node.geometry)))];
  // Clear the band first: the subtitle sits where the band was and must not clash with it.
  const kept = slide.nodes, gone = [...leadNodes, ...band];
  slide.nodes = kept.filter(node => !gone.includes(node));
  const outline = [...(project.outline || [])];outline[index] = { ...page, lead };
  bindLead({ ...project, outline }, slide, index);
  if (!slide.nodes.some(node => node.semanticRole === 'card-lead' && String(node.content?.text || '').trim() === lead)) { slide.nodes = kept; return false; }
  slide.templateOmissions ||= [];
  for (const shapeId of [...columns, ...band.map(node => String(node.nativeRef.shapeId))])
    if (!slide.templateOmissions.some(item => String(item.shapeId) === shapeId))
      slide.templateOmissions.push({ shapeId: Number(shapeId), reason: 'A lead band its text left mostly empty; the text is the page subtitle.', automatic: true, approvalBasis: 'card_group_omitted' });
  slide.fillLeadAsSubtitle = true;
  shiftBelowBand(project, slide, check.spec, extent);
  return true;
}

/** Below this the freed band is not worth moving the blocks for (Fable 2026-11-03). */
const SHIFT_MIN = .4 * 914400;
/** The blocks below a dropped lead band move up as one group into the freed
 * space, keeping their own spacing (Fable 2026-11-03, Q6 (b): a hole between
 * subtitle and blocks reads as a removed band, as in the hand deck's slides 5
 * and 9; the same space at the foot reads as margin). The first block sits
 * where the band's top was, never closer to the subtitle than the template's
 * title-to-band gap. Footer and page number stay. Positions are taken from the
 * template's, so a rebind or relayout never shifts twice; a node the user moved
 * keeps its place. Recorded as band_dropped_shift (or the reason it was not). */
function shiftBelowBand(project, slide, spec, extent) {
  const height = Number(project.templateFidelity?.height) || 6858000, origin = id => spec.nodes?.find(node => String(node.nativeRef?.shapeId) === String(id))?.geometry;
  const main = slide.nodes.find(node => ['template-title', 'title'].includes(node.semanticRole) && node.type === 'text' && node.geometry);
  const subtitle = slide.nodes.find(node => node.semanticRole === 'card-lead'), titleBox = main && origin(main.nativeRef?.shapeId);
  const bottom = extent.y + extent.height, fixed = g => g.y >= height * .92;
  const group = slide.nodes.filter(node => node.nativeRef?.shapeId !== undefined && origin(node.nativeRef.shapeId) && !fixed(origin(node.nativeRef.shapeId)) && origin(node.nativeRef.shapeId).y >= bottom - 914
    && !['template-title', 'title', 'title-translation', 'card-lead'].includes(node.semanticRole));
  if (!group.length || !subtitle || !titleBox) { slide.fillBandShift = { code: 'band_dropped_shift', height: 0, skipped: 'no_group' }; return; }
  const top = Math.min(...group.map(node => origin(node.nativeRef.shapeId).y));
  const gap = Math.max(0, extent.y - (titleBox.y + titleBox.height)), target = Math.max(extent.y, subtitle.geometry.y + subtitle.geometry.height + gap);
  const shift = Math.round(top - target);
  if (shift < SHIFT_MIN) { slide.fillBandShift = { code: 'band_dropped_shift', height: 0, skipped: 'under_minimum', freed: Math.max(0, shift) }; return; }
  for (const node of group) {
    if (node.userGeometry) continue;
    const from = origin(node.nativeRef.shapeId);
    node.geometry = { ...node.geometry, y: from.y - shift };
    // The text fit keeps the frame's first geometry and refits from it.
    const fit = node.templateTitleFrameAdaptation;
    if (fit?.originalGeometry) node.templateTitleFrameAdaptation = { ...fit, originalGeometry: { ...fit.originalGeometry, y: from.y - shift } };
  }
  // Code-drawn nodes of the group (the numbered markers standing for sample
  // icons) have no template place; each records the shift it took.
  for (const node of slide.nodes) {
    if (node.nativeRef || !node.geometry || node.userGeometry || ['card-lead', 'eyebrow', 'page-number', 'title-translation'].includes(node.semanticRole)) continue;
    const taken = Number(node.fillBandShift) || 0, y = node.geometry.y + taken;
    if (y < bottom - 914 || fixed({ y })) continue;
    node.geometry = { ...node.geometry, y: y - shift };node.fillBandShift = shift;
  }
  slide.fillBandShift = { code: 'band_dropped_shift', height: shift };
}
/** The card lead binder, registered by ppt-title-hierarchy (no import cycle). */
let bindLead = null;
export const setLeadBinder = fn => { bindLead = fn; };

/** A one-sentence lead on a two-column band takes the whole band: its first
 * frame widens over the columns and the divider between them goes, never a
 * half band left empty (Codex 2026-11-03, live Capabilities 640e0f98 p3/p5). */
function mergeLeadColumns(project, slide, index, page, find) {
  const check = fillCheck(project, index, page);
  if (!check.ok || !page.fillLead || !(check.profile.lead.columns > 1)) return;
  const columns = [check.profile.lead.shapeId, ...(check.profile.lead.extraShapeIds || [])];
  if (leadParts(String(page.fillLead), columns.length).length >= columns.length) return;
  const boxes = columns.map(id => check.spec.nodes?.find(node => String(node.nativeRef?.shapeId) === String(id))?.geometry).filter(Boolean), first = find(columns[0]);
  if (!first?.geometry || boxes.length < 2) return;
  const right = Math.max(...boxes.map(box => box.x + box.width));
  first.geometry = { ...first.geometry, width: right - first.geometry.x };
  // Thin rules lying across the band between the columns go with the second column.
  const band = { x: Math.min(...boxes.map(box => box.x)), y: Math.min(...boxes.map(box => box.y)) - .3 * 914400, width: right - Math.min(...boxes.map(box => box.x)), height: Math.max(...boxes.map(box => box.height)) + .6 * 914400 };
  for (const node of [...(slide.nodes || [])]) {
    const g = node.geometry;
    if (node.type !== 'shape' || !g || Math.min(g.width, g.height) > .05 * 914400 || Math.max(g.width, g.height) > band.height * 1.2) continue;
    if (g.x < band.x || g.x + g.width > band.x + band.width || g.y < band.y || g.y + g.height > band.y + band.height) continue;
    slide.nodes = slide.nodes.filter(item => item !== node);
    slide.templateOmissions ||= [];
    if (!slide.templateOmissions.some(item => String(item.shapeId) === String(node.nativeRef?.shapeId))) slide.templateOmissions.push({ shapeId: Number(node.nativeRef?.shapeId), reason: 'The divider of a lead band whose text takes both columns.', automatic: true, approvalBasis: 'card_group_omitted' });
  }
}

/** The figures of a filled page, or of a figure page using its frame's picture
 * slots, in those slots. Returns the count placed. */
export function applyFillPictures(project, slide, index, page = project.outline?.[index]) {
  if (!slide || !page) return 0;
  const find = shapeId => (slide.nodes || []).find(node => String(node.nativeRef?.shapeId) === String(shapeId));
  if (!page.figurePage && !leadToSubtitle(project, slide, index, page, find)) mergeLeadColumns(project, slide, index, page, find);
  if (page.figurePage) {
    const plan = figureSlotPlan(project, index, page);
    if (!plan) return 0;
    if (!plan.ok) { slide.figureSlots = { used: false, reason: plan.reason, ...(plan.figure ? { figure: plan.figure } : {}) }; return 0; }
    let placed = 0;
    for (const entry of plan.placements) {
      const image = project.source.images.find(item => item.id === entry.imageId), node = find(entry.slotShapeId);
      if (!node?.geometry || node.type !== 'image') continue;
      placeFigure(slide, node, image, entry.imageId, { captionInSlot: entry.inSlot, captionNode: entry.captionShapeId !== undefined ? find(entry.captionShapeId) : null, caption: shownCaption(project, image), bodyNode: entry.captionShapeId !== undefined ? find(entry.captionShapeId) : null });
      placed++;
    }
    slide.figureSlots = { used: placed === plan.placements.length, frame: plan.frame, placements: plan.placements };
    return placed;
  }
  const plan = fillNativeSlots(project, index, page);
  if (!plan) return 0;
  const profile = profileFor(project, page.templateFill.page), ids = page.sourceImageIds || [];
  const bodyNode = find(profile.blockSlots[0]?.body.shapeId);
  let placed = 0;
  ids.slice(0, profile.figureSlots.length).forEach((id, k) => {
    const image = project.source?.images?.find(item => item.id === id), node = (slide.nodes || []).find(item => item.type === 'image' && String(item.nativeRef?.shapeId) === String(profile.figureSlots[k].shapeId));
    if (!image?.dataUrl || !node?.geometry) return;
    placeFigure(slide, node, image, id, { captionInSlot: true, bodyNode, caption: shownCaption(project, image) });
    placed++;
  });
  return placed;
}

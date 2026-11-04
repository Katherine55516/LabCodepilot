/** What a template content page can be filled with (fill-template-first MVP;
 * the user, 2026-11-03: fill the template's own pages first, for every
 * template; Fable's design). One profile per template page, read from the
 * page's own text slots and pictures, never from the template's name:
 *
 *   title-body   one body holder (a title with its text)
 *   text-figure  one body holder beside a content picture slot
 *   compare      two holders side by side, of about one width (left/right)
 *   steps        3–6 holders with a numbered marker each, or in one column/row joined by arrows
 *   cards        2–6 holders otherwise (a row or a grid)
 *
 * A holder is a block: an optional heading slot and a body slot, grouped as
 * the slot reader groups them (groupId / pairedWith). A wide body above every
 * other holder is the page's lead line, not a block. Caps are visual units
 * at the slot's native size (templateVisualUnits), measured on the native
 * frame as the native binding measures them (slotFit), so the writer, the
 * matcher and the binding agree. A page the reader cannot classify has
 * kind null and a reason; it is used only as a plain frame (today's path).
 * Cover and closing are never content profiles. Deferred (Fable/user): cycle
 * rings, arbitrary SmartArt and special assemblies, all kind null. */
import { slotsFor } from './ppt-template-fidelity.mjs';
import { chromeSlot } from './ppt-chrome-slots.mjs';
import { templateVisualUnits } from './ppt-presentation-writing.mjs';
import { _cardLayoutInternals as layouts } from './ppt-outline-cards.mjs';

export const FILL_PROFILE_VERSION = 1;
export const FILL_KINDS = Object.freeze(['title-body', 'text-figure', 'compare', 'steps', 'cards']);
const INCH = 914400, MIN_BODY_UNITS = 40, ROW_TOLERANCE = .6 * INCH, FIGURE_AREA = .04, FIGURE_SIDE = 1.5 * INCH;
const HEADINGS = new Set(['label', 'point-heading']);
const BODIES = new Set(['body', 'point-description', 'list']);

/** The units a text takes in a slot: the measure the writer budgets with and the binding checks. */
export const fillUnits = text => templateVisualUnits(String(text || ''));

const centre = g => ({ x: g.x + g.width / 2, y: g.y + g.height / 2 });

/** The page's blocks: heading + body per slot group, in reading order. */
function holders(spec, slots, room) {
  const geometry = new Map((spec.nodes || []).map(node => [String(node.nativeRef?.shapeId), node.geometry]));
  const groups = new Map();
  for (const slot of slots.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose))) {
    const key = String(slot.groupId || slot.pairedWith || slot.shapeId);
    groups.set(key, [...(groups.get(key) || []), slot]);
  }
  const blocks = [];
  for (const group of groups.values()) {
    // Structure is read at the template's own size (its nominal capacity); the
    // caps are the room at the card size (a 12 pt sample at 14 pt holds about
    // three quarters as much: Mood t4/t7 halved below the body minimum).
    // A description its group pairs with a heading is a block body however
    // short (Capabilities t4/t7/t10: 12-28 unit cards beside a picture).
    const paired = slot => slot.purpose === 'point-description' && group.some(other => other !== slot && HEADINGS.has(other.purpose)) && Number(slot.capacity || 0) >= 12;
    const body = group.filter(slot => BODIES.has(slot.purpose || 'body') && (Number(slot.capacity || 0) >= MIN_BODY_UNITS || paired(slot))).sort((a, b) => Number(b.capacity) - Number(a.capacity))[0];
    if (!body) continue;
    const heading = group.find(slot => slot !== body && slot.purpose === 'point-heading') || group.find(slot => slot !== body && HEADINGS.has(slot.purpose)) || null;
    // A small label beside the heading is the block's kicker (Fable 2026-11-03,
    // Deal-Review t5): the binding writes the block's ordinal there.
    const kicker = group.find(slot => slot !== body && slot !== heading && slot.purpose === 'label')
      // or a short second description set above the body (Deal-Review t5's third card).
      || group.find(slot => slot !== body && slot !== heading && BODIES.has(slot.purpose) && Number(slot.capacity || 0) < MIN_BODY_UNITS && (geometry.get(String(slot.shapeId))?.y ?? Infinity) < (geometry.get(String(body.shapeId))?.y ?? -Infinity)) || null;
    const g = geometry.get(String(body.shapeId)), h = heading && geometry.get(String(heading.shapeId));
    if (!g) continue;
    const box = h ? { x: Math.min(g.x, h.x), y: Math.min(g.y, h.y), width: Math.max(g.x + g.width, h.x + h.width) - Math.min(g.x, h.x), height: Math.max(g.y + g.height, h.y + h.height) - Math.min(g.y, h.y) } : g;
    blocks.push({ body, heading, kicker, box, list: body.purpose === 'list' ? Math.max(1, Number(body.paragraphCount) || 1) : 0 });
  }
  // A label in its own group, inside a block's column between its heading and
  // body, is that block's kicker (Deal-Review t5: "[List 2-3 Strengths]").
  const used = new Set(blocks.flatMap(item => [item.body, item.heading, item.kicker].filter(Boolean).map(slot => String(slot.shapeId))));
  for (const slot of slots.filter(slot => slot.role === 'content' && slot.purpose === 'label' && !used.has(String(slot.shapeId)))) {
    const g = geometry.get(String(slot.shapeId));if (!g) continue;
    const owner = blocks.find(item => !item.kicker && item.heading && g.x >= item.box.x - .05 * INCH && g.x + g.width <= item.box.x + item.box.width + .05 * INCH && g.y >= item.box.y && g.y + g.height <= item.box.y + item.box.height + .05 * INCH);
    if (owner) owner.kicker = slot;
  }
  return blocks.sort((a, b) => Math.abs(a.box.y - b.box.y) > ROW_TOLERANCE ? a.box.y - b.box.y : a.box.x - b.box.x);
}

/** The page's content picture slots: pictures in the body area, not the frame's chrome. */
function figureSlots(spec, size) {
  const area = (size?.width || 12192000) * (size?.height || 6858000);
  return (spec.nodes || []).filter(node => node.type === 'image' && node.geometry && node.nativeRef?.shapeId !== undefined && !node.content?.mustPreserve
    && !chromeSlot(node, size) && node.geometry.width * node.geometry.height >= area * FIGURE_AREA && Math.min(node.geometry.width, node.geometry.height) >= FIGURE_SIDE)
    .sort((a, b) => a.geometry.x - b.geometry.x || a.geometry.y - b.geometry.y)
    .map(node => ({ shapeId: node.nativeRef.shapeId, nodeId: node.id, aspect: Math.round(node.geometry.width / node.geometry.height * 100) / 100, geometry: { ...node.geometry } }));
}

/** Number markers ("1", "02", "A") a template draws by its blocks. */
function numberMarkers(spec, slots) {
  return slots.filter(slot => slot.role === 'static' && /^\s*(?:0?\d{1,2}|[A-F])\s*\.?\s*$/u.test(String(spec.nodes?.find(node => node.nativeRef?.shapeId === slot.shapeId)?.content?.text || ''))).length;
}
/** Small dots or rings, one per block, in a column or a row: a timeline's step markers (Mood t4). */
function dotMarkers(spec, blocks) {
  const dots = (spec.nodes || []).filter(node => node.type === 'shape' && /^OVAL|ELLIPSE|DONUT/u.test(String(node.nativeRef?.autoShapeType || '')) && node.geometry && Math.max(node.geometry.width, node.geometry.height) <= .35 * INCH);
  if (dots.length < blocks.length) return false;
  const xs = dots.map(dot => dot.geometry.x), ys = dots.map(dot => dot.geometry.y);
  return Math.max(...xs) - Math.min(...xs) <= ROW_TOLERANCE / 2 || Math.max(...ys) - Math.min(...ys) <= ROW_TOLERANCE / 2;
}
const arrows = spec => (spec.nodes || []).filter(node => node.type === 'shape' && /ARROW|CHEVRON|PENTAGON/u.test(String(node.nativeRef?.autoShapeType || ''))).length;
const oneColumn = blocks => blocks.every(block => Math.abs(block.box.x - blocks[0].box.x) <= ROW_TOLERANCE / 2);
const oneRow = blocks => blocks.every(block => Math.abs(block.box.y - blocks[0].box.y) <= ROW_TOLERANCE);

/** The size a filled slot is set at: the sample's own, never under 12 pt (null = unchanged). */
export function nativeFont(spec, slot) {
  const node = spec?.nodes?.find(node => node.type === 'text' && String(node.nativeRef?.shapeId) === String(slot?.shapeId));
  const size = Number(node?.style?.fontSizePt || slot?.fontSizePt) || 0;
  return size && size < 12 ? 12 : null;
}
/** One template page's fill profile. `index` is the template page (0-based). */
export function fillProfile(project, spec, index, { last = false } = {}) {
  // The template's last page is profiled like any other; whether it closes the deck is the matcher's choice (Fable: Mood t8 is a two-section list).
  const size = project.templateFidelity || {}, base = { version: FILL_PROFILE_VERSION, profileId: `fill-${index}`, page: index, ...(last ? { lastPage: true } : {}) };
  if (index === 0) return { ...base, kind: null, reason: 'cover' };
  const slots = spec.slots?.length ? spec.slots : slotsFor({ nodes: spec.nodes || [] });
  // At the slot's own type size, the template's formatting kept (the user,
  // 2026-11-03); a sample under 12 pt is raised to 12, the readable floor.
  const room = slot => layouts.slotFit(spec, slot, nativeFont(spec, slot)).room;
  let blocks = holders(spec, slots, room);
  const markers = numberMarkers(spec, slots);
  const figures = figureSlots(spec, size);
  const contentWidth = Math.max(1, ...blocks.map(block => block.box.x + block.box.width)) - Math.min(...blocks.map(block => block.box.x), Infinity);
  // Bare bodies above every headed block are the lead (one line, possibly set
  // over two columns: Capabilities t3); a wide bare body below them all is the
  // summary line (Capabilities t6, Mood t6). Neither is a block.
  let lead = null, tail = null;
  // A bare body under a headed block, in its column and before the next headed
  // block, is that block's second body (Mood t8, section 1 under its divider).
  const across = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) >= .65 * Math.min(a.width, b.width);
  for (const item of blocks.filter(item => !item.heading)) {
    const owner = blocks.filter(other => other.heading && across(other.box, item.box) && other.box.y < item.box.y).sort((a, b) => b.box.y - a.box.y)[0];
    const next = owner && blocks.some(other => other.heading && other !== owner && across(other.box, item.box) && other.box.y > owner.box.y && other.box.y < item.box.y);
    if (owner && !next && item.box.width <= owner.box.width * 1.3 && item.box.y - (owner.box.y + owner.box.height) <= .6 * INCH) { (owner.extra ||= []).push(item.body); item.attached = true; }
  }
  blocks = blocks.filter(item => !item.attached);
  const headed = blocks.filter(item => item.heading);
  if (headed.length >= 2) {
    const top = Math.min(...headed.map(item => item.box.y)), bottom = Math.max(...headed.map(item => item.box.y + item.box.height));
    const above = blocks.filter(item => !item.heading && item.box.y + item.box.height <= top + .05 * INCH && Number(item.body.maxLines || 1) <= 4);
    const below = blocks.filter(item => !item.heading && item.box.y >= bottom - .05 * INCH && item.box.width >= contentWidth * .6);
    if (above.length) lead = above;
    if (below.length === 1) tail = below[0];
    blocks = blocks.filter(item => !above.includes(item) && item !== tail);
    // A full-width headed block over narrower ones is an intro with its own heading (Deal-Review t4).
    const [first, ...others] = blocks;
    if (!lead && first?.heading && others.length >= 2 && first.box.width >= contentWidth * .8 && others.every(item => item.box.width <= contentWidth * .5 && item.box.y >= first.box.y + first.box.height * .9)) { lead = [first]; blocks = others; }
  }
  const block = item => ({ heading: item.heading ? { shapeId: item.heading.shapeId, cap: room(item.heading) || Number(item.heading.capacity) || 0 } : null,
    body: { shapeId: item.body.shapeId, cap: room(item.body), ...(item.list ? { items: item.list } : {}) },
    ...(item.kicker ? { kicker: { shapeId: item.kicker.shapeId } } : {}),
    // A second body the binding removes when the block's text fits the first.
    ...(item.extra ? { extraShapeIds: item.extra.map(slot => slot.shapeId) } : {}) });
  const profile = { ...base, blocks: blocks.length, blockSlots: blocks.map(block), lead: lead ? { present: true, shapeId: lead[0].body.shapeId, cap: Math.min(...lead.map(item => room(item.body))), columns: lead.length, ...(lead[0].heading ? { headingShapeId: lead[0].heading.shapeId, headingCap: room(lead[0].heading) } : {}), ...(lead.length > 1 ? { extraShapeIds: lead.slice(1).map(item => item.body.shapeId) } : {}) } : { present: false },
    // Template headings over a group of blocks ("Critical Elements"): the binding writes the card's heading there or clears them.
    groupHeadingShapeIds: slots.filter(slot => slot.role === 'content' && slot.purpose === 'group-heading').map(slot => slot.shapeId),
    summary: tail ? { present: true, shapeId: tail.body.shapeId, cap: room(tail.body) } : { present: false },
    figures: figures.length, figureSlots: figures, numbered: false, paired: false, stackMayHoldFewer: false };
  if (!blocks.length) return { ...profile, kind: null, reason: figures.length ? 'figure_only_frame' : 'no_text_slots' };
  // Text slots no block, lead, summary or kicker takes are a structure this
  // reader does not see (Capabilities t8's bar steps and t9's funnel read as
  // title-body from their summary line, Codex 2026-11-03): not recognised.
  const claimed = new Set([...blocks.flatMap(item => [item.body, item.heading, item.kicker, ...(item.extra || [])]), ...(lead || []).flatMap(item => [item.body, item.heading]), tail?.body].filter(Boolean).map(slot => String(slot.shapeId)));
  const unclaimed = slots.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose) && !claimed.has(String(slot.shapeId)) && Number(slot.capacity || 0) > 6);
  if (unclaimed.length >= 2) return { ...profile, kind: null, reason: 'unclaimed_slots', detail: { slots: unclaimed.map(slot => slot.shapeId) } };
  // Pictures stacked on one another are artwork (a ring drawn in layers: Mood t6), never figure slots; deferred.
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  if (figures.some((a, i) => figures.some((b, j) => j > i && overlap(a.geometry, b.geometry) > .5 * Math.min(a.geometry.width * a.geometry.height, b.geometry.width * b.geometry.height)))) return { ...profile, kind: null, reason: 'layered_artwork_deferred' };
  // Numbered markers with no block of their own: an agenda of petals or a
  // ring's labels (Mood t2), deferred in the MVP.
  if (markers > blocks.length) return { ...profile, kind: null, reason: 'agenda_deferred' };
  // Blocks of mixed shape (two headed blocks and a bare one: Mood t6's ring) are no repeated structure.
  if (blocks.length >= 2 && new Set(blocks.map(item => Boolean(item.heading))).size > 1) return { ...profile, kind: null, reason: 'irregular_blocks' };
  // One large block among small ones (a featured item: Deal-Review t4/t5) is no repeated structure either.
  const caps = blocks.map(item => room(item.body));
  // Read at the template's nominal size, as the structure is: a one-line and a two-line heading of one style are alike.
  const headingCaps = blocks.filter(item => item.heading).map(item => Number(item.heading.capacity) || room(item.heading) || 0);
  if (blocks.length >= 2 && (Math.max(...caps) > 2.5 * Math.max(1, Math.min(...caps)) || headingCaps.length && Math.max(...headingCaps) > 2 * Math.max(1, Math.min(...headingCaps)))) return { ...profile, kind: null, reason: 'irregular_blocks' };
  if (blocks.length === 1) return { ...profile, kind: figures.length ? 'text-figure' : 'title-body' };
  if (blocks.length > 6) return { ...profile, kind: null, reason: 'too_many_blocks' };
  if (blocks.length === 2 && oneRow(blocks)) {
    const [a, b] = blocks.map(item => item.box.width);
    if (Math.abs(a / b - 1) <= .25) return { ...profile, kind: 'compare', paired: true };
  }
  const marked = markers >= blocks.length;
  if (blocks.length >= 3 && (marked || dotMarkers(spec, blocks) || arrows(spec) >= blocks.length - 1 && (oneColumn(blocks) || oneRow(blocks))))
    return { ...profile, kind: 'steps', numbered: marked, stackMayHoldFewer: oneColumn(blocks) };
  return { ...profile, kind: 'cards', stackMayHoldFewer: oneColumn(blocks) };
}

/** Every template page's profile, in template order (from the source catalog). */
export function fillProfiles(project) {
  const fidelity = project.templateFidelity;
  if (fidelity?.mode !== 'preserve') return [];
  const catalog = fidelity.sourceCatalog || [];
  return catalog.map((spec, index) => fillProfile(project, spec, index, { last: index === catalog.length - 1 && catalog.length > 2 }));
}

/** Whether a card of this shape fills this page exactly: the kind matches and
 * the block count equals the card's (a vertical stack may hold one fewer, its
 * last group removed whole); a card's figures need as many picture slots. */
export function profileAccepts(profile, { kind, blocks, figures = 0 } = {}) {
  // A procedure may take a cards page, its cards numbered in order; parallel
  // cards never take a steps page, whose connector claims a sequence the
  // content does not have (Fable 2026-11-03, the rail rule on native pages).
  const compatible = profile?.kind === kind || profile?.kind === 'cards' && kind === 'steps';
  if (!profile?.kind || !compatible) return false;
  const exact = blocks === profile.blocks || profile.stackMayHoldFewer && blocks === profile.blocks - 1;
  if (!exact) return false;
  if (profile.kind === 'text-figure') return figures >= 1 && figures <= profile.figures;
  // A two-sided page with figure slots is a two-figure comparison only, as the
  // hand deck used Mood t3 (Fable 2026-11-03): one figure left a half empty
  // (live Mood p15), none left an empty band once its slots are removed (JEPA p7).
  if (profile.kind === 'compare' && profile.figures >= 2) return figures === profile.figures;
  return figures <= profile.figures;
}

/** Whether written blocks fit the profile: each heading and body within its cap. */
export function blocksFit(profile, written = [], { lead = '', summary = '' } = {}) {
  if (written.length > profile.blockSlots.length) return { ok: false, reason: 'too_many_blocks' };
  for (const [k, item] of written.entries()) {
    const slot = profile.blockSlots[k];
    if (item.heading && !slot.heading) return { ok: false, reason: 'no_heading_slot', block: k };
    // A page whose blocks are headed needs every heading: a bare phrase in a
    // body slot under an empty pill reads as a heading (live Mood p15).
    if (slot.heading && !String(item.heading || '').trim()) return { ok: false, reason: 'heading_missing', block: k };
    if (item.heading && fillUnits(item.heading) > slot.heading.cap) return { ok: false, reason: 'heading_over_cap', block: k };
    if (fillUnits(item.body) > slot.body.cap) return { ok: false, reason: 'body_over_cap', block: k };
  }
  // A lead over n columns holds n times one column's cap (spread by leadParts).
  if (lead && (!profile.lead.present || fillUnits(lead) > profile.lead.cap * (profile.lead.columns || 1))) return { ok: false, reason: 'lead_over_cap' };
  if (summary && (!profile.summary.present || fillUnits(summary) > profile.summary.cap)) return { ok: false, reason: 'summary_over_cap' };
  return { ok: true };
}

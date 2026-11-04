// A filled card is written into its template page's own shapes (fill-template-
// first MVP, the user 2026-11-03): its blocks in the page's slots, kickers
// numbered, unused blocks, lead, summary, second bodies and group headings
// left out, figures in the figure slots with their captions, the slots left
// over removed; a page whose text does not fit is no filled page (fallback).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slotsFor } from './lib/ppt-template-fidelity.mjs';
import { fillNativeSlots, fillCheck, applyFillPictures, filledPage } from './lib/ppt-template-fill-bind.mjs';
import { nativeCardSlots } from './lib/ppt-card-pages.mjs';

const fixture = name => JSON.parse(fs.readFileSync(new URL(`./test/fixtures/fill-profiles/${name}.json`, import.meta.url)));
const projectOn = (name, pages) => {
  const f = fixture(name);
  const slides = pages.map(page => ({ ...f.catalog[page], sourceIndex: page, slots: slotsFor({ nodes: f.catalog[page].nodes }) }));
  return { f, project: { templateFidelity: { mode: 'preserve', width: f.width, height: f.height, sourceCatalog: f.catalog, slides, slideMap: pages }, source: { images: [] }, outline: [] } };
};
const fill = (page, blocks, extra = {}) => ({ id: 'card', title: 'Card', keyPoints: blocks.map(block => ({ text: block.body })), cardObjects: [], templateFill: { page, profileId: `fill-${page}`, sticky: true, status: 'filled', kind: 'cards', blocks: blocks.length, figures: 0, ...extra.templateFill }, fillBlocks: blocks, ...extra.page });

// Mood t5 (2×2 cards with a lead): four blocks in the four card slots, the lead left out when unwritten.
{const { f, project } = projectOn('mood-board', [0, 4]), profile = f.profiles[4];
 const blocks = ['Vision', 'Memory', 'Control', 'Training'].map(heading => ({ heading, body: `${heading} is one part of the agent.` }));
 const page = fill(4, blocks);project.outline = [{ id: 'cover' }, page];
 assert.ok(filledPage(page) && fillCheck(project, 1, page).ok);
 const plan = fillNativeSlots(project, 1, page);
 assert.deepEqual(profile.blockSlots.map(slot => [plan.texts[String(slot.heading.shapeId)], plan.texts[String(slot.body.shapeId)]]), blocks.map(block => [block.heading, block.body]), 'each block in its own heading and body slot');
 assert.ok(plan.leaveOut.includes(String(profile.lead.shapeId)), 'an unwritten lead is left out, never sample text');
 assert.deepEqual(nativeCardSlots(project, 1, page), plan, 'the native slot plan of the page: scheduling, preflight and the draft read it');
 const led = fillNativeSlots(project, 1, { ...page, fillLead: 'Four parts work together.' });
 assert.equal(led.texts[String(profile.lead.shapeId)], 'Four parts work together.');
 // Over its cap: no filled page, the card takes the theme layout with all its content.
 const long = fill(4, blocks.map((block, k) => k ? block : { ...block, body: 'word '.repeat(200) }));
 assert.equal(fillCheck(project, 1, long).reason, 'bind_fit');assert.equal(fillNativeSlots(project, 1, long), null);
 // On another template page than its fill: not bound there.
 assert.equal(fillCheck({ ...project, templateFidelity: { ...project.templateFidelity, slides: [project.templateFidelity.slides[0], { ...project.templateFidelity.slides[1], sourceIndex: 3 }] } }, 1, page).reason, 'bind_frame');}

// Mood t4 (steps, a vertical stack) holds one fewer: the fourth step group is left out whole.
{const { f, project } = projectOn('mood-board', [0, 3]), profile = f.profiles[3];
 const page = fill(3, [{ heading: 'Collect', body: 'Roll out N times.' }, { heading: 'Train M', body: 'Fit the dynamics.' }, { heading: 'Train C', body: 'Optimise in M.' }], { templateFill: { kind: 'steps' } });
 project.outline = [{ id: 'cover' }, page];
 const plan = fillNativeSlots(project, 1, page), last = profile.blockSlots[3];
 assert.ok(plan.leaveOut.includes(String(last.body.shapeId)) && plan.leaveOut.includes(String(last.heading.shapeId)));}

// Deal-Review t5: kickers take the block's ordinal; group headings are cleared.
{const { f, project } = projectOn('deal-review', [0, 4]), profile = f.profiles[4];
 const page = fill(4, ['Gain', 'Risk', 'Help'].map(heading => ({ heading, body: 'Short.' })));project.outline = [{ id: 'cover' }, page];
 const plan = fillNativeSlots(project, 1, page);
 assert.deepEqual(profile.blockSlots.map(slot => plan.texts[String(slot.kicker.shapeId)]), ['01', '02', '03']);}

// Mood t7 (three columns, three figure slots): the card's one figure goes into the
// first slot over its caption; the two left over are removed.
{const { f, project } = projectOn('mood-board', [0, 6]), profile = f.profiles[6];
 const image = { id: 'fig1', width: 400, height: 300, role: 'source_content', continuousTone: true, caption: 'Figure 1. A world model. It drives a bicycle.', sourceRefs: ['1'], dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
 project.source.images = [image];
 const page = fill(6, ['A', 'B', 'C'].map(heading => ({ heading, body: 'Short line.' })), { page: { sourceImageIds: ['fig1'] }, templateFill: { figures: 1 } });
 project.outline = [{ id: 'cover' }, page];
 const plan = fillNativeSlots(project, 1, page);
 assert.ok(profile.figureSlots.slice(1).every(slot => plan.leaveOut.includes(String(slot.shapeId))), 'unused figure slots are removed');
 assert.ok(!plan.leaveOut.includes(String(profile.figureSlots[0].shapeId)));
 const slide = { id: 's1', nodes: structuredClone(f.catalog[6].nodes) };
 assert.equal(applyFillPictures(project, slide, 1, page), 1);
 const picture = slide.nodes.find(node => String(node.nativeRef?.shapeId) === String(profile.figureSlots[0].shapeId)), caption = slide.nodes.find(node => node.content?.sourceImageCaptionId === 'fig1');
 assert.ok(picture.content.fillFigure && picture.content.mediaReplacement && picture.sourceArtifact.sourceUnitId === 'fig1', 'the source figure replaces the sample picture');
 assert.equal(caption.content.text, 'Figure 1. A world model.', 'the first sentence with its number (the whole caption in the notes)');
 assert.ok(caption.geometry.y >= picture.geometry.y + picture.geometry.height, 'the caption under the figure');
 const slot = profile.figureSlots[0].geometry;
 assert.ok(caption.geometry.y + caption.geometry.height <= slot.y + slot.height + 1, 'both inside the template slot');}

// A card citing more figures than its page has slots is no filled page (Fable 2026-11-03).
{const { project } = projectOn('mood-board', [0, 4]);
 const page = fill(4, ['A', 'B', 'C', 'D'].map(heading => ({ heading, body: 'Short line.' })), { templateFill: { citedFigures: 2 } });
 project.outline = [{ id: 'cover' }, page];
 assert.equal(filledPage(page), false, 'nor fixed: pairing and scheduling may move it');assert.equal(fillNativeSlots(project, 1, page), null);}

// A comparison without figures removes both figure slots and its pill icons (Codex B2).
{const { f, project } = projectOn('mood-board', [0, 2]), profile = f.profiles[2];
 const page = fill(2, [{ heading: 'Dream', body: 'Cheap rollouts.' }, { heading: 'Reality', body: 'Costly rollouts.' }], { templateFill: { kind: 'compare' } });
 project.outline = [{ id: 'cover' }, page];
 const plan = fillNativeSlots(project, 1, page);
 assert.ok(profile.figureSlots.every(slot => plan.leaveOut.includes(String(slot.shapeId))), 'no borrowed picture on a comparison');
 assert.ok(['4', '9'].every(id => plan.leaveOut.includes(id)), 'the pills keep no sample icon');
 assert.deepEqual(plan.plain.sort(), profile.blockSlots.map(slot => String(slot.body.shapeId)).sort(), 'the bodies take the body style');}

console.log('PASS template fill binding: blocks in their own slots, lead optional, stack N−1, kickers numbered, figures in their slots with captions, unused slots removed, over-cap, wrong-frame and too-many-figure pages fall back');

// The preview draws a rounded rectangle's corner as OOXML does: adj/100000 of the shorter side, per axis (3197 Mood t5 arches).
{const { nativeShapeContract } = await import('./lib/ppt/native-shape.mjs'), IN = 914400;
 const svg = nativeShapeContract({ geometry: { width: 5.85 * IN, height: 1.15 * IN }, content: { presetGeometry: 'roundRect', presetAdjust: 9223 } }).svg;
 const [, rx, ry] = svg.match(/rx="([\d.]+)" ry="([\d.]+)"/);
 assert.ok(Math.abs(Number(ry) - 9.223) < .01 && Math.abs(Number(rx) - 9.223 * 1.15 / 5.85) < .01, 'a 0.11 in corner, not an arch');}
console.log('PASS round-rectangle corners as OOXML adj');

// A figure page on a frame with picture slots: its figures in the slots only when
// every slot takes one and each stays legible (Fable 2026-11-03, M2).
{const { figureSlotPlan, figureSlotDraft } = await import('./lib/ppt-template-fill-bind.mjs');
 const { f, project } = projectOn('mood-board', [0, 2]), profile = f.profiles[2];
 const figure = (id, extra = {}) => ({ id, width: 800, height: 450, role: 'source_content', continuousTone: true, caption: `Figure ${id.slice(1)}. A rollout. More text.`, sourceRefs: ['1'], dataUrl: 'data:image/png;base64,iVBORw0KGgo=', ...extra });
 project.source.images = [figure('f1'), figure('f2'), figure('f3', { role: 'diagram', continuousTone: false, figureText: { source: 'glyphs', share: .004 } })];
 const page = ids => ({ id: 'fig', title: 'Figures', figurePage: true, sourceImageIds: ids, keyPoints: [] });
 project.outline = [{ id: 'cover' }, page(['f1'])];
 assert.equal(figureSlotPlan(project, 1, page(['f1'])).reason, 'slot_count', 'one figure in a two-slot frame stays code-drawn');
 const plan = figureSlotPlan(project, 1, page(['f1', 'f2']));
 assert.ok(plan.ok);assert.deepEqual(plan.placements.map(item => item.imageId), ['f1', 'f2'], 'citation order along the slots');
 assert.ok(profile.blockSlots.every(block => plan.texts[String(block.body.shapeId)]?.startsWith('Figure')), 'the block bodies carry the shortened captions');
 assert.ok(['4', '9'].every(id => plan.leaveOut.includes(id)), 'no pill icons');
 assert.ok(figureSlotDraft(project, 1, page(['f1', 'f2'])).cardPage.mode === 'native');
 assert.equal(figureSlotPlan(project, 1, page(['f1', 'f3'])).reason, 'legibility', 'one small-text diagram keeps the whole page code-drawn');}
console.log('PASS figure pages in their frame\'s picture slots');

// A two-column lead is spread over both columns (Codex, live Capabilities t3).
{const { leadParts } = await import('./lib/ppt-template-fill-bind.mjs');
 assert.deepEqual(leadParts('First idea. Second idea.', 2), ['First idea.', 'Second idea.']);
 assert.deepEqual(leadParts('我们提供咨询，并支持落地实施', 2), ['我们提供咨询，', '并支持落地实施']);
 assert.deepEqual(leadParts('One phrase only', 2), ['One phrase only'], 'unbreakable: the first column, the second left out');
 const { f, project } = projectOn('capabilities', [0, 2]), profile = f.profiles[2];
 const page = fill(2, ['A', 'B', 'C'].map(heading => ({ heading, body: 'Short line here.' })), { page: { fillLead: 'We advise. We deliver.' } });
 project.outline = [{ id: 'cover' }, page];
 const plan = fillNativeSlots(project, 1, page);
 assert.deepEqual([profile.lead.shapeId, ...profile.lead.extraShapeIds].map(id => plan.texts[String(id)]), ['We advise.', 'We deliver.']);}
console.log('PASS two-column leads');


// A one-sentence lead that will not split takes the whole two-column band:
// the first frame widens and the divider goes (Codex, live Capabilities 640e0f98 p3/p5).
{const { f, project } = projectOn('capabilities', [0, 2]), profile = f.profiles[2];
 const page = fill(2, ['A', 'B', 'C'].map(heading => ({ heading, body: 'Short line here.' })), { page: { fillLead: 'One phrase only' } });
 project.outline = [{ id: 'cover' }, page];
 const slide = { id: 's', nodes: structuredClone(f.catalog[2].nodes) };
 applyFillPictures(project, slide, 1, page);
 const [first, second] = [profile.lead.shapeId, profile.lead.extraShapeIds[0]].map(id => f.catalog[2].nodes.find(node => node.nativeRef?.shapeId === id).geometry);
 const lead = slide.nodes.find(node => node.nativeRef?.shapeId === profile.lead.shapeId);
 assert.equal(lead.geometry.x + lead.geometry.width, second.x + second.width, 'the lead spans both columns');
 assert.ok(slide.templateOmissions.some(item => item.shapeId === 8) && !slide.nodes.some(node => node.nativeRef?.shapeId === 8), 'the divider goes');
 assert.ok(first.width < lead.geometry.width);}
console.log('PASS one-sentence leads take the whole band');

// A lead its band leaves mostly empty becomes the page subtitle and the band
// goes (Fable 2026-11-03, Q6 (b); live Capabilities 04e04491 p2/p5).
{await import('./lib/ppt-title-hierarchy.mjs');
 const { LEAD_MIN_SHARE } = await import('./lib/ppt-template-fill-bind.mjs');
 const on = lead => {
  const { f, project } = projectOn('capabilities', [0, 2]);project.planningContract = { flow: 'cards' };
  const page = fill(2, ['A', 'B', 'C'].map(heading => ({ heading, body: 'Short line here.' })), { page: { fillLead: lead } });
  project.outline = [{ id: 'cover' }, page];
  const slide = { id: 's', nodes: structuredClone(f.catalog[2].nodes).map(node => node.nativeRef?.shapeId === 6 ? { ...node, content: { ...node.content, text: lead } } : node) };
  applyFillPictures(project, slide, 1, page);return { f, slide };
 };
 const { slide } = on('MCP 让 AI 应用使用外部能力。');
 const subtitle = slide.nodes.find(node => node.semanticRole === 'card-lead');
 assert.equal(subtitle?.content?.text, 'MCP 让 AI 应用使用外部能力。', 'the lead is the subtitle');
 assert.ok([4, 5, 6, 7, 8, 9].every(id => !slide.nodes.some(node => node.nativeRef?.shapeId === id) && slide.templateOmissions.some(item => item.shapeId === id && item.approvalBasis === 'card_group_omitted')), 'the band, its frames and divider go');
 assert.ok([11, 12, 19].every(id => slide.nodes.some(node => node.nativeRef?.shapeId === id)), 'the blocks and the summary row stay');
 assert.ok(slide.fillLeadAsSubtitle);
 // The blocks move up into the freed band as one group, the page number stays (Fable 2026-11-03).
 const { f } = on('x'), at = (nodes, id) => nodes.find(node => node.nativeRef?.shapeId === id).geometry;
 const shift = slide.fillBandShift.height, band = at(f.catalog[2].nodes, 4);
 assert.ok(shift >= .4 * 914400, 'a band worth moving for');
 assert.ok([10, 11, 12, 17, 18].every(id => at(slide.nodes, id).y === at(f.catalog[2].nodes, id).y - shift), 'one group, its own spacing kept');
 const title = at(f.catalog[2].nodes, 2), gap = band.y - (title.y + title.height);
 assert.equal(at(slide.nodes, 10).y, Math.max(band.y, subtitle.geometry.y + subtitle.geometry.height + gap), 'where the band began, the template\'s title-to-band gap under the subtitle');
 assert.ok(at(slide.nodes, 10).y >= subtitle.geometry.y + subtitle.geometry.height, 'never above the subtitle');
 assert.equal(at(slide.nodes, 20).y, at(f.catalog[2].nodes, 20).y, 'the page number stays');
 // A lead filling its band keeps it.
 const full = on('我们为企业提供从战略咨询、方案设计到落地实施和持续运营的完整服务，并在每个阶段与客户团队紧密协作，确保目标达成。');
 assert.ok(!full.slide.nodes.some(node => node.semanticRole === 'card-lead') && full.slide.nodes.some(node => node.nativeRef?.shapeId === 4));
 assert.equal(LEAD_MIN_SHARE, .3);}
console.log('PASS short leads become the page subtitle');

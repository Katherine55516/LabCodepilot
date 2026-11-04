import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _internals as importer, projectFromImportedManifest } from './lib/ppt/import-pptx.mjs';
import { fidelityFromImported } from './lib/ppt-template-fidelity.mjs';

// A real-deck template like GPH-GU2353 (live alpha/pdf 2026-10-26): a cover
// with circles inside its title frame and a small label box, a content page,
// a page whose top title runs past the right edge beside a photo, a section
// header with its title mid-page, and a closing page.
const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/labcodepilot/ppt-python/bin/python';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-header-frames-'));
process.env.COWORK_STATE_DIR = root;
const run = (script, input, env = {}) => { const r = spawnSync(python, ['-c', script], { input, env: { ...process.env, ...env }, maxBuffer: 50_000_000 }); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout.toString(); };
export function headerFrameTemplate() {
  const template = path.join(root, 'template.pptx');
  run(`from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from PIL import Image
import io, os
p=Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(5.625)
layout=p.slide_layouts[6]
def text(s,x,y,w,h,value,pt,bold=False):
    box=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h)); box.text_frame.word_wrap=True; box.text=value
    run=box.text_frame.paragraphs[0].runs[0]; run.font.size=Pt(pt); run.font.bold=bold; return box
def dot(s,x,y,d):
    shape=s.shapes.add_shape(MSO_SHAPE.OVAL,Inches(x),Inches(y),Inches(d),Inches(d)); shape.fill.solid(); shape.fill.fore_color.rgb=RGBColor(0xe0,0x7a,0x2f); shape.line.fill.background(); return shape
def photo(s,x,y,w,h):
    buffer=io.BytesIO(); Image.new('RGB',(380,480),'#4477aa').save(buffer,format='PNG'); buffer.seek(0); return s.shapes.add_picture(buffer,Inches(x),Inches(y),Inches(w),Inches(h))
s=p.slides.add_slide(layout)
text(s,1.95,1.63,5.66,2.20,'World Health Report',39,True); text(s,.36,.99,2.63,.88,'Final Project',20)
dot(s,2.93,3.01,.34); dot(s,6.40,3.11,.43)
s=p.slides.add_slide(layout)
text(s,.34,.49,9.21,.63,'Model Selection Results',28,True)
text(s,.45,1.22,9.15,1.6,'Stepwise selection keeps four predictors and the adjusted R squared rises to 0.71 on the holdout set.',14)
# A screenshot strip of the old deck's table in the body band, and a brand strip under the footer label (GPH tpl28).
import random
def noisy(x,y,w,h,seed):
    random.seed(seed);img=Image.new('RGB',(480,30));img.putdata([(random.randrange(256),random.randrange(256),random.randrange(256)) for _ in range(480*30)])
    buffer=io.BytesIO();img.save(buffer,format='PNG');buffer.seek(0);return s.shapes.add_picture(buffer,Inches(x),Inches(y),Inches(w),Inches(h))
noisy(.17,3.96,9.67,.60,1)
text(s,1.14,4.75,2.56,.30,'Global Public Health',12)
noisy(.17,5.15,9.67,.30,2)
s=p.slides.add_slide(layout)
text(s,1.08,.10,9.21,.63,'World Health Statistics',28,True)
text(s,.34,1.26,5.55,3.42,'Covers the most recent and updated health statistics for every member state in one table.',14)
photo(s,6.01,.62,3.81,4.80)
s=p.slides.add_slide(layout)
text(s,1.93,1.13,5.66,1.0,'Part Two',14); text(s,1.61,2.81,7.27,.88,'Diagnostics and Remedies',32,True)
s=p.slides.add_slide(layout)
text(s,2.5,2.2,5,1,'Thank you',40,True)
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: template });
  const bytes = fs.readFileSync(template), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const imported = projectFromImportedManifest({ id: 'header-frames', uid: 'test', title: 'Header frames' }, JSON.parse(run(importer.IMPORT_SCRIPT, bytes, { PPT_EXTERNAL_DIR: root })), hash);
  return { template, imported, hash };
}
const IN = 914400;
try {
  const { imported, hash } = headerFrameTemplate();
  const { bindTemplateFidelity, themeFrameEligibility } = await import('./lib/ppt-template-fidelity.mjs');
  const { headerFrameReason } = await import('./lib/ppt-template-roles.mjs');
  const { contentCanvas, derivedSectionLabelFrame } = await import('./lib/ppt-density-capacity.mjs');
  const { cardPageScore, HEADER_FRAME_COST, inspectCardPageLabels, deterministicCoverDraft, coverTitleSize } = await import('./lib/ppt-card-pages.mjs');
  const { normalizeDeckEyebrows } = await import('./lib/ppt-section-eyebrow.mjs');
  const { classifyCollision } = await import('./lib/ppt/render-collision.mjs');
  const { applyRenderContract } = await import('./lib/ppt/render-contract.mjs');
  const fidelity = fidelityFromImported({ pages: 5 }, imported, hash), W = fidelity.width, H = fidelity.height;
  const titleOf = spec => spec.nodes.find(node => spec.slots.some(slot => slot.role === 'title' && slot.shapeId === node.nativeRef.shapeId));
  const points = ['Stepwise selection keeps four predictors and drops two collinear ones.', 'The adjusted R squared rises to 0.71 on the holdout set.', 'Residual plots show no remaining curvature after the log transform.'].map(text => ({ text }));
  const outline = [
    { id: 'p0', title: 'World Health Report', section: 'World Health Report', keyPoints: [{ text: 'Cover' }] },
    { id: 'p1', title: 'Model Selection Results', section: 'Model Building', keyPoints: points, cardObjects: [] },
    { id: 'p2', title: 'Health Statistics', section: 'Model Building', keyPoints: points, cardObjects: [] },
    { id: 'p3', title: 'Diagnostics and Remedies', section: 'Diagnostics', keyPoints: points, cardObjects: [] },
    { id: 'p4', title: 'Closing', section: 'Diagnostics', keyPoints: [{ text: 'Thank you' }], cardObjects: [] },
  ];
  const project = () => ({ id: 'header-frames', uid: 'test', pages: 5, planningContract: { version: 3, flow: 'cards' }, generationPolicy: { version: 2, language: { mode: 'output', locale: 'en' } },
    inputUnderstanding: { primaryLanguage: 'en' }, templateSpec: { fonts: { title: 'Arial', body: 'Arial', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC' }, palette: { foreground: '#222222', background: '#ffffff' } },
    source: { text: '# Tutorial 10 — Research Objective and Closed Loop\n\nBody.' },
    templateFidelity: structuredClone(fidelity), outline: structuredClone(outline), deck: { slides: [] } });

  // (1) A text frame we fill stays on the slide; the cut is recorded on the page.
  {const title = titleOf(fidelity.slides[2]);
   assert.equal(title.geometry.x + title.geometry.width, W, 'the overhanging title frame ends at the slide edge');
   assert.ok(Math.abs(title.frameClamped.right - .29 * IN) < .01 * IN && !title.frameClamped.left, 'the cut is recorded: ' + JSON.stringify(title.frameClamped));
   assert.ok(!titleOf(fidelity.slides[1]).frameClamped, 'a frame inside the slide is unchanged');
   const p = project();
   p.deck.slides = p.templateFidelity.slides.map((spec, index) => ({ id: outline[index].id, title: outline[index].title, section: outline[index].section, nodes: [], templateSlotTexts: {} }));
   bindTemplateFidelity(p);
   assert.deepEqual(p.deck.slides[2].frameClamped?.map(item => item.shapeId), [title.nativeRef.shapeId], 'the bound page lists its clamped frame');
   const bound = p.deck.slides[2].nodes.find(node => node.nativeRef?.shapeId === title.nativeRef.shapeId);
   assert.ok(bound.geometry.x + bound.geometry.width <= W, 'the bound title is exported inside the slide');
   assert.ok(!p.deck.slides[1].frameClamped, 'a page without a cut records none');}

  // (2) A section header is no frame for a content page; a divider may use it; with fewer than two frames left, every page is one.
  {assert.ok(['role', 'geometry'].includes(headerFrameReason(fidelity.slides[3], fidelity)), 'the section header is no content frame');
   assert.equal(headerFrameReason(fidelity.slides[1], fidelity), null, 'a top title is a content frame');
   // The classifier calls most GPH pages "unknown": the title's place decides there.
   const low = structuredClone(fidelity.slides[1]);titleOf(low).geometry.y = Math.round(.4 * H);
   assert.equal(headerFrameReason(low, fidelity), 'geometry', 'a content page whose title starts below 30% of the height is a section header');
   const frames = themeFrameEligibility(fidelity);
   assert.ok(frames.eligible.includes(1) && frames.eligible.includes(2) && !frames.eligible.includes(3) && !frames.fallback, 'eligible frames: ' + JSON.stringify(frames));
   assert.ok(frames.excluded.role + frames.excluded.geometry >= 1 && frames.pages.some(page => page.templatePage === 4), 'the exclusion is counted by its reason: ' + JSON.stringify(frames.excluded));
   const p = project(), header = cardPageScore(p, 3);
   assert.ok(header >= HEADER_FRAME_COST, 'a content card on the section header costs the header frame: ' + header);
   assert.ok(cardPageScore(p, 1) < HEADER_FRAME_COST, 'a content card on a content frame does not');
   p.outline[3].cardFrame = 'divider';
   assert.ok(cardPageScore(p, 3) < HEADER_FRAME_COST, 'a divider may use a section header');
   const few = project();few.templateFidelity.sourceCatalog = [fidelity.sourceCatalog[0], fidelity.sourceCatalog[3], fidelity.sourceCatalog[4]];
   assert.ok(themeFrameEligibility(few.templateFidelity).fallback && cardPageScore(few, 3) < HEADER_FRAME_COST, 'with fewer than two frames left the section header stays a frame');
   // The header reservation runs on a page without content slots (GPH tpl39: the points ran over the title).
   const canvas = contentCanvas(project(), 3).geometry, title = titleOf(fidelity.slides[3]).geometry;
   assert.ok(canvas.y >= title.y + title.height, `the content starts below the mid-page title: ${canvas.y / IN} < ${(title.y + title.height) / IN}`);}

  // (3) A page without a section slot shows our label above its title, else under it; a section slot left empty blocks.
  {const p = project(), above = derivedSectionLabelFrame(p, 1), below = derivedSectionLabelFrame(p, 2);
   assert.equal(above?.position, 'above', 'room above the title: the label goes there');
   assert.ok(above.geometry.y + above.geometry.height <= titleOf(fidelity.slides[1]).geometry.y, 'above the title');
   assert.equal(below?.position, 'below', 'a title at the top edge: the label goes under it');
   const top = titleOf(fidelity.slides[2]).geometry, photo = fidelity.slides[2].nodes.find(node => node.type === 'image').geometry;
   assert.ok(below.geometry.y >= top.y + top.height && below.geometry.x + below.geometry.width <= photo.x, 'under the title and short of the photo: ' + JSON.stringify(below.geometry));
   assert.ok(contentCanvas(p, 2).geometry.y >= below.geometry.y + below.geometry.height, 'the content starts under the label band');
   assert.equal(derivedSectionLabelFrame(p, 3), null, 'a page with a section slot uses its slot');
   p.outline[2].cardFrame = 'divider';
   assert.equal(derivedSectionLabelFrame(p, 2), null, 'a divider keeps its title band');
   // The label is bound in the band.
   const q = project();
   q.deck.slides = q.templateFidelity.slides.map((spec, index) => ({ id: outline[index].id, title: outline[index].title, section: outline[index].section, nodes: [] }));
   normalizeDeckEyebrows(q, { onlySlideId: 'p2' });
   const label = q.deck.slides[2].nodes.find(node => node.semanticRole === 'eyebrow');
   assert.equal(label?.content?.text, 'Model Building', 'the page shows its label');
   assert.deepEqual(label.geometry, below.geometry, 'in the band under the title');
   // The gate: an unfilled section slot blocks; no slot and no band is noted.
   const page = (index, text) => ({ id: outline[index].id, cardPage: { mode: 'theme' }, nodes: text ? [{ id: 'l' + index, type: 'text', content: { text } }] : [] });
   const issues = inspectCardPageLabels(q, [page(0), page(1, 'Model Building'), page(2), page(3), page(4, 'Diagnostics')]);
   assert.deepEqual(issues.filter(issue => issue.code === 'section_label_missing').map(issue => issue.slideId), ['p3'], 'only the page whose section slot is empty blocks: ' + JSON.stringify(issues));
   assert.deepEqual(issues.filter(issue => issue.code === 'section_label_unplaced').map(issue => [issue.slideId, issue.severity]), [['p2', 'warning']], 'a page without a slot is noted');}

  // Cover A: the section slot carries a label, else the subject, never the title again.
  {const p = project(), section = String(fidelity.slides[0].slots.find(slot => slot.role === 'section').shapeId);
   let draft = deterministicCoverDraft(p, p.outline[0]);
   assert.equal(draft.slotTexts[section], 'Tutorial 10', 'the heading label fills the slot');
   p.source.text = '# World Health Report\n\nBody.';
   draft = deterministicCoverDraft(p, p.outline[0]);
   assert.ok(!(section in draft.slotTexts) && draft.omitTemplateShapes.some(item => String(item.shapeId) === section), 'a section equal to the title is left out: ' + JSON.stringify(draft.slotTexts));
   p.source.documentSubject = 'Final Project';
   assert.equal(deterministicCoverDraft(p, p.outline[0]).slotTexts[section], 'Final Project', 'a subject that differs from the title and fits fills the slot');
   // As the template sets it: one line at 20 pt in 2.63 in (live pdf-gph2: a 27-character subject wrapped into the title).
   p.source.documentSubject = 'Bilingual research tutorial';
   draft = deterministicCoverDraft(p, p.outline[0]);
   assert.ok(!(section in draft.slotTexts) && draft.omitTemplateShapes.some(item => String(item.shapeId) === section), 'a subject that does not fit is left out: ' + JSON.stringify(draft.slotTexts));
   // Label beats section beats subject when more than one fits.
   p.source.documentSubject = 'Final Project';p.outline[0].section = 'Part One';
   assert.equal(deterministicCoverDraft(p, p.outline[0]).slotTexts[section], 'Part One', 'the section before the subject');
   p.source.text = '# Tutorial 10 — World Health Report\n\nBody.';
   assert.equal(deterministicCoverDraft(p, p.outline[0]).slotTexts[section], 'Tutorial 10', 'the label before both');
   p.source.text = '# World Health Report\n\nBody.';p.outline[0].section = 'World Health Report';
   p.source.documentSubject = 'world health report';
   assert.ok(!(section in deterministicCoverDraft(p, p.outline[0]).slotTexts), 'a subject repeating the title is left out too');
   // In the deck's language only (world_models zh on Mood, 2026-11-03: the PDF's running header on a Chinese cover).
   p.outline[0].section = '';p.source.documentSubject = 'Final Project';p.generationPolicy = { ...(p.generationPolicy || {}), language: { mode: 'output', locale: 'zh-CN' } };
   assert.ok(!(section in deterministicCoverDraft(p, p.outline[0]).slotTexts), 'an English subject on a Chinese deck is left out');
   p.source.documentSubject = '期末项目';
   assert.equal(deterministicCoverDraft(p, p.outline[0]).slotTexts[section], '期末项目', 'a subject in the deck\'s language fills the slot');}

  // Cover B: a two-line title steps down until it clears the circles; then the shorter title; else it blocks.
  {const p = project(), spec = p.templateFidelity.slides[0], node = titleOf(spec), long = 'Research Objective and Closed Loop';
   const fonts = { fontFamily: 'Arial', color: '#222222' };
   const element = (item, extra = {}) => applyRenderContract({ id: item.id, kind: item.type, bounds: item.geometry, content: item.content || {}, style: { ...fonts, ...(item.style || {}) }, zIndex: Number(item.zIndex || 0), semanticRole: item.semanticRole, nativeRef: item.nativeRef, nativeTextFrame: item.nativeTextFrame, nativeStyleBaseline: item.style, ...extra });
   const hits = (text, pt) => spec.nodes.filter(item => item.type === 'shape').some(item => ['collision', 'occlusion'].includes(classifyCollision(element(node, { semanticRole: 'template-title', content: { text }, style: { ...fonts, ...node.style, fontSizePt: pt } }), element(item)).status));
   assert.ok(hits(long, 39), 'at the slot size the long title meets the circles');
   const size = coverTitleSize(p, spec, node, long);
   assert.ok([36, 32, 28].includes(size) && !hits(long, size), 'it steps down to a clear size: ' + size);
   assert.equal(coverTitleSize(p, spec, node, 'World Health Report'), 39, 'a short title keeps the slot size');
   // A circle under the first line's end: no size clears the long title; the short one clears.
   spec.nodes.find(item => item.type === 'shape').geometry = { x: Math.round(7.0 * IN), y: Math.round(2.45 * IN), width: Math.round(.34 * IN), height: Math.round(.34 * IN) };
   assert.equal(coverTitleSize(p, spec, node, long), null, 'no size on the ladder clears it');
   const draft = deterministicCoverDraft(p, p.outline[0]);
   assert.equal(draft.title, 'World Health Report', 'the cover falls to its shorter title: ' + draft.title);
   // A circle inside the first line: nothing clears; the first title stays at its size and the audit blocks it.
   spec.nodes.find(item => item.type === 'shape').geometry = { x: Math.round(2.2 * IN), y: Math.round(1.75 * IN), width: Math.round(.34 * IN), height: Math.round(.34 * IN) };
   const blocked = deterministicCoverDraft(p, p.outline[0]);
   assert.ok(!blocked.slotFonts && hits(blocked.title, 39), 'with no clear title the slot size stays and the overlap is reported');}
  // Issue 1: an uncertified picture in the content band of a page we fill is old content by position.
  {const { replaceTemplateSourceRegion } = await import('./lib/ppt-source-artifacts.mjs');
   const { templateMediaRole } = await import('./lib/ppt-template-fidelity.mjs');
   const p = project(), spec = p.templateFidelity.slides[1], strips = spec.nodes.filter(node => node.type === 'image').sort((a, b) => a.geometry.y - b.geometry.y);
   assert.equal(strips.length, 2, 'two strips in the fixture');
   assert.ok(strips.every(node => templateMediaRole(node, spec, p.templateFidelity) === 'template_artwork'), 'both are template artwork');
   const canvas = { x: Math.round(.45 * IN), y: Math.round(1.3 * IN), width: Math.round(4 * IN), height: Math.round(2 * IN) };
   const omitted = flag => {const slide = { id: 'p1', templateOmissions: [] };replaceTemplateSourceRegion(p, slide, 1, canvas, { oldContentByPosition: flag });return slide.templateOmissions;};
   const byPosition = omitted(true).filter(item => item.approvalBasis === 'old_content_by_position');
   assert.deepEqual(byPosition.map(item => item.shapeId), [strips[0].nativeRef.shapeId], 'the strip in the body band leaves; the one under the footer stays: ' + JSON.stringify(byPosition));
   assert.ok(byPosition[0].contentBandShare >= .5, 'its band share is recorded');
   assert.ok(!omitted(false).some(item => item.approvalBasis === 'old_content_by_position'), 'native and object pages keep the rule off');}

  // Issue 2: a continuation keeps its whole title when only a cut would fit the marker; its label says it continues.
  {const { fallbackCardTitle, inspectCardContinuations } = await import('./lib/ppt-card-pages.mjs');
   const { unmarkedContinuation, continuationNotes } = await import('./lib/ppt-continuation-marker.mjs');
   const { cardTitleFits } = await import('./lib/ppt-card-pages.mjs');
   const probe = project(), words = 'Start with a Research Contract Before Any Data Arrives Today'.split(' ');
   const base = words.map((_, k) => words.slice(0, k + 1).join(' ')).find(text => cardTitleFits(probe, 2, { title: text }) && !cardTitleFits(probe, 2, { title: text + ' (cont.)' }));
   assert.ok(base, 'the fixture has a title that fits only without the marker');
   const p = project();
   p.outline[1] = { ...p.outline[1], title: base };p.outline[2] = { ...p.outline[2], title: base };
   const title = fallbackCardTitle(p, 2, { title: base + ' (cont.)' });
   assert.equal(title, base, 'the whole base title, no cut and no marker: ' + title);
   assert.ok(p.titleMarkerNotes.some(note => note.code === 'continuation_marker_omitted'), 'a note says the marker moved');
   const short = project();short.outline[1] = { ...short.outline[1], title: 'Short Title' };
   assert.equal(fallbackCardTitle(short, 2, { title: 'Short Title (cont.)' }), 'Short Title (cont.)', 'a title that fits with the marker keeps it');
   assert.ok(unmarkedContinuation(p, 2), 'the page continues its card unmarked');
   p.deck.slides = p.templateFidelity.slides.map((spec, index) => ({ id: p.outline[index].id, title: p.outline[index].title, section: p.outline[index].section, nodes: [] }));
   normalizeDeckEyebrows(p, { onlySlideId: 'p2' });
   assert.equal(p.deck.slides[2].nodes.find(node => node.semanticRole === 'eyebrow')?.content?.text, 'Model Building · cont.', 'the label carries the marker');
   const pages = p.deck.slides.map((slide, index) => ({ ...slide, cardPage: { mode: 'theme' }, title: p.outline[index].title }));
   const issues = inspectCardContinuations(p, pages);
   assert.ok(!issues.some(issue => issue.code === 'continuation_marker_missing'), 'no blocking marker error: ' + JSON.stringify(issues));
   assert.ok(issues.some(issue => issue.code === 'continuation_marker_omitted' && issue.severity === 'warning' && issue.slideId === 'p2'), 'a note names the page');
   p.deck.slides[2].section = '';
   assert.deepEqual(continuationNotes(p).map(note => note.index), [2], 'without a label the speaker notes say it continues');}
  console.log('PASS template header frames: filled frames stay on the slide; section headers are no content frames (fallback kept); mid-page titles reserve their band; labels go above or under the title or block on an empty slot; the cover label never repeats its title and its title steps down, then shortens, to clear decorations');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

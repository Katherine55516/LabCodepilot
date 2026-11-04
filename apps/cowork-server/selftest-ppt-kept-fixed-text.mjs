// Fable (merge of main 9e0351cd, 2026-10-26): a template *text* the user keeps
// as fixed content survives generation unchanged, even on a page whose layout has
// a title slot at the same position. The kept-logo tests never covered text: an
// unkept large text there is the title candidate and the writer would overwrite it.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnPythonSync } from './test/ppt-local-runtime.mjs';
import { _internals as importer, projectFromImportedManifest } from './lib/ppt/import-pptx.mjs';
import { fidelityFromImported, bindTemplateFidelity, templateMediaRole, slotsFor } from './lib/ppt-template-fidelity.mjs';
import { templateDesignView } from './lib/ppt-template-design.mjs';

const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/labcodepilot/ppt-python/bin/python';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-kept-fixed-text-'));
process.env.COWORK_STATE_DIR = root;
const run = (script, input, env = {}) => { const r = spawnPythonSync(python, script, [], { input, env: { ...process.env, ...env }, maxBuffer: 50_000_000 }); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout.toString(); };
try {
  const template = path.join(root, 'template.pptx');
  // Each page uses the "Title Only" layout; a large "ACME RESEARCH" text box sits
  // exactly on the title placeholder, larger than the title itself.
  run(`from pptx import Presentation
from pptx.util import Inches, Pt
import os
p=Presentation(); p.slide_width=Inches(12); p.slide_height=Inches(6.75)
layout=p.slide_layouts[5]
for index in range(2):
    s=p.slides.add_slide(layout); title=s.shapes.title; title.text='OLD TITLE %d'%index
    title.left,title.top,title.width,title.height=Inches(.8),Inches(.5),Inches(10),Inches(1)
    title.text_frame.paragraphs[0].runs[0].font.size=Pt(28)
    brand=s.shapes.add_textbox(Inches(.8),Inches(.5),Inches(10),Inches(1)); brand.text='ACME RESEARCH'
    brand.text_frame.paragraphs[0].runs[0].font.size=Pt(40)
    body=s.shapes.add_textbox(Inches(.8),Inches(2.4),Inches(10),Inches(2)); body.text='Old body copy from the template deck about last year'
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: template });
  const bytes = fs.readFileSync(template), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const imported = projectFromImportedManifest({ id: 'kept-text', uid: 'test', title: 'Kept text' }, JSON.parse(run(importer.IMPORT_SCRIPT, bytes, { PPT_EXTERNAL_DIR: root })), hash);
  const brandIds = imported.deck.slides.map(slide => slide.nodes.find(node => node.type === 'text' && node.content?.text === 'ACME RESEARCH')?.id);
  assert.ok(brandIds.every(Boolean), 'each page imports the brand text as a node');
  const titleOf = slide => slide.nodes.find(node => node.type === 'text' && /^OLD TITLE/u.test(node.content?.text || ''));
  for (const slide of imported.deck.slides) {
    const brand = slide.nodes.find(node => brandIds.includes(node.id)), title = titleOf(slide);
    assert.deepEqual([brand.geometry.x, brand.geometry.y, brand.geometry.width, brand.geometry.height], [title.geometry.x, title.geometry.y, title.geometry.width, title.geometry.height], 'the kept text sits exactly on the title slot');
  }
  // Unkept, the larger brand text is the title candidate: the case this test guards.
  assert.equal(slotsFor(imported.deck.slides[0]).find(slot => slot.nodeId === brandIds[0])?.role, 'title', 'fixture: an unkept large text on the title position is taken as the title');

  const view = templateDesignView(imported, new Set(), new Set(brandIds), { preserveClassifiedDesign: true, roleFor: templateMediaRole });
  for (const slide of view.deck.slides) {
    const slots = slotsFor(slide), brand = slide.nodes.find(node => brandIds.includes(node.id));
    assert.equal(slots.find(slot => slot.nodeId === brand.id)?.role, 'static', 'a kept text is never a slot');
    assert.equal(slots.find(slot => slot.role === 'title')?.nodeId, titleOf(slide).id, 'the title slot is the layout title, not the kept text');
  }
  const project = { id: 'kept-text', uid: 'test', pages: 2, templateContentMode: 'keep_fixed', generationPolicy: { version: 2 },
    templateSpec: { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsiaHant: 'Noto Sans CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC' } },
    templateFidelity: fidelityFromImported({ pages: 2 }, view, hash), deck: { slides: [] } };
  project.deck.slides = project.templateFidelity.slides.map((source, index) => ({ id: `new_${index}`, title: `New title ${index + 1}`, section: 'New', bullets: ['New body'], nodes: [],
    templateSlotTexts: Object.fromEntries(source.slots.filter(slot => slot.role === 'content').map(slot => [String(slot.shapeId), 'New body text for the new deck'])) }));
  bindTemplateFidelity(project);
  for (const slide of project.deck.slides) {
    const brand = slide.nodes.find(node => node.content?.text === 'ACME RESEARCH');
    assert.ok(brand && !(slide.templateOmissions || []).some(item => item.shapeId === brand.nativeRef?.shapeId), 'the kept text stays on the generated page: ' + slide.id);
  }
  const slides = project.deck.slides.map(slide => ({ nativeSlideIndex: slide.templateSlideIndex, omitShapeIds: (slide.templateOmissions || []).map(item => item.shapeId), nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole, nativeShapeId: node.nativeRef.shapeId, content: node.content, geometry: node.geometry, style: node.style })) }));
  const output = path.join(root, 'generated.pptx');
  run(importer.EXPORT_SCRIPT, JSON.stringify({ original: template, slides, fonts: project.templateSpec.fonts, inheritedActions: project.templateFidelity.inheritedActions }), { PPT_OUTPUT: output });
  const pages = JSON.parse(run(`import json,os
from pptx import Presentation
p=Presentation(os.environ['PPT_INPUT'])
print(json.dumps([[[shape.text_frame.text,shape.left,shape.top,shape.width,shape.height,[r.font.size.pt if r.font.size else None for para in shape.text_frame.paragraphs for r in para.runs]] for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text.strip()] for slide in p.slides]))`, '', { PPT_INPUT: output }));
  pages.forEach((shapes, index) => {
    const texts = shapes.map(shape => shape[0]);
    const brand = shapes.filter(shape => shape[0] === 'ACME RESEARCH');
    assert.equal(brand.length, 1, `page ${index + 1}: the kept text appears once, unchanged: ` + JSON.stringify(texts));
    const original = imported.deck.slides[index].nodes.find(node => node.id === brandIds[index]);
    assert.deepEqual(brand[0].slice(1, 5), [original.geometry.x, original.geometry.y, original.geometry.width, original.geometry.height], `page ${index + 1}: the kept text keeps its frame`);
    assert.deepEqual(brand[0][5], [40], `page ${index + 1}: the kept text keeps its size`);
    assert.ok(texts.includes(`New title ${index + 1}`), `page ${index + 1}: the new title is written into the title slot: ` + JSON.stringify(texts));
    assert.ok(!texts.some(text => /OLD TITLE|Old body copy/u.test(text)), `page ${index + 1}: old template copy is replaced: ` + JSON.stringify(texts));
  });
  console.log('PASS kept fixed text: a kept template text on the title position survives generation unchanged; the layout title slot takes the new title');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

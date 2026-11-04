// End to end through the real native export (Fable 2026-11-02):
// G1 — a layout's certified full-bleed picture is drawn as a slide picture
// behind every object and removed from the layout (nothing drawn twice);
// G5 — a layout-only page keeps the frame's title (and eyebrow) only, declares
// every other shape it leaves out, and passes the export verification, the
// render tree and the SVG preview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { localPptRuntime } from './test/ppt-local-runtime.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-layout-only-'));
process.env.COWORK_STATE_DIR = root;
const { importEditablePptx } = await import('./lib/ppt/import-pptx.mjs');
const { prepareTemplateFidelity, bindTemplateFidelity, renderTemplatePptx, rescheduleTemplateFidelity } = await import('./lib/ppt-template-fidelity.mjs');
const { normalizePaste } = await import('./lib/ppt-source.mjs');
const { ensureProjectV3 } = await import('./lib/ppt/ir.mjs');
const { buildRenderTree } = await import('./lib/ppt/render-tree.mjs');
const { slideSvg } = await import('./lib/ppt/exporters/preview.mjs');
const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const runtime = localPptRuntime(root, python);
const run = (script, args = []) => { const r = spawnSync(python, ['-c', script, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const fixture = path.join(root, 'layout-photo.pptx');
try {
  // Four slides on one layout that carries a full-bleed photo; each slide has
  // a title, a body text and a picture of its own.
  const layout = JSON.parse(run(String.raw`
from pptx import Presentation
from pptx.util import Inches,Pt
from PIL import Image
import sys,io,json,random
p=Presentation();p.slide_width=Inches(13.333);p.slide_height=Inches(7.5)
layout=p.slide_layouts[6]
random.seed(4);im=Image.new('RGB',(320,180))
im.putdata([(random.randint(0,255),random.randint(0,255),random.randint(0,255)) for _ in range(320*180)])
buf=io.BytesIO();im.save(buf,'JPEG')
# A layout has no add_picture: place it on a scratch slide, move it to the layout, drop the slide.
scratch=p.slides.add_slide(layout);photo=scratch.shapes.add_picture(io.BytesIO(buf.getvalue()),0,0,p.slide_width,p.slide_height)
_,rid=layout.part.get_or_add_image_part(io.BytesIO(buf.getvalue()));photo._element.blipFill.blip.rEmbed=rid
layout.shapes._spTree.insert_element_before(photo._element,'p:extLst')
# A 20% navy tint above the photo, as Portfolio's cover has.
from pptx.enum.shapes import MSO_SHAPE
from lxml import etree
tint=scratch.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,0,p.slide_width,p.slide_height);tint.fill.solid();tint.fill.fore_color.rgb=__import__('pptx').dml.color.RGBColor(0x1a,0x33,0x53);tint.line.fill.background()
srgb=tint._element.spPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}solidFill/{http://schemas.openxmlformats.org/drawingml/2006/main}srgbClr');etree.SubElement(srgb,'{http://schemas.openxmlformats.org/drawingml/2006/main}alpha').set('val','20000')
layout.shapes._spTree.insert_element_before(tint._element,'p:extLst')
# Unique ids in the layout (the scratch slide's numbering would collide).
photo._element.nvPicPr.cNvPr.set('id','901');tint._element.nvSpPr.cNvPr.set('id','902')
ids=p.slides._sldIdLst;first=ids[0];p.part.drop_rel(first.rId);ids.remove(first)
photo=[sh for sh in layout.shapes if sh.shape_type==13][-1]
small=Image.new('RGB',(40,40),(200,30,30));sbuf=io.BytesIO();small.save(sbuf,'PNG')
for i in range(4):
 s=p.slides.add_slide(layout)
 for text,x,y,w,h,size in [('OLD TITLE %d'%i,.8,.4,11,.8,30),('Old body text %d'%i,.8,2,6,2,16)]:
  box=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h));box.text=text
  for para in box.text_frame.paragraphs:
   for r in para.runs:r.font.size=Pt(size);r.font.name='Arial'
 s.shapes.add_picture(io.BytesIO(sbuf.getvalue()),Inches(9),Inches(3),Inches(2),Inches(2))
p.save(sys.argv[1]);print(json.dumps({'shapeId':int(photo.shape_id),'layoutIndex':6}))
`, [fixture]));
  const bytes = fs.readFileSync(fixture), originalHash = createHash('sha256').update(bytes).digest('hex');
  const project = ensureProjectV3({ uid: 'layout-test', id: 'b'.repeat(32), title: 'Layout pictures', prompt: '', pages: 4, revision: 1, publishedRevision: 0, status: 'paused', templateMode: 'preserve', templateContentMode: 'design_only',
    templateSpec: { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Arial', bodyEastAsia: 'Arial' } }, source: normalizePaste('# New mechanism\nCurrent records are validated before release.'),
    outline: Array.from({ length: 4 }, (_, i) => ({ id: `page_${i}`, title: `New topic ${i}`, section: 'New section', keyPoints: [{ text: 'Current records are validated.' }] })), deck: { slides: Array.from({ length: 4 }, (_, i) => ({ id: `page_${i}`, title: `New topic ${i}`, section: 'New section', nodes: [] })) } });
  project.templateFidelity = await prepareTemplateFidelity(project, bytes, originalHash, null, { writeFile: runtime.writeFile, importPptx: (p, b, h) => importEditablePptx(p, b, h, runtime.io) });
  const fidelity = project.templateFidelity;
  // The readers certify the photo where OCR runs; here the certificate is set
  // so the export path is what this test checks (layoutPictureCatalog has its own test).
  const imported = await importEditablePptx({ id: project.id, uid: project.uid, title: project.title }, bytes, originalHash, runtime.io);
  const inherited = (imported.externalPptx?.inherited || []).find(item => item.kind === 'image' && item.shapeId === layout.shapeId && item.layoutIndex === layout.layoutIndex);
  assert.ok(inherited?.dataUrl, 'the importer lists the layout photo');
  const key = inherited.key, tintLayer = (imported.externalPptx?.inherited || []).find(item => item.kind === 'fill' && item.layoutIndex === layout.layoutIndex);
  assert.ok(tintLayer && Math.abs(tintLayer.opacity - .2) < .01 && tintLayer.z > inherited.z, 'the importer reads the tint above the photo: ' + JSON.stringify(tintLayer));
  const { layoutPictureCatalog } = await import('./lib/ppt-layout-pictures.mjs');
  const certified = { ...imported.externalPptx, inherited: imported.externalPptx.inherited.map(item => item.key === key ? { ...item, ocr: { status: 'ok', outcome: 'no_text' }, pixels: { continuousTone: true } } : item) };
  const promoted = Object.values(layoutPictureCatalog(certified))[0];
  assert.ok(promoted?.key === key && promoted.tints.length === 1, 'the catalog promotes the photo with its tint');
  fidelity.layoutPictures = { [key]: promoted };
  fidelity.layoutPictureBySource = fidelity.sourceCatalog.map(() => key);
  const { layoutPictureActions } = await import('./lib/ppt-layout-pictures.mjs');
  fidelity.inheritedActions = [...(fidelity.inheritedActions || []), ...layoutPictureActions({ [key]: promoted })];
  // Page 3 is layout-only.
  fidelity.layoutOnlyPages = [2];
  rescheduleTemplateFidelity(project, { scoreSlide: () => 0 });
  const spec = project.templateFidelity.slides;
  assert.ok(spec.every(slide => slide.layoutPicture === key), 'every page names its layout picture');
  assert.ok(spec[2].layoutOnly && spec[2].slots.every(slot => ['title', 'section'].includes(slot.role)) && spec[2].layoutOnlyOmitted.length >= 2, 'the layout-only page keeps its title only');
  project.deck.slides.forEach((slide, index) => { slide.templateSlotTexts = Object.fromEntries(spec[index].slots.filter(slot => slot.role !== 'static').map(slot => [String(slot.shapeId), slot.role === 'title' ? slide.title : `Current text ${index}`])); });
  bindTemplateFidelity(project);
  const third = project.deck.slides[2];
  assert.ok(third.templateOmissions.filter(item => item.approvalBasis === 'layout_only_page').length >= 2, 'the left-out shapes are declared');
  assert.ok(project.deck.slides.every(slide => slide.nodes[0]?.content?.derivedFrom === 'layout-picture' && slide.nodes[0].pinned && slide.nodes[1]?.content?.layoutTint), 'the picture, then its tint, are each page\'s first, pinned nodes');
  // Renderers: the render tree and the SVG preview draw the picture first and the page.
  const tree = buildRenderTree(project);
  assert.ok(tree.slides.every(slide => slide.elements[0]?.content?.derivedFrom === 'layout-picture' && slide.elements[0].pinned), 'the render tree puts it behind everything');
  const svg = slideSvg(tree.slides[2], project);
  assert.ok(svg.includes('<image') && svg.includes('New topic 2'), 'the preview draws the layout-only page');
  // The export: the picture is a slide picture at the back, the layout no longer carries it.
  const output = await renderTemplatePptx(project, runtime.io);
  const out = output.path || output.outputPath || output.file;
  assert.ok(out && fs.existsSync(out), 'the export is written: ' + JSON.stringify(Object.keys(output)));
  const report = JSON.parse(run(String.raw`
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import sys,json,hashlib
p=Presentation(sys.argv[1]);out={'layoutPictures':[],'slides':[]}
for layout in p.slide_layouts:
 for shape in layout.shapes:
  if shape.width>=p.slide_width*.9:out['layoutPictures'].append(layout.name)
for s in p.slides:
 shapes=list(s.shapes)
 second=shapes[1] if len(shapes)>1 else None
 out['slides'].append({'first':hashlib.sha256(shapes[0].image.blob).hexdigest() if shapes and shapes[0].shape_type==MSO_SHAPE_TYPE.PICTURE else None,'tintSecond':bool(second is not None and second.shape_type==MSO_SHAPE_TYPE.PICTURE and second.image.ext=='png'),'count':len(shapes),'texts':[sh.text_frame.text for sh in shapes if sh.has_text_frame]})
print(json.dumps(out))
`, [out]));
  assert.deepEqual(report.layoutPictures, [], 'the layout no longer draws the photo (nothing twice)');
  assert.ok(report.slides.every(slide => slide.first === inherited.imageSha256 && slide.tintSecond), 'every slide draws the photo backmost, its tint right above it: ' + JSON.stringify(report.slides.map(slide => [slide.first?.slice(0, 6), slide.tintSecond])));
  assert.ok(report.slides[2].texts.some(text => text.includes('New topic 2')) && !report.slides[2].texts.some(text => /Old body|Current text/.test(text)), 'the layout-only page shows its title, not the frame\'s body: ' + JSON.stringify(report.slides[2]));
  assert.ok(report.slides[2].count < report.slides[1].count, 'it carries fewer shapes than a full frame');
  // A covered texture (Mood-Board: a dark picture under an opaque beige
  // layer, 3222 2026-11-02) is never promoted: the page keeps its colour.
  const moodFixture = path.join(root, 'covered.pptx');
  run(String.raw`
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from PIL import Image
import sys,io,random
p=Presentation();p.slide_width=Inches(13.333);p.slide_height=Inches(7.5);layout=p.slide_layouts[6]
random.seed(7);im=Image.new('RGB',(320,180));im.putdata([(random.randint(0,60),random.randint(0,40),random.randint(0,30)) for _ in range(320*180)]);buf=io.BytesIO();im.save(buf,'JPEG')
scratch=p.slides.add_slide(layout);texture=scratch.shapes.add_picture(io.BytesIO(buf.getvalue()),0,0,p.slide_width,p.slide_height)
_,rid=layout.part.get_or_add_image_part(io.BytesIO(buf.getvalue()));texture._element.blipFill.blip.rEmbed=rid
beige=scratch.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,0,p.slide_width,p.slide_height);beige.fill.solid();beige.fill.fore_color.rgb=RGBColor(0xEC,0xF0,0xDB);beige.line.fill.background()
layout.shapes._spTree.insert_element_before(texture._element,'p:extLst');layout.shapes._spTree.insert_element_before(beige._element,'p:extLst')
texture._element.nvPicPr.cNvPr.set('id','911');beige._element.nvSpPr.cNvPr.set('id','912')
ids=p.slides._sldIdLst;first=ids[0];p.part.drop_rel(first.rId);ids.remove(first)
for i in range(3):
 s=p.slides.add_slide(layout);box=s.shapes.add_textbox(Inches(.8),Inches(.4),Inches(11),Inches(.8));box.text='OLD TITLE %d'%i
p.save(sys.argv[1])
`, [moodFixture]);
  const moodBytes = fs.readFileSync(moodFixture), moodHash = createHash('sha256').update(moodBytes).digest('hex');
  const moodImported = await importEditablePptx({ id: 'd'.repeat(32), uid: 'layout-test', title: 'Covered' }, moodBytes, moodHash, runtime.io);
  const layers = (moodImported.externalPptx.inherited || []).filter(item => ['image', 'fill'].includes(item.kind) && item.layoutIndex === 6).sort((a, b) => a.z - b.z);
  assert.deepEqual(layers.map(item => item.kind), ['image', 'fill'], 'the importer reads the texture and the beige layer above it');
  assert.equal(layers[1].fill, '#ecf0db');assert.equal(layers[1].opacity, 1);
  const forced = { ...moodImported.externalPptx, inherited: moodImported.externalPptx.inherited.map(item => item.kind === 'image' ? { ...item, ocr: { status: 'ok', outcome: 'no_text' }, pixels: { continuousTone: true } } : item) };
  assert.deepEqual(layoutPictureCatalog(forced), {}, 'even a certified texture under an opaque layer is not promoted');
  const covered = ensureProjectV3({ uid: 'layout-test', id: 'd'.repeat(32), title: 'Covered', prompt: '', pages: 3, revision: 1, publishedRevision: 0, status: 'paused', templateMode: 'preserve', templateContentMode: 'design_only',
    templateSpec: { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Arial', bodyEastAsia: 'Arial' } }, source: normalizePaste('# Covered\nText.'),
    outline: Array.from({ length: 3 }, (_, i) => ({ id: `c_${i}`, title: `Covered ${i}`, section: 'S' })), deck: { slides: Array.from({ length: 3 }, (_, i) => ({ id: `c_${i}`, title: `Covered ${i}`, section: 'S', nodes: [] })) } });
  covered.templateFidelity = await prepareTemplateFidelity(covered, moodBytes, moodHash, null, { writeFile: runtime.writeFile, importPptx: (p, b, h) => importEditablePptx(p, b, h, runtime.io) });
  assert.equal(covered.templateFidelity.layoutPictures, undefined, 'no layout picture');
  covered.deck.slides.forEach((slide, index) => { slide.templateSlotTexts = Object.fromEntries(covered.templateFidelity.slides[index].slots.filter(slot => slot.role !== 'static').map(slot => [String(slot.shapeId), slide.title])); });
  bindTemplateFidelity(covered);
  assert.ok(covered.deck.slides.every(slide => !slide.nodes.some(node => node.content?.derivedFrom === 'layout-picture')), 'no page carries a layout picture');
  const coveredOut = await renderTemplatePptx(covered, runtime.io), coveredPath = coveredOut.path || coveredOut.outputPath || coveredOut.file;
  const backdrop = JSON.parse(run(String.raw`
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import sys,json
p=Presentation(sys.argv[1]);s=p.slides[0];layout=s.slide_layout
full=[sh for sh in layout.shapes if sh.width>=p.slide_width*.9]
top=full[-1] if full else None
print(json.dumps({'layoutTop':('fill:'+str(top.fill.fore_color.rgb)) if top is not None and top.shape_type!=MSO_SHAPE_TYPE.PICTURE else 'picture' if top is not None else None,'slideFullBleed':[sh.shape_type==MSO_SHAPE_TYPE.PICTURE for sh in s.shapes if sh.width>=p.slide_width*.9]}))
`, [coveredPath]));
  assert.deepEqual(backdrop, { layoutTop: 'fill:ECF0DB', slideFullBleed: [] }, 'the exported page still shows the beige layer on top: ' + JSON.stringify(backdrop));
  console.log('PASS layout pictures and layout-only pages through the native export, the render tree and the preview; a covered texture keeps the page colour');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnPythonSync } from './test/ppt-local-runtime.mjs';
import { planTemplateSlideMap, profileTemplateSlide, visualSimilarity, maxPreservedPages, catalogTemplateLayouts, templateContentFit,
  templateReuseError, _internals } from './lib/ppt-template-scheduler.mjs';
import { _internals as importer, projectFromImportedManifest } from './lib/ppt/import-pptx.mjs';
import { fidelityFromImported, _internals as fidelityInternals } from './lib/ppt-template-fidelity.mjs';

const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-template-scheduler-'));
const run = (script, input = '', environment = {}) => {
  const result = spawnPythonSync(python, script, [], { input, env: { ...process.env, ...environment }, maxBuffer: 30_000_000 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout.toString();
};
const exportContent = node => node.type === 'image' && !node.content?.mediaReplacement
  ? Object.fromEntries(Object.entries(node.content || {}).filter(([key]) => key !== 'dataUrl')) : node.content;

try {
  for (let originals = 1; originals <= 50; originals++) {
    assert.equal(maxPreservedPages(originals), originals < 4 ? originals : originals < 8 ? originals * 3 - 4 : 100);
    for (let requested = 3; requested < originals; requested++) {
      const map = planTemplateSlideMap(originals, requested);
      assert.ok(_internals.validMap(map, originals, requested), `${originals} → ${requested}: ${map}`);
      assert.equal(new Set(map).size, requested, 'downsizing must select distinct native slides');
      assert.equal(map[0], 0, 'the cover stays first');
      assert.equal(map.at(-1), originals - 1, 'the closing page stays last');
      assert.deepEqual(planTemplateSlideMap(originals, requested), map, 'downsize mapping must be stable');
    }
    for (let requested = originals; requested <= Math.min(50, originals < 4 ? originals : originals * 3 - 4); requested++) {
      const map = planTemplateSlideMap(originals, requested);
      assert.ok(_internals.validMap(map, originals, requested), `${originals} → ${requested}: ${map}`);
      assert.deepEqual(planTemplateSlideMap(originals, requested), map, 'same input must have stable mapping');
    }
  }
  for (const originals of [8, 9, 10, 20, 34, 35, 50, 100]) {
    const profiles = Array.from({ length: originals }, (_, sourceIndex) => ({ shapeCount: 14,
      images: [{ sha: `media-${sourceIndex}`, x: .3, y: .4, area: .05 }], layout: [`source-${sourceIndex}`], palette: ['202020'] }));
    for (const requested of new Set([originals, Math.min(100, originals * 2 - 2), Math.min(100, originals * 3 - 4), 100])) {
      if (requested > maxPreservedPages(originals)) continue;
      assert.ok(_internals.validMap(planTemplateSlideMap(originals, requested, { profiles }), originals, requested), `${originals} → ${requested}`);
    }
  }
  assert.match(templateReuseError(2, 3), /最多支持 2 页/);
  assert.match(templateReuseError(3, 5), /最多支持 3 页/);
  assert.equal(templateReuseError(8, 7), '', 'template length must not override the selected page count');
  assert.deepEqual(planTemplateSlideMap(8, 7), [0, 1, 2, 3, 4, 6, 7]);
  assert.throws(() => planTemplateSlideMap(3, 4), /最多支持 3 页/);
  assert.deepEqual(planTemplateSlideMap(4, 6), [0, 1, 2, 1, 2, 3]);
  const twenty = planTemplateSlideMap(10, 20);
  assert.ok(_internals.validMap(twenty, 10, 20));
  assert.equal(Math.max(...Array.from({ length: 10 }, (_, index) => twenty.filter(source => source === index).length)), 3);
  assert.equal(twenty[0], 0);
  assert.equal(twenty.at(-1), 9);
  const base = planTemplateSlideMap(10, 15);
  const profiles = Array.from({ length: 10 }, (_, index) => ({
    layout: [`text:${index % 3}`], images: [{ sha: `picture-${index % 3}`, dhash: `000000000000000${index % 3}`, x: .5, y: .5 }],
    palette: ['202020'],
  }));
  const visual = planTemplateSlideMap(10, 15, { profiles });
  assert.ok(_internals.validMap(visual, 10, 15));
  assert.notDeepEqual(visual, base, 'visual fingerprints must influence the schedule');
  assert.ok(visualSimilarity(profiles[1], profiles[4]) > visualSimilarity(profiles[1], profiles[2]));
  assert.ok(_internals.scheduleScore(visual, 10, profiles.map((a, i) => profiles.map((b, j) => i === j ? 1 : visualSimilarity(a, b))))
    < _internals.scheduleScore(base, 10, profiles.map((a, i) => profiles.map((b, j) => i === j ? 1 : visualSimilarity(a, b)))));
  const slide = { nativeBackground: '#202020', nodes: [{ type: 'image', geometry: { x: 0, y: 0, width: 500, height: 500 },
    content: { imageSha256: 'same-image', imageDhash: '0000000000000000' } }] };
  assert.equal(visualSimilarity(profileTemplateSlide(slide, { width: 1000, height: 1000 }),
    profileTemplateSlide(slide, { width: 1000, height: 1000 })), 1);
  const directional = profileTemplateSlide({ nodes: [{ type: 'shape', geometry: { x: 10, y: 10, width: 100, height: 30 },
    nativeRef: { autoShapeType: 'RIGHT_ARROW' } }] }, { width: 1000, height: 1000 });
  assert.equal(directional.directional, true);
  const semanticProfiles = [0, 1, 2, 3].map(index => ({ shapeCount: 8, layout: [`layout-${index}`], palette: ['202020'],
    images: index === 1 ? [{ sha: 'photo', x: .5, y: .5, area: .1 }] : [],
    directional: index === 2, semantic: { contentSlots: index === 1 ? 4 : 1, listItems: 0,
      totalVisualCapacity: 80, semanticUnitCapacity: index === 1 ? 4 : 1 } }));
  const semanticCatalog = catalogTemplateLayouts(semanticProfiles);
  assert.equal(semanticCatalog[2].maxUses, 1, 'directional artwork without an image cannot be reused safely');
  assert.ok(templateContentFit(semanticCatalog[1], { role: 'evidence', semanticUnitBudget: 4 }) <
    templateContentFit(semanticCatalog[2], { role: 'evidence', semanticUnitBudget: 4 }));
  assert.deepEqual(planTemplateSlideMap(4, 5, { profiles: semanticProfiles }).filter(index => index === 2).length, 1);
  assert.throws(() => planTemplateSlideMap(4, 6, { profiles: semanticProfiles }), /安全的原生版式容量/);
  const panelSlide = { nodes: [
    { type: 'text', geometry: { x: 40, y: 35, width: 800, height: 70 }, style: { fontSizePt: 30 },
      content: { text: 'Panel title' }, nativeRef: { shapeId: 1 } },
    { type: 'image', geometry: { x: 60, y: 250, width: 350, height: 250 }, content: { imageSha256: 'a' }, nativeRef: { shapeId: 2 } },
    { type: 'text', geometry: { x: 90, y: 295, width: 290, height: 80 }, style: { fontSizePt: 16 },
      content: { text: 'First card' }, nativeRef: { shapeId: 3 } },
    { type: 'image', geometry: { x: 560, y: 250, width: 350, height: 250 }, content: { imageSha256: 'b' }, nativeRef: { shapeId: 4 } },
    { type: 'text', geometry: { x: 590, y: 295, width: 290, height: 80 }, style: { fontSizePt: 16 },
      content: { text: 'Second card' }, nativeRef: { shapeId: 5 } },
  ] };
  const panels = fidelityInternals.panelSwapGeometry(panelSlide, { width: 1000, height: 800 });
  assert.ok(panels, 'two independent cards should support a native derived layout');
  assert.equal(panels[1].x, 560);
  assert.equal(panels[2].x, 590);
  assert.ok(fidelityInternals.profileSourceSlide(panelSlide, { width: 1000, height: 800 }).safeGeometryModes.includes('panel-swap'));

  const fixture = path.join(directory, 'template.pptx');
  const output = path.join(directory, 'output.pptx');
  run(`from pptx import Presentation
from pptx.util import Inches,Pt
from PIL import Image
import io,os
p=Presentation(); p.slide_width=Inches(12); p.slide_height=Inches(6.75)
for number in range(10):
 s=p.slides.add_slide(p.slide_layouts[6])
 title=s.shapes.add_textbox(Inches(.7),Inches(.5),Inches(9),Inches(.8)); title.text='原始标题 '+str(number)
 title.text_frame.paragraphs[0].runs[0].font.size=Pt(30)
 body=s.shapes.add_textbox(Inches(1),Inches(1.7),Inches(7),Inches(1)); body.text='原始内容 '+str(number)
 image=Image.new('RGB',(800,640),(30+number*18,50+number*10,80+number*8))
 buffer=io.BytesIO(); image.save(buffer,format='PNG'); buffer.seek(0)
 s.shapes.add_picture(buffer,Inches(8),Inches(2),width=Inches(4),height=Inches(3.2))
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: fixture });
  const bytes = fs.readFileSync(fixture);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.parse(run(importer.IMPORT_SCRIPT, bytes, { PPT_EXTERNAL_DIR: directory }));
  const imported = projectFromImportedManifest({ id: 'schedule', uid: 'test', title: 'Schedule' }, manifest, hash);
  assert.ok(imported.deck.slides[0].nodes.some(node => node.content?.imageDhash), 'image perceptual hash must be imported');
  const fidelity = fidelityFromImported({ pages: 15 }, imported, hash);
  assert.ok(_internals.validMap(fidelity.slideMap, 10, 15));
  assert.equal(fidelity.reusePlan.repeatedPages, 5);
  assert.equal(fidelity.reusePlan.maxSourceUse, 2);
  assert.equal(fidelity.reusePlan.visualSimilarityPairs.length, 14);
  const slides = fidelity.slides.map((spec, index) => ({ nativeSlideIndex: index,
    nodes: spec.nodes.map(node => ({ type: node.type, nativeShapeId: node.nativeRef.shapeId,
      content: node.type === 'text' ? { text: `生成内容 ${index}` } : exportContent(node),
      geometry: node.geometry, style: node.style })) }));
  const exported = JSON.parse(run(importer.EXPORT_SCRIPT, JSON.stringify({ original: fixture, sourceSlideMap: fidelity.slideMap, slides,
    fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' } }), { PPT_OUTPUT: output }));
  assert.equal(exported.slides, 15);
  run(`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import hashlib,json,os
original=Presentation(os.environ['PPT_INPUT']); result=Presentation(os.environ['PPT_OUTPUT'])
mapping=json.loads(os.environ['PPT_MAP'])
assert len(result.slides)==len(mapping)==15
for index,source in enumerate(mapping):
 a=original.slides[source]; b=result.slides[index]
 assert len(a.shapes)==len(b.shapes)
 before=[hashlib.sha256(s.image.blob).hexdigest() for s in a.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]
 after=[hashlib.sha256(s.image.blob).hexdigest() for s in b.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]
 assert before==after
 assert any('生成内容 '+str(index) in s.text for s in b.shapes if s.has_text_frame)`, '',
  { PPT_INPUT: fixture, PPT_OUTPUT: output, PPT_MAP: JSON.stringify(fidelity.slideMap) });
  const twentyFidelity = fidelityFromImported({ pages: 20 }, imported, hash);
  assert.ok(_internals.validMap(twentyFidelity.slideMap, 10, 20));
  assert.equal(twentyFidelity.reusePlan.maxSourceUse, 3);
  assert.equal(twentyFidelity.reusePlan.adjacentSameSource, 0);
  const firstUse = new Set();
  for (const spec of twentyFidelity.slides) {
    if (!firstUse.has(spec.sourceIndex)) { firstUse.add(spec.sourceIndex); assert.equal(spec.variantId, 'original'); continue; }
    assert.match(spec.variantId, /^(content-mirror|title-content-mirror|panel-swap|media-focus)-/);
    const original = twentyFidelity.slides.find(item => item.sourceIndex === spec.sourceIndex);
    assert.ok(spec.nodes.some((node, i) => node.geometry.x !== original.nodes[i].geometry.x ||
      JSON.stringify(node.content?.crop) !== JSON.stringify(original.nodes[i].content?.crop)),
    'every reused slide must change safe native geometry or media focus');
    if (spec.variant.kind === 'media-focus') assert.ok(spec.nodes.filter(node => node.type === 'text')
      .every(node => node.geometry.x === original.nodes.find(item => item.nativeRef.shapeId === node.nativeRef.shapeId).geometry.x),
    'media focus must not separate an image from its text labels');
  }
  const suppliedImage = imported.deck.slides[0].nodes.find(node => node.type === 'image').content.dataUrl;
  const lowResolution = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
  const lowMediaFidelity = fidelityFromImported({ pages: 15, source: { images: [{ id: 'tiny', dataUrl: lowResolution }] } }, imported, hash);
  assert.ok(lowMediaFidelity.slides.every(slide => !slide.variant.mediaShapeId), 'low-resolution media must not replace a large native picture');
  const ambiguousMediaFidelity = fidelityFromImported({ pages: 15, source: { images: [
    { id: 'one', dataUrl: suppliedImage }, { id: 'two', dataUrl: suppliedImage },
  ] } }, imported, hash);
  assert.ok(ambiguousMediaFidelity.slides.every(slide => !slide.variant.mediaShapeId), 'multiple uncaptioned images must not be placed arbitrarily');
  const mediaFidelity = fidelityFromImported({ pages: 15, source: { images: [{ id: 'user-image', dataUrl: suppliedImage }] } }, imported, hash);
  assert.ok(mediaFidelity.slides.every(slide => !slide.variant.mediaShapeId), 'inline content media must not be replaced as decoration');
  const decorative = structuredClone(imported);
  for (const slide of decorative.deck.slides) {
    const image = slide.nodes.find(node => node.type === 'image'); image.geometry = { x: 0, y: 0, width: decorative.externalPptx.width, height: decorative.externalPptx.height };
  }
  const decorativeFidelity = fidelityFromImported({ pages: 15, source: { images: [{ id: 'user-image', dataUrl: suppliedImage }] } }, decorative, hash);
  const replaced = decorativeFidelity.slides.find(slide => slide.variant.mediaShapeId);
  assert.ok(replaced, 'a large native picture on a reused slide can use supplied media');
  assert.equal(replaced.nodes.find(node => node.nativeRef.shapeId === replaced.variant.mediaShapeId).content.mediaReplacement, true);
  const mediaOutput = path.join(directory, 'output-media.pptx');
  run(importer.EXPORT_SCRIPT, JSON.stringify({ original: fixture, sourceSlideMap: decorativeFidelity.slideMap,
    slides: decorativeFidelity.slides.map((spec, index) => ({ nativeSlideIndex: index,
      nodes: spec.nodes.map(node => ({ type: node.type, nativeShapeId: node.nativeRef.shapeId,
        content: node.type === 'text' ? { text: `生成内容 ${index}` } : exportContent(node),
        geometry: node.geometry, style: node.style })) })),
    fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' } }), { PPT_OUTPUT: mediaOutput });
  run(`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import hashlib,os
p=Presentation(os.environ['PPT_INPUT']); slide=p.slides[int(os.environ['PPT_SLIDE'])]
image=next(shape for shape in slide.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE)
assert hashlib.sha256(image.image.blob).hexdigest()==os.environ['PPT_HASH']`, '',
  { PPT_INPUT: mediaOutput, PPT_SLIDE: String(replaced.index), PPT_HASH: replaced.variant.imageSha256 });
  const hundredFidelity = fidelityFromImported({ pages: 100 }, imported, hash);
  assert.equal(hundredFidelity.slideMap.length, 100);
  assert.ok(_internals.validMap(hundredFidelity.slideMap, 10, 100));
  assert.equal(hundredFidelity.slideMap.filter((source, index, map) => index >= 3 &&
    source === map[index - 2] && map[index - 1] === map[index - 3]).length, 0,
  'semantic scheduling must not cycle two source layouts');
  assert.equal(hundredFidelity.slides.filter(slide => slide.variantId !== 'original').length > 50, true);
  assert.ok(hundredFidelity.slides.some(slide => slide.nodes.some(node => node.type === 'image' && node.content.crop.some(Boolean))));
  const denseProfiles = [3, 17, 14, 37, 37, 31, 15, 17, 18, 12].map((shapeCount, sourceIndex) => ({
    shapeCount, layout: [`source-${sourceIndex}`], palette: ['202020'],
    images: [{ sha: `media-${sourceIndex}`, x: .4, y: .5, area: .02 }],
  }));
  const lowPlan = planTemplateSlideMap(10, 100, { profiles: denseProfiles,
    outline: Array.from({ length: 100 }, () => ({ semanticUnitBudget: 3 })) });
  const highPlan = planTemplateSlideMap(10, 100, { profiles: denseProfiles,
    outline: Array.from({ length: 100 }, () => ({ semanticUnitBudget: 9 })) });
  assert.notDeepEqual(lowPlan, highPlan, 'long scheduling must respond to outline density');
  assert.ok(lowPlan.every((source, index) => index === 0 || source !== lowPlan[index - 1]));
  assert.ok(lowPlan.filter((source, index) => index > 1 && source === lowPlan[index - 2]).length <= 2,
    'long scheduling should avoid a repeated two-slide visual cycle');
  assert.ok(lowPlan.filter(source => [3, 4, 5].includes(source)).length < 30,
    'component-heavy source pages should be reused less often');
  assert.throws(() => planTemplateSlideMap(10, 100, { profiles: denseProfiles.map(profile => ({ ...profile, images: [] })) }),
    /受控版式变体最多支持/, 'templates without reusable media should fail with a concrete capacity');
  const twentyOutput = path.join(directory, 'output-20.pptx');
  const twentySlides = twentyFidelity.slides.map((spec, index) => ({ nativeSlideIndex: index,
    nodes: spec.nodes.map(node => ({ type: node.type, nativeShapeId: node.nativeRef.shapeId,
      content: node.type === 'text' ? { text: `生成内容 ${index}` } : exportContent(node),
      geometry: node.geometry, style: node.style })) }));
  run(importer.EXPORT_SCRIPT, JSON.stringify({ original: fixture, sourceSlideMap: twentyFidelity.slideMap, slides: twentySlides,
    fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' } }),
  { PPT_OUTPUT: twentyOutput });
  run(`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import hashlib,json,os
a=Presentation(os.environ['PPT_INPUT']); b=Presentation(os.environ['PPT_OUTPUT']); mapping=json.loads(os.environ['PPT_MAP']); positions=json.loads(os.environ['PPT_POS'])
assert len(b.slides)==len(mapping)==20
for index,source in enumerate(mapping):
 left=a.slides[source]; right=b.slides[index]
 assert len(left.shapes)==len(right.shapes)
 assert [int(shape.left) for shape in right.shapes]==positions[index]
 assert [hashlib.sha256(s.image.blob).hexdigest() for s in left.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]==[hashlib.sha256(s.image.blob).hexdigest() for s in right.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]`, '',
  { PPT_INPUT: fixture, PPT_OUTPUT: twentyOutput, PPT_MAP: JSON.stringify(twentyFidelity.slideMap),
    PPT_POS: JSON.stringify(twentyFidelity.slides.map(spec => spec.nodes.map(node => node.geometry.x))) });
  const hundredOutput = path.join(directory, 'output-100.pptx');
  run(importer.EXPORT_SCRIPT, JSON.stringify({ original: fixture, sourceSlideMap: hundredFidelity.slideMap,
    slides: hundredFidelity.slides.map((spec, index) => ({ nativeSlideIndex: index,
      nodes: spec.nodes.map(node => ({ type: node.type, nativeShapeId: node.nativeRef.shapeId,
      content: node.type === 'text' ? { text: `生成内容 ${index}` } : exportContent(node),
        geometry: node.geometry, style: node.style })) })),
    fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' } }), { PPT_OUTPUT: hundredOutput });
  run(`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import hashlib,json,os
a=Presentation(os.environ['PPT_INPUT']); b=Presentation(os.environ['PPT_OUTPUT']); mapping=json.loads(os.environ['PPT_MAP'])
assert len(b.slides)==len(mapping)==100
for index,source in enumerate(mapping):
 left=a.slides[source]; right=b.slides[index]
 assert len(left.shapes)==len(right.shapes)
 assert [hashlib.sha256(s.image.blob).hexdigest() for s in left.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]==[hashlib.sha256(s.image.blob).hexdigest() for s in right.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]
 assert any('生成内容 '+str(index) in s.text for s in right.shapes if s.has_text_frame)
assert any(any(shape.crop_left or shape.crop_right or shape.crop_top or shape.crop_bottom for shape in slide.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE) for slide in list(b.slides)[26:])`, '',
  { PPT_INPUT: fixture, PPT_OUTPUT: hundredOutput, PPT_MAP: JSON.stringify(hundredFidelity.slideMap) });
  const four = fidelityFromImported({ pages: 6 }, { ...imported, deck: { slides: imported.deck.slides.slice(0, 4) } }, hash);
  assert.ok(_internals.validMap(four.slideMap, 4, 6));
  console.log('PPT template reuse scheduling, visual diversity, 10→15/20/100 native export: OK');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

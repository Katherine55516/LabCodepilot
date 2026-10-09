import { scopeReview, simulatedExport } from './ppt-scope-test-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-m4-'));
process.env.COWORK_STATE_DIR = root;
const [{ handlePpt, _internals }, store, { normalizeBlocks, normalizeSourceImages }, render, pdf] = await Promise.all([
  import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs'), import('./lib/ppt-blocks.mjs'), import('./lib/ppt-render.mjs'), import('./lib/ppt-pdf.mjs'),
]);
const id = store.newId();
const uid = 'alice';
const python = process.env.PPT_TEST_PYTHON || 'python3';
const png = spawnSync(python, ['-c', "import io,base64; from PIL import Image; b=io.BytesIO(); Image.new('RGB',(8,8),'red').save(b,'PNG'); print(base64.b64encode(b.getvalue()).decode())"]);
assert.equal(png.status, 0, png.stderr.toString());
const image = 'data:image/png;base64,' + png.stdout.toString().trim();
const blocks = [
  { id: 'img', type: 'image', dataUrl: image, caption: 'Photo' },
  { id: 'chart', type: 'chart', chartType: 'bar', labels: ['A', 'B'], values: [2, 5], unit: '%' },
  { id: 'table', type: 'table', rows: [['Name', 'Value'], ['A', '2']] },
  { id: 'shape', type: 'shape', shape: 'ellipse', fill: '#6877c8', text: 'Action' },
];
const outline = Array.from({ length: 3 }, (_, i) => ({ id: String(i + 1), title: `Slide ${i + 1}`, focus: 'Facts', refs: [] }));
const slides = [
  { id: '1', title: 'Slide 1', bullets: ['Fact'], blocks: blocks.slice(0, 2), layout: 'visual-first' },
  { id: '2', title: 'Slide 2', bullets: [], blocks: blocks.slice(2) },
  { id: '3', title: 'Slide 3', bullets: ['Closing'], blocks: [] },
];
let renders = 0;
const deps = { modelCall: async (project, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(project) : prompt.includes('演示文稿叙事规划器')
  ? { slides: Array.from({ length: project.pages }, (_, index) => ({ title: `Pasted ${index + 1}`, focus: 'Source facts', refs: ['1'],sourceImageIds:index>0?[project.source.images[index-1]?.id].filter(Boolean):[] })) }
  : prompt.includes('视觉元素') ? { text: 'Better label' } : { title: 'Rewritten', bullets: ['Verified text'] },
renderPptx: async project => {
 renders++; return simulatedExport(project); }, renderPdf: async project => simulatedExport(project) };
async function request(method, pathname, data, as = uid) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${pathname}`), { uid: as, deps, activity: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
  return result;
}
async function settled(projectId, status) {
  for (let index = 0; index < 100; index++) {
    const project = store.get(uid, projectId);
    if (project?.status === status) return project;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const latest = store.get(uid, projectId);
  throw new Error(`${projectId} did not reach ${status}: ${latest?.status}/${latest?.stage} ${latest?.error || ''}`);
}
try {
  assert.equal(normalizeBlocks(blocks.slice(0, 2)).length, 2);
  assert.throws(() => normalizeBlocks([{ ...blocks[1], values: [2, Number.NaN] }]));
  assert.throws(() => normalizeBlocks([{ ...blocks[0], dataUrl: 'data:image/png;base64,YWJj' }]));
  assert.throws(() => normalizeBlocks([blocks[0], blocks[1], blocks[2]]));
  assert.equal(normalizeSourceImages([blocks[0]]).length, 1);
  assert.throws(() => normalizeSourceImages(Array.from({ length: 5 }, (_, index) => ({ ...blocks[0], id: `too-many-${index}` }))));
  const deck = _internals.normalizeDeck({ slides }, outline);
  store.save({ id, uid, title: 'M4 deck', prompt: 'Facts', pages: 3, template: 'violet', templateSpec: null,
    status: 'completed', outline, deck, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  assert.equal((await request('GET', '/ppt/projects')).body.projects[0].deck.slides[0].blocks, undefined);
  assert.equal((await request('PATCH', `/ppt/projects/${id}`, { slides, revision: 0 })).status, 200);
  assert.equal((await request('PATCH', `/ppt/projects/${id}`, { slides: [{ ...slides[0], blocks: [{ ...blocks[1], values: [1] }] }, ...slides.slice(1)], revision: 1 })).status, 400);
  assert.equal((await request('POST', `/ppt/projects/${id}/rewrite`, { slideId: '1', instruction: 'Shorten the text', revision: 1 })).status, 200);
  assert.equal(store.get(uid, id).deck.slides[0].title, 'Rewritten');
  assert.deepEqual(store.get(uid, id).deck.slides[0].blocks.map(({ assetId, assetHash, ...block }) => block), blocks.slice(0, 2));
  assert.ok(store.get(uid, id).deck.slides[0].blocks[0].assetHash, 'images retain their server-owned asset binding');
  assert.equal((await request('POST', `/ppt/projects/${id}/rewrite`, { slideId: '1', instruction: 'Again', revision: 1 })).status, 409);
  assert.equal((await request('PATCH', `/ppt/projects/${id}`, { template: 'light', revision: 2 })).status, 200);
  assert.equal(store.get(uid, id).template, 'light');
  assert.equal((await request('PATCH', `/ppt/projects/${id}`, { slidePatches: [{ ...store.get(uid, id).deck.slides[1], title: 'Patched only' }], revision: 3 })).status, 200);
  assert.equal(store.get(uid, id).deck.slides[1].title, 'Patched only');
  assert.equal((await request('POST', `/ppt/projects/${id}/rewrite`, { slideId: '2', blockId: 'shape', instruction: 'Shorten label', revision: 4 })).status, 200);
  assert.equal(store.get(uid, id).deck.slides[1].blocks[1].text, 'Better label');
  assert.equal((await request('POST', `/ppt/projects/${id}/rewrite`, { slideId: '1', instruction: 'Again', revision: 5 }, 'bob')).status, 404);
  const pasted = await request('POST', '/ppt/projects', { inputKind: 'paste', text: 'Facts with screenshots', pages: 3, configId: 'test', images: [blocks[0], { ...blocks[0], id: 'img-2', caption: 'Second' }] });
  assert.equal(pasted.status, 201);
  let pastedProject = await settled(pasted.body.project.id, 'outline_ready');
  assert.equal(pastedProject.source.images.length, 2);
  assert.equal((await request('PATCH', `/ppt/projects/${pastedProject.id}/source`, { text: 'Updated facts with screenshots', sourceRevision: pastedProject.sourceRevision })).status, 202);
  pastedProject = await settled(pastedProject.id, 'outline_ready');
  assert.equal(pastedProject.source.images.length, 2);
  assert.equal((await request('POST', `/ppt/projects/${pastedProject.id}/generate`)).status, 202);
  pastedProject = await settled(pastedProject.id, 'completed');
  assert.equal(pastedProject.quality.objectLedger.fulfilledCount,2,'all attached source images and their captions must remain visible');
  assert.notEqual(pastedProject.deck.slides[1].layout, 'visual-first');
  assert.equal(pastedProject.deck.slides[0].blocks.length, 0);
  assert.equal(renders, 1, 'draft mutations do not implicitly publish');

  const output = path.join(root, 'rich.pptx');
  const fonts = { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' };
  const rendered = spawnSync(python, ['-c', render._internals.SCRIPT], { input: JSON.stringify({ slides, template: 'violet', fonts }), env: { ...process.env, PPT_OUTPUT: output }, maxBuffer: 2_000_000 });
  assert.equal(rendered.status, 0, rendered.stderr.toString());
  assert.ok(JSON.parse(rendered.stdout).fontResolution.every(font => font.glyphCoverage === 'verified'));
  const inspected = spawnSync(python, ['-c', `import re
from zipfile import ZipFile
from pptx import Presentation
p=Presentation(${JSON.stringify(output)})
fonts={run.font.name for slide in p.slides for shape in slide.shapes if hasattr(shape, 'text_frame') for para in shape.text_frame.paragraphs for run in para.runs}
with ZipFile(${JSON.stringify(output)}) as z:
  negative=sum(len(re.findall(r'<c:(?:axId|crossAx) val="-\\d+"', z.read(name).decode())) for name in z.namelist() if name.startswith('ppt/charts/chart') and name.endswith('.xml'))
print(len(p.slides), sum(s.shape_type==13 for slide in p.slides for s in slide.shapes), sum(s.has_chart for slide in p.slides for s in slide.shapes), sum(s.has_table for slide in p.slides for s in slide.shapes), negative, bool(fonts))`]);
  assert.equal(inspected.status, 0, inspected.stderr.toString());
  assert.match(inspected.stdout.toString(), /3 1 1 1 0 True/);
  if (process.env.PPT_M4_PYTHONPATH) {
    const pdfOutput = path.join(root, 'rich.pdf');
    const pdfRender = spawnSync(python, ['-c', pdf._internals.SCRIPT], { input: JSON.stringify({ slides, template: 'violet', fonts }), env: { ...process.env, PYTHONPATH: process.env.PPT_M4_PYTHONPATH, PPT_OUTPUT: pdfOutput }, maxBuffer: 2_000_000 });
    assert.equal(pdfRender.status, 0, pdfRender.stderr.toString());
    const check = spawnSync(python, ['-c', `from pypdf import PdfReader; p=PdfReader(${JSON.stringify(pdfOutput)}); print(len(p.pages))`]);
    assert.equal(check.status, 0, check.stderr.toString());
    assert.equal(check.stdout.toString().trim(), '3');
  }
  console.log(`PPT M4 blocks, local rewrite, theme rerender and editable PPTX elements${process.env.PPT_M4_PYTHONPATH ? ' plus PDF output' : ''}: OK`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }

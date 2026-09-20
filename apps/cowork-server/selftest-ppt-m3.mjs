import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-m3-'));
process.env.COWORK_STATE_DIR = root;
const [{ handlePpt }, store, templates, render] = await Promise.all([
  import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs'), import('./lib/ppt-template.mjs'), import('./lib/ppt-render.mjs'),
]);
const uid = 'alice';
let renderCalls = 0;
const deps = {
  modelCall: async (project, prompt) => {
    if (prompt.includes('版本更新规划器') && !project.update.baseSnapshot.deck) return { slides: Array.from({ length: project.pages }, (_, i) => ({ title: `Imported ${i + 1}`, focus: 'New facts', change: 'add', refs: ['U1'] })) };
    if (prompt.includes('版本更新规划器')) return { slides: [
      { title: 'Base 1', focus: 'Base 1', baseSlideId: project.update.baseSnapshot.deck.slides[0].id, change: 'keep', refs: [] },
      { title: 'Revised 2', focus: 'New facts', baseSlideId: project.update.baseSnapshot.deck.slides[1].id, change: 'rewrite', refs: ['U1'] },
      { title: 'Base 3', focus: 'Base 3', baseSlideId: project.update.baseSnapshot.deck.slides[2].id, change: 'keep', refs: [] },
      ...Array.from({ length: project.pages - 3 }, (_, i) => ({ title: `New ${i + 1}`, focus: 'Latest progress', change: 'add', refs: ['U1'] })),
    ] };
    if (prompt.includes('叙事规划器')) return { slides: Array.from({ length: project.pages }, (_, i) => ({ title: `Base ${i + 1}`, focus: `Base ${i + 1}` })) };
    if (prompt.includes('当前任务只写第')) return { title: `Base ${prompt.match(/当前任务只写第 (\d+) 页/)?.[1]}`, bullets: ['Original fact'] };
    return { title: 'Generated update', bullets: ['Latest fact'] };
  },
  renderPptx: async project => { renderCalls++; return { bytes: project.deck.slides.length * 100 }; },
  renderPdf: async () => ({ bytes: 100 }),
  extractFile: async (_project, name, bytes) => ({ kind: 'file', name, text: bytes.toString(), segments: [{ id: '1', location: 'page 1', text: bytes.toString() }] }),
  analyzeTemplate: async (_uid, _id, extension) => extension === 'pdf'
    ? { compatibility: 'reference', reason: 'PDF reference only', pages: 2, palette: null, sampleTitles: ['Reference'] }
    : { compatibility: 'mapped', reason: 'Color and font mapping', pages: 2, palette: { background: '#112233', accent: '#ddaa22', foreground: '#ffffff', muted: '#cccccc' },
      fonts: { title: 'Brand Sans', body: 'Brand Text', titleEastAsia: 'Brand Sans SC', bodyEastAsia: 'Brand Text SC', cjkExplicit: true }, sampleTitles: ['Source'] },
  removeContainer: async () => {},
  readFile: async () => ({ stream: Readable.from([]), size: 0 }),
};
async function request(method, pathname, data, as = uid) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${pathname}`), { uid: as, deps, activity: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
  return result;
}
async function settled(id, status) {
  for (let i = 0; i < 100; i++) {
    const project = store.get(uid, id);
    if (project?.status === status) return project;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${id} did not reach ${status}`);
}
try {
  assert.equal((await request('PATCH', '/ppt/templates/violet', { pinned: true })).body.template.pinned, true);
  assert.equal((await request('GET', '/ppt/templates')).body.templates[0].id, 'violet');
  const templateUpload = await request('POST', '/ppt/templates', { fileName: 'brand.pptx', fileBase64: Buffer.from('PKexample').toString('base64') });
  assert.equal(templateUpload.status, 201);
  const custom = templateUpload.body.template;
  assert.equal(custom.compatibility, 'mapped');
  assert.equal((await request('GET', '/ppt/templates?category=我的模板')).body.templates.length, 1);
  assert.equal((await request('GET', '/ppt/templates?category=我的模板', undefined, 'bob')).body.templates.length, 0);
  assert.equal((await request('PATCH', `/ppt/templates/${custom.id}`, { pinned: true })).body.template.pinned, true);
  const reference = await request('POST', '/ppt/templates', { fileName: 'reference.pdf', fileBase64: Buffer.from('%PDF-1.4\n').toString('base64') });
  assert.equal(reference.body.template.compatibility, 'reference');
  assert.equal((await request('POST', '/ppt/projects', { prompt: 'Bad template', pages: 3, configId: 'test', template: reference.body.template.id })).status, 400);

  const baseCreate = await request('POST', '/ppt/projects', { prompt: 'Base presentation', pages: 3, configId: 'test' });
  const baseId = baseCreate.body.project.id;
  await settled(baseId, 'outline_ready');
  assert.equal((await request('POST', `/ppt/projects/${baseId}/generate`)).status, 202);
  const base = await settled(baseId, 'completed');
  const oldDeck = structuredClone(base.deck);
  const updateInput = { baseProjectId: baseId, progressKind: 'paste', progressText: 'Latest fact', template: custom.id, pages: 6, configId: 'test', requestId: 'same-update-request' };
  const updateCreate = await request('POST', '/ppt/updates', updateInput);
  assert.equal(updateCreate.status, 201);
  const nextId = updateCreate.body.project.id;
  assert.equal((await request('POST', '/ppt/updates', updateInput)).body.project.id, nextId);
  assert.equal((await request('POST', '/ppt/updates', { ...updateInput, progressText: 'Different facts' })).status, 409);
  assert.equal((await request('POST', '/ppt/updates', { ...updateInput, requestId: 'bad-request', pages: 5 })).status, 400);
  let next = await settled(nextId, 'outline_ready');
  assert.deepEqual(next.diff, { kept: 2, rewritten: 1, added: 3, removed: [] });
  assert.equal(next.version.parentId, baseId);
  assert.equal(next.version.number, 2);
  assert.equal(next.folderId, base.folderId);
  assert.equal((await request('GET', `/ppt/projects/${nextId}/versions`)).body.versions.length, 2);
  assert.equal((await request('GET', `/ppt/projects/${nextId}`, undefined, 'bob')).status, 404);
  assert.equal((await request('PATCH', `/ppt/projects/${nextId}/outline`, { slides: next.outline.map((s, i) => i === 3 ? { ...s, title: 'Edited new page' } : s) })).status, 200);
  assert.equal((await request('POST', `/ppt/projects/${nextId}/generate`)).status, 202);
  next = await settled(nextId, 'completed');
  assert.equal(next.deck.slides.length, 6);
  assert.equal(next.nodes[next.outline[0].id].attempts, 0);
  assert.equal(next.nodes[next.outline[2].id].attempts, 0);
  assert.equal(next.deck.slides[0].title, oldDeck.slides[0].title);
  assert.equal(next.deck.slides[1].title, 'Generated update');
  assert.deepEqual(store.get(uid, baseId).deck, oldDeck);
  assert.equal(next.templateSpec.palette.accent, '#ddaa22');
  assert.equal(renderCalls, 2);
  assert.equal((await request('DELETE', `/ppt/templates/${custom.id}`)).status, 200);
  assert.equal(store.get(uid, nextId).templateSpec.palette.accent, '#ddaa22');

  const uploaded = await request('POST', '/ppt/updates', { baseFileName: 'old.pdf', baseFileBase64: Buffer.from('%PDF-base').toString('base64'),
    progressKind: 'file', progressFileName: 'changes.md', progressFileBase64: Buffer.from('New figures').toString('base64'),
    template: 'blue', pages: 6, configId: 'test' });
  assert.equal(uploaded.status, 201);
  const uploadId = uploaded.body.project.id;
  const parsed = await settled(uploadId, 'outline_ready');
  assert.match(parsed.source.text, /%PDF-base/);
  assert.match(parsed.source.text, /New figures/);
  assert.equal(parsed.update.baseSnapshot.source.name, 'old.pdf');
  assert.equal(store.readInput(uid, uploadId, 'progress').toString(), 'New figures');

  const python = '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
  const pptx = spawnSync(python, ['-c', `import io,base64
from pptx import Presentation
from pptx.util import Inches
from pptx.dml.color import RGBColor
p=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=RGBColor(17,34,51)
shape=s.shapes.add_shape(1, Inches(0), Inches(0), Inches(2), Inches(1));shape.fill.solid();shape.fill.fore_color.rgb=RGBColor(221,170,34)
print(base64.b64encode((lambda b: (p.save(b),b.getvalue())[1])(io.BytesIO())).decode())`], { maxBuffer: 2_000_000 });
  assert.equal(pptx.status, 0, pptx.stderr.toString());
  const analyzed = spawnSync(python, ['-c', templates._internals.SCRIPT], { input: Buffer.from(pptx.stdout.toString().trim(), 'base64'), env: { ...process.env, PPT_TEMPLATE_EXT: 'pptx' } });
  assert.equal(analyzed.status, 0, analyzed.stderr.toString());
  assert.equal(JSON.parse(analyzed.stdout).palette.accent, '#ddaa22');
  const renamedPotx = Buffer.from(pptx.stdout.toString().trim(), 'base64');
  assert.equal(templates.validateTemplate('brand.potx', renamedPotx), 'potx');
  const potxAnalysis = spawnSync(python, ['-c', templates._internals.SCRIPT], { input: renamedPotx, env: { ...process.env, PPT_TEMPLATE_EXT: 'potx' } });
  assert.equal(potxAnalysis.status, 0, potxAnalysis.stderr.toString());
  assert.equal(JSON.parse(potxAnalysis.stdout).compatibility, 'mapped');
  const samplePdf = spawnSync(python, ['-c', `import io,base64; from reportlab.pdfgen import canvas; b=io.BytesIO(); c=canvas.Canvas(b); c.drawString(40,700,'Reference design'); c.save(); print(base64.b64encode(b.getvalue()).decode())`]);
  assert.equal(samplePdf.status, 0, samplePdf.stderr.toString());
  const pdfAnalysis = spawnSync(python, ['-c', templates._internals.SCRIPT], { input: Buffer.from(samplePdf.stdout.toString().trim(), 'base64'), env: { ...process.env, PPT_TEMPLATE_EXT: 'pdf' } });
  assert.equal(pdfAnalysis.status, 0, pdfAnalysis.stderr.toString());
  assert.equal(JSON.parse(pdfAnalysis.stdout).compatibility, 'reference');
  const rendered = spawnSync(python, ['-c', render._internals.SCRIPT], { input: JSON.stringify({ slides: [{ title: 'Mapped brand', bullets: [] }], palette: custom.palette, fonts: custom.fonts }), env: { ...process.env, PPT_OUTPUT: path.join(root, 'mapped.pptx') } });
  assert.equal(rendered.status, 0, rendered.stderr.toString());
  console.log('PPT M3 lineage, selective reuse, template analysis/mapping and isolation: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

import { cardModel, scopeReview, simulatedExport } from './ppt-scope-test-helpers.mjs';
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
  // Card outline and writer doubles first (2026-10-23); the older branches answer what is left.
  modelCall: cardModel(async (project, prompt, _activity, _log, options) => {
    if (prompt.includes('整稿演示文稿内容评审器')) return scopeReview(project);
    if (prompt.includes('版本更新规划器') && !project.update.baseSnapshot.deck) return { slides: Array.from({ length: project.pages }, (_, i) => ({ title: `Imported ${i + 1}`, focus: `Imported progress section ${i+1}`, change: 'add', refs: ['U1'] })) };
    if (prompt.includes('版本更新规划器')) return { slides: [
      { title: 'Base 1', focus: 'Base 1', baseSlideId: project.update.baseSnapshot.deck.slides[0].id, change: 'keep', refs: [] },
      { title: 'Revised page', focus: 'New facts', baseSlideId: project.update.baseSnapshot.deck.slides[1].id, change: 'rewrite', refs: ['U1'] },
      { title: 'Base 3', focus: 'Base 3', baseSlideId: project.update.baseSnapshot.deck.slides[2].id, change: 'keep', refs: [] },
      ...Array.from({ length: project.pages - 3 }, (_, i) => ({ title: `New ${String.fromCharCode(65+i)}`, focus: ['Record the latest source fact','Explain the updated reference provenance','Retain the update version relationship'][i]||'Retain the prior context', change: 'add', refs: ['U1'] })),
    ] };
    if (prompt.includes('叙事规划器')) return { slides: Array.from({ length: project.pages }, (_, i) => ({ title: `Base ${i + 1}`, focus: `Base ${i + 1}` })) };
    if (project.update) {
      assert.match(prompt, /<source_packet>/);
      return { title: project.confirmedOutline?.titlesFrozen!==false&&project.confirmedOutline ? project.outline.find(slide=>options?.nodeKey?.includes(slide.id))?.title || 'Generated update' : 'Generated update', bullets: ['Latest fact'] };
    }
    if (prompt.includes('当前任务只写第')) return { title: `Base ${prompt.match(/当前任务只写第 (\d+) 页/)?.[1]}`, bullets: ['Original fact'] };
    return { title: project.confirmedOutline?.titlesFrozen!==false&&project.confirmedOutline ? project.outline.find(slide=>options?.nodeKey?.includes(slide.id))?.title || 'Generated update' : 'Generated update', bullets: ['Latest fact'] };
  }),
  renderPptx: async project => { renderCalls++; return simulatedExport(project,project.deck.slides.length*100); },
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
  const latest = store.get(uid, id); throw new Error(`${id} did not reach ${status}: ${latest.status} ${latest.error} ${JSON.stringify({issues:latest.candidateOutline?.issues,sourceIds:latest.source?.segments?.map(s=>s.id)})}`);
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
  assert.equal((await request('POST', '/ppt/projects', { readOnlyInput:false,prompt: 'Bad template', pages: 3, configId: 'test', template: reference.body.template.id })).status, 400);

  const baseCreate = await request('POST', '/ppt/projects', { readOnlyInput:false,prompt: 'Base presentation', pages: 3, configId: 'test' });
  const baseId = baseCreate.body.project.id;
  const baseOutline = await settled(baseId, 'outline_ready');
  assert.equal((await request('PATCH', `/ppt/projects/${baseId}/outline`, { slides: baseOutline.outline, finalPageCount: baseOutline.outline.length })).status, 200);
  assert.equal((await request('POST', `/ppt/projects/${baseId}/generate`)).status, 202);
  const base = await settled(baseId, 'completed');
  const oldDeck = structuredClone(base.deck);
  const updateInput = { readOnlyInput:false,baseProjectId: baseId, progressKind: 'paste', progressText: 'Latest fact', template: custom.id, templateMode: 'mapped', pages: 6, configId: 'test', requestId: 'same-update-request' };
  const updateCreate = await request('POST', '/ppt/updates', updateInput);
  assert.equal(updateCreate.status, 201);
  const nextId = updateCreate.body.project.id;
  assert.equal((await request('POST', '/ppt/updates', updateInput)).body.project.id, nextId);
  assert.equal((await request('POST', '/ppt/updates', { ...updateInput, progressText: 'Different facts' })).status, 409);
  let next = await settled(nextId, 'outline_ready');
  assert.equal(next.diff, null, 'an update is a card deck: its cards are new pages (S11)');
  assert.equal(next.version.parentId, baseId);
  assert.equal(next.version.number, 2);
  assert.equal(next.folderId, base.folderId);
  assert.equal((await request('GET', `/ppt/projects/${nextId}/versions`)).body.versions.length, 2);
  assert.equal((await request('GET', `/ppt/projects/${nextId}`, undefined, 'bob')).status, 404);
  {const edits = next.outline.map((slide, i) => ({ id: slide.id, title: i === 1 ? 'Edited new page' : slide.title, points: (slide.keyPoints || []).map(point => point.text), numbered: Boolean(slide.numberedPoints) }));
   assert.equal((await request('POST', `/ppt/projects/${nextId}/planning`, { command: 'edit', semanticRevision: next.planningContract.semanticRevision, cards: edits })).status, 200);
   next = store.get(uid, nextId);
   {const confirmed=await request('PATCH', `/ppt/projects/${nextId}/outline`, { slides: next.outline, finalPageCount: next.outline.length });assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body).slice(0,400));}}
  assert.equal((await request('POST', `/ppt/projects/${nextId}/generate`)).status, 202);
  next = await settled(nextId, 'completed');
  assert.equal(next.deck.slides.length, next.outline.length);
  assert.equal(next.deck.slides[1].title, 'Edited new page', 'writer keeps the user-confirmed outline title');
  assert.deepEqual(store.get(uid, baseId).deck, oldDeck);
  assert.equal(next.templateSpec.palette.accent, '#ddaa22');
  assert.equal(renderCalls, 2);
  assert.equal((await request('DELETE', `/ppt/templates/${custom.id}`)).status, 200);
  assert.equal(store.get(uid, nextId).templateSpec.palette.accent, '#ddaa22');

  const uploaded = await request('POST', '/ppt/updates', { readOnlyInput:false,baseFileName: 'old.pdf', baseFileBase64: Buffer.from('%PDF-base').toString('base64'),
    progressKind: 'file', progressFileName: 'changes.md', progressFileBase64: Buffer.from('New figures').toString('base64'),
    template: 'blue', pages: 6, configId: 'test' });
  assert.equal(uploaded.status, 201);
  const uploadId = uploaded.body.project.id;
  const parsed = await settled(uploadId, 'outline_ready');
  assert.match(parsed.source.text, /%PDF-base/);
  assert.match(parsed.source.text, /New figures/);
  assert.equal(parsed.update.baseSnapshot.source.name, 'old.pdf');
  assert.equal(store.readInput(uid, uploadId, 'progress').toString(), 'New figures');

  const python = process.env.PPT_TEST_PYTHON || 'python3';
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
  const analyzedTemplate = JSON.parse(analyzed.stdout);
  assert.equal(analyzedTemplate.palette.accent, '#ddaa22');
  assert.ok(analyzedTemplate.fonts.titleEastAsia && analyzedTemplate.fonts.bodyEastAsia, 'template analysis must resolve East Asian fonts');
  assert.equal(analyzedTemplate.fonts.cjkExplicit, true, 'resolved fallback fonts are explicit export tokens');
  const cjkTemplate = spawnSync(python, ['-c', `import io,base64
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.oxml.xmlchemy import OxmlElement
def set_east_asia(run, face):
    rpr=run._r.get_or_add_rPr()
    ea=OxmlElement('a:ea'); ea.set('typeface', face); rpr.append(ea)
p=Presentation(); s=p.slides.add_slide(p.slide_layouts[6])
title=s.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1)).text_frame.paragraphs[0].add_run()
title.text='标题'; title.font.name='Brand Heading'; title.font.size=Pt(32); set_east_asia(title, 'Brand Heading CJK')
body=s.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1)).text_frame.paragraphs[0].add_run()
body.text='正文'; body.font.name='Brand Text'; body.font.size=Pt(14); set_east_asia(body, 'Brand Text CJK')
b=io.BytesIO(); p.save(b); print(base64.b64encode(b.getvalue()).decode())`], { maxBuffer: 2_000_000 });
  assert.equal(cjkTemplate.status, 0, cjkTemplate.stderr.toString());
  const cjkAnalysis = spawnSync(python, ['-c', templates._internals.SCRIPT], { input: Buffer.from(cjkTemplate.stdout.toString().trim(), 'base64'), env: { ...process.env, PPT_TEMPLATE_EXT: 'pptx' } });
  assert.equal(cjkAnalysis.status, 0, cjkAnalysis.stderr.toString());
  const cjkFonts = JSON.parse(cjkAnalysis.stdout).fonts;
  assert.equal(cjkFonts.titleEastAsia, 'Brand Heading CJK', 'actual title run a:ea must override theme defaults');
  assert.equal(cjkFonts.bodyEastAsia, 'Brand Text CJK', 'actual body run a:ea must override theme defaults');
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

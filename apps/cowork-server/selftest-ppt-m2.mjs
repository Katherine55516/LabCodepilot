import { scopeReview, simulatedExport, cardModel } from './ppt-scope-test-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-m2-'));
process.env.COWORK_STATE_DIR = root;
const [{ handlePpt }, store, source, pdf] = await Promise.all([
  import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs'), import('./lib/ppt-source.mjs'), import('./lib/ppt-pdf.mjs'),
]);
const uid = 'alice';
let removed = [];
const deps = {
  // Card outline and writer doubles (2026-10-23); a review prompt gets a complete scope review.
  modelCall: cardModel(async (project, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(project) : (() => { throw new Error('Unexpected model step'); })()),
  extractFile: async (_project, name, bytes) => ({ kind: 'file', name, text: bytes.toString(), segments: [{ id: '1', location: '行 1', text: bytes.toString() }] }),
  renderPptx: async project => simulatedExport(project),
  renderPdf: async () => ({ bytes: 456 }),
  readFile: async () => ({ stream: Readable.from(Buffer.from('%PDF-1.4')), size: 8 }),
  removeContainer: async id => { removed.push(id); },
};
async function request(method, pathname, data, as = uid) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${pathname}`), { uid: as, deps, activity: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {}, destroy() {} } });
  return result;
}
async function settled(id, status, as = uid) {
  for (let n = 0; n < 100; n++) {
    const project = store.get(as, id);
    if (project?.status === status) return project;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const latest = store.get(as, id);
  throw new Error(`project ${id} did not reach ${status}: ${latest?.status} ${latest?.error || ''}`);
}
try {
  assert.throws(() => source.validateFile('old.doc', Buffer.from('doc')), /unsupported/);
  assert.throws(() => source.validateFile('../bad.md', Buffer.from('text')), /invalid/);
  assert.throws(() => source.validateFile('bad.pdf', Buffer.from('not pdf')), /signature/);
  assert.equal(source.validateFile('spatial.csv', Buffer.from('x,y\n1,2\n')), 'csv');
  const pasted = await request('POST', '/ppt/projects', { readOnlyInput:false,inputKind: 'paste', title: '季度报告', text: '收入增长 10%\n\n来源：财务部', pages: 3, configId: 'test' });
  assert.equal(pasted.status, 201);
  const id = pasted.body.project.id;
  let project = await settled(id, 'outline_ready');
  assert.ok(project.source.segments.length >= 1);
  assert.match(project.source.segments.map(segment => segment.text).join('\n'), /收入增长 10%[\s\S]*来源：财务部/);
  assert.ok(project.outline.slice(1).some(slide => slide.refs.length), 'cards cite the source');
  assert.equal((await request('GET', `/ppt/projects/${id}`, undefined, 'bob')).status, 404);
  assert.equal((await request('PATCH', `/ppt/projects/${id}/source`, { sourceRevision: 0, text: '新数据' })).status, 409);
  assert.equal((await request('PATCH', `/ppt/projects/${id}/source`, { sourceRevision: 1, text: '新数据\n\n新来源' })).status, 202);
  // A new source goes back to the settings form; the outline is written again from it.
  project = await settled(id, 'input_ready');
  assert.equal((await request('POST', `/ppt/projects/${id}/planning`, { command: 'outline' })).status, 202);
  project = await settled(id, 'outline_ready');
  assert.equal(project.sourceRevision, 2);
  assert.equal(project.outlineRevision, 0);
  // Card titles are edited with the planning command, then the outline is confirmed as it stands.
  {const edits=project.outline.map((slide, i) => ({ id: slide.id, title: `编辑 ${String.fromCharCode(65+i)}`, points: (slide.keyPoints||[]).map(point => point.text), numbered: Boolean(slide.numberedPoints) }));
   const edited=await request('POST', `/ppt/projects/${id}/planning`, { command: 'edit', semanticRevision: project.planningContract.semanticRevision, cards: edits });assert.equal(edited.status, 200, JSON.stringify(edited.body).slice(0,400));
   project=store.get(uid,id);assert.deepEqual(project.outline.slice(1).map(slide=>slide.title),edits.slice(1).map(edit=>edit.title),'the cover keeps the author\'s locked title');
   const confirmed=await request('PATCH', `/ppt/projects/${id}/outline`, { slides: project.outline, finalPageCount: project.outline.length });assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body).slice(0,400));}
  assert.equal((await request('POST', `/ppt/projects/${id}/generate`)).status, 202);
  project = await settled(id, 'completed');
  assert.equal(project.deck.slides.length, project.outline.length);
  const lockedTitle = '2026 AI Lab 产品能力与企业级智能 Agent 平台完整实施路线';
  const titleUser = 'title-user';
  const automatic = await request('POST', '/ppt/projects', { readOnlyInput:false,inputKind: 'prompt', title: lockedTitle, prompt: '解释平台架构和实施路线', pages: 4, configId: 'test' }, titleUser);
  assert.equal(automatic.status, 201);
  assert.equal((await request('POST', `/ppt/projects/${automatic.body.project.id}/generate`, undefined, titleUser)).status, 409, 'unvalidated planning cannot queue slide generation before explicit confirmation');
  const automaticOutline = await settled(automatic.body.project.id, 'outline_ready', titleUser);
  assert.equal(automaticOutline.inputUnderstanding.brief, true, 'a short prompt is a brief');
  {const confirmed=await request('PATCH', `/ppt/projects/${automatic.body.project.id}/outline`, { slides: automaticOutline.outline, finalPageCount: automaticOutline.outline.length }, titleUser);assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body).slice(0,300));}
  assert.equal((await request('POST', `/ppt/projects/${automatic.body.project.id}/generate`, undefined, titleUser)).status,202);
  const automaticProject = await settled(automatic.body.project.id, 'completed', titleUser);
  assert.equal(automaticProject.deck.slides.length, automaticProject.outline.length, 'output matches the confirmed outline');
  assert.equal(automaticProject.pageDecision.finalPageCount, automaticProject.outline.length);
  assert.equal(automaticProject.deckTitle.source, 'user');
  assert.equal(automaticProject.deckTitle.locked, true);
  assert.equal(automaticProject.deck.slides[0].title.replace(/\s/g, ''), lockedTitle.replace(/\s/g, ''), 'locked user title may only gain layout whitespace');
  const folder = await request('POST', '/ppt/folders', { name: '市场' });
  assert.equal(folder.status, 201);
  const folderId = folder.body.folder.id;
  assert.equal((await request('POST', '/ppt/folders', { name: '市场' })).status, 409);
  assert.equal((await request('PATCH', `/ppt/projects/${id}`, { favorite: true, pinned: true, tags: ['财务'], folderId })).status, 200);
  let list = await request('GET', '/ppt/projects?q=季度&favorite=1&folderId=' + folderId);
  assert.equal(list.body.projects.length, 1);
  assert.equal(list.body.projects[0].source, undefined);
  assert.equal((await request('GET', '/ppt/projects?q=季度', undefined, 'bob')).body.projects.length, 0);
  const copy = await request('POST', `/ppt/projects/${id}/duplicate`);
  assert.equal(copy.status, 202);
  const copyId = copy.body.project.id;
  await settled(copyId, 'completed');
  assert.equal((await request('POST', '/ppt/projects/bulk', { action: 'move', ids: [id, copyId], folderId: null })).status, 200);
  assert.equal((await request('POST', '/ppt/projects/bulk', { action: 'trash', ids: [id, copyId] })).status, 200);
  assert.equal((await request('GET', '/ppt/projects?trash=1')).body.projects.length, 2);
  assert.equal((await request('GET', `/ppt/projects/${id}`)).status, 404);
  assert.equal((await request('POST', `/ppt/projects/${id}/restore`)).status, 200);
  assert.equal((await request('DELETE', `/ppt/projects/${copyId}/permanent`)).status, 200);
  assert.deepEqual(removed, [copyId]);
  assert.ok(store.get(uid,copyId).taskRecordOnly,'permanent file deletion retains only its independent task history');
  assert.equal((await request('GET', '/ppt/projects')).body.projects.length, 1);
  assert.equal((await request('DELETE', `/ppt/folders/${folderId}`)).status, 200);

  const imported = await request('POST', '/ppt/projects', { readOnlyInput:false,inputKind: 'file', fileName: 'notes.md', fileBase64: Buffer.from('真内容').toString('base64'), pages: 3, configId: 'test' });
  assert.equal(imported.status, 201);
  const importedId = imported.body.project.id;
  assert.equal((await settled(importedId, 'outline_ready')).source.text, '真内容');
  assert.equal(store.readSource(uid, importedId).toString(), '真内容');
  assert.equal((await request('POST', '/ppt/projects', { readOnlyInput:false,inputKind: 'file', fileName: 'bad.pdf', fileBase64: Buffer.from('bad').toString('base64'), pages: 3, configId: 'test' })).status, 400);

  const python = process.env.PPT_TEST_PYTHON || 'python3';
  const extract = (name, raw) => {
    const dir = path.join(root, 'sources');
    const result = spawnSync(python, ['-c', source._internals.SCRIPT], { input: raw, env: { ...process.env, PPT_SOURCE_NAME: name, PPT_SOURCE_DIR: dir }, maxBuffer: 2_000_000 });
    assert.equal(result.status, 0, result.stderr.toString());
    return JSON.parse(result.stdout);
  };
  assert.match(extract('sample.md', Buffer.from('# 中文主题\n\n数据增长')).text, /数据增长/);
  assert.match(extract('sample.html', Buffer.from('<p>有效内容</p><script>隐藏</script>')).text, /有效内容/);
  assert.deepEqual(extract('sample.csv', Buffer.from('marker,value\nCD8A,90\n')).segments[0].rows,[['marker','value'],['CD8A','90']]);
  const fixtures = spawnSync(python, ['-c', `import io, json, base64
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches
from reportlab.pdfgen import canvas
out={}
out['csv']=base64.b64encode(b'marker,value\\nCD8A,90\\n').decode()
d=Document(); d.add_paragraph('Document facts'); b=io.BytesIO(); d.save(b); out['docx']=base64.b64encode(b.getvalue()).decode()
w=Workbook(); w.active['A1']='Spreadsheet facts'; b=io.BytesIO(); w.save(b); out['xlsx']=base64.b64encode(b.getvalue()).decode()
p=Presentation(); s=p.slides.add_slide(p.slide_layouts[6]); box=s.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1)); box.text='Presentation facts'; b=io.BytesIO(); p.save(b); out['pptx']=base64.b64encode(b.getvalue()).decode()
b=io.BytesIO(); c=canvas.Canvas(b); c.drawString(30, 700, 'PDF facts'); c.save(); out['pdf']=base64.b64encode(b.getvalue()).decode()
print(json.dumps(out))`], { maxBuffer: 2_000_000 });
  assert.equal(fixtures.status, 0, fixtures.stderr.toString());
  for (const [ext, encoded] of Object.entries(JSON.parse(fixtures.stdout))) {
    const expected = { csv: 'CD8A', docx: 'Document facts', xlsx: 'Spreadsheet facts', pptx: 'Presentation facts', pdf: 'PDF facts' }[ext];
    const parsed = extract(`sample.${ext}`, Buffer.from(encoded, 'base64'));
    assert.match(parsed.text, new RegExp(expected));
    if (ext === 'xlsx') assert.deepEqual(parsed.segments.find(s=>s.kind==='table').rows,[['Spreadsheet facts']]);
  }
  const hasMatplotlib = spawnSync(python, ['-c', 'import matplotlib']).status === 0;
  if (hasMatplotlib) {
    const output = path.join(root, 'presentation.pdf');
    const rendered = spawnSync(python, ['-c', pdf._internals.SCRIPT], { input: JSON.stringify({ template: 'violet', fonts: { title: 'DejaVu Sans', body: 'DejaVu Sans', titleEastAsia: 'DejaVu Sans', bodyEastAsia: 'DejaVu Sans' }, slides: [{ title: 'Quarterly review', bullets: ['Revenue grew'] }, { title: 'Next steps', bullets: [] }] }), env: { ...process.env, PPT_OUTPUT: output }, maxBuffer: 2_000_000 });
    assert.equal(rendered.status, 0, rendered.stderr.toString());
    const check = spawnSync(python, ['-c', `from pypdf import PdfReader; import sys; r=PdfReader(sys.argv[1]); assert len(r.pages)==2; assert 'Quarterly review' in r.pages[0].extract_text(); print('PDF OK')`, output]);
    assert.equal(check.status, 0, check.stderr.toString());
  } else console.warn('PDF output check skipped locally: matplotlib is installed in the Cowork image, but unavailable in this host Python');
  console.log('PPT M2 API, isolation and source formats: OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

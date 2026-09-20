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
  modelCall: async (project, prompt) => prompt.includes('叙事规划器')
    ? { slides: Array.from({ length: project.pages }, (_, i) => ({ title: `章节 ${i + 1}`, focus: `论点 ${i + 1}`, refs: project.source?.segments?.length ? [project.source.segments[0].id] : [] })) }
    : { title: '内容页', bullets: ['可信来源'] },
  extractFile: async (_project, name, bytes) => ({ kind: 'file', name, text: bytes.toString(), segments: [{ id: '1', location: '行 1', text: bytes.toString() }] }),
  renderPptx: async () => ({ bytes: 123 }),
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
async function settled(id, status) {
  for (let n = 0; n < 100; n++) {
    const project = store.get(uid, id);
    if (project?.status === status) return project;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`project ${id} did not reach ${status}`);
}
try {
  assert.throws(() => source.validateFile('old.doc', Buffer.from('doc')), /unsupported/);
  assert.throws(() => source.validateFile('../bad.md', Buffer.from('text')), /invalid/);
  assert.throws(() => source.validateFile('bad.pdf', Buffer.from('not pdf')), /signature/);
  const pasted = await request('POST', '/ppt/projects', { inputKind: 'paste', title: '季度报告', text: '收入增长 10%\n\n来源：财务部', pages: 3, configId: 'test' });
  assert.equal(pasted.status, 201);
  const id = pasted.body.project.id;
  let project = await settled(id, 'outline_ready');
  assert.equal(project.source.segments.length, 2);
  assert.deepEqual(project.outline[0].refs, ['1']);
  assert.equal((await request('GET', `/ppt/projects/${id}`, undefined, 'bob')).status, 404);
  assert.equal((await request('PATCH', `/ppt/projects/${id}/source`, { sourceRevision: 0, text: '新数据' })).status, 409);
  assert.equal((await request('PATCH', `/ppt/projects/${id}/source`, { sourceRevision: 1, text: '新数据\n\n新来源' })).status, 202);
  project = await settled(id, 'outline_ready');
  assert.equal(project.sourceRevision, 2);
  assert.equal(project.outlineRevision, 0);
  assert.equal((await request('PATCH', `/ppt/projects/${id}/outline`, { slides: project.outline.map((slide, i) => ({ ...slide, title: `编辑 ${i}` })) })).status, 200);
  assert.equal((await request('POST', `/ppt/projects/${id}/generate`)).status, 202);
  project = await settled(id, 'completed');
  assert.equal(project.deck.slides.length, 3);
  const folder = await request('POST', '/ppt/folders', { name: '市场' });
  assert.equal(folder.status, 201);
  const folderId = folder.body.folder.id;
  assert.equal((await request('POST', '/ppt/folders', { name: '市场' })).status, 409);
  assert.equal((await request('PATCH', `/ppt/projects/${id}`, { favorite: true, pinned: true, tags: ['财务'], folderId })).status, 200);
  let list = await request('GET', '/ppt/projects?q=季度&favorite=1&folderId=' + folderId);
  assert.equal(list.body.projects.length, 1);
  assert.equal(list.body.projects[0].source.text, undefined);
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
  assert.equal(store.get(uid, copyId), null);
  assert.equal((await request('GET', '/ppt/projects')).body.projects.length, 1);
  assert.equal((await request('DELETE', `/ppt/folders/${folderId}`)).status, 200);

  const imported = await request('POST', '/ppt/projects', { inputKind: 'file', fileName: 'notes.md', fileBase64: Buffer.from('真内容').toString('base64'), pages: 3, configId: 'test' });
  assert.equal(imported.status, 201);
  const importedId = imported.body.project.id;
  assert.equal((await settled(importedId, 'outline_ready')).source.text, '真内容');
  assert.equal(store.readSource(uid, importedId).toString(), '真内容');
  assert.equal((await request('POST', '/ppt/projects', { inputKind: 'file', fileName: 'bad.pdf', fileBase64: Buffer.from('bad').toString('base64'), pages: 3, configId: 'test' })).status, 400);

  const python = '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
  const extract = (name, raw) => {
    const dir = path.join(root, 'sources');
    const result = spawnSync(python, ['-c', source._internals.SCRIPT], { input: raw, env: { ...process.env, PPT_SOURCE_NAME: name, PPT_SOURCE_DIR: dir }, maxBuffer: 2_000_000 });
    assert.equal(result.status, 0, result.stderr.toString());
    return JSON.parse(result.stdout);
  };
  assert.match(extract('sample.md', Buffer.from('# 中文主题\n\n数据增长')).text, /数据增长/);
  assert.match(extract('sample.html', Buffer.from('<p>有效内容</p><script>隐藏</script>')).text, /有效内容/);
  const fixtures = spawnSync(python, ['-c', `import io, json, base64
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches
from reportlab.pdfgen import canvas
out={}
d=Document(); d.add_paragraph('Document facts'); b=io.BytesIO(); d.save(b); out['docx']=base64.b64encode(b.getvalue()).decode()
w=Workbook(); w.active['A1']='Spreadsheet facts'; b=io.BytesIO(); w.save(b); out['xlsx']=base64.b64encode(b.getvalue()).decode()
p=Presentation(); s=p.slides.add_slide(p.slide_layouts[6]); box=s.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1)); box.text='Presentation facts'; b=io.BytesIO(); p.save(b); out['pptx']=base64.b64encode(b.getvalue()).decode()
b=io.BytesIO(); c=canvas.Canvas(b); c.drawString(30, 700, 'PDF facts'); c.save(); out['pdf']=base64.b64encode(b.getvalue()).decode()
print(json.dumps(out))`], { maxBuffer: 2_000_000 });
  assert.equal(fixtures.status, 0, fixtures.stderr.toString());
  for (const [ext, encoded] of Object.entries(JSON.parse(fixtures.stdout))) {
    const expected = { docx: 'Document facts', xlsx: 'Spreadsheet facts', pptx: 'Presentation facts', pdf: 'PDF facts' }[ext];
    const parsed = extract(`sample.${ext}`, Buffer.from(encoded, 'base64'));
    assert.match(parsed.text, new RegExp(expected));
    if (ext === 'xlsx') assert.match(parsed.text, /A1=Spreadsheet facts/);
  }
  const hasMatplotlib = spawnSync(python, ['-c', 'import matplotlib']).status === 0;
  if (hasMatplotlib) {
    const output = path.join(root, 'presentation.pdf');
    const rendered = spawnSync(python, ['-c', pdf._internals.SCRIPT], { input: JSON.stringify({ template: 'violet', fonts: { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' }, slides: [{ title: 'Quarterly review', bullets: ['Revenue grew'] }, { title: 'Next steps', bullets: [] }] }), env: { ...process.env, PPT_OUTPUT: output }, maxBuffer: 2_000_000 });
    assert.equal(rendered.status, 0, rendered.stderr.toString());
    const check = spawnSync(python, ['-c', `from pypdf import PdfReader; import sys; r=PdfReader(sys.argv[1]); assert len(r.pages)==2; assert 'Quarterly review' in r.pages[0].extract_text(); print('PDF OK')`, output]);
    assert.equal(check.status, 0, check.stderr.toString());
  } else console.warn('PDF output check skipped locally: matplotlib is installed in the Cowork image, but unavailable in this host Python');
  console.log('PPT M2 API, isolation and source formats: OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

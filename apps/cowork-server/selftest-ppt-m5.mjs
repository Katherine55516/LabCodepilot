import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-m5-'));
process.env.COWORK_STATE_DIR = root;
process.env.PPT_NODE_CONCURRENCY = '3';
const [{ handlePpt }, store, layout, quality, dag, templates, render] = await Promise.all([
  import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs'), import('./lib/ppt-layout.mjs'),
  import('./lib/ppt-quality.mjs'), import('./lib/ppt-dag.mjs'), import('./lib/ppt-template.mjs'), import('./lib/ppt-render.mjs'),
]);
const uid = 'alice';
const python = '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';

const explicitLayouts = layout.LAYOUT_IDS.map((layoutId, index) => ({
  id: String(index + 1), title: `${layoutId} title`, bullets: layoutId === 'cover' ? [] : ['Evidence based point'], blocks: [], layoutId,
}));
assert.deepEqual(layout.applyLayoutRegistry({ slides: explicitLayouts }).slides.map(slide => slide.layoutId), layout.LAYOUT_IDS);
for (const slide of explicitLayouts) {
  assert.ok(layout.typographyFor(slide).titlePt >= layout.LAYOUTS[slide.layoutId].minTitlePt);
  assert.equal(quality.deterministicReview({ templateSpec: templates.snapshotTemplate(templates.BUILT_INS[0]), deck: { slides: [slide] } }).issues.some(issue => issue.code === 'layout_overlap'), false);
}
assert.notEqual(templates.BUILT_INS.find(item => item.id === 'violet').fonts.title, templates.BUILT_INS.find(item => item.id === 'light').fonts.title);
const light = templates.snapshotTemplate(templates.BUILT_INS.find(item => item.id === 'light'));
assert.equal(light.fonts.titleEastAsiaHant, 'Noto Serif CJK TC');
assert.equal(light.fonts.bodyEastAsiaHant, 'Noto Sans CJK TC');
const fontOutput = path.join(root, 'template-fonts.pptx');
const strictRender = spawnSync(python, ['-c', render._internals.SCRIPT], {
  input: JSON.stringify({ template: 'light', palette: light.palette, fonts: light.fonts, slides: [
    { id: '1', title: '模板标题', bullets: ['模板正文'], blocks: [], layoutId: 'summary' },
    { id: '2', title: '模板图表', bullets: ['图表说明'], blocks: [{ id: 'chart', type: 'chart', chartType: 'bar', labels: ['一月', '二月'], values: [1, 2], unit: '数量' }], layoutId: 'chart' },
    { id: '3', title: 'English title', bullets: ['English body'], blocks: [], layoutId: 'summary' },
    { id: '4', title: '繁體標題', bullets: ['這是繁體中文內容'], blocks: [], layoutId: 'summary' },
  ] }),
  env: { ...process.env, PPT_OUTPUT: fontOutput }, encoding: 'utf8',
});
assert.equal(strictRender.status, 0, strictRender.stderr);
const fontXml = spawnSync(python, ['-c', `from zipfile import ZipFile
with ZipFile(${JSON.stringify(fontOutput)}) as z: print(z.read('ppt/slides/slide1.xml').decode())`], { encoding: 'utf8' });
assert.match(fontXml.stdout, /Noto Serif CJK SC/);
assert.match(fontXml.stdout, /Noto Sans CJK SC/);
assert.match(fontXml.stdout, /lang="zh-CN"/);
const englishXml = spawnSync(python, ['-c', `from zipfile import ZipFile
with ZipFile(${JSON.stringify(fontOutput)}) as z: print(z.read('ppt/slides/slide3.xml').decode())`], { encoding: 'utf8' });
assert.match(englishXml.stdout, /<a:latin typeface="Noto Serif CJK SC"\/>/);
assert.match(englishXml.stdout, /lang="en-US"/);
const traditionalXml = spawnSync(python, ['-c', `from zipfile import ZipFile
with ZipFile(${JSON.stringify(fontOutput)}) as z: print(z.read('ppt/slides/slide4.xml').decode())`], { encoding: 'utf8' });
assert.match(traditionalXml.stdout, /<a:ea typeface="Noto Serif CJK TC"\/>/);
assert.match(traditionalXml.stdout, /<a:ea typeface="Noto Sans CJK TC"\/>/);
assert.match(traditionalXml.stdout, /lang="zh-TW"/);
const chartXml = spawnSync(python, ['-c', `from zipfile import ZipFile
with ZipFile(${JSON.stringify(fontOutput)}) as z: print(z.read('ppt/charts/chart1.xml').decode())`], { encoding: 'utf8' }).stdout;
for (const match of chartXml.matchAll(/<a:(defRPr|endParaRPr)\b[^>]*>([\s\S]*?)<\/a:\1>/g)) {
  assert.match(match[2], /<a:latin typeface="Noto Sans CJK SC"\/>/);
  assert.match(match[2], /<a:ea typeface="Noto Sans CJK SC"\/>/);
}
const missingFonts = spawnSync(python, ['-c', render._internals.SCRIPT], {
  input: JSON.stringify({ template: 'light', palette: light.palette, slides: [{ id: '1', title: 'No fallback', bullets: [], blocks: [], layoutId: 'cover' }] }),
  env: { ...process.env, PPT_OUTPUT: path.join(root, 'must-not-render.pptx') }, encoding: 'utf8',
});
assert.notEqual(missingFonts.status, 0, 'renderer must not silently replace a missing template font');

let active = 0; let maxActive = 0;
await dag.boundedAll(Array.from({ length: 12 }), 3, async () => {
  active++; maxActive = Math.max(maxActive, active);
  await new Promise(resolve => setTimeout(resolve, 5));
  active--;
});
assert.equal(maxActive, 3);

const badProject = {
  templateSpec: { palette: { background: '#ffffff', foreground: '#eeeeee', muted: '#dddddd', accent: '#cccccc' }, fonts: { title: 'Latin', body: 'Latin', titleEastAsia: '', bodyEastAsia: '', cjkExplicit: false } },
  deck: { slides: [{ id: '1', title: '中文标题', bullets: [], blocks: [], layoutId: 'cover' }] },
};
const badReview = quality.deterministicReview(badProject);
assert.ok(badReview.issues.some(issue => issue.code === 'font_cjk_coverage'));
assert.ok(badReview.issues.some(issue => issue.code === 'contrast_foreground'));
const chartFontReview = quality.deterministicReview({ ...badProject, deck: { slides: [{ id: '1', title: 'English', bullets: [], blocks: [{ id: 'c', type: 'chart', chartType: 'bar', labels: ['中文标签'], values: [1], unit: '' }], layoutId: 'chart' }] } });
assert.ok(chartFontReview.issues.some(issue => issue.code === 'font_cjk_coverage'), 'chart labels must participate in CJK coverage checks');
const nativeFontReview = quality.deterministicReview({ ...badProject, deck: { slides: [{ id: '1', title: 'English', bullets: [], blocks: [], layoutId: 'cover', nodes: [{ id: 'native', type: 'text', semanticRole: 'native-text', content: { text: '导入的中文文本' } }] }] } });
assert.ok(nativeFontReview.issues.some(issue => issue.code === 'font_cjk_coverage'), 'imported native text must participate in CJK coverage checks');
const replacementReview = quality.deterministicReview({ templateSpec: templates.snapshotTemplate(templates.BUILT_INS[0]), deck: { slides: [{ id: '1', title: 'Broken \ufffd text', bullets: [], blocks: [], layoutId: 'cover' }] } });
assert.ok(replacementReview.issues.some(issue => issue.code === 'font_invalid_character'), 'replacement characters must block publishing');
const repairedPalette = quality.repairProject({ ...badProject, templateSpec: templates.snapshotTemplate(templates.BUILT_INS[0]) }, quality.deterministicReview({ ...badProject, templateSpec: templates.snapshotTemplate(templates.BUILT_INS[0]) }));
assert.ok(repairedPalette.review.hardErrors === 0);
const mismatchedLayout = { templateSpec: templates.snapshotTemplate(templates.BUILT_INS[0]), deck: { slides: [
  { id: '1', title: 'Cover', bullets: [], blocks: [], layoutId: 'cover' },
  { id: '2', title: 'Claim without chart', bullets: ['Evidence'], blocks: [], layoutId: 'chart' },
] } };
const mismatchReview = quality.deterministicReview(mismatchedLayout);
assert.ok(mismatchReview.issues.some(issue => issue.code === 'layout_required_block'));
const mismatchRepair = quality.repairProject(mismatchedLayout, mismatchReview);
assert.equal(mismatchRepair.project.deck.slides[1].layoutId, 'conclusion');
assert.equal(mismatchRepair.review.hardErrors, 0);
const emptyContentReview = quality.deterministicReview({ ...mismatchedLayout, deck: { slides: [
  mismatchedLayout.deck.slides[0], { id: '2', title: 'Empty page', bullets: [], blocks: [], layoutId: 'summary' },
] } });
assert.ok(emptyContentReview.issues.some(issue => issue.code === 'content_empty'));
const intentionalBlankReview = quality.deterministicReview({ ...mismatchedLayout, deck: { slides: [
  mismatchedLayout.deck.slides[0], { id: '2', title: 'New page', bullets: [], blocks: [], layoutId: 'summary', manualBlank: true },
] } });
assert.equal(intentionalBlankReview.issues.some(issue => issue.code === 'content_empty'), false, 'a user-inserted blank slide must survive the quality gate');
const repeatedSingleBullet = { templateSpec: templates.snapshotTemplate(templates.BUILT_INS[0]), deck: { slides: [
  { id: '1', title: 'Cover', bullets: [], blocks: [], layoutId: 'cover' },
  { id: '2', title: 'First claim', bullets: ['The same supported claim'], blocks: [], layoutId: 'summary' },
  { id: '3', title: 'Second claim', bullets: ['The same supported claim'], blocks: [], layoutId: 'conclusion' },
] } };
const repeatedRepair = quality.repairProject(repeatedSingleBullet, quality.deterministicReview(repeatedSingleBullet));
assert.equal(repeatedRepair.project.deck.slides[2].bullets.length, 1, 'deduplication must not create an empty slide');
assert.equal(repeatedRepair.review.issues.some(issue => issue.code === 'content_empty'), false);
const normalizedReview = quality.normalizeModelReview({ missing: [{ slideIds: ['1'], detail: 'Need context', x: 123 }], repeated: [], conflicts: [], unsupported: [] }, ['1']);
assert.deepEqual(normalizedReview.missing[0], { slideIds: ['1'], detail: 'Need context' });

const png = spawnSync(python, ['-c', "import io,base64; from PIL import Image; b=io.BytesIO(); Image.new('RGB',(800,450),'#4477aa').save(b,'PNG'); print(base64.b64encode(b.getvalue()).decode())"]);
assert.equal(png.status, 0, png.stderr.toString());
const image = { id: 'source-image', type: 'image', dataUrl: `data:image/png;base64,${png.stdout.toString().trim()}`, caption: 'Evidence image' };
const brokenImage = { id: 'broken-image', type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', caption: 'Broken evidence image' };

let contentActive = 0; let maxContentActive = 0; let reviewCalls = 0; let renderCalls = 0;
const deps = {
  modelCall: async (project, prompt) => {
    if (prompt.includes('叙事规划器')) return { slides: Array.from({ length: project.pages }, (_, index) => ({ title: index === 0 ? '封面' : index === project.pages - 1 ? '结论' : `页面 ${index + 1}`, focus: 'Use supplied evidence', refs: project.title === 'Blocked deck' ? [] : ['1'] })) };
    if (prompt.includes('整稿演示文稿内容评审器')) { reviewCalls++; return { missing: [], repeated: [], conflicts: [], unsupported: [] }; }
    contentActive++; maxContentActive = Math.max(maxContentActive, contentActive);
    await new Promise(resolve => setTimeout(resolve, 10));
    contentActive--;
    const page = Number(prompt.match(/第 (\d+) 页/)?.[1] || 1);
    return { title: page === 1 ? '封面' : page === project.pages ? '结论' : `页面 ${page}`, bullets: page === 1 ? [] : [project.title === 'Blocked deck' ? 'Revenue 42 lacks a citation' : `来自来源的内容 ${page}`] };
  },
  renderPptx: async project => {
    renderCalls++;
    assert.ok(project.templateSpec.fonts.title);
    assert.ok(project.quality || project.stage === 'publish');
    return { bytes: 12345 };
  },
  renderPdf: async () => ({ bytes: 100 }),
  extractFile: async () => { throw new Error('unused'); },
  analyzeTemplate: async () => { throw new Error('unused'); },
  removeContainer: async () => {},
  readFile: async () => ({ stream: Readable.from([]), size: 0 }),
};
async function request(method, pathname, data) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${pathname}`), { uid, deps, activity: () => {}, log: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
  return result;
}
async function settled(id, status) {
  for (let index = 0; index < 300; index++) {
    const project = store.get(uid, id);
    if (project?.status === status) return project;
    if (project?.status === 'failed') throw new Error(`${project.stage}: ${project.error}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${id} did not reach ${status}`);
}

try {
  const created = await request('POST', '/ppt/projects', { inputKind: 'paste', text: 'Revenue increased without invented figures.', images: [image], title: 'Quality deck', pages: 9, template: 'light', configId: 'test' });
  assert.equal(created.status, 201);
  const id = created.body.project.id;
  await settled(id, 'outline_ready');
  assert.equal((await request('POST', `/ppt/projects/${id}/generate`)).status, 202);
  let project = await settled(id, 'completed');
  assert.ok(maxContentActive > 1 && maxContentActive <= 3);
  assert.equal(reviewCalls, 1);
  assert.equal(project.quality.status, 'passed');
  assert.equal(project.templateSpec.fonts.title, 'Noto Serif CJK SC');
  assert.ok(Object.keys(project.dagNodes).some(key => key.startsWith('source:')));
  assert.ok(project.dagNodes['media:source-image']);
  assert.equal(project.dagNodes['review:deck'].status, 'completed');
  assert.equal(project.dagNodes['publish:deck'].status, 'completed');
  assert.equal(renderCalls, 1);
  const saved = await request('PATCH', `/ppt/projects/${id}`, { slides: project.deck.slides, revision: project.revision });
  assert.equal(saved.status, 200);
  project = saved.body.project;
  assert.equal(reviewCalls, 1, 'ordinary saves must not rerun whole-deck model review');
  assert.equal(project.quality.modelReview.missing.length, 0);

  const blockedCreated = await request('POST', '/ppt/projects', { inputKind: 'paste', text: 'Revenue evidence is qualitative and contains no figures.', images: [brokenImage], title: 'Blocked deck', pages: 6, template: 'light', configId: 'test' });
  assert.equal(blockedCreated.status, 201);
  const blockedId = blockedCreated.body.project.id;
  await settled(blockedId, 'outline_ready');
  assert.equal((await request('POST', `/ppt/projects/${blockedId}/generate`)).status, 202);
  let blocked = await settled(blockedId, 'quality_blocked');
  assert.equal(blocked.quality.status, 'blocked');
  assert.ok(blocked.quality.deterministic.issues.some(issue => issue.code === 'numeric_source'));
  assert.ok(blocked.quality.deterministic.issues.some(issue => issue.code === 'image_decode'));
  assert.equal(blocked.dagNodes['media:broken-image'].result.passed, false);
  assert.equal(renderCalls, 2, 'blocked generation must not render or publish');
  assert.equal((await request('GET', `/ppt/projects/${blockedId}/export`)).status, 409);
  const repairedSlides = blocked.deck.slides.map(slide => ({ ...slide, bullets: slide.bullets.map(() => 'Qualitative revenue evidence'), blocks: [] }));
  const repaired = await request('PATCH', `/ppt/projects/${blockedId}`, { slides: repairedSlides, revision: blocked.revision });
  assert.equal(repaired.status, 200);
  blocked = repaired.body.project;
  assert.equal(blocked.status, 'completed', JSON.stringify(blocked.quality.deterministic.issues));
  assert.equal(blocked.quality.status, 'passed_with_warnings');
  assert.ok(blocked.quality.deterministic.issues.some(issue => issue.code === 'source_missing'));
  assert.equal(reviewCalls, 2, 'repair saves reuse the single review from their own generation');
  assert.equal(renderCalls, 3, 'a repaired deck is rendered exactly when it becomes publishable');
  console.log('PPT M5 template fonts, layout registry, bounded DAG and review-repair-publish gate: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

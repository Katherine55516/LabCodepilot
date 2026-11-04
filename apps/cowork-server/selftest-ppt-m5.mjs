import { cardDeckReply, cardWriterReply, scopeReview, simulatedExport } from './ppt-scope-test-helpers.mjs';
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
const python = process.env.PPT_TEST_PYTHON || 'python3';

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
const resolutions = JSON.parse(strictRender.stdout).fontResolution;
assert.ok(resolutions.length && resolutions.every(font => font.glyphCoverage === 'verified'));
assert.match(fontXml.stdout, /lang="zh-CN"/);
for (const index of [1,3,4]) {
  const xml = spawnSync(python, ['-c', `from zipfile import ZipFile
with ZipFile(${JSON.stringify(fontOutput)}) as z: print(z.read('ppt/slides/slide${index}.xml').decode())`], {encoding:'utf8'}).stdout;
  for (const match of xml.matchAll(/<a:(?:latin|ea) typeface="([^"]+)"/g)) {
    // Empty navigation and Latin-only east-Asia defaults do not need Han glyphs.
    assert.ok(match[1].trim(), 'all font tokens must have a nonempty family');
  }
  assert.match(xml, index === 4 ? /lang="zh-HK"/ : index === 3 ? /lang="en-US"/ : /lang="zh-CN"/);
}
const chartXml = spawnSync(python, ['-c', `from zipfile import ZipFile
with ZipFile(${JSON.stringify(fontOutput)}) as z: print(z.read('ppt/charts/chart1.xml').decode())`], {encoding:'utf8'}).stdout;
assert.match(chartXml, /<a:ea typeface="[^"]+"/);
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
let ioObservedAt=0,finishedChecks=0;
const ioTurn=new Promise(resolve=>setImmediate(()=>{ioObservedAt=finishedChecks;resolve();}));
const orderedChecks=await dag.boundedAll(Array.from({length:30},(_,index)=>index),3,async index=>{finishedChecks++;return index;});
await ioTurn;assert.ok(ioObservedAt>0&&ioObservedAt<30,'synchronous source checks must permit an HTTP/SSE I/O turn before the full deck is done');
assert.deepEqual(orderedChecks,Array.from({length:30},(_,index)=>index),'yielding preserves node result order');

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
// The source prose is English. Use meaningful fixture subjects; bare page counters are rejected by the production topic contract.
const fixtureTopic=(index,count)=>index===0?'Cover':index===count-1?'Conclusion':['Revenue scope','Supplied revenue claim','Source image','Qualitative description','Source reference','Image ownership','Caption rules','Review conditions','Source conclusion'][index];
const deps = {
  modelCall: async (project, prompt, activity, log, options = {}) => {
    // Card outline (2026-10-23): the deck and finishing calls; a card page is written as its points.
    const outlineReply = cardDeckReply(project, prompt, options); if (outlineReply) return outlineReply;
    if (prompt.includes('叙事规划器')) return { slides: Array.from({ length: project.pages }, (_, index) => ({ title: fixtureTopic(index,project.pages), focus: ['Revenue scope','Preserve the supplied revenue claim','Show the supplied image evidence','State the absence of invented figures','Check the source reference','Keep image ownership','Use original evidence captions','Review the evidence conditions','Conclude with the supplied evidence'][index], refs: project.source.segments.map(s=>s.id),sourceImageIds:index===1?project.source.images.map(image=>image.id):[] })) };
    if (prompt.includes('整稿演示文稿内容评审器')) { reviewCalls++; return scopeReview(project); }
    contentActive++; maxContentActive = Math.max(maxContentActive, contentActive);
    await new Promise(resolve => setTimeout(resolve, 10));
    contentActive--;
    const card = cardWriterReply(project, prompt, options);
    if (card) return project.title === 'Blocked deck' && card.contentBlocks.length ? { ...card, contentBlocks: [...card.contentBlocks, { type: 'mechanism', heading: '', body: 'Revenue 42 lacks a citation', sourceRefs: [] }] } : card;
    const page = Number(prompt.match(/第 (\d+) 页/)?.[1] || 1);
    return { title: fixtureTopic(page-1,project.pages), bullets: page === 1 ? [] : [`第${page}页：来自来源的内容`] };
  },
  renderPptx: async project => {
    renderCalls++;
    assert.ok(project.templateSpec.fonts.title);
    assert.ok(project.quality || project.stage === 'publish');
    return simulatedExport(project,12345);
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
  const retained=store.get(uid,id);throw new Error(`${id} did not reach ${status}: ${JSON.stringify({status:retained?.status,stage:retained?.stage,error:retained?.error,quality:retained?.quality}).slice(0,5000)}`);
}

try {
  const created = await request('POST', '/ppt/projects', { readOnlyInput:false,inputKind: 'paste', text: 'Revenue increased without invented figures.', images: [image], title: 'Quality deck', pages: 9, template: 'light', configId: 'test' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.project.id;
  {const planned = await settled(id, 'outline_ready');assert.equal((await request('PATCH', `/ppt/projects/${id}/outline`, { slides: planned.outline, finalPageCount: planned.outline.length })).status, 200);}
  assert.equal((await request('POST', `/ppt/projects/${id}/generate`)).status, 202);
  let project = await settled(id, 'completed');
  assert.ok(maxContentActive >= 1 && maxContentActive <= 3);
  assert.ok(project.deck.slides.slice(1, -1).filter(slide => slide.programGenerated?.role === 'card-page').length >= 1, 'a built-in card page is placed by code');
  assert.equal(reviewCalls, 0, 'a card deck is not reviewed by a model during generation (D3)');
  assert.ok(['passed', 'passed_with_warnings'].includes(project.quality.status));
  assert.equal(project.quality.deterministic.hardErrors, 0);
  assert.equal(project.templateSpec.fonts.title, 'Noto Serif CJK SC');
  assert.ok(Object.keys(project.dagNodes).some(key => key.startsWith('source:')));
  assert.ok(project.dagNodes['media:source-image']);
  assert.equal(project.dagNodes['publish:deck'].status, 'completed');
  assert.equal(renderCalls, 1);
  const beforeSourceObjects=structuredClone(project.deck.slides[1].sourceArtifactNodes);
  const saved = await request('PATCH', `/ppt/projects/${id}`, { slides: project.deck.slides, revision: project.revision });
  assert.equal(saved.status, 200,JSON.stringify(saved.body));
  project = saved.body.project;
  assert.equal(reviewCalls, 0, 'ordinary saves must not run a whole-deck model review');
  assert.equal(project.quality.modelReview.evaluation, 'not_evaluated', 'the review runs when the author asks');
  const savedObjects=structuredClone(project.deck.slides[1].sourceArtifactNodes);
  for(const node of savedObjects){if(node.type==='image'){assert.match(node.content.assetHash,/^[a-f0-9]{64}$/);assert.equal(node.content.assetId,'asset_'+node.content.assetHash.slice(0,24));delete node.content.assetId;delete node.content.assetHash;}}
  assert.deepEqual(savedObjects,beforeSourceObjects);
  assert.ok(project.deck.slides[1].nodes.some(node=>node.content.sourceImageCaptionId==='source-image'),'legacy save must preserve the visible source caption');

  const blockedCreated = await request('POST', '/ppt/projects', { readOnlyInput:false,inputKind: 'paste', text: 'Revenue evidence is qualitative and contains no figures.', title: 'Blocked deck', pages: 6, template: 'light', configId: 'test' });
  assert.equal(blockedCreated.status, 201);
  const blockedId = blockedCreated.body.project.id;
  {const planned = await settled(blockedId, 'outline_ready');assert.equal((await request('PATCH', `/ppt/projects/${blockedId}/outline`, { slides: planned.outline, finalPageCount: planned.outline.length })).status, 200);}
  assert.equal((await request('POST', `/ppt/projects/${blockedId}/generate`)).status, 202);
  // A built-in card page is its reviewed points (2026-11-01) and the outline
  // gate refuses a number the source lacks, so the unsupported figure enters
  // as an author's edit. A number never blocks a card deck (Fable F4,
  // 2026-11-01): its page is flagged, naming the number and why.
  let blocked = await settled(blockedId, 'completed');
  assert.equal(renderCalls, 2, 'the generated card deck publishes');
  const edited = await request('PATCH', `/ppt/projects/${blockedId}`, { slides: blocked.deck.slides.map((slide, index) => index === 1 ? { ...slide, bullets: [...slide.bullets, 'Revenue 42 lacks a citation'] } : slide), revision: blocked.revision });
  assert.equal(edited.status, 200, JSON.stringify(edited.body).slice(0, 300));
  blocked = edited.body.project;
  assert.notEqual(blocked.status, 'quality_blocked', 'a number never blocks a card deck');
  const flags = blocked.quality.deterministic.issues.filter(issue => ['source_number_unsupported','numeric_fidelity'].includes(issue.code)&&/42/u.test(JSON.stringify(issue)));
  assert.ok(flags.length&&flags.every(flag=>flag.severity==='warning'&&flag.pageFlag),'its page is flagged with the number: '+JSON.stringify(flags));
  assert.equal(renderCalls, 2, 'a save does not render or publish');
  const repairedSlides = blocked.deck.slides.map(slide => ({ ...slide, bullets: slide.bullets.filter(bullet => !bullet.includes('42')), blocks: [] }));
  const repaired = await request('PATCH', `/ppt/projects/${blockedId}`, { slides: repairedSlides, revision: blocked.revision });
  assert.equal(repaired.status, 200,JSON.stringify(repaired.body));
  blocked = repaired.body.project;
  assert.equal(blocked.status, 'completed', 'the repaired card deck has no blocking finding; its model review runs on demand (D3)');
  assert.equal(blocked.quality.reviewState,'stale');
  assert.equal(blocked.quality.modelReview.evaluation,'not_evaluated','changed copy cannot inherit an empty old critic result');
  assert.ok(!blocked.quality.deterministic.issues.some(issue=>issue.code==='source_number_unsupported'),'The repaired qualitative draft must remove the fabricated number; stale review still prevents publication');
  assert.equal(reviewCalls, 0, 'repair saves run no model review');
  assert.equal(renderCalls, 2, 'repair saves change the draft only');
  const publishResult = await request('POST', `/ppt/projects/${blockedId}/publish`, {});
  assert.equal(publishResult.body.published, true, JSON.stringify(publishResult.body));
  assert.equal(renderCalls, 3, 'explicit publication renders the repaired draft');
  assert.equal(reviewCalls,0,'a card deck publishes without a model review (D3)');
  // The AI check runs the model review on demand; its findings are notes.
  const checked=await request('POST',`/ppt/projects/${blockedId}/ai-check`,{});assert.equal(checked.status,200,JSON.stringify(checked.body).slice(0,300));assert.equal(checked.body.checked,true);
  assert.equal(reviewCalls,1,'one review when the author asks');assert.equal(checked.body.project.status,'completed','the check does not change the deck status');
  const brokenCreated=await request('POST','/ppt/projects',{readOnlyInput:false,inputKind:'paste',text:'Revenue evidence is qualitative.',images:[brokenImage],title:'Required broken media',pages:3,template:'light',configId:'test'});
  {const planned=await settled(brokenCreated.body.project.id,'outline_ready');await request('PATCH',`/ppt/projects/${planned.id}/outline`,{slides:planned.outline,finalPageCount:planned.outline.length});}
  await request('POST',`/ppt/projects/${brokenCreated.body.project.id}/generate`);
  // User decision 2026-10-31 (D2): a broken image is local to its page, so the
  // deck publishes and that page is flagged for the author, as a number is (the deck above).
  const broken=await settled(brokenCreated.body.project.id,'completed');
  assert.ok(broken.dagNodes['media:broken-image'].result.issues.some(issue=>issue.code==='image_decode'));
  assert.ok(broken.quality.deterministic.issues.some(issue=>issue.code==='image_decode'&&issue.pageFlag&&issue.severity==='warning'),'the broken image is flagged on its page');
  assert.ok(broken.quality.deterministic.flaggedPages?.length,'the flagged page is listed for the editor');
  assert.equal(renderCalls,4,'the deck with a flagged page is exported');
  console.log('PPT M5 template fonts, layout registry, bounded DAG and review-repair-publish gate: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

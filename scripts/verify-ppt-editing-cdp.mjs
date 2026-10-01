/** Local browser verification against real domain services, with a deterministic model adapter. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { chromium, expect } from '@playwright/test';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-edit-cdp-'));
const output = path.resolve(process.env.PPT_CDP_OUTPUT || '/tmp/codepilot-ppt-edit-cdp');
fs.mkdirSync(output, { recursive: true }); process.env.COWORK_STATE_DIR = root;
const [api, repo, store, ir, templates, renderer, edits, runs] = await Promise.all([
  import('../apps/cowork-server/lib/ppt-api.mjs'), import('../apps/cowork-server/lib/ppt/repository.mjs'), import('../apps/cowork-server/lib/ppt-store.mjs'), import('../apps/cowork-server/lib/ppt/ir.mjs'),
  import('../apps/cowork-server/lib/ppt-template.mjs'), import('../apps/cowork-server/lib/ppt/render-tree.mjs'), import('../apps/cowork-server/lib/ppt/generation-edit-service.mjs'), import('../apps/cowork-server/lib/ppt/run-service.mjs'),
]);
const uid = 'cdp-verification';
function fixture(title, status = 'completed') {
  const slides = ['Overview', 'Mechanism', 'Constraints', 'Conclusion'].map((text, index) => ({ id: `slide_${index}`, title: text, bullets: index ? ['A distinct source-backed mechanism explains this relationship.', 'The stated conditions constrain interpretation of the evidence.'] : [], layoutId: index === 0 ? 'cover' : index === 3 ? 'conclusion' : 'summary' }));
  const project = ir.ensureProjectV3({ uid, id: store.newId(), title, prompt: 'Explain the mechanism and limitations.', pages: 4, template: 'light', templateSpec: templates.snapshotTemplate(templates.BUILT_INS.find(item => item.id === 'light')), status, stage: status, error: '', revision: 1, publishedRevision: 1, model: 'fixture-model', configId: 'fixture', outline: slides.map(slide => ({ id: slide.id, title: slide.title, focus: slide.title, refs: [] })), deck: { slides }, nodes: Object.fromEntries(slides.map(slide => [slide.id, { status: 'done', slide }])), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  project.renderTree = renderer.buildRenderTree(project); project.quality = { status: 'passed', deterministic: { hardErrors: 0, issues: [] }, modelReview: { missing: [], repeated: [], conflicts: [], unsupported: [] }, repairs: [] };
  repo.saveProject(project); repo.saveRevision(project, 'baseline'); return project;
}
const completed = fixture('CDP review deck');
const generating = fixture('CDP generation deck', 'generating');
for (const [index, slide] of generating.outline.entries()) generating.nodes[slide.id].status = index < 2 ? 'done' : index === 2 ? 'running' : 'pending';
edits.editingState(generating).contentOpen = true; repo.saveProject(generating); runs.startRun(generating);
const failures = []; const checks = [];
const deps = { ...api._internals.defaultDeps,
  modelCall: async (project, prompt) => {
    if (prompt.startsWith('Select one registered layout')) return { layoutId: 'comparison' };
    if (prompt.includes('\nObjects: ')) {
      const objects = JSON.parse(prompt.split('\nObjects: ')[1].split('\nInstruction: ')[0]);
      return objects.length === 1 ? { content: { ...objects[0].content, text: 'A clearer model headline' } } : { patches: [{ nodeId: objects[0].nodeId, content: { ...objects[0].content, text: 'A clearer model headline' } }] };
    }
    if (prompt.includes('叙事规划器')) return { slides: Array.from({ length: project.pages }, (_, index) => ({ title: `Topic ${index + 1}`, focus: `Distinct mechanism ${index + 1}`, refs: project.source?.segments?.length ? [project.source.segments[0].id] : [] })) };
    if (prompt.includes('整稿演示文稿内容评审器')) return { missing: [], repeated: [], conflicts: [], unsupported: [] };
    return { title: 'Generated claim', bullets: ['Mechanism based on source evidence.'] };
  },
  renderPptx: async () => ({ bytes: 1234 }), renderPdf: async () => ({ bytes: 123 }), removeContainer: async () => {},
  extractFile: async (_uid, _id, name, _extension, bytes) => ({ kind: 'file', name, text: bytes.toString(), segments: [{ id: '1', location: name, text: bytes.toString() }], truncated: false }),
};
let host, browser;
try {
  host = await chromium.launch({ headless: true, args: ['--remote-debugging-port=9228'] });
  browser = await chromium.connectOverCDP('http://127.0.0.1:9228');
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await context.newPage(); const cdp = await context.newCDPSession(page);
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  cdp.on('Runtime.exceptionThrown', event => failures.push(event.exceptionDetails.text));
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) failures.push(message.text()); });
  await page.route('**/api/providers/models', route => route.fulfill({ json: { groups: [{ provider_id: 'managed-fixture', models: [{ value: 'fixture-model', label: 'Fixture model' }] }] } }));
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: [{ id: 'managed-fixture', name: 'Fixture', source: 'managed' }] } }));
  await page.route('**/api/ppt/**', async route => {
    const url = new URL(route.request().url()); url.pathname = url.pathname.replace(/^\/api/, '');
    if (url.pathname.endsWith('/events')) {
      const projectId = url.pathname.split('/')[3]; const project = repo.getProject(uid, projectId);
      return route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify({ project, run: { lastSeq: 0 } })}\n\n` });
    }
    const request = Readable.from(route.request().postData() ? [Buffer.from(route.request().postData())] : []); request.method = route.request().method(); request.headers = {};
    let result; let headers = {}; let code = 200;
    const res = { writeHead(status, values) { code = status; headers = values; }, end(body) { result = { status: code, body, raw: true, headers }; } };
    try {
      const handled = await api.handlePpt(request, url, { uid, deps, activity: () => {}, log: () => {}, res, send: (status, body) => { result = { status, body }; return true; } });
      if (!handled || !result) return route.fulfill({ status: 404, json: { error: 'unsupported verification endpoint' } });
      return result.raw ? route.fulfill({ status: result.status, contentType: result.headers['content-type'], body: result.body }) : route.fulfill({ status: result.status, json: result.body });
    } catch (error) { failures.push(error.stack); return route.fulfill({ status: 500, json: { error: error.message } }); }
  });
  async function screenshot(name) { const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(image.data, 'base64')); }
  async function mobile() { await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); }
  async function desktop() { await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false }); }
  async function open(name) { await page.goto('http://localhost:3000/ppt'); await page.getByRole('button', { name: new RegExp(name) }).first().click(); }
  await open('CDP review deck'); await page.getByRole('button', { name: '打开编辑器' }).click();
  await page.getByRole('button', { name: 'AI 局部优化', exact: true }).click();
  await page.getByRole('combobox', { name: '目标页面' }).selectOption('slide_1');
  await page.getByRole('button', { name: '丰富内容', exact: true }).click();
  const beforeRevision = repo.getProject(uid, completed.id).revision;
  await page.getByRole('button', { name: '用 AI 编辑当前页', exact: true }).click();
  await expect(page.getByTestId('ppt-ai-comparison')).toBeVisible();
  assert.equal(repo.getProject(uid, completed.id).revision, beforeRevision); checks.push('proposal preview writes no revision');
  await screenshot('ai-comparison-desktop'); await mobile(); await page.getByTestId('ppt-ai-comparison').scrollIntoViewIfNeeded(); await screenshot('ai-comparison-mobile'); await desktop();
  await page.getByRole('button', { name: '应用修改' }).click();
  await expect(page.getByRole('button', { name: '撤回本次优化' })).toBeVisible();
  assert.equal(repo.getProject(uid, completed.id).deck.slides[1].title, 'A clearer model headline'); checks.push('server-owned proposal applies to selected page');
  await page.getByRole('button', { name: '撤回本次优化' }).click();
  await expect(page.getByRole('button', { name: '撤回本次优化' })).toHaveCount(0);
  assert.equal(repo.getProject(uid, completed.id).deck.slides[1].title, 'Mechanism'); checks.push('targeted undo');

  await open('CDP generation deck'); await page.getByRole('checkbox', { name: '跟随生成进度' }).uncheck();
  await page.getByTestId('ppt-generation-monitor').getByRole('button').filter({ hasText: 'Overview' }).click();
  await page.getByRole('button', { name: '修改生成要求', exact: true }).click();
  const dialog = page.getByTestId('ppt-generation-edit'); await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('Keep this instruction after the run completes.');
  await dialog.getByRole('button', { name: '打开时尚未开始的 AI 页' }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
  await dialog.getByRole('textbox').fill('Expand the pending page from its sources.');
  await dialog.getByRole('button', { name: '当前页面', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Keep this instruction after the run completes.'); checks.push('scope drafts remain independent');
  await screenshot('generation-edit-desktop'); await mobile(); await screenshot('generation-edit-mobile'); await desktop();
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  const finished = repo.getProject(uid, generating.id); finished.status = 'completed'; finished.stage = 'completed'; finished.editing.contentOpen = false; repo.saveProject(finished);
  await page.reload(); await page.getByRole('button', { name: /CDP generation deck/ }).first().click(); await page.getByRole('button', { name: '打开编辑器' }).click();
  await page.getByRole('button', { name: '修改生成要求', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Keep this instruction after the run completes.');
  await expect(dialog).toContainText('生成已完成'); checks.push('unsubmitted scope and draft survive completion and reload');
  await dialog.getByRole('button', { name: '提交修改' }).click();
  await expect(dialog.getByRole('status')).toContainText('已应用', { timeout: 10000 }); checks.push('completed generation intent edits draft only');
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.reload(); await page.getByRole('button', { name: /CDP generation deck/ }).first().click();
  await page.getByRole('button', { name: '生成修改记录', exact: true }).click();
  await expect(page.getByTestId('ppt-generation-edit').getByRole('status')).toContainText('已应用'); checks.push('submitted intent history survives reload');
  const edited = repo.getProject(uid, generating.id); assert.ok(edited.revision > edited.publishedRevision);

  await page.goto('http://localhost:3000/ppt');
  await page.getByRole('button', { name: /＋ 新建|新建 PPT/ }).first().click();
  await page.getByRole('combobox', { name: 'LLM（必填）' }).selectOption('managed-fixture::fixture-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click(); await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await page.getByRole('textbox', { name: '输入 Prompt' }).fill('Explain a technical architecture with source-backed mechanisms and limitations.');
  await page.getByRole('button', { name: '下一步：选择模板与页数 →' }).click();
  await expect(page.getByTestId('ppt-template-browser')).toBeVisible();
  const previewImage = page.getByTestId('ppt-template-browser').getByRole('img'); await expect(previewImage).toBeVisible();
  await expect.poll(() => previewImage.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  const src = await previewImage.getAttribute('src'); await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(previewImage).not.toHaveAttribute('src', src);
  await screenshot('template-settings-desktop'); await mobile(); await screenshot('template-settings-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile template settings must not overflow horizontally'); checks.push('real template preview paging and mobile layout');
  assert.deepEqual(failures, []);
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ date: '2026-09-30', transport: 'CDP', model: 'deterministic adapter', checks, consoleErrors: failures, artifacts: fs.readdirSync(output).filter(name => name.endsWith('.png')) }, null, 2));
  console.log(JSON.stringify({ output, checks: checks.length, consoleErrors: failures.length }));
} finally {
  if (browser) await browser.close(); if (host) await host.close(); fs.rmSync(root, { recursive: true, force: true });
}

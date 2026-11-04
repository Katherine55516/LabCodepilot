/* eslint-disable @typescript-eslint/no-explicit-any -- fixture projects are loosely typed API payloads. */
import { test, expect, type Page } from '@playwright/test';
import { pptParityFixture } from '../fixtures/ppt-parity';
import { choosePptRoleModel } from '../helpers';

test.setTimeout(120000);
type Recorded = { method: string; path: string; body: any };

async function fixturePage(page: Page, override?: (method: string, path: string, body: any, fixture: ReturnType<typeof pptParityFixture>) => Promise<unknown | null>) {
  const fixture = pptParityFixture(), requests: Recorded[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), body = request.postData() ? request.postDataJSON() : {};
    if (request.method() !== 'GET') requests.push({ method: request.method(), path: url.pathname, body });
    if (url.pathname === '/api/providers/models') return route.fulfill({ json: { groups: [{ provider_id: 'managed-demo', models: [{ value: 'demo-model', label: 'Demo LLM' }, { value: 'demo-model-2', label: 'Second LLM' }] }] } });
    const custom = await override?.(request.method(), url.pathname, body, fixture);
    if (custom) return route.fulfill(custom as any);
    const result = await fixture.handle(request.method(), url.pathname, body);
    if (!result) return route.continue();
    return route.fulfill({ status: result.status, contentType: result.contentType || 'application/json', body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
  });
  return { fixture, requests };
}
const creations = (requests: Recorded[]) => requests.filter(item => item.method === 'POST' && item.path === '/api/ppt/projects');

// Draft keys in the card flow (option D integration, Fable 2026-10-26). The
// wizard's main button reads the input and hands over to the card settings,
// so what is reachable is checked here: the input is locked while the reading
// runs, one reading creates one draft, and the title and model chosen before
// continuing are that draft's. A title or model change on an already-read draft,
// and an input change that supersedes one, have no UI entry point in the card
// flow; ppt-draft-keys keeps that behaviour and its unit tests cover it.
test('a card reading locks the input, creates one draft and carries the title and model @smoke', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const { requests } = await fixturePage(page, async (method, path) => { if (method === 'POST' && path === '/api/ppt/projects') await held; return null; });
  await page.goto('/ppt', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('加载中…', { exact: true })).toHaveCount(0, { timeout: 60000 });
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await choosePptRoleModel(page, 'managed-demo::demo-model-2');
  await page.getByRole('button', { name: '确认并继续 →', exact: true }).click();
  await page.getByRole('button', { name: /Teaching template/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →', exact: true }).click();
  await page.getByRole('textbox', { name: /PPT 标题/ }).fill('Release readiness review');
  const prompt = page.getByRole('textbox', { name: '输入 Prompt', exact: true });
  await prompt.fill('Explain source validation and release conditions.');
  await page.getByRole('button', { name: '继续：生成大纲', exact: true }).click();
  // While the reading runs the input cannot change under it.
  await expect(prompt).toBeDisabled();
  release();
  await expect(page.getByTestId('ppt-card-settings')).toBeVisible({ timeout: 20000 });
  const made = creations(requests);
  expect(made).toHaveLength(1);
  expect(made[0].body).toMatchObject({ title: 'Release readiness review', model: 'demo-model-2' });
  expect(requests.filter(item => item.path.endsWith('/discard'))).toHaveLength(0);
});

/** A finished deck whose first object can be nudged and a locked second object. */
async function editorPage(page: Page, delay = 150) {
  let revision = 3, delayed = 0;
  const statuses: number[] = [], bases: number[] = [];
  const { fixture, requests } = await fixturePage(page, async (method, path, body, fixture) => {
    if (method !== 'POST' || !path.endsWith('/commands')) return null;
    const project = fixture.projects.get('9'.repeat(32)) as any;
    bases.push(body.baseRevision);
    await new Promise(resolve => setTimeout(resolve, delay)); delayed++;
    const respond = (status: number, json: unknown) => { statuses.push(status); return { status, contentType: 'application/json', body: JSON.stringify(json) }; };
    if (body.baseRevision !== revision) return respond(409, { error: 'command conflicts with newer changes', code: 'revision_conflict' });
    const element = (nodeId: string) => project.renderTree.slides[0].elements.find((item: any) => item.nodeId === nodeId);
    if (body.type === 'nodes.setGeometry') {
      if (body.payload.changes.some((change: any) => element(change.nodeId)?.locked)) return respond(409, { error: 'node is locked', code: 'node_locked' });
      for (const change of body.payload.changes) element(change.nodeId).bounds = change.geometry;
    }
    project.revision = ++revision;
    return respond(200, { project });
  });
  const project = fixture.projects.get('9'.repeat(32)) as any;
  Object.assign(project, { status: 'completed', stage: 'completed', revision, publishedRevision: 2 });
  for (const slide of project.outline) { project.nodes[slide.id].status = 'done'; project.runtime.slides[slide.id].phase = 'render_ready'; }
  const elements = project.renderTree.slides[0].elements;
  elements[0].id = elements[0].nodeId; // a top-level object: render id equals node id
  elements.push({ ...structuredClone(elements[0]), id: 'locked0', nodeId: 'locked0', locked: true, bounds: { x: 500000, y: 3000000, width: 4000000, height: 800000 }, content: { text: 'Locked note' } });
  await page.goto(`/ppt?projectId=${'9'.repeat(32)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('ppt-structured-editor')).toBeVisible({ timeout: 60000 });
  return { project, requests, statuses, bases, delayed: () => delayed, revision: () => revision };
}

test('a burst of nudges is queued against linked revisions and moves by the full distance @smoke', async ({ page }) => {
  // A slow server: the first move is answered after 3 s.
  const { project, statuses, bases, delayed } = await editorPage(page, 3000);
  const element = project.renderTree.slides[0].elements[0], startX = element.bounds.x, width = project.renderTree.slides[0].size.width;
  await page.locator('[data-node-id="n0"]').click();
  for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowRight');
  // Shown at once: the full distance is on screen before the server answered.
  const left = () => page.locator('[data-node-id="n0"]').evaluate(node => parseFloat((node as HTMLElement).style.left));
  await expect.poll(left, { timeout: 1000 }).toBeCloseTo(((startX + 6 * 18288) / width) * 100, 3);
  expect(delayed()).toBe(0);
  await expect.poll(() => element.bounds.x, { timeout: 15000 }).toBe(startX + 6 * 18288);
  expect(statuses.every(status => status === 200)).toBe(true);
  expect(bases.length).toBeLessThan(6);
  expect(bases).toEqual([...bases].sort((a, b) => a - b));
  expect(new Set(bases).size).toBe(bases.length);
  await expect(page.getByTestId('ppt-structured-editor').getByRole('alert')).toHaveCount(0);
});

test('a rejected edit rolls back and says why, without offering a reload @smoke', async ({ page }) => {
  const { project } = await editorPage(page);
  const locked = project.renderTree.slides[0].elements.find((item: any) => item.nodeId === 'locked0');
  await page.locator('[data-node-id="n0"]').click();
  await page.locator('[data-node-id="locked0"]').click({ modifiers: ['Shift'] });
  // Clicking an object opens the selection AI box; close it to reach the arrange panel.
  await page.getByTestId('ppt-inline-ai').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '排列与组合' }).click();
  await page.getByRole('button', { name: '左对齐', exact: true }).click();
  await expect(page.getByTestId('ppt-structured-editor').getByRole('alert')).toContainText(/已锁定|locked/);
  await expect(page.getByRole('button', { name: /重新加载|Reload/ })).toHaveCount(0);
  expect(locked.bounds.x).toBe(500000);
});

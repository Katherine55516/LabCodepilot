/* eslint-disable @typescript-eslint/no-explicit-any -- fixture projects are loosely typed API payloads. */
import { test, expect, type Page } from '@playwright/test';
import { pptParityFixture } from '../fixtures/ppt-parity';

const id = '9'.repeat(32);
type Fixture = ReturnType<typeof pptParityFixture>;
type Recorded = { method: string; path: string; body: any };

/** Fixture API plus recording of the write requests these tests assert on. */
async function mockApi(page: Page, fixture: Fixture) {
  const requests: Recorded[] = [];
  const project = fixture.projects.get(id)! as any;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), raw = request.postData();
    const body = raw ? JSON.parse(raw) : {};
    if (request.method() !== 'GET') requests.push({ method: request.method(), path: url.pathname, body });
    if (url.pathname === `/api/ppt/projects/${id}/commands` && request.method() === 'POST') return route.fulfill({ json: { project, operation: { id: 'op' } } });
    if (url.pathname === `/api/ppt/projects/${id}/publish`) return route.fulfill({ json: { project, published: true } });
    if (url.pathname === `/api/ppt/projects/${id}/run` && request.method() === 'DELETE') { project.status = 'cancelled'; project.stage = 'cancelled'; return route.fulfill({ json: { project } }); }
    const result = await fixture.handle(request.method(), url.pathname, body);
    if (!result) return route.continue();
    return route.fulfill({ status: result.status, contentType: result.contentType || 'application/json', body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
  });
  return { project, requests };
}

/** A finished deck opens in the structured editor. */
function completed(fixture: Fixture) {
  const project = fixture.projects.get(id)! as any;
  project.status = 'completed'; project.stage = 'completed'; project.revision = 3; project.publishedRevision = 2;
  for (const slide of project.outline) { project.nodes[slide.id].status = 'done'; project.runtime.slides[slide.id].phase = 'render_ready'; }
  return project;
}

async function openEditor(page: Page) {
  await page.goto(`/ppt?projectId=${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('ppt-structured-editor')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-node-id="n0"]')).toBeVisible();
}

const commands = (requests: Recorded[]) => requests.filter(item => item.path.endsWith('/commands') && item.method === 'POST').map(item => item.body);

test('PPT workspace hides the desktop rail below 1280px and keeps the drawer rail @smoke', async ({ page }) => {
  await mockApi(page, pptParityFixture());
  const desktopRail = page.locator('nav.ppt-workspace-rail.hidden');
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/ppt', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /打开 PPT 工作区导航|Open PPT workspace navigation/ })).toBeVisible({ timeout: 60_000 });
  await expect(desktopRail).toBeHidden();
  await page.getByRole('button', { name: /打开 PPT 工作区导航|Open PPT workspace navigation/ }).click();
  const drawerRail = page.locator('nav.ppt-workspace-rail:not(.hidden)');
  await expect(drawerRail).toBeVisible();
  expect(await drawerRail.evaluate(element => getComputedStyle(element).display)).toBe('flex');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(desktopRail).toBeVisible({ timeout: 60_000 });
  expect(await desktopRail.evaluate(element => getComputedStyle(element).display)).toBe('flex');
});

test('PPT generation cancel asks for confirmation before stopping the run @smoke', async ({ page }) => {
  const fixture = pptParityFixture();
  const { requests } = await mockApi(page, fixture);
  await page.goto(`/ppt?projectId=${id}`, { waitUntil: 'domcontentloaded' });
  const monitor = page.getByTestId('ppt-generation-monitor');
  await expect(monitor).toBeVisible({ timeout: 60_000 });
  const cancels = () => requests.filter(item => item.path.endsWith('/run') && item.method === 'DELETE').length;
  await monitor.locator('header').getByRole('button', { name: /取消生成|Cancel generation/ }).click();
  const dialog = page.getByRole('dialog', { name: /取消本次生成|Cancel this generation/ });
  await expect(dialog).toContainText(/不能再继续或重试|cannot be resumed or retried/);
  await dialog.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(cancels()).toBe(0);
  await monitor.locator('header').getByRole('button', { name: /取消生成|Cancel generation/ }).click();
  await dialog.getByRole('button', { name: /取消生成|Cancel generation/ }).click();
  await expect.poll(cancels).toBe(1);
});

test('PPT outline phase can be cancelled after confirmation @smoke', async ({ page }) => {
  const fixture = pptParityFixture();
  const project = fixture.projects.get(id)! as any;
  project.status = 'outlining'; project.stage = 'outline';
  project.candidateOutline = { syllabus: [{ id: 's0', title: 'Forming topic', message: 'Reading the source' }] };
  const { requests } = await mockApi(page, fixture);
  await page.goto(`/ppt?projectId=${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('ppt-outline-forming')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('ppt-generation-monitor').locator('header').getByRole('button', { name: /取消生成|Cancel generation/ }).click();
  const dialog = page.getByRole('dialog', { name: /取消本次生成|Cancel this generation/ });
  await expect(dialog).toContainText(/大纲生成立即停止|Outline generation stops/);
  await dialog.getByRole('button', { name: /取消生成|Cancel generation/ }).click();
  await expect.poll(() => requests.filter(item => item.path.endsWith('/run') && item.method === 'DELETE').length).toBe(1);
});

test('PPT editor Cmd+S publishes a draft only @smoke', async ({ page }) => {
  // Fable G1 (2026-11-01): Ctrl/⌘+S commits the field being edited and
  // publishes a draft; on a published deck it sends no publish request.
  const fixture = pptParityFixture(); completed(fixture).publishedRevision = 3;
  const { requests } = await mockApi(page, fixture);
  await openEditor(page);
  await page.locator('[data-node-id="n0"]').click();
  await page.keyboard.press('ControlOrMeta+s');
  const publish = page.getByRole('button', { name: /保存并发布|Save & publish/ });
  await expect(publish).toHaveAttribute('title', /质量检查|quality checks/);
  await page.waitForTimeout(500);
  expect(requests.filter(item => item.path.endsWith('/publish'))).toHaveLength(0);
});

test('PPT editor Cmd+S on a draft publishes it once @smoke', async ({ page }) => {
  const fixture = pptParityFixture(); completed(fixture);
  const { requests } = await mockApi(page, fixture);
  await openEditor(page);
  await page.locator('[data-node-id="n0"]').click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => requests.filter(item => item.path.endsWith('/publish')).length).toBe(1);
});

test('PPT editor pastes objects copied on another page @smoke', async ({ page }) => {
  const fixture = pptParityFixture(); completed(fixture);
  const { requests } = await mockApi(page, fixture);
  await openEditor(page);
  await page.locator('[data-node-id="n0"]').click();
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('[data-node-id="n1"]').click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => commands(requests).find(item => item.type === 'nodes.duplicate')?.payload).toEqual({ slideId: 's1', sourceSlideId: 's0', nodeIds: ['n0'] });
  // A paste on the copied page stays a same-page duplicate.
  await page.locator('[data-node-id="n0"]').click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => commands(requests).filter(item => item.type === 'nodes.duplicate').at(1)?.payload).toEqual({ slideId: 's0', nodeIds: ['n0'] });
});

test('PPT inline edit: Esc discards, and an over-long list is kept open instead of truncated @smoke', async ({ page }) => {
  const fixture = pptParityFixture(); const project = completed(fixture);
  project.renderTree.slides[0].elements.push({ id: 'list0', nodeId: 'list0', kind: 'list', bounds: { x: 500000, y: 2000000, width: 10000000, height: 3500000 }, content: { items: [{ id: 'i1', text: 'One' }, { id: 'i2', text: 'Two' }] }, style: { fontSizePt: 16, color: '#111111' }, zIndex: 2, locked: false });
  const { requests } = await mockApi(page, fixture);
  await openEditor(page);

  const title = page.locator('[data-node-id="n0"]');
  await title.dispatchEvent('dblclick');
  await title.locator('textarea').fill('Changed title');
  await title.locator('textarea').press('Escape');
  await expect(title.locator('textarea')).toHaveCount(0);
  await expect(title).toContainText('Topic 1');

  const list = page.locator('[data-node-id="list0"]');
  await list.dispatchEvent('dblclick');
  await list.locator('textarea').fill(Array.from({ length: 21 }, (_, index) => `Item ${index + 1}`).join('\n'));
  await list.locator('textarea').press('Tab');
  await expect(list.getByTestId('ppt-inline-edit-error')).toContainText(/20/);
  await expect(list.locator('textarea')).toBeVisible();
  expect(commands(requests).filter(item => item.type === 'node.setContent')).toHaveLength(0);

  await list.locator('textarea').fill('Zero\nOne\nTwo');
  await list.locator('textarea').press('Tab');
  await expect(list.locator('textarea')).toHaveCount(0);
  await expect.poll(() => commands(requests).find(item => item.type === 'node.setContent')?.payload.content.items.map((item: { id: string }) => item.id).slice(1)).toEqual(['i1', 'i2']);
  expect(commands(requests).filter(item => item.type === 'node.setContent')).toHaveLength(1);
});

import {choosePptRoleModel} from '../helpers';
import {selectPptOption} from '../helpers';
import { test, expect, type Page } from '@playwright/test';
import { pptParityFixture } from '../fixtures/ppt-parity';

async function enterPaste(page: Page) {
  const fixture = pptParityFixture();
  await page.route('**/api/**', async route => {
    const result = await fixture.handle(route.request().method(), new URL(route.request().url()).pathname, route.request().postData() ? route.request().postDataJSON() : {});
    if (!result) return route.continue();
    return route.fulfill({ status: result.status, contentType: result.contentType || 'application/json', body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'}); await expect(page.getByText('加载中…', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: /粘贴文本/ }).click();
  await choosePptRoleModel(page,'managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Teaching template/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  return fixture;
}

test('PPT planning assumptions are disclosed and the code choice re-estimates @smoke', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await enterPaste(page);
  const requests: Record<string, unknown>[] = [];
  page.on('request', request => { if (request.url().includes('/api/ppt/page-estimate') && request.method() === 'POST') requests.push(request.postDataJSON()); });
  await page.getByRole('textbox', { name: '粘贴文本', exact: true }).fill('A bilingual tutorial with code blocks.');
  const panel = page.getByTestId('ppt-planning-assumptions');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('规划假设（生成前请检查）')).toBeVisible();
  await expect(panel.getByText(/2 段代码不上页/)).toBeVisible();
  await expect(panel.getByText(/输出语言与输入一致/)).toBeVisible();
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('8');
  // The estimate note shows the base reason; the assumptions are listed once.
  await expect(page.getByRole('status').filter({ hasText: '建议 8 页' })).not.toContainText('不上页');
  await page.screenshot({ path: info.outputPath('assumptions-default.png') });

  await selectPptOption(panel.getByRole('combobox', { name: '代码' }), 'keep');
  await expect.poll(() => requests.at(-1)).toMatchObject({ generationPolicy: { code: { presentation: 'keep' } } });
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('11');
  await expect(panel.getByText(/按原文保留为代码组件/)).toBeVisible();

  await selectPptOption(panel.getByRole('combobox', { name: '代码' }), 'auto');
  await expect.poll(() => (requests.at(-1)?.generationPolicy as Record<string, unknown> | undefined)?.code).toBeUndefined();
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('8');

  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded(); await expect(panel).toBeInViewport();
  const overflow = await panel.evaluate(element => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('assumptions-mobile.png') });
  expect(errors).toEqual([]);
});

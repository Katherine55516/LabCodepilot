import { expect, test } from '@playwright/test';

test('user page selection and module estimate take priority over template length @smoke', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/providers/models', route => route.fulfill({ json: {
    groups: [{ provider_id: 'managed-demo', models: [{ value: 'demo-model', label: 'Demo model' }] }],
  } }));
  await page.route('**/api/providers', route => route.fulfill({ json: {
    providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }],
  } }));
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/projects**', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [{
    id: 'uploaded-four', name: 'Four page PPTX', category: '我的模板', kind: 'uploaded', extension: 'pptx',
    compatibility: 'mapped', pages: 4, palette: { background: '#202020', accent: '#b08866', foreground: '#ffffff', muted: '#aaaaaa' },
    sampleTitles: ['Cover'], tags: [], pinned: false,
  }, {
    id: 'uploaded-ten', name: 'Ten page alternate', category: '我的模板', kind: 'uploaded', extension: 'pptx',
    compatibility: 'mapped', pages: 10, palette: { background: '#202020', accent: '#8899bb', foreground: '#ffffff', muted: '#aaaaaa' },
    sampleTitles: ['Cover'], tags: [], pinned: false,
  }] } }));
  await page.goto('/ppt');
  await page.getByRole('button', { name: /＋ 新建|新建 PPT/ }).first().click();
  await page.getByRole('combobox', { name: 'LLM（必填）' }).selectOption('managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await page.getByRole('textbox', { name: '输入 Prompt' }).fill('Create a concise architecture review in 3 slides');
  await page.getByRole('button', { name: '下一步：选择模板与页数 →' }).click();
  const guidance = page.getByText(/输出少于模板页数/);
  await guidance.scrollIntoViewIfNeeded();
  await expect(guidance).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reuse-desktop.png'), fullPage: true });
  await expect(page.getByText('3 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
  const plus = page.getByRole('button', { name: '＋' });
  await plus.click();
  await expect(page.getByText('4 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Ten page alternate/ }).click();
  await expect(page.getByText('4 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Four page PPTX/ }).click();
  await expect(page.getByText('4 页', { exact: true })).toBeVisible();
  await plus.click(); await plus.click(); await plus.click(); await plus.click();
  await expect(page.getByText('8 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
  await plus.click();
  await expect(page.getByText(/当前模板无法安全扩展到 9 页/)).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText(/模板最多支持 8 页/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('reuse-mobile.png'), fullPage: true });
  await expect(page.getByText(/模板最多支持 8 页/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('ten-page uploaded template accepts an explicit 100-page target @smoke', async ({ page }) => {
  await page.route('**/api/providers/models', route => route.fulfill({ json: {
    groups: [{ provider_id: 'managed-demo', models: [{ value: 'demo-model', label: 'Demo model' }] }],
  } }));
  await page.route('**/api/providers', route => route.fulfill({ json: {
    providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }],
  } }));
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/projects**', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [{
    id: 'uploaded-ten', name: 'Ten page PPTX', category: '我的模板', kind: 'uploaded', extension: 'pptx',
    compatibility: 'mapped', pages: 10, palette: { background: '#202020', accent: '#b08866', foreground: '#ffffff', muted: '#aaaaaa' },
    sampleTitles: ['Cover'], tags: [], pinned: false,
  }] } }));
  await page.goto('/ppt');
  await page.getByRole('button', { name: /＋ 新建|新建 PPT/ }).first().click();
  await page.getByRole('combobox', { name: 'LLM（必填）' }).selectOption('managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await page.getByRole('textbox', { name: '输入 Prompt' }).fill('请根据足量资料生成 100页的技术报告');
  await page.getByRole('button', { name: '下一步：选择模板与页数 →' }).click();
  await expect(page.getByText(/100 页/).first()).toBeVisible();
  await expect(page.getByText(/此模板最多支持 100 页/)).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
});

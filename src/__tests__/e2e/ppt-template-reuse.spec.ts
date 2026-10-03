import { expect, test, type Page } from '@playwright/test';

async function mockCreationPlanner(page: Page) {
  let project: Record<string, unknown> | null = null;
  await page.route('**/api/ppt/page-estimate', route => { const body = route.request().postDataJSON(); const requested = String(body.prompt).match(/(\d+)\s*(?:页|slides?)/i)?.[1]; return route.fulfill({json:{recommendation:{recommended:5,min:3,max:8,requested:requested ? Number(requested) : undefined,reason:'Fixture estimate'}}}); });
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const count = Number(body.pages || String(body.prompt).match(/(\d+)\s*页/)?.[1] || 5);
      project = { id: 'b'.repeat(32), title: 'Fixture', pages: count, status: 'outline_ready', inputKind: 'prompt', outline: Array.from({ length: count }, (_, index) => ({ id: String(index + 1), title: `Slide ${index + 1}`, focus: 'Source-backed point' })), deck: null };
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ json: url.pathname === '/api/ppt/projects' ? { projects: [] } : { project } });
  });
}

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
  await mockCreationPlanner(page);
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
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await page.getByRole('combobox', { name: 'LLM（必填）' }).selectOption('managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Four page PPTX/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  await page.getByRole('textbox', { name: '输入 Prompt' }).fill('Create a concise architecture review in 3 slides');
  const guidance = page.getByText(/原生模板 4 页，最多支持 8 页/);
  await guidance.scrollIntoViewIfNeeded();
  await expect(guidance).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reuse-desktop.png'), fullPage: true });
  await expect(page.getByText('3 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
  const plus = page.getByRole('button', { name: '增加页数', exact: true });
  await plus.click();
  await expect(page.getByText('4 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 返回模板' }).click();
  await page.getByRole('button', { name: /Ten page alternate/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  await expect(page.getByText('4 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 返回模板' }).click();
  await page.getByRole('button', { name: /Four page PPTX/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  await expect(page.getByText('4 页', { exact: true })).toBeVisible();
  await plus.click(); await plus.click(); await plus.click(); await plus.click();
  await expect(page.getByText('8 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
  await plus.click();
  await expect(page.getByText(/原生模板 4 页，最多支持 8 页/)).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText(/原生模板 4 页，最多支持 8 页/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('reuse-mobile.png'), fullPage: true });
  await expect(page.getByText(/原生模板 4 页，最多支持 8 页/)).toBeVisible();
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
  await mockCreationPlanner(page);
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [{
    id: 'uploaded-ten', name: 'Ten page PPTX', category: '我的模板', kind: 'uploaded', extension: 'pptx',
    compatibility: 'mapped', pages: 10, palette: { background: '#202020', accent: '#b08866', foreground: '#ffffff', muted: '#aaaaaa' },
    sampleTitles: ['Cover'], tags: [], pinned: false,
  }] } }));
  await page.goto('/ppt');
  await page.getByRole('button', { name: /＋ 新建|新建 PPT/ }).first().click();
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await page.getByRole('combobox', { name: 'LLM（必填）' }).selectOption('managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Ten page PPTX/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  await page.getByRole('textbox', { name: '输入 Prompt' }).fill('请根据足量资料生成 100页的技术报告');
  await expect(page.getByText(/100 页/).first()).toBeVisible();
  await expect(page.getByText(/原生模板 10 页，最多支持 100 页/)).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
});

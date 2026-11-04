import {test, expect, type Page} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';

async function workspace(page: Page) {
  const fixture = pptParityFixture();
  const project = fixture.projects.get('9'.repeat(32))!;
  project.status = 'completed';
  project.stage = 'completed';
  const second = structuredClone(project);
  second.id = '8'.repeat(32);
  second.title = 'Second presentation';
  fixture.projects.set(second.id, second);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const response = await fixture.handle(request.method(), new URL(request.url()).pathname,
      request.postData() ? request.postDataJSON() : {});
    await route.fulfill({status: response?.status || 200,
      contentType: response?.contentType || 'application/json',
      body: response ? typeof response.body === 'string' ? response.body : JSON.stringify(response.body) : '{}'});
  });
  await page.goto('/ppt', {waitUntil: 'domcontentloaded'});
  await expect(page.getByTestId('ppt-project-card')).toHaveCount(2,{timeout:30000});
  return errors;
}

test('PPT card opens the visual editor directly and returns to the library @smoke', async ({page}, info) => {
  const errors = await workspace(page);
  await page.getByRole('heading', {name: 'Workflow fixture', exact: true}).click();
  await expect(page.getByTestId('ppt-structured-editor')).toBeVisible();
  await expect(page.getByRole('dialog', {name: '项目详情'})).toHaveCount(0);
  await page.screenshot({path: info.outputPath('direct-editor.png')});
  await page.getByRole('button', {name: '返回工作区', exact: true}).click();
  await expect(page.getByTestId('ppt-project-card')).toHaveCount(2);
  await expect(page.getByTestId('ppt-structured-editor')).toHaveCount(0);
  await expect(page.getByRole('dialog', {name: '项目详情'})).toHaveCount(0);
  await page.getByRole('button', {name: '列表视图', exact: true}).click();
  await page.getByRole('heading', {name: 'Workflow fixture', exact: true}).click();
  await expect(page.getByTestId('ppt-structured-editor')).toBeVisible();
  await expect(page.getByRole('dialog', {name: '项目详情'})).toHaveCount(0);
  await page.getByRole('button', {name: '返回工作区', exact: true}).click();
  await expect(page.getByTestId('ppt-project-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('PPT checkboxes reveal per card on hover or keyboard focus and stay visible when selected @smoke', async ({page}, info) => {
  const errors = await workspace(page);
  const cards = page.getByTestId('ppt-project-card');
  const first = cards.filter({has: page.getByRole('heading', {name: 'Workflow fixture', exact: true})});
  const second = cards.filter({has: page.getByRole('heading', {name: 'Second presentation', exact: true})});
  const checkbox = first.getByRole('checkbox');
  await page.mouse.move(0, 0);
  await expect(checkbox).toHaveCSS('opacity', '0');
  await expect(second.getByRole('checkbox')).toHaveCSS('opacity', '0');
  await page.screenshot({path: info.outputPath('checkboxes-hidden.png')});
  await first.hover();
  await expect(checkbox).toHaveCSS('opacity', '1');
  await expect(second.getByRole('checkbox')).toHaveCSS('opacity', '0');
  await checkbox.check();
  await second.hover();
  await expect(checkbox).toHaveCSS('opacity', '1');
  await expect(checkbox).toBeChecked();
  await expect(page.getByTestId('ppt-structured-editor')).toHaveCount(0);
  await expect(page.getByText(/已选择\s*1\s*个项目/)).toBeVisible();
  await second.getByRole('checkbox').check();
  await expect(page.getByText(/已选择\s*2\s*个项目/)).toBeVisible();
  await expect(page.getByRole('button', {name: '移至文件夹', exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('selected-batch-actions.png')});
  await page.getByRole('button', {name: '取消选择', exact: true}).click();
  await page.mouse.move(0, 0);
  // Move focus outside the card before checking the resting appearance.
  await page.getByRole('textbox', {name: /搜索/}).focus();
  await expect(checkbox).toHaveCSS('opacity', '0');
  await checkbox.focus();
  await expect(checkbox).toHaveCSS('opacity', '1');
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  expect(errors).toEqual([]);
});

test('touch devices retain an accessible PPT selection control @smoke', async ({browser}, info) => {
  const context = await browser.newContext({baseURL: String(info.project.use.baseURL), viewport: {width: 480, height: 800}, hasTouch: true, isMobile: true});
  try {
    const page = await context.newPage();
    const errors = await workspace(page);
    const card = page.getByTestId('ppt-project-card').first();
    await expect(card.getByRole('checkbox')).toHaveCSS('opacity', '1');
    await card.getByRole('checkbox').check();
    await expect(page.getByTestId('ppt-structured-editor')).toHaveCount(0);
    await page.screenshot({path: info.outputPath('touch-selection.png'), fullPage: true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

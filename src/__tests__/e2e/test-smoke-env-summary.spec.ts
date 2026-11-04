import { test, expect } from '@playwright/test';
import { goToChat } from '../helpers';

const projectPath = '/Users/dev/projects/fmrms-sit';
const sitUrl = 'https://fhrms-di1.sit.cmft.com/index';

test.describe('Smoke task environment summary', () => {
  let requestedEnvs: string[];

  test.beforeEach(async ({ page }) => {
    requestedEnvs = [];
    await page.route('**/api/test/workbench', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: [{
            name: 'fmrms-sit',
            path: projectPath,
            selectedEnv: 'sit',
            tasks: [],
          }],
          taskStates: {},
        }),
      });
    });
    await page.route('**/api/test-accounts/project-summaries', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          systems: [{
            id: 'risk-system',
            name: '风险',
            project_root: projectPath,
          }],
        }),
      });
    });
    await page.route('**/api/test/env-config?**', async (route) => {
      const requestUrl = new URL(route.request().url());
      expect(requestUrl.searchParams.get('projectPath')).toBe(projectPath);
      const requestedEnv = requestUrl.searchParams.get('env') || 'local';
      requestedEnvs.push(requestedEnv);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: requestedEnv === 'sit',
          env: requestedEnv,
          frontendBaseUrl: requestedEnv === 'sit' ? sitUrl : null,
          allowedEnvs: ['local', 'sit'],
          source: 'db',
          loginState: {
            account: requestedEnv === 'sit' ? 'role1' : null,
            hasState: requestedEnv === 'sit',
            expired: false,
            capturedAtMs: requestedEnv === 'sit' ? Date.parse('2026-07-27T15:12:00.000Z') : null,
          },
        }),
      });
    });
  });

  test('dashboard and new-task modal show the selected SIT URL and captured login state @smoke', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await goToChat(page);
    await page.getByRole('button', { name: /^(Test|测试|測試)$/ }).click();
    await page.getByTestId('test-project-card').click();
    await page.getByRole('button', { name: /^(Smoke|冒烟测试|冒煙測試)$/ }).click();

    await expect.poll(() => requestedEnvs.at(-1)).toBe('sit');
    const summary = page.getByTestId('test-smoke-env-summary');
    await expect(summary.getByText(sitUrl, { exact: true })).toBeVisible();
    await expect(summary.getByText(/^(Captured|已捕获|已擷取)$/)).toBeVisible();

    await page.getByRole('button', { name: /New smoke test|新建冒烟任务|新建冒煙任務/ }).click();
    await expect(page.getByRole('heading', { name: /New smoke test|新建冒烟任务|新建冒煙任務/ })).toBeVisible();
    const modal = page.getByTestId('test-smoke-env-modal');
    await expect(modal.getByText(sitUrl, { exact: true })).toBeVisible();
    await expect(modal.getByText(/^(Captured|已捕获|已擷取)$/)).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});

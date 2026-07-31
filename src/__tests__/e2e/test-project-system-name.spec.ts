import { test, expect } from '@playwright/test';
import { goToChat } from '../helpers';

const configuredPath = '/Users/dev/projects/forum-xc-sit';
const unconfiguredPath = '/Users/dev/projects/jiandao';

test.describe('Test project system name display', () => {
  test.beforeEach(async ({ page }) => {
    let configuredSystemName = '论坛管理系统';
    await page.route('**/api/test/workbench', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: [
            { name: 'forum-xc-sit', path: configuredPath, tasks: [] },
            { name: 'jiandao', path: unconfiguredPath, tasks: [] },
          ],
          taskStates: {},
        }),
      });
    });
    await page.route('**/api/test-accounts/project-summaries', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          systems: [
            {
              id: 'forum-system',
              name: configuredSystemName,
              project_root: `${configuredPath}/`,
            },
          ],
        }),
      });
    });
    await page.route('**/api/test-accounts/resolve?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          system: {
            id: 'forum-system',
            name: configuredSystemName,
            project_root: configuredPath,
            sort_order: 0,
            environments: {
              local: {
                label: 'Local',
                frontendBaseUrl: '',
                apiBaseUrl: '',
                healthEndpoint: '/',
                defaultAccountKey: '',
                accounts: [],
              },
              sit: {
                label: 'SIT',
                frontendBaseUrl: '',
                apiBaseUrl: '',
                healthEndpoint: '/',
                defaultAccountKey: '',
                accounts: [],
              },
            },
            created_at: '2026-07-30T00:00:00.000Z',
            updated_at: '2026-07-30T00:00:00.000Z',
          },
          projectPath: configuredPath,
        }),
      });
    });
    await page.route('**/api/test-accounts/forum-system', async (route) => {
      const body = route.request().postDataJSON() as { name: string };
      configuredSystemName = body.name;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          system: {
            id: 'forum-system',
            name: configuredSystemName,
            project_root: configuredPath,
            sort_order: 0,
            environments: {
              local: {
                label: 'Local',
                frontendBaseUrl: '',
                apiBaseUrl: '',
                healthEndpoint: '/',
                defaultAccountKey: '',
                accounts: [],
              },
              sit: {
                label: 'SIT',
                frontendBaseUrl: '',
                apiBaseUrl: '',
                healthEndpoint: '/',
                defaultAccountKey: '',
                accounts: [],
              },
            },
            created_at: '2026-07-30T00:00:00.000Z',
            updated_at: '2026-07-30T00:00:00.000Z',
          },
        }),
      });
    });
    await page.route('**/api/test-accounts/forum-system/export', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, path: `${configuredPath}/AI_LabTest/environments.json` }),
      });
    });
  });

  test('system name is primary while folder identity remains visible @smoke', async ({ page }) => {
    await goToChat(page);
    await page.getByRole('button', { name: /^(Test|测试|測試)$/ }).click();

    const cards = page.getByTestId('test-project-card');
    await expect(cards).toHaveCount(2);

    await expect(cards.nth(0).getByTestId('test-project-display-name')).toHaveText('论坛管理系统');
    await expect(cards.nth(0).getByTestId('test-project-folder-name')).toHaveText('forum-xc-sit');
    await expect(cards.nth(0)).toContainText(configuredPath);

    await expect(cards.nth(1).getByTestId('test-project-display-name')).toHaveText('jiandao');
    await expect(cards.nth(1).getByTestId('test-project-folder-name')).toHaveText(
      /System name not configured|未配置系统名称|未配置系統名稱/,
    );
    await expect(cards.nth(1)).toContainText(unconfiguredPath);

    await cards.nth(0).click();
    await expect(page.getByRole('heading', { name: '论坛管理系统' })).toBeVisible();
    await expect(page.getByText('forum-xc-sit', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Environment Config|环境配置|環境配置/ }).click();
    const nameInput = page.getByLabel(/System Name|系统名称|系統名稱/);
    await nameInput.fill('新版论坛系统');
    await page.getByRole('button', { name: /Save & Sync|保存并同步|保存並同步/ }).click();
    await expect(page.getByRole('heading', { name: '新版论坛系统' })).toBeVisible();
  });

  test('summary request failure falls back to folder names @smoke', async ({ page }) => {
    await page.unroute('**/api/test-accounts/project-summaries');
    await page.route('**/api/test-accounts/project-summaries', (route) => route.abort('failed'));

    await goToChat(page);
    await page.getByRole('button', { name: /^(Test|测试|測試)$/ }).click();

    const cards = page.getByTestId('test-project-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByTestId('test-project-display-name')).toHaveText('forum-xc-sit');
    await expect(cards.nth(0).getByTestId('test-project-folder-name')).toHaveText(
      /System name not configured|未配置系统名称|未配置系統名稱/,
    );
    await expect(cards.nth(1).getByTestId('test-project-display-name')).toHaveText('jiandao');
  });
});

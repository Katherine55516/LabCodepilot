import { test, expect, type Page } from '@playwright/test';
import { goToChat } from '../helpers';

const projectPath = '/Users/dev/projects/smoke-auth-stop';
const taskId = 'smoke-auth-stop-task';
const taskName = '风险-冒烟';

const taskState = () => ({
  stepStatus: { requirement: 'done', cases: 'done', execution: 'idle', report: 'idle' },
  convo: [],
  fourState: { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 },
  currentCase: '',
  caseResults: [],
  circuitBroken: false,
  notes: [],
  moduleEntry: '左侧导航「风险管理」',
});

const sse = (events: Array<{ type: string; data: string }>) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

async function mockWorkbench(page: Page) {
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
          tasks: [{ id: taskId, name: taskName, type: 'smoke' }],
        }],
        taskStates: { [taskId]: taskState() },
      }),
    });
  });
  await page.route('**/api/test-accounts/project-summaries', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ systems: [{ id: 'risk', name: '风险', project_root: projectPath }] }),
  }));
  await page.route('**/api/test/env-config?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      configured: true,
      env: 'sit',
      frontendBaseUrl: 'https://sit.example.com',
      allowedEnvs: ['local', 'sit'],
      source: 'db',
      loginState: { account: 'role1', hasState: true, expired: false, capturedAtMs: Date.now() },
    }),
  }));
  await page.route('**/api/test/cases?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      cases: [
        { id: 'SM-001', purpose: '进入风险列表', steps: [{ expected: '列表可见' }] },
        { id: 'SM-002', purpose: '新增风险', steps: [{ expected: '新增成功' }] },
      ],
    }),
  }));
  for (const pattern of ['**/api/test/audit', '**/api/test/stats']) {
    await page.route(pattern, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true}',
    }));
  }
}

async function openSmokeTask(page: Page) {
  await goToChat(page);
  await page.getByRole('button', { name: /^(Test|测试|測試)$/ }).click();
  await page.getByTestId('test-project-card').click();
  await page.getByRole('button', { name: /^(Smoke|冒烟测试|冒煙測試)$/ }).click();
  await page.getByRole('button', { name: new RegExp(taskName) }).click();
}

test.describe('Smoke auth-invalid hard stop', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkbench(page);
  });

  test('structured auth-invalid event stops execution and never requests the smoke report @smoke', async ({ page }) => {
    const steps: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.route('**/api/test/run', async (route) => {
      const body = route.request().postDataJSON() as { step?: string };
      steps.push(body.step || '');
      expect(body.step).toBe('execution');
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
          {
            type: 'text',
            data: '页面重定向至登录页，确认整站登录态失效。\n',
          },
          { type: 'auth_invalid', data: 'login_state_invalid' },
          { type: 'text', data: '▶ 场景 2/2：结构化事件后的毒丸不得显示\n@@RESULT {"id":"SM-002","status":"pass"}\n' },
        ]),
      });
    });

    await openSmokeTask(page);

    await expect.poll(() => steps).toEqual(['execution']);
    await expect(page.getByTestId('test-convo-error')).toContainText(
      /Smoke test stopped|冒烟测试已停止|冒煙測試已停止/,
    );
    await expect(page.getByTestId('test-step-execution')).toContainText(/Failed|失败|失敗/);
    await expect(page.getByTestId('test-step-report')).toContainText(/Not started|未开始|未開始/);
    await expect(page.getByText('▶ 场景 2/2：结构化事件后的毒丸不得显示', { exact: true })).toHaveCount(0);

    // 给 auto-chain 足够时间触发；若 execution 被误收口为 done，这里会出现 report 请求。
    await page.waitForTimeout(800);
    expect(steps).toEqual(['execution']);
    expect(consoleErrors).toEqual([]);
  });

  test('text marker stops the current frame before later scenario output @smoke', async ({ page }) => {
    const steps: string[] = [];
    await page.route('**/api/test/run', async (route) => {
      const body = route.request().postDataJSON() as { step?: string };
      steps.push(body.step || '');
      expect(body.step).toBe('execution');
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([{
          type: 'text',
          data: '@@AUTH_INVALID {"reason":"login_state_invalid"}\n▶ 场景 2/2：文本标记后的毒丸不得显示\n',
        }]),
      });
    });

    await openSmokeTask(page);

    await expect(page.getByTestId('test-convo-error')).toContainText(
      /Smoke test stopped|冒烟测试已停止|冒煙測試已停止/,
    );
    await expect(page.getByTestId('test-step-execution')).toContainText(/Failed|失败|失敗/);
    await expect(page.getByTestId('test-step-report')).toContainText(/Not started|未开始|未開始/);
    await expect(page.getByText('▶ 场景 2/2：文本标记后的毒丸不得显示', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(steps).toEqual(['execution']);
  });

  test('legacy all-blocked run_json with explicit login-wall evidence also skips report @smoke', async ({ page }) => {
    const steps: string[] = [];
    await page.route('**/api/test/run', async (route) => {
      const body = route.request().postDataJSON() as { step?: string };
      steps.push(body.step || '');
      expect(body.step).toBe('execution');
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([{
          type: 'run_json',
          data: JSON.stringify({
            counts: { total: 2, pass: 0, fail: 0, partial: 0, blocked: 2 },
            tests: [
              { id: 'SM-001', status: 'blocked', error: '页面重定向至登录页，登录态已失效' },
              { id: 'SM-002', status: 'blocked', error: '用例未执行' },
            ],
            circuitBroken: false,
          }),
        }]),
      });
    });

    await openSmokeTask(page);

    await expect(page.getByTestId('test-convo-error')).toContainText(
      /Smoke test stopped|冒烟测试已停止|冒煙測試已停止/,
    );
    await expect(page.getByTestId('test-step-execution')).toContainText(/Failed|失败|失敗/);
    await expect(page.getByTestId('test-step-report')).toContainText(/Not started|未开始|未開始/);
    await page.waitForTimeout(800);
    expect(steps).toEqual(['execution']);
  });

  test('single-endpoint 401 in an all-blocked legacy run still generates a report @smoke', async ({ page }) => {
    const steps: string[] = [];
    await page.route('**/api/test/run', async (route) => {
      const body = route.request().postDataJSON() as { step?: string };
      const step = body.step || '';
      steps.push(step);
      if (step === 'execution') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse([{
            type: 'run_json',
            data: JSON.stringify({
              counts: { total: 2, pass: 0, fail: 0, partial: 0, blocked: 2 },
              tests: [
                { id: 'SM-001', status: 'blocked', error: '单个认证接口返回 401 Unauthorized，其他页面可访问' },
                { id: 'SM-002', status: 'blocked', error: '依赖场景未通过' },
              ],
              circuitBroken: false,
            }),
          }]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([{ type: 'text', data: '冒烟报告已生成。\n' }]),
      });
    });

    await openSmokeTask(page);

    await expect.poll(() => steps, { timeout: 5_000 }).toEqual(['execution', 'report']);
    await expect(page.getByTestId('test-convo-error')).toHaveCount(0);
  });

  test('normal smoke execution still auto-chains to report @smoke', async ({ page }) => {
    const steps: string[] = [];
    await page.route('**/api/test/run', async (route) => {
      const body = route.request().postDataJSON() as { step?: string };
      const step = body.step || '';
      steps.push(step);
      if (step === 'execution') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse([
            { type: 'text', data: '@@RESULT {"id":"SM-001","status":"pass"}\n' },
            {
              type: 'run_json',
              data: JSON.stringify({
                counts: { total: 1, pass: 1, fail: 0, partial: 0, blocked: 0 },
                tests: [{ id: 'SM-001', status: 'pass' }],
                circuitBroken: false,
              }),
            },
          ]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([{ type: 'text', data: '冒烟报告已生成。\n' }]),
      });
    });

    await openSmokeTask(page);
    await expect.poll(() => steps, { timeout: 5_000 }).toEqual(['execution', 'report']);
  });
});

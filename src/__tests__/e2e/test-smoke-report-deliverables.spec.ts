import { test, expect, type Page } from '@playwright/test';
import { goToChat } from '../helpers';

const projectPath = '/Users/dev/projects/report-deliverables';
const env = 'sit';

const smokeTask = {
  id: 'smoke-report-task',
  name: '风险-冒烟报告',
  type: 'smoke' as const,
};
const functionalTask = {
  id: 'functional-report-task',
  name: '风险-功能报告',
};

const counts = { total: 2, pass: 1, fail: 1, partial: 0, blocked: 0 };
const smokeResults = [
  {
    id: 'SM-001',
    status: 'pass',
    actual: '风险列表正常展示',
    error: '',
    evidence: [],
  },
  {
    id: 'SM-002',
    status: 'fail',
    actual: '保存时接口返回 500',
    error: '新增风险失败',
    evidence: [],
  },
];
const functionalResults = smokeResults.map((result, index) => ({
  ...result,
  id: `TC-${String(index + 1).padStart(3, '0')}`,
  evidence: [],
}));

const smokeMarkdown = `# 风险模块冒烟测试报告

## 一、测试环境与执行时间

- 环境：SIT
- 地址：https://sit.example.com

## 二、场景结果表

| 场景 | 结论 |
| --- | --- |
| SM-001 | 通过 |
| SM-002 | 失败 |

## 三、Bug 清单

- BUG-01：新增风险失败

## 四、奇怪交互 / 体验问题

无。

## 五、整体结论

主流程未通过，暂不具备进一步测试条件。

完整报告末尾校验标记：SMOKE_REPORT_END
`;

const functionalMarkdown = `# 风险模块功能测试报告

功能测试仍保留报告、执行矩阵、缺陷报告和回归脚本四类产物。
`;

type ReportVariant = 'smoke' | 'functional';

function taskState(variant: ReportVariant) {
  return {
    stepStatus: { requirement: 'done', cases: 'done', execution: 'done', report: 'done' },
    convo: [],
    fourState: counts,
    currentCase: '',
    caseResults: variant === 'smoke' ? smokeResults : functionalResults,
    circuitBroken: false,
    notes: [],
    ...(variant === 'smoke' ? { moduleEntry: '左侧导航「风险管理」' } : {}),
  };
}

function reportEntry(variant: ReportVariant) {
  const task = variant === 'smoke' ? smokeTask : functionalTask;
  return {
    task: task.name,
    env,
    time: '2026-07-31T08:00:00.000Z',
    status: 'failed',
    passStr: '1/2',
    counts,
    funcCounts: counts,
    funcPassStr: '1/2',
    regressionTotal: 0,
    circuitBroken: false,
    tests: variant === 'smoke' ? smokeResults : functionalResults,
    runHash: `${variant}-run-hash`,
    markdown: variant === 'smoke' ? smokeMarkdown : functionalMarkdown,
    defectMarkdown: '',
    observations: [],
  };
}

async function mockCompletedReport(page: Page, variant: ReportVariant) {
  const task = variant === 'smoke' ? smokeTask : functionalTask;
  let defectPosts = 0;
  let scriptGets = 0;

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
          selectedEnv: env,
          tasks: [task],
        }],
        taskStates: { [task.id]: taskState(variant) },
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
      env,
      frontendBaseUrl: 'https://sit.example.com',
      allowedEnvs: ['local', env],
      source: 'db',
      loginState: { account: 'role1', hasState: true, expired: false, capturedAtMs: Date.now() },
    }),
  }));
  await page.route('**/api/test/cases?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      cases: (variant === 'smoke' ? smokeResults : functionalResults).map((result, index) => ({
        id: result.id,
        purpose: index === 0 ? '进入风险列表' : '新增风险',
        steps: [{ expected: index === 0 ? '列表可见' : '新增成功' }],
      })),
    }),
  }));
  await page.route('**/api/test/reports?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reports: [reportEntry(variant)] }),
  }));
  await page.route('**/api/test/bugs?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      runHash: `${variant}-run-hash`,
      bugs: [{
        id: 'BUG-01',
        sceneId: 'SM-002',
        title: '新增风险失败',
        severity: '严重',
        actual: '保存时接口返回 500',
        expected: '新增成功',
        evidence: [],
      }],
    }),
  }));
  await page.route('**/api/test/scripts?**', (route) => {
    if (route.request().method() === 'GET') scriptGets += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ manifest: null }),
    });
  });
  await page.route('**/api/test/defect', (route) => {
    if (route.request().method() === 'POST') defectPosts += 1;
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'text', data: '缺陷报告已生成。' })}\n\n`,
    });
  });
  for (const pattern of ['**/api/test/audit**', '**/api/test/stats**']) {
    await page.route(pattern, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true}',
    }));
  }

  return {
    defectPosts: () => defectPosts,
    scriptGets: () => scriptGets,
  };
}

async function openCompletedTask(page: Page, variant: ReportVariant) {
  const task = variant === 'smoke' ? smokeTask : functionalTask;
  await goToChat(page);
  await page.getByRole('button', { name: /^(Test|测试|測試)$/ }).click();
  await page.getByTestId('test-project-card').click();
  await page.getByRole('button', {
    name: variant === 'smoke'
      ? /^(Smoke|Smoke test|冒烟测试|冒煙測試)$/i
      : /^(Functional|Functional test|功能测试|功能測試)$/i,
  }).click();
  await page.getByRole('button', { name: new RegExp(task.name) }).click();
}

test.describe('Smoke report deliverables', () => {
  test('smoke report is one card, has no defect/script side effects, and opens the full Markdown @smoke', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const calls = await mockCompletedReport(page, 'smoke');
    await openCompletedTask(page, 'smoke');

    const card = page.getByTestId('smoke-report-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('smoke-report-bug-count')).toContainText('1');
    await expect(page.getByTestId('test-report-deliverable')).toHaveCount(0);
    await expect(card.getByText(/用例总数|場景總數|Case count|Passed scenarios|Failed scenarios|Blocked scenarios/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /交给研发修复|交給研發修復|Hand off/i })).toHaveCount(0);
    await expect(page.getByText(/回归自动化脚本|迴歸自動化腳本|Regression automation scripts/i)).toHaveCount(0);

    // 报告卡可见意味着 reports 请求已经完成；再留一个事件循环窗口，捕获错误实现中的
    // 自动缺陷生成和脚本轮询副作用。
    await page.waitForTimeout(400);
    expect(calls.defectPosts()).toBe(0);
    expect(calls.scriptGets()).toBe(0);

    await page.getByTestId('smoke-report-view').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '风险模块冒烟测试报告' })).toBeVisible();
    await expect(dialog.getByText('完整报告末尾校验标记：SMOKE_REPORT_END')).toBeVisible();
    const bugHeading = dialog.getByRole('heading', { name: '三、Bug 清单' });
    const bugTable = bugHeading.locator('xpath=following::table[1]');
    for (const header of ['编号', '标题', '严重级别', '关联场景', '实际', '预期', '接口', '证据']) {
      await expect(bugTable.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }
    await expect(bugTable.getByRole('cell', { name: 'BUG-01', exact: true })).toBeVisible();
    await expect(dialog).not.toContainText('<br>');
    await bugHeading.scrollIntoViewIfNeeded();
    await testInfo.attach('smoke-report-bug-table', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(consoleErrors).toEqual([]);
  });

  test('legacy functional task keeps four deliverable cards and existing defect/script behavior @smoke', async ({ page }) => {
    const calls = await mockCompletedReport(page, 'functional');
    await openCompletedTask(page, 'functional');

    await expect(page.getByTestId('smoke-report-card')).toHaveCount(0);
    await expect(page.getByTestId('test-report-deliverable')).toHaveCount(4);
    await expect(page.getByText(`${functionalTask.name}-${env}-执行矩阵.xlsx`, { exact: true })).toBeVisible();
    await expect(page.getByText(`AI_LabTest/scripts/${functionalTask.name}/${env}/`, { exact: true })).toBeVisible();

    await expect.poll(calls.defectPosts).toBe(1);
    await expect.poll(calls.scriptGets).toBeGreaterThan(0);
  });

  test('report browser keeps smoke as the same single report without compare, defect, or handoff actions @smoke', async ({ page }) => {
    const calls = await mockCompletedReport(page, 'smoke');
    await goToChat(page);
    await page.getByRole('button', { name: /^(Test|测试|測試)$/ }).click();
    await page.getByRole('button', { name: /^(Reports?|报告|報告)$/ }).click();
    await expect(page.getByText(smokeTask.name, { exact: true })).toBeVisible();

    const envRow = page.getByRole('button').filter({ hasText: /sit/i }).filter({ hasText: /Bug/i }).first();
    await envRow.click();
    const card = page.getByTestId('smoke-report-card');
    await expect(card).toBeVisible();
    await expect(card.getByText(/用例总数|場景總數|Case count|Passed scenarios|Failed scenarios|Blocked scenarios/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /对比|比較|Compare|缺陷报告|缺陷報告|Defect report|交给研发修复|交給研發修復|Hand off/i })).toHaveCount(0);

    await page.waitForTimeout(400);
    expect(calls.defectPosts()).toBe(0);
    expect(calls.scriptGets()).toBe(0);

    await card.getByTestId('smoke-report-view').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bugTable = dialog.getByRole('heading', { name: '三、Bug 清单' }).locator('xpath=following::table[1]');
    await expect(bugTable.getByRole('cell', { name: 'BUG-01', exact: true })).toBeVisible();
  });
});

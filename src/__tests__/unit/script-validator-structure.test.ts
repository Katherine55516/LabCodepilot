/**
 * Regression guards for the static script validator's structure rules.
 *
 * Reproduces the real 2026-07-11 failure: the gateway model split one case into
 * multiple `test()` blocks with step-titles, so the manifest recorded
 * 「每个脚本必须恰好一个 test(); test 标题必须包含用例 ID」 and the task stayed 存在缺口
 * at 0/1. These tests pin (a) that shape is rejected with exactly those messages,
 * (b) the conforming shape — one top-level test whose title starts with the case
 * ID, steps segmented via test.step — passes and is NOT mis-counted as multiple
 * tests, and (c) test.step / test.describe do not inflate the `test()` count.
 *
 * Run with: npx tsx --test src/__tests__/unit/script-validator-structure.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateScriptSource, touchesPage } from '../../lib/test/script-validator';

const ID = 'TC-employee-001';

describe('validateScriptSource · 结构规则', () => {
  it('多个 test() + 首个标题缺用例 ID → 命中「恰好一个 test()」与「标题含用例 ID」', () => {
    const bad = `import { test, expect } from 'playwright/test';
test('步骤1：进入员工信息页', async ({ page }) => {
  await page.goto('/employee');
  await expect(page.getByRole('button', { name: '查询', exact: true })).toBeVisible();
});
test('步骤2：新增员工', async ({ page }) => {
  await expect(page.getByText('新增员工', { exact: true })).toBeVisible();
});`;
    const r = validateScriptSource(bad, ID);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('每个脚本必须恰好一个 test()'), '应命中恰好一个 test()');
    assert.ok(r.errors.includes('test 标题必须包含用例 ID'), '应命中标题含用例 ID');
  });

  it('规范结构:一个顶层 test + test.step 分步 + 标题以 ID 开头 → 通过', () => {
    const good = `import { test, expect } from 'playwright/test';
test('${ID} 进入员工信息页默认加载全量列表', async ({ page }) => {
  await test.step('步骤1：导航', async () => {
    await page.goto('/employee');
    await expect(page.getByRole('button', { name: '查询', exact: true })).toBeVisible();
  });
  await test.step('步骤2：查询', async () => {
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByTestId('employee-table')).toBeVisible();
  });
});`;
    const r = validateScriptSource(good, ID);
    assert.deepEqual(r.errors, [], `不应有错误，实际: ${r.errors.join(' | ')}`);
    assert.equal(r.ok, true);
  });

  it('test.step 与 test.describe 不被计入 test() 数量', () => {
    const withSteps = `import { test, expect } from 'playwright/test';
test('${ID} x', async ({ page }) => {
  await test.step('a', async () => { await expect(page).toHaveURL(/./); });
  await test.step('b', async () => { await expect(page).toHaveURL(/./); });
});`;
    const r = validateScriptSource(withSteps, ID);
    assert.ok(!r.errors.includes('每个脚本必须恰好一个 test()'), 'test.step 不应触发多 test 判定');
    assert.equal(r.ok, true);
  });

  it('导入 @playwright/test 或多余模块 → 拒绝(归一化在生成/修复层已处理，这里守校验底线)', () => {
    const bad = `import { test, expect } from '@playwright/test';
import path from 'path';
test('${ID} x', async () => { expect(1).toBe(1); });`;
    const r = validateScriptSource(bad, ID);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('不允许 import 该模块')), '应拒绝多余模块 import');
  });
});

describe('语义化定位器警告只对操作页面的脚本生效', () => {
  const SEMANTIC = '未使用语义化定位器';

  it('纯 API 接口测试（request fixture、零 page.）不报该警告', () => {
    // 真机:TC-001/006/026/040/085 等 API 用例走 request fixture,断言 HTTP 状态码与
    // 响应体,根本没有 DOM 定位器。此前无条件检查 → 每条稳定挂一条假警告 → 恒被压成
    // needs_review,把真正需要人工复核的信号淹掉。
    const api = `import { test, expect } from "playwright/test";

test('${ID} 验证 GET /api/subjects 返回 200', async ({ request }) => {
  const res = await request.get('/api/subjects');
  expect(res.status()).toBe(200);
});`;
    const r = validateScriptSource(api, ID);
    assert.equal(r.ok, true, '合法 API 脚本应通过');
    assert.equal(r.warnings.some((w) => w.includes(SEMANTIC)), false, 'API 测试不该被要求语义化定位器');
    assert.equal(r.needsReview, false, '不该因这条假警告被压成待复核');
  });

  it('UI 脚本没用语义化定位器时照常告警', () => {
    const ui = `import { test, expect } from "playwright/test";

test('${ID} 验证列表渲染', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.card-grid')).toBeVisible();
});`;
    const r = validateScriptSource(ui, ID);
    assert.equal(r.warnings.some((w) => w.includes(SEMANTIC)), true, 'UI 脚本仍须被要求语义化定位器');
  });

  it('混合型（{ page, request }）按 UI 口径检查 —— 它有真实页面操作', () => {
    const mixed = `import { test, expect } from "playwright/test";

test('${ID} 建数据再验渲染', async ({ page, request }) => {
  await request.post('/api/subjects', { data: { name: 'x' } });
  await page.goto('/');
  await expect(page.locator('.item')).toBeVisible();
});`;
    const r = validateScriptSource(mixed, ID);
    assert.equal(r.warnings.some((w) => w.includes(SEMANTIC)), true, '混合型含 UI 操作,不得豁免');
  });

  it('touchesPage 判据:看是否真的调用 page.,而非 fixture 解构', () => {
    assert.equal(touchesPage('await page.goto("/")'), true);
    assert.equal(touchesPage('const res = await request.get("/api/x")'), false);
    // 只解构不使用 → 不算 UI 测试(没有任何页面操作可供衡量)
    assert.equal(touchesPage('test("t", async ({ page, request }) => { await request.get("/a"); })'), false);
  });
});

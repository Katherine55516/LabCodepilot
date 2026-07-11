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
import { validateScriptSource } from '../../lib/test/script-validator';

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

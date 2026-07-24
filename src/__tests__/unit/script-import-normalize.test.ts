/**
 * 生成脚本的 Playwright import 归一化。
 *
 * 回归背景：打包版实测中，模型为回归用例生成的脚本写了业界标准的
 * `@playwright/test`，但 script-runner 的临时目录只 symlink 了 @playwright/mcp
 * 自带的 `playwright` 包 —— `@playwright/test` 在那里不可解析，于是 validator 报
 * "module import is not allowed: @playwright/test"，整条用例 failed。
 * playwright/test.js 重导出同一套 test/expect，故重写 specifier 是语义等价的。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlaywrightImport } from '@/lib/test/script-generator';
import { validateScriptSource } from '@/lib/test/script-validator';

describe('normalizePlaywrightImport', () => {
  it('重写 import ... from "@playwright/test"（单双引号均可）', () => {
    assert.equal(
      normalizePlaywrightImport(`import { test, expect } from '@playwright/test';`),
      `import { test, expect } from 'playwright/test';`,
    );
    assert.equal(
      normalizePlaywrightImport(`import { test } from "@playwright/test";`),
      `import { test } from "playwright/test";`,
    );
  });

  it('重写 require() 与动态 import()', () => {
    assert.equal(normalizePlaywrightImport(`require('@playwright/test')`), `require('playwright/test')`);
    assert.equal(normalizePlaywrightImport(`import("@playwright/test")`), `import("playwright/test")`);
  });

  it('已经正确的 specifier 原样不动', () => {
    const src = `import { test, expect } from 'playwright/test';`;
    assert.equal(normalizePlaywrightImport(src), src);
  });

  it('不误伤字符串字面量里出现的同名文本', () => {
    // 只有出现在 from/require/import( 之后的 specifier 才应被重写。
    const src = `test('TC-1 提到 @playwright/test 这个包名', async () => {});`;
    assert.equal(normalizePlaywrightImport(src), src);
  });

  it('不误伤其他 @playwright/* 包（仍应被 validator 拒绝）', () => {
    const src = `import x from '@playwright/experimental-ct-react';`;
    assert.equal(normalizePlaywrightImport(src), src);
  });

  it('归一化后的脚本能通过 validateScriptSource（端到端契约）', () => {
    const generated = [
      `import { test, expect } from '@playwright/test';`,
      ``,
      `test('TC-regr-001 创建学科后列表出现该卡片', async ({ page }) => {`,
      `  await page.goto('/');`,
      `  await expect(page.getByText('自动化回归学科')).toBeVisible();`,
      `});`,
    ].join('\n');

    // 原样送检：正是打包版实测中失败的那条错误。
    const before = validateScriptSource(generated, 'TC-regr-001');
    assert.equal(before.ok, false);
    assert.ok(
      before.errors.some((e) => e.includes('@playwright/test')),
      `预期出现 @playwright/test 的 import 错误，实际: ${JSON.stringify(before.errors)}`,
    );

    // 归一化后应当放行。
    const after = validateScriptSource(normalizePlaywrightImport(generated), 'TC-regr-001');
    assert.deepEqual(after.errors, []);
    assert.equal(after.ok, true);
  });
});

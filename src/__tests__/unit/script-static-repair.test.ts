/**
 * Decision logic for the static-validation repair loop (resolveStaticValidContent).
 *
 * Background: the generation path previously had NO self-correction for
 * static-validation failures — one non-conforming output (multiple test(), title
 * without the case ID, stray import) dead-ended at `failed`, and 「重试缺口」 just
 * re-rolled the same prompt. This loop feeds the exact validator errors back to
 * the model once and re-validates, mirroring the runtime-repair closed loop.
 *
 * The repair fn is injected, so these tests exercise the branch logic without the
 * SDK: repair-fixes-it, repair-returns-null, repair-still-invalid, already-valid
 * (repair not called), and repair-rejects (abort → propagates).
 *
 * Run with: npx tsx --test src/__tests__/unit/script-static-repair.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStaticValidContent, isRunnableStatus, isFixableCase, isActiveRunFailure } from '../../lib/test/script-job-manager';

const ID = 'TC-employee-001';
const conforming = (id: string) =>
  `import { test, expect } from 'playwright/test';\ntest('${id} ok', async ({ page }) => { await expect(page).toHaveURL(/./); });`;
// Two test() blocks, first title without the ID → fails static validation.
const broken =
  `import { test, expect } from 'playwright/test';\ntest('step1', async () => { expect(1).toBe(1); });\ntest('step2', async () => { expect(2).toBe(2); });`;

describe('resolveStaticValidContent', () => {
  it('内容本就合规 → 直接采纳，绝不调用 repair', async () => {
    let called = false;
    const out = await resolveStaticValidContent({
      content: conforming(ID),
      scriptCaseId: ID,
      repair: async () => { called = true; return null; },
    });
    assert.equal(called, false, 'repair 不应被调用');
    assert.equal(out.repaired, false);
    assert.equal(out.check.ok, true);
    assert.equal(out.content, conforming(ID));
  });

  it('静态失败 → repair 修好 → 采纳修复稿，repaired=true', async () => {
    let seenErrors: string[] = [];
    const out = await resolveStaticValidContent({
      content: broken,
      scriptCaseId: ID,
      repair: async (errors) => { seenErrors = errors; return conforming(ID); },
    });
    assert.ok(seenErrors.includes('每个脚本必须恰好一个 test()'), 'repair 应收到真实校验错误');
    assert.equal(out.repaired, true);
    assert.equal(out.check.ok, true);
    assert.equal(out.content, conforming(ID));
  });

  it('静态失败 → repair 返回 null → 保留原内容与原始错误', async () => {
    const out = await resolveStaticValidContent({
      content: broken,
      scriptCaseId: ID,
      repair: async () => null,
    });
    assert.equal(out.repaired, false);
    assert.equal(out.check.ok, false);
    assert.equal(out.content, broken);
    assert.ok(out.check.errors.includes('每个脚本必须恰好一个 test()'));
  });

  it('静态失败 → repair 稿仍不合规 → 不采纳，保留原始错误（不静默放行坏稿）', async () => {
    const out = await resolveStaticValidContent({
      content: broken,
      scriptCaseId: ID,
      repair: async () => broken, // still two test()
    });
    assert.equal(out.repaired, false);
    assert.equal(out.check.ok, false);
    assert.equal(out.content, broken);
  });

  it('repair 抛错（如任务被取代/中止）→ 向上传播', async () => {
    await assert.rejects(
      () => resolveStaticValidContent({
        content: broken,
        scriptCaseId: ID,
        repair: async () => { throw new Error('aborted'); },
      }),
      /aborted/,
    );
  });
});

// 恢复态状态机契约：一个用例必须落在「可运行」或「可修复」至少一个通道里，否则永久卡死。
// 2026-07-11 review 发现：只读用例生成期重放失败被 dead-end 成 'failed'（无 lastRunError），
// 落在两个通道之外 → 卡 0/1。修复：可加载但重放失败的脚本落盘为 needs_review + lastRunError。
describe('恢复态状态机契约（isRunnableStatus / isFixableCase）', () => {
  it('verified / needs_review 可被运行；failed / outdated 不可运行', () => {
    assert.equal(isRunnableStatus('verified'), true);
    assert.equal(isRunnableStatus('needs_review'), true);
    assert.equal(isRunnableStatus('failed'), false);
    assert.equal(isRunnableStatus('outdated'), false);
  });

  it('带 lastRunError 才可被 AI 修复；无 lastRunError（如生成期 failed）不可修复', () => {
    assert.equal(isFixableCase({ lastRunError: 'Playwright 自动重放失败: …' }), true);
    assert.equal(isFixableCase({ lastRunError: undefined }), false);
    assert.equal(isFixableCase({}), false);
  });

  it('关键不变量：重放失败若落成 needs_review + lastRunError → 同时可运行且可修复（不再死胡同）', () => {
    const replayFailed = { status: 'needs_review' as const, lastRunError: 'Playwright 自动重放失败: net::ERR_CONNECTION_REFUSED' };
    assert.equal(isRunnableStatus(replayFailed.status), true, '应能被运行/重跑');
    assert.equal(isFixableCase(replayFailed), true, '应能被 AI 修复');
    // 反例：旧行为 dead-end 成 failed（无 lastRunError）→ 两个通道都进不去
    const deadEnd = { status: 'failed' as const, lastRunError: undefined };
    assert.equal(isRunnableStatus(deadEnd.status) || isFixableCase(deadEnd), false, '旧 failed 死态两通道皆不可达');
  });
});

// 化石隔离：lastRunError 只有长在【当前合格集内（可运行状态）】的条目上才算「本轮未跑通」。
// 真机踩坑 2026-07-14（mealAllowance「功能测试-回归测试串联」）：TC-employee-001 运行失败后被
// 摘掉回归标签 → stale 保留旧 lastRunError → unpassed/fixable/需人工计数照算它 →
// 合格集 1/1 全绿仍每轮报「1 需人工」+ partial +「部分回归脚本自动跑通未成功」，
// 且运行（stale 不可运行）/修复（判不在合格集内跳过）/重试缺口（只重生成合格用例）三通道全清不掉。
describe('化石隔离（isActiveRunFailure）', () => {
  it('可运行状态 + lastRunError → 是当前失败（verified 与 needs_review 都算）', () => {
    assert.equal(isActiveRunFailure({ status: 'verified', lastRunError: 'Error: expect(locator).toBeVisible() failed' }), true);
    assert.equal(isActiveRunFailure({ status: 'needs_review', lastRunError: 'Error: expect(locator).toBeVisible() failed' }), true);
  });

  it('stale/outdated/failed 条目的 lastRunError 是历史化石 → 不算当前失败', () => {
    assert.equal(isActiveRunFailure({ status: 'stale', lastRunError: 'Error: expect(locator).toBeVisible() failed' }), false);
    assert.equal(isActiveRunFailure({ status: 'outdated', lastRunError: 'Error: expect(locator).toBeVisible() failed' }), false);
    assert.equal(isActiveRunFailure({ status: 'failed', lastRunError: 'Error: …' }), false);
  });

  it('无 lastRunError 无论什么状态都不是失败', () => {
    assert.equal(isActiveRunFailure({ status: 'verified', lastRunError: undefined }), false);
    assert.equal(isActiveRunFailure({ status: 'stale', lastRunError: undefined }), false);
  });

  it('真机场景回放：合格集全绿 + 一条 stale 化石 → 任务不算「未跑通」', () => {
    const cases = [
      { status: 'verified' as const, lastRunError: undefined },                                        // TC-employee-034，通过
      { status: 'stale' as const, lastRunError: 'Error: expect(locator).toBeVisible() failed' },       // TC-employee-001，摘标签后的化石
    ];
    assert.equal(cases.some(isActiveRunFailure), false, '化石不得把任务钉在 partial');
    // 对照：同样的失败长在合格集内（needs_review）→ 如实算未跑通
    const active = [
      { status: 'verified' as const, lastRunError: undefined },
      { status: 'needs_review' as const, lastRunError: 'Error: expect(locator).toBeVisible() failed' },
    ];
    assert.equal(active.some(isActiveRunFailure), true, '合格集内的失败必须如实上报');
  });
});

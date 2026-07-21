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
import { resolveStaticValidContent, isRunnableStatus, isFixableCase, isCurrentRoundCase } from '../../lib/test/script-job-manager';

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
  it('verified / needs_review / outdated 可被运行；failed 不可运行', () => {
    assert.equal(isRunnableStatus('verified'), true);
    assert.equal(isRunnableStatus('needs_review'), true);
    // outdated 曾被断言为不可运行 —— 2026-07-21 真机推翻:该状态的定义就是「重新生成失败但
    // 盘上仍有可用旧脚本」,把它排除等于让一份好脚本掉出全部恢复通道(详见下方 outdated 组)。
    assert.equal(isRunnableStatus('outdated'), true);
    // failed 无落盘脚本,仍只能重新生成。
    assert.equal(isRunnableStatus('failed'), false);
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

describe('本轮口径 isCurrentRoundCase（终态判定不被历史条目污染）', () => {
  it('stale = 非本轮；其余状态都属于本轮', () => {
    assert.equal(isCurrentRoundCase({ status: 'stale' }), false);
    for (const st of ['verified', 'needs_review', 'failed', 'outdated'] as const) {
      assert.equal(isCurrentRoundCase({ status: st }), true, `${st} 应属于本轮`);
    }
  });

  it('回归：一条 stale 的陈年 lastRunError 不得把全通过的一轮判成未通过', () => {
    // 2026-07-21 真机：本轮 6/6 全 verified，但 7-14 留下的 stale 条目 TC-005 带着
    // ECONNREFUSED 的旧错误，`cases.some(c => c.lastRunError)` 全量扫描把 jobStatus
    // 判成 partial → 卡片常驻「存在缺口」，而用户在列表里找不到任何失败项。
    const cases = [
      { caseId: 'TC-026', status: 'verified' as const },
      { caseId: 'TC-051', status: 'verified' as const },
      { caseId: 'TC-005', status: 'stale' as const, lastRunError: 'ECONNREFUSED ::1:5173' },
    ];
    assert.equal(cases.some((c) => 'lastRunError' in c && c.lastRunError), true, '前提：全量扫描确实会命中');
    assert.equal(
      cases.filter(isCurrentRoundCase).some((c) => 'lastRunError' in c && c.lastRunError),
      false,
      '本轮口径下必须没有未通过项',
    );
  });
});

describe('outdated 不再是死态（有可用旧脚本就该有路可走）', () => {
  it('outdated 属于可运行态', () => {
    // 真机(2026-07-21):TC-051 点「重试」重新生成时撞上跨境坏窗口(网关 401 被 SDK 报成
    // `Not logged in`),落 outdated。此后那份完好的旧脚本掉出全部恢复通道 —— 不能运行
    // (此谓词曾排除它)、不能 AI 修复(无 lastRunError)、不能人工确认(非 needs_review),
    // 唯一出路是反复重试生成、反复赌网络。与 2026-07-11 修掉的 failed 死态同类。
    assert.equal(isRunnableStatus('outdated'), true);
    assert.equal(isRunnableStatus('verified'), true);
    assert.equal(isRunnableStatus('needs_review'), true);
  });

  it('failed 仍不可运行 —— 它没有落盘脚本,只能重新生成', () => {
    // outdated 与 failed 的分水岭就是「盘上有没有可用旧脚本」(两处产生点都以
    // fs.existsSync(finalFile) 为条件)。
    assert.equal(isRunnableStatus('failed'), false);
  });

  it('stale 仍不可运行(本轮未测,不该被批量动作拉去跑)', () => {
    assert.equal(isRunnableStatus('stale'), false);
  });

  it('恢复链:outdated 运行失败后落 lastRunError → AI 修复通道自然打开', () => {
    assert.equal(isFixableCase({ lastRunError: undefined }), false, '刚落 outdated 时无失败信息,不该喂给 AI');
    assert.equal(isFixableCase({ lastRunError: 'expect(locator).toBeVisible() failed' }), true, '跑失败后才可修');
  });
});

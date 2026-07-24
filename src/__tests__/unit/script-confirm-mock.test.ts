/**
 * 人工确认接口模拟脚本通过（confirmMockScripts）。
 *
 * 背景：执行时用了 `browser_route` 模拟接口的脚本，即使重放通过也不代表真实环境可通过，
 * 故 runScriptCases 刻意跳过对它们的 verified 提升（`if (!item.usesMock)`）。但平台此前
 * 只留下一句「需人工确认真实环境可通过」的警告、**没有任何地方能记录确认结果** —— 用户
 * 无论运行多少次都升不上去，状态永久钉死在 needs_review，与真正待修的脚本混在一起。
 *
 * 本组用例守护这个出口的边界：只放行「确实需要人工拍板」的条目，其余各有既有恢复通道，
 * 不得被一键"确认"绕过（否则它就成了掩盖真实缺陷的后门）。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confirmMockScripts } from '@/lib/test/script-job-manager';
import { writeManifest, readManifest, type ScriptManifest, type ScriptManifestCase } from '@/lib/test/script-artifacts';

const TASK = '订单';
const ENV = 'local';
let proj: string;

beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-mock-')); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const mkCase = (over: Partial<ScriptManifestCase> & { caseId: string }): ScriptManifestCase => ({
  file: `${over.caseId}.spec.ts`,
  fingerprint: 'fp',
  status: 'needs_review',
  usesMock: true,
  ...over,
});

const seed = (cases: ScriptManifestCase[]) => {
  const manifest: ScriptManifest = {
    version: 1, taskName: TASK, env: ENV, latestRunHash: 'hash1', jobKey: 'k',
    jobStatus: 'partial', generatorVersion: '1', templateVersion: '1', runtimeVersion: 'rt',
    createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
    counts: { eligible: cases.length, generated: cases.length, verified: 0, needsReview: cases.length, failed: 0 },
    cases,
  };
  writeManifest(proj, TASK, ENV, manifest);
};

describe('confirmMockScripts · 放行边界', () => {
  it('mock + 待复核 + 无失败记录 → 升为 verified 并留痕', async () => {
    seed([mkCase({ caseId: 'TC-051' })]);
    const { confirmed } = await confirmMockScripts({ projectPath: proj, taskName: TASK, env: ENV, caseIds: ['TC-051'] });
    assert.deepEqual(confirmed, ['TC-051']);

    const after = readManifest(proj, TASK, ENV)!;
    const c = after.cases[0];
    assert.equal(c.status, 'verified');
    assert.ok(c.manualVerifiedAt, '必须记录人工确认时刻（否则等于没留痕）');
    assert.equal(c.usesMock, true, 'usesMock 事实不得被抹掉 —— 确认的是「我认可」，不是「它没用过 mock」');
    assert.equal(after.counts.verified, 1);
    assert.equal(after.counts.needsReview, 0);
    assert.equal(after.jobStatus, 'done', '无未通过项 → 任务终态应收成 done');
  });

  it('非 mock 的待复核脚本拒绝确认（它有运行/AI 修复两条既有通道）', async () => {
    seed([mkCase({ caseId: 'TC-058', usesMock: false })]);
    await assert.rejects(
      () => confirmMockScripts({ projectPath: proj, taskName: TASK, env: ENV, caseIds: ['TC-058'] }),
      /非接口模拟脚本/,
    );
    assert.equal(readManifest(proj, TASK, ENV)!.cases[0].status, 'needs_review', '状态不得被改');
  });

  it('带运行失败记录的拒绝确认（不能用"确认"掩盖真实失败）', async () => {
    seed([mkCase({ caseId: 'TC-051', lastRunError: 'expect(locator).toBeVisible() failed' })]);
    await assert.rejects(
      () => confirmMockScripts({ projectPath: proj, taskName: TASK, env: ENV, caseIds: ['TC-051'] }),
      /存在运行失败记录/,
    );
    assert.equal(readManifest(proj, TASK, ENV)!.cases[0].status, 'needs_review');
  });

  it('已是 verified 的条目无需确认', async () => {
    seed([mkCase({ caseId: 'TC-051', status: 'verified' })]);
    await assert.rejects(
      () => confirmMockScripts({ projectPath: proj, taskName: TASK, env: ENV, caseIds: ['TC-051'] }),
      /无需确认/,
    );
  });

  it('批量时只放行合格项，其余进 skipped 且状态不变', async () => {
    seed([
      mkCase({ caseId: 'TC-051' }),
      mkCase({ caseId: 'TC-058', usesMock: false }),
      mkCase({ caseId: 'TC-060', lastRunError: 'boom' }),
    ]);
    const { confirmed, skipped } = await confirmMockScripts({
      projectPath: proj, taskName: TASK, env: ENV, caseIds: ['TC-051', 'TC-058', 'TC-060'],
    });
    assert.deepEqual(confirmed, ['TC-051']);
    assert.equal(skipped.length, 2);
    const byId = new Map(readManifest(proj, TASK, ENV)!.cases.map((c) => [c.caseId, c]));
    assert.equal(byId.get('TC-051')!.status, 'verified');
    assert.equal(byId.get('TC-058')!.status, 'needs_review');
    assert.equal(byId.get('TC-060')!.status, 'needs_review');
  });

  it('未点名的条目一律不动', async () => {
    seed([mkCase({ caseId: 'TC-051' }), mkCase({ caseId: 'TC-052' })]);
    await confirmMockScripts({ projectPath: proj, taskName: TASK, env: ENV, caseIds: ['TC-051'] });
    const byId = new Map(readManifest(proj, TASK, ENV)!.cases.map((c) => [c.caseId, c]));
    assert.equal(byId.get('TC-052')!.status, 'needs_review', '没点名的不得被顺带确认');
  });

  it('终态判定按本轮口径：退役条目的陈年失败不阻止收成 done', async () => {
    // 与 5b54341 的收口一致 —— 否则确认后任务仍显示「存在缺口」。
    seed([
      mkCase({ caseId: 'TC-051' }),
      mkCase({ caseId: 'TC-005', status: 'stale', lastRunError: 'ECONNREFUSED ::1:5173' }),
    ]);
    const { manifest } = await confirmMockScripts({ projectPath: proj, taskName: TASK, env: ENV, caseIds: ['TC-051'] });
    assert.equal(manifest.jobStatus, 'done');
    assert.equal(manifest.error, undefined);
  });
});

/**
 * 测试模块使用统计 · 每日滚动汇总纯函数单测（src/lib/test/usage-rollup.ts）。
 *
 * 覆盖：
 * - UTC→北京日边界分桶（16:30Z → 次日）
 * - 跨两日多事件聚合：cases_generated(含 round!==1 证明首轮拆分)、cases_approved(采纳=kept+modified)、
 *   execution_completed(pass/fail/partial/circuitBroken/时长均值)、report_reviewed(accurate 与非 accurate)
 * - 每项目 / 每模型分组
 * - 空输入 → []
 *
 * 不 import db.ts（纯函数层可在 node 下直接单测）。
 * Run with: npx tsx --test src/__tests__/unit/usage-rollup.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyRollup } from '../../lib/test/usage-rollup';
import type { DayUsage } from '../../lib/test/usage-rollup';
import type { TestStatsEvent, TestStatsEventType } from '../../types';

// ---------- 造数工具 ----------

let seq = 0;
function ev(
  eventType: TestStatsEventType,
  taskId: string,
  createdAt: string,
  payload: Record<string, unknown> = {},
  extra: Partial<TestStatsEvent> = {},
): TestStatsEvent {
  return {
    id: `ev-${++seq}`,
    eventType,
    projectPath: extra.projectPath ?? '/proj/demo',
    taskId,
    taskName: extra.taskName ?? `任务-${taskId}`,
    env: extra.env ?? null,
    payload,
    schemaVersion: 1,
    createdAt,
    ...extra,
  };
}

function byDate(days: DayUsage[]): Record<string, DayUsage> {
  const m: Record<string, DayUsage> = {};
  for (const d of days) m[d.date] = d;
  return m;
}

// ---------- (a) 分桶边界 ----------

describe('buildDailyRollup · UTC→北京日分桶', () => {
  it('UTC 16:30 落到次日北京日（16:30Z + 8h = 次日 00:30）', () => {
    const days = buildDailyRollup([
      ev('task_created', 'A', '2026-07-14 16:30:00', { source: 'imported_requirement' }),
    ]);
    assert.equal(days.length, 1);
    assert.equal(days[0].date, '2026-07-15');
    assert.equal(days[0].tasks_created, 1);
  });

  it('UTC 15:59 与 16:00 分属不同北京日（跨北京午夜）', () => {
    const days = buildDailyRollup([
      ev('task_created', 'A', '2026-07-14 15:59:59'),
      ev('task_created', 'B', '2026-07-14 16:00:00'),
    ]);
    const m = byDate(days);
    assert.equal(m['2026-07-14'].tasks_created, 1);
    assert.equal(m['2026-07-15'].tasks_created, 1);
  });

  it('自定义 tzOffsetMinutes=0 时按 UTC 日分桶', () => {
    const days = buildDailyRollup(
      [ev('task_created', 'A', '2026-07-14 16:30:00')],
      { tzOffsetMinutes: 0 },
    );
    assert.equal(days[0].date, '2026-07-14');
  });
});

// ---------- (b) 跨两日多事件聚合 ----------

describe('buildDailyRollup · 跨两日多事件聚合', () => {
  const events: TestStatsEvent[] = [
    // ---- Day 1: 北京 2026-07-15（UTC 07-14 16:00 起） ----
    ev('task_created', 'T1', '2026-07-14 16:10:00', { source: 'imported_requirement' }),
    // 首轮生成 10（round 1）
    ev('cases_generated', 'T1', '2026-07-14 16:11:00', { round: 1, caseCount: 10, model: 'm1' }),
    // 返工轮生成 4（round 2）→ 只进 cases_generated，不进 first_round
    ev('cases_generated', 'T1', '2026-07-14 16:20:00', { round: 2, caseCount: 4, model: 'm1' }),
    // 批准：终态 11 条，采纳 = kept7 + modified2 = 9；弃用1 新增2
    ev('cases_approved', 'T1', '2026-07-14 16:30:00', {
      finalCount: 11,
      diff: { kept: 7, modified: 2, removed: 1, added: 2 },
    }),
    // 执行（非熔断）：total5 pass3 fail1 partial1；两条用例时长 10s/20s
    ev('execution_completed', 'T1', '2026-07-14 17:00:00', {
      model: 'm1',
      counts: { total: 5, pass: 3, fail: 1, partial: 1, blocked: 0 },
      circuitBroken: false,
      tests: [{ id: 'c1', durationMs: 10000 }, { id: 'c2', durationMs: 20000 }],
    }),
    // 复核：1 准确 + 1 误报（false_fail）。复核按 runHash|caseId 去重 → 必须带 caseId（stats.ts 同）
    ev('report_reviewed', 'T1', '2026-07-14 17:10:00', {
      runHash: 'r1', caseId: 'c1', verdict: 'accurate',
    }),
    ev('report_reviewed', 'T1', '2026-07-14 17:11:00', {
      runHash: 'r1', caseId: 'c2', verdict: 'false_fail',
    }),

    // ---- Day 2: 北京 2026-07-16 ----
    // 熔断执行轮：total2 blocked2，时长 30s。只计 executions 与 circuit_broken；
    // 用例级结果（total/pass/fail/blocked/partial）与时长均不计入（结果残缺，与 stats.ts 同口径）
    ev('execution_completed', 'T1', '2026-07-15 18:00:00', {
      model: 'm1',
      counts: { total: 2, pass: 0, fail: 0, partial: 0, blocked: 2 },
      circuitBroken: true,
      tests: [{ id: 'c3', durationMs: 30000 }],
    }),
    // 一键全准 3 条 → reviews += 3, reviews_accurate += 3
    ev('report_review_bulk', 'T1', '2026-07-15 18:10:00', { caseIds: ['c1', 'c2', 'c3'] }),
  ];

  const days = buildDailyRollup(events);
  const m = byDate(days);

  it('两天各成一桶且日期升序', () => {
    assert.deepEqual(days.map((d) => d.date), ['2026-07-15', '2026-07-16']);
  });

  it('Day1: 生成/首轮/采纳/批准', () => {
    const d = m['2026-07-15'];
    assert.equal(d.tasks_created, 1);
    assert.equal(d.cases_generated, 14); // 10 + 4
    assert.equal(d.cases_generated_first_round, 10); // 仅 round 1
    assert.equal(d.cases_approved, 11); // finalCount
    assert.equal(d.cases_adopted, 9); // kept7 + modified2
    assert.deepEqual(d.payload.adoption, { kept: 7, modified: 2, added: 2, removed: 1 });
  });

  it('Day1: 执行四态与时长均值', () => {
    const d = m['2026-07-15'];
    assert.equal(d.executions, 1);
    assert.equal(d.cases_executed, 5);
    assert.equal(d.cases_passed, 3);
    assert.equal(d.cases_failed, 1);
    assert.equal(d.payload.exec.partial, 1);
    assert.equal(d.payload.exec.blocked, 0);
    assert.equal(d.payload.exec.circuit_broken, 0);
    assert.equal(d.payload.exec.avg_case_duration_ms, 15000); // (10000+20000)/2
    // 可求和的时长分子/分母（供服务端 avg=SUM/SUM）
    assert.equal(d.case_duration_ms_sum, 30000);
    assert.equal(d.case_duration_samples, 2);
  });

  it('Day1: 复核 accurate 与 false_fail', () => {
    const d = m['2026-07-15'];
    assert.equal(d.reviews, 2);
    assert.equal(d.reviews_accurate, 1);
    assert.deepEqual(d.payload.reviews_detail, {
      false_fail: 1,
      missed_fail: 0,
      severity_mismatch: 0,
    });
  });

  it('Day2: 熔断轮只计 executions 与 circuit_broken，用例级结果与时长均不计入', () => {
    const d = m['2026-07-16'];
    // 活动量：用户确实发起了一次执行
    assert.equal(d.executions, 1);
    assert.equal(d.payload.exec.circuit_broken, 1);
    // 结果残缺 → 全部不计入。服务端只拿求和值、无法再按轮次剔除，故必须在客户端排除，
    // 否则管理端 pass_rate = passed/executed 会与本地 Stats 面板不一致。
    assert.equal(d.cases_executed, 0);
    assert.equal(d.cases_passed, 0);
    assert.equal(d.cases_failed, 0);
    assert.equal(d.payload.exec.blocked, 0);
    assert.equal(d.payload.exec.partial, 0);
    assert.equal(d.payload.exec.avg_case_duration_ms, 0); // 当日唯一时长来自熔断轮 → 不纳入
    assert.equal(d.case_duration_ms_sum, 0); // 熔断轮时长不计入分子
    assert.equal(d.case_duration_samples, 0);
  });

  it('Day2: 一键全准批量复核', () => {
    const d = m['2026-07-16'];
    assert.equal(d.reviews, 3);
    assert.equal(d.reviews_accurate, 3);
  });
});

// ---------- (c) 每项目 / 每模型分组 ----------

describe('buildDailyRollup · 分组', () => {
  it('按项目全路径分组，name 取末段', () => {
    const days = buildDailyRollup([
      ev('task_created', 'T1', '2026-07-14 16:00:00', {}, { projectPath: '/work/alpha' }),
      ev('task_created', 'T2', '2026-07-14 17:00:00', {}, { projectPath: '/work/alpha' }),
      ev('task_created', 'T3', '2026-07-14 18:00:00', {}, { projectPath: '/work/beta' }),
    ]);
    assert.equal(days.length, 1);
    const projects = days[0].payload.projects;
    assert.deepEqual(projects.map((p) => [p.project, p.name, p.tasks_created]), [
      ['/work/alpha', 'alpha', 2],
      ['/work/beta', 'beta', 1],
    ]);
  });

  it('按模型分组（仅生成/执行事件携带 model）', () => {
    const days = buildDailyRollup([
      ev('cases_generated', 'T1', '2026-07-14 16:00:00', { round: 1, caseCount: 6, model: 'm1' }),
      ev('execution_completed', 'T1', '2026-07-14 16:30:00', {
        model: 'm2',
        counts: { total: 3, pass: 2, fail: 1, partial: 0, blocked: 0 },
        circuitBroken: false,
        tests: [],
      }),
      // 无 model 的事件不产生模型行
      ev('report_reviewed', 'T1', '2026-07-14 16:40:00', {
        runHash: 'r1', caseId: 'c1', verdict: 'accurate',
      }),
    ]);
    const models = days[0].payload.models;
    const byModel = Object.fromEntries(models.map((r) => [r.model, r]));
    assert.deepEqual(Object.keys(byModel).sort(), ['m1', 'm2']);
    assert.equal(byModel['m1'].cases_generated, 6);
    assert.equal(byModel['m1'].cases_generated_first_round, 6);
    assert.equal(byModel['m1'].executions, 0);
    assert.equal(byModel['m2'].executions, 1);
    assert.equal(byModel['m2'].cases_executed, 3);
    assert.equal(byModel['m2'].cases_passed, 2);
    assert.equal(byModel['m2'].cases_failed, 1);
    assert.equal(byModel['m2'].cases_generated, 0);
    // 复核未归入任何模型行（无 model）；但日级 reviews 仍计
    assert.equal(days[0].reviews, 1);
  });
});

// ---------- (c2) 状态型事件 last-wins 去重（真实数据回归） ----------
//
// cases_approved / report_reviewed 携带的是「当前全量状态」而非增量：同一任务反复批准、
// 同一用例反复复核都会重复发事件。直接求和会成倍膨胀 —— 真实库里就有同一任务一天内批准
// 3 次、每次 finalCount=55，raw sum 得 165，采纳率飙到 294%。必须 last-wins 折叠。

describe('buildDailyRollup · 状态型事件 last-wins', () => {
  it('同一任务日内多次批准 → 只算最后一条，不叠加 finalCount', () => {
    const days = buildDailyRollup([
      ev('cases_generated', 'T1', '2026-07-14 16:00:00', { round: 1, caseCount: 55, model: 'm1' }),
      // 同一任务批准 3 次，每次都带完整 finalCount=55（真实数据就是这样重复发的）
      ev('cases_approved', 'T1', '2026-07-14 16:10:00', {
        finalCount: 55, diff: { kept: 55, modified: 0, added: 0, removed: 0 },
      }),
      ev('cases_approved', 'T1', '2026-07-14 17:00:00', {
        finalCount: 55, diff: { kept: 55, modified: 0, added: 0, removed: 0 },
      }),
      ev('cases_approved', 'T1', '2026-07-14 17:30:00', {
        finalCount: 55, diff: { kept: 50, modified: 5, added: 0, removed: 0 },
      }),
    ]);
    const d = days[0];
    assert.equal(d.cases_approved, 55); // 求和会是 165（×3）
    assert.equal(d.cases_adopted, 55); // 最后一条 kept50 + modified5
    assert.deepEqual(d.payload.adoption, { kept: 50, modified: 5, added: 0, removed: 0 });
    // 采纳率 = 55/55 = 100%，不再出现 >100% 的失真
    assert.equal(d.cases_generated_first_round, 55);
  });

  it('不同任务各自 last-wins 后再跨任务求和', () => {
    const days = buildDailyRollup([
      ev('cases_approved', 'T1', '2026-07-14 16:00:00', {
        finalCount: 10, diff: { kept: 10, modified: 0, added: 0, removed: 0 },
      }),
      ev('cases_approved', 'T1', '2026-07-14 16:30:00', {
        finalCount: 12, diff: { kept: 12, modified: 0, added: 0, removed: 0 },
      }),
      ev('cases_approved', 'T2', '2026-07-14 17:00:00', {
        finalCount: 4, diff: { kept: 4, modified: 0, added: 0, removed: 0 },
      }),
    ]);
    const d = days[0];
    assert.equal(d.cases_approved, 16); // T1 取最后一条 12 + T2 的 4
    assert.equal(d.cases_adopted, 16);
  });

  it('同一 (runHash,caseId) 复核多次 → 取最后一次 verdict', () => {
    const days = buildDailyRollup([
      ev('report_reviewed', 'T1', '2026-07-14 16:00:00', {
        runHash: 'r1', caseId: 'c1', verdict: 'accurate',
      }),
      ev('report_reviewed', 'T1', '2026-07-14 16:10:00', {
        runHash: 'r1', caseId: 'c1', verdict: 'false_fail', // 改判
      }),
    ]);
    const d = days[0];
    assert.equal(d.reviews, 1); // 同一条用例只算一次
    assert.equal(d.reviews_accurate, 0); // 最后一次是 false_fail
    assert.equal(d.payload.reviews_detail.false_fail, 1);
  });

  it("verdict='cleared' 撤销 → 删除该条复核", () => {
    const days = buildDailyRollup([
      ev('report_reviewed', 'T1', '2026-07-14 16:00:00', {
        runHash: 'r1', caseId: 'c1', verdict: 'accurate',
      }),
      ev('report_reviewed', 'T1', '2026-07-14 16:10:00', {
        runHash: 'r1', caseId: 'c1', verdict: 'cleared',
      }),
    ]);
    assert.equal(days[0].reviews, 0);
    assert.equal(days[0].reviews_accurate, 0);
  });

  it('一键全准与单条复核命中同一用例 → 去重，不重复计数', () => {
    const days = buildDailyRollup([
      ev('report_reviewed', 'T1', '2026-07-14 16:00:00', {
        runHash: '', caseId: 'c1', verdict: 'false_fail',
      }),
      // 一键全准覆盖 c1（改判为 accurate）并新增 c2
      ev('report_review_bulk', 'T1', '2026-07-14 16:10:00', { caseIds: ['c1', 'c2'] }),
    ]);
    const d = days[0];
    assert.equal(d.reviews, 2); // c1 + c2，c1 不重复计
    assert.equal(d.reviews_accurate, 2); // c1 被改判为 accurate
    assert.equal(d.payload.reviews_detail.false_fail, 0);
  });

  it('事件乱序传入仍得同一结果（内部按时间稳定排序）', () => {
    const later = ev('cases_approved', 'T1', '2026-07-14 17:00:00', {
      finalCount: 9, diff: { kept: 9, modified: 0, added: 0, removed: 0 },
    });
    const earlier = ev('cases_approved', 'T1', '2026-07-14 16:00:00', {
      finalCount: 3, diff: { kept: 3, modified: 0, added: 0, removed: 0 },
    });
    const d = buildDailyRollup([later, earlier])[0]; // 故意乱序传入
    assert.equal(d.cases_approved, 9); // 仍取时间上最后的那条
  });

  it('项目行同样 last-wins（不因重复批准而膨胀）', () => {
    const days = buildDailyRollup([
      ev('cases_approved', 'T1', '2026-07-14 16:00:00', {
        finalCount: 20, diff: { kept: 20, modified: 0, added: 0, removed: 0 },
      }, { projectPath: '/work/alpha' }),
      ev('cases_approved', 'T1', '2026-07-14 16:30:00', {
        finalCount: 20, diff: { kept: 20, modified: 0, added: 0, removed: 0 },
      }, { projectPath: '/work/alpha' }),
    ]);
    const proj = days[0].payload.projects.find((p) => p.project === '/work/alpha')!;
    assert.equal(proj.cases_approved, 20); // 非 40
    assert.equal(proj.cases_adopted, 20);
  });
});

// ---------- (d) 空输入 & 防御性 ----------

describe('buildDailyRollup · 边界与防御', () => {
  it('空事件 → []', () => {
    assert.deepEqual(buildDailyRollup([]), []);
  });

  it('畸形 payload 不抛错（缺字段按 0/跳过）', () => {
    const days = buildDailyRollup([
      ev('cases_generated', 'T1', '2026-07-14 16:00:00', {}), // 无 caseCount/round
      ev('cases_approved', 'T1', '2026-07-14 16:10:00', { diff: 'not-an-object' }), // 坏 diff
      ev('execution_completed', 'T1', '2026-07-14 16:20:00', {}), // 无 counts/tests
      ev('report_reviewed', 'T1', '2026-07-14 16:30:00', { verdict: 'cleared' }), // 撤销：忽略
      ev('report_reviewed', 'T1', '2026-07-14 16:31:00', {}), // 无 verdict：忽略
      ev('step_completed', 'T1', '2026-07-14 16:40:00', { step: 'cases' }), // 不计入
    ]);
    assert.equal(days.length, 1);
    const d = days[0];
    assert.equal(d.cases_generated, 0);
    assert.equal(d.cases_generated_first_round, 0);
    assert.equal(d.cases_approved, 0);
    assert.equal(d.cases_adopted, 0);
    assert.equal(d.executions, 1); // execution_completed 计执行数，即使无 counts
    assert.equal(d.cases_executed, 0);
    assert.equal(d.reviews, 0); // cleared / 无 verdict 均忽略
    assert.equal(d.payload.exec.avg_case_duration_ms, 0); // 无有效时长
  });
});

/**
 * 回归测试使用统计 · 每日上报聚合纯函数单测（src/lib/test/regression-rollup.ts）。
 *
 * 覆盖：
 * - startedAt(UTC) → 北京日分桶（16:30Z → 次日）
 * - mode: full / failed-only 分别计数
 * - 熔断轮：计入轮次数（活动量），但不计入 case_executions / 脚本 / AI（结果不可信）
 * - running 轮整体排除
 * - 无 run.json：case_executions 退化取 counts.total，脚本/AI 记 0
 * - 多项目：跨项目求和 + 按项目明细
 * - mergeRegressionIntoDays：只有回归活动的天也要出现；suites_count 只打最新一天
 *
 * Run: npx tsx --test src/__tests__/unit/regression-rollup.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateRegressionDaily,
  mergeRegressionIntoDays,
  type RegressionRollupProject,
} from '../../lib/test/regression-rollup';
import type { RoundRunSummary } from '../../lib/test/regression-stats';
import type { RegressionRound, RoundMode, RoundStatus } from '../../lib/test/rounds';
import { buildDailyRollup, type DayUsage } from '../../lib/test/usage-rollup';

// ---------- 造数工具 ----------

function round(
  roundId: string,
  startedAt: string,
  opts: {
    mode?: RoundMode;
    status?: RoundStatus;
    total?: number;
    counts?: Record<string, number>;
  } = {},
): RegressionRound {
  return {
    roundId,
    startedAt,
    env: 'local',
    suiteName: '全量',
    mode: opts.mode ?? 'full',
    status: opts.status ?? 'done',
    total: opts.total ?? 0,
    counts: opts.counts,
  };
}

function summary(o: Partial<RoundRunSummary> = {}): RoundRunSummary {
  return {
    testCount: o.testCount ?? 0,
    circuitBroken: o.circuitBroken ?? false,
    scriptPass: o.scriptPass ?? 0,
    scriptFail: o.scriptFail ?? 0,
    aiPass: o.aiPass ?? 0,
    aiFail: o.aiFail ?? 0,
  };
}

function proj(
  project: string,
  rounds: RegressionRound[],
  runSummaries: Record<string, RoundRunSummary> = {},
): RegressionRollupProject {
  return {
    project,
    name: project.split('/').filter(Boolean).pop() ?? project,
    rounds,
    runSummaries,
  };
}

// ---------- (a) 分桶 / 模式 ----------

describe('aggregateRegressionDaily · 分桶与模式', () => {
  it('按 startedAt 转北京日分桶（16:30Z → 次日）', () => {
    const { byDay } = aggregateRegressionDaily([
      proj('/w/a', [
        round('R1', '2026-07-14T16:30:00.000Z'), // 北京 07-15 00:30
        round('R2', '2026-07-14T15:30:00.000Z'), // 北京 07-14 23:30
      ]),
    ]);
    assert.deepEqual([...byDay.keys()].sort(), ['2026-07-14', '2026-07-15']);
  });

  it('full / failed-only 分别计数', () => {
    const { byDay } = aggregateRegressionDaily([
      proj('/w/a', [
        round('R1', '2026-07-14T02:00:00.000Z', { mode: 'full' }),
        round('R2', '2026-07-14T03:00:00.000Z', { mode: 'full' }),
        round('R3', '2026-07-14T04:00:00.000Z', { mode: 'failed-only' }),
      ]),
    ]);
    const t = byDay.get('2026-07-14')!.totals;
    assert.equal(t.rounds_full, 2);
    assert.equal(t.rounds_failed_only, 1);
  });

  it('running 轮整体排除（counts 未定）', () => {
    const { byDay } = aggregateRegressionDaily([
      proj('/w/a', [round('R1', '2026-07-14T02:00:00.000Z', { status: 'running' })]),
    ]);
    assert.equal(byDay.size, 0);
  });
});

// ---------- (b) 熔断与退化路径 ----------

describe('aggregateRegressionDaily · 熔断与 run.json 缺失', () => {
  it('熔断轮：计轮次数，但不计执行量/脚本/AI', () => {
    const { byDay } = aggregateRegressionDaily([
      proj(
        '/w/a',
        [
          round('OK', '2026-07-14T02:00:00.000Z'),
          round('BRK', '2026-07-14T03:00:00.000Z'),
        ],
        {
          OK: summary({ testCount: 10, scriptPass: 6, scriptFail: 1, aiPass: 2, aiFail: 1 }),
          BRK: summary({ testCount: 7, circuitBroken: true, scriptPass: 3, scriptFail: 4 }),
        },
      ),
    ]);
    const t = byDay.get('2026-07-14')!.totals;
    assert.equal(t.rounds_full, 2); // 熔断轮仍是一次真实发起的执行 → 活动量算
    assert.equal(t.case_executions, 10); // 熔断轮的 7 条不计
    assert.equal(t.script_pass, 6);
    assert.equal(t.script_fail, 1);
    assert.equal(t.ai_pass, 2);
    assert.equal(t.ai_fail, 1);
  });

  it('无 run.json：执行量退化取 counts.total，脚本/AI 记 0', () => {
    const { byDay } = aggregateRegressionDaily([
      proj('/w/a', [
        round('OLD', '2026-07-14T02:00:00.000Z', { counts: { total: 12, pass: 9 } }),
      ]),
    ]);
    const t = byDay.get('2026-07-14')!.totals;
    assert.equal(t.rounds_full, 1);
    assert.equal(t.case_executions, 12);
    assert.equal(t.script_pass, 0);
    assert.equal(t.ai_pass, 0);
  });
});

// ---------- (c) 多项目 ----------

describe('aggregateRegressionDaily · 多项目', () => {
  it('跨项目求和，并给出按项目明细', () => {
    const { byDay } = aggregateRegressionDaily([
      proj('/w/alpha', [round('A1', '2026-07-14T02:00:00.000Z')], {
        A1: summary({ testCount: 5, scriptPass: 5 }),
      }),
      proj('/w/beta', [round('B1', '2026-07-14T03:00:00.000Z', { mode: 'failed-only' })], {
        B1: summary({ testCount: 3, aiPass: 2, aiFail: 1 }),
      }),
    ]);
    const b = byDay.get('2026-07-14')!;
    assert.equal(b.totals.rounds_full, 1);
    assert.equal(b.totals.rounds_failed_only, 1);
    assert.equal(b.totals.case_executions, 8); // 5 + 3
    assert.equal(b.totals.script_pass, 5);
    assert.equal(b.totals.ai_pass, 2);

    assert.deepEqual(
      b.projects.map((p) => [p.project, p.name, p.case_executions]),
      [
        ['/w/alpha', 'alpha', 5],
        ['/w/beta', 'beta', 3],
      ],
    );
  });
});

// ---------- (d) 与功能测试 days[] 合并 ----------

describe('mergeRegressionIntoDays', () => {
  const reg = aggregateRegressionDaily([
    proj('/w/a', [round('R1', '2026-07-15T02:00:00.000Z')], {
      R1: summary({ testCount: 4, scriptPass: 4 }),
    }),
  ]);

  it('只有回归活动、没有功能事件的那天也要出现（功能字段全 0）', () => {
    const merged = mergeRegressionIntoDays([], reg, 0, '2026-07-15', 0);
    assert.equal(merged.length, 1);
    const d = merged[0];
    assert.equal(d.date, '2026-07-15');
    assert.equal(d.cases_generated, 0); // 功能壳全 0
    assert.equal(d.executions, 0);
    assert.equal(d.regression.rounds_full, 1);
    assert.equal(d.regression.case_executions, 4);
    assert.equal(d.regression.script_pass, 4);

    // 回归明细并进同一个 projects[]，且用服务端列名 reg_*（服务端按列名 unnest 求和）
    assert.equal(d.payload.projects.length, 1);
    const p = d.payload.projects[0];
    assert.equal(p.project, '/w/a');
    assert.equal(p.reg_case_executions, 4);
    assert.equal(p.reg_script_pass, 4);
    assert.equal(p.reg_rounds_full, 1);
    assert.equal(p.cases_generated, 0); // 该项目当天无功能事件 → 功能计数全 0
  });

  it('保留已有功能天，并把回归并进同一天', () => {
    const funcDays: DayUsage[] = buildDailyRollup([
      {
        id: 'e1',
        eventType: 'task_created',
        projectPath: '/w/a',
        taskId: 'T1',
        taskName: 't',
        env: null,
        payload: {},
        schemaVersion: 1,
        createdAt: '2026-07-14 18:00:00', // 北京 07-15
      },
    ]);
    assert.deepEqual(funcDays.map((d) => d.date), ['2026-07-15']);

    const merged = mergeRegressionIntoDays(funcDays, reg, 0, '2026-07-15', 0);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].tasks_created, 1); // 功能侧保留
    assert.equal(merged[0].regression.rounds_full, 1); // 回归侧并入

    // 同一项目 → 合并进**同一行**，不产生重复行
    const rows = merged[0].payload.projects.filter((p) => p.project === '/w/a');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tasks_created, 1); // 功能计数
    assert.equal(rows[0].reg_case_executions, 4); // 回归计数
  });

  it('suites_count 是当前快照 → 只打在最新一天', () => {
    const merged = mergeRegressionIntoDays([], reg, 7, '2026-07-16', 0);
    const byDate = Object.fromEntries(merged.map((d) => [d.date, d]));
    assert.equal(byDate['2026-07-15'].regression.suites_count, 0); // 历史天不写
    assert.equal(byDate['2026-07-16'].regression.suites_count, 7); // 最新天承载快照
    assert.equal(byDate['2026-07-16'].regression.rounds_full, 0); // 该天无活动，仅承载快照
  });

  it('tasks_total 快照只打在最新一天', () => {
    const merged = mergeRegressionIntoDays([], reg, 0, '2026-07-16', 123);
    const byDate = Object.fromEntries(merged.map((d) => [d.date, d]));
    assert.equal(byDate['2026-07-15'].tasks_total, 0); // 历史天不写
    assert.equal(byDate['2026-07-16'].tasks_total, 123); // 最新天承载快照（该天本无活动，为它建壳）
  });

  it('无套件且无 tasks_total 时不为最新一天凭空造壳', () => {
    const merged = mergeRegressionIntoDays([], reg, 0, '2026-07-16', 0);
    assert.deepEqual(merged.map((d) => d.date), ['2026-07-15']);
  });
});

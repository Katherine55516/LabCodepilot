/**
 * 回归测试使用统计 · 纯函数层单测（src/lib/test/regression-stats.ts 的 aggregateRegressionStats）。
 *
 * 覆盖口径：
 * - 周分桶（ISO 周一 UTC）+ 套件执行按 mode 拆分 + 用例执行量（run 摘要优先、退化 counts.total）
 * - running 轮排除；circuitBroken 轮从执行量/脚本图/最近通过率中排除
 * - 脚本 vs AI 拆分（via='script' × pass/非pass）
 * - 套件明细：内置「全量」+ 用户套件、覆盖率分母、执行次数、最近通过率（跳过熔断轮）、
 *   平均耗时、重放占比
 * - 空态 hasData
 *
 * 纯函数直测（不读 fs / 不 import db）。Run: npx tsx --test src/__tests__/unit/regression-stats.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRegressionStats,
  type RegressionStatsInput,
  type RoundRunSummary,
} from "../../lib/test/regression-stats";
import type { RegressionRound } from "../../lib/test/rounds";
import type { RegressionSuite } from "../../lib/test/suites";

function round(p: Partial<RegressionRound> & { roundId: string; startedAt: string }): RegressionRound {
  return { env: "local", suiteName: "全量", mode: "full", status: "done", total: 0, ...p };
}

function summary(p: Partial<RoundRunSummary> = {}): RoundRunSummary {
  return { testCount: 0, circuitBroken: false, scriptPass: 0, scriptFail: 0, aiPass: 0, aiFail: 0, ...p };
}

function input(over: Partial<RegressionStatsInput> = {}): RegressionStatsInput {
  return { projectName: "proj", rounds: [], runSummaries: {}, suites: [], suiteHitCounts: {}, libAliveCount: 0, ...over };
}

describe("aggregateRegressionStats · 周趋势", () => {
  it("按 mode 拆分套件执行 + 用例执行量取 counts.total（无 run 摘要时）", () => {
    const r = aggregateRegressionStats(input({
      rounds: [
        round({ roundId: "A", startedAt: "2026-07-06T10:00:00Z", mode: "full", counts: { total: 10, pass: 8, fail: 2, partial: 0, blocked: 0 } }),
        round({ roundId: "B", startedAt: "2026-07-07T10:00:00Z", mode: "failed-only", counts: { total: 4, pass: 3, fail: 1, partial: 0, blocked: 0 } }),
        round({ roundId: "C", startedAt: "2026-07-13T10:00:00Z", mode: "full", counts: { total: 8, pass: 8, fail: 0, partial: 0, blocked: 0 } }),
      ],
      libAliveCount: 20,
    }));
    assert.equal(r.weekly.length, 2); // 07-06 与 07-13 两个连续 ISO 周
    const w1 = r.weekly[0];
    assert.equal(w1.weekStart, "2026-07-06");
    assert.equal(w1.roundsFull, 1);
    assert.equal(w1.roundsFailedOnly, 1);
    assert.equal(w1.caseExecutions, 14);
    const w2 = r.weekly[1];
    assert.equal(w2.weekStart, "2026-07-13");
    assert.equal(w2.roundsFull, 1);
    assert.equal(w2.caseExecutions, 8);
    assert.equal(r.totalRounds, 3);
  });

  it("跨周有空档时补零周", () => {
    const r = aggregateRegressionStats(input({
      rounds: [
        round({ roundId: "A", startedAt: "2026-07-06T10:00:00Z", counts: { total: 5, pass: 5, fail: 0, partial: 0, blocked: 0 } }),
        round({ roundId: "B", startedAt: "2026-07-20T10:00:00Z", counts: { total: 5, pass: 5, fail: 0, partial: 0, blocked: 0 } }),
      ],
      libAliveCount: 5,
    }));
    assert.deepEqual(r.weekly.map((w) => w.weekStart), ["2026-07-06", "2026-07-13", "2026-07-20"]);
    assert.equal(r.weekly[1].roundsFull, 0); // 中间空周补零
    assert.equal(r.weekly[1].caseExecutions, 0);
  });

  it("running 轮不计入；run 摘要优先且熔断轮不计入执行量", () => {
    const r = aggregateRegressionStats(input({
      rounds: [
        round({ roundId: "A", startedAt: "2026-07-06T10:00:00Z", counts: { total: 10, pass: 9, fail: 1, partial: 0, blocked: 0 } }),
        round({ roundId: "B", startedAt: "2026-07-06T11:00:00Z", status: "running" }),
        round({ roundId: "C", startedAt: "2026-07-06T12:00:00Z", counts: { total: 6, pass: 6, fail: 0, partial: 0, blocked: 0 } }),
      ],
      runSummaries: {
        A: summary({ testCount: 10, aiPass: 9, aiFail: 1 }),
        C: summary({ testCount: 6, circuitBroken: true, aiPass: 3, aiFail: 3 }), // 熔断 → 执行量不计
      },
      libAliveCount: 10,
    }));
    assert.equal(r.totalRounds, 2); // running 排除
    assert.equal(r.weekly[0].caseExecutions, 10); // A 计 10，C 熔断不计
  });
});

describe("aggregateRegressionStats · 脚本 vs AI", () => {
  it("按 via 与通过拆分，仅取有 run 摘要且非熔断的已执行轮", () => {
    const r = aggregateRegressionStats(input({
      rounds: [
        round({ roundId: "A", startedAt: "2026-07-06T10:00:00Z" }),
        round({ roundId: "B", startedAt: "2026-07-06T11:00:00Z" }), // 无摘要 → 不入图
        round({ roundId: "C", startedAt: "2026-07-06T12:00:00Z" }),
        round({ roundId: "D", startedAt: "2026-07-06T13:00:00Z" }), // 熔断 → 不入图
      ],
      runSummaries: {
        A: summary({ testCount: 5, scriptPass: 3, scriptFail: 1, aiPass: 1, aiFail: 0 }),
        C: summary({ testCount: 4, scriptPass: 4, aiPass: 0 }),
        D: summary({ testCount: 4, circuitBroken: true, scriptPass: 2, scriptFail: 2 }),
      },
    }));
    assert.equal(r.scriptVsAi.length, 2);
    assert.deepEqual(r.scriptVsAi.map((p) => p.roundId), ["A", "C"]);
    assert.deepEqual(r.scriptVsAi[0], { roundId: "A", label: "#1", scriptPass: 3, scriptFail: 1, aiPass: 1, aiFail: 0 });
    // C 的位次是全体已执行轮里的第 3（A、B、C…），label 反映升序位次
    assert.equal(r.scriptVsAi[1].label, "#3");
  });
});

describe("aggregateRegressionStats · 套件明细", () => {
  const suites: RegressionSuite[] = [{ name: "支付回归", type: "static", keys: [] }];

  it("内置全量 + 用户套件：覆盖率、执行次数、最近通过率（跳过熔断轮）、重放占比", () => {
    const r = aggregateRegressionStats(input({
      rounds: [
        round({ roundId: "F1", startedAt: "2026-07-06T10:00:00Z", suiteName: "全量", counts: { total: 40, pass: 36, fail: 4, partial: 0, blocked: 0 }, finishedAt: "2026-07-06T10:04:00Z" }),
        round({ roundId: "P1", startedAt: "2026-07-06T11:00:00Z", suiteName: "支付回归", counts: { total: 8, pass: 6, fail: 2, partial: 0, blocked: 0 }, finishedAt: "2026-07-06T11:02:00Z" }),
        round({ roundId: "P2", startedAt: "2026-07-06T12:00:00Z", suiteName: "支付回归", counts: { total: 8, pass: 0, fail: 8, partial: 0, blocked: 0 } }), // 熔断轮，最近通过率应跳过它
      ],
      runSummaries: {
        F1: summary({ testCount: 40, scriptPass: 20, scriptFail: 0, aiPass: 16, aiFail: 4 }), // 重放占比 20/40 = 0.5
        P1: summary({ testCount: 8, scriptPass: 4, aiPass: 2, aiFail: 2 }), // 重放 4/8 = 0.5
        P2: summary({ testCount: 8, circuitBroken: true, aiFail: 8 }),
      },
      suites,
      suiteHitCounts: { "全量": 40, "支付回归": 8 },
      libAliveCount: 40,
    }));

    const full = r.suites.find((s) => s.name === "全量")!;
    assert.equal(full.type, "builtin");
    assert.equal(full.caseCount, 40);
    assert.equal(full.libraryTotal, 40);
    assert.equal(full.runCount, 1);
    assert.equal(full.latestPassStr, "36/40");
    assert.equal(full.avgDurationMs, 4 * 60 * 1000);
    assert.ok(Math.abs((full.replayRatio ?? 0) - 0.5) < 1e-9);

    const pay = r.suites.find((s) => s.name === "支付回归")!;
    assert.equal(pay.type, "static");
    assert.equal(pay.caseCount, 8);
    assert.equal(pay.runCount, 2);
    // P2 熔断被跳过 → 最近通过率取 P1 的 6/8
    assert.equal(pay.latestPassStr, "6/8");
    assert.ok(Math.abs((pay.latestPassRate ?? 0) - 0.75) < 1e-9);
    // 重放占比只统计非熔断轮 → 仅 P1 的 4/8
    assert.ok(Math.abs((pay.replayRatio ?? 0) - 0.5) < 1e-9);
  });

  it("无库、无套件、无轮次 → hasData=false", () => {
    const r = aggregateRegressionStats(input());
    assert.equal(r.hasData, false);
    assert.equal(r.suites.length, 0);
    assert.equal(r.weekly.length, 0);
  });

  it("仅有库（无轮次）→ 显示内置全量行、hasData=true", () => {
    const r = aggregateRegressionStats(input({ suiteHitCounts: { "全量": 12 }, libAliveCount: 12 }));
    assert.equal(r.hasData, true);
    assert.equal(r.suites.length, 1);
    assert.equal(r.suites[0].name, "全量");
    assert.equal(r.suites[0].runCount, 0);
    assert.equal(r.suites[0].latestPassStr, null);
  });
});

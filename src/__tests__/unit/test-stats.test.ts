/**
 * 测试模块使用统计 · 纯函数层单测（src/lib/test/stats.ts）。
 *
 * 覆盖冻结口径（docs/exec-plans/active/test-usage-stats.md）：
 * - 用例身份 hash（key 顺序不敏感）与采纳 diff 四分类（原样/修改后/弃用/新增）
 * - 误判归类矩阵（误报/漏报/程度不符）
 * - 全局聚合：首轮基线、导入用例任务不进采纳分母、未批准任务不进分母、
 *   熔断轮整轮排除、复核 last-wins、覆盖率、周分桶、时长分布
 * - 任务详情：节点轮次合成（step_completed 与专属事件按序配对）、每轮 vs 终态 diff
 * - 模型归因：采纳率→首轮用例设计模型；准确度/通过率/时长→执行模型
 *
 * 不 import db.ts（better-sqlite3 Electron ABI 在 node 下不可用，这正是纯函数层存在的原因）。
 * Run with: npx tsx --test src/__tests__/unit/test-stats.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateGlobal,
  aggregateModels,
  aggregateTask,
  caseIdentity,
  classifyVerdict,
  diffCases,
  parseDbTime,
  readCaseKeys,
  sanitizeEventInput,
  snapshotCases,
  stableStringify,
  weekStartOf,
} from "../../lib/test/stats";
import type { TestStatsEvent, TestStatsEventType } from "../../types";

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
    projectPath: "/proj/demo",
    taskId,
    taskName: extra.taskName ?? `任务-${taskId}`,
    env: extra.env ?? null,
    payload,
    schemaVersion: 1,
    createdAt,
    ...extra,
  };
}

function mkCase(id: string, title: string) {
  return { id, purpose: title, steps: [{ content: "打开页面", expected: "正常" }] };
}

// ---------- 基础纯函数 ----------

describe("stableStringify / caseIdentity", () => {
  it("key order does not change the hash", () => {
    const a = { id: "TC-1", purpose: "标题", steps: [{ content: "x", expected: "y" }] };
    const b = { steps: [{ expected: "y", content: "x" }], purpose: "标题", id: "TC-1" };
    assert.equal(stableStringify(a), stableStringify(b));
    assert.equal(caseIdentity(a).hash, caseIdentity(b).hash);
  });

  it("content change changes the hash; id is trimmed", () => {
    const a = mkCase("TC-1", "标题");
    const b = mkCase("TC-1", "标题改了");
    assert.notEqual(caseIdentity(a).hash, caseIdentity(b).hash);
    assert.equal(caseIdentity({ id: " TC-9 " }).id, "TC-9");
    assert.equal(caseIdentity("not-an-object").id, "");
    assert.equal(caseIdentity(null).hash.length, 16);
  });
});

describe("diffCases", () => {
  it("classifies kept / modified / removed / added by id+hash", () => {
    const baseline = snapshotCases([
      mkCase("TC-1", "a"),
      mkCase("TC-2", "b"),
      mkCase("TC-3", "c"),
    ]);
    const final = snapshotCases([
      mkCase("TC-1", "a"), // 原样
      mkCase("TC-2", "b-已修改"), // 修改后
      mkCase("TC-4", "d"), // 新增；TC-3 弃用
    ]);
    assert.deepEqual(diffCases(baseline, final), { kept: 1, modified: 1, removed: 1, added: 1 });
  });

  it("falls back to hash multiset matching when ids are missing", () => {
    const noId = (t: string) => ({ purpose: t });
    const baseline = snapshotCases([noId("a"), noId("a"), noId("b")]);
    const final = snapshotCases([noId("a"), noId("c")]);
    // a 配上一条(kept)，第二条 a 与 b 弃用，c 新增
    assert.deepEqual(diffCases(baseline, final), { kept: 1, modified: 0, removed: 2, added: 1 });
  });

  it("readCaseKeys round-trips a stored snapshot", () => {
    const snap = snapshotCases([mkCase("TC-1", "a")]);
    const parsed = readCaseKeys(JSON.parse(JSON.stringify(snap)));
    assert.deepEqual(parsed, snap);
    assert.equal(readCaseKeys("nope"), null);
  });
});

describe("classifyVerdict", () => {
  it("severity always wins", () => {
    for (const s of ["pass", "fail", "partial", "blocked"]) {
      assert.equal(classifyVerdict(s, "severity"), "severity_mismatch");
    }
  });
  it("actual ok: AI pass=accurate, others=false alarm", () => {
    assert.equal(classifyVerdict("pass", "ok"), "accurate");
    assert.equal(classifyVerdict("fail", "ok"), "false_fail");
    assert.equal(classifyVerdict("blocked", "ok"), "false_fail");
    assert.equal(classifyVerdict("partial", "ok"), "false_fail");
  });
  it("actual broken: AI fail/blocked=accurate, pass/partial=missed", () => {
    assert.equal(classifyVerdict("fail", "broken"), "accurate");
    assert.equal(classifyVerdict("blocked", "broken"), "accurate");
    assert.equal(classifyVerdict("pass", "broken"), "missed_fail");
    assert.equal(classifyVerdict("partial", "broken"), "missed_fail");
  });
});

describe("sanitizeEventInput", () => {
  const valid = {
    eventType: "task_created",
    projectPath: "/proj/demo",
    taskId: "t1",
    taskName: "订单导出",
    payload: { source: "imported_requirement" },
  };
  it("accepts a valid event and normalizes fields", () => {
    const out = sanitizeEventInput(valid);
    assert.ok(out);
    assert.equal(out.eventType, "task_created");
    assert.equal(out.taskName, "订单导出");
  });
  it("rejects unknown types / missing ids / bad payload shapes", () => {
    assert.equal(sanitizeEventInput({ ...valid, eventType: "hack" }), null);
    assert.equal(sanitizeEventInput({ ...valid, taskId: "" }), null);
    assert.equal(sanitizeEventInput({ ...valid, projectPath: "" }), null);
    assert.equal(sanitizeEventInput({ ...valid, payload: [1, 2] }), null);
    assert.equal(sanitizeEventInput("nope"), null);
    assert.equal(sanitizeEventInput(null), null);
  });
  it("rejects oversized payloads instead of truncating", () => {
    const big = { blob: "x".repeat(300 * 1024) };
    assert.equal(sanitizeEventInput({ ...valid, payload: big }), null);
  });
});

describe("time helpers", () => {
  it("parses DB UTC timestamps", () => {
    assert.equal(parseDbTime("2026-07-06 00:00:00"), Date.parse("2026-07-06T00:00:00Z"));
    assert.equal(parseDbTime(""), 0);
  });
  it("weekStartOf returns the UTC Monday", () => {
    assert.equal(weekStartOf("2026-07-08 12:00:00"), "2026-07-06"); // 周三
    assert.equal(weekStartOf("2026-07-12 23:59:59"), "2026-07-06"); // 周日
    assert.equal(weekStartOf("2026-07-06 00:00:00"), "2026-07-06"); // 周一
  });
});

// ---------- 聚合场景 ----------

/**
 * 任务 A（AI 生成流，走完全流程）：
 *   首轮生成 10 条（opus）→ 返工 1 轮 → 批准（终态 = 7 原样 + 2 修改 + 1 新增；1 弃用）
 *   → 执行 1 轮（sonnet，8/1/1/0，runHash r1，3 条用例带时长）→ 报告 → 复核 4 条
 *     （c1 准确；c2 先准确后改判误报 = last-wins；c3/c4 一键全准）
 * 任务 B（导入用例）：执行 1 轮熔断（不计结果/复核）
 * 任务 C（AI 生成流，生成后未批准）：不进采纳分母
 */
function buildScenario(): TestStatsEvent[] {
  const r1cases = Array.from({ length: 10 }, (_, i) => mkCase(`TC-${i + 1}`, `场景${i + 1}`));
  const finalCases = [
    ...r1cases.slice(0, 7), // 7 原样
    mkCase("TC-8", "场景8-已修改"),
    mkCase("TC-9", "场景9-已修改"),
    mkCase("TC-NEW", "用户新增"), // TC-10 弃用
  ];
  const baselineSnap = snapshotCases(r1cases);
  const finalSnap = snapshotCases(finalCases);
  const diff = diffCases(baselineSnap, finalSnap);
  assert.deepEqual(diff, { kept: 7, modified: 2, removed: 1, added: 1 }); // 场景自洽性

  return [
    // ---- 任务 A ----
    ev("task_created", "A", "2026-06-30 09:00:00", { source: "imported_requirement" }),
    ev("step_completed", "A", "2026-06-30 09:02:00", {
      step: "requirement",
      status: "done",
      durationMs: 60000,
      model: "claude-sonnet-4-5",
      providerId: "anthropic",
    }),
    ev("cases_generated", "A", "2026-06-30 09:10:00", {
      round: 1,
      caseCount: 10,
      model: "claude-opus-4-5",
      cases: baselineSnap,
    }),
    ev("step_completed", "A", "2026-06-30 09:10:01", {
      step: "cases",
      status: "done",
      durationMs: 120000,
      model: "claude-opus-4-5",
    }),
    ev("cases_generated", "A", "2026-06-30 09:30:00", {
      round: 2,
      caseCount: 10,
      model: "claude-opus-4-5",
      cases: baselineSnap,
    }),
    ev("cases_approved", "A", "2026-07-01 10:05:00", {
      finalCount: finalSnap.length,
      final: finalSnap,
      diff,
      aiRounds: 2,
    }),
    ev(
      "execution_completed",
      "A",
      "2026-07-01 11:00:00",
      {
        env: "sit",
        model: "claude-sonnet-4-5",
        counts: { total: 10, pass: 8, fail: 1, partial: 1, blocked: 0 },
        circuitBroken: false,
        durationMs: 600000,
        runHash: "r1",
        tests: [
          { id: "TC-1", durationMs: 10000 },
          { id: "TC-2", durationMs: 20000 },
          { id: "TC-3", durationMs: 130000 },
        ],
      },
      { env: "sit" },
    ),
    ev("step_completed", "A", "2026-07-01 11:00:01", {
      step: "execution",
      status: "done",
      durationMs: 600000,
      model: "claude-sonnet-4-5",
    }),
    ev("report_generated", "A", "2026-07-01 11:02:00", { env: "sit", runHash: "r1", model: "claude-sonnet-4-5" }, { env: "sit" }),
    ev("step_completed", "A", "2026-07-01 11:02:01", {
      step: "report",
      status: "done",
      durationMs: 45000,
      model: "claude-sonnet-4-5",
    }),
    ev("report_reviewed", "A", "2026-07-02 09:00:00", { caseId: "TC-1", aiStatus: "pass", verdict: "accurate", runHash: "r1" }),
    ev("report_reviewed", "A", "2026-07-02 09:01:00", { caseId: "TC-2", aiStatus: "pass", verdict: "accurate", runHash: "r1" }),
    ev("report_review_bulk", "A", "2026-07-02 09:02:00", { caseIds: ["TC-3", "TC-4"], count: 2, runHash: "r1" }),
    // last-wins：c2 改判为误报
    ev("report_reviewed", "A", "2026-07-02 09:10:00", { caseId: "TC-2", aiStatus: "fail", verdict: "false_fail", runHash: "r1" }),

    // ---- 任务 B（导入用例 + 熔断轮） ----
    ev("task_created", "B", "2026-07-06 10:00:00", { source: "imported_cases" }),
    ev(
      "execution_completed",
      "B",
      "2026-07-06 11:00:00",
      {
        env: "sit",
        model: "claude-sonnet-4-5",
        counts: { total: 5, pass: 0, fail: 5, partial: 0, blocked: 0 },
        circuitBroken: true,
        durationMs: 200000,
        runHash: "r2",
        tests: [{ id: "TC-B1", durationMs: 999999 }],
      },
      { env: "sit" },
    ),
    // 熔断轮上的复核必须被剔除
    ev("report_reviewed", "B", "2026-07-06 12:00:00", { caseId: "TC-B1", aiStatus: "fail", verdict: "accurate", runHash: "r2" }),

    // ---- 任务 C（生成后未批准） ----
    ev("task_created", "C", "2026-07-06 14:00:00", { source: "imported_requirement" }),
    ev("cases_generated", "C", "2026-07-06 14:10:00", { round: 1, caseCount: 8, model: "gemini-2.5-pro", cases: [] }),
  ];
}

describe("aggregateGlobal", () => {
  const g = aggregateGlobal(buildScenario());

  it("counts tasks and flow split", () => {
    assert.deepEqual(g.tasks, { total: 3, aiFlow: 2, importedCases: 1, deleted: 0 });
  });

  it("adoption uses first-round baseline; unapproved & imported-cases excluded", () => {
    assert.equal(g.adoption.eligibleTasks, 1);
    assert.equal(g.adoption.generated, 10);
    assert.equal(g.adoption.kept, 7);
    assert.equal(g.adoption.modified, 2);
    assert.equal(g.adoption.removed, 1);
    assert.equal(g.adoption.userAdded, 1);
    assert.equal(g.adoption.adoptionRate, 0.9);
    assert.equal(g.adoption.keptRate, 0.7);
    assert.equal(g.adoption.reworkRounds, 1); // A 返工 1 轮；C 首轮不算返工
  });

  it("execution excludes circuit-broken results but counts the run", () => {
    assert.equal(g.execution.runs, 2);
    assert.equal(g.execution.results.total, 10);
    assert.equal(g.execution.passRate, 0.8);
    assert.equal(g.execution.avgCaseDurationMs, Math.round((10000 + 20000 + 130000) / 3));
    const byLabel = Object.fromEntries(g.execution.durationBuckets.map((b) => [b.label, b.count]));
    assert.equal(byLabel["<15s"], 1);
    assert.equal(byLabel["15–30s"], 1);
    assert.equal(byLabel[">2m"], 1);
    assert.equal(g.execution.stepAvgDurationsMs.requirement, 60000);
    assert.equal(g.execution.stepAvgDurationsMs.report, 45000);
  });

  it("review: last-wins dedup, bulk expansion, circuit-broken excluded, coverage", () => {
    assert.equal(g.review.totalResults, 10); // 只有 A 的非熔断轮
    assert.equal(g.review.reviewed, 4); // c1,c2,c3,c4；B 的复核被剔除
    assert.equal(g.review.accurate, 3);
    assert.equal(g.review.falseFail, 1); // c2 改判 last-wins
    assert.equal(g.review.coverage, 0.4);
    assert.equal(g.review.accuracy, 0.75);
  });

  it("weekly buckets: creations at event week, adoption at approval week", () => {
    const w1 = g.weekly.find((w) => w.weekStart === "2026-06-29");
    const w2 = g.weekly.find((w) => w.weekStart === "2026-07-06");
    assert.ok(w1 && w2);
    assert.equal(w1.tasksCreated, 1); // A（6-30）
    assert.equal(w2.tasksCreated, 2); // B、C（7-06）
    assert.equal(w1.casesKept, 7); // 批准发生在 7-01（W1 周内）
    assert.equal(w1.reviewAccuracy, 0.75); // 复核发生在 7-02
    assert.equal(w2.reviewAccuracy, null); // B 的复核被熔断剔除
  });

  it("task rows carry per-task rollups", () => {
    const rowA = g.taskRows.find((r) => r.taskId === "A")!;
    const rowB = g.taskRows.find((r) => r.taskId === "B")!;
    const rowC = g.taskRows.find((r) => r.taskId === "C")!;
    assert.equal(rowA.generated, 10);
    assert.equal(rowA.adopted, 9);
    assert.equal(rowA.accuracy, 0.75);
    assert.equal(rowA.latestDurationMs, 600000);
    assert.equal(rowB.adoptionEligible, false);
    assert.equal(rowB.generated, null);
    assert.equal(rowB.latestCircuitBroken, true);
    assert.equal(rowB.reviewed, 0);
    assert.equal(rowC.adopted, null); // 未批准
    // 排序：createdAt 倒序
    assert.deepEqual(
      g.taskRows.map((r) => r.taskId),
      ["C", "B", "A"],
    );
  });
});

describe("aggregateTask", () => {
  const events = buildScenario().filter((e) => e.taskId === "A");
  const d = aggregateTask(events)!;

  it("builds node rounds for all four steps", () => {
    const steps = d.rounds.map((r) => `${r.step}#${r.round}`);
    assert.deepEqual(steps, ["requirement#1", "cases#1", "cases#2", "execution#1", "report#1"]);
  });

  it("cases rounds: per-round adoption vs approved final snapshot", () => {
    const c1 = d.rounds.find((r) => r.step === "cases" && r.round === 1)!;
    assert.equal(c1.caseCount, 10);
    assert.equal(c1.model, "claude-opus-4-5");
    assert.deepEqual(c1.adoption, { rate: 0.9, kept: 7, modified: 2, removed: 1, added: 1 });
    // 第 2 轮只有 cases_generated 没有 step_completed → 合成轮，时间取专属事件
    const c2 = d.rounds.find((r) => r.step === "cases" && r.round === 2)!;
    assert.equal(c2.at, "2026-06-30 09:30:00");
    assert.equal(c2.status, null);
  });

  it("execution & report rounds carry env/model/results/reviews", () => {
    const e1 = d.rounds.find((r) => r.step === "execution")!;
    assert.equal(e1.env, "sit");
    assert.equal(e1.passRate, 0.8);
    assert.equal(e1.runHash, "r1");
    assert.equal(e1.durationMs, 600000);
    const r1 = d.rounds.find((r) => r.step === "report")!;
    assert.equal(r1.reviewed, 4);
    assert.equal(r1.accuracy, 0.75);
  });

  it("adoption & review summaries match the global口径", () => {
    assert.equal(d.adoption?.generated, 10);
    assert.equal(d.adoption?.adoptionRate, 0.9);
    assert.equal(d.adoption?.reworkRounds, 1);
    assert.equal(d.review.reviewed, 4);
    assert.equal(d.review.accuracy, 0.75);
  });

  it("returns null for empty input", () => {
    assert.equal(aggregateTask([]), null);
  });
});

describe("aggregateModels", () => {
  const rows = aggregateModels(buildScenario());
  const byModel = Object.fromEntries(rows.map((r) => [r.model, r]));

  it("adoption attributes to the first cases-generation model", () => {
    const opus = byModel["claude-opus-4-5"];
    assert.ok(opus);
    assert.equal(opus.adoptionGenerated, 10);
    assert.equal(opus.adoptionKeptModified, 9);
    assert.equal(opus.adoptionRate, 0.9);
    // opus 没执行过 → 无执行指标
    assert.equal(opus.executionRuns, 0);
    assert.equal(opus.passRate, null);
  });

  it("accuracy/pass/duration attribute to the execution model; broken runs excluded", () => {
    const sonnet = byModel["claude-sonnet-4-5"];
    assert.ok(sonnet);
    assert.equal(sonnet.executionRuns, 2); // A + B（熔断轮也算一次执行）
    assert.equal(sonnet.results.total, 10); // 熔断轮结果不计
    assert.equal(sonnet.passRate, 0.8);
    assert.equal(sonnet.reviewed, 4);
    assert.equal(sonnet.accuracy, 0.75);
    assert.equal(sonnet.coverage, 0.4);
    assert.equal(sonnet.avgCaseDurationMs, Math.round((10000 + 20000 + 130000) / 3));
    assert.equal(sonnet.smallSample, true);
    assert.equal(sonnet.tasks, 2);
  });

  it("gemini only touched task C", () => {
    const gemini = byModel["gemini-2.5-pro"];
    assert.ok(gemini);
    assert.equal(gemini.tasks, 1);
    assert.equal(gemini.adoptionGenerated, 0); // C 未批准 → 不进采纳
  });
});

// ---------- 评审后补充的防回归场景 ----------

describe("runHash backfill (execution_completed without runHash)", () => {
  // 执行事件缺 runHash 时（事件缺失/早期版本），用其后最近的 report_generated 回填，
  // 熔断排除与模型归因不因此静默失效。
  function scenario(broken: boolean): TestStatsEvent[] {
    return [
      ev("task_created", "E", "2026-07-06 10:00:00", { source: "imported_requirement" }),
      ev(
        "execution_completed",
        "E",
        "2026-07-06 11:00:00",
        {
          env: "sit",
          model: "m-exec",
          counts: { total: 2, pass: broken ? 0 : 2, fail: broken ? 2 : 0, partial: 0, blocked: 0 },
          circuitBroken: broken,
          tests: [],
        },
        { env: "sit" },
      ),
      ev("report_generated", "E", "2026-07-06 11:02:00", { env: "sit", runHash: "rX", model: "m-exec" }, { env: "sit" }),
      ev("report_reviewed", "E", "2026-07-06 12:00:00", { caseId: "c1", aiStatus: "pass", verdict: "accurate", runHash: "rX" }),
    ];
  }
  it("links reviews to the run via report_generated when run lacks runHash", () => {
    const g = aggregateGlobal(scenario(false));
    assert.equal(g.review.totalResults, 2);
    assert.equal(g.review.reviewed, 1);
    assert.equal(g.review.accuracy, 1);
    const m = aggregateModels(scenario(false)).find((x) => x.model === "m-exec")!;
    assert.equal(m.reviewed, 1);
    assert.equal(m.accuracy, 1);
  });
  it("still excludes circuit-broken rounds when run lacks runHash", () => {
    const g = aggregateGlobal(scenario(true));
    assert.equal(g.review.totalResults, 0);
    assert.equal(g.review.reviewed, 0);
    assert.equal(g.review.accuracy, null);
    const m = aggregateModels(scenario(true)).find((x) => x.model === "m-exec")!;
    assert.equal(m.reviewed, 0);
    assert.equal(m.executionRuns, 1);
  });
});

describe("windowed aggregation keeps full-context attribution", () => {
  // 路由对窗口查询补齐全量任务上下文，聚合层按窗口做计入门控——
  // 窗外执行轮的熔断排除、首轮基线等归因不丢失，覆盖率不越界。
  const range = { from: "2026-07-01 00:00:00", to: null as string | null };
  const g = aggregateGlobal(buildScenario(), range);

  it("tasks counted by creation time", () => {
    assert.deepEqual(g.tasks, { total: 2, aiFlow: 1, importedCases: 1, deleted: 0 }); // B、C；A 创建在窗外
  });
  it("adoption counted at approval time, baseline may live outside the window", () => {
    assert.equal(g.adoption.generated, 10); // A 批准 7-01 在窗内
    assert.equal(g.adoption.adoptionRate, 0.9);
    assert.equal(g.adoption.reworkRounds, 0); // A 的返工轮在 6-30，窗外
  });
  it("broken-run reviews stay excluded and coverage stays <= 1", () => {
    assert.equal(g.review.totalResults, 10);
    assert.equal(g.review.reviewed, 4);
    assert.equal(g.review.coverage, 0.4);
    assert.equal(g.review.accuracy, 0.75);
  });
  it("execution and step durations gated by event time", () => {
    assert.equal(g.execution.runs, 2); // A 的 7-01 执行 + B 的 7-06 熔断轮
    assert.equal(g.execution.stepAvgDurationsMs.requirement, undefined); // 6-30 在窗外
    assert.equal(g.execution.stepAvgDurationsMs.execution, 600000);
  });
});

describe("cases_approved re-fire keeps earliest approval time (M1)", () => {
  // 重跑执行会重复发 cases_approved：内容取最新、时间取最早，否则窗口/周趋势把采纳量挪走。
  const finalSnap = snapshotCases([mkCase("TC-1", "a"), mkCase("TC-2", "b")]);
  const base = snapshotCases([mkCase("TC-1", "a"), mkCase("TC-2", "b"), mkCase("TC-3", "c")]);
  const diff = diffCases(base, finalSnap); // kept 2, removed 1
  const events: TestStatsEvent[] = [
    ev("task_created", "T", "2026-06-01 09:00:00", { source: "imported_requirement" }),
    ev("cases_generated", "T", "2026-06-01 09:10:00", { round: 1, caseCount: 3, model: "m1", cases: base }),
    ev("cases_approved", "T", "2026-06-01 10:00:00", { finalCount: 2, final: finalSnap, diff, aiRounds: 1 }), // 第 1 周批准
    ev("execution_completed", "T", "2026-06-01 11:00:00", { env: "sit", model: "m1", counts: { total: 2, pass: 2, fail: 0, partial: 0, blocked: 0 }, circuitBroken: false, runHash: "r1", tests: [] }, { env: "sit" }),
    // 第 5 周重跑执行 → 再发一次 cases_approved（内容相同）
    ev("cases_approved", "T", "2026-07-01 10:00:00", { finalCount: 2, final: finalSnap, diff, aiRounds: 1 }),
    ev("execution_completed", "T", "2026-07-01 11:00:00", { env: "sit", model: "m1", counts: { total: 2, pass: 2, fail: 0, partial: 0, blocked: 0 }, circuitBroken: false, runHash: "r2", tests: [] }, { env: "sit" }),
  ];
  it("adoption stays in the FIRST approval's week window, not the re-run week", () => {
    const wkFirst = aggregateGlobal(events, { from: "2026-06-01 00:00:00", to: "2026-06-07 23:59:59" });
    assert.equal(wkFirst.adoption.generated, 3, "首周窗口应含采纳");
    assert.equal(wkFirst.adoption.kept, 2);
    const wkRerun = aggregateGlobal(events, { from: "2026-06-29 00:00:00", to: "2026-07-05 23:59:59" });
    assert.equal(wkRerun.adoption.generated, 0, "重跑周窗口不应重复计采纳");
  });
  it("all-time totals count adoption exactly once", () => {
    const g = aggregateGlobal(events);
    assert.equal(g.adoption.eligibleTasks, 1);
    assert.equal(g.adoption.generated, 3);
    assert.equal(g.adoption.kept, 2);
  });
});

describe("review undo via 'cleared' sentinel (M2)", () => {
  const base: TestStatsEvent[] = [
    ev("execution_completed", "U", "2026-07-06 11:00:00", { env: "sit", model: "m1", counts: { total: 2, pass: 1, fail: 1, partial: 0, blocked: 0 }, circuitBroken: false, runHash: "rh", tests: [] }, { env: "sit" }),
    ev("report_reviewed", "U", "2026-07-06 12:00:00", { caseId: "TC-1", verdict: "accurate", runHash: "rh" }),
    ev("report_reviewed", "U", "2026-07-06 12:01:00", { caseId: "TC-2", verdict: "false_fail", runHash: "rh" }),
  ];
  it("counts both reviews before undo", () => {
    const g = aggregateGlobal(base);
    assert.equal(g.review.reviewed, 2);
    assert.equal(g.review.accurate, 1);
    assert.equal(g.review.falseFail, 1);
  });
  it("a later 'cleared' removes the review from the denominator (last-wins)", () => {
    const withUndo = [...base, ev("report_reviewed", "U", "2026-07-06 12:05:00", { caseId: "TC-2", verdict: "cleared", runHash: "rh" })];
    const g = aggregateGlobal(withUndo);
    assert.equal(g.review.reviewed, 1, "撤销后只剩 1 条");
    assert.equal(g.review.falseFail, 0);
    assert.equal(g.review.accuracy, 1); // 剩下的 TC-1 accurate
  });
  it("re-reviewing after clear counts again", () => {
    const reReview = [
      ...base,
      ev("report_reviewed", "U", "2026-07-06 12:05:00", { caseId: "TC-2", verdict: "cleared", runHash: "rh" }),
      ev("report_reviewed", "U", "2026-07-06 12:10:00", { caseId: "TC-2", verdict: "accurate", runHash: "rh" }),
    ];
    const g = aggregateGlobal(reReview);
    assert.equal(g.review.reviewed, 2);
    assert.equal(g.review.accurate, 2);
  });
});

describe("aggregateTask pairs rounds by time, not index", () => {
  it("revise round (no step_completed) does not steal the next full run's duration", () => {
    const events = [
      ev("task_created", "D", "2026-07-06 09:00:00", { source: "imported_requirement" }),
      ev("cases_generated", "D", "2026-07-06 09:10:00", { round: 1, caseCount: 12, model: "m1", cases: [] }),
      ev("step_completed", "D", "2026-07-06 09:10:01", { step: "cases", status: "done", durationMs: 120000, model: "m1" }),
      // revise 轮：只有 cases_generated，没有 step_completed
      ev("cases_generated", "D", "2026-07-06 09:30:00", { round: 2, caseCount: 12, model: "m1", cases: [] }),
      ev("cases_generated", "D", "2026-07-06 10:00:00", { round: 3, caseCount: 15, model: "m1", cases: [] }),
      ev("step_completed", "D", "2026-07-06 10:00:01", { step: "cases", status: "done", durationMs: 300000, model: "m1" }),
    ];
    const d = aggregateTask(events)!;
    const cases = d.rounds.filter((r) => r.step === "cases");
    assert.equal(cases.length, 3);
    assert.equal(cases[0].durationMs, 120000);
    assert.equal(cases[1].durationMs, null); // revise 轮不背第二次整跑的用时
    assert.equal(cases[1].status, null);
    assert.equal(cases[2].durationMs, 300000);
    assert.equal(cases[2].caseCount, 15);
    const times = cases.map((r) => r.at);
    assert.deepEqual([...times].sort(), times); // 轮次时间单调
  });
});

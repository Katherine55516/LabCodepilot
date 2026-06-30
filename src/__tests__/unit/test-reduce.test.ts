/**
 * Unit tests for the deterministic execution-result reduction (src/lib/test/reduce.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-reduce.test.ts
 *
 * Locks the non-LLM aggregation/safety logic: harvest @@RESULT lines, four-state
 * counts, ENV_HINT fail→blocked reclass, 401 circuit-breaker, passStr/status.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { harvestResults, reduceResults, reduceFromText, sanitizeApi } from "../../lib/test/reduce";

const OPTS = { module: "订单", env: "local", time: "2026-06-22T10:00:00.000Z" };

describe("harvestResults", () => {
  it("extracts @@RESULT lines, ignoring prose and malformed lines", () => {
    const text = [
      "▶ 用例 1/2：登录",
      '@@RESULT {"id":"TC-001","status":"pass","actual":"ok","evidence":["TC-001.png"]}',
      "一些普通输出",
      "@@RESULT {不是合法json}",
      '@@RESULT {"id":"TC-002","status":"fail","error":"x"}',
    ].join("\n");
    const r = harvestResults(text);
    assert.equal(r.length, 2);
    assert.equal(r[0].id, "TC-001");
    assert.equal(r[1].status, "fail");
  });

  it("tolerates @@RESULT not at line start", () => {
    const r = harvestResults('prefix @@RESULT {"id":"TC-9","status":"pass"}');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, "TC-9");
  });
});

describe("reduceResults — counts + normalization", () => {
  it("counts four states and normalizes aliases", () => {
    const run = reduceResults(
      [
        { id: "A", status: "passed" }, // alias → pass
        { id: "B", status: "fail", error: "后端未校验" },
        { id: "C", status: "skipped" }, // alias → partial
        { id: "D", status: "blocked", error: "缺 admin" },
      ],
      OPTS,
    );
    assert.deepEqual(run.counts, { total: 4, pass: 1, fail: 1, partial: 1, blocked: 1 });
    assert.equal(run.passStr, "1/4");
    assert.equal(run.status, "failed"); // any real fail ⇒ failed
    assert.equal(run.circuitBroken, false);
  });

  it("unknown status falls back to fail", () => {
    const run = reduceResults([{ id: "A", status: "weird" }], OPTS);
    assert.equal(run.counts.fail, 1);
  });

  it("all-pass ⇒ status done", () => {
    const run = reduceResults([{ id: "A", status: "pass" }, { id: "B", status: "pass" }], OPTS);
    assert.equal(run.status, "done");
    assert.equal(run.passStr, "2/2");
  });

  it("only blocked (nothing ran) ⇒ status blocked", () => {
    const run = reduceResults([{ id: "A", status: "blocked", error: "环境不可达" }], OPTS);
    assert.equal(run.status, "blocked");
  });
});

describe("reduceResults — ENV_HINT reclass", () => {
  it("reclasses a fail with a connection error to blocked (not an app bug)", () => {
    const run = reduceResults(
      [
        { id: "A", status: "fail", error: "net::ERR_CONNECTION_REFUSED at /orders" },
        { id: "B", status: "fail", error: "断言失败：预期库存不足提示未出现" },
      ],
      OPTS,
    );
    // A → blocked (env), B stays fail
    assert.equal(run.counts.blocked, 1);
    assert.equal(run.counts.fail, 1);
    const a = run.tests.find((t) => t.id === "A");
    assert.equal(a?.status, "blocked");
  });

  it("matches Chinese connection wording (拒绝连接 / 无法访问)", () => {
    const run = reduceResults([{ id: "A", status: "fail", error: "目标地址拒绝连接" }], OPTS);
    assert.equal(run.tests[0].status, "blocked");
  });
});

describe("reduceResults — 401 circuit-breaker", () => {
  it("trips when >50% of fails carry a 401", () => {
    const run = reduceResults(
      [
        { id: "A", status: "fail", error: "请求返回 401 未授权" },
        { id: "B", status: "fail", error: "接口 401" },
        { id: "C", status: "fail", error: "真实断言失败" },
      ],
      OPTS,
    );
    // 2 of 3 fails are 401 → circuit broken
    assert.equal(run.circuitBroken, true);
  });

  it("does not trip when 401 is a minority of fails", () => {
    const run = reduceResults(
      [
        { id: "A", status: "fail", error: "401" },
        { id: "B", status: "fail", error: "断言失败 X" },
        { id: "C", status: "fail", error: "断言失败 Y" },
      ],
      OPTS,
    );
    assert.equal(run.circuitBroken, false);
  });

  it("does not trip with zero fails", () => {
    const run = reduceResults([{ id: "A", status: "pass" }], OPTS);
    assert.equal(run.circuitBroken, false);
  });
});

describe("reduceFromText", () => {
  it("harvests + reduces end to end", () => {
    const text = [
      '@@RESULT {"id":"TC-001","status":"pass","actual":"已跳转 /home","evidence":["TC-001.png"]}',
      '@@RESULT {"id":"TC-002","status":"fail","actual":"无提示","error":"后端未校验库存"}',
      '@@RESULT {"id":"TC-003","status":"blocked","error":"缺 admin 账号"}',
    ].join("\n");
    const run = reduceFromText(text, OPTS);
    assert.deepEqual(run.counts, { total: 3, pass: 1, fail: 1, partial: 0, blocked: 1 });
    assert.equal(run.passStr, "1/3");
    assert.equal(run.module, "订单");
    assert.equal(run.tests[0].evidence[0], "TC-001.png");
  });
});

describe("reduceResults — dual-rate (oracle 双轴)", () => {
  it("no verification map ⇒ degrades to single-rate (funcCounts === counts)", () => {
    const run = reduceResults(
      [{ id: "A", status: "pass" }, { id: "B", status: "fail", error: "x" }],
      OPTS,
    );
    assert.deepEqual(run.funcCounts, run.counts);
    assert.equal(run.funcPassStr, run.passStr);
    assert.equal(run.regressionTotal, 0);
  });

  it("excludes 回归基线 cases from the functional pass rate", () => {
    const run = reduceResults(
      [
        { id: "A", status: "pass" }, // 功能验证 pass
        { id: "B", status: "fail", error: "真实缺陷" }, // 功能验证 fail
        { id: "C", status: "pass" }, // 回归基线 pass — must NOT inflate functional rate
        { id: "D", status: "pass" }, // 回归基线 pass
      ],
      { ...OPTS, verificationById: { A: "功能验证", B: "功能验证", C: "回归基线", D: "回归基线" } },
    );
    assert.equal(run.passStr, "3/4"); // execution rate counts everything
    assert.deepEqual(run.funcCounts, { total: 2, pass: 1, fail: 1, partial: 0, blocked: 0 });
    assert.equal(run.funcPassStr, "1/2"); // functional rate excludes the 2 regression passes
    assert.equal(run.regressionTotal, 2);
  });

  it("all 回归基线 ⇒ funcPassStr is N/A (never report 100% functional)", () => {
    const run = reduceResults(
      [{ id: "A", status: "pass" }, { id: "B", status: "pass" }],
      { ...OPTS, verificationById: { A: "回归基线", B: "回归基线" } },
    );
    assert.equal(run.passStr, "2/2"); // execution rate is still 100%
    assert.equal(run.funcPassStr, "N/A"); // but functional rate is N/A — only locks status quo
    assert.equal(run.funcCounts.total, 0);
    assert.equal(run.regressionTotal, 2);
  });

  it("a test id absent from the map defaults to 功能验证 (lineage-safe)", () => {
    const run = reduceResults(
      [{ id: "A", status: "pass" }, { id: "B", status: "pass" }],
      { ...OPTS, verificationById: { A: "回归基线" } }, // B not in the map
    );
    assert.equal(run.regressionTotal, 1);
    assert.deepEqual(run.funcCounts, { total: 1, pass: 1, fail: 0, partial: 0, blocked: 0 });
    assert.equal(run.funcPassStr, "1/1");
  });
});

describe("api passthrough + sanitizeApi (缺陷报告接口信息地基)", () => {
  it("threads a well-formed api object from a result into the reduced test", () => {
    const run = reduceResults(
      [
        {
          id: "TC-007",
          status: "fail",
          error: "金额为 0",
          api: { method: "POST", url: "/api/mealAllowance/calc", status: 200, requestBody: "{p:1}", responseBody: '{"amount":0}' },
        },
      ],
      OPTS,
    );
    assert.equal(run.tests[0].api?.method, "POST");
    assert.equal(run.tests[0].api?.url, "/api/mealAllowance/calc");
    assert.equal(run.tests[0].api?.status, 200);
    assert.equal(run.tests[0].api?.responseBody, '{"amount":0}');
  });

  it("omits api on cases without it (pass cases stay clean)", () => {
    const run = reduceResults([{ id: "A", status: "pass" }], OPTS);
    assert.equal(run.tests[0].api, undefined);
  });

  it("sanitizeApi drops non-objects and empty captures", () => {
    assert.equal(sanitizeApi(undefined), undefined);
    assert.equal(sanitizeApi("nope"), undefined);
    assert.equal(sanitizeApi({}), undefined);
    assert.equal(sanitizeApi({ method: "", url: "" }), undefined);
  });

  it("sanitizeApi truncates oversized bodies (~4000 chars + ellipsis)", () => {
    const big = "x".repeat(9000);
    const api = sanitizeApi({ url: "/api/x", requestBody: big, responseBody: big });
    assert.ok(api);
    assert.ok((api!.requestBody?.length ?? 0) <= 4001);
    assert.ok(api!.requestBody!.endsWith("…"));
    assert.ok(api!.responseBody!.endsWith("…"));
  });

  it("reduceFromText carries api end-to-end", () => {
    const text = '@@RESULT {"id":"TC-9","status":"fail","error":"e","api":{"method":"GET","url":"/x","status":500}}';
    const run = reduceFromText(text, OPTS);
    assert.equal(run.tests[0].api?.status, 500);
    assert.equal(run.tests[0].api?.method, "GET");
  });
});

describe("reduceResults — caseIds 兜底补全（漏执行用例 → 报告以用例全集为准）", () => {
  it("backfills caseIds missing from results as blocked (未执行)", () => {
    const run = reduceResults(
      [{ id: "A", status: "pass" }, { id: "B", status: "fail", error: "真实缺陷" }],
      { ...OPTS, caseIds: ["A", "B", "C", "D"] },
    );
    // 报告用例数 = cases 全集 4，而非仅执行出结果的 2（问题②的核心修复）。
    assert.deepEqual(run.counts, { total: 4, pass: 1, fail: 1, partial: 0, blocked: 2 });
    assert.equal(run.tests.length, 4);
    const c = run.tests.find((t) => t.id === "C");
    assert.equal(c?.status, "blocked");
    assert.ok(c?.error.includes("未执行"));
  });

  it("no caseIds ⇒ behavior unchanged (向后兼容)", () => {
    const run = reduceResults([{ id: "A", status: "pass" }], OPTS);
    assert.equal(run.counts.total, 1);
    assert.equal(run.tests.length, 1);
  });

  it("does not duplicate when every caseId already has a result", () => {
    const run = reduceResults(
      [{ id: "A", status: "pass" }, { id: "B", status: "pass" }],
      { ...OPTS, caseIds: ["A", "B"] },
    );
    assert.equal(run.tests.length, 2);
    assert.equal(run.counts.total, 2);
  });

  it("backfilled 未执行 cases count toward funcCounts (不虚报功能通过率)", () => {
    const run = reduceResults(
      [{ id: "A", status: "pass" }],
      { ...OPTS, caseIds: ["A", "B"], verificationById: { A: "功能验证", B: "功能验证" } },
    );
    // B 未执行 → blocked，计入功能验证 total，通过率 1/2 不虚高。
    assert.deepEqual(run.funcCounts, { total: 2, pass: 1, fail: 0, partial: 0, blocked: 1 });
    assert.equal(run.funcPassStr, "1/2");
  });

  it("backfilled blocked does not trip the 401 circuit-breaker", () => {
    const run = reduceResults(
      [{ id: "A", status: "pass" }],
      { ...OPTS, caseIds: ["A", "B", "C"] },
    );
    assert.equal(run.circuitBroken, false);
  });
});

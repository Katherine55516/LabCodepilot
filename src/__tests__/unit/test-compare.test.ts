/**
 * Unit tests for the pure run-vs-run diff (src/lib/test/compare.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-compare.test.ts
 *
 * Locks per-case change classification (added/removed/improved/regressed/
 * unchanged + regressed-first sort) and dual-rate pass-rate deltas (执行通过率 +
 * 功能验证通过率 via funcCounts, with back-compat fallback + N/A handling).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffRuns } from "../../lib/test/compare";

const C = (pass: number, total: number, fail = 0, partial = 0, blocked = 0) => ({
  total,
  pass,
  fail,
  partial,
  blocked,
});

describe("diffRuns — per-case change", () => {
  it("classifies improved / regressed / added / removed / unchanged", () => {
    const prev = {
      tests: [
        { id: "A", status: "pass" },
        { id: "B", status: "fail" },
        { id: "C", status: "pass" },
        { id: "D", status: "pass" },
      ],
      counts: C(3, 4, 1),
    };
    const curr = {
      tests: [
        { id: "A", status: "pass" }, // unchanged
        { id: "B", status: "pass" }, // improved (fail→pass)
        { id: "C", status: "fail" }, // regressed (pass→fail)
        { id: "E", status: "pass" }, // added (D removed)
      ],
      counts: C(3, 4, 1),
    };
    const d = diffRuns(prev, curr);
    const byId = Object.fromEntries(d.cases.map((c) => [c.id, c.change]));
    assert.equal(byId.A, "unchanged");
    assert.equal(byId.B, "improved");
    assert.equal(byId.C, "regressed");
    assert.equal(byId.D, "removed");
    assert.equal(byId.E, "added");
    assert.equal(d.improved, 1);
    assert.equal(d.regressed, 1);
    assert.equal(d.added, 1);
    assert.equal(d.removed, 1);
  });

  it("sorts regressed cases first (most-attention-worthy)", () => {
    const prev = { tests: [{ id: "A", status: "pass" }, { id: "B", status: "pass" }], counts: C(2, 2) };
    const curr = { tests: [{ id: "A", status: "pass" }, { id: "B", status: "fail" }], counts: C(1, 2, 1) };
    const d = diffRuns(prev, curr);
    assert.equal(d.cases[0].id, "B");
    assert.equal(d.cases[0].change, "regressed");
  });

  it("partial→pass is improved, pass→partial is regressed (rank order)", () => {
    const prev = { tests: [{ id: "A", status: "partial" }, { id: "B", status: "pass" }], counts: C(1, 2, 0, 1) };
    const curr = { tests: [{ id: "A", status: "pass" }, { id: "B", status: "partial" }], counts: C(1, 2, 0, 1) };
    const d = diffRuns(prev, curr);
    const byId = Object.fromEntries(d.cases.map((c) => [c.id, c.change]));
    assert.equal(byId.A, "improved");
    assert.equal(byId.B, "regressed");
  });
});

describe("diffRuns — dual-rate deltas", () => {
  it("computes exec + func pass-rate deltas independently", () => {
    const prev = { tests: [], counts: C(2, 4), funcCounts: C(1, 2) };
    const curr = { tests: [], counts: C(3, 4), funcCounts: C(2, 2) };
    const d = diffRuns(prev, curr);
    assert.deepEqual(d.execRate, { prev: 50, curr: 75, delta: 25 });
    assert.deepEqual(d.funcRate, { prev: 50, curr: 100, delta: 50 });
  });

  it("func rate falls back to counts when funcCounts absent (back-compat)", () => {
    const prev = { tests: [], counts: C(1, 2) };
    const curr = { tests: [], counts: C(2, 2) };
    const d = diffRuns(prev, curr);
    assert.deepEqual(d.funcRate, { prev: 50, curr: 100, delta: 50 });
  });

  it("rate is N/A (null) when denom is 0 — e.g. all 回归基线", () => {
    const prev = { tests: [], counts: C(2, 2), funcCounts: C(0, 0) };
    const curr = { tests: [], counts: C(2, 2), funcCounts: C(0, 0) };
    const d = diffRuns(prev, curr);
    assert.equal(d.funcRate.prev, null);
    assert.equal(d.funcRate.curr, null);
    assert.equal(d.funcRate.delta, null);
    assert.deepEqual(d.execRate, { prev: 100, curr: 100, delta: 0 });
  });
});

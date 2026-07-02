/**
 * Regression for H1: the 报告 view's 「功能验证通过率」 must use the backend's
 * oracle-dual-axis funcCounts (回归基线 excluded), NOT pass/(total-blocked).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-func-rate.test.ts
 *
 * Before the fix ReportView computed funcRate = pass / (total - blocked), conflating
 * "blocked" with "regression baseline" — so a run with all-passing 回归基线 cases
 * could falsely show 100% functional pass. funcPassRateStr locks the correct口径.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { funcPassRateStr } from "../../lib/test/compare";

describe("funcPassRateStr — 功能验证通过率口径 (H1)", () => {
  it("uses backend funcCounts (excludes 回归基线), NOT pass/(total-blocked)", () => {
    // 10 cases = 3 回归基线(all pass) + 7 功能验证(5 pass, 2 blocked).
    // 执行口径 four: total=10, pass=8 (3 regression + 5 functional), blocked=2.
    // WRONG old formula: 8/(10-2) = 100%. CORRECT (funcCounts): 5/7 = 71%.
    const four = { total: 10, pass: 8, blocked: 2 };
    const funcCounts = { total: 7, pass: 5 };
    assert.equal(funcPassRateStr(four, funcCounts, "5/7"), "71%");
    assert.notEqual(funcPassRateStr(four, funcCounts, "5/7"), "100%");
  });

  it("returns N/A when every case is 回归基线 — never reports 100% functional", () => {
    const four = { total: 3, pass: 3, blocked: 0 };
    assert.equal(funcPassRateStr(four, { total: 0, pass: 0 }, "N/A"), "N/A");
  });

  it("falls back to exec rate minus blocked for legacy reports without funcCounts", () => {
    const four = { total: 4, pass: 2, blocked: 1 };
    assert.equal(funcPassRateStr(four, undefined, undefined), "67%"); // 2/(4-1)
  });

  it("returns N/A when there is nothing to measure", () => {
    assert.equal(funcPassRateStr({ total: 0, pass: 0, blocked: 0 }, undefined, undefined), "N/A");
  });

  it("reports 100% functional only when funcCounts actually says so", () => {
    assert.equal(funcPassRateStr({ total: 5, pass: 5, blocked: 0 }, { total: 5, pass: 5 }, "5/5"), "100%");
  });
});

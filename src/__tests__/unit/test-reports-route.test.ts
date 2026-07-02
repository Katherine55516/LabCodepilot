/**
 * Integration tests for the 报告列表 route (src/app/api/test/reports/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-reports-route.test.ts
 *
 * Locks: dual-rate funcCounts/funcPassStr pass-through (M6), legacy fallback,
 * _evidence skipping, markdown + defect doc inclusion, and 400 guard.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "../../app/api/test/reports/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "reports-route-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const plantRun = (task: string, env: string, runJson: object, opts?: { md?: string; defect?: string }) => {
  const dir = path.join(proj, "AI_LabTest", "report", task);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${task}-${env}.run.json`), JSON.stringify(runJson));
  if (opts?.md) fs.writeFileSync(path.join(dir, `${task}-${env}.md`), opts.md);
  if (opts?.defect) fs.writeFileSync(path.join(dir, `${task}-${env}-缺陷报告.md`), opts.defect);
};
const get = () => GET(new Request("http://x/api/test/reports?projectPath=" + encodeURIComponent(proj)));

describe("GET /api/test/reports", () => {
  it("returns [] when no report dir exists", async () => {
    assert.deepEqual((await (await get()).json()).reports, []);
  });
  it("400 without projectPath", async () => {
    const res = await GET(new Request("http://x/api/test/reports"));
    assert.equal(res.status, 400);
  });
  it("passes through funcCounts + funcPassStr + regressionTotal (M6 dual-rate)", async () => {
    plantRun("订单", "local", {
      env: "local", time: "t", status: "failed", passStr: "8/10",
      counts: { total: 10, pass: 8, fail: 0, partial: 0, blocked: 2 },
      funcCounts: { total: 7, pass: 5, fail: 0, partial: 0, blocked: 2 },
      funcPassStr: "5/7", regressionTotal: 3,
      tests: [{ id: "TC-1", status: "pass" }],
    });
    const r = (await (await get()).json()).reports[0];
    assert.deepEqual(r.funcCounts, { total: 7, pass: 5, fail: 0, partial: 0, blocked: 2 });
    assert.equal(r.funcPassStr, "5/7");
    assert.equal(r.regressionTotal, 3);
  });
  it("falls funcCounts back to counts + funcPassStr to passStr for legacy run.json", async () => {
    plantRun("旧任务", "local", {
      env: "local", time: "t", status: "done", passStr: "2/2",
      counts: { total: 2, pass: 2, fail: 0, partial: 0, blocked: 0 },
      tests: [],
    });
    const r = (await (await get()).json()).reports[0];
    assert.deepEqual(r.funcCounts, r.counts);
    assert.equal(r.funcPassStr, "2/2");
    assert.equal(r.regressionTotal, 0);
  });
  it("includes markdown + defectMarkdown and skips the _evidence dir", async () => {
    plantRun("订单", "local", { env: "local", counts: {}, tests: [] }, { md: "# 报告", defect: "# 缺陷" });
    fs.mkdirSync(path.join(proj, "AI_LabTest", "report", "_evidence", "订单-local"), { recursive: true });
    const reports = (await (await get()).json()).reports;
    assert.equal(reports.length, 1); // _evidence dir skipped
    assert.equal(reports[0].markdown, "# 报告");
    assert.equal(reports[0].defectMarkdown, "# 缺陷");
  });
});

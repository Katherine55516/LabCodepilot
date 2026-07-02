/**
 * Integration tests for the 报告历史 route (src/app/api/test/reports/history/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-reports-history-route.test.ts
 *
 * Thin wrapper over listRunHistory (unit-tested in test-history.ts); here we lock
 * the route wiring: param guard (H2), env default, newest-first pass-through.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "../../app/api/test/reports/history/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "rh-route-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const histDir = (task: string) => path.join(proj, "AI_LabTest", "report", task, ".history");
const plantSnap = (task: string, env: string, stamp: string, run: object) => {
  const dir = histDir(task);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${task}-${env}-${stamp}.run.json`), JSON.stringify(run));
};
const get = (q: Record<string, string>) =>
  GET(new Request("http://x/api/test/reports/history?" + new URLSearchParams(q).toString()));

describe("GET /api/test/reports/history", () => {
  it("400 without projectPath/taskName", async () => {
    assert.equal((await get({ projectPath: proj })).status, 400);
  });
  it("400 on a traversal taskName (H2)", async () => {
    assert.equal((await get({ projectPath: proj, taskName: "../evil", env: "local" })).status, 400);
  });
  it("returns [] for a series with no snapshots", async () => {
    const res = await get({ projectPath: proj, taskName: "订单", env: "local" });
    assert.deepEqual((await res.json()).history, []);
  });
  it("lists snapshots newest-first for an existing series", async () => {
    const c = { total: 1, pass: 1, fail: 0, partial: 0, blocked: 0 };
    plantSnap("订单", "local", "20260101-000000-000", { time: "t1", status: "done", passStr: "1/1", counts: c, tests: [{ id: "A", status: "pass" }] });
    plantSnap("订单", "local", "20260102-000000-000", { time: "t2", status: "failed", passStr: "0/1", counts: { ...c, pass: 0, fail: 1 }, tests: [{ id: "A", status: "fail" }] });
    const res = await get({ projectPath: proj, taskName: "订单", env: "local" });
    const hist = (await res.json()).history;
    assert.equal(hist.length, 2);
    assert.equal(hist[0].stamp, "20260102-000000-000"); // newest first
    assert.equal(hist[0].status, "failed");
  });
});

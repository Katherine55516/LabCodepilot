/**
 * Unit tests for run.json history snapshots (src/lib/test/history.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-history.test.ts
 *
 * Locks stampNow formatting, snapshotRunJson SHA-1 dedup + dir creation +
 * per-series isolation, and listRunHistory newest-first ordering + malformed-file
 * tolerance + legacy funcCounts fallback.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stampNow, snapshotRunJson, listRunHistory } from "../../lib/test/history";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hist-test-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const counts = (o: Partial<{ total: number; pass: number; fail: number; partial: number; blocked: number }>) => ({
  total: 0, pass: 0, fail: 0, partial: 0, blocked: 0, ...o,
});
const RUN_A = JSON.stringify({
  module: "订单", env: "local", time: "2026-01-01T00:00:00Z", status: "done",
  counts: counts({ total: 2, pass: 2 }), passStr: "2/2",
  funcCounts: counts({ total: 2, pass: 2 }), funcPassStr: "2/2",
  tests: [{ id: "TC-1", status: "pass" }, { id: "TC-2", status: "pass" }],
});
const RUN_B = JSON.stringify({
  module: "订单", env: "local", time: "2026-01-02T00:00:00Z", status: "failed",
  counts: counts({ total: 2, pass: 1, fail: 1 }), passStr: "1/2",
  funcCounts: counts({ total: 2, pass: 1, fail: 1 }), funcPassStr: "1/2",
  tests: [{ id: "TC-1", status: "pass" }, { id: "TC-2", status: "fail" }],
});
const historyDir = () => path.join(tmp, ".history");

describe("stampNow", () => {
  it("formats YYYYMMDD-HHmmss-SSS with zero-padding (month is 1-based)", () => {
    // 2026-01-05 03:07:09.042 local
    assert.equal(stampNow(new Date(2026, 0, 5, 3, 7, 9, 42)), "20260105-030709-042");
  });
  it("is lexicographically sortable = chronological order", () => {
    const a = stampNow(new Date(2026, 5, 1, 0, 0, 0, 0));
    const b = stampNow(new Date(2026, 5, 1, 0, 0, 0, 1));
    assert.ok(a < b, `${a} should sort before ${b}`);
  });
});

describe("snapshotRunJson", () => {
  it("writes the first snapshot and creates the .history dir", () => {
    const r = snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_A, stamp: "20260101-000000-000" });
    assert.equal(r.skipped, false);
    assert.equal(r.snapshot, "订单-local-20260101-000000-000.run.json");
    assert.ok(fs.existsSync(path.join(historyDir(), r.snapshot!)));
  });
  it("skips an identical consecutive snapshot (SHA-1 dedup)", () => {
    snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_A, stamp: "20260101-000000-000" });
    const r2 = snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_A, stamp: "20260101-000001-000" });
    assert.equal(r2.skipped, true);
    assert.equal(r2.snapshot, null);
    assert.equal(fs.readdirSync(historyDir()).length, 1);
  });
  it("writes a fresh snapshot when content changed", () => {
    snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_A, stamp: "20260101-000000-000" });
    const r2 = snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_B, stamp: "20260101-000001-000" });
    assert.equal(r2.skipped, false);
    assert.equal(fs.readdirSync(historyDir()).length, 2);
  });
  it("does not write (and does not create dir) for empty content", () => {
    const r = snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: "   " });
    assert.deepEqual(r, { snapshot: null, skipped: false });
    assert.ok(!fs.existsSync(historyDir()));
  });
  it("isolates dedup per task-env series (same content, different env → both kept)", () => {
    snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_A, stamp: "20260101-000000-000" });
    const r = snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "sit", content: RUN_A, stamp: "20260101-000000-000" });
    assert.equal(r.skipped, false);
    assert.equal(fs.readdirSync(historyDir()).length, 2);
  });
});

describe("listRunHistory", () => {
  it("returns [] when the .history dir is absent", () => {
    assert.deepEqual(listRunHistory(tmp, "订单", "local"), []);
  });
  it("lists snapshots newest-first with summary fields", () => {
    snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_A, stamp: "20260101-000000-000" });
    snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_B, stamp: "20260102-000000-000" });
    const hist = listRunHistory(tmp, "订单", "local");
    assert.equal(hist.length, 2);
    assert.equal(hist[0].stamp, "20260102-000000-000"); // newest first
    assert.equal(hist[0].status, "failed");
    assert.equal(hist[0].passStr, "1/2");
    assert.equal(hist[0].funcPassStr, "1/2");
    assert.deepEqual(hist[0].tests, [{ id: "TC-1", status: "pass" }, { id: "TC-2", status: "fail" }]);
    assert.equal(hist[1].stamp, "20260101-000000-000");
  });
  it("skips malformed snapshot files without throwing", () => {
    fs.mkdirSync(historyDir(), { recursive: true });
    fs.writeFileSync(path.join(historyDir(), "订单-local-20260101-000000-000.run.json"), "{not json");
    fs.writeFileSync(path.join(historyDir(), "订单-local-20260102-000000-000.run.json"), RUN_A);
    const hist = listRunHistory(tmp, "订单", "local");
    assert.equal(hist.length, 1); // malformed one is skipped
    assert.equal(hist[0].stamp, "20260102-000000-000");
  });
  it("falls funcCounts back to counts for legacy run.json without the field", () => {
    fs.mkdirSync(historyDir(), { recursive: true });
    const legacy = JSON.stringify({
      time: "t", status: "done", passStr: "1/1",
      counts: counts({ total: 1, pass: 1 }), tests: [{ id: "A", status: "pass" }],
    });
    fs.writeFileSync(path.join(historyDir(), "订单-local-20260101-000000-000.run.json"), legacy);
    const hist = listRunHistory(tmp, "订单", "local");
    assert.deepEqual(hist[0].funcCounts, hist[0].counts);
  });
  it("does not mix other task / env series", () => {
    snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "local", content: RUN_A, stamp: "20260101-000000-000" });
    snapshotRunJson({ reportTaskDir: tmp, taskName: "支付", env: "local", content: RUN_A, stamp: "20260101-000000-000" });
    snapshotRunJson({ reportTaskDir: tmp, taskName: "订单", env: "sit", content: RUN_B, stamp: "20260101-000000-000" });
    assert.equal(listRunHistory(tmp, "订单", "local").length, 1);
    assert.equal(listRunHistory(tmp, "支付", "local").length, 1);
    assert.equal(listRunHistory(tmp, "订单", "sit").length, 1);
  });
});

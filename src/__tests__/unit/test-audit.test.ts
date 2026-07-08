/**
 * 测试工作台操作审计:lib(appendAudit/readAudit)+ 路由(POST/GET /api/test/audit)。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-audit.test.ts
 *
 * 关键约束:审计文件在 AI_LabTest/audit/(独立于 report/,删任务留痕);JSONL 追加;
 * time 服务端生成;坏行跳过;GET 最新在前;非法 taskName(路径穿越)拒绝。
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendAudit, readAudit, auditFile } from "../../lib/test/audit";
import { GET, POST } from "../../app/api/test/audit/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "audit-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

describe("audit lib", () => {
  it("appendAudit creates AI_LabTest/audit/<task>.jsonl and readAudit returns newest-first", async () => {
    await appendAudit(proj, "订单", { action: "run-task", mode: "manual", step: "requirement" });
    await appendAudit(proj, "订单", { action: "approve", mode: "manual", step: "cases", detail: "用例门控批准" });
    const f = auditFile(proj, "订单");
    assert.ok(f.includes(path.join("AI_LabTest", "audit")), "落在独立 audit 目录(删任务留痕)");
    assert.equal(fs.readFileSync(f, "utf-8").trim().split("\n").length, 2);
    const events = await readAudit(proj, "订单");
    assert.equal(events.length, 2);
    assert.equal(events[0].action, "approve"); // newest first
    assert.equal(events[1].action, "run-task");
    assert.match(events[0].time, /^\d{4}-\d{2}-\d{2}T/); // ISO time 由服务端生成
  });
  it("readAudit skips malformed lines and returns [] for a missing file", async () => {
    assert.deepEqual(await readAudit(proj, "无此任务"), []);
    await appendAudit(proj, "订单", { action: "stop", mode: "manual" });
    fs.appendFileSync(auditFile(proj, "订单"), "not-json\n");
    await appendAudit(proj, "订单", { action: "run", mode: "auto" });
    const events = await readAudit(proj, "订单");
    assert.deepEqual(events.map((e) => e.action), ["run", "stop"]); // 坏行不影响其余
  });
});

const post = (body: unknown) =>
  POST(new Request("http://x/api/test/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const get = (p: Record<string, string>) => GET(new Request("http://x/api/test/audit?" + new URLSearchParams(p).toString()));

describe("/api/test/audit", () => {
  it("POST appends (time server-side) and GET returns events newest-first", async () => {
    const r1 = await post({ projectPath: proj, taskName: "订单", event: { action: "import", detail: "cases:用例.xlsx" } });
    assert.equal((await r1.json()).ok, true);
    await post({ projectPath: proj, taskName: "订单", event: { action: "approve", step: "cases", mode: "manual" } });
    const j = await (await get({ projectPath: proj, taskName: "订单" })).json();
    assert.equal(j.events.length, 2);
    assert.equal(j.events[0].action, "approve");
    assert.equal(j.events[1].mode, "manual"); // mode 缺省 manual
    assert.ok(j.events[0].time, "server-side time stamped");
  });
  it("POST 400 on missing params or unsafe taskName (path traversal)", async () => {
    assert.equal((await post({ projectPath: proj, event: { action: "x" } })).status, 400);
    assert.equal((await post({ projectPath: proj, taskName: "订单", event: {} })).status, 400);
    assert.equal((await post({ projectPath: proj, taskName: "../逃逸", event: { action: "x" } })).status, 400);
  });
  it("GET returns { events: [] } for missing file / unsafe taskName", async () => {
    assert.deepEqual((await (await get({ projectPath: proj, taskName: "无" })).json()).events, []);
    assert.deepEqual((await (await get({ projectPath: proj, taskName: "../逃逸" })).json()).events, []);
  });
});

/**
 * Integration tests for the execution-step stream wrapper (wrapExecutionStream in
 * src/app/api/test/run/route.ts) — the deterministic reduce/persist/evidence glue.
 *
 * Run with: npx tsx --test src/__tests__/unit/test-exec-stream.test.ts
 *
 * Drives it with a MOCK ReadableStream of SSE frames (no real AI): asserts frame
 * forwarding + run.json write + history snapshot + funcCounts join + evidence sweep.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wrapExecutionStream, wrapReportStream, POST } from "../../app/api/test/run/route";
import { readManifest } from "../../lib/test/script-artifacts";
import { readTraceFile } from "../../lib/test/script-trace";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "exec-stream-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

function mockStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  });
}
async function drain(s: ReadableStream<string>): Promise<string[]> {
  const reader = s.getReader();
  const out: string[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; out.push(value); }
  return out;
}
const textFrame = (data: string) => `data: ${JSON.stringify({ type: "text", data })}\n\n`;
const eventFrame = (type: string, data: unknown) => `data: ${JSON.stringify({ type, data: JSON.stringify(data) })}\n\n`;
const runJsonPath = () => path.join(proj, "AI_LabTest", "report", "订单", "订单-local.run.json");
const readRun = () => JSON.parse(fs.readFileSync(runJsonPath(), "utf-8"));

describe("wrapExecutionStream", () => {
  it("forwards frames + reduces @@RESULT → run.json + appends a run_json frame + snapshot", async () => {
    const src = mockStream([
      textFrame('▶ 用例 1/2\n@@RESULT {"id":"TC-1","status":"pass"}\n'),
      textFrame('@@RESULT {"id":"TC-2","status":"fail","error":"断言失败"}\n'),
    ]);
    const out = await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now() }));
    assert.ok(out.some((c) => c.includes('"type":"text"')), "original text frames forwarded");
    assert.ok(out.some((c) => c.includes('"type":"run_json"')), "run_json frame appended at end");
    assert.ok(fs.existsSync(runJsonPath()), "run.json persisted");
    const run = readRun();
    assert.deepEqual(run.counts, { total: 2, pass: 1, fail: 1, partial: 0, blocked: 0 });
    assert.equal(run.status, "failed");
    const histDir = path.join(proj, "AI_LabTest", "report", "订单", ".history");
    assert.equal(fs.readdirSync(histDir).filter((f) => f.endsWith(".run.json")).length, 1, "one history snapshot");
  });

  it("joins cases.json verification → funcCounts excludes 回归基线 (oracle 双轴)", async () => {
    const casesFile = path.join(proj, "AI_LabTest", "testCase", ".data", "订单.cases.json");
    fs.mkdirSync(path.dirname(casesFile), { recursive: true });
    fs.writeFileSync(casesFile, JSON.stringify({ cases: [
      { id: "TC-1", verification: "功能验证" },
      { id: "TC-2", verification: "回归基线" },
    ] }));
    const src = mockStream([textFrame('@@RESULT {"id":"TC-1","status":"pass"}\n@@RESULT {"id":"TC-2","status":"pass"}\n')]);
    await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now() }));
    const run = readRun();
    assert.equal(run.passStr, "2/2"); // exec rate counts everything
    assert.deepEqual(run.funcCounts, { total: 1, pass: 1, fail: 0, partial: 0, blocked: 0 }); // 回归基线 excluded
    assert.equal(run.funcPassStr, "1/1");
    assert.equal(run.regressionTotal, 1);
  });

  it("sweeps a stray screenshot created this run into the evidence dir", async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(path.join(proj, "TC-001.png"), PNG); // stray at project root
    const src = mockStream([textFrame('@@RESULT {"id":"TC-001","status":"pass","evidence":["TC-001.png"]}\n')]);
    await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now() - 1000 }));
    const evidenceDir = path.join(proj, "AI_LabTest", "report", "_evidence", "订单-local");
    assert.ok(fs.existsSync(path.join(evidenceDir, "TC-001.png")), "swept into evidence dir");
    assert.ok(!fs.existsSync(path.join(proj, "TC-001.png")), "removed from project root");
  });

  it("degrades to single-rate when no cases.json (funcCounts === counts)", async () => {
    const src = mockStream([textFrame('@@RESULT {"id":"TC-1","status":"pass"}\n')]);
    await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now() }));
    const run = readRun();
    assert.deepEqual(run.funcCounts, run.counts);
    assert.equal(run.regressionTotal, 0);
  });

  it("persists a redacted per-case Playwright trace tied to the authoritative run hash", async () => {
    const casesFile = path.join(proj, "AI_LabTest", "testCase", ".data", "订单.cases.json");
    fs.mkdirSync(path.dirname(casesFile), { recursive: true });
    fs.writeFileSync(casesFile, JSON.stringify({ cases: [{ id: "TC-REG", tags: ["回归测试"] }] }));
    const src = mockStream([
      textFrame('@@CASE_START {"id":"TC-REG","index":1}\n'),
      eventFrame("tool_use", { id: "tool-1", name: "browser_click", input: {} }),
      eventFrame("tool_result", {
        tool_use_id: "tool-1",
        content: '### Ran Playwright code\n```js\nawait page.getByLabel("Password").fill("hunter2");\n```',
      }),
      textFrame('@@RESULT {"id":"TC-REG","status":"pass"}\n'),
    ]);
    await drain(wrapExecutionStream(src, {
      projectPath: proj,
      taskName: "订单",
      env: "local",
      runStartMs: Date.now(),
      traceRedactions: [{ value: "hunter2", replacement: "${TEST_PASSWORD}" }],
    }));
    const trace = readTraceFile(proj, "订单", "local");
    assert.ok(trace);
    assert.equal(trace.actions.length, 1);
    assert.equal(trace.actions[0].caseId, "TC-REG");
    assert.equal(trace.actions[0].playwrightCode?.includes("hunter2"), false);
    assert.equal(trace.actions[0].playwrightCode?.includes("${TEST_PASSWORD}"), true);
    assert.equal(trace.runHash.length, 40);
  });
});

// 报告步收口：报告 .md 全靠 AI 用 Write 落盘；wrapReportStream 在流末校验文件存在，
// 缺失就补发 error 帧（前端据此标「失败」而非误报已完成）。
describe("wrapReportStream — 报告 .md 落盘校验", () => {
  const reportMd = () => path.join(proj, "AI_LabTest", "report", "订单", "订单-local.md");
  it("报告 .md 存在 → 原样转发、不补 error 帧", async () => {
    fs.mkdirSync(path.dirname(reportMd()), { recursive: true });
    fs.writeFileSync(reportMd(), "# 报告", "utf-8");
    const out = (await drain(wrapReportStream(mockStream([textFrame("完成")]), { projectPath: proj, taskName: "订单", env: "local" }))).join("");
    assert.ok(out.includes("完成"));
    assert.ok(!out.includes('"type":"error"'));
  });
  it("报告 .md 缺失 → 末尾补发 error 帧", async () => {
    const out = (await drain(wrapReportStream(mockStream([textFrame("只产了摘要没写文件")]), { projectPath: proj, taskName: "订单", env: "local" }))).join("");
    assert.ok(out.includes("只产了摘要没写文件")); // 原始帧仍转发
    assert.ok(out.includes('"type":"error"')); // 末尾补了 error
    assert.ok(out.includes("未生成"));
  });
  it("报告成功 + run.json 存在 → 排队脚本任务；同一 run 重复报告不重复生成", async () => {
    const taskDir = path.dirname(reportMd());
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(reportMd(), "# 报告", "utf-8");
    const casesFile = path.join(proj, "AI_LabTest", "testCase", ".data", "订单.cases.json");
    fs.mkdirSync(path.dirname(casesFile), { recursive: true });
    fs.writeFileSync(casesFile, JSON.stringify({ cases: [{ id: "SMOKE", tags: ["冒烟测试"] }] }));
    fs.writeFileSync(runJsonPath(), JSON.stringify({
      module: "订单", env: "local", time: new Date().toISOString(), status: "done",
      counts: { total: 1, pass: 1, fail: 0, partial: 0, blocked: 0 }, passStr: "1/1",
      funcCounts: { total: 1, pass: 1, fail: 0, partial: 0, blocked: 0 }, funcPassStr: "1/1",
      regressionTotal: 0, circuitBroken: false,
      tests: [{ id: "SMOKE", status: "pass", actual: "", error: "", evidence: [] }],
    }, null, 2));

    await drain(wrapReportStream(mockStream([textFrame("完成")]), { projectPath: proj, taskName: "订单", env: "local" }));
    let manifest = readManifest(proj, "订单", "local");
    for (let i = 0; i < 30 && manifest?.jobStatus !== "done"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      manifest = readManifest(proj, "订单", "local");
    }
    assert.equal(manifest?.jobStatus, "done");
    assert.deepEqual(manifest?.counts, { eligible: 0, generated: 0, verified: 0, needsReview: 0, failed: 0 });
    const before = fs.statSync(path.join(proj, "AI_LabTest", "scripts", "订单", "local", "manifest.json")).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await drain(wrapReportStream(mockStream([textFrame("重复完成")]), { projectPath: proj, taskName: "订单", env: "local" }));
    const after = fs.statSync(path.join(proj, "AI_LabTest", "scripts", "订单", "local", "manifest.json")).mtimeMs;
    assert.equal(after, before, "same run must reuse terminal manifest without rewriting it");
  });
});

// run POST guards — these return before reaching streamClaude, so no AI is invoked.
describe("POST /api/test/run — guards", () => {
  it("400 without projectPath", async () => {
    const res = await POST(new Request("http://x/api/test/run", { method: "POST", body: JSON.stringify({ taskName: "x", step: "requirement" }) }));
    assert.equal(res.status, 400);
  });
  it("rejects a traversal taskName before reaching the agent (H2)", async () => {
    const res = await POST(new Request("http://x/api/test/run", { method: "POST", body: JSON.stringify({ projectPath: proj, taskName: "../../evil", step: "requirement" }) }));
    assert.equal(res.status, 400);
  });
});

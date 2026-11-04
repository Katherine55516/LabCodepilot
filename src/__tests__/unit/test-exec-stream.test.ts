/**
 * Integration tests for the execution-step stream wrapper (wrapExecutionStream in
 * src/lib/test/exec-stream.ts，由 src/app/api/test/run/route.ts 使用) — the
 * deterministic reduce/persist/evidence glue.
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
import { wrapExecutionStream, wrapReportStream } from "../../lib/test/exec-stream";
import { POST } from "../../app/api/test/run/route";
import { readManifest } from "../../lib/test/script-artifacts";
import { readTraceFile } from "../../lib/test/script-trace";
import { appendRound, readRounds, roundAliveFile, type RegressionRound } from "../../lib/test/rounds";
import { getRuntime, registerRuntime } from "../../lib/runtime/registry";
import type { AgentRuntime } from "../../lib/runtime/types";

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
    const out = await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now(), depositScripts: false }));
    assert.ok(out.some((c) => c.includes('"type":"text"')), "original text frames forwarded");
    assert.ok(out.some((c) => c.includes('"type":"run_json"')), "run_json frame appended at end");
    assert.ok(fs.existsSync(runJsonPath()), "run.json persisted");
    const run = readRun();
    assert.deepEqual(run.counts, { total: 2, pass: 1, fail: 1, partial: 0, blocked: 0 });
    assert.equal(run.status, "failed");
    const histDir = path.join(proj, "AI_LabTest", "report", "订单", ".history");
    assert.equal(fs.readdirSync(histDir).filter((f) => f.endsWith(".run.json")).length, 1, "one history snapshot");
  });

  it("冒烟 @@AUTH_INVALID 跨帧到达 → 取消上游、发结构化终止事件且不产 run.json", async () => {
    let sourceCancelled = false;
    let agentAborted = false;
    const src = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(textFrame("@@AUTH_INVA"));
        controller.enqueue(textFrame('LID {"reason":"login_state_invalid"}\n'));
        controller.enqueue(textFrame("▶ 场景 2/7：毒丸——不得继续处理\n"));
        // 故意不 close：没有平台硬停止时 drain 会永久挂起。
      },
      cancel() { sourceCancelled = true; },
    });
    const out = await drain(wrapExecutionStream(src, {
      projectPath: proj,
      taskName: "订单",
      env: "local",
      runStartMs: Date.now(),
      depositScripts: false,
      stopOnAuthInvalid: true,
      abortAgent: () => { agentAborted = true; },
    }));
    const joined = out.join("");
    assert.equal(agentAborted, true, "必须终止真实 agent run");
    assert.equal(sourceCancelled, true, "必须取消上游流，不能继续跑后续场景");
    assert.ok(joined.includes('"type":"auth_invalid"'), "前端收到结构化登录失效事件");
    assert.equal(joined.includes("毒丸"), false, "标记后的后续场景不得再转发");
    assert.equal(joined.includes('"type":"run_json"'), false, "早停轮不归约 run.json");
    assert.equal(fs.existsSync(runJsonPath()), false, "早停轮不落本轮 run.json");
  });

  it("功能执行未开启硬停止时，同名文本不改变正常归约", async () => {
    const src = mockStream([
      textFrame('@@AUTH_INVALID {"reason":"login_state_invalid"}\n@@RESULT {"id":"TC-1","status":"pass"}\n'),
    ]);
    const out = await drain(wrapExecutionStream(src, {
      projectPath: proj,
      taskName: "订单",
      env: "local",
      runStartMs: Date.now(),
      depositScripts: false,
    }));
    assert.ok(out.some((chunk) => chunk.includes('"type":"run_json"')));
    assert.equal(readRun().counts.pass, 1);
  });

  it("joins cases.json verification → funcCounts excludes 回归基线 (oracle 双轴)", async () => {
    const casesFile = path.join(proj, "AI_LabTest", "testCase", ".data", "订单.cases.json");
    fs.mkdirSync(path.dirname(casesFile), { recursive: true });
    fs.writeFileSync(casesFile, JSON.stringify({ cases: [
      { id: "TC-1", verification: "功能验证" },
      { id: "TC-2", verification: "回归基线" },
    ] }));
    const src = mockStream([textFrame('@@RESULT {"id":"TC-1","status":"pass"}\n@@RESULT {"id":"TC-2","status":"pass"}\n')]);
    await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now(), depositScripts: false }));
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
    await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now() - 1000, depositScripts: false }));
    const evidenceDir = path.join(proj, "AI_LabTest", "report", "_evidence", "订单-local");
    assert.ok(fs.existsSync(path.join(evidenceDir, "TC-001.png")), "swept into evidence dir");
    assert.ok(!fs.existsSync(path.join(proj, "TC-001.png")), "removed from project root");
  });

  it("degrades to single-rate when no cases.json (funcCounts === counts)", async () => {
    const src = mockStream([textFrame('@@RESULT {"id":"TC-1","status":"pass"}\n')]);
    await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now(), depositScripts: false }));
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
      // 本组测的是流包装器本身;后台脚本沉淀会对 TC-REG(回归标签 + pass)发真实模型调用,
      // 让单测依赖网络并堵塞全局队列。沉淀另有专项单测(script-incremental.test.ts)。
      depositScripts: false,
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

// 轮次收口所有权在服务端(层①,真机事故:执行中途页面刷新 → 前端 settle 永远不会到达 →
// 轮次卡「执行中」)。done / cancel 两条路径都必须由流包装器自己收口,不押前端活到最后。
describe("wrapExecutionStream — 轮次服务端收口(roundId)", () => {
  const LIB = "回归用例库";
  const round = (roundId: string): RegressionRound => ({
    roundId, startedAt: new Date().toISOString(), env: "local",
    suiteName: "全量", mode: "full", status: "running", total: 1,
  });
  const roundOpts = (roundId: string, extra: Record<string, unknown> = {}) => ({
    projectPath: proj, taskName: LIB, env: "local", runStartMs: Date.now(),
    depositScripts: false, roundId, ...extra,
  });

  it("流正常收口 → 轮次 done + counts/suitePassStr 摘要 + 心跳清理(不依赖前端 PATCH)", async () => {
    appendRound(proj, round("RND-T1"));
    const casesFile = path.join(proj, "AI_LabTest", "testCase", ".data", `${LIB}.cases.json`);
    fs.mkdirSync(path.dirname(casesFile), { recursive: true });
    fs.writeFileSync(casesFile, JSON.stringify({ cases: [{ id: "TC-1", tags: ["回归测试"] }] }));
    const src = mockStream([textFrame('@@RESULT {"id":"TC-1","status":"pass"}\n')]);
    await drain(wrapExecutionStream(src, roundOpts("RND-T1")));
    const r = readRounds(proj).rounds.find((x) => x.roundId === "RND-T1")!;
    assert.equal(r.status, "done");
    assert.equal(r.suitePassStr, "1/1");
    assert.deepEqual(r.counts, { total: 1, pass: 1, fail: 0, partial: 0, blocked: 0 });
    assert.ok(r.finishedAt);
    assert.ok(!fs.existsSync(roundAliveFile(proj, "RND-T1")), "收口后不残留心跳");
  });

  it("客户端断开(cancel)→ 轮次 aborted(事故路径:刷新页面后无人收口)", async () => {
    appendRound(proj, round("RND-T2"));
    // 永不结束的源流:模拟执行进行中
    const src = new ReadableStream<string>({ start(c) { c.enqueue(textFrame("执行中…")); } });
    const wrapped = wrapExecutionStream(src, roundOpts("RND-T2"));
    const reader = wrapped.getReader();
    await reader.read();                       // 消费一帧,确认流活着
    assert.ok(fs.existsSync(roundAliveFile(proj, "RND-T2")), "执行期间有心跳");
    await reader.cancel("client disconnected"); // Next 在客户端断开时调它
    const r = readRounds(proj).rounds.find((x) => x.roundId === "RND-T2")!;
    assert.equal(r.status, "aborted", "服务端在 cancel 路径收口,不再依赖前端");
    assert.ok(!fs.existsSync(roundAliveFile(proj, "RND-T2")));
  });

  it("用户主动中止(stats.aborted)→ 即使流走到头也按 aborted 收", async () => {
    appendRound(proj, round("RND-T3"));
    const src = mockStream([textFrame('@@RESULT {"id":"TC-1","status":"pass"}\n')]);
    await drain(wrapExecutionStream(src, roundOpts("RND-T3", {
      stats: { taskId: "t", stepStartMs: Date.now(), aborted: () => true },
    })));
    assert.equal(readRounds(proj).rounds.find((x) => x.roundId === "RND-T3")!.status, "aborted");
  });

  it("无 roundId(普通任务)→ 不建轮次、不写心跳,零影响", async () => {
    const src = mockStream([textFrame('@@RESULT {"id":"TC-1","status":"pass"}\n')]);
    await drain(wrapExecutionStream(src, { projectPath: proj, taskName: "订单", env: "local", runStartMs: Date.now(), depositScripts: false }));
    assert.equal(readRounds(proj).rounds.length, 0);
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
  it("冒烟报告收口会把旧版 Bug 列表规范化为固定 8 列表格，功能报告不改写", async () => {
    const taskDir = path.dirname(reportMd());
    fs.mkdirSync(taskDir, { recursive: true });
    const legacy = "# 冒烟报告\n\n## 三、Bug 清单\n\n- BUG-01：保存失败\n\n## 五、整体结论\n\n未通过。\n";
    fs.writeFileSync(reportMd(), legacy, "utf-8");
    fs.writeFileSync(runJsonPath(), JSON.stringify({
      counts: { total: 1, pass: 0, fail: 1, partial: 0, blocked: 0 },
      tests: [{ id: "SM-001", status: "fail", error: "保存失败", api: { method: "POST", url: "/api/order", status: 500 } }],
    }), "utf-8");

    await drain(wrapReportStream(mockStream([textFrame("完成")]), {
      projectPath: proj,
      taskName: "订单",
      env: "local",
      taskType: "smoke",
      depositScripts: false,
    }));
    const normalized = fs.readFileSync(reportMd(), "utf-8");
    assert.match(normalized, /\| 编号 \| 标题 \| 严重级别 \| 关联场景 \| 实际 \| 预期 \| 接口 \| 证据 \|/);
    assert.match(normalized, /\| BUG-01 \| 保存失败 \| 严重 \| SM-001 \|/);

    fs.writeFileSync(reportMd(), legacy, "utf-8");
    await drain(wrapReportStream(mockStream([textFrame("功能报告完成")]), {
      projectPath: proj,
      taskName: "订单",
      env: "local",
      depositScripts: false,
    }));
    assert.equal(fs.readFileSync(reportMd(), "utf-8"), legacy, "功能测试报告 Markdown 必须保持原样");
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

describe("POST /api/test/run — 冒烟登录失效接线", () => {
  it("仅 taskType=smoke 开启硬停止，并把 agent 的 AbortController 一并中止", async () => {
    const originalNative = getRuntime("native");
    assert.ok(originalNative, "route side-effect 应已注册 native runtime");
    let agentAborted = false;
    let sourceCancelled = false;
    let streamCall = 0;
    const fakeNative: AgentRuntime = {
      id: "native",
      displayName: "test native",
      description: "route contract test",
      isAvailable: () => true,
      interrupt: () => {},
      dispose: () => {},
      stream(options) {
        streamCall += 1;
        options.abortController?.signal.addEventListener("abort", () => { agentAborted = true; });
        if (streamCall === 1) {
          return new ReadableStream<string>({
            start(controller) {
              controller.enqueue(textFrame('@@AUTH_INVALID {"reason":"login_state_invalid"}\n'));
              controller.enqueue(textFrame("▶ 场景 2/2：服务端不得继续转发\n"));
              // 故意不 close：只有 route 正确打开 stopOnAuthInvalid 才能收口。
            },
            cancel() { sourceCancelled = true; },
          });
        }
        return mockStream([
          textFrame('@@AUTH_INVALID {"reason":"login_state_invalid"}\n@@RESULT {"id":"TC-1","status":"pass"}\n'),
        ]);
      },
    };
    registerRuntime(fakeNative);
    try {
      const smoke = await POST(new Request("http://x/api/test/run", {
        method: "POST",
        body: JSON.stringify({
          projectPath: proj,
          taskName: "订单",
          step: "execution",
          env: "local",
          taskType: "smoke",
          providerId: "openai-oauth",
          depositScripts: false,
        }),
      }));
      assert.equal(smoke.status, 200);
      assert.ok(smoke.body);
      const smokeBody = (await drain(smoke.body as unknown as ReadableStream<string>)).join("");
      assert.match(smokeBody, /"type":"auth_invalid"/);
      assert.doesNotMatch(smokeBody, /服务端不得继续转发/);
      assert.equal(agentAborted, true, "route 必须把硬停止传回真实 agent AbortController");
      assert.equal(sourceCancelled, true, "route 必须取消 agent 源流");

      const functional = await POST(new Request("http://x/api/test/run", {
        method: "POST",
        body: JSON.stringify({
          projectPath: proj,
          taskName: "订单",
          step: "execution",
          env: "local",
          providerId: "openai-oauth",
          depositScripts: false,
        }),
      }));
      assert.equal(functional.status, 200);
      assert.ok(functional.body);
      const functionalBody = (await drain(functional.body as unknown as ReadableStream<string>)).join("");
      assert.doesNotMatch(functionalBody, /"type":"auth_invalid"/);
      assert.match(functionalBody, /"type":"run_json"/);
    } finally {
      registerRuntime(originalNative);
    }
  });
});

describe("POST /api/test/run — 冒烟回归脚本硬关断", () => {
  it("旧客户端显式传 depositScripts:true 时，execution/report 均不创建 manifest", async () => {
    const originalNative = getRuntime("native");
    assert.ok(originalNative);
    const casesFile = path.join(proj, "AI_LabTest", "testCase", ".data", "订单.cases.json");
    fs.mkdirSync(path.dirname(casesFile), { recursive: true });
    fs.writeFileSync(casesFile, JSON.stringify({
      cases: [{ id: "SM-001", purpose: "下单", tags: ["回归测试"] }],
    }), "utf-8");
    let streamCall = 0;
    const fakeNative: AgentRuntime = {
      id: "native",
      displayName: "test native",
      description: "smoke deposit guard",
      isAvailable: () => true,
      interrupt: () => {},
      dispose: () => {},
      stream() {
        streamCall += 1;
        if (streamCall === 2) {
          const report = path.join(proj, "AI_LabTest", "report", "订单", "订单-local.md");
          fs.mkdirSync(path.dirname(report), { recursive: true });
          fs.writeFileSync(report, "# 冒烟报告\n\n## 三、Bug 清单\n\n无。\n", "utf-8");
          return mockStream([textFrame("报告完成")]);
        }
        return mockStream([textFrame('@@RESULT {"id":"SM-001","status":"pass","actual":"下单成功"}\n')]);
      },
    };
    registerRuntime(fakeNative);
    try {
      for (const step of ["execution", "report"] as const) {
        const res = await POST(new Request("http://x/api/test/run", {
          method: "POST",
          body: JSON.stringify({
            projectPath: proj,
            taskName: "订单",
            step,
            env: "local",
            taskType: "smoke",
            providerId: "openai-oauth",
            depositScripts: true,
          }),
        }));
        assert.equal(res.status, 200);
        assert.ok(res.body);
        await drain(res.body as unknown as ReadableStream<string>);
        assert.equal(readManifest(proj, "订单", "local"), null, `${step} 不得创建回归脚本 manifest`);
      }
    } finally {
      registerRuntime(originalNative);
    }
  });
});

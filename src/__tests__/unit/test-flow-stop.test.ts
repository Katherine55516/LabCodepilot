import { test } from "node:test";
import assert from "node:assert";

// 复现 InlineTestingPanel.runStep 执行阶段的「读流停止」逻辑(反复修不好的那个):
// 执行阶段 AI 跑浏览器工具时后端不吐 SSE,reader.read() 长时间 pending;点停止(abort)
// 必须【不等卡住的 read() 返回】就跳出循环并标记 stopped。这里用与源码一致的 Promise.race
// 模式 + 一个"第一帧后永久 pending"的 mock reader 来验证该行为。
test("停止: read() 卡住时, abort 能让读流循环立即跳出并标记 stopped", async () => {
  const ctrl = new AbortController();

  // 模拟 execution 阶段卡住的流:第一帧正常,之后 read() 永不返回(后端在执行浏览器工具)。
  let firstRead = true;
  let cancelled = false;
  const reader = {
    read(): Promise<{ done: boolean; value: Uint8Array | undefined }> {
      if (firstRead) {
        firstRead = false;
        return Promise.resolve({ done: false, value: new TextEncoder().encode("data: {}\n\n") });
      }
      return new Promise(() => {}); // 永久 pending —— 模拟后端静默期
    },
    cancel(): Promise<void> { cancelled = true; return Promise.resolve(); },
  };

  // 与源码一致的 abort 竞速 promise
  const abortedSignal = new Promise<{ aborted: true }>((resolve) => {
    const onAbort = () => { reader.cancel().catch(() => {}); resolve({ aborted: true }); };
    if (ctrl.signal.aborted) onAbort();
    else ctrl.signal.addEventListener("abort", onAbort, { once: true });
  });

  let stopped = false;
  let frames = 0;
  // 10ms 后模拟用户点「停止」
  const timer = setTimeout(() => ctrl.abort(), 10);

  for (;;) {
    const chunk = await Promise.race([reader.read(), abortedSignal]);
    if ("aborted" in chunk) { stopped = true; break; }
    if (chunk.done) break;
    frames++;
  }
  clearTimeout(timer);

  assert.strictEqual(stopped, true, "abort 后循环应跳出并标记 stopped");
  assert.strictEqual(frames, 1, "应处理完第一帧后卡住,直到 abort 才跳出");
  assert.strictEqual(cancelled, true, "abort 时应同时 cancel 底层 reader");
});

// 停止与流自然 done 同刻竞争：即便 read() 的 done 抢先返回，只要信号已 abort，也必须按
// 「停止」处理，绝不让该步落到 clean done（否则会触发下游「测试报告」自动接力 —— 即用户报的
// 「停止测试执行却流转到测试报告」）。验证源码新增的 `|| ctrl.signal.aborted` 守卫。
test("停止: done 与 abort 同刻竞争时按停止处理(不落 clean done)", async () => {
  const ctrl = new AbortController();
  const reader = {
    read: (): Promise<{ done: boolean; value: Uint8Array | undefined }> =>
      Promise.resolve({ done: true, value: undefined }), // 流已自然 done
    cancel: (): Promise<void> => Promise.resolve(),
  };
  const abortedSignal = new Promise<{ aborted: true }>((resolve) => {
    const onAbort = () => { reader.cancel().catch(() => {}); resolve({ aborted: true }); };
    if (ctrl.signal.aborted) onAbort();
    else ctrl.signal.addEventListener("abort", onAbort, { once: true });
  });
  ctrl.abort(); // 用户点停止：此刻 done 与 abort 同时具备

  let stopped = false;
  let cleanDone = false;
  for (;;) {
    const chunk = await Promise.race([reader.read(), abortedSignal]);
    if ("aborted" in chunk || ctrl.signal.aborted) { stopped = true; break; }
    if (chunk.done) { cleanDone = true; break; }
  }
  assert.strictEqual(stopped, true, "信号已 abort → 应判停止");
  assert.strictEqual(cleanDone, false, "不应按 clean done 退出(否则下游报告会被接力)");
});

// 守卫表达式本身(确定性)：信号已 abort 时，即便拿到 done 帧也判停止。
test("停止守卫: aborted 信号下 done 帧也判 stopped", () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const chunkDone = { done: true, value: undefined } as { done: boolean; value: undefined };
  const isStop = "aborted" in chunkDone || ctrl.signal.aborted;
  assert.strictEqual(isStop, true);
});

// 边界:abort 在进入循环前就已触发,也必须立刻停止(不进入任何一次 read 等待)。
test("停止: 进入循环前已 abort, 第一轮 race 即停止", async () => {
  const ctrl = new AbortController();
  ctrl.abort(); // 先 abort

  const reader = {
    read(): Promise<{ done: boolean; value: Uint8Array | undefined }> {
      return new Promise(() => {}); // 永久 pending
    },
    cancel(): Promise<void> { return Promise.resolve(); },
  };
  const abortedSignal = new Promise<{ aborted: true }>((resolve) => {
    const onAbort = () => { reader.cancel().catch(() => {}); resolve({ aborted: true }); };
    if (ctrl.signal.aborted) onAbort();
    else ctrl.signal.addEventListener("abort", onAbort, { once: true });
  });

  let stopped = false;
  for (;;) {
    const chunk = await Promise.race([reader.read(), abortedSignal]);
    if ("aborted" in chunk) { stopped = true; break; }
    if (chunk.done) break;
  }
  assert.strictEqual(stopped, true, "进入循环前已 abort 时,第一轮 race 应立即停止");
});

/**
 * 执行步逐用例计时单测（src/lib/test/exec-timing.ts）。
 *
 * 口径：▶ 进度行完成时刻 → 下一条 @@RESULT 行完成时刻；id 取自 @@RESULT。
 * 覆盖：跨帧断行重组、顺序多用例、AI 漏输出（▶ 无 RESULT / RESULT 无 ▶）、
 * 重复 id 首次为准、坏 JSON 容错、无换行尾行的 finish 冲刷。
 * Run with: npx tsx --test src/__tests__/unit/test-exec-timing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCaseTimer } from "../../lib/test/exec-timing";

const RESULT = (id: string) => `@@RESULT {"id":"${id}","status":"pass","actual":"ok"}`;

describe("createCaseTimer", () => {
  it("measures ▶ line → @@RESULT line wall-clock per case", () => {
    const t = createCaseTimer();
    t.feedText("▶ 用例 1/2：登录\n", 1000);
    t.feedText(`${RESULT("TC-1")}\n`, 13000);
    t.feedText("▶ 用例 2/2：导出\n", 14000);
    t.feedText(`${RESULT("TC-2")}\n`, 74000);
    assert.deepEqual(t.finish(80000), { "TC-1": 12000, "TC-2": 60000 });
  });

  it("reassembles lines split across arbitrary text deltas", () => {
    const t = createCaseTimer();
    // ▶ 行被拆成 3 帧；完成时刻 = 含换行符的那一帧（3000）
    t.feedText("▶ 用", 1000);
    t.feedText("例 1/1：登", 2000);
    t.feedText("录\n@@RES", 3000);
    t.feedText(`ULT {"id":"TC-1","status":"pass"}` + "\n", 9000);
    assert.deepEqual(t.finish(9500), { "TC-1": 6000 });
  });

  it("discards an open ▶ when the next ▶ arrives (AI skipped @@RESULT)", () => {
    const t = createCaseTimer();
    t.feedText("▶ 用例 1/2：a\n", 1000);
    t.feedText("▶ 用例 2/2：b\n", 5000); // 上一条被丢弃
    t.feedText(`${RESULT("TC-2")}\n`, 8000);
    assert.deepEqual(t.finish(9000), { "TC-2": 3000 });
  });

  it("ignores @@RESULT without a preceding ▶, and keeps first duration on duplicate ids", () => {
    const t = createCaseTimer();
    t.feedText(`${RESULT("TC-0")}\n`, 1000); // 无 ▶ → 无法计时
    t.feedText("▶ 用例 1/1：x\n", 2000);
    t.feedText(`${RESULT("TC-1")}\n`, 5000);
    t.feedText("▶ 重试\n", 6000);
    t.feedText(`${RESULT("TC-1")}\n`, 20000); // 重复 id → 首次为准
    assert.deepEqual(t.finish(21000), { "TC-1": 3000 });
  });

  it("tolerates malformed @@RESULT JSON (closes the open case without recording)", () => {
    const t = createCaseTimer();
    t.feedText("▶ 用例 1/1：x\n", 1000);
    t.feedText('@@RESULT {bad json}\n', 4000);
    t.feedText(`${RESULT("TC-1")}\n`, 9000); // ▶ 已被坏行关闭 → 不计
    assert.deepEqual(t.finish(9500), {});
  });

  it("finish() flushes a trailing line without a newline", () => {
    const t = createCaseTimer();
    t.feedText("▶ 用例 1/1：x\n", 1000);
    t.feedText(RESULT("TC-1"), 2000); // 无换行结尾
    assert.deepEqual(t.finish(7000), { "TC-1": 6000 }); // 完成时刻 = finish 时刻
  });

  it("keeps @@RESULT id verbatim (no trim) so keys stay identical to reduce.harvestResults", () => {
    // 带空白的 id 若被 trim，会与 reduce 侧不同键：时长会错挂到 caseIds 对齐补全出的
    // 「未执行」条目上；同键则最坏只是时长缺省（宁缺毋错）。
    const t = createCaseTimer();
    t.feedText("▶ 用例 1/1：x\n", 1000);
    t.feedText('@@RESULT {"id":"TC-1 ","status":"pass"}\n', 4000);
    assert.deepEqual(t.finish(5000), { "TC-1 ": 3000 });
  });

  it("prose lines between progress and result do not interfere", () => {
    const t = createCaseTimer();
    t.feedText("▶ 用例 1/1：x\n正在点击按钮…\n验证响应…\n", 1000);
    t.feedText(`${RESULT("TC-1")}\n`, 31000);
    assert.deepEqual(t.finish(32000), { "TC-1": 30000 });
  });
});

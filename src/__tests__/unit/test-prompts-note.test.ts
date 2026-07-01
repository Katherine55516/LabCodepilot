/**
 * Unit tests for buildStep's 追加指令 (extraInstruction) injection — the typed
 * test-conversation note must be appended to every step's prompt, and only when
 * non-empty.
 *
 * Run with: npx tsx --test src/__tests__/unit/test-prompts-note.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStep } from "../../lib/test/prompts";

const NOTE = "重点覆盖登录失败与超时场景";

describe("buildStep extraInstruction (追加指令)", () => {
  it("does not add the note section when no instruction is given", () => {
    const b = buildStep("requirement", { taskName: "登录验证" });
    assert.equal(b.prompt.includes("用户补充要求"), false);
  });

  it("appends the note section + text when an instruction is given", () => {
    const b = buildStep("requirement", { taskName: "登录验证", extraInstruction: NOTE });
    assert.ok(b.prompt.includes("用户补充要求"));
    assert.ok(b.prompt.includes(NOTE));
  });

  it("applies to the execution step too (and keeps needsPlaywright)", () => {
    const b = buildStep("execution", { taskName: "登录验证", env: "local", extraInstruction: NOTE });
    assert.ok(b.prompt.includes(NOTE));
    assert.equal(b.needsPlaywright, true);
  });

  it("ignores a whitespace-only instruction", () => {
    const b = buildStep("cases", { taskName: "登录验证", extraInstruction: "   \n  " });
    assert.equal(b.prompt.includes("用户补充要求"), false);
  });
});

describe("buildStep reuseImported (新建任务导入产物)", () => {
  it("requirement: no reuse block by default", () => {
    const b = buildStep("requirement", { taskName: "登录验证" });
    assert.equal(b.prompt.includes("用户已上传需求文档"), false);
  });

  it("requirement: injects the reuse block + the 需求.md path when reuseImported", () => {
    const b = buildStep("requirement", { taskName: "登录验证", reuseImported: true });
    assert.ok(b.prompt.includes("用户已上传需求文档"));
    assert.ok(b.prompt.includes("登录验证-需求.md"));
    assert.ok(b.prompt.includes("严禁") && b.prompt.includes("覆盖"));
  });

  it("cases: injects the reuse block + the cases.json path when reuseImported", () => {
    const b = buildStep("cases", { taskName: "登录验证", reuseImported: true });
    assert.ok(b.prompt.includes("用户已上传测试用例"));
    assert.ok(b.prompt.includes("登录验证.cases.json"));
  });

  it("cases: no reuse block by default", () => {
    const b = buildStep("cases", { taskName: "登录验证" });
    assert.equal(b.prompt.includes("用户已上传测试用例"), false);
  });
});

// 缺陷修复：执行步撞登录墙时 AI 调 AskUserQuestion → 非交互运行弹不出、卡死。
// 执行 prompt 必须(1)禁用 AskUserQuestion/提问，(2)遇登录墙判 blocked 并引导用户去
// 「设置 · 测试账号」配置登录态。
describe("buildStep execution — 非交互 + 登录态处理", () => {
  it("forbids AskUserQuestion / user-prompting and pins the platform-provided env", () => {
    const b = buildStep("execution", { taskName: "项目列表", env: "local" });
    assert.ok(b.prompt.includes("AskUserQuestion"), "names the tool…");
    assert.ok(b.prompt.includes("严禁使用"), "…inside a prohibition");
    assert.ok(b.prompt.includes("非交互"), "declares the run non-interactive");
    assert.ok(b.prompt.includes("设置 · 测试账号"), "points user to the env config");
  });

  it("warns when no login state is configured (default / hasLoginState=false)", () => {
    const b = buildStep("execution", { taskName: "项目列表", env: "local", hasLoginState: false });
    assert.ok(b.prompt.includes("未配置登录态"));
    assert.ok(b.prompt.includes("登录页") || b.prompt.includes("SSO"));
    assert.ok(b.prompt.includes("blocked"), "tells AI to judge blocked, not ask");
  });

  it("acknowledges an injected login state when hasLoginState=true", () => {
    const b = buildStep("execution", { taskName: "项目列表", env: "local", hasLoginState: true });
    assert.ok(b.prompt.includes("已为本项目注入登录态"));
  });

  it("non-execution steps carry no execution login block", () => {
    const b = buildStep("requirement", { taskName: "项目列表" });
    assert.equal(b.prompt.includes("登录态处理"), false);
    assert.equal(b.prompt.includes("严禁使用"), false);
  });
});

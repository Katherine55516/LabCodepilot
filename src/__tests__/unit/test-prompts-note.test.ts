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

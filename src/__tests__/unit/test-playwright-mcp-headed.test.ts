/**
 * Unit tests for buildPlaywrightMcp's headed/headless flag wiring — the 执行前确认
 * 弹窗「执行方式」选择最终落到这里:无头(默认)沿用 --headless;有头(独立窗口可见)省略
 * --headless,且打包态(随包只有 chrome-headless-shell,无法有头)改走系统 Chrome 通道。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-playwright-mcp-headed.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlaywrightMcp, willRunHeaded, resolveSystemChrome } from "../../lib/test/prompts";

// flag present?
const has = (args: string[], flag: string) => args.includes(flag);
// value token following a `--flag value` pair (or undefined).
const valOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), "ailab-mcp-test-"));
const EVID = "AI_LabTest/report/x/evidence";

describe("buildPlaywrightMcp · dev 态(无随包 headless_shell)", () => {
  before(() => { delete process.env.AILAB_RESOURCES_PATH; });

  it("默认(无 opts)= 无头:带 --headless、--browser chromium、无 --executable-path", () => {
    const cfg = buildPlaywrightMcp(PROJ, EVID, null);
    const args = (cfg as { args: string[] }).args;
    assert.ok(has(args, "--headless"), "默认应保持无头(与原行为一致)");
    assert.equal(valOf(args, "--browser"), "chromium");
    assert.equal(has(args, "--executable-path"), false);
  });

  it("headed:false = 与默认一致(仍无头)", () => {
    const args = (buildPlaywrightMcp(PROJ, EVID, null, { headed: false }) as { args: string[] }).args;
    assert.ok(has(args, "--headless"));
    assert.equal(valOf(args, "--browser"), "chromium");
  });

  it("headed:true = 有头:省略 --headless、dev 用完整 chromium、无 --executable-path", () => {
    const args = (buildPlaywrightMcp(PROJ, EVID, null, { headed: true }) as { args: string[] }).args;
    assert.equal(has(args, "--headless"), false, "有头应省略 --headless");
    assert.equal(valOf(args, "--browser"), "chromium", "始终用 chromium(不走 chrome channel)");
    assert.equal(has(args, "--executable-path"), false);
    assert.equal(willRunHeaded(true), true, "dev 态有头一定能有头");
  });

  it("storageStatePath 透传为 --storage-state", () => {
    const args = (buildPlaywrightMcp(PROJ, EVID, "/tmp/state.json", { headed: true }) as { args: string[] }).args;
    assert.equal(valOf(args, "--storage-state"), "/tmp/state.json");
  });
});

describe("buildPlaywrightMcp · 打包态(随包 chrome-headless-shell)", () => {
  let resources: string;
  let fakeChrome: string;
  // The host may preset its own browser root (CI images do); these cases assert what the builder injects.
  const inheritedBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  before(() => {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    // 造一个随包目录结构,让 resolveBundledHeadlessShell 命中一个假 headless_shell。
    resources = fs.mkdtempSync(path.join(os.tmpdir(), "ailab-resources-"));
    const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
    const platDir = path.join(resources, "ms-playwright", "chromium_headless_shell-1226", "chrome-headless-shell-mac-arm64");
    fs.mkdirSync(platDir, { recursive: true });
    fs.writeFileSync(path.join(platDir, exe), "#!/bin/sh\n");
    process.env.AILAB_RESOURCES_PATH = resources;
    // 假 Chrome 二进制 + AILAB_CHROME_PATH 覆盖(测试桩,绕开「本机是否真装 Chrome」)。
    fakeChrome = path.join(resources, "FakeChrome");
    fs.writeFileSync(fakeChrome, "#!/bin/sh\n");
  });
  after(() => {
    delete process.env.AILAB_RESOURCES_PATH;
    delete process.env.AILAB_CHROME_PATH;
    if (inheritedBrowsersPath !== undefined) process.env.PLAYWRIGHT_BROWSERS_PATH = inheritedBrowsersPath;
    try { fs.rmSync(resources, { recursive: true, force: true }); } catch {}
  });

  it("无头:--executable-path 指向随包 shell、带 --headless、env.PLAYWRIGHT_BROWSERS_PATH 注入", () => {
    delete process.env.AILAB_CHROME_PATH;
    const cfg = buildPlaywrightMcp(PROJ, EVID, null, { headed: false }) as { args: string[]; env: Record<string, string> };
    assert.ok(has(cfg.args, "--headless"));
    assert.equal(valOf(cfg.args, "--browser"), "chromium");
    assert.ok((valOf(cfg.args, "--executable-path") || "").includes("chrome-headless-shell"));
    assert.ok(cfg.env.PLAYWRIGHT_BROWSERS_PATH && cfg.env.PLAYWRIGHT_BROWSERS_PATH.includes("ms-playwright"));
  });

  it("有头 + 定位到 Chrome:--executable-path 指向 Chrome、无 --headless、无 PLAYWRIGHT_BROWSERS_PATH", () => {
    process.env.AILAB_CHROME_PATH = fakeChrome;
    assert.equal(resolveSystemChrome(), fakeChrome);
    assert.equal(willRunHeaded(true), true);
    const cfg = buildPlaywrightMcp(PROJ, EVID, null, { headed: true }) as { args: string[]; env: Record<string, string> };
    assert.equal(valOf(cfg.args, "--browser"), "chromium");
    assert.equal(valOf(cfg.args, "--executable-path"), fakeChrome, "有头直指 Chrome 完整二进制");
    assert.equal(has(cfg.args, "--headless"), false);
    assert.equal(cfg.env.PLAYWRIGHT_BROWSERS_PATH, undefined, "有头不应把浏览器根指向随包目录");
  });

  it("有头 + 没装 Chrome:自动回落无头(--executable-path 指 shell、带 --headless)、willRunHeaded=false", () => {
    process.env.AILAB_CHROME_PATH = "none"; // 显式判定无 Chrome(不探标准路径)
    assert.equal(resolveSystemChrome(), null);
    assert.equal(willRunHeaded(true), false, "打包态有头但无 Chrome → 回落无头");
    const cfg = buildPlaywrightMcp(PROJ, EVID, null, { headed: true }) as { args: string[]; env: Record<string, string> };
    assert.ok(has(cfg.args, "--headless"), "无 Chrome 的有头请求必须回落无头,绝不崩");
    assert.ok((valOf(cfg.args, "--executable-path") || "").includes("chrome-headless-shell"), "回落用随包 shell");
    assert.ok(cfg.env.PLAYWRIGHT_BROWSERS_PATH && cfg.env.PLAYWRIGHT_BROWSERS_PATH.includes("ms-playwright"));
  });
});

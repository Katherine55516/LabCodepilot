/**
 * Unit tests for buildPlaywrightMcp's alwaysLoad wiring.
 *
 * Claude Code 2.1.203 起启用 tool search 时 MCP 工具默认延迟加载
 * (defer_loading)，模型须先 ToolSearch 命中才能使用。执行步的浏览器工具是
 * 硬前置 —— 实测(2026-07-11, 3.2.1 打包版)网关模型在执行步反复 ToolSearch
 * 空转、0/4 无进展,约 8 分钟后被 SDK 停滞看门狗 abort。buildPlaywrightMcp
 * 必须带 alwaysLoad:true(经 toSdkMcpConfig → SDK McpStdioServerConfig
 * .alwaysLoad = API defer_loading:false),强制工具进 turn-1 prompt。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-playwright-mcp-alwaysload.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlaywrightMcp } from '../../lib/test/prompts';

const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'ailab-mcp-alwaysload-'));
const EVID = 'AI_LabTest/report/x/evidence';

describe('buildPlaywrightMcp · alwaysLoad(工具不被 tool search 延迟)', () => {
  before(() => {
    delete process.env.AILAB_RESOURCES_PATH;
  });

  it('默认(无头)带 alwaysLoad:true', () => {
    const cfg = buildPlaywrightMcp(PROJ, EVID, null);
    assert.equal(cfg.alwaysLoad, true);
  });

  it('有头模式同样带 alwaysLoad:true', () => {
    const cfg = buildPlaywrightMcp(PROJ, EVID, null, { headed: true });
    assert.equal(cfg.alwaysLoad, true);
  });
});

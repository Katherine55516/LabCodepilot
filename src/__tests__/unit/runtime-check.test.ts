/**
 * Unit tests for runtime-check（Phase 2b 运行时预检）。
 *
 * Run: npx tsx --test src/__tests__/unit/runtime-check.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runtimeMetaFor, isCommandAvailable, checkRuntimeForConfig } from '../../lib/runtime-check';
import type { MCPServerConfig } from '../../types';

describe('runtimeMetaFor — 命令 → 运行时映射', () => {
  it('npx / node → node (Node.js)', () => {
    assert.equal(runtimeMetaFor('npx').kind, 'node');
    assert.equal(runtimeMetaFor('node').name, 'Node.js');
    assert.equal(runtimeMetaFor('/usr/local/bin/npx').kind, 'node'); // 带路径取 basename
  });
  it('uvx / uv → uv', () => {
    assert.equal(runtimeMetaFor('uvx').kind, 'uv');
    assert.ok(runtimeMetaFor('uvx').url?.includes('astral'));
  });
  it('docker → docker', () => {
    assert.equal(runtimeMetaFor('docker').kind, 'docker');
  });
  it('dnx / dotnet → dotnet', () => {
    assert.equal(runtimeMetaFor('dnx').kind, 'dotnet');
  });
  it('未知命令 → unknown', () => {
    assert.equal(runtimeMetaFor('mystery-bin').kind, 'unknown');
  });
});

describe('isCommandAvailable', () => {
  it('node 在测试环境 PATH 中 → true', () => {
    assert.equal(isCommandAvailable('node'), true);
  });
  it('不存在的命令 → false', () => {
    assert.equal(isCommandAvailable('definitely-not-a-real-binary-xyz-123'), false);
  });
  it('绝对路径存在 → true', () => {
    assert.equal(isCommandAvailable(process.execPath), true); // node 二进制绝对路径
  });
  it('空命令 → false', () => {
    assert.equal(isCommandAvailable(''), false);
  });
});

describe('checkRuntimeForConfig', () => {
  it('远程（无 command）→ null（无需运行时）', () => {
    const cfg: MCPServerConfig = { type: 'http', url: 'https://x/mcp' };
    assert.equal(checkRuntimeForConfig(cfg), null);
  });
  it('npx 配置 → kind node + available true', () => {
    const cfg: MCPServerConfig = { command: 'npx', args: ['-y', '@x/y@1.0.0'] };
    const r = checkRuntimeForConfig(cfg);
    assert.ok(r);
    assert.equal(r!.kind, 'node');
    assert.equal(r!.available, true);
  });
  it('不存在的运行时命令 → available false', () => {
    const cfg: MCPServerConfig = { command: 'definitely-not-a-real-binary-xyz-123', args: [] };
    const r = checkRuntimeForConfig(cfg);
    assert.equal(r!.available, false);
  });
  it('null/undefined 配置 → null', () => {
    assert.equal(checkRuntimeForConfig(null), null);
    assert.equal(checkRuntimeForConfig(undefined), null);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

/**
 * E1 执行层守卫单测(docs/exec-plans/active/cowork-office-mode.md)。
 * 守卫的接线(claude-client 硬失败终止 / route 412 / MCP 过滤)由 dev+CDP
 * E2E 验证;这里钉死纯逻辑:reason → 结构化错误的映射与系统提示内容。
 */

const guardsPath = path.resolve(__dirname, '../../lib/cowork-guards.ts');

describe('cowork-guards: buildSandboxUnavailableError', () => {
  it('maps cowork_disabled_globally → non-retryable with enable hint', async () => {
    const { buildSandboxUnavailableError } = await import(guardsPath);
    const e = buildSandboxUnavailableError('cowork_disabled_globally');
    assert.equal(e.category, 'sandbox_unavailable');
    assert.equal(e.retryable, false);
    assert.equal(e.rawMessage, 'cowork_disabled_globally');
    assert.match(e.userMessage, /未启用/);
    assert.match(e.actionHint, /启用 Cowork 沙箱/);
  });

  it('maps image_not_provisioned → non-retryable with download guidance (M2)', async () => {
    const { buildSandboxUnavailableError } = await import(guardsPath);
    const e = buildSandboxUnavailableError('image_not_provisioned');
    assert.equal(e.retryable, false);
    assert.match(e.userMessage, /尚未下载/);
    assert.match(e.actionHint, /下载沙箱环境/);
  });

  it('maps forwarder_missing → non-retryable', async () => {
    const { buildSandboxUnavailableError } = await import(guardsPath);
    const e = buildSandboxUnavailableError('forwarder_missing');
    assert.equal(e.retryable, false);
    assert.match(e.userMessage, /转发器/);
  });

  it('maps vm_* runtime failures → retryable, keeps the raw phase in the message', async () => {
    const { buildSandboxUnavailableError } = await import(guardsPath);
    const e = buildSandboxUnavailableError('vm_crashed:spawn_failed');
    assert.equal(e.retryable, true);
    assert.match(e.userMessage, /vm_crashed:spawn_failed/);
    assert.match(e.actionHint, /vm-console\.log/);
  });

  it('falls back gracefully on unknown / missing reasons (retryable)', async () => {
    const { buildSandboxUnavailableError } = await import(guardsPath);
    for (const reason of ['decision_error', undefined]) {
      const e = buildSandboxUnavailableError(reason);
      assert.equal(e.category, 'sandbox_unavailable');
      assert.equal(e.retryable, true);
      assert.ok(e.userMessage.length > 0);
      assert.equal(e.rawMessage, reason ?? 'unknown');
    }
  });

  it('every variant carries the isolation promise tail (绝不落真机)', async () => {
    const { buildSandboxUnavailableError } = await import(guardsPath);
    const reasons = ['cowork_disabled_globally', 'image_not_provisioned', 'forwarder_missing', 'vm_starting', 'whatever'];
    for (const r of reasons) {
      assert.match(buildSandboxUnavailableError(r).userMessage, /没有在真机上执行任何操作/);
    }
  });
});

describe('cowork-guards: SANDBOX_NATIVE_RUNTIME_GUARD', () => {
  it('exposes a stable code and a user-readable error for the 412 response', async () => {
    const { SANDBOX_NATIVE_RUNTIME_GUARD } = await import(guardsPath);
    assert.equal(SANDBOX_NATIVE_RUNTIME_GUARD.code, 'SANDBOX_REQUIRES_SDK_RUNTIME');
    assert.match(SANDBOX_NATIVE_RUNTIME_GUARD.error, /native 运行时/);
    assert.match(SANDBOX_NATIVE_RUNTIME_GUARD.error, /托管模型/);
  });
});

describe('cowork-guards: buildSandboxSystemNote', () => {
  const SID = 'a1b2c3d4e5f6a7b8';

  it('embeds the exact per-session VM workspace path', async () => {
    const { buildSandboxSystemNote } = await import(guardsPath);
    const { sessionWorkspace } = await import(path.resolve(__dirname, '../../lib/cowork-transfer.ts'));
    const note = buildSandboxSystemNote(SID);
    assert.ok(note.includes(sessionWorkspace(SID)));
  });

  it('states the capability boundary: no host fs, no intranet, no external MCP, artifacts auto-surfaced', async () => {
    const { buildSandboxSystemNote } = await import(guardsPath);
    const note = buildSandboxSystemNote(SID);
    assert.match(note, /无法访问用户真机/);
    assert.match(note, /内网|局域网/);
    assert.match(note, /外部 MCP/);
    assert.match(note, /codepilot-\*/);
    assert.match(note, /沙箱产物/);
  });

  it('rejects a non-hex sessionId (inherits sessionWorkspace validation)', async () => {
    const { buildSandboxSystemNote } = await import(guardsPath);
    assert.throws(() => buildSandboxSystemNote('../etc'), /invalid cowork sessionId/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

// parseLeaseIp 套件已随 M1 移除:SSH/DHCP 反查链整体退役,就绪判定全走 vsock。

describe('cowork-poc: decideCowork gate (safe early-returns, no VM start)', () => {
  it('sandbox disabled → useSandbox:false, touches nothing', async () => {
    const { decideCowork } = await import(path.resolve(__dirname, '../../lib/cowork-poc.ts'));
    assert.deepEqual(await decideCowork(0), { useSandbox: false });
    assert.deepEqual(await decideCowork(undefined), { useSandbox: false });
    assert.deepEqual(await decideCowork(false), { useSandbox: false });
  });

  it('sandbox on but global cowork_enabled off → falls back with reason, never starts VM', async () => {
    const { decideCowork } = await import(path.resolve(__dirname, '../../lib/cowork-poc.ts'));
    const { getSetting, setSetting } = await import(path.resolve(__dirname, '../../lib/db.ts'));
    const saved = getSetting('cowork_enabled');
    try {
      setSetting('cowork_enabled', 'false');
      const decision = await decideCowork(1);
      assert.equal(decision.useSandbox, false);
      assert.equal(decision.reason, 'cowork_disabled_globally');
    } finally {
      // Restore exactly (may have been unset originally → clear to '')
      setSetting('cowork_enabled', saved ?? '');
    }
  });
});

describe('db: mergeVmArtifactLists (pure merge semantics)', () => {
  it('dedupes by path with newer mtime winning, sorted by name', async () => {
    const { mergeVmArtifactLists } = await import(path.resolve(__dirname, '../../lib/db.ts'));
    const existing = [
      { path: '/ws/b.txt', name: 'b.txt', size: 10, mtime: 1000 },
      { path: '/ws/a.txt', name: 'a.txt', size: 5, mtime: 2000 },
    ];
    const incoming = [
      { path: '/ws/b.txt', name: 'b.txt', size: 22, mtime: 3000 }, // newer → replaces
      { path: '/ws/c.txt', name: 'c.txt', size: 7, mtime: 1500 },  // new file
    ];
    const merged = mergeVmArtifactLists(existing, incoming);
    assert.deepEqual(merged.map((f: { name: string }) => f.name), ['a.txt', 'b.txt', 'c.txt']);
    assert.equal(merged.find((f: { name: string }) => f.name === 'b.txt')!.size, 22);
  });

  it('keeps the existing entry when incoming is older', async () => {
    const { mergeVmArtifactLists } = await import(path.resolve(__dirname, '../../lib/db.ts'));
    const merged = mergeVmArtifactLists(
      [{ path: '/ws/x', name: 'x', size: 1, mtime: 5000 }],
      [{ path: '/ws/x', name: 'x', size: 99, mtime: 100 }],
    );
    assert.equal(merged[0].size, 1);
  });

  it('ignores malformed entries and handles empty inputs', async () => {
    const { mergeVmArtifactLists } = await import(path.resolve(__dirname, '../../lib/db.ts'));
    assert.deepEqual(mergeVmArtifactLists([], []), []);
    const malformed = [null, { name: 'no-path', size: 2, mtime: 2 }] as unknown as Array<{ path: string; name: string; size: number; mtime: number }>;
    const merged = mergeVmArtifactLists(
      [{ path: '/ws/ok', name: 'ok', size: 1, mtime: 1 }],
      malformed,
    );
    assert.equal(merged.length, 1);
  });
});

describe('cowork-transfer: assertPathInWorkspace (host-side early reject)', () => {
  const SID = 'a1b2c3d4e5f6a7b8';
  it('accepts a path inside the session workspace', async () => {
    const { assertPathInWorkspace, sessionWorkspace } = await import(path.resolve(__dirname, '../../lib/cowork-transfer.ts'));
    const ws = sessionWorkspace(SID);
    assert.equal(assertPathInWorkspace(SID, `${ws}/out.csv`), `${ws}/out.csv`);
    assert.equal(assertPathInWorkspace(SID, ws), ws);
  });
  it('rejects traversal and foreign prefixes', async () => {
    const { assertPathInWorkspace, sessionWorkspace } = await import(path.resolve(__dirname, '../../lib/cowork-transfer.ts'));
    const ws = sessionWorkspace(SID);
    assert.throws(() => assertPathInWorkspace(SID, `${ws}/../../../../etc/passwd`), /invalid path/);
    assert.throws(() => assertPathInWorkspace(SID, '/etc/hostname'), /escapes session workspace/);
    assert.throws(() => assertPathInWorkspace(SID, `${ws}/a\0b`), /invalid path/);
  });
  it('rejects a non-hex sessionId', async () => {
    const { sessionWorkspace } = await import(path.resolve(__dirname, '../../lib/cowork-transfer.ts'));
    assert.throws(() => sessionWorkspace('../../etc'), /invalid cowork sessionId/);
  });
});

describe('cowork-vm-manager: isImageProvisioned + getStatus surface', () => {
  it('exposes a stopped status before any start', async () => {
    const mod = await import(path.resolve(__dirname, '../../lib/cowork-vm-manager.ts'));
    const status = mod.getStatus();
    assert.ok(['stopped', 'starting', 'running', 'crashed'].includes(status.phase));
    // isImageProvisioned is a pure fs check — must never throw
    assert.equal(typeof mod.isImageProvisioned(), 'boolean');
  });

  it('markSessionActive / releaseSession are safe no-throw on any id', async () => {
    const mod = await import(path.resolve(__dirname, '../../lib/cowork-vm-manager.ts'));
    assert.doesNotThrow(() => mod.markSessionActive('abc123'));
    assert.doesNotThrow(() => mod.releaseSession('abc123'));
    assert.doesNotThrow(() => mod.releaseSession('never-added'));
  });
});

/**
 * Unit tests for the QQ adapter reconnect guard (memory-leak fix).
 *
 * Regression target: a single failed connection fires BOTH ws.on('error')
 * (→ promise reject → caller catch → scheduleReconnect) and ws.on('close')
 * (→ scheduleReconnect). Without a guard each failure forks into multiple
 * reconnect chains, causing exponential WebSocket + timer growth during an
 * outage, and the reconnect timer was never cleared on stop().
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-qq-reconnect-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let QQAdapter: typeof import('../../lib/bridge/adapters/qq-adapter').QQAdapter;
let closeDb: typeof import('../../lib/db').closeDb;

/** Test-only facade for QQAdapter internals touched by the reconnect fix. */
interface QQAdapterTestable {
  _running: boolean;
  shouldReconnect: boolean;
  reconnectAttempts: number;
  reconnectScheduled: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  scheduleReconnect: () => void;
  stop: () => Promise<void>;
}

before(async () => {
  ({ QQAdapter } = await import('../../lib/bridge/adapters/qq-adapter'));
  ({ closeDb } = await import('../../lib/db'));
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('QQAdapter reconnect guard', () => {
  it('coalesces error+close into a single reconnect chain', () => {
    const adapter = new QQAdapter() as unknown as QQAdapterTestable;
    adapter._running = true;
    adapter.shouldReconnect = true;

    // Simulate one failed connection: both the 'error' and 'close' handlers
    // request a reconnect.
    adapter.scheduleReconnect();
    adapter.scheduleReconnect();

    assert.equal(adapter.reconnectAttempts, 1, 'only one attempt should be counted');
    assert.equal(adapter.reconnectScheduled, true, 'reconnect should be marked scheduled');
    assert.ok(adapter.reconnectTimer, 'exactly one reconnect timer should be armed');

    // Cleanup: cancel the armed real timer so it never fires / leaks a handle.
    clearTimeout(adapter.reconnectTimer as ReturnType<typeof setTimeout>);
  });

  it('stop() cancels the pending reconnect timer and resets the guard', async () => {
    const adapter = new QQAdapter() as unknown as QQAdapterTestable;
    adapter._running = true;
    adapter.shouldReconnect = true;

    adapter.scheduleReconnect();
    assert.ok(adapter.reconnectTimer, 'a reconnect timer is armed before stop');

    await adapter.stop();

    assert.equal(adapter.reconnectTimer, null, 'reconnect timer cleared on stop');
    assert.equal(adapter.reconnectScheduled, false, 'guard reset on stop');
  });
});

/**
 * Unit test for the Telegram adapter stop()/restart() loop-termination fix
 * (memory-leak fix).
 *
 * Regression target: stop() aborted the poll loop but returned before the loop
 * actually exited. A back-to-back restart() (triggered on every runtime config
 * / account change) could then start a second TelegramAdapter whose poll loop
 * competes with the old one for the same bot token + offset key — duplicate
 * long-poll loops leaking until the old one happened to unblock. stop() now
 * awaits the loop's completion promise before returning.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-telegram-restart-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let TelegramAdapter: typeof import('../../lib/bridge/adapters/telegram-adapter').TelegramAdapter;
let closeDb: typeof import('../../lib/db').closeDb;

/** Test-only facade for TelegramAdapter internals touched by the stop() fix. */
interface TelegramAdapterTestable {
  running: boolean;
  committedOffset: number;
  abortController: AbortController | null;
  loopDone: Promise<void> | null;
  stop: () => Promise<void>;
}

before(async () => {
  ({ TelegramAdapter } = await import('../../lib/bridge/adapters/telegram-adapter'));
  ({ closeDb } = await import('../../lib/db'));
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('TelegramAdapter stop() loop termination', () => {
  it('does not resolve until the poll loop has exited', async () => {
    const adapter = new TelegramAdapter() as unknown as TelegramAdapterTestable;
    adapter.running = true;
    adapter.committedOffset = 0;        // keep persistCommittedOffset a no-op
    adapter.abortController = null;

    // Stand in for the running poll loop with a promise we control.
    let resolveLoop!: () => void;
    adapter.loopDone = new Promise<void>((resolve) => { resolveLoop = resolve; });

    let stopResolved = false;
    const stopPromise = adapter.stop().then(() => { stopResolved = true; });

    // Let microtasks drain — stop() must still be blocked on loopDone.
    await new Promise((r) => setImmediate(r));
    assert.equal(stopResolved, false, 'stop() must wait for the loop to exit');

    // The loop exits → stop() can now complete.
    resolveLoop();
    await stopPromise;

    assert.equal(stopResolved, true, 'stop() resolves after the loop exits');
    assert.equal(adapter.loopDone, null, 'loopDone is cleared after stop');
    assert.equal(adapter.running, false, 'adapter marked not running');
  });

  it('stop() is a no-op when not running', async () => {
    const adapter = new TelegramAdapter() as unknown as TelegramAdapterTestable;
    adapter.running = false;
    // Should resolve immediately without touching loopDone.
    await adapter.stop();
    assert.equal(adapter.running, false);
  });
});

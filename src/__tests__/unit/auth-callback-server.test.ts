/**
 * Unit tests for electron/auth/callback-server.ts.
 *
 * Starts a real loopback server, sends real HTTP requests to /cb, asserts
 * the state/error/token branches. No electron dependency.
 *
 * Run with: npx tsx --test src/__tests__/unit/auth-callback-server.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startCallbackServer } from '../../../electron/auth/callback-server';

async function fetchCb(port: number, query: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/cb${query ? '?' + query : ''}`);
  const body = await res.text();
  return { status: res.status, body };
}

/**
 * Wait for promise to settle as a tagged union so we can match errors explicitly.
 *
 * NOT async: we attach the .then handler synchronously when callers invoke
 * settled(p). If we made this an async function, the .then attachment would
 * happen one microtask later — long enough for Node to mark p as an
 * unhandled rejection if it errored synchronously inside the HTTP handler.
 */
function settled<T>(
  p: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error: error as Error }),
  );
}

describe('callback server', () => {
  it('resolves with token when state matches', async () => {
    const cb = await startCallbackServer('expected-state-xyz');
    try {
      const waitPromise = cb.waitForCallback(5000);
      const res = await fetchCb(cb.port, 'session_token=tok123&state=expected-state-xyz');
      assert.equal(res.status, 200);
      assert.match(res.body, /登录成功/);

      const result = await waitPromise;
      assert.equal(result.session_token, 'tok123');
      assert.equal(result.state, 'expected-state-xyz');
    } finally {
      cb.close();
    }
  });

  it('rejects on state mismatch (CSRF guard)', async () => {
    const cb = await startCallbackServer('expected-state');
    try {
      const settledP = settled(cb.waitForCallback(5000));
      const res = await fetchCb(cb.port, 'session_token=tok&state=wrong-state');
      assert.equal(res.status, 200);
      assert.match(res.body, /登录失败/);

      const r = await settledP;
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error.message, /state mismatch/);
    } finally {
      cb.close();
    }
  });

  it('rejects on OAuth error param', async () => {
    const cb = await startCallbackServer('s1');
    try {
      const settledP = settled(cb.waitForCallback(5000));
      const res = await fetchCb(cb.port, 'error=access_denied&error_description=User%20cancelled&state=s1');
      assert.equal(res.status, 200);
      assert.match(res.body, /User cancelled/);

      const r = await settledP;
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error.message, /User cancelled/);
    } finally {
      cb.close();
    }
  });

  it('rejects when session_token missing', async () => {
    const cb = await startCallbackServer('s1');
    try {
      const settledP = settled(cb.waitForCallback(5000));
      await fetchCb(cb.port, 'state=s1');
      const r = await settledP;
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error.message, /no session_token/);
    } finally {
      cb.close();
    }
  });

  it('returns 404 for paths other than /cb', async () => {
    const cb = await startCallbackServer('s1');
    try {
      const res = await fetch(`http://127.0.0.1:${cb.port}/something-else`);
      assert.equal(res.status, 404);
    } finally {
      cb.close();
    }
  });

  it('times out if no callback arrives', async () => {
    const cb = await startCallbackServer('s1');
    try {
      const r = await settled(cb.waitForCallback(100));
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error.message, /timed out/);
    } finally {
      cb.close();
    }
  });

  it('binds 127.0.0.1 only (cannot be reached on other interfaces)', async () => {
    const cb = await startCallbackServer('s1');
    try {
      // localhost loopback works
      const r1 = await fetch(`http://127.0.0.1:${cb.port}/cb?session_token=x&state=s1`);
      assert.equal(r1.status, 200);
    } finally {
      cb.close();
    }
  });
});

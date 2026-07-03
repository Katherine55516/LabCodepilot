/**
 * Unit tests for the SDK init metadata cache — the localStorage-backed
 * fallback that lets a fresh conversation's slash popover show CLI-built-in
 * commands (e.g. /simplify) before the session's first init message arrives.
 *
 * Run with: npx tsx --test src/__tests__/unit/sdk-init-cache.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// Static import is safe: the module reads `window` at call time, not load
// time, so the shim below only has to exist before the first test runs.
import { saveCachedSdkInitMeta, loadCachedSdkInitMeta } from '../../lib/sdk-init-cache';

// Minimal localStorage + window shim (tests run under node, not a browser).
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
};

describe('sdk-init-cache', () => {
  beforeEach(() => store.clear());

  it('round-trips slash_commands and skills', () => {
    saveCachedSdkInitMeta({
      slash_commands: ['simplify', 'code-review'],
      skills: [{ name: 'pdf' }],
    });
    const loaded = loadCachedSdkInitMeta();
    assert.deepEqual(loaded?.slash_commands, ['simplify', 'code-review']);
    assert.deepEqual(loaded?.skills, [{ name: 'pdf' }]);
  });

  it('returns null when nothing was cached', () => {
    assert.equal(loadCachedSdkInitMeta(), null);
  });

  it('ignores a degraded init (empty arrays) instead of clobbering the cache', () => {
    saveCachedSdkInitMeta({ slash_commands: ['simplify'], skills: [] });
    saveCachedSdkInitMeta({ slash_commands: [], skills: [] });
    assert.deepEqual(loadCachedSdkInitMeta()?.slash_commands, ['simplify']);
  });

  it('ignores non-array metadata shapes on save', () => {
    saveCachedSdkInitMeta({ slash_commands: 'not-an-array', skills: undefined });
    assert.equal(loadCachedSdkInitMeta(), null);
  });

  it('returns null on corrupt stored JSON', () => {
    store.set('codepilot:sdk-init-meta:v1', '{broken');
    assert.equal(loadCachedSdkInitMeta(), null);
  });

  it('overwrites the cache when a newer non-empty init arrives', () => {
    saveCachedSdkInitMeta({ slash_commands: ['old-cmd'], skills: [] });
    saveCachedSdkInitMeta({ slash_commands: ['simplify', 'security-review'], skills: [] });
    assert.deepEqual(loadCachedSdkInitMeta()?.slash_commands, ['simplify', 'security-review']);
  });

  it('keeps rich object entries when a later save has only bare names', () => {
    // warmup (/api/sdk-commands) writes objects with descriptions...
    saveCachedSdkInitMeta({
      slash_commands: [{ name: 'simplify', description: 'Review changed code' }],
      skills: [],
    });
    // ...then a live init reports the same command as a bare string
    saveCachedSdkInitMeta({ slash_commands: ['simplify', 'compact'], skills: [] });
    assert.deepEqual(loadCachedSdkInitMeta()?.slash_commands, [
      { name: 'simplify', description: 'Review changed code' },
      'compact',
    ]);
  });

  it('drops object entries absent from a later save (stale command removed)', () => {
    saveCachedSdkInitMeta({
      slash_commands: [{ name: 'gone-cmd', description: 'removed upstream' }],
      skills: [],
    });
    saveCachedSdkInitMeta({ slash_commands: ['simplify'], skills: [] });
    assert.deepEqual(loadCachedSdkInitMeta()?.slash_commands, ['simplify']);
  });

  it('preserves skills when a commands-only save arrives (per-field merge)', () => {
    saveCachedSdkInitMeta({ slash_commands: [], skills: [{ name: 'pdf' }] });
    saveCachedSdkInitMeta({ slash_commands: ['simplify'] });
    const loaded = loadCachedSdkInitMeta();
    assert.deepEqual(loaded?.slash_commands, ['simplify']);
    assert.deepEqual(loaded?.skills, [{ name: 'pdf' }]);
  });
});

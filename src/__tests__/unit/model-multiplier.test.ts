/**
 * Tests for model-multiplier pure helpers — the extraction rule that pulls
 * `model_multiplier` out of a managed provider's `managed_extra_json`, and the
 * display format shared by the composer (办公 / 研发) and routine (定时任务)
 * model pickers.
 *
 * The recurring theme: an unknown multiplier must stay unknown. Every invalid
 * shape returns null so call sites render nothing, never a fabricated 1.0x.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseManagedMultiplier,
  normalizeMultiplier,
  formatMultiplier,
} from '../../lib/model-multiplier';

/** Shape the real sync writes: the whole ModelConfig preserved under `raw`. */
function extraJson(rawFields: Record<string, unknown>): string {
  return JSON.stringify({
    effort_level: '',
    subagent_model: '',
    extra: {},
    raw: { id: 'uuid-1', name: 'Qwen3.8-Max', ...rawFields },
  });
}

describe('parseManagedMultiplier', () => {
  it('extracts model_multiplier from the raw ModelConfig dump', () => {
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: 1.4 })), 1.4);
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: 10.5 })), 10.5);
    // Baseline arrives as the integer 1 on the wire, not 1.0.
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: 1 })), 1);
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: 0 })), 0);
  });

  it('returns null when the field is absent (row synced before the server shipped it)', () => {
    assert.equal(parseManagedMultiplier(extraJson({})), null);
    assert.equal(parseManagedMultiplier(JSON.stringify({ raw: {} })), null);
    assert.equal(parseManagedMultiplier('{}'), null);
  });

  it('returns null for missing / empty / malformed input', () => {
    assert.equal(parseManagedMultiplier(undefined), null);
    assert.equal(parseManagedMultiplier(null), null);
    assert.equal(parseManagedMultiplier(''), null);
    assert.equal(parseManagedMultiplier('not json'), null);
    // A sealed (still-encrypted) column must not throw either.
    assert.equal(parseManagedMultiplier('enc:v1:W/p9sABC'), null);
  });

  it('returns null when raw is not an object', () => {
    assert.equal(parseManagedMultiplier(JSON.stringify({ raw: null })), null);
    assert.equal(parseManagedMultiplier(JSON.stringify({ raw: 'x' })), null);
    assert.equal(parseManagedMultiplier(JSON.stringify({ raw: 3 })), null);
  });

  it('rejects non-numeric and out-of-range multipliers', () => {
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: '1.4' })), null);
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: null })), null);
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: -1 })), null);
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: NaN })), null);
    assert.equal(parseManagedMultiplier(extraJson({ model_multiplier: Infinity })), null);
  });
});

describe('normalizeMultiplier', () => {
  it('passes through usable numbers', () => {
    assert.equal(normalizeMultiplier(3.1), 3.1);
    assert.equal(normalizeMultiplier(0), 0);
  });

  it('rejects everything that is not a finite non-negative number', () => {
    assert.equal(normalizeMultiplier('3.1'), null);
    assert.equal(normalizeMultiplier(undefined), null);
    assert.equal(normalizeMultiplier(null), null);
    assert.equal(normalizeMultiplier(-0.5), null);
    assert.equal(normalizeMultiplier(NaN), null);
  });
});

describe('formatMultiplier', () => {
  it('always renders one decimal place', () => {
    assert.equal(formatMultiplier(1), '1.0x');
    assert.equal(formatMultiplier(1.4), '1.4x');
    assert.equal(formatMultiplier(10.5), '10.5x');
    assert.equal(formatMultiplier(0.1), '0.1x');
  });

  it('rounds to the server-stated one-decimal precision', () => {
    assert.equal(formatMultiplier(1.16), '1.2x');
    assert.equal(formatMultiplier(0.56), '0.6x');
  });

  it('returns null for unusable values so call sites render nothing', () => {
    assert.equal(formatMultiplier(undefined), null);
    assert.equal(formatMultiplier(null), null);
    assert.equal(formatMultiplier('1.4'), null);
    assert.equal(formatMultiplier(-1), null);
    assert.equal(formatMultiplier(NaN), null);
  });
});

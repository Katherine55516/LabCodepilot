import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getContextWindow,
  MODEL_CONTEXT_WINDOWS,
  getManagedContextWindowByName,
  is1mContextModelName,
} from '../../lib/model-context';

describe('getContextWindow — alias disambiguation', () => {
  it('bare opus alias resolves to 200K (Bedrock/Vertex-safe default)', () => {
    assert.equal(getContextWindow('opus'), 200_000);
  });

  it('opus with first-party upstream resolves to 1M (Opus 4.7)', () => {
    assert.equal(
      getContextWindow('opus', { upstream: 'claude-opus-4-7' }),
      1_000_000,
    );
  });

  it('claude-opus-4-7 exact match returns 1M', () => {
    assert.equal(getContextWindow('claude-opus-4-7'), 1_000_000);
  });

  it('vendor-prefixed opus-4-7 substring matches 1M, not 200K alias', () => {
    // Regression: keys were iterated in insertion order, so the short 'opus'
    // alias (200K) was matched first for any full name containing 'opus'.
    // Sorting fallback keys by length puts claude-opus-4-7 (1M) ahead.
    assert.equal(
      getContextWindow('us.anthropic.claude-opus-4-7-v1:0'),
      1_000_000,
      'vendor-prefixed 4.7 must hit claude-opus-4-7 before opus alias',
    );
  });

  it('opus alias with vendor-prefixed upstream resolves to 1M', () => {
    // Regression: the previous guard (`MODEL_CONTEXT_WINDOWS[upstream] != null`)
    // required an exact key match on `upstream` before using it. A vendor-
    // prefixed full name like `us.anthropic.claude-opus-4-7-v1:0` failed that
    // check and the helper silently fell back to the bare 'opus' alias (200K).
    // resolveWindow must now substring-match the upstream first.
    assert.equal(
      getContextWindow('opus', { upstream: 'us.anthropic.claude-opus-4-7-v1:0' }),
      1_000_000,
    );
  });

  it('unknown upstream falls back to model alias instead of returning null', () => {
    // When the caller supplies an upstream we don't recognize, we should
    // not drop to null — we should honor the alias the caller also knows.
    // Example: some third-party proxy passes an opaque upstream ID we've
    // never seen, but the UI model is still 'opus'.
    assert.equal(
      getContextWindow('opus', { upstream: 'proxy-specific-opaque-name' }),
      200_000,
    );
  });

  it('unknown upstream does not poison a known model key', () => {
    // The failing-upstream path must not shadow a valid exact match on
    // the model itself. If model='claude-opus-4-7' and upstream is garbage,
    // the result should still be 1M (from the model), not null.
    assert.equal(
      getContextWindow('claude-opus-4-7', { upstream: 'not-in-the-table' }),
      1_000_000,
    );
  });

  it('context1m beta toggle upgrades to 1M regardless of base', () => {
    assert.equal(
      getContextWindow('claude-opus-4-20250514', { context1m: true }),
      1_000_000,
    );
  });

  it('unknown model returns null (so callers can fall back safely)', () => {
    assert.equal(getContextWindow('nonexistent-model'), null);
  });

  it('MODEL_CONTEXT_WINDOWS still carries explicit entries expected by route code', () => {
    // Guardrail for future refactors that might accidentally rename keys
    // out from under /api/providers/models and claude-client.
    assert.ok('opus' in MODEL_CONTEXT_WINDOWS);
    assert.ok('claude-opus-4-7' in MODEL_CONTEXT_WINDOWS);
    assert.ok('claude-opus-4-20250514' in MODEL_CONTEXT_WINDOWS);
  });
});

describe('is1mContextModelName — [1m] CLI alias detection', () => {
  it('matches runtime model names carrying the [1m] suffix', () => {
    assert.equal(is1mContextModelName('claude-opus-4-7[1m]'), true);
    assert.equal(is1mContextModelName('claude-sonnet-4-6[1m]'), true);
  });

  it('does not match names without the marker', () => {
    assert.equal(is1mContextModelName('claude-opus-4-7'), false);
    assert.equal(is1mContextModelName('高阶模型-C47'), false); // 下拉框展示名不带 [1m]
    assert.equal(is1mContextModelName(''), false);
    assert.equal(is1mContextModelName(null), false);
    assert.equal(is1mContextModelName(undefined), false);
  });
});

describe('getManagedContextWindowByName — window by managed display name', () => {
  it('maps 1000K models, punctuation-insensitive', () => {
    assert.equal(getManagedContextWindowByName('高阶模型-C48'), 1_000_000);
    assert.equal(getManagedContextWindowByName('高阶模型C48'), 1_000_000); // no hyphen
    assert.equal(getManagedContextWindowByName('高阶模型-C47'), 1_000_000);
    assert.equal(getManagedContextWindowByName('高阶模型-G55'), 1_000_000);
    assert.equal(getManagedContextWindowByName('GLM5.2'), 1_000_000);
    assert.equal(getManagedContextWindowByName('Qwen3.7-Max'), 1_000_000);
    assert.equal(getManagedContextWindowByName('Qwen3.7-Plus'), 1_000_000);
    assert.equal(getManagedContextWindowByName('MiniMax-M3'), 1_000_000);
  });

  it('maps 200K models (GLM5.1, Kimi-K2.6, Kimi-K2.7-Code) and GLM5.1 does not collide with GLM5.2', () => {
    assert.equal(getManagedContextWindowByName('GLM5.1'), 200_000);
    assert.equal(getManagedContextWindowByName('Kimi-K2.6'), 200_000);
    assert.equal(getManagedContextWindowByName('Kimi-K2.7-Code'), 200_000);
    assert.notEqual(
      getManagedContextWindowByName('GLM5.1'),
      getManagedContextWindowByName('GLM5.2'),
    );
  });

  it('returns null for unknown / empty names so callers can fall back', () => {
    assert.equal(getManagedContextWindowByName('Some-Unknown-Model'), null);
    assert.equal(getManagedContextWindowByName(''), null);
    assert.equal(getManagedContextWindowByName(undefined), null);
  });
});

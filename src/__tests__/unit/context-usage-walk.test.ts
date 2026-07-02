/**
 * Locks walkContextUsage: backward baseline selection, output-only skip,
 * all-empty skip, and latest-wins capture of window / cost. Spec §5.2 / §14.5.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { walkContextUsage } from '../../lib/context-usage-walk';
import type { Message } from '../../types';

function asMsg(role: 'user' | 'assistant', usage: Record<string, unknown> | null): Message {
  return {
    id: 'm',
    session_id: 's',
    role,
    content: '[]',
    created_at: '2026-01-01T00:00:00Z',
    token_usage: usage ? JSON.stringify(usage) : null,
  };
}

describe('walkContextUsage — baseline selection', () => {
  it('returns the latest record with used>0 as the strong baseline', () => {
    const r = walkContextUsage([
      asMsg('assistant', { input_tokens: 10_000, output_tokens: 500 }),
      asMsg('assistant', { input_tokens: 50_000, cache_read_input_tokens: 20_000, output_tokens: 800 }),
    ]);
    assert.equal(r.baseline?.used, 70_000); // 50k + 20k cache, the newest used>0
    assert.equal(r.baseline?.cacheReadTokens, 20_000);
    assert.equal(r.baseline?.outputTokens, 800);
  });

  it('skips an output-only tail record but still finds the prior strong baseline', () => {
    const r = walkContextUsage([
      asMsg('assistant', { input_tokens: 50_000, output_tokens: 800 }),
      asMsg('assistant', { input_tokens: 0, output_tokens: 120 }), // output-only tail
    ]);
    assert.equal(r.baseline?.used, 50_000);
  });

  it('falls back to a weak baseline when only output-only records exist', () => {
    const r = walkContextUsage([asMsg('assistant', { input_tokens: 0, output_tokens: 120 })]);
    assert.equal(r.baseline?.used, 0);
    assert.equal(r.baseline?.outputTokens, 120);
  });

  it('returns null baseline when there is no usable token_usage', () => {
    const r = walkContextUsage([
      asMsg('user', null),
      asMsg('assistant', null),
      asMsg('assistant', { input_tokens: 0, output_tokens: 0 }), // all-empty, skipped
    ]);
    assert.equal(r.baseline, null);
  });
});

describe('walkContextUsage — latest-wins capture', () => {
  it('captures the newest positive context_window even from a skipped record', () => {
    const r = walkContextUsage([
      asMsg('assistant', { input_tokens: 50_000, output_tokens: 800, context_window: 200_000 }),
      asMsg('assistant', { input_tokens: 0, output_tokens: 120, context_window: 1_000_000 }),
    ]);
    assert.equal(r.latestSdkContextWindow, 1_000_000); // from the newer (skipped) record
    assert.equal(r.baseline?.used, 50_000);
    assert.equal(r.baseline?.sdkContextWindow, 200_000); // baseline record's own window
  });

  it('captures the newest usage.model even from a skipped record', () => {
    const r = walkContextUsage([
      asMsg('assistant', { input_tokens: 50_000, output_tokens: 800, model: 'claude-opus-4-7' }),
      asMsg('assistant', { input_tokens: 0, output_tokens: 120, model: 'claude-opus-4-7[1m]' }),
    ]);
    assert.equal(r.latestModel, 'claude-opus-4-7[1m]'); // newest wins, even if skipped as baseline
    assert.equal(r.baseline?.used, 50_000);
  });

  it('latestModel is null when no record carries usage.model', () => {
    const r = walkContextUsage([
      asMsg('assistant', { input_tokens: 10_000, output_tokens: 200 }),
    ]);
    assert.equal(r.latestModel, null);
  });

  it('captures the newest cost_usd', () => {
    const r = walkContextUsage([
      asMsg('assistant', { input_tokens: 10_000, output_tokens: 200, cost_usd: 0.01 }),
      asMsg('assistant', { input_tokens: 50_000, output_tokens: 800, cost_usd: 0.05 }),
    ]);
    assert.equal(r.latestCostUsd, 0.05);
  });

  it('ignores non-assistant messages and unparseable token_usage', () => {
    const bad: Message = { ...asMsg('assistant', null), token_usage: '{not json' };
    const r = walkContextUsage([
      asMsg('user', { input_tokens: 999_999 }), // user role ignored
      bad, // unparseable, skipped
      asMsg('assistant', { input_tokens: 30_000, output_tokens: 100 }),
    ]);
    assert.equal(r.baseline?.used, 30_000);
  });
});

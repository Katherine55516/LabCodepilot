/**
 * Locks the buildContextUsageBreakdown split + the compact formatters.
 * Invariants: residual absorption, clamp-to-zero (no rescale), pending NOT in
 * used, parts always 10 in order, window-unknown → ratio undefined. Spec §5.1/§14.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextUsageBreakdown,
  formatTokensCompact,
  formatContextPercent,
  CONTEXT_BREAKDOWN_KIND_ORDER,
  PENDING_BREAKDOWN_KINDS,
  type ContextBreakdownKind,
} from '../../lib/context-breakdown';

function tok(breakdown: { parts: { kind: ContextBreakdownKind; tokens: number }[] }, kind: ContextBreakdownKind): number {
  return breakdown.parts.find((p) => p.kind === kind)!.tokens;
}

describe('buildContextUsageBreakdown — basic split', () => {
  it('conversation absorbs the residual (used - known)', () => {
    const b = buildContextUsageBreakdown({
      baseline: { used: 100_000, cacheReadTokens: 40_000, cacheCreationTokens: 10_000, outputTokens: 2_000 },
      contextWindow: 200_000,
    });
    assert.equal(b.usedTokens, 100_000); // reported > known(52k) + output(2k)
    assert.equal(tok(b, 'cache_or_previous'), 50_000);
    assert.equal(tok(b, 'conversation'), 50_000); // 100k - 50k cache
    assert.equal(b.ratio, 0.5);
    assert.equal(b.remainingTokens, 100_000);
  });

  it('always returns 10 parts in CONTEXT_BREAKDOWN_KIND_ORDER', () => {
    const b = buildContextUsageBreakdown({});
    assert.equal(b.parts.length, 10);
    assert.deepEqual(b.parts.map((p) => p.kind), [...CONTEXT_BREAKDOWN_KIND_ORDER]);
  });
});

describe('buildContextUsageBreakdown — known > reported', () => {
  it('lifts usedTokens to known + output and clamps conversation to 0 (no rescale)', () => {
    const b = buildContextUsageBreakdown({
      baseline: { used: 100_000, cacheReadTokens: 50_000, cacheCreationTokens: 0, outputTokens: 0 },
      compiler: { toolDescriptorTokens: 80_000 },
      contextWindow: 1_000_000,
    });
    // known = tools 80k + cache 50k = 130k; used = max(100k, 130k) = 130k
    assert.equal(b.usedTokens, 130_000);
    assert.equal(tok(b, 'conversation'), 0); // clamped, not rescaled
    const sum = b.parts.reduce((s, p) => s + (PENDING_BREAKDOWN_KINDS.includes(p.kind) ? 0 : p.tokens), 0);
    assert.equal(sum, b.usedTokens); // additive self-consistency
  });

  it('proxy reports input=0 but compiler/output present → used = known + output', () => {
    const b = buildContextUsageBreakdown({
      baseline: { used: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 5_000 },
      compiler: { toolDescriptorTokens: 30_000 },
    });
    assert.equal(b.usedTokens, 35_000); // max(0, 30k + 5k)
  });
});

describe('buildContextUsageBreakdown — pending & unknown window', () => {
  it('pending parts never count toward usedTokens', () => {
    const b = buildContextUsageBreakdown({
      baseline: { used: 50_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 },
      pending: { attachmentTokens: 5_000, mentionTokens: 3_000 },
      contextWindow: 200_000,
    });
    assert.equal(b.usedTokens, 50_000); // pending excluded
    assert.equal(tok(b, 'files_attachments'), 8_000);
  });

  it('unknown / non-positive window → ratio and remainingTokens undefined', () => {
    const b1 = buildContextUsageBreakdown({ baseline: { used: 1000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 } });
    assert.equal(b1.ratio, undefined);
    assert.equal(b1.remainingTokens, undefined);
    assert.equal(b1.contextWindow, undefined);
    const b2 = buildContextUsageBreakdown({ baseline: { used: 1000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 }, contextWindow: 0 });
    assert.equal(b2.ratio, undefined);
  });

  it('ratio clamps to [0,1] when used exceeds window', () => {
    const b = buildContextUsageBreakdown({
      baseline: { used: 300_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 },
      contextWindow: 200_000,
    });
    assert.equal(b.ratio, 1);
    assert.equal(b.remainingTokens, 0);
  });
});

describe('formatTokensCompact', () => {
  it('formats compactly', () => {
    assert.equal(formatTokensCompact(999), '999');
    assert.equal(formatTokensCompact(1000), '1K');
    assert.equal(formatTokensCompact(10_000), '10K');
    assert.equal(formatTokensCompact(23_900), '23.9K');
    assert.equal(formatTokensCompact(91_500), '91.5K');
    assert.equal(formatTokensCompact(1_000_000), '1000K');
  });
});

describe('formatContextPercent', () => {
  it('keeps 1 decimal below 10%, 0 decimals otherwise', () => {
    assert.equal(formatContextPercent(0.033), '3.3%');
    assert.equal(formatContextPercent(0.05), '5.0%');
    assert.equal(formatContextPercent(0.51), '51%');
    assert.equal(formatContextPercent(0.62), '62%');
    assert.equal(formatContextPercent(1), '100%');
  });
});

/**
 * Locks computeAllocations: denominator selection, allocation, tail-trim, and
 * the mini-bar 1-cell floor. Spec §5.5.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAllocations } from '../../lib/context-dot-allocations';
import {
  CONTEXT_BREAKDOWN_KIND_ORDER,
  DEFAULT_LABELS,
  type ContextUsageBreakdown,
  type ContextBreakdownKind,
} from '../../lib/context-breakdown';

function mb(opts: {
  used: number;
  window?: number;
  tokens?: Partial<Record<ContextBreakdownKind, number>>;
}): ContextUsageBreakdown {
  const tokens = opts.tokens ?? {};
  return {
    usedTokens: opts.used,
    contextWindow: opts.window,
    remainingTokens: opts.window ? Math.max(0, opts.window - opts.used) : undefined,
    ratio: opts.window ? Math.min(1, opts.used / opts.window) : undefined,
    parts: CONTEXT_BREAKDOWN_KIND_ORDER.map((kind) => ({
      kind,
      label: DEFAULT_LABELS[kind],
      tokens: tokens[kind] ?? 0,
      source: '',
    })),
  };
}

describe('computeAllocations — denominator', () => {
  it('uses the known window: 50k+50k of 200k over 100 cells → 25+25, 50 empty', () => {
    const r = computeAllocations(
      mb({ used: 100_000, window: 200_000, tokens: { conversation: 50_000, cache_or_previous: 50_000 } }),
      100,
      1,
    );
    const conv = r.cells.find((c) => c.kind === 'conversation')!;
    const cache = r.cells.find((c) => c.kind === 'cache_or_previous')!;
    assert.equal(conv.cells, 25);
    assert.equal(cache.cells, 25);
    assert.equal(r.emptyCells, 50);
  });

  it('returns all-empty when window unknown, used 0, minCells 1 (denominator 0)', () => {
    const r = computeAllocations(mb({ used: 0 }), 100, 1);
    assert.deepEqual(r.cells, []);
    assert.equal(r.emptyCells, 100);
  });
});

describe('computeAllocations — minCells=1 floor', () => {
  it('gives a tiny kind at least 1 cell', () => {
    const r = computeAllocations(
      mb({ used: 100, window: 200_000, tokens: { conversation: 100 } }),
      100,
      1,
    );
    assert.equal(r.cells.find((c) => c.kind === 'conversation')!.cells, 1);
    assert.equal(r.emptyCells, 99);
  });
});

describe('computeAllocations — tail trim', () => {
  it('trims overflow from the tail so total never exceeds cellCount', () => {
    const r = computeAllocations(
      mb({ used: 200_000, window: 200_000, tokens: { conversation: 190_000, cache_or_previous: 190_000 } }),
      100,
      1,
    );
    const total = r.cells.reduce((s, c) => s + c.cells, 0);
    assert.equal(total, 100);
    assert.equal(r.emptyCells, 0);
    // tail (cache) absorbs the trim; head (conversation) keeps its 95
    assert.equal(r.cells.find((c) => c.kind === 'conversation')!.cells, 95);
    assert.equal(r.cells.find((c) => c.kind === 'cache_or_previous')!.cells, 5);
  });
});

describe('computeAllocations — mini-bar floor', () => {
  it('lights the largest kind with 1 cell when everything rounds to 0 but used>0', () => {
    const r = computeAllocations(
      mb({ used: 3_000, tokens: { conversation: 3_000 } }), // window unknown
      10,
      0,
    );
    assert.equal(r.cells.length, 1);
    assert.equal(r.cells[0].kind, 'conversation');
    assert.equal(r.cells[0].cells, 1);
    assert.equal(r.emptyCells, 9);
  });

  it('mini bar with no usage stays empty (no floor)', () => {
    const r = computeAllocations(mb({ used: 0 }), 10, 0);
    assert.deepEqual(r.cells, []);
    assert.equal(r.emptyCells, 10);
  });
});

describe('computeAllocations — pending after non-pending', () => {
  it('pending kinds are allocated in the second pass (dashed)', () => {
    const r = computeAllocations(
      mb({ used: 100_000, window: 200_000, tokens: { conversation: 100_000, files_attachments: 20_000 } }),
      100,
      1,
    );
    const conv = r.cells.findIndex((c) => c.kind === 'conversation');
    const files = r.cells.findIndex((c) => c.kind === 'files_attachments');
    assert.ok(conv < files, 'non-pending comes before pending');
    assert.equal(r.cells.find((c) => c.kind === 'files_attachments')!.isPending, true);
  });
});

/**
 * Unit tests for src/lib/usage.ts — used-percentage computation + level bucketing.
 *
 * Run with: npx tsx --test src/__tests__/unit/usage.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { usedPercent, levelOf } from '../../lib/usage';

describe('usedPercent', () => {
  it('computes used/renewal, rounded to an integer', () => {
    assert.equal(usedPercent({ renewal: 10000000, remaining: 9998500, used: 1500 }), 0); // 0.015% → 0
    assert.equal(usedPercent({ renewal: 1000, remaining: 250, used: 750 }), 75);
    assert.equal(usedPercent({ renewal: 1000, remaining: 0, used: 1000 }), 100);
    assert.equal(usedPercent({ renewal: 3, remaining: 1, used: 2 }), 67); // 66.6… → 67
  });

  it('renewal <= 0 or missing quota → 0 (no quota)', () => {
    assert.equal(usedPercent({ renewal: 0, remaining: 0, used: 0 }), 0);
    assert.equal(usedPercent(null), 0);
    assert.equal(usedPercent(undefined), 0);
  });

  it('falls back to renewal - remaining when used is missing/NaN', () => {
    assert.equal(usedPercent({ renewal: 1000, remaining: 400, used: NaN as unknown as number }), 60);
  });

  it('clamps to 0..100', () => {
    assert.equal(usedPercent({ renewal: 1000, remaining: -500, used: 1500 }), 100);
    assert.equal(usedPercent({ renewal: 1000, remaining: 1200, used: -200 }), 0);
  });
});

describe('levelOf', () => {
  it('buckets by thresholds (75 warning, 90 danger)', () => {
    assert.equal(levelOf(0), 'normal');
    assert.equal(levelOf(74), 'normal');
    assert.equal(levelOf(75), 'warning');
    assert.equal(levelOf(89), 'warning');
    assert.equal(levelOf(90), 'danger');
    assert.equal(levelOf(100), 'danger');
  });
});

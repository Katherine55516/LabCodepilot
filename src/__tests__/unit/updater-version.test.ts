/**
 * Unit tests for electron/updater/version.ts — dotted-version comparison.
 *
 * Pure module, no electron / fs dependencies, can be imported directly.
 *
 * Run with: npx tsx --test src/__tests__/unit/updater-version.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseVersion, compareVersions, isNewerVersion } from '../../../electron/updater/version';

describe('parseVersion', () => {
  it('parses dotted numbers', () => {
    assert.deepEqual(parseVersion('1.5.10'), [1, 5, 10]);
  });

  it('strips a leading v', () => {
    assert.deepEqual(parseVersion('v0.55.1'), [0, 55, 1]);
  });

  it('treats non-numeric segments as 0', () => {
    assert.deepEqual(parseVersion('1.x.3'), [1, 0, 3]);
  });

  it('handles empty / nullish input', () => {
    assert.deepEqual(parseVersion(''), [0]);
    // @ts-expect-error — defensive against undefined at runtime
    assert.deepEqual(parseVersion(undefined), [0]);
  });
});

describe('compareVersions', () => {
  it('returns 1 when a > b', () => {
    assert.equal(compareVersions('1.5.1', '1.5.0'), 1);
    assert.equal(compareVersions('1.6.0', '1.5.99'), 1);
    assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  });

  it('returns -1 when a < b', () => {
    assert.equal(compareVersions('1.5.0', '1.5.1'), -1);
    assert.equal(compareVersions('0.55.0', '0.55.1'), -1);
  });

  it('returns 0 when equal', () => {
    assert.equal(compareVersions('1.5.1', '1.5.1'), 0);
    assert.equal(compareVersions('v1.5.1', '1.5.1'), 0);
  });

  it('treats missing trailing segments as 0', () => {
    assert.equal(compareVersions('1.5', '1.5.0'), 0);
    assert.equal(compareVersions('1.5.1', '1.5'), 1);
  });

  it('compares numerically, not lexically (10 > 9)', () => {
    assert.equal(compareVersions('1.5.10', '1.5.9'), 1);
  });
});

describe('isNewerVersion', () => {
  it('true only when candidate is strictly newer', () => {
    assert.equal(isNewerVersion('1.5.1', '1.5.0'), true);
    assert.equal(isNewerVersion('1.5.0', '1.5.0'), false);
    assert.equal(isNewerVersion('1.5.0', '1.5.1'), false);
  });

  it('guards pending-reuse against downgrade (older pending → false)', () => {
    // pending version must be NEWER than the currently-installed app version
    assert.equal(isNewerVersion('0.55.0', '0.55.1'), false);
    assert.equal(isNewerVersion('0.55.2', '0.55.1'), true);
  });

  it('does not offer an update when the hosted release is older or equal (update-checker downgrade guard)', () => {
    // Repro: a local/manual install is ahead of the version the platform
    // currently hosts. checkForUpdates() in electron/updater/index.ts gates the
    // "available" prompt on isNewerVersion(latest, app.getVersion()), so these
    // must be false — no prompt, and certainly no forced "must upgrade".
    assert.equal(isNewerVersion('2.1.0', '2.2.0'), false); // hosted older than installed
    assert.equal(isNewerVersion('2.2.0', '2.2.0'), false); // hosted equal to installed
    assert.equal(isNewerVersion('2.3.0', '2.2.0'), true);  // genuine upgrade still offered
  });
});

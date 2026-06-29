/**
 * Tests for 测试工作台 project dedupe helpers (src/lib/projectDedupe.ts).
 *
 * Locks the two behaviors the feature relies on:
 *  - normalizeProjectPath: path is the project's unique key (trailing-slash insensitive).
 *  - dedupeProjectsByPath: same path keeps the card with the most tasks, ties keep the
 *    first occurrence, first-occurrence order is preserved. Used to clean up legacy
 *    duplicates on load (early builds had no add-time guard).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectPath, dedupeProjectsByPath } from '@/lib/projectDedupe';

type P = { name: string; path: string; tasks: { id: string; name: string }[] };
const task = (id: string): { id: string; name: string } => ({ id, name: id });
const proj = (path: string, taskCount: number, name = path): P => ({
  name,
  path,
  tasks: Array.from({ length: taskCount }, (_, i) => task(`${path}#${i}`)),
});

describe('normalizeProjectPath', () => {
  it('leaves a clean absolute path unchanged', () => {
    assert.equal(normalizeProjectPath('/Users/a/mealAllowance'), '/Users/a/mealAllowance');
  });

  it('strips a single trailing slash', () => {
    assert.equal(normalizeProjectPath('/Users/a/mealAllowance/'), '/Users/a/mealAllowance');
  });

  it('strips multiple trailing slashes and backslashes', () => {
    assert.equal(normalizeProjectPath('/Users/a/mealAllowance///'), '/Users/a/mealAllowance');
    assert.equal(normalizeProjectPath('C:\\proj\\mealAllowance\\\\'), 'C:\\proj\\mealAllowance');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(normalizeProjectPath('  /Users/a/x  '), '/Users/a/x');
  });

  it('does not collapse a bare root path to empty', () => {
    assert.equal(normalizeProjectPath('/'), '/');
  });

  it('is case-sensitive (no folding — avoids merging distinct paths on case-sensitive FS)', () => {
    assert.notEqual(normalizeProjectPath('/Users/A/x'), normalizeProjectPath('/users/a/x'));
  });
});

describe('dedupeProjectsByPath', () => {
  it('returns an empty array unchanged', () => {
    assert.deepEqual(dedupeProjectsByPath([]), []);
  });

  it('keeps distinct paths untouched and preserves order', () => {
    const input = [proj('/p/a', 1), proj('/p/b', 0), proj('/p/c', 3)];
    const out = dedupeProjectsByPath(input);
    assert.deepEqual(out.map((p) => p.path), ['/p/a', '/p/b', '/p/c']);
  });

  it('collapses same-path duplicates to one card', () => {
    const out = dedupeProjectsByPath([proj('/p/meal', 4), proj('/p/meal', 0)]);
    assert.equal(out.length, 1);
  });

  it('keeps the duplicate with the most tasks (regardless of order)', () => {
    const richFirst = dedupeProjectsByPath([proj('/p/meal', 4), proj('/p/meal', 0)]);
    assert.equal(richFirst[0].tasks.length, 4);
    const richSecond = dedupeProjectsByPath([proj('/p/meal', 0), proj('/p/meal', 4)]);
    assert.equal(richSecond[0].tasks.length, 4);
  });

  it('keeps the first occurrence on a task-count tie', () => {
    const a = proj('/p/meal', 2, 'first');
    const b = proj('/p/meal', 2, 'second');
    const out = dedupeProjectsByPath([a, b]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'first');
  });

  it('treats trailing-slash variants as the same path', () => {
    const out = dedupeProjectsByPath([proj('/p/meal', 1), proj('/p/meal/', 0)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].tasks.length, 1);
  });

  it('preserves first-occurrence order when a later entry wins on task count', () => {
    const out = dedupeProjectsByPath([
      proj('/p/a', 0),
      proj('/p/b', 1),
      proj('/p/a', 5),
    ]);
    assert.deepEqual(out.map((p) => p.path), ['/p/a', '/p/b']);
    assert.equal(out[0].tasks.length, 5);
  });

  it('does not throw when tasks is missing (defensive against malformed persisted data)', () => {
    const malformed = [{ name: 'x', path: '/p/x' }, { name: 'x', path: '/p/x', tasks: [task('t')] }] as unknown as P[];
    const out = dedupeProjectsByPath(malformed);
    assert.equal(out.length, 1);
    assert.equal(out[0].tasks?.length, 1);
  });
});

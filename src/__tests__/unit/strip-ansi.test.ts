/**
 * Tests for stripAnsi — removing terminal escape codes from command output.
 * ESC is built with String.fromCharCode(27) so the test source has no literal
 * control characters.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi } from '../../lib/strip-ansi';

const ESC = String.fromCharCode(27);

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    assert.equal(stripAnsi(ESC + '[90m灰色' + ESC + '[39m'), '灰色');
    assert.equal(stripAnsi(ESC + '[32m✓' + ESC + '[0m ok'), '✓ ok');
  });

  it('removes dim/bold/reset codes (the skill-install case)', () => {
    const raw =
      ESC + '[90m│' + ESC + '[39m ' +
      ESC + '[2m' + ESC + '[32m✓' + ESC + '[39m template-skill ' +
      ESC + '[2m(copied)' + ESC + '[22m';
    assert.equal(stripAnsi(raw), '│ ✓ template-skill (copied)');
  });

  it('removes cursor / erase codes', () => {
    assert.equal(stripAnsi('a' + ESC + '[2Kb' + ESC + '[1Gc'), 'abc');
  });

  it('leaves plain text and literal brackets untouched', () => {
    assert.equal(stripAnsi('no ansi here'), 'no ansi here');
    assert.equal(stripAnsi('Done! Review skills before use.'), 'Done! Review skills before use.');
    assert.equal(stripAnsi('- [x] task done'), '- [x] task done');
  });

  it('handles empty input', () => {
    assert.equal(stripAnsi(''), '');
  });
});

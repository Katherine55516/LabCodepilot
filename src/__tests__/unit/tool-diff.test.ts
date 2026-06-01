/**
 * Tests for the line-level diff behind the Edit/Write tool-row diff view.
 * Pure (no React/DOM) so they run under `tsx --test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineDiff, toolDiff } from '../../lib/tool-diff';

describe('computeLineDiff', () => {
  it('treats an empty old side as all additions (Write / new file)', () => {
    const d = computeLineDiff('', 'a\nb\nc');
    assert.equal(d.added, 3);
    assert.equal(d.removed, 0);
    assert.deepEqual(d.lines.map(l => l.type), ['add', 'add', 'add']);
  });

  it('treats an empty new side as all removals', () => {
    const d = computeLineDiff('a\nb', '');
    assert.equal(d.added, 0);
    assert.equal(d.removed, 2);
    assert.deepEqual(d.lines.map(l => l.type), ['remove', 'remove']);
  });

  it('keeps unchanged lines as context, marks a single changed line', () => {
    const d = computeLineDiff('a\nb\nc', 'a\nX\nc');
    assert.equal(d.added, 1);
    assert.equal(d.removed, 1);
    assert.deepEqual(d.lines.map(l => l.type), ['context', 'remove', 'add', 'context']);
    assert.equal(d.lines.find(l => l.type === 'add')?.text, 'X');
    assert.equal(d.lines.find(l => l.type === 'remove')?.text, 'b');
  });

  it('reports zero changes for identical text', () => {
    const d = computeLineDiff('a\nb', 'a\nb');
    assert.equal(d.added, 0);
    assert.equal(d.removed, 0);
    assert.ok(d.lines.every(l => l.type === 'context'));
  });

  it('handles a multi-line insertion within shared context', () => {
    const d = computeLineDiff('start\nend', 'start\nmid1\nmid2\nend');
    assert.equal(d.added, 2);
    assert.equal(d.removed, 0);
    assert.deepEqual(d.lines.map(l => l.type), ['context', 'add', 'add', 'context']);
  });
});

describe('toolDiff', () => {
  it('extracts an Edit diff from old_string / new_string', () => {
    const d = toolDiff('Edit', { file_path: '/a.ts', old_string: 'foo\nbar', new_string: 'foo\nbaz' });
    assert.ok(d);
    assert.equal(d!.added, 1);
    assert.equal(d!.removed, 1);
  });

  it('treats Write content as all additions', () => {
    const d = toolDiff('Write', { file_path: '/a.ts', content: 'x\ny\nz' });
    assert.ok(d);
    assert.equal(d!.added, 3);
    assert.equal(d!.removed, 0);
  });

  it('merges a MultiEdit edit list', () => {
    const d = toolDiff('MultiEdit', { edits: [
      { old_string: 'a', new_string: 'b' },
      { old_string: 'c', new_string: 'd' },
    ] });
    assert.ok(d);
    assert.equal(d!.added, 2);
    assert.equal(d!.removed, 2);
  });

  it('returns null for non-edit tools', () => {
    assert.equal(toolDiff('Read', { file_path: '/a.ts' }), null);
    assert.equal(toolDiff('Bash', { command: 'ls' }), null);
  });

  it('returns null when edit fields are missing or input is not an object', () => {
    assert.equal(toolDiff('Edit', { file_path: '/a.ts' }), null);
    assert.equal(toolDiff('Edit', null), null);
    assert.equal(toolDiff('Write', { file_path: '/a.ts' }), null);
  });
});

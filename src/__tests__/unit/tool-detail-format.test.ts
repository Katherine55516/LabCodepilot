/**
 * Tests for formatToolInput / truncateToolResult — the pure helpers behind the
 * expandable tool-row detail (input params + clipped result). Kept React/DOM
 * free so they run under `tsx --test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatToolInput, truncateToolResult } from '../../lib/message-segments';

describe('formatToolInput', () => {
  it('pretty-prints an object as JSON', () => {
    const out = formatToolInput({ file_path: '/a.ts', limit: 10 });
    assert.match(out, /"file_path": "\/a\.ts"/);
    assert.match(out, /"limit": 10/);
  });

  it('returns empty string for null / undefined / empty object', () => {
    assert.equal(formatToolInput(null), '');
    assert.equal(formatToolInput(undefined), '');
    assert.equal(formatToolInput({}), '');
  });

  it('passes primitives through as a string', () => {
    assert.equal(formatToolInput('hello'), 'hello');
    assert.equal(formatToolInput(42), '42');
  });

  it('caps overly long input and marks the clip', () => {
    const big = { s: 'x'.repeat(5000) };
    const out = formatToolInput(big, 200);
    assert.ok(out.length <= 202); // 200 + '\n…'
    assert.ok(out.endsWith('…'));
  });
});

describe('truncateToolResult', () => {
  it('returns text unchanged when within limits', () => {
    const r = truncateToolResult('line1\nline2');
    assert.equal(r.text, 'line1\nline2');
    assert.equal(r.truncated, false);
    assert.equal(r.hiddenLines, 0);
  });

  it('clips by line count and reports hidden lines', () => {
    const text = Array.from({ length: 50 }, (_, i) => `L${i}`).join('\n');
    const r = truncateToolResult(text, 10);
    assert.equal(r.truncated, true);
    assert.equal(r.text.split('\n').length, 10);
    assert.equal(r.hiddenLines, 40);
  });

  it('clips by char count as a safety net (mid-line → no hidden line count)', () => {
    const text = 'x'.repeat(20000); // single line, no newlines
    const r = truncateToolResult(text, 200, 8000);
    assert.equal(r.truncated, true);
    assert.equal(r.text.length, 8000);
    assert.equal(r.hiddenLines, 0);
  });

  it('handles empty string', () => {
    const r = truncateToolResult('');
    assert.equal(r.text, '');
    assert.equal(r.truncated, false);
    assert.equal(r.hiddenLines, 0);
  });
});

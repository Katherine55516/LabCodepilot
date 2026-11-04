/**
 * Tests for segmentsFromBlocks — the ordered text/tool/thinking interleaving
 * that drives the conversation flow. The core guarantee: blocks render in
 * their array order (true chronological order), and each tool_use is paired
 * with its tool_result by id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { segmentsFromBlocks } from '../../lib/message-segments';

describe('segmentsFromBlocks — interleaving order', () => {
  it('preserves text → tool → text order (the core interleave)', () => {
    const segs = segmentsFromBlocks([
      { type: 'text', text: 'Let me read the file.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'file contents' },
      { type: 'text', text: 'Now I understand. Editing.' },
      { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/a.ts' } },
      { type: 'tool_result', tool_use_id: 't2', content: 'ok' },
      { type: 'text', text: 'Done.' },
    ]);
    assert.deepEqual(
      segs.map(s => s.kind),
      ['text', 'tool', 'text', 'tool', 'text'],
    );
    // tool segments carry their paired result
    const tools = segs.filter(s => s.kind === 'tool');
    assert.equal(tools.length, 2);
    assert.equal((tools[0] as { result?: string }).result, 'file contents');
    assert.equal((tools[1] as { name: string }).name, 'Edit');
    assert.equal((segs[0] as { text: string }).text, 'Let me read the file.');
    assert.equal((segs[4] as { text: string }).text, 'Done.');
  });

  it('pairs tool_use with tool_result by id even when results arrive out of order (parallel tools)', () => {
    const segs = segmentsFromBlocks([
      { type: 'tool_use', id: 'a', name: 'Read', input: {} },
      { type: 'tool_use', id: 'b', name: 'Read', input: {} },
      { type: 'tool_result', tool_use_id: 'b', content: 'B done' },
      { type: 'tool_result', tool_use_id: 'a', content: 'A done', is_error: true },
    ]);
    // Two tool segments at the tool_use positions, results matched by id.
    assert.deepEqual(segs.map(s => s.kind), ['tool', 'tool']);
    const a = segs[0] as { id: string; result?: string; isError?: boolean };
    const b = segs[1] as { id: string; result?: string };
    assert.equal(a.id, 'a');
    assert.equal(a.result, 'A done');
    assert.equal(a.isError, true);
    assert.equal(b.id, 'b');
    assert.equal(b.result, 'B done');
  });

  it('keeps thinking blocks in order (multiple phases interleaved with tools)', () => {
    const segs = segmentsFromBlocks([
      { type: 'thinking', thinking: 'First I should check X.' },
      { type: 'text', text: 'Checking X.' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'a b c' },
      { type: 'thinking', thinking: 'Now reconsider given X.' },
      { type: 'text', text: 'Here is the answer.' },
    ]);
    assert.deepEqual(
      segs.map(s => s.kind),
      ['thinking', 'text', 'tool', 'thinking', 'text'],
    );
    assert.equal((segs[0] as { thinking: string }).thinking, 'First I should check X.');
    assert.equal((segs[3] as { thinking: string }).thinking, 'Now reconsider given X.');
  });

  it('renders a tool_use with no result yet (running tool) — result undefined', () => {
    const segs = segmentsFromBlocks([
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 5' } },
    ]);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].kind, 'tool');
    assert.equal((segs[0] as { result?: string }).result, undefined);
  });

  it('renders an orphan tool_result (no matching tool_use) as a bare tool row', () => {
    const segs = segmentsFromBlocks([
      { type: 'tool_result', tool_use_id: 'ghost', content: 'orphan output' },
    ]);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].kind, 'tool');
    assert.equal((segs[0] as { result?: string }).result, 'orphan output');
  });

  it('carries media from tool_result onto the paired tool segment', () => {
    const media = [{ type: 'image' as const, mimeType: 'image/png', localPath: '/x.png' }];
    const segs = segmentsFromBlocks([
      { type: 'tool_use', id: 't1', name: 'generate_image', input: {} },
      { type: 'tool_result', tool_use_id: 't1', content: 'done', media },
    ]);
    assert.deepEqual((segs[0] as { media?: unknown }).media, media);
  });

  it('skips empty text blocks and unknown code blocks', () => {
    const segs = segmentsFromBlocks([
      { type: 'text', text: '' },
      { type: 'code', text: 'irrelevant' } as never,
      { type: 'text', text: 'real' },
    ]);
    assert.deepEqual(segs.map(s => s.kind), ['text']);
    assert.equal((segs[0] as { text: string }).text, 'real');
  });

  it('empty input → empty segments', () => {
    assert.deepEqual(segmentsFromBlocks([]), []);
  });
});

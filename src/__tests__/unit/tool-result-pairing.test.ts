import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeOrphanToolUses } from '../../lib/tool-result-pairing';
import type { MessageContentBlock } from '../../types';

/**
 * Regression coverage for the generative-UI tool bugs:
 *  - An orphan tool_use (a tool call whose result never arrived — permission
 *    hang, abort, timeout) must get a synthetic error tool_result, otherwise the
 *    next turn's history replay throws AI_MissingToolResultsError in the AI SDK.
 */

type ToolResultBlock = Extract<MessageContentBlock, { type: 'tool_result' }>;
const isToolResult = (b: MessageContentBlock): b is ToolResultBlock => b.type === 'tool_result';

/** Narrow a (possibly undefined) block to a tool_result, failing the test otherwise. */
function expectToolResult(b: MessageContentBlock | undefined): ToolResultBlock {
  if (!b || b.type !== 'tool_result') {
    return assert.fail(`expected a tool_result block, got ${b?.type ?? 'undefined'}`);
  }
  return b;
}

describe('sanitizeOrphanToolUses', () => {
  it('appends a synthetic error result for an orphan tool_use', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'let me pin that' },
      { type: 'tool_use', id: 'toolu_1', name: 'codepilot_dashboard_pin', input: {} },
    ];
    const out = sanitizeOrphanToolUses(blocks);
    assert.equal(out.length, 3);
    const result = expectToolResult(out[2]);
    assert.equal(result.tool_use_id, 'toolu_1');
    assert.equal(result.is_error, true);
    assert.ok(result.content.length > 0);
  });

  it('inserts the result immediately after the orphan tool_use (pairing adjacency)', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'tool_use', id: 'a', name: 't', input: {} },
      { type: 'text', text: 'after' },
    ];
    const out = sanitizeOrphanToolUses(blocks);
    assert.equal(out[0].type, 'tool_use');
    const r = expectToolResult(out[1]);
    assert.equal(r.tool_use_id, 'a');
    assert.equal(out[2].type, 'text');
  });

  it('leaves already-paired tool_use untouched (fast path returns same reference)', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'tool_use', id: 'toolu_1', name: 't', input: {} },
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
    ];
    const out = sanitizeOrphanToolUses(blocks);
    assert.equal(out, blocks); // unchanged reference — no allocation
    assert.equal(out.length, 2);
  });

  it('heals multiple orphans, pairing each by id', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'tool_use', id: '1', name: 't', input: {} },
      { type: 'tool_use', id: '2', name: 't', input: {} },
      { type: 'tool_use', id: '3', name: 't', input: {} },
    ];
    const out = sanitizeOrphanToolUses(blocks);
    const resultIds = out.filter(isToolResult).map(b => b.tool_use_id).sort();
    assert.deepEqual(resultIds, ['1', '2', '3']);
    const resultSet = new Set(resultIds);
    for (const b of out) {
      if (b.type === 'tool_use') {
        assert.ok(resultSet.has(b.id));
      }
    }
  });

  it('heals only the orphan when some tool_use are paired and some not', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'tool_use', id: 'paired', name: 't', input: {} },
      { type: 'tool_result', tool_use_id: 'paired', content: 'ok' },
      { type: 'tool_use', id: 'orphan', name: 't', input: {} },
    ];
    const out = sanitizeOrphanToolUses(blocks);
    assert.equal(out.length, 4);
    const orphanResult = expectToolResult(out.find(b => b.type === 'tool_result' && b.tool_use_id === 'orphan'));
    assert.equal(orphanResult.is_error, true);
    const pairedResult = expectToolResult(out.find(b => b.type === 'tool_result' && b.tool_use_id === 'paired'));
    assert.equal(pairedResult.content, 'ok');
    assert.notEqual(pairedResult.is_error, true);
  });

  it('is a no-op for blocks without any tool_use', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'hmm' },
    ];
    assert.equal(sanitizeOrphanToolUses(blocks), blocks);
  });

  it('is a no-op for an empty array', () => {
    const blocks: MessageContentBlock[] = [];
    assert.equal(sanitizeOrphanToolUses(blocks), blocks);
  });
});

/**
 * Unit tests for error-classifier upstream-message extraction.
 *
 * When the upstream gateway returns a human-readable `message` (e.g. quota
 * exceeded), classifyError surfaces it directly instead of the generic
 * category copy. request id is stripped from the UI copy.
 *
 * Run with: npx tsx --test src/__tests__/unit/error-classifier-upstream.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractUpstreamMessage, classifyError } from '../../lib/error-classifier';

const REAL_403 =
  'Failed to authenticate. API Error: 403 {"error":{"type":"new_api_error","message":"用户高阶模型额度不足, 剩余: ¥-0.024640 (request id: 202606040733295960784358268d9d6tgLhzrkp)"},"type":"error"}';

describe('extractUpstreamMessage', () => {
  it('extracts error.message and strips request id (real 403 quota error)', () => {
    assert.equal(extractUpstreamMessage(REAL_403), '用户高阶模型额度不足, 剩余: ¥-0.024640');
  });

  it('extracts a top-level message', () => {
    assert.equal(extractUpstreamMessage('oops {"message":"服务暂时不可用"}'), '服务暂时不可用');
  });

  it('prefers error.message over top-level message', () => {
    assert.equal(extractUpstreamMessage('{"message":"outer","error":{"message":"inner"}}'), 'inner');
  });

  it('strips trailing (request id: …)', () => {
    assert.equal(extractUpstreamMessage('{"message":"额度不足 (request id: abc-123)"}'), '额度不足');
    assert.equal(extractUpstreamMessage('{"error":{"message":"x (request id: 9f2c)"}}'), 'x');
  });

  it('regex fallback when JSON is truncated/unparseable', () => {
    const truncated = 'API Error: 403 {"error":{"message":"额度不足, 剩余 ¥-0.02"';
    assert.equal(extractUpstreamMessage(truncated), '额度不足, 剩余 ¥-0.02');
  });

  it('handles escaped characters', () => {
    assert.equal(extractUpstreamMessage('{"message":"line1\\nline2 \\"q\\""}'), 'line1\nline2 "q"');
  });

  it('returns null when no JSON / no message', () => {
    assert.equal(extractUpstreamMessage('plain text 403 Forbidden'), null);
    assert.equal(extractUpstreamMessage('{"error":{"type":"forbidden"}}'), null);
    assert.equal(extractUpstreamMessage('{}'), null);
    assert.equal(extractUpstreamMessage(''), null);
  });

  it('returns null when message is blank / only a request id', () => {
    assert.equal(extractUpstreamMessage('{"message":"   "}'), null);
    assert.equal(extractUpstreamMessage('{"message":"(request id: x)"}'), null);
  });
});

describe('classifyError prefers upstream message', () => {
  it('403 quota error → userMessage = message, clears actionHint/recoveryActions, keeps category', () => {
    const r = classifyError({ error: new Error(REAL_403), providerName: '高阶模型-C47' });
    assert.equal(r.userMessage, '用户高阶模型额度不足, 剩余: ¥-0.024640');
    assert.equal(r.actionHint, '');
    assert.deepEqual(r.recoveryActions, []);
    assert.equal(r.category, 'AUTH_FORBIDDEN'); // classification unchanged
    assert.ok(r.rawMessage.includes('request id'), 'full raw error preserved for diagnostics');
  });

  it('403 without an upstream message → falls back to generic copy', () => {
    const r = classifyError({ error: new Error('API Error: 403 Forbidden'), providerName: 'X' });
    assert.match(r.userMessage, /Access denied/);
    assert.notEqual(r.actionHint, '');
    assert.equal(r.category, 'AUTH_FORBIDDEN');
  });

  it('upstream message inside stderr is also picked up', () => {
    const r = classifyError({
      error: new Error('Process exited with code 1'),
      stderr: '{"error":{"message":"额度不足"}}',
    });
    assert.equal(r.userMessage, '额度不足');
  });
});

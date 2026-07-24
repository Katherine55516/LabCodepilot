/**
 * Unit tests for the STREAM_DISCONNECTED classification.
 *
 * Claude Code CLI surfaces upstream/gateway stream drops as
 * "API Error: Connection closed mid-response. The response above may be
 * incomplete." — observed 2026-07-11 with managed-gateway models
 * (Qwen3.7-Plus) during 测试工作台 execution/report steps. Before this
 * category the message fell through to UNKNOWN and testers only saw
 * "An unexpected error occurred (Provider: X)".
 *
 * Run with: npx tsx --test src/__tests__/unit/error-classifier-stream-disconnect.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../../lib/error-classifier';

// Verbatim SDK wrapper message from the packaged app's main.log (2026-07-11).
const REAL_MID_RESPONSE =
  'Claude Code returned an error result: API Error: Connection closed mid-response. The response above may be incomplete.';

describe('STREAM_DISCONNECTED classification', () => {
  it('classifies the real mid-response drop with provider name and retryable', () => {
    const r = classifyError({
      error: new Error(REAL_MID_RESPONSE),
      providerName: 'Qwen3.7-Plus',
    });
    assert.equal(r.category, 'STREAM_DISCONNECTED');
    assert.equal(r.retryable, true);
    assert.ok(r.userMessage.includes('Qwen3.7-Plus'), 'provider name should appear in the message');
    assert.ok(r.userMessage.includes('中途'), 'message should be the Chinese mid-stream copy');
    assert.ok(
      (r.recoveryActions ?? []).some((a) => a.action === 'retry'),
      'should offer a retry recovery action',
    );
  });

  it('classifies without provider name (no suffix, no crash)', () => {
    const r = classifyError({ error: new Error(REAL_MID_RESPONSE) });
    assert.equal(r.category, 'STREAM_DISCONNECTED');
    assert.ok(!r.userMessage.includes('（'), 'no provider suffix without providerName');
  });

  it('matches the CLI binary phrase variants (mid-call / dropped mid-request)', () => {
    for (const msg of [
      'API Error: connection closed mid-call',
      'stream failed: connection dropped mid-request',
    ]) {
      const r = classifyError({ error: new Error(msg) });
      assert.equal(r.category, 'STREAM_DISCONNECTED', `should match: ${msg}`);
    }
  });

  it('matches when the phrase arrives via stderr instead of message', () => {
    const r = classifyError({
      error: new Error('process failed'),
      stderr: 'API Error: Connection closed mid-response. The response above may be incomplete.',
    });
    assert.equal(r.category, 'STREAM_DISCONNECTED');
  });

  it('does not swallow unrelated errors (UNKNOWN fallback preserved)', () => {
    const r = classifyError({ error: new Error('something completely different went wrong') });
    assert.equal(r.category, 'UNKNOWN');
  });

  it('does not shadow earlier categories (429 still RATE_LIMITED)', () => {
    const r = classifyError({ error: new Error('API Error: 429 too many requests') });
    assert.equal(r.category, 'RATE_LIMITED');
  });
});

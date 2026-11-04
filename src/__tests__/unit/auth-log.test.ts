/**
 * Unit tests for electron/auth/log.ts — token masking helpers.
 *
 * Pure module, no electron / fs dependencies, can be imported directly.
 *
 * Run with: npx tsx --test src/__tests__/unit/auth-log.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { maskToken, maskConfigsForLog } from '../../../electron/auth/log';
import type { ModelConfig } from '../../../electron/auth/types';

describe('maskToken', () => {
  it('shows first 8 chars + ellipsis for long tokens', () => {
    assert.equal(maskToken('anl_sess_abcdefghijklmnopqrstuv'), 'anl_sess...');
  });

  it('shows truncated prefix for short tokens (length <= 8)', () => {
    assert.equal(maskToken('abc'), 'ab...');
    assert.equal(maskToken('12345678'), '12...');
  });

  it('returns "(empty)" for empty / null / undefined input', () => {
    assert.equal(maskToken(''), '(empty)');
    assert.equal(maskToken(null), '(empty)');
    assert.equal(maskToken(undefined), '(empty)');
  });
});

describe('maskConfigsForLog', () => {
  it('strips auth_token and replaces with prefix', () => {
    const configs: ModelConfig[] = [
      {
        id: 'cfg-1',
        name: 'Claude Sonnet',
        description: '',
        base_url: 'https://api.example.com',
        auth_token: 'super-secret-key-1234567890',
        model: 'claude-sonnet-4.7',
        default_opus_model: '',
        default_sonnet_model: '',
        default_haiku_model: '',
        subagent_model: '',
        effort_level: 'medium',
        extra: {},
        sort_order: 0,
      },
    ];
    const masked = maskConfigsForLog(configs);
    const first = masked[0] as Record<string, unknown>;
    assert.equal(first.id, 'cfg-1');
    assert.equal(first.name, 'Claude Sonnet');
    assert.equal(first.model, 'claude-sonnet-4.7');
    assert.equal(first.base_url, 'https://api.example.com');
    assert.equal(first.auth_token_prefix, 'super-se...');
    assert.equal((first as Record<string, unknown>).auth_token, undefined);
  });

  it('handles empty array', () => {
    assert.deepEqual(maskConfigsForLog([]), []);
  });
});

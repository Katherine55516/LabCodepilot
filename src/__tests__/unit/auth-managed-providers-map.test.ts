/**
 * Unit tests for electron/auth/managed-providers.ts:modelConfigToManagedProviderRow.
 *
 * Pure transform — no I/O. Verifies that the four "default_*_model" fields
 * land in role_models_json and the runtime knobs (subagent_model,
 * effort_level) land in env_overrides_json. Both mappings are load-bearing
 * for provider-resolver's env injection.
 *
 * Run with: npx tsx --test src/__tests__/unit/auth-managed-providers-map.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { modelConfigToManagedProviderRow } from '../../../electron/auth/managed-providers';
import type { ModelConfig } from '../../../electron/auth/types';

function fullConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'cfg-uuid-1',
    name: 'Claude Sonnet 4.7',
    description: 'Latest Sonnet for everyday tasks',
    base_url: 'https://api.example.com',
    auth_token: 'secret-key',
    model: 'claude-sonnet-4-7',
    default_opus_model: 'claude-opus-4-7',
    default_sonnet_model: 'claude-sonnet-4-7',
    default_haiku_model: 'claude-haiku-4-5',
    subagent_model: 'claude-haiku-4-5',
    effort_level: 'high',
    extra: { tier: 'pro' },
    sort_order: 2,
    ...overrides,
  };
}

describe('modelConfigToManagedProviderRow', () => {
  it('maps simple fields straight across', () => {
    const row = modelConfigToManagedProviderRow(fullConfig());
    assert.equal(row.id, 'managed-cfg-uuid-1');
    assert.equal(row.name, 'Claude Sonnet 4.7');
    assert.equal(row.provider_type, 'anthropic');
    assert.equal(row.protocol, 'anthropic');
    assert.equal(row.base_url, 'https://api.example.com');
    assert.equal(row.api_key, 'secret-key');
    assert.equal(row.sort_order, 2);
    assert.equal(row.notes, 'Latest Sonnet for everyday tasks');
    assert.equal(row.managed_config_id, 'cfg-uuid-1');
  });

  it('populates role_models_json from default_*_model fields', () => {
    const row = modelConfigToManagedProviderRow(fullConfig());
    const roles = JSON.parse(row.role_models_json || '{}');
    assert.equal(roles.default, 'claude-sonnet-4-7');
    assert.equal(roles.opus, 'claude-opus-4-7');
    assert.equal(roles.sonnet, 'claude-sonnet-4-7');
    assert.equal(roles.haiku, 'claude-haiku-4-5');
  });

  it('puts subagent_model and effort_level in env_overrides_json (NOT role_models)', () => {
    const row = modelConfigToManagedProviderRow(fullConfig());
    const env = JSON.parse(row.env_overrides_json || '{}');
    assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'claude-haiku-4-5');
    assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'high');

    const roles = JSON.parse(row.role_models_json || '{}');
    assert.equal(roles.subagent, undefined);
    assert.equal(roles.small, undefined, 'subagent_model must not bleed into role_models.small');
  });

  it('preserves raw ModelConfig in managed_extra_json for forward-compat', () => {
    const row = modelConfigToManagedProviderRow(fullConfig({ extra: { feature_flag: 'beta' } }));
    const extra = JSON.parse(row.managed_extra_json);
    assert.equal(extra.subagent_model, 'claude-haiku-4-5');
    assert.equal(extra.effort_level, 'high');
    assert.deepEqual(extra.extra, { feature_flag: 'beta' });
    assert.equal(extra.raw.id, 'cfg-uuid-1');
  });

  it('omits empty role/env entries (no stale "" keys)', () => {
    const sparse: ModelConfig = {
      id: 'cfg-2',
      name: 'Minimal',
      description: '',
      base_url: 'https://api.example.com',
      auth_token: 'k',
      model: 'm',
      default_opus_model: '',
      default_sonnet_model: '',
      default_haiku_model: '',
      subagent_model: '',
      effort_level: '',
      extra: {},
      sort_order: 0,
    };
    const row = modelConfigToManagedProviderRow(sparse);
    const roles = JSON.parse(row.role_models_json || '{}');
    const env = JSON.parse(row.env_overrides_json || '{}');
    assert.deepEqual(Object.keys(roles), ['default']);
    assert.deepEqual(env, {});
  });

  it('handles missing sort_order by defaulting to 0', () => {
    const cfg = fullConfig();
    // @ts-expect-error — force-undefined for the defensive branch
    cfg.sort_order = undefined;
    const row = modelConfigToManagedProviderRow(cfg);
    assert.equal(row.sort_order, 0);
  });

  it('id namespace prevents collision with local providers', () => {
    const row = modelConfigToManagedProviderRow(fullConfig({ id: 'abc-123' }));
    assert.match(row.id, /^managed-/);
    assert.equal(row.managed_config_id, 'abc-123');
  });
});

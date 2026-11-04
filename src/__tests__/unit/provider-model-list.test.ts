/**
 * Tests for prependRoleModels() — the role_models_json injection ordering
 * that determines which model the flat picker sends as models[0].value.
 *
 * Regression: a managed provider with role_models
 *   {"default":"gpt-5.5","sonnet":"gpt-5.4","haiku":"gpt-5.4-mini","opus":"gpt-5.5"}
 * must surface `default` (gpt-5.5 = ANTHROPIC_MODEL) at index 0, NOT sonnet.
 * The old per-entry unshift reversed the order and put sonnet first.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prependRoleModels, type RoleModelListEntry } from '../../lib/provider-model-list';

describe('prependRoleModels', () => {
  it('puts default (ANTHROPIC_MODEL) at index 0 for a multi-role managed provider', () => {
    const roleModels = JSON.stringify({
      default: 'gpt-5.5',
      opus: 'gpt-5.5',
      sonnet: 'gpt-5.4',
      haiku: 'gpt-5.4-mini',
    });
    const result = prependRoleModels<RoleModelListEntry>([], roleModels);

    assert.equal(result[0].value, 'gpt-5.5', 'index 0 must be the default model');
    // Full expected order: default, haiku, sonnet (opus deduped vs default).
    assert.deepEqual(result.map(m => m.value), ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4']);
  });

  it('dedupes opus when it equals default — default still at index 0', () => {
    const roleModels = JSON.stringify({ default: 'gpt-5.5', opus: 'gpt-5.5' });
    const result = prependRoleModels<RoleModelListEntry>([], roleModels);
    assert.equal(result[0].value, 'gpt-5.5');
    assert.equal(result.length, 1, 'opus===default collapses to a single entry');
  });

  it('single default role → one entry, unchanged', () => {
    const result = prependRoleModels<RoleModelListEntry>([], JSON.stringify({ default: 'ark-code-latest' }));
    assert.deepEqual(result.map(m => m.value), ['ark-code-latest']);
    // default role uses the bare id as label (no " (role)" suffix)
    assert.equal(result[0].label, 'ark-code-latest');
  });

  it('non-default roles get a " (role)" label suffix', () => {
    const result = prependRoleModels<RoleModelListEntry>([], JSON.stringify({ sonnet: 'gpt-5.4' }));
    assert.equal(result[0].value, 'gpt-5.4');
    assert.equal(result[0].label, 'gpt-5.4 (sonnet)');
  });

  it('skips role models already present in rawModels (by value)', () => {
    const raw: RoleModelListEntry[] = [{ value: 'gpt-5.4', label: 'Existing' }];
    const result = prependRoleModels(raw, JSON.stringify({ default: 'gpt-5.5', sonnet: 'gpt-5.4' }));
    // gpt-5.4 already present → not re-injected; only default prepended
    assert.deepEqual(result.map(m => m.value), ['gpt-5.5', 'gpt-5.4']);
    // The pre-existing entry keeps its original label, not the role-suffixed one
    assert.equal(result.find(m => m.value === 'gpt-5.4')?.label, 'Existing');
  });

  it('skips role models already present in rawModels (by upstreamModelId)', () => {
    const raw: RoleModelListEntry[] = [{ value: 'alias', label: 'Alias', upstreamModelId: 'gpt-5.5' }];
    const result = prependRoleModels(raw, JSON.stringify({ default: 'gpt-5.5' }));
    // default matches an existing upstreamModelId → no injection
    assert.deepEqual(result.map(m => m.value), ['alias']);
  });

  it('preserves rawModels (catalog/db) after the prepended role block', () => {
    const raw: RoleModelListEntry[] = [
      { value: 'catalog-a', label: 'A' },
      { value: 'catalog-b', label: 'B' },
    ];
    const result = prependRoleModels(raw, JSON.stringify({ default: 'gpt-5.5', sonnet: 'gpt-5.4' }));
    assert.deepEqual(result.map(m => m.value), ['gpt-5.5', 'gpt-5.4', 'catalog-a', 'catalog-b']);
  });

  it('empty / missing role_models → rawModels unchanged', () => {
    const raw: RoleModelListEntry[] = [{ value: 'x', label: 'X' }];
    assert.deepEqual(prependRoleModels(raw, '{}'), raw);
    assert.deepEqual(prependRoleModels(raw, ''), raw);
    assert.deepEqual(prependRoleModels(raw, null), raw);
    assert.deepEqual(prependRoleModels(raw, undefined), raw);
  });

  it('malformed JSON → rawModels unchanged (no throw)', () => {
    const raw: RoleModelListEntry[] = [{ value: 'x', label: 'X' }];
    assert.deepEqual(prependRoleModels(raw, '{ not valid'), raw);
  });
});

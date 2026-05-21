/**
 * Unit tests for the managed-provider DB helpers introduced by the login system:
 *   setManagedProviders / getProvidersBySource / purgeManagedProviders.
 *
 * Run with: npx tsx --test src/__tests__/unit/db-managed-providers.test.ts
 */

import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-db-managed-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  getDb,
  closeDb,
  setManagedProviders,
  getProvidersBySource,
  purgeManagedProviders,
  getAllProviders,
  createProvider,
} = require('../../lib/db') as typeof import('../../lib/db');
type ManagedProviderRow = import('../../lib/db').ManagedProviderRow;

before(() => {
  // Force-create DB + run migrations
  getDb();
});

afterEach(() => {
  // Each test starts with a clean api_providers table
  const db = getDb();
  db.prepare('DELETE FROM api_providers').run();
});

function buildRow(overrides: Partial<ManagedProviderRow> = {}): ManagedProviderRow {
  return {
    id: 'managed-cfg-1',
    name: 'Managed Sonnet',
    provider_type: 'anthropic',
    protocol: 'anthropic',
    base_url: 'https://api.example.com',
    api_key: 'secret-1',
    sort_order: 0,
    role_models_json: '{"default":"claude-sonnet-4.7"}',
    options_json: '{"effort_level":"medium"}',
    notes: '',
    managed_config_id: 'cfg-1',
    managed_extra_json: '{"raw":true}',
    ...overrides,
  };
}

describe('setManagedProviders', () => {
  it('inserts new managed rows with source="managed"', () => {
    const result = setManagedProviders([
      buildRow({ id: 'managed-cfg-1', managed_config_id: 'cfg-1', sort_order: 0 }),
      buildRow({ id: 'managed-cfg-2', managed_config_id: 'cfg-2', sort_order: 1, name: 'Managed Opus' }),
    ]);
    assert.equal(result.upserted, 2);
    assert.equal(result.pruned, 0);

    const managed = getProvidersBySource('managed');
    assert.equal(managed.length, 2);
    assert.equal(managed[0].source, 'managed');
    assert.equal(managed[0].managed_config_id, 'cfg-1');
    assert.equal(managed[0].name, 'Managed Sonnet');
    assert.equal(managed[1].name, 'Managed Opus');
  });

  it('updates existing managed row in place (preserves id)', () => {
    setManagedProviders([buildRow({ id: 'managed-cfg-1', name: 'Old Name' })]);
    setManagedProviders([buildRow({ id: 'managed-cfg-1', name: 'New Name', base_url: 'https://new.example.com' })]);
    const managed = getProvidersBySource('managed');
    assert.equal(managed.length, 1);
    assert.equal(managed[0].id, 'managed-cfg-1');
    assert.equal(managed[0].name, 'New Name');
    assert.equal(managed[0].base_url, 'https://new.example.com');
  });

  it('prunes managed rows missing from the new set', () => {
    setManagedProviders([
      buildRow({ id: 'managed-cfg-1', managed_config_id: 'cfg-1' }),
      buildRow({ id: 'managed-cfg-2', managed_config_id: 'cfg-2' }),
      buildRow({ id: 'managed-cfg-3', managed_config_id: 'cfg-3' }),
    ]);
    const result = setManagedProviders([buildRow({ id: 'managed-cfg-2', managed_config_id: 'cfg-2' })]);
    assert.equal(result.upserted, 1);
    assert.equal(result.pruned, 2);

    const managed = getProvidersBySource('managed');
    assert.equal(managed.length, 1);
    assert.equal(managed[0].id, 'managed-cfg-2');
  });

  it('does NOT touch local (BYOK) providers', () => {
    const local = createProvider({
      name: 'My Local',
      provider_type: 'anthropic',
      base_url: 'https://my.local',
      api_key: 'local-key',
    });
    setManagedProviders([buildRow({ id: 'managed-cfg-1' })]);

    const all = getAllProviders();
    assert.equal(all.length, 2);
    const localRow = all.find((r) => r.id === local.id);
    assert.ok(localRow);
    assert.equal(localRow!.source, 'local');
    assert.equal(localRow!.name, 'My Local');

    // Now wipe managed — local must remain
    setManagedProviders([]);
    const afterPrune = getAllProviders();
    assert.equal(afterPrune.length, 1);
    assert.equal(afterPrune[0].id, local.id);
  });

  it('does NOT delete local rows even if their id collides with a managed id pattern (defensive)', () => {
    // Manually craft a local row with an id that LOOKS managed
    const db = getDb();
    db.prepare(
      `INSERT INTO api_providers (id, name, provider_type, protocol, base_url, api_key, is_active, sort_order,
        extra_env, headers_json, env_overrides_json, role_models_json, options_json, notes,
        source, managed_config_id, managed_extra_json, created_at, updated_at)
       VALUES ('managed-cfg-fake', 'Tricky Local', 'anthropic', 'anthropic', '', 'k', 0, 99,
               '{}', '{}', '', '{}', '{}', '', 'local', '', '{}',
               datetime('now'), datetime('now'))`,
    ).run();

    setManagedProviders([]); // prune all managed
    const all = getAllProviders();
    assert.equal(all.length, 1, 'local row with managed-looking id must survive prune');
    assert.equal(all[0].id, 'managed-cfg-fake');
    assert.equal(all[0].source, 'local');
  });
});

describe('purgeManagedProviders', () => {
  it('removes only managed rows', () => {
    createProvider({ name: 'Local 1', base_url: 'x', api_key: 'k' });
    setManagedProviders([
      buildRow({ id: 'managed-cfg-1' }),
      buildRow({ id: 'managed-cfg-2', managed_config_id: 'cfg-2' }),
    ]);

    const removed = purgeManagedProviders();
    assert.equal(removed, 2);

    const remaining = getAllProviders();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].source, 'local');
    assert.equal(remaining[0].name, 'Local 1');
  });

  it('returns 0 when there are no managed rows', () => {
    createProvider({ name: 'Local Only', base_url: 'x', api_key: 'k' });
    assert.equal(purgeManagedProviders(), 0);
  });
});

describe('getProvidersBySource', () => {
  it('defaults to ordering by sort_order then created_at', () => {
    setManagedProviders([
      buildRow({ id: 'managed-cfg-b', managed_config_id: 'b', sort_order: 2, name: 'B' }),
      buildRow({ id: 'managed-cfg-a', managed_config_id: 'a', sort_order: 1, name: 'A' }),
    ]);
    const rows = getProvidersBySource('managed');
    assert.deepEqual(rows.map((r) => r.name), ['A', 'B']);
  });

  it('returns empty array when no rows match', () => {
    assert.deepEqual(getProvidersBySource('managed'), []);
  });
});

describe('cleanup', () => {
  it('closes db cleanly', () => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

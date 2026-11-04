/**
 * Unit tests for src/lib/db.ts credential column encryption (Layer 2).
 *
 * Verifies: api_providers sensitive columns + sensitive settings keys are sealed
 * on disk (enc:v1:) while all db.ts read/write functions stay plaintext, and that
 * migrateDb's re-seal pass upgrades a legacy plaintext DB.
 *
 * Run with: npx tsx --test src/__tests__/unit/db-encryption.test.ts
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

// Isolate from the real ~/.codepilot and set a master key BEFORE importing db.ts.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-db-enc-'));
const DB_PATH = path.join(tmpDir, 'codepilot.db');
const KEY_HEX = crypto.createHash('sha256').update('db-enc-test-key').digest('hex');
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
process.env.CLAUDE_GUI_SECRET_KEY = KEY_HEX;

// Seed a "legacy plaintext" DB (a sensitive setting) BEFORE db.ts runs migrateDb,
// so the migration re-seal pass has something to upgrade. migrateDb's legacy
// seed will also mint a Default provider from this token.
{
  const seed = new Database(DB_PATH);
  seed.exec(
    `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL);`,
  );
  seed.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('anthropic_auth_token', 'sk-legacy-plaintext');
  seed.close();
}

// require (NOT static import) so this runs AFTER the env + seed above: db.ts
// computes DB_PATH from CLAUDE_GUI_DATA_DIR at module-load time, and static
// imports hoist above the process.env assignments. Mirrors db-managed-providers.test.ts.
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  getDb,
  createProvider,
  updateProvider,
  getProvider,
  getAllProviders,
  getProvidersBySource,
  setManagedProviders,
  getSetting,
  setSetting,
} = require('../../lib/db') as typeof import('../../lib/db');

function rawProvider(id: string): Record<string, string> {
  return getDb().prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as Record<string, string>;
}
function rawSetting(key: string): string | undefined {
  return (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('migrateDb re-seal pass (legacy plaintext upgrade)', () => {
  it('seals the legacy plaintext setting + the provider seeded from it', () => {
    // First db access triggers migrateDb → reSealSensitiveColumns.
    assert.equal(getSetting('anthropic_auth_token'), 'sk-legacy-plaintext', 'getSetting decrypts');
    assert.ok(rawSetting('anthropic_auth_token')!.startsWith('enc:v1:'), 'setting sealed on disk');

    const seeded = getAllProviders().find((p) => p.name === 'Default');
    assert.ok(seeded, 'migrateDb seeded a Default provider from the legacy token');
    assert.equal(seeded!.api_key, 'sk-legacy-plaintext', 'seeded api_key decrypts');
    assert.ok(rawProvider(seeded!.id).api_key.startsWith('enc:v1:'), 'seeded api_key sealed on disk');
  });
});

describe('api_providers column encryption', () => {
  it('createProvider seals api_key on disk; reads decrypt transparently', () => {
    const p = createProvider({ name: 'BYOK', provider_type: 'anthropic', base_url: 'https://api.x', api_key: 'sk-byok-secret-001' });
    assert.equal(p.api_key, 'sk-byok-secret-001', 'returned row is plaintext');

    const raw = rawProvider(p.id);
    assert.ok(raw.api_key.startsWith('enc:v1:'), 'api_key ciphertext on disk');
    assert.ok(!raw.api_key.includes('sk-byok-secret-001'), 'plaintext key must not appear on disk');

    assert.equal(getProvider(p.id)!.api_key, 'sk-byok-secret-001', 'getProvider decrypts');
    assert.equal(getAllProviders().find((x) => x.id === p.id)!.api_key, 'sk-byok-secret-001', 'getAllProviders decrypts');
  });

  it('updateProvider re-seals a changed api_key', () => {
    const p = createProvider({ name: 'ToUpdate', api_key: 'old-key-xyz' });
    updateProvider(p.id, { api_key: 'new-key-abc' });
    assert.ok(rawProvider(p.id).api_key.startsWith('enc:v1:'));
    assert.ok(!rawProvider(p.id).api_key.includes('new-key-abc'));
    assert.equal(getProvider(p.id)!.api_key, 'new-key-abc');
  });

  it('empty api_key stays empty (not sealed) — preserves != "" semantics', () => {
    const p = createProvider({ name: 'NoKey', api_key: '' });
    assert.equal(rawProvider(p.id).api_key, '');
    assert.equal(getProvider(p.id)!.api_key, '');
  });

  it('setManagedProviders seals api_key + managed_extra_json (no secret on disk)', () => {
    setManagedProviders([
      {
        id: 'managed-x', name: 'Gateway', provider_type: 'anthropic', protocol: 'anthropic',
        base_url: 'https://gw.example.com', api_key: 'sk-managed-777', sort_order: 0,
        managed_config_id: 'cfg-x',
        managed_extra_json: JSON.stringify({ raw: { auth_token: 'sk-managed-777' } }),
      },
    ]);
    const raw = rawProvider('managed-x');
    assert.ok(raw.api_key.startsWith('enc:v1:'), 'managed api_key sealed');
    assert.ok(raw.managed_extra_json.startsWith('enc:v1:'), 'managed_extra_json sealed');
    assert.ok(!raw.managed_extra_json.includes('sk-managed-777'), 'embedded auth_token must not leak');

    const got = getProvidersBySource('managed').find((p) => p.id === 'managed-x')!;
    assert.equal(got.api_key, 'sk-managed-777');
    assert.equal(JSON.parse(got.managed_extra_json!).raw.auth_token, 'sk-managed-777');
  });

  it('legacy plaintext row read path: getProvider hydrates a raw-inserted plaintext value', () => {
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    getDb()
      .prepare(`INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 99, '{}', ?, ?)`)
      .run('legacy-1', 'Legacy', 'anthropic', '', 'plain-legacy-key', now, now);
    // open() passes non-"enc:v1:" through unchanged → backward compatible read.
    assert.equal(getProvider('legacy-1')!.api_key, 'plain-legacy-key');
  });
});

describe('settings allowlist', () => {
  it('seals sensitive keys, leaves non-sensitive keys plaintext', () => {
    setSetting('anthropic_auth_token', 'sk-app-token-555');
    setSetting('default_provider_id', 'prov-123');

    assert.ok(rawSetting('anthropic_auth_token')!.startsWith('enc:v1:'), 'token sealed on disk');
    assert.equal(rawSetting('default_provider_id'), 'prov-123', 'non-sensitive key plaintext');

    assert.equal(getSetting('anthropic_auth_token'), 'sk-app-token-555', 'getSetting decrypts');
    assert.equal(getSetting('default_provider_id'), 'prov-123');
  });

  it('seals openai oauth token keys', () => {
    setSetting('openai_oauth_refresh_token', 'rt-secret-999');
    assert.ok(rawSetting('openai_oauth_refresh_token')!.startsWith('enc:v1:'));
    assert.equal(getSetting('openai_oauth_refresh_token'), 'rt-secret-999');
  });
});

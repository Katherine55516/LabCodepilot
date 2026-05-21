/**
 * Unit tests for electron/auth/storage.ts — token / device_id / configs file I/O.
 *
 * Uses CLAUDE_GUI_DATA_DIR override so the test never touches the real
 * ~/.codepilot/ directory. storage.ts and paths.ts have no electron deps,
 * so we can import them directly from a tsx test runner.
 *
 * Run with: npx tsx --test src/__tests__/unit/auth-storage.test.ts
 */

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Isolate this test from any real ~/.codepilot/anlcode/
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-auth-storage-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

import {
  saveToken,
  loadToken,
  clearToken,
  getOrCreateDeviceId,
  saveConfigs,
  loadConfigs,
  loadConfigsHash,
  saveSelectedConfigId,
  loadSelectedConfigId,
  clearSelectedConfigId,
  clearAuthState,
  clearAll,
} from '../../../electron/auth/storage';
import type { ModelConfig } from '../../../electron/auth/types';
import { anlcodePath } from '../../../electron/auth/paths';

function freshDir(): void {
  // Wipe anlcode/ between tests so each starts clean
  try { fs.rmSync(path.join(tmpDir, 'anlcode'), { recursive: true, force: true }); } catch { /* ignore */ }
}

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('token I/O', () => {
  beforeEach(freshDir);

  it('saveToken + loadToken round-trips', () => {
    saveToken('anl_sess_test12345');
    assert.equal(loadToken(), 'anl_sess_test12345');
  });

  it('loadToken returns null when file missing', () => {
    assert.equal(loadToken(), null);
  });

  it('loadToken returns null for whitespace-only file', () => {
    // Create file with whitespace
    fs.mkdirSync(path.join(tmpDir, 'anlcode'), { recursive: true });
    fs.writeFileSync(anlcodePath('sessionToken'), '   \n\n', 'utf-8');
    assert.equal(loadToken(), null);
  });

  it('clearToken removes the file', () => {
    saveToken('xxx');
    clearToken();
    assert.equal(loadToken(), null);
  });

  it('clearToken is idempotent on missing file', () => {
    assert.doesNotThrow(() => clearToken());
  });

  it('saves token with restrictive permissions on Unix (no-op on Windows)', () => {
    if (process.platform === 'win32') return;
    saveToken('xxx');
    const stat = fs.statSync(anlcodePath('sessionToken'));
    // 0o600 → mode & 0o777 === 0o600
    assert.equal(stat.mode & 0o777, 0o600);
  });
});

describe('device id', () => {
  beforeEach(freshDir);

  it('generates a UUID on first call and persists it', () => {
    const id1 = getOrCreateDeviceId();
    const id2 = getOrCreateDeviceId();
    assert.equal(id1, id2);
    assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('reuses existing device_id on disk', () => {
    fs.mkdirSync(path.join(tmpDir, 'anlcode'), { recursive: true });
    fs.writeFileSync(anlcodePath('deviceId'), 'fixed-device-id-9999', 'utf-8');
    assert.equal(getOrCreateDeviceId(), 'fixed-device-id-9999');
  });
});

describe('configs', () => {
  beforeEach(freshDir);

  const sample: ModelConfig[] = [
    {
      id: 'cfg-1',
      name: 'Sonnet',
      description: '',
      base_url: 'https://api.example.com',
      auth_token: 'k1',
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

  it('saveConfigs + loadConfigs round-trips array', () => {
    saveConfigs(sample, 'hash-abc');
    const loaded = loadConfigs();
    assert.deepEqual(loaded, sample);
    assert.equal(loadConfigsHash(), 'hash-abc');
  });

  it('loadConfigs returns null when file missing', () => {
    assert.equal(loadConfigs(), null);
    assert.equal(loadConfigsHash(), null);
  });

  it('loadConfigs returns null for non-array JSON (defensive)', () => {
    fs.mkdirSync(path.join(tmpDir, 'anlcode'), { recursive: true });
    fs.writeFileSync(anlcodePath('configs'), '{"not":"an array"}', 'utf-8');
    assert.equal(loadConfigs(), null);
  });

  it('loadConfigs returns null on parse error', () => {
    fs.mkdirSync(path.join(tmpDir, 'anlcode'), { recursive: true });
    fs.writeFileSync(anlcodePath('configs'), 'not-json{{', 'utf-8');
    assert.equal(loadConfigs(), null);
  });
});

describe('selected config id', () => {
  beforeEach(freshDir);

  it('save + load round-trips', () => {
    saveSelectedConfigId('cfg-active');
    assert.equal(loadSelectedConfigId(), 'cfg-active');
  });

  it('returns null when missing', () => {
    assert.equal(loadSelectedConfigId(), null);
  });

  it('clearSelectedConfigId removes it', () => {
    saveSelectedConfigId('x');
    clearSelectedConfigId();
    assert.equal(loadSelectedConfigId(), null);
  });
});

describe('cleanup helpers', () => {
  beforeEach(freshDir);

  it('clearAuthState removes token + selected_config_id, keeps device_id + configs', () => {
    saveToken('t');
    saveSelectedConfigId('cfg');
    const deviceId = getOrCreateDeviceId();
    saveConfigs([], 'h');

    clearAuthState();

    assert.equal(loadToken(), null);
    assert.equal(loadSelectedConfigId(), null);
    assert.equal(getOrCreateDeviceId(), deviceId, 'device_id should survive logout');
    assert.notEqual(loadConfigs(), null, 'configs.json should survive logout');
  });

  it('clearAll removes the entire anlcode directory', () => {
    saveToken('t');
    getOrCreateDeviceId();
    clearAll();
    const anlcodeDir = path.join(tmpDir, 'anlcode');
    assert.equal(fs.existsSync(anlcodeDir), false);
  });
});

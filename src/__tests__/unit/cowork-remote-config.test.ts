/**
 * Unit tests for cowork remote-config delivery (R5-5 账号下发落库 helper)。
 *
 * setCoworkRemoteConfig 写三键(url / token(sealed 由 SENSITIVE_SETTINGS 机制
 * 覆盖,见 db-encryption.test)/ backend='remote');非法输入必须抛且不落半截;
 * clear 置空三键 → getCoworkBackend 回落 vfkit 默认。
 *
 * Uses a real sqlite db isolated via CLAUDE_GUI_DATA_DIR + require() (so db.ts
 * picks up the temp dir at module load). Mirrors channel-router.test.ts.
 *
 * Run with: npx tsx --test src/__tests__/unit/cowork-remote-config.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-cwkcfg-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const { getSetting } = require('../../lib/db') as typeof import('../../lib/db');
const { setCoworkRemoteConfig, clearCoworkRemoteConfig } =
  require('../../lib/cowork-remote-config') as typeof import('../../lib/cowork-remote-config');

describe('cowork-remote-config (R5-5 account delivery)', () => {
  it('set writes all three settings and switches backend to remote', () => {
    setCoworkRemoteConfig({ serverUrl: 'https://cowork.example.com', token: 'eyJ1aWQiOiJ1MSJ9.sig' });
    assert.equal(getSetting('cowork_remote_url'), 'https://cowork.example.com');
    assert.equal(getSetting('cowork_remote_token'), 'eyJ1aWQiOiJ1MSJ9.sig');
    assert.equal(getSetting('cowork_backend'), 'remote');
  });

  it('rejects missing token and leaves no partial state', () => {
    clearCoworkRemoteConfig();
    assert.throws(() => setCoworkRemoteConfig({ serverUrl: 'https://cowork.example.com', token: '' }), /required/);
    assert.equal(getSetting('cowork_backend'), '');
    assert.equal(getSetting('cowork_remote_url'), '');
  });

  it('rejects missing serverUrl and an invalid URL, leaving no partial state', () => {
    clearCoworkRemoteConfig();
    assert.throws(() => setCoworkRemoteConfig({ serverUrl: '', token: 't' }), /required/);
    assert.throws(() => setCoworkRemoteConfig({ serverUrl: 'not a url', token: 't' }), /URL/i);
    assert.equal(getSetting('cowork_remote_url'), '');
    assert.equal(getSetting('cowork_remote_token'), '');
    assert.equal(getSetting('cowork_backend'), '');
  });

  it('clear empties all three (office mode falls back to default backend)', () => {
    setCoworkRemoteConfig({ serverUrl: 'http://192.168.64.9:8790', token: 'tok' });
    clearCoworkRemoteConfig();
    assert.equal(getSetting('cowork_remote_url'), '');
    assert.equal(getSetting('cowork_remote_token'), '');
    assert.equal(getSetting('cowork_backend'), '');
  });
});

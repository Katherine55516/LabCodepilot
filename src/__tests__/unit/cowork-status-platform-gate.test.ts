/**
 * Unit tests for the cowork status platform gate (R5-6).
 *
 * 非 darwin 且未下发 remote 时,vfkit 本地资产状态机是死路(下载的是 mac 资产)——
 * status route 必须返回 overall='unsupported'(前端只解释不给下载按钮,RD5);
 * 而 win32 + 已下发 remote 必须照常走 remote 分支(unsupported 只挡 vfkit 分支)。
 *
 * Uses a real sqlite db isolated via CLAUDE_GUI_DATA_DIR + dynamic import.
 *
 * Run with: npx tsx --test src/__tests__/unit/cowork-status-platform-gate.test.ts
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-cwkgate-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

const REAL_PLATFORM = process.platform;
function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

/* eslint-disable @typescript-eslint/no-require-imports */
const { setSetting } = require('../../lib/db') as typeof import('../../lib/db');

describe('cowork status platform gate (R5-6)', () => {
  after(() => setPlatform(REAL_PLATFORM));

  it('win32 + vfkit default → unsupported, never a download prompt', async () => {
    setPlatform('win32');
    const { GET } = await import('../../app/api/cowork/status/route');
    const body = await (await GET()).json();
    assert.equal(body.backendKind, 'vfkit');
    assert.equal(body.assets.overall, 'unsupported');
    assert.equal(body.assets.usable, false);
    assert.equal(body.imageProvisioned, false);
  });

  it('win32 + delivered remote backend goes through the remote branch (not blocked)', async () => {
    setPlatform('win32');
    setSetting('cowork_backend', 'remote');
    setSetting('cowork_remote_url', 'http://127.0.0.1:1'); // fast ECONNREFUSED → ready:false
    const { GET } = await import('../../app/api/cowork/status/route');
    const body = await (await GET()).json();
    assert.equal(body.backendKind, 'remote');
    assert.notEqual(body.assets.overall, 'unsupported');
    setSetting('cowork_backend', '');
    setSetting('cowork_remote_url', '');
  });

  it('darwin still reaches the local vfkit assets state machine', async () => {
    setPlatform('darwin');
    const { GET } = await import('../../app/api/cowork/status/route');
    const body = await (await GET()).json();
    assert.equal(body.backendKind, 'vfkit');
    assert.notEqual(body.assets.overall, 'unsupported');
    assert.ok(['ready', 'downloading', 'missing', 'failed'].includes(body.assets.overall));
  });
});

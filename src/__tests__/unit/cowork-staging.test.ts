import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * E2 办公暂存目录 + 创建期沙箱字段单测
 * (docs/exec-plans/active/cowork-office-mode.md E2/D2/D3)。
 * 路由编排(POST 办公分支 / DELETE 级联)由 dev+CDP E2E 验证;这里钉死
 * 纯逻辑与 db 层字段落库。涉及真实用户库的用例遵循本仓惯例:创建后即清理。
 */

const stagingPath = path.resolve(__dirname, '../../lib/cowork-staging.ts');
const dbPath = path.resolve(__dirname, '../../lib/db.ts');

// 测试专用 sessionId:合法 32 位 hex,但显然不是真实会话(全 e)。
const TEST_SID = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

describe('cowork-staging: path derivation & validation', () => {
  it('derives ~/.codepilot/cowork/<sessionId> and roots under the app data dir', async () => {
    const { officeStagingDir, officeStagingRoot } = await import(stagingPath);
    const sid = 'a1b2c3d4e5f6a7b8';
    assert.equal(officeStagingRoot(), path.join(os.homedir(), '.codepilot', 'cowork'));
    assert.equal(officeStagingDir(sid), path.join(os.homedir(), '.codepilot', 'cowork', sid));
  });

  it('rejects traversal / non-hex session ids', async () => {
    const { officeStagingDir } = await import(stagingPath);
    for (const bad of ['../../etc', 'abc/def', '', 'ABCZ1234', 'a1b2..c3']) {
      assert.throws(() => officeStagingDir(bad), /invalid cowork sessionId/);
    }
  });

  it('ensure → exists → remove → gone roundtrip (idempotent both ways)', async () => {
    const { ensureOfficeStagingDir, removeOfficeStagingDir, officeStagingDir } = await import(stagingPath);
    const sid = TEST_SID;
    try {
      const dir = ensureOfficeStagingDir(sid);
      assert.equal(dir, officeStagingDir(sid));
      assert.ok(fs.existsSync(dir));
      // idempotent ensure
      assert.equal(ensureOfficeStagingDir(sid), dir);
      // nested content is removed too (simulates .codepilot-uploads/)
      fs.mkdirSync(path.join(dir, '.codepilot-uploads'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codepilot-uploads', 'x.txt'), 'x');
      removeOfficeStagingDir(sid);
      assert.ok(!fs.existsSync(dir));
      // idempotent remove (no-throw on missing dir — legacy sessions rely on this)
      assert.doesNotThrow(() => removeOfficeStagingDir(sid));
    } finally {
      removeOfficeStagingDir(sid);
    }
  });
});

describe('db: createSession persists sandbox_enabled at creation (E2)', () => {
  it('sandboxEnabled=true → row has sandbox_enabled=1 + full_access profile', async () => {
    const { createSession, getSession, deleteSession } = await import(dbPath);
    const s = createSession('e2-unit-test', '', '', '', 'code', '', 'full_access', '', true);
    try {
      const row = getSession(s.id)!;
      assert.equal(row.sandbox_enabled, 1);
      assert.equal(row.permission_profile, 'full_access');
      assert.equal(row.working_directory, '');
    } finally {
      deleteSession(s.id);
    }
    assert.equal(getSession(s.id), undefined);
  });

  it('omitted sandboxEnabled defaults to 0 (dev sessions unchanged)', async () => {
    const { createSession, getSession, deleteSession } = await import(dbPath);
    const s = createSession('e2-unit-test-dev');
    try {
      assert.equal(getSession(s.id)!.sandbox_enabled, 0);
    } finally {
      deleteSession(s.id);
    }
  });
});

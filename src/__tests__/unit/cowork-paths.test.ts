import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pathsMod = () => import(path.resolve(__dirname, '../../lib/cowork-paths.ts'));

describe('cowork-paths: 资产目录正式化(M3)', () => {
  it('全部规范路径挂在同一 root 下,root 是 cowork-assets(或迁移失败时的 legacy 兜底)', async () => {
    const m = await pathsMod();
    assert.ok(
      m.COWORK_ROOT.endsWith('cowork-assets') || m.COWORK_ROOT.endsWith('cowork-poc'),
      `unexpected root: ${m.COWORK_ROOT}`,
    );
    for (const p of [m.IMAGES_DIR, m.IMAGE_PATH, m.IMAGE_MARKER_PATH, m.CLAUDE_BIN_PATH, m.CLAUDE_MARKER_PATH, m.EFI_STORE_PATH, m.VFKIT_PID_FILE, m.CONSOLE_LOG_PATH, m.VSOCK_SOCKET_PATH]) {
      assert.ok(p.startsWith(m.COWORK_ROOT + path.sep), `${p} not under root`);
    }
    assert.ok(m.IMAGE_PATH.endsWith('debian-12-genericcloud-arm64.raw'));
    assert.ok(m.VSOCK_SOCKET_PATH.endsWith('vsock-1024.sock'));
  });

  it('模块加载后 legacy cowork-poc 不再单独存在(已迁移或本就没有)', async () => {
    await pathsMod();
    const legacy = path.join(os.homedir(), '.codepilot', 'cowork-poc');
    const fresh = path.join(os.homedir(), '.codepilot', 'cowork-assets');
    // 两者并存是告警态(不动老目录);正常态是只剩 cowork-assets 或都不存在
    if (fs.existsSync(legacy)) {
      assert.ok(fs.existsSync(fresh), 'legacy exists without new root — migration failed');
    }
  });

  it('bundledCoworkResource:无 AILAB_RESOURCES_PATH → null;有则解析存在的文件', async () => {
    const m = await pathsMod();
    const saved = process.env.AILAB_RESOURCES_PATH;
    try {
      delete process.env.AILAB_RESOURCES_PATH;
      assert.equal(m.bundledCoworkResource('cowork-daemon.py'), null);
      assert.equal(m.vfkitBin(), 'vfkit'); // dev 回退 PATH

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-res-'));
      fs.mkdirSync(path.join(tmp, 'cowork', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'cowork', 'cowork-daemon.py'), '# x');
      fs.writeFileSync(path.join(tmp, 'cowork', 'bin', 'vfkit'), 'bin');
      process.env.AILAB_RESOURCES_PATH = tmp;
      assert.equal(m.bundledCoworkResource('cowork-daemon.py'), path.join(tmp, 'cowork', 'cowork-daemon.py'));
      assert.equal(m.bundledCoworkResource('missing.txt'), null);
      assert.equal(m.vfkitBin(), path.join(tmp, 'cowork', 'bin', 'vfkit'));
      fs.rmSync(tmp, { recursive: true, force: true });
    } finally {
      if (saved === undefined) delete process.env.AILAB_RESOURCES_PATH;
      else process.env.AILAB_RESOURCES_PATH = saved;
    }
  });
});

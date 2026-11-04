/**
 * Unit tests: Windows 上 Claude CLI 候选路径不得含无扩展名项。
 *
 * 回归防护 —— 候选最终会被 execFileSync 直接执行(platform.ts 的 findClaudeBinary /
 * findAllClaudeBinaries)。Windows 上无扩展名的 `claude` 是安装器留给 Git Bash 的
 * POSIX sh 脚本(npm 全局装会同时生成 claude.cmd + claude;在 Git Bash 里跑官方
 * install.sh 则只装出无扩展名的那一个)，不是 PE 镜像:把它交给 CreateProcessW 时
 * Windows 会弹出应用无法捕获、也无法抑制的系统模态框「此应用无法在你的电脑上运行」。
 *
 * 用户线上实测为启动进主界面即弹(chat 页 → /api/setup → findClaudeBinary)，关掉不
 * 影响功能(探测异常被 catch，最终用随包自带的 claude.exe)，但体验是硬伤。
 *
 * isWindows 是 platform.ts 的模块顶层常量，故必须先改 process.platform 再动态 import。
 *
 * Run with: npx tsx --test src/__tests__/unit/platform-win-candidates.test.ts
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const REAL_PLATFORM = process.platform;
function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('Windows Claude CLI candidate paths', () => {
  after(() => setPlatform(REAL_PLATFORM));

  it('never yields an extension-less candidate (spawning one pops a system dialog)', async () => {
    setPlatform('win32');
    const { getClaudeCandidatePaths } = await import('../../lib/platform');
    const candidates = getClaudeCandidatePaths();

    assert.ok(candidates.length > 0, 'expected candidates on win32');
    const bad = candidates.filter((p) => !/\.(exe|cmd|bat|com)$/i.test(p));
    assert.deepEqual(
      bad,
      [],
      `extension-less candidates get spawned and trigger the Windows ` +
        `"此应用无法在你的电脑上运行" dialog: ${bad.join(', ')}`,
    );
  });

  it('still covers the real Windows install shapes (native .exe / npm .cmd)', async () => {
    setPlatform('win32');
    const { getClaudeCandidatePaths } = await import('../../lib/platform');
    const candidates = getClaudeCandidatePaths();

    // 别为了消弹框把探测能力一起删掉 —— 这两种形态是 Windows 上的真实安装产物。
    assert.ok(candidates.some((p) => p.endsWith('claude.exe')), 'lost native .exe candidates');
    assert.ok(candidates.some((p) => p.endsWith('claude.cmd')), 'lost npm .cmd candidates');
  });
});

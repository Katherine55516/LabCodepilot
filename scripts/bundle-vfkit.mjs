#!/usr/bin/env node
/**
 * bundle-vfkit.mjs — 把本机 vfkit 二进制装进 vfkit-bundle/,供 electron-builder
 * 的 extraResources 复制到 Resources/cowork/bin/(镜像流水线 M3:免 brew 前置)。
 *
 * 来源:PATH 里的 vfkit(解析符号链接到 Cellar 真身)→ /opt/homebrew/bin/vfkit 兜底。
 * 强校验:二进制必须带 com.apple.security.virtualization entitlement
 * (Virtualization.framework 硬要求;brew 版自带)—— 缺了打出去的包沙箱起不来,
 * 宁可构建失败。after-sign.js 的 adhoc 补签按扩展名收集(.node/.dylib/.so),
 * 无扩展名的 vfkit 不会被重签,原签名与 entitlement 原样保留(M3 实测)。
 *
 * 非 macOS 平台直接跳过(Windows 走 WSL2 路线,P2)。
 */
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

if (process.platform !== 'darwin') {
  console.log('[bundle-vfkit] non-darwin platform — skip');
  process.exit(0);
}

function resolveVfkit() {
  const candidates = [];
  try {
    const fromPath = execSync('command -v vfkit', { encoding: 'utf8', shell: '/bin/bash' }).trim();
    if (fromPath) candidates.push(fromPath);
  } catch { /* not on PATH */ }
  candidates.push('/opt/homebrew/bin/vfkit', '/usr/local/bin/vfkit');
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return fs.realpathSync(c);
    } catch { /* ignore */ }
  }
  return null;
}

const src = resolveVfkit();
if (!src) {
  console.error('[bundle-vfkit] vfkit not found — install with `brew install vfkit` before packaging');
  process.exit(1);
}

const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', src], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (!entitlements.includes('com.apple.security.virtualization')) {
  console.error(`[bundle-vfkit] ${src} lacks com.apple.security.virtualization entitlement — refusing to bundle`);
  process.exit(1);
}

const outDir = path.join(process.cwd(), 'vfkit-bundle');
const out = path.join(outDir, 'vfkit');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, out);
fs.chmodSync(out, 0o755);

// 拷贝后的签名仍应有效(copyFileSync 不动 Mach-O 内嵌签名)
execFileSync('codesign', ['--verify', out], { stdio: 'pipe' });

const version = (() => {
  try { return execFileSync(out, ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
})();
console.log(`[bundle-vfkit] bundled ${src} → vfkit-bundle/vfkit (${version}, virtualization entitlement OK)`);

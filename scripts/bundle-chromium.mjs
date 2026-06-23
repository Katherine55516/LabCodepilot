// scripts/bundle-chromium.mjs
//
// 打包前(electron:pack* 链里、electron-builder 之前)运行:用 @playwright/mcp 自带的
// playwright(1.61-alpha)把 chromium_headless_shell 装到项目 ms-playwright-bundle/,
// 供 electron-builder.yml 的 extraResources 复制进安装包 resources/ms-playwright。
//
// 为什么用 @playwright/mcp 的 install-browser 入口装:它会用 @playwright/mcp 自带的
// playwright-core 的 revision(当前 1226)下载,保证浏览器版本与运行时 cli.js 实际
// 加载的 playwright-core 完全一致 —— 顶层 node_modules 里的 playwright-core(1.58.1,
// rev 1208)是另一个版本,不能混用。
//
// ⚠️ 装的是【当前打包平台】的二进制(Windows 上跑→win64;mac 上跑→mac-arm64),所以
// 必须在目标平台的打包机上执行。幂等:已装则 playwright install 直接跳过。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(root, 'ms-playwright-bundle');
const mcpCli = path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js');

if (!existsSync(mcpCli)) {
  console.error(`[bundle-chromium] 找不到 @playwright/mcp cli.js: ${mcpCli}\n  请先 npm ci 安装依赖。`);
  process.exit(1);
}

mkdirSync(bundleDir, { recursive: true });
console.log(`[bundle-chromium] 安装 chromium-headless-shell → ${bundleDir} (平台: ${process.platform})`);

try {
  execFileSync(process.execPath, [mcpCli, 'install-browser', 'chromium-headless-shell'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: bundleDir },
  });
} catch (err) {
  console.error('[bundle-chromium] 安装失败:', err?.message || err);
  process.exit(1);
}

console.log('[bundle-chromium] 完成');

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
//
// 【第二职责】把 node_modules/@playwright/mcp 整包补齐进 .next/standalone —— 见文件末尾
// syncMcpPackage()。Next.js NFT 的 outputFileTracingIncludes glob 跨平台行为不一致:
// macOS 构建能把嵌套 node_modules/playwright(含 cli.js)带进 standalone,Windows 上却
// 漏掉 cli.js,导致 script-runner.ts 的 resolveScriptPlaywrightRuntime() 抛「未找到
// @playwright/mcp 自带的 Playwright 运行时」——「回归脚本自动跑通」在 Windows 上必败,
// 而 macOS 一切正常,极易漏测。故不再依赖 NFT(也不依赖 electron-builder 的 glob),
// 用 fs.cpSync 显式递归复制,跨平台行为确定。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

syncMcpPackage();

console.log('[bundle-chromium] 完成');

// 把 @playwright/mcp 整包(含嵌套 node_modules/playwright + playwright-core)复制进
// .next/standalone/node_modules/,补齐 NFT 在 Windows 上漏掉的文件。electron-builder.yml
// 既有的 `from: .next/standalone/node_modules/` 条目会把补齐后的完整内容带进安装包。
//
// 跳过 .bin:其中的 playwright 在 POSIX 上是指向 ../playwright/cli.js 的 symlink,重复
// 复制会让 electron-builder 报 "EEXIST: file already exists, symlink ..." →
// failedTask=build、安装包不生成,而 electron-builder 26.8.1 退出码仍是 0(极具欺骗性,
// 务必以是否真生成安装包为准)。排除它是安全的:script-runner.ts 用 <nested>/cli.js 的
// 绝对路径 spawn,从不经过 .bin;NFT 也已把 .bin 带进 standalone。
function syncMcpPackage() {
  const src = path.join(root, 'node_modules', '@playwright', 'mcp');
  const standalone = path.join(root, '.next', 'standalone');
  const dest = path.join(standalone, 'node_modules', '@playwright', 'mcp');

  if (!existsSync(standalone)) {
    console.warn('[bundle-chromium] ⚠️ 未找到 .next/standalone,跳过 @playwright/mcp 补齐。');
    console.warn('  打包前请先执行 next build(npm run electron:build),否则安装包会缺 Playwright 运行时。');
    return;
  }

  console.log(`[bundle-chromium] 补齐 @playwright/mcp → ${dest}`);
  cpSync(src, dest, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (from) => !path.relative(src, from).split(path.sep).includes('.bin'),
  });

  // 自检:cli.js 是 script-runner 唯一要找的文件,缺了就等于本次打包白做。在此 fail
  // loud,把问题暴露在构建阶段,而不是等用户运行「回归脚本自动跑通」时才报错。
  const cliJs = path.join(dest, 'node_modules', 'playwright', 'cli.js');
  if (!existsSync(cliJs)) {
    console.error(`[bundle-chromium] ✗ 补齐后仍缺 cli.js: ${cliJs}`);
    console.error('  源目录内容:', existsSync(src) ? readdirSync(src).join(', ') : '(源目录不存在,请先 npm ci)');
    process.exit(1);
  }
  console.log(`[bundle-chromium] ✓ @playwright/mcp 就绪(${countFiles(dest)} 个文件,cli.js 已确认)`);
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return total;
}

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * electron-builder afterPack hook.
 *
 * The standard @electron/rebuild step only rebuilds native modules found
 * in the `files` config. Since better-sqlite3 enters the app through
 * extraResources (via .next/standalone/), it gets skipped.
 *
 * This hook:
 * 1. Explicitly rebuilds better-sqlite3 for the target Electron ABI
 * 2. Copies the rebuilt .node into all locations within standalone resources
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const arch = context.arch;
  // electron-builder arch enum: 1=x64, 3=arm64, etc.
  const archName = arch === 3 ? 'arm64' : arch === 1 ? 'x64' : arch === 0 ? 'ia32' : String(arch);
  const platform = context.packager.platform.name; // 'mac', 'windows', 'linux'

  // Get Electron version from packager config or from installed package
  const electronVersion =
    context.electronVersion ||
    context.packager?.config?.electronVersion ||
    require(path.join(process.cwd(), 'node_modules', 'electron', 'package.json')).version;

  console.log(`[afterPack] Electron ${electronVersion}, arch=${archName}, platform=${platform}`);

  // Resolve the per-platform Resources root. The previous version hard-coded
  // 'CodePilot.app', which broke after productName was renamed to "AI Native Lab"
  // — the .app bundle is now "AI Native Lab.app" and every search hit
  // "Path does not exist", causing both the better-sqlite3 swap and the SDK
  // binary verification to silently no-op then FATAL. Discover the .app dir
  // dynamically on macOS; Windows/Linux still use appOutDir/resources.
  function findMacAppDir(parent) {
    try {
      const entries = fs.readdirSync(parent, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && e.name.endsWith('.app')) {
          return path.join(parent, e.name);
        }
      }
    } catch { /* ignore */ }
    return null;
  }
  const resourceRoots = [];
  if (platform === 'mac') {
    const appDir = findMacAppDir(appOutDir);
    if (appDir) {
      resourceRoots.push(path.join(appDir, 'Contents', 'Resources'));
      console.log(`[afterPack] Discovered macOS app bundle: ${appDir}`);
    } else {
      console.warn(`[afterPack] WARNING: no .app bundle found under ${appOutDir}`);
    }
  } else {
    resourceRoots.push(path.join(appOutDir, 'resources'));
  }

  // Step 1: Explicitly rebuild better-sqlite3 for the target Electron version
  const projectDir = process.cwd();
  console.log('[afterPack] Rebuilding better-sqlite3 for Electron ABI...');

  const rebuiltSource = path.join(
    projectDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'
  );
  // electron-rebuild compiles in-place under the project's own node_modules.
  // The resulting binary carries the Electron ABI, which plain Node (dev server,
  // `tsx --test`) cannot dlopen — so `npm run dev` and `npm run test` would break
  // for the rest of the developer's session unless we put the Node-ABI build back.
  // Stash it here and restore in the `finally` below, once it has been copied
  // into the packaged resources.
  const nodeAbiBackup = rebuiltSource + '.node-abi-backup';

  // A leftover backup means a previous run was killed between rebuild and
  // restore, so the current binary is the Electron one — restore before stashing
  // again, otherwise we would snapshot the polluted state as the "original".
  if (fs.existsSync(nodeAbiBackup)) {
    console.log('[afterPack] Found stale Node-ABI backup from an interrupted run; restoring it first');
    fs.copyFileSync(nodeAbiBackup, rebuiltSource);
  } else if (fs.existsSync(rebuiltSource)) {
    fs.copyFileSync(rebuiltSource, nodeAbiBackup);
  }

  // Built from the dynamically-resolved resourceRoots above. Declared out here
  // because the diagnostic branch after the try/finally reports on them too.
  const searchRoots = resourceRoots.map(r => path.join(r, 'standalone'));
  let replaced = 0;

  try {
    try {
      // Use @electron/rebuild via npx (it's a dependency of electron-builder)
      const rebuildCmd = `npx electron-rebuild -f -o better-sqlite3 -v ${electronVersion} -a ${archName}`;
      console.log(`[afterPack] Running: ${rebuildCmd}`);
      execSync(rebuildCmd, {
        cwd: projectDir,
        stdio: 'inherit',
        timeout: 120000,
      });
      console.log('[afterPack] Rebuild completed successfully');
    } catch (err) {
      console.error('[afterPack] Failed to rebuild better-sqlite3:', err.message);
      // Try alternative: use @electron/rebuild programmatically
      try {
        const { rebuild } = require('@electron/rebuild');
        await rebuild({
          buildPath: projectDir,
          electronVersion: electronVersion,
          arch: archName,
          onlyModules: ['better-sqlite3'],
          force: true,
        });
        console.log('[afterPack] Rebuild via @electron/rebuild API succeeded');
      } catch (err2) {
        console.error('[afterPack] @electron/rebuild API also failed:', err2.message);
        throw new Error('Cannot rebuild better-sqlite3 for Electron ABI');
      }
    }

    // Step 2: Verify the rebuilt .node file
    if (!fs.existsSync(rebuiltSource)) {
      throw new Error(`[afterPack] Rebuilt better_sqlite3.node not found at ${rebuiltSource}`);
    }

    const sourceStats = fs.statSync(rebuiltSource);
    console.log(`[afterPack] Rebuilt .node file: ${rebuiltSource} (${sourceStats.size} bytes, mtime: ${sourceStats.mtime.toISOString()})`);

    // Step 3: Find and replace all better_sqlite3.node in standalone resources.
    function walkAndReplace(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkAndReplace(fullPath);
        } else if (entry.name === 'better_sqlite3.node') {
          const beforeSize = fs.statSync(fullPath).size;
          fs.copyFileSync(rebuiltSource, fullPath);
          const afterSize = fs.statSync(fullPath).size;
          console.log(`[afterPack] Replaced ${fullPath} (${beforeSize} -> ${afterSize} bytes)`);
          replaced++;
        }
      }
    }

    for (const root of searchRoots) {
      walkAndReplace(root);
    }
  } finally {
    if (fs.existsSync(nodeAbiBackup)) {
      fs.copyFileSync(nodeAbiBackup, rebuiltSource);
      fs.unlinkSync(nodeAbiBackup);
      console.log('[afterPack] Restored the Node-ABI better_sqlite3.node in node_modules');
    }
  }

  if (replaced > 0) {
    console.log(`[afterPack] Successfully replaced ${replaced} better_sqlite3.node file(s) with Electron ABI build`);
  } else {
    console.warn('[afterPack] WARNING: No better_sqlite3.node files found in standalone resources!');
    for (const root of searchRoots) {
      if (fs.existsSync(root)) {
        console.log(`[afterPack] Contents of ${root}:`, fs.readdirSync(root).slice(0, 20));
      } else {
        console.log(`[afterPack] Path does not exist: ${root}`);
      }
    }
  }

  // Step 4: Verify & chmod the Claude Code native binary shipped by the
  // @anthropic-ai/claude-agent-sdk-<platform>-<arch> subpackage.
  // The binary is asarUnpack'd, so it lives under:
  //   <appOutDir>/.../resources/app.asar.unpacked/node_modules/@anthropic-ai/
  //     claude-agent-sdk-<platform>-<arch>/{claude|claude.exe}
  // and also at the standalone copy:
  //   <appOutDir>/.../resources/standalone/node_modules/@anthropic-ai/
  //     claude-agent-sdk-<platform>-<arch>/{claude|claude.exe}
  // We make sure it exists for the target platform/arch, and on macOS/Linux
  // ensure it's executable (npm sometimes strips the +x bit when extracting
  // optional dependencies on CI).
  const sdkPlatform =
    platform === 'mac' ? 'darwin' :
    platform === 'windows' ? 'win32' :
    platform === 'linux' ? 'linux' :
    platform;
  const expectedSubpackages =
    sdkPlatform === 'linux'
      ? [`@anthropic-ai/claude-agent-sdk-linux-${archName}`,
         `@anthropic-ai/claude-agent-sdk-linux-${archName}-musl`]
      : [`@anthropic-ai/claude-agent-sdk-${sdkPlatform}-${archName}`];

  const binaryName = sdkPlatform === 'win32' ? 'claude.exe' : 'claude';

  const sdkSearchRoots = resourceRoots;

  let sdkBinariesFound = 0;
  for (const root of sdkSearchRoots) {
    if (!fs.existsSync(root)) continue;
    for (const subpkg of expectedSubpackages) {
      // Two possible locations within each resources root:
      //   app.asar.unpacked/node_modules/<subpkg>/<binary>
      //   standalone/node_modules/<subpkg>/<binary>
      const candidates = [
        path.join(root, 'app.asar.unpacked', 'node_modules', ...subpkg.split('/'), binaryName),
        path.join(root, 'standalone', 'node_modules', ...subpkg.split('/'), binaryName),
      ];
      for (const binPath of candidates) {
        if (!fs.existsSync(binPath)) continue;
        const stats = fs.statSync(binPath);
        // On macOS/Linux, ensure +x is set
        if (sdkPlatform !== 'win32') {
          fs.chmodSync(binPath, 0o755);
        }
        console.log(`[afterPack] Verified Claude Code binary: ${binPath} (${stats.size} bytes)`);
        sdkBinariesFound++;
      }
    }
  }

  if (sdkBinariesFound === 0) {
    // For Linux, having neither glibc nor musl variant is fatal — the SDK
    // can't pick at runtime if neither is present. For mac/win, just one
    // expected subpackage; missing it means npm didn't install the platform
    // optional dependency for this arch.
    const msg =
      `[afterPack] FATAL: No Claude Code native binary found for ` +
      `${sdkPlatform}-${archName}. ` +
      `Expected subpackages: ${expectedSubpackages.join(', ')}. ` +
      `This usually means \`npm install\` did not install the platform-specific ` +
      `optional dependency for ${sdkPlatform}-${archName}. ` +
      `On CI, ensure the build job runs on a matching runner OR explicitly ` +
      `installs the subpackage with --force --os=<platform> --cpu=<arch>.`;
    console.error(msg);
    throw new Error(msg);
  }
  console.log(`[afterPack] Claude Code SDK binary check passed (${sdkBinariesFound} copies verified)`);

  // ── @playwright/mcp 兜底复制 ────────────────────────────────────────────
  // 直接往【已打好的产物目录】写,绕开 electron-builder 的 extraResources filter。
  //
  // 为什么必须在这里做:src/lib/test/script-runner.ts 的
  // resolveScriptPlaywrightRuntime() 要 <resources>/standalone/node_modules/
  // @playwright/mcp/node_modules/playwright/cli.js,缺了就抛「未找到 @playwright/mcp
  // 自带的 Playwright 运行时」,「回归脚本自动跑通」直接失败。这个文件走过两层 glob,
  // 每层都在 Windows 上漏掉它、而 macOS 正常:
  //   1. Next.js NFT 的 outputFileTracingIncludes —— 已由 bundle-chromium.mjs 的
  //      syncMcpPackage() 在 .next/standalone 里补齐(实测 Windows 日志确认 cli.js 在);
  //   2. electron-builder 的 extraResources filter —— 补齐后的 standalone 复制进包时
  //      又丢了(用户实测:.next/standalone 有 cli.js,win-unpacked 里没有,那层只剩
  //      .bin/playwright/playwright-core 三个目录)。electron-builder 的 "**/*" 不递归
  //      进 node_modules 子目录,专门加的嵌套条目在 macOS 生效、Windows 不生效。
  // 故第三道防线放在 afterPack:此时产物目录已定型,用 fs.cpSync 直接写,不经过任何
  // filter/glob,跨平台行为一致。
  //
  // 跳过 .bin:其中的 playwright 在 POSIX 上是指向 ../playwright/cli.js 的 symlink,
  // 已由前面的复制带进包;重复创建会报 EEXIST。
  const mcpSrc = path.join(__dirname, '..', 'node_modules', '@playwright', 'mcp');
  if (!fs.existsSync(mcpSrc)) {
    const msg = `[afterPack] FATAL: 源 @playwright/mcp 不存在: ${mcpSrc}(请先 npm ci)`;
    console.error(msg);
    throw new Error(msg);
  }

  let mcpSynced = 0;
  for (const root of resourceRoots) {
    const dest = path.join(root, 'standalone', 'node_modules', '@playwright', 'mcp');
    if (!fs.existsSync(path.join(root, 'standalone'))) continue;
    fs.cpSync(mcpSrc, dest, {
      recursive: true,
      force: true,
      dereference: false,
      filter: (from) => !path.relative(mcpSrc, from).split(path.sep).includes('.bin'),
    });
    // 自检:cli.js 是 script-runner 唯一要找的文件。此处是打包链路最后一道关口,
    // 缺了就等于本次打包产出一个「装上去才发现回归脚本跑不通」的坏包,故 fail loud。
    const cliJs = path.join(dest, 'node_modules', 'playwright', 'cli.js');
    if (!fs.existsSync(cliJs)) {
      const nested = path.join(dest, 'node_modules');
      const msg =
        `[afterPack] FATAL: 复制后仍缺 ${cliJs}\n` +
        `  该层实际内容: ${fs.existsSync(nested) ? fs.readdirSync(nested).join(', ') : '(目录不存在)'}`;
      console.error(msg);
      throw new Error(msg);
    }
    console.log(`[afterPack] @playwright/mcp 已就位: ${dest}(cli.js 已确认)`);
    mcpSynced++;
  }

  if (mcpSynced === 0) {
    const msg =
      `[afterPack] FATAL: 未找到任何 standalone 目录,@playwright/mcp 没能进包。\n` +
      `  已查 resources 根: ${resourceRoots.join(', ')}`;
    console.error(msg);
    throw new Error(msg);
  }

  // Note: Ad-hoc code signing moved to scripts/after-sign.js (afterSign hook).
  // afterSign runs after electron-builder's own signing step (which is a no-op
  // with CSC_IDENTITY_AUTO_DISCOVERY=false), ensuring the signature is the last
  // modification before DMG/ZIP creation.
};

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

  // Step 1: Explicitly rebuild better-sqlite3 for the target Electron version
  const projectDir = process.cwd();
  console.log('[afterPack] Rebuilding better-sqlite3 for Electron ABI...');

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
  const rebuiltSource = path.join(
    projectDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'
  );

  if (!fs.existsSync(rebuiltSource)) {
    throw new Error(`[afterPack] Rebuilt better_sqlite3.node not found at ${rebuiltSource}`);
  }

  const sourceStats = fs.statSync(rebuiltSource);
  console.log(`[afterPack] Rebuilt .node file: ${rebuiltSource} (${sourceStats.size} bytes, mtime: ${sourceStats.mtime.toISOString()})`);

  // Step 3: Find and replace all better_sqlite3.node in standalone resources
  // macOS: <appOutDir>/CodePilot.app/Contents/Resources/standalone/...
  // Windows/Linux: <appOutDir>/resources/standalone/...
  const searchRoots = [
    path.join(appOutDir, 'CodePilot.app', 'Contents', 'Resources', 'standalone'),
    path.join(appOutDir, 'Contents', 'Resources', 'standalone'),
    path.join(appOutDir, 'resources', 'standalone'),
  ];

  let replaced = 0;

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

  const sdkSearchRoots = [
    path.join(appOutDir, 'CodePilot.app', 'Contents', 'Resources'),
    path.join(appOutDir, 'Contents', 'Resources'),
    path.join(appOutDir, 'resources'),
  ];

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

  // Note: Ad-hoc code signing moved to scripts/after-sign.js (afterSign hook).
  // afterSign runs after electron-builder's own signing step (which is a no-op
  // with CSC_IDENTITY_AUTO_DISCOVERY=false), ensuring the signature is the last
  // modification before DMG/ZIP creation.
};

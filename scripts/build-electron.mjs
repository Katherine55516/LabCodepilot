import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

// Replace symlinks in standalone with real copies so electron-builder can package them
function resolveStandaloneSymlinks() {
  const standaloneModules = '.next/standalone/.next/node_modules';
  if (!fs.existsSync(standaloneModules)) return;

  const entries = fs.readdirSync(standaloneModules);
  for (const entry of entries) {
    const fullPath = path.join(standaloneModules, entry);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(fullPath);
      const resolved = path.resolve(standaloneModules, target);
      if (fs.existsSync(resolved)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        fs.cpSync(resolved, fullPath, { recursive: true });
        console.log(`Resolved symlink: ${entry} -> ${target}`);
      }
    }
  }
}

async function buildElectron() {
  // Clean dist-electron/ before every build to prevent stale artifacts
  // from leaking into app.asar (caused v0.34 crash on upgrade).
  if (fs.existsSync('dist-electron')) {
    fs.rmSync('dist-electron', { recursive: true });
    console.log('Cleaned dist-electron/');
  }
  fs.mkdirSync('dist-electron', { recursive: true });

  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: ['electron'],
    // sourcemap: false — 生产构建不生成 source map。
    //
    // 之前为 true 时,esbuild 生成的 main.js.map / preload.js.map 内嵌了
    // sourcesContent(electron/*.ts 的逐字原文,含 auth/crypto-seal 等敏感模块),
    // 既进 app.asar 又被 NFT 误拷进 standalone/dist-electron/ —— 等于随包明文分发主
    // 进程全部源码。关掉后这些 map 不再生成,从源头杜绝泄漏。
    //
    // 运行时不依赖 map:fork server 未传 --enable-source-maps,代码中无 source-map-support,
    // 无任何 readFile('*.map');map 缺失时 Node/V8 仅退化为打包后行号,不会崩溃。
    // Sentry 当前也未上传 map(符号化本就未生效),故此项对线上行为零影响。
    // 若将来要接 Sentry 符号化:改回生成 map,但用 sentry-cli 上传后从产物中删除,
    // 切勿随包分发。
    sourcemap: false,
    minify: false,
  };

  await build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.js',
  });

  await build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.js',
  });

  console.log('Electron build complete');

  // Fix standalone symlinks after next build
  resolveStandaloneSymlinks();
}

buildElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});

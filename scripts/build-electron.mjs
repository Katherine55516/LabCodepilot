import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

// 防逆向加固第一层 B 组:对主进程产物(main.js / preload.js)做保守混淆。
//
// 覆盖面有意只限主进程这两个文件 —— 它们启动即被 Electron 执行,任何破坏都会让
// app 启动失败/窗口异常,因此可被"启动并截图"完整验证。Next server/渲染端 chunk
// 不在此处理(Turbopack 已压缩;二次混淆其模块注册机制风险高且无法廉价验证 ——
// 那部分真正敏感的逻辑应后端化,而非客户端混淆)。
//
// 配置原则:只开"重命名 + 字符串隐藏",关闭一切"改写控制流 / 自我保护 / 改属性名"
// 的高风险项 —— 后者(controlFlowFlattening / selfDefending / debugProtection /
// renameProperties)正是"混淆导致应用诡异崩溃"的头号来源,在零回归约束下绝不启用。
// 已核实一方代码无 Function.prototype.toString / 动态 require / fn.name 依赖
// (.toString 命中全部是 Buffer.toString);contextBridge 暴露的 'electronAPI' 经
// stringArray 编码后运行时解码回原值,渲染端 window.electronAPI 匹配不变。
//
// 调试主进程时用 DISABLE_OBFUSCATION=1 跳过混淆。
const OBFUSCATE = process.env.DISABLE_OBFUSCATION !== '1';
const OBFUSCATOR_OPTIONS = {
  compact: true,
  simplify: true,
  target: 'node',
  // —— 高风险项全部关闭 ——
  controlFlowFlattening: false, // 热路径可慢 1.5~3x,且是崩溃来源
  deadCodeInjection: false,     // 体积膨胀
  debugProtection: false,       // 崩溃来源
  selfDefending: false,         // 崩溃来源
  renameProperties: false,      // 改属性名会破坏序列化/反射,绝不开
  transformObjectKeys: false,
  renameGlobals: false,         // 不动全局名,避免影响跨模块引用
  // —— 仅保留低风险的语义保持型变换 ——
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1, // 全部字符串入数组:避免 CLAUDE_GUI_SECRET_KEY / aes-256-gcm
                           // 等敏感字面量按 0.75 概率漏成明文。与 0.75 同一安全等级
                           // (机制相同,只是覆盖更全),'use strict' 等指令自动豁免。
  splitStrings: false,
  unicodeEscapeSequence: false,
  numbersToExpressions: false,
  disableConsoleOutput: false,  // 保留 console —— 依赖文件日志 / Sentry 面包屑
  sourceMap: false,
};

function obfuscateFile(file) {
  const code = fs.readFileSync(file, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
  fs.writeFileSync(file, result.getObfuscatedCode());
  const after = fs.statSync(file).size;
  console.log(`Obfuscated ${file} (${(after / 1024).toFixed(0)} KB)`);
}

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

  // 主进程产物混淆(防逆向第一层 B 组)。在 esbuild 产出之后、打包之前就地处理。
  if (OBFUSCATE) {
    obfuscateFile('dist-electron/main.js');
    obfuscateFile('dist-electron/preload.js');
  } else {
    console.log('Obfuscation skipped (DISABLE_OBFUSCATION=1)');
  }

  // Fix standalone symlinks after next build
  resolveStandaloneSymlinks();
}

buildElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});

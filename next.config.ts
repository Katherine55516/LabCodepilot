import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import pkg from "./package.json" with { type: "json" };

// 构建标记：短 commit + 构建时间。在打包/构建时求值，经 env 内联进前端 bundle，
// 让用户无需 F12/git 就能在界面上核对「当前运行的这个包」用的是哪个版本的代码——
// 反复出现「已修复但用户仍复现」时，用它一眼区分是代码问题还是包版本落后。
// git 不可用的极少数环境退化为仅构建时间，保证始终有一个可辨识的标记。
const BUILD_ID = (() => {
  const at = new Date().toISOString().slice(0, 16).replace("T", " ");
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      cwd: import.meta.dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return `${sha} · ${at}`;
  } catch {
    return at;
  }
})();

const nextConfig: NextConfig = {
  output: 'standalone',
  // These large icon barrels otherwise enter every AppShell route in dev.
  // Load the named icons only, keeping PPT cold compilation and hydration bounded.
  experimental: { optimizePackageImports: ['@phosphor-icons/react', '@lobehub/icons'] },
  // Pin the file-tracing root to THIS project directory. Without it, Next.js
  // infers the monorepo/workspace root from the nearest ancestor lockfile. On a
  // dev machine that happens to have a stray ~/package-lock.json, the inferred
  // root resolves to $HOME, and the standalone output gets nested under
  // `.next/standalone/<relative-path-to-project>/` instead of being flat. That
  // breaks electron-builder's extraResources, which hard-codes
  // `from: .next/standalone/node_modules/` — the copy silently picks up nothing
  // and after-pack.js fails with "No Claude Code native binary found".
  // CI checks out at a path with no ancestor lockfile, so its root already
  // resolves to the project dir; pinning here makes local builds match CI.
  outputFileTracingRoot: import.meta.dirname,
  // Electron loads dev server via http://127.0.0.1:3000 (hardcoded in
  // electron/main.ts), but Next.js 16 treats `127.0.0.1` and `localhost` as
  // different origins by default and blocks `_next/*` resources (HMR
  // WebSocket, JS chunks) from cross-origin hosts. Without this, the page
  // renders SSR HTML but React never hydrates — buttons appear but have no
  // click handlers. See the warning printed at dev startup:
  //   "Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr from 127.0.0.1"
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // dev 专用:把 playwright MCP 的输出目录从 webpack 文件监听里排除。CDP/playwright 验证
  // 时 MCP 会把快照 yml / console log / 截图持续写进仓库根的 `.playwright-mcp/`,Tailwind v4
  // content 扫描 + webpack watch 将其视为源码变化 → 重编译 → 页面 HMR/RSC 刷新 → 又产生
  // console 日志写入 → **自激重编译死循环**(表象:页面永远转圈、[Fast Refresh] rebuilding
  // 每 0.5s 刷屏、大 chunk 下载途中被重编译截断报 SyntaxError/ChunkLoadError)。
  // 注意合并姿势:Next 默认 ignored 是**RegExp**,而 webpack schema 的数组形式只接受字符串
  // ——不能把 RegExp 塞进数组(会 ValidationError 起不来),按既有类型分别合并。
  webpack: (config, { dev }) => {
    if (!dev) {
      // Next 16.2.1 applies outputFileTracingExcludes after NFT enumerates assets.
      // A dynamic cwd read can therefore walk every generated application copy.
      // Ignore NFT's literal glob marker during its initial tracing pass. Runtime
      // workspace files are supplied at runtime; external packages remain covered
      // by the explicit outputFileTracingIncludes below.
      type TracePlugin = { constructor?: { name?: string }; traceIgnores?: string[] };
      const tracePlugin = (config.plugins as TracePlugin[] | undefined)?.find(plugin => plugin?.constructor?.name === 'TraceEntryPointsPlugin');
      if (tracePlugin) tracePlugin.traceIgnores = [...(tracePlugin.traceIgnores || []), '\\*\\*/\\*'];
    }
    if (dev) {
      const extra = /[\\/](?:\.playwright-mcp|\.ppt-build|outputs)[\\/]/;
      const prev = config.watchOptions?.ignored;
      const ignored =
        prev instanceof RegExp ? new RegExp(`${prev.source}|${extra.source}`)
        : Array.isArray(prev) ? [...prev, '**/.playwright-mcp/**', '**/.ppt-build/**', '**/outputs/**']
        : typeof prev === 'string' ? [prev, '**/.playwright-mcp/**', '**/.ppt-build/**', '**/outputs/**']
        : extra;
      config.watchOptions = { ...config.watchOptions, ignored };
    }
    return config;
  },
  // serverExternalPackages: keep these in node_modules at runtime instead of bundling.
  // - better-sqlite3 / zlib-sync: native modules, can't be bundled
  // - discord.js / @discordjs/ws: dynamic require chain
  // - @anthropic-ai/claude-agent-sdk: orchestrates spawning the Claude Code
  //   native binary at runtime via require.resolve('@anthropic-ai/claude-agent-sdk-<platform>-<arch>').
  //   If Next.js bundles the SDK, that dynamic require can't be statically
  //   analyzed and the runtime binary lookup fails.
  // - @anthropic-ai/claude-agent-sdk-<platform>-<arch>: 8 platform subpackages
  //   each shipping a self-contained native `claude` / `claude.exe` binary
  //   (~230 MB). They must be visible as real packages in node_modules at
  //   runtime — bundling them is both pointless (binaries can't be inlined) and
  //   harmful (the SDK's require.resolve probe relies on the package layout).
  serverExternalPackages: [
    'better-sqlite3',
    'discord.js',
    '@discordjs/ws',
    'zlib-sync',
    // xlsx (sheetjs CDN 0.20.3)：exports 字段受限 + 体积大，交给 Next bundle 进 route chunk
    // 时在 standalone（尤其 Windows）容易追踪不全。标记 external 不 bundle，配合下方
    // force-include 整包复制到 standalone/node_modules，由 import 路由的动态 import('xlsx')
    // 在运行时直接 require —— 避免 .xls 解析依赖被打包漏收。
    'xlsx',
    // mammoth (docx→文本，导入需求用)：同 xlsx 的问题与修法——bundle 进 route chunk 后其
    // 依赖链（jszip/@xmldom/lop 等 20+ 包）在 standalone（尤其 Windows）追踪不全，表现为
    // 打包版「导入 docx 需求」失败而 dev 正常。标记 external + 下方 force-include 完整依赖
    // 闭包，配合 import 路由的动态 import('mammoth') 在运行时直接 require。
    'mammoth',
    // @playwright/mcp：script-runner.ts 里 `createRequire(...).resolve('@playwright/mcp')`
    // 只为拿到包所在目录（再拼 node_modules/playwright/cli.js 去 spawn），从不真正加载它。
    // 但 webpack 把 createRequire 的 .resolve() 当静态依赖跟了进去，一路解析到嵌套的
    // playwright-core/lib/coreBundle.js，那里 require 的 'chromium-bidi/lib/cjs/...' 只在
    // playwright 自己 bundle 后才存在 → `next build --webpack` 报 Module not found 而失败。
    // dev 用 Turbopack 不做这层解析，所以只在打包时炸。标记 external 让 webpack 不进包，
    // 运行时按真实 node_modules 解析；整包已由下方 outputFileTracingIncludes 复制进 standalone。
    '@playwright/mcp',
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    '@anthropic-ai/claude-agent-sdk-darwin-x64',
    '@anthropic-ai/claude-agent-sdk-linux-arm64',
    '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    '@anthropic-ai/claude-agent-sdk-win32-arm64',
    '@anthropic-ai/claude-agent-sdk-win32-x64',
  ],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    // 构建标记（短 commit · 构建时间），供界面自助核对包版本，见文件顶部 BUILD_ID。
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
    // Bailian image api key is injected at BUILD time (not committed to source).
    // next.config `env` inlines the build-time value into the bundle, so the
    // packaged app has it at runtime while git keeps no plaintext key. Build with:
    //   BAILIAN_IMAGE_API_KEY=sk-... npm run electron:pack:mac
    BAILIAN_IMAGE_API_KEY: process.env.BAILIAN_IMAGE_API_KEY ?? '',
  },
  // outputFileTracingIncludes: force Next.js NFT to copy the Anthropic SDK
  // platform-specific subpackages into .next/standalone/node_modules/ so the
  // electron-builder extraResources step picks them up. The SDK locates its
  // native binary at runtime via a dynamic `require.resolve()` keyed on
  // process.platform + process.arch, which Next.js cannot statically follow —
  // without this include the subpackages get silently dropped from the
  // standalone output and `after-pack.js` fails with
  // "FATAL: No Claude Code native binary found for <platform>-<arch>".
  // Only the subpackage matching the current OS/arch is actually installed
  // by npm (the others are optionalDependencies that npm skips on mismatch),
  // so listing all 8 is safe — Next.js silently skips includes that don't
  // resolve to real files.
  outputFileTracingIncludes: {
    '**/*': [
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/**/*',
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/**/*',
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/**/*',
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl/**/*',
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*',
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/**/*',
      'node_modules/@anthropic-ai/claude-agent-sdk-win32-arm64/**/*',
      'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**/*',
      // @playwright/mcp + 其自带的嵌套 playwright-core/playwright(1.61-alpha):测试执行
      // 阶段把它当 stdio MCP server 启动(见 src/lib/test/prompts.ts buildPlaywrightMcp,
      // 经 cli.js)。cli.js 在代码里是运行时拼接的字符串路径、不是静态 import,NFT 追不动,
      // 只复制了孤零零的 cli.js —— 丢了 package.json/lib 和嵌套 node_modules,server 一
      // require('playwright-core') 就崩 → 零工具注册。force-include 整包(含嵌套依赖)修复之。
      'node_modules/@playwright/mcp/**/*',
      // xlsx (sheetjs)：上方 serverExternalPackages 标记 external 后 Next 不再 bundle 它，
      // 必须显式把整包复制进 standalone/node_modules，否则导入 .xls 用例时 import 路由里的
      // 动态 import('xlsx') 在运行时找不到包而报错。
      'node_modules/xlsx/**/*',
      // mammoth (docx→文本)：external 后同样必须显式复制。与 xlsx 不同，mammoth 有依赖链，
      // 下面是**完整传递闭包**（脚本从 node_modules 实测枚举，22 包）——NFT 对 external 包
      // 的依赖追踪在 Windows standalone 上翻过车（xlsx 前科），全部显式收录一劳永逸。
      'node_modules/mammoth/**/*',
      'node_modules/@xmldom/xmldom/**/*',
      'node_modules/argparse/**/*',
      'node_modules/base64-js/**/*',
      'node_modules/bluebird/**/*',
      'node_modules/dingbat-to-unicode/**/*',
      'node_modules/duck/**/*',
      'node_modules/immediate/**/*',
      'node_modules/inherits/**/*',
      'node_modules/jszip/**/*',
      'node_modules/lie/**/*',
      'node_modules/lop/**/*',
      'node_modules/option/**/*',
      'node_modules/pako/**/*',
      'node_modules/path-is-absolute/**/*',
      'node_modules/readable-stream/**/*',
      'node_modules/safe-buffer/**/*',
      'node_modules/setimmediate/**/*',
      'node_modules/string_decoder/**/*',
      'node_modules/underscore/**/*',
      'node_modules/util-deprecate/**/*',
      'node_modules/xmlbuilder/**/*',
    ],
  },
  // outputFileTracingExcludes: strip non-code dirs out of every route's NFT.
  // Turbopack sees the recursive fs.readdir() in src/lib/files#scanDirectory
  // (used by /api/files/suggest) and conservatively marks the whole project
  // as reachable — dumping README / RELEASE_NOTES / docs / .codepilot cache
  // / apps/site content into every route's .nft.json and surfacing it as
  // "next.config.ts was unexpectedly traced" warnings on `npm run build`.
  // Runtime still reads those paths — exclusion only removes them from the
  // static NFT manifest, which AI Native Lab doesn't consume for deployment
  // (Electron ships the whole project regardless).
  outputFileTracingExcludes: {
    // Key matches both app-router routes and instrumentation.js entry.
    '**/*': [
      'next.config.ts',
      'AGENTS.md',
      'ARCHITECTURE.md',
      'CHANGELOG.md',
      'CLAUDE.md',
      'LICENSE',
      'README.md',
      'README_CN.md',
      'README_JA.md',
      'RELEASE_NOTES.md',
      '.codepilot/**',
      '.ppt-build/**',
      'outputs/**',
      // `.claude/` holds agent/editor state — incl. git worktrees under
      // `.claude/worktrees/` that may contain their own node_modules/.next/
      // release/. NFT would otherwise sweep a worktree's `release/*.app` into
      // standalone and break electron-builder codesign (nested .app bundle).
      '.claude/**',
      'apps/**',
      'docs/**',
      'release/**',
      'scripts/**',
      'test-results/**',
      'playwright-report/**',
      '**/*.md',
      '**/*.mdx',
      '**/*.png',
      '**/*.jpg',
      '**/*.jpeg',
      '**/*.gif',
    ],
  },
};

export default nextConfig;

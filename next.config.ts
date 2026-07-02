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

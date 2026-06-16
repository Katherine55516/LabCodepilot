import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  output: 'standalone',
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
    ],
  },
  // outputFileTracingExcludes: strip non-code dirs out of every route's NFT.
  // Turbopack sees the recursive fs.readdir() in src/lib/files#scanDirectory
  // (used by /api/files/suggest) and conservatively marks the whole project
  // as reachable — dumping README / RELEASE_NOTES / docs / .codepilot cache
  // / apps/site content into every route's .nft.json and surfacing it as
  // "next.config.ts was unexpectedly traced" warnings on `npm run build`.
  // Runtime still reads those paths — exclusion only removes them from the
  // static NFT manifest, which CodePilot doesn't consume for deployment
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

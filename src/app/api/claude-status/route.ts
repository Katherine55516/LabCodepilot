import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { isWindows, findGitBash } from '@/lib/platform';

/**
 * GET /api/claude-status
 *
 * Since v0.55, Claude Code ships bundled with the installer via the
 * @anthropic-ai/claude-agent-sdk-<platform>-<arch> subpackage. There is no
 * "user installed a local CLI" probe anymore — the binary is always present.
 *
 * This endpoint reads the bundled Claude Code version from the SDK package
 * manifest at runtime and returns a connected=true status. Field shape is
 * kept backwards-compatible with pre-0.55 UI code (binaryPath, installType,
 * otherInstalls, etc.) so legacy consumers continue to render correctly.
 */

/** Pulled at first GET, cached for the process lifetime. */
let cachedVersion: string | null = null;

/**
 * Read the bundled SDK's claudeCodeVersion at runtime.
 *
 * Implementation note (why we don't `require.resolve('.../package.json')`):
 *   Next.js bundlers (Turbopack/Webpack) statically analyze the string literal
 *   passed to require/require.resolve, even when wrapped in `createRequire`.
 *   The SDK does NOT expose `./package.json` in its `exports` field, so the
 *   static analyzer floods the dev server with
 *     "Module not found: Can't resolve '@anthropic-ai/claude-agent-sdk/package.json'"
 *   warnings (the runtime resolve actually works — exports gating only applies
 *   at bundle time, not at Node-native resolution). To eliminate the noise
 *   we resolve the SDK's MAIN entry instead (which IS in `exports`) and walk
 *   up to its package root to read package.json with fs.
 */
function getBundledVersion(): string | null {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const requireFromHere = createRequire(import.meta.url);
    // Resolve the main entry — this hits the `.` export, so bundler analysis
    // is happy. SDK ships as a flat package (sdk.mjs at root), so the
    // package.json lives in the same dir as the resolved entry.
    const sdkEntry = requireFromHere.resolve('@anthropic-ai/claude-agent-sdk');
    const pkgPath = path.join(path.dirname(sdkEntry), 'package.json');
    const sdkPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    cachedVersion = (sdkPkg.claudeCodeVersion as string) || (sdkPkg.version as string) || null;
  } catch {
    // Last-ditch fallback: walk up from process.cwd() to find node_modules.
    // This handles edge cases where require.resolve fails (e.g. monorepo
    // hoisting layouts where the SDK lives outside the natural require path).
    try {
      const candidate = path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json');
      if (fs.existsSync(candidate)) {
        const sdkPkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        cachedVersion = (sdkPkg.claudeCodeVersion as string) || (sdkPkg.version as string) || null;
      }
    } catch {
      cachedVersion = null;
    }
  }
  return cachedVersion;
}

export async function GET() {
  const version = getBundledVersion();

  // Git Bash on Windows is still required for some CLI tools (e.g. some
  // permission-handling shell hooks). Surface as a non-blocking warning.
  const missingGit = isWindows && findGitBash() === null;
  const warnings: string[] = [];
  if (missingGit) warnings.push('Git Bash not found — some features may not work');

  // All version-gated features are unconditionally enabled — the bundled
  // version is always recent enough for the feature gates we historically
  // checked (thinking 1.0.10+, context1m 1.0.20+, effort 1.0.15+).
  const features: Record<string, boolean> = {
    thinking: true,
    context1m: true,
    effort: true,
  };

  return NextResponse.json({
    // Bundled binary always present — connected is true by definition.
    connected: true,
    version: version || 'bundled',
    // Marker so UI can distinguish "bundled" from "user-installed".
    bundled: true,
    // The following fields are kept for backwards compatibility with UI
    // components that haven't been refactored yet. They reflect the post-0.55
    // reality: no user-installed CLI to track, no upgrade channel.
    latestVersion: version,
    updateAvailable: false,
    manualUpdateChannel: false,
    binaryPath: null,
    installType: null,
    otherInstalls: [],
    missingGit,
    warnings,
    features,
  });
}

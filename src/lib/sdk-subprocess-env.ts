/**
 * sdk-subprocess-env.ts — Single-source-of-truth env builder for every SDK
 * subprocess spawn (main chat stream, generateTextViaSdk, provider-doctor
 * live probe, future callers).
 *
 * Why this exists: the per-request shadow `~/.claude/` (claude-home-shadow.ts)
 * implements the "provider-group ownership of credentials" rule. Multiple
 * code paths spawn the SDK, and every one of them must apply the same rule
 * — otherwise auxiliary requests (compression, doctor probes, sub-agent
 * delegations) silently bypass the shadow and pick up cc-switch credentials,
 * making the diagnostic and main flows disagree. See P2 reviews on
 * claude-client.ts:332 (`generateTextViaSdk`) and provider-doctor.ts:758
 * (`runLiveProbe`).
 *
 * Callers receive a `{ env, shadow }` pair and MUST call `shadow.cleanup()`
 * in a `finally` block. The cleanup is idempotent and a no-op when no
 * shadow was actually built (env-mode pass-through).
 */
import os from 'node:os';
import { findGitBash, getExpandedPath } from './platform';
import { toClaudeCodeEnv, type ResolvedProvider } from './provider-resolver';
import { createShadowClaudeHome, type ShadowHome } from './claude-home-shadow';

export interface SdkSubprocessSetup {
  /** Env to pass to the SDK's `env` Option (already sanitized for spawn). */
  env: Record<string, string>;
  /** Shadow handle. Caller MUST call `cleanup()` in a finally block. */
  shadow: ShadowHome;
}

/**
 * Build the env that goes to the SDK subprocess for a resolved provider.
 *
 * Behavior:
 * - When `resolved.provider` is set (explicit DB provider): builds a per-
 *   request shadow ~/.claude/ that strips ANTHROPIC_* keys from settings.json
 *   AND ~/.claude.json, while preserving every other user-level config
 *   (mcpServers, hooks, enabledPlugins, skills, agents, plugins, commands,
 *   CLAUDE.md, .credentials.json). HOME and USERPROFILE are pointed at the
 *   shadow root so the SDK's settings loader reads our stripped copies
 *   instead of the live ones.
 * - When `resolved.provider` is undefined (env mode / cc-switch path):
 *   returns a pass-through real-HOME setup. cc-switch settings.json supplies
 *   credentials normally.
 *
 * In both cases, the returned env has AI Native Lab's PATH expansion, Git Bash
 * detection (Windows), and the provider's auth/baseUrl/model env applied via
 * `toClaudeCodeEnv()`.
 */
export function prepareSdkSubprocessEnv(resolved: ResolvedProvider): SdkSubprocessSetup {
  const sdkEnv: Record<string, string> = { ...process.env as Record<string, string> };

  // Provider-group ownership: only build a shadow when an explicit DB
  // provider is selected. Env-mode (resolved.provider === undefined) is the
  // Claude Code group and must continue to use the real ~/.claude/ + cc-switch.
  const shadow = createShadowClaudeHome({ stripAuth: !!resolved.provider });
  sdkEnv.HOME = shadow.home;
  sdkEnv.USERPROFILE = shadow.home;

  // PATH expansion is needed in both Electron and dev so the subprocess can
  // find user-installed CLIs (npm global, brew, bun, etc.).
  sdkEnv.PATH = getExpandedPath();

  // Drop CLAUDECODE so a AI Native Lab launched from inside a `claude` session
  // doesn't trip the SDK's "nested session" guard.
  delete sdkEnv.CLAUDECODE;

  // Drop NODE_ENV so the host runtime's value never leaks into the SDK
  // subprocess (the native `claude` cli and, transitively, its Bash/PowerShell
  // tool). In the PACKAGED build these tools run as children of the embedded
  // Next standalone server, whose `server.js` unconditionally sets
  // process.env.NODE_ENV='production'. If that leaks through, `npm install`
  // run by Claude's Bash tool in an unrelated user project silently skips
  // devDependencies (production install), breaking builds — reported in the
  // field (vite / vue-tsc / @types/* missing). We never set NODE_ENV ourselves;
  // deleting it makes the subprocess behave like a shell opened from scratch
  // (NODE_ENV undefined), which is exactly the unaffected baseline. A command
  // that genuinely wants NODE_ENV can still set it inline (e.g. `NODE_ENV=x …`).
  delete sdkEnv.NODE_ENV;

  // Windows-only: auto-detect Git Bash if not already configured.
  if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = findGitBash();
    if (gitBashPath) sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
  }

  // Apply the provider's resolved auth/baseUrl/model env. This MUST come
  // after the shadow setup, because toClaudeCodeEnv may clean ANTHROPIC_*
  // from baseEnv and we want HOME/USERPROFILE to survive that cleanup.
  const resolvedEnv = toClaudeCodeEnv(sdkEnv, resolved);
  Object.assign(sdkEnv, resolvedEnv);

  return { env: sdkEnv, shadow };
}

// ── Bounded stderr capture for SDK subprocess spawns ────────────────────────

export interface StderrCollector {
  /** Append raw stderr data (ANSI/control sequences are stripped). */
  append: (data: string) => void;
  /** Buffered stderr so far — head + tail with a marker when truncated. */
  snapshot: () => string;
}

/**
 * Bounded stderr accumulator for SDK spawn points. The Error the SDK throws
 * on a subprocess crash carries no `stderr` property, so fatal CLI startup
 * diagnostics (e.g. Windows "Claude Code on Windows requires either Git for
 * Windows (for bash) or PowerShell") exist ONLY in the stderr stream — spawn
 * points buffer it with this and hand the snapshot to classifyError as the
 * fallback evidence.
 *
 * Keeps the first and last `limit/2` characters: startup banners print at the
 * head, pre-crash output at the tail, and either can hold the relevant error.
 */
export function createStderrCollector(limit = 8192): StderrCollector {
  const half = Math.floor(limit / 2);
  let head = '';
  let tail = '';
  let truncated = false;

  return {
    append(data: string) {
      // Strip ANSI CSI/OSC sequences and control chars (keep \t and \n) so
      // pattern matching and log display don't trip over escape codes.
      let text = data
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      if (!text) return;
      if (head.length < half) {
        const room = half - head.length;
        head += text.slice(0, room);
        text = text.slice(room);
        if (!text) return;
      }
      tail += text;
      if (tail.length > half) {
        tail = tail.slice(tail.length - half);
        truncated = true;
      }
    },
    snapshot() {
      const joined = truncated ? `${head}\n…[stderr truncated]…\n${tail}` : head + tail;
      return joined.trim();
    },
  };
}

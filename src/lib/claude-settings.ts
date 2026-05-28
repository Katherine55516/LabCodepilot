/**
 * claude-settings.ts — Read Anthropic credentials from ~/.claude/settings.json.
 *
 * External tools (notably cc-switch, but also any user who manually edits the
 * file) manage Claude Code CLI credentials by writing an `env` block in
 * ~/.claude/settings.json. The Agent SDK loads this file when
 * `settingSources` includes `'user'` and merges the env into the subprocess,
 * skipping keys in its internal blocklist (which does NOT cover
 * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL).
 *
 * CodePilot's runtime resolver needs the same visibility so auto mode can
 * pick the SDK runtime (instead of falling back to native, which cannot read
 * this file at all).
 *
 * This reader is intentionally tiny and dependency-free, and silently returns
 * null on any error — callers must be resilient to a missing file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClaudeSettingsCredentials {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

/**
 * Read ~/.claude/settings.json (or legacy ~/.claude/claude.json) and extract
 * the Anthropic credential fields from its `env` block.
 *
 * Returns null when no file exists, the file is unparseable, or no auth-
 * related fields are present. Non-empty strings are preserved as-is.
 */
export function readClaudeSettingsCredentials(): ClaudeSettingsCredentials | null {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'claude.json'), // legacy name still used by some cc-switch installs
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      const env = parsed?.env;
      if (!env || typeof env !== 'object') continue;

      const pick = (key: string): string | undefined => {
        const v = env[key];
        return typeof v === 'string' && v.length > 0 ? v : undefined;
      };

      const apiKey = pick('ANTHROPIC_API_KEY');
      const authToken = pick('ANTHROPIC_AUTH_TOKEN');
      const baseUrl = pick('ANTHROPIC_BASE_URL');

      if (!apiKey && !authToken && !baseUrl) continue;

      return { apiKey, authToken, baseUrl };
    } catch {
      // Unreadable / malformed / permission-denied — treat as absent and try next file.
    }
  }

  return null;
}

/**
 * Quick boolean check: does the user have cc-switch / external-managed
 * Anthropic credentials in their ~/.claude/settings.json?
 *
 * Equivalent to `!!readClaudeSettingsCredentials()?.authToken ||
 * !!readClaudeSettingsCredentials()?.apiKey` but expresses intent more clearly.
 */
export function hasClaudeSettingsCredentials(): boolean {
  const creds = readClaudeSettingsCredentials();
  return !!(creds?.apiKey || creds?.authToken);
}

// ──────────────────────────────────────────────────────────────
// ensureSkipWebFetchPreflight
// ──────────────────────────────────────────────────────────────

export interface EnsureSettingsResult {
  /** Resolved path of the settings.json file that was checked / written. */
  path: string;
  /** True when the settings file (or its parent dir) had to be created. */
  created: boolean;
  /** True when the field was injected into an existing settings file. */
  updated: boolean;
  /** True when the field was already present and left untouched. */
  skipped: boolean;
  /** Non-null when any read / write error occurred (we never throw — startup must keep going). */
  error?: string;
}

/**
 * Ensure `~/.claude/settings.json` has `skipWebFetchPreflight: true`.
 *
 * Why: Claude Code's WebFetch tool does a domain-safety preflight against
 * `api.anthropic.com` before fetching. Users behind enterprise networks or
 * the Great Firewall (this app's primary audience) often see
 *   "Unable to verify if domain X is safe to fetch"
 * because that preflight is blocked. The setting is a documented Claude
 * Code option (visible in claude.exe's settings schema) that disables the
 * preflight while keeping the user-facing permission prompt intact.
 *
 * Behaviour:
 *   - File missing → create `{ "skipWebFetchPreflight": true }`
 *   - Field missing → merge `true` in, preserve every other field
 *   - Field already present (true OR false) → leave alone (respect user's
 *     explicit choice — if they set it to false on purpose, don't fight them)
 *   - Any IO / JSON error → returned in `result.error`, never thrown
 *
 * Safe to call repeatedly. Designed to be invoked fire-and-forget from
 * Electron's whenReady handler.
 */
export function ensureSkipWebFetchPreflight(): EnsureSettingsResult {
  const home = os.homedir();
  const claudeDir = path.join(home, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  let created = false;
  let updated = false;
  let skipped = false;

  try {
    // Step 1: ensure ~/.claude/ exists.
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
      created = true;
    }

    // Step 2: read existing settings (or start fresh).
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = parsed as Record<string, unknown>;
        }
      } catch (err) {
        return {
          path: settingsPath,
          created,
          updated: false,
          skipped: false,
          error: `Unparseable settings.json — leaving alone: ${(err as Error).message}`,
        };
      }
    } else {
      created = true;
    }

    // Step 3: skip if field is already explicitly set (true OR false — respect user choice).
    if (Object.prototype.hasOwnProperty.call(settings, 'skipWebFetchPreflight')) {
      return { path: settingsPath, created, updated: false, skipped: true };
    }

    // Step 4: merge field and write back. JSON.stringify with 2-space indent
    // for human readability — matches what users typically have.
    settings.skipWebFetchPreflight = true;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    updated = true;

    return { path: settingsPath, created, updated, skipped };
  } catch (err) {
    return {
      path: settingsPath,
      created,
      updated,
      skipped,
      error: (err as Error).message,
    };
  }
}

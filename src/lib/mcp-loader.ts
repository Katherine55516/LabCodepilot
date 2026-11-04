/**
 * MCP Server Loader — shared module for loading MCP server configurations.
 *
 * Source-of-truth for user-scope MCP servers is `~/.claude.json`'s `mcpServers`
 * field. This matches what the bundled Claude Code binary (2.1.203; first
 * verified on 2.1.141) actually
 * reads when `--setting-sources=user` is passed — see the implementation note
 * at the bottom of this file for why `~/.claude/settings.json.mcpServers`
 * is NOT a valid source despite the field name suggesting otherwise.
 *
 * Project-scope servers live in `<cwd>/.mcp.json`.
 *
 * `~/.claude/settings.json` still owns the `mcpServerOverrides` map that
 * controls per-server enable/disable for project-scope MCPs.
 *
 * We only manually pass servers that need AI Native Lab-specific processing
 * (${...} env placeholder resolution from the AI Native Lab DB) — the SDK
 * loads the rest natively via settingSources.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MCPServerConfig } from '@/types';
import { getSetting } from '@/lib/db';

// ── Paths ────────────────────────────────────────────────────────────

function userClaudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

function userSettingsJsonPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

// ── Cache ────────────────────────────────────────────────────────────

interface CachedMcpConfig {
  allServers: Record<string, MCPServerConfig>;
  codepilotServers: Record<string, MCPServerConfig>; // Only servers with resolved ${...} placeholders
  timestamp: number;
}

const CACHE_TTL_MS = 30_000; // 30 seconds
let _cache: CachedMcpConfig | null = null;

/** Invalidate the cache (e.g., after adding/removing a server via UI). */
export function invalidateMcpCache(): void {
  _cache = null;
}

// ── Internal helpers ─────────────────────────────────────────────────

function readJson(p: string): Record<string, unknown> {
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

/**
 * Atomic-ish write: writes to a tempfile in the same directory then renames.
 * `~/.claude.json` and `~/.claude/settings.json` both hold long-lived state
 * owned by the bundled Claude Code binary (numStartups, projects, env, etc.)
 * — a partial write would corrupt that state, so we never write in place.
 */
function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.codepilot-tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

// ── Migration: settings.json.mcpServers → .claude.json.mcpServers ────
//
// Before commit 2ec37ec the MCP Manager UI wrote new servers to
// `~/.claude/settings.json.mcpServers`, but the bundled Claude Code binary
// never reads that field — see "Why settings.json.mcpServers is a dead
// field" at the bottom of this file. Any user who added MCP servers via
// the UI ended up with config that displayed in the manager but never
// loaded at runtime. This function moves those entries to the correct
// file (`~/.claude.json.mcpServers`) and strips them from settings.json.
//
// Re-entrancy: safe to call repeatedly. If settings.json has no
// mcpServers field (or it's empty), this is a no-op.
//
// Conflict policy: when the same name exists in both files, `.claude.json`
// wins — that's the file the SDK actually loads, so it's the source of
// truth. The settings.json entry is discarded.
//
// Failure mode: if writing `.claude.json` succeeds but writing
// settings.json fails, the entries are duplicated but `.claude.json` is
// still authoritative; next invocation will retry and converge.

interface MigrationResult {
  migrated: string[];        // names moved from settings.json to .claude.json
  conflictsResolved: string[]; // names present in both; .claude.json kept
  cleared: boolean;          // settings.json.mcpServers was emptied
  error?: string;
}

export function migrateSettingsMcpServersToClaudeJson(): MigrationResult {
  const result: MigrationResult = { migrated: [], conflictsResolved: [], cleared: false };
  try {
    const settingsPath = userSettingsJsonPath();
    if (!fs.existsSync(settingsPath)) return result;

    const settings = readJson(settingsPath);
    const legacy = (settings.mcpServers || {}) as Record<string, MCPServerConfig>;
    if (!settings.mcpServers || Object.keys(legacy).length === 0) {
      return result; // nothing to migrate
    }

    const claudeJsonPath = userClaudeJsonPath();
    const claudeJson = readJson(claudeJsonPath);
    const target = ((claudeJson.mcpServers || {}) as Record<string, MCPServerConfig>);

    // Merge: .claude.json wins on name collision.
    for (const [name, server] of Object.entries(legacy)) {
      if (target[name]) {
        result.conflictsResolved.push(name);
      } else {
        target[name] = server;
        result.migrated.push(name);
      }
    }

    // Write .claude.json first. Only if that succeeds do we touch settings.json.
    claudeJson.mcpServers = target;
    writeJsonAtomic(claudeJsonPath, claudeJson);

    // Strip the dead field from settings.json. Other fields (env,
    // permissions, hooks, mcpServerOverrides, …) must survive untouched.
    delete settings.mcpServers;
    writeJsonAtomic(settingsPath, settings);
    result.cleared = true;

    console.log(
      `[mcp-migration] Moved ${result.migrated.length} MCP server(s) from settings.json to .claude.json` +
      (result.conflictsResolved.length > 0
        ? ` — ${result.conflictsResolved.length} conflict(s) resolved in favor of .claude.json: ${result.conflictsResolved.join(', ')}`
        : '')
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.warn('[mcp-migration] failed:', result.error, '— settings.json left intact, will retry on next load');
  }
  return result;
}

function loadAndMerge(): CachedMcpConfig {
  // Check cache
  if (_cache && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
    return _cache;
  }

  // Opportunistic migration: cheap no-op when there's nothing to move.
  // Runs before reading so the freshly-migrated state is what we cache.
  migrateSettingsMcpServersToClaudeJson();

  const userConfig = readJson(userClaudeJsonPath());
  const settings = readJson(userSettingsJsonPath());
  const projectMcp = readJson(path.join(process.cwd(), '.mcp.json'));

  // settings.json.mcpServers is a dead field — see file-bottom note. We
  // ignore it entirely; the migration above moves any stragglers to
  // .claude.json on first read after upgrade.
  const merged: Record<string, MCPServerConfig> = {
    ...((userConfig.mcpServers || {}) as Record<string, MCPServerConfig>),
    ...((projectMcp.mcpServers || {}) as Record<string, MCPServerConfig>),
  };

  // Apply persistent enabled overrides for project-level servers
  const settingsOverrides = (settings.mcpServerOverrides || {}) as Record<string, { enabled?: boolean }>;
  for (const [name, override] of Object.entries(settingsOverrides)) {
    if (merged[name] && override.enabled !== undefined) {
      merged[name] = { ...merged[name], enabled: override.enabled };
    }
  }

  // Resolve ${...} placeholders and track which servers needed resolution
  const codepilotServers: Record<string, MCPServerConfig> = {};

  for (const [name, server] of Object.entries(merged)) {
    if (server.env) {
      let hasPlaceholder = false;
      for (const [key, value] of Object.entries(server.env)) {
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          hasPlaceholder = true;
          const settingKey = value.slice(2, -1);
          const resolved = getSetting(settingKey);
          server.env[key] = resolved || '';
        }
      }
      // Only include in codepilotServers if it had placeholders
      if (hasPlaceholder && server.enabled !== false) {
        codepilotServers[name] = server;
      }
    }
  }

  // Filter out persistently disabled servers from allServers
  for (const [name, server] of Object.entries(merged)) {
    if (server.enabled === false) {
      delete merged[name];
    }
  }

  _cache = {
    allServers: merged,
    codepilotServers,
    timestamp: Date.now(),
  };

  return _cache;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load MCP servers that need AI Native Lab-specific processing.
 *
 * Returns only servers with ${...} env placeholders that were resolved
 * against the AI Native Lab DB. Returns undefined when no such servers exist
 * (the common case), letting the SDK load everything natively.
 *
 * Used by: route.ts, conversation-engine.ts — passed to streamClaude().
 */
export function loadCodePilotMcpServers(): Record<string, MCPServerConfig> | undefined {
  try {
    const { codepilotServers } = loadAndMerge();
    return Object.keys(codepilotServers).length > 0 ? codepilotServers : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load ALL MCP servers (for UI display in MCP Manager).
 *
 * Returns the full merged config from all sources with overrides applied.
 * NOT intended for passing to the SDK — use loadCodePilotMcpServers() instead.
 *
 * Used by: MCP Manager UI, diagnostics.
 */
export function loadAllMcpServers(): Record<string, MCPServerConfig> | undefined {
  try {
    const { allServers } = loadAndMerge();
    return Object.keys(allServers).length > 0 ? allServers : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load MCP servers from a SPECIFIC project's `.mcp.json` file.
 *
 * Used to compensate for `settingSources: ['user']` on DB-provider requests
 * (which drops 'project' to prevent project-level settings env from
 * overriding the explicit provider's auth — see provider-resolver.ts
 * around line 800). Without this, project `.mcp.json` MCP servers would
 * silently disappear for DB-provider users, even though the project's MCP
 * servers are auth-neutral and should keep working.
 *
 * Why this isn't covered by the cache-based `loadAndMerge` above:
 * `loadAndMerge` reads `<process.cwd()>/.mcp.json`, which on the desktop
 * app is the Next.js server's working directory (typically the standalone
 * bundle dir), NOT the user's project directory. We need the actual
 * resolved working directory of the request, which only the streaming
 * code path knows.
 *
 * Servers with `${...}` env placeholders are resolved against the
 * AI Native Lab DB the same way loadAndMerge does. Disabled servers are
 * filtered out.
 *
 * @param projectCwd - The user's actual working directory (NOT process.cwd())
 * @returns Map of resolved server configs, or undefined when none found
 */
export function loadProjectMcpServers(projectCwd: string | undefined): Record<string, MCPServerConfig> | undefined {
  if (!projectCwd) return undefined;
  try {
    const filePath = path.join(projectCwd, '.mcp.json');
    if (!fs.existsSync(filePath)) return undefined;

    const content = readJson(filePath);
    const rawServers = (content.mcpServers || {}) as Record<string, MCPServerConfig>;
    if (Object.keys(rawServers).length === 0) return undefined;

    // Apply user-level `mcpServerOverrides` from ~/.claude/settings.json.
    // The AI Native Lab MCP Manager UI persists per-server enable/disable state
    // there (see mcp-loader.ts:57-62 — original loadAndMerge does the same
    // for the cached path). Without this, a DB-provider session would
    // silently re-enable a project MCP the user toggled off (or fail to
    // enable one they overrode on), creating a state mismatch between the
    // UI and what the SDK actually loads.
    const userSettings = readJson(userSettingsJsonPath());
    const overrides = (userSettings.mcpServerOverrides || {}) as Record<string, { enabled?: boolean }>;

    const resolved: Record<string, MCPServerConfig> = {};
    for (const [name, server] of Object.entries(rawServers)) {
      // UI override takes precedence over the file's own `enabled` field.
      // Same precedence as loadAndMerge() so behavior stays consistent
      // across the cached path and the per-cwd path.
      const override = overrides[name];
      const effectiveEnabled = override?.enabled !== undefined ? override.enabled : server.enabled;
      if (effectiveEnabled === false) continue;

      const out = { ...server };
      if (out.env) {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(out.env)) {
          if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
            const settingKey = value.slice(2, -1);
            env[key] = getSetting(settingKey) || '';
          } else if (typeof value === 'string') {
            env[key] = value;
          }
        }
        out.env = env;
      }
      resolved[name] = out;
    }

    return Object.keys(resolved).length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}

// ── Why settings.json.mcpServers is a dead field ─────────────────────
//
// The bundled Claude Code 2.1.203 binary (which ships inside the
// `@anthropic-ai/claude-agent-sdk-<platform>` subpackage) reads MCP
// servers from these locations only:
//
//   1. `~/.claude.json`         user-scope (under `mcpServers`)
//   2. `<cwd>/.mcp.json`        project-scope (under `mcpServers`)
//   3. `--mcp-config <json>`    CLI flag (what the SDK populates from
//                               queryOptions.mcpServers — used for our
//                               in-process MCPs + ${...}-resolved servers)
//
// `~/.claude/settings.json` is loaded for its `env`, `permissions`,
// `hooks`, `enabledPlugins`, `mcpServerOverrides`, etc. — but its
// `mcpServers` field is silently ignored. Verified empirically by
// inspecting the bundled binary's `mcp list` output against every
// `--setting-sources` combination: settings.json.mcpServers never
// appears, .claude.json.mcpServers always does (under any flag that
// includes 'user', or the no-flag default).
// (首次实证于 2.1.141；升级 2.1.203 时用隔离 HOME 三来源实验复测，结论不变。)
//
// `claude mcp add -s user <name> -- <cmd>` confirms this from the other
// direction: the binary itself writes to `~/.claude.json`, never to
// settings.json. So we follow the same convention.
//
// ⚠️ 2.1.196 起 `.mcp.json` 信任收紧（实证于 2.1.203）：CLI 场景下未批准
// 目录的 `<cwd>/.mcp.json` 显示 "⏸ Pending approval" 且不自动 spawn（批准
// 记录在 ~/.claude.json 的 projects[cwd]）。对本应用无回归：standalone
// 自带 MCP 与 DB-provider 模式的项目 .mcp.json 都由本模块读出后经
// queryOptions.mcpServers（--mcp-config 通道，上面第 3 条）程序化注入，
// 不经过该批准门控；仅 env 模式（settingSources 含 project）的 SDK 原生
// 加载路径受影响，与官方 CLI 行为一致，属预期安全行为而非本应用回归。

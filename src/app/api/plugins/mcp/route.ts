import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  invalidateMcpCache,
  migrateSettingsMcpServersToClaudeJson,
} from '@/lib/mcp-loader';
import type {
  MCPServerConfig,
  MCPConfigResponse,
  ErrorResponse,
  SuccessResponse,
} from '@/types';

// ── File-location semantics ──────────────────────────────────────────
//
// User-scope MCP servers live in `~/.claude.json.mcpServers` — that's
// the only file the bundled Claude Code binary actually reads. See
// `mcp-loader.ts` for the empirical proof and migration logic.
//
// `~/.claude/settings.json.mcpServers` was the legacy write target;
// the migration helper moves any stragglers out and clears the field.
// We never write to it anymore.
//
// `~/.claude/settings.json.mcpServerOverrides` is still used to persist
// enable/disable state for project-scope (read-only) `.mcp.json` servers.

function userSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function userClaudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Atomic write: writes to a sibling tempfile then renames. Both
 * `~/.claude.json` and `~/.claude/settings.json` hold long-lived state
 * owned by the bundled binary — a partial write would corrupt it.
 */
function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = path.join(dir, `.${path.basename(filePath)}.codepilot-tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export async function GET(): Promise<NextResponse<MCPConfigResponse | ErrorResponse>> {
  try {
    // Migrate any legacy settings.json.mcpServers entries before reading,
    // so the UI sees a converged state on first load after upgrade.
    migrateSettingsMcpServersToClaudeJson();

    const settings = readJsonFile(userSettingsPath());
    const userConfig = readJsonFile(userClaudeJsonPath());
    const userConfigServers = (userConfig.mcpServers || {}) as Record<string, MCPServerConfig>;

    // Project-scope servers (read-only for CodePilot; the file is part of
    // the project's source tree).
    const projectMcp = readJsonFile(path.join(process.cwd(), '.mcp.json'));
    const projectServers = (projectMcp.mcpServers || {}) as Record<string, MCPServerConfig>;

    // Merge with source tags. Priority: claude.json > project. Since
    // settings.json.mcpServers is no longer a valid source, it doesn't
    // participate in the merge — but if migration failed (e.g., disk
    // full), we DON'T silently drop the entries: we surface them with a
    // distinct _source so the UI can show them and the user knows
    // something needs attention.
    const mcpServers: Record<string, MCPServerConfig & { _source?: string }> = {};
    for (const [name, server] of Object.entries(projectServers)) {
      mcpServers[name] = { ...server, _source: 'project' };
    }
    for (const [name, server] of Object.entries(userConfigServers)) {
      mcpServers[name] = { ...server, _source: 'claude.json' };
    }
    // Defensive: if migration failed and settings.json still has stragglers,
    // expose them so the UI doesn't pretend they don't exist. They won't be
    // loaded by the SDK (dead field), but at least the user can re-save
    // them through the UI to trigger a fresh write to .claude.json.
    const legacySettingsServers = (settings.mcpServers || {}) as Record<string, MCPServerConfig>;
    for (const [name, server] of Object.entries(legacySettingsServers)) {
      if (!mcpServers[name]) {
        mcpServers[name] = { ...server, _source: 'legacy-settings.json' };
      }
    }

    // For project-source servers, check if settings.json has an enabled override
    // (project .mcp.json is read-only; we persist enabled state to settings.json)
    const settingsOverrides = (settings.mcpServerOverrides || {}) as Record<string, { enabled?: boolean }>;
    for (const [name, server] of Object.entries(mcpServers)) {
      if (server._source === 'project' && settingsOverrides[name]?.enabled !== undefined) {
        mcpServers[name] = { ...server, enabled: settingsOverrides[name].enabled };
      }
    }

    return NextResponse.json({ mcpServers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read MCP config' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    migrateSettingsMcpServersToClaudeJson();

    const body = await request.json();
    const incoming = body.mcpServers as Record<string, MCPServerConfig & { _source?: string }>;

    // Split incoming by source. Everything user-scope (no _source,
    // _source='claude.json', or _source='legacy-settings.json') goes to
    // `~/.claude.json`. Project-scope only persists enable/disable to
    // settings.json.mcpServerOverrides.
    const forUserConfig: Record<string, MCPServerConfig> = {};
    let forProjectOverrides: Record<string, { enabled?: boolean }> | undefined;

    for (const [name, server] of Object.entries(incoming)) {
      const { _source, ...cleanServer } = server;
      if (_source === 'project') {
        if (cleanServer.enabled !== undefined) {
          if (!forProjectOverrides) forProjectOverrides = {};
          forProjectOverrides[name] = { enabled: cleanServer.enabled };
        }
      } else {
        // claude.json | legacy-settings.json | undefined → user-scope
        forUserConfig[name] = cleanServer;
      }
    }

    // Write `~/.claude.json` first (it's authoritative for what the SDK loads).
    const userConfig = readJsonFile(userClaudeJsonPath());
    userConfig.mcpServers = forUserConfig;
    writeJsonAtomic(userClaudeJsonPath(), userConfig);

    // Then update settings.json overrides. Also strip any lingering
    // mcpServers field defensively — the PUT body is the new canonical
    // state for user-scope MCPs, anything still in settings.json would
    // become a phantom on the next GET.
    const settings = readJsonFile(userSettingsPath());
    if (forProjectOverrides) {
      settings.mcpServerOverrides = forProjectOverrides;
    }
    if ('mcpServers' in settings) {
      delete settings.mcpServers;
    }
    writeJsonAtomic(userSettingsPath(), settings);

    invalidateMcpCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update MCP config' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    migrateSettingsMcpServersToClaudeJson();

    const body = await request.json();
    const { name, server } = body as { name: string; server: MCPServerConfig };

    // stdio servers require command; sse/http servers require url
    const isRemote = server?.type === 'sse' || server?.type === 'http';
    if (!name || !server || (!isRemote && !server.command) || (isRemote && !server.url)) {
      return NextResponse.json(
        { error: isRemote ? 'Name and server URL are required' : 'Name and server command are required' },
        { status: 400 }
      );
    }

    // Check `~/.claude.json` for collisions. We don't need to check
    // settings.json anymore — migration moves everything out, and even
    // if migration failed, settings.json entries are dead so a name
    // collision there isn't a real conflict (the new write will succeed
    // and supersede the dead one once the migration retry sweeps it).
    const userConfig = readJsonFile(userClaudeJsonPath());
    const userConfigServers = (userConfig.mcpServers || {}) as Record<string, MCPServerConfig>;
    if (userConfigServers[name]) {
      return NextResponse.json(
        { error: `MCP server "${name}" already exists` },
        { status: 409 }
      );
    }

    userConfigServers[name] = server;
    userConfig.mcpServers = userConfigServers;
    writeJsonAtomic(userClaudeJsonPath(), userConfig);

    invalidateMcpCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add MCP server' },
      { status: 500 }
    );
  }
}

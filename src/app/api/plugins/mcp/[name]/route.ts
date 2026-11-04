import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MCPServerConfig, ErrorResponse, SuccessResponse } from '@/types';
import {
  invalidateMcpCache,
  migrateSettingsMcpServersToClaudeJson,
} from '@/lib/mcp-loader';

function userSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

// `~/.claude.json` is the only file the bundled Claude Code binary
// actually reads for user-scope MCP servers — see mcp-loader.ts for proof.
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

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = path.join(dir, `.${path.basename(filePath)}.codepilot-tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    migrateSettingsMcpServersToClaudeJson();

    const { name } = await params;
    const serverName = decodeURIComponent(name);

    let deleted = false;

    // Primary target: `~/.claude.json`.
    const userConfig = readJsonFile(userClaudeJsonPath());
    const userServers = (userConfig.mcpServers || {}) as Record<string, MCPServerConfig>;
    if (userServers[serverName]) {
      delete userServers[serverName];
      userConfig.mcpServers = userServers;
      writeJsonAtomic(userClaudeJsonPath(), userConfig);
      deleted = true;
    }

    // Defensive sweep: if migration earlier failed for some reason, an
    // entry might still exist in the legacy settings.json location. Drop
    // it too so the UI's GET no longer surfaces it.
    const settings = readJsonFile(userSettingsPath());
    const settingsServers = (settings.mcpServers || {}) as Record<string, MCPServerConfig>;
    if (settingsServers[serverName]) {
      delete settingsServers[serverName];
      // If the field is now empty, remove it entirely — keeps settings.json tidy.
      if (Object.keys(settingsServers).length === 0) {
        delete settings.mcpServers;
      } else {
        settings.mcpServers = settingsServers;
      }
      writeJsonAtomic(userSettingsPath(), settings);
      deleted = true;
    }

    if (!deleted) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not found` },
        { status: 404 }
      );
    }

    invalidateMcpCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete MCP server' },
      { status: 500 }
    );
  }
}

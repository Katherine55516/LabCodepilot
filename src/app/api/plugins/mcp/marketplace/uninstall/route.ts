import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { setSetting } from '@/lib/db';
import { invalidateMcpCache } from '@/lib/mcp-loader';
import { readLedger, removeInstall } from '@/lib/mcp-market-ledger';
import type { MCPServerConfig } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.codepilot-tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

/**
 * POST /api/plugins/mcp/marketplace/uninstall
 * body: { serverName }
 *
 * 即时卸载（非流式）：删 ~/.claude.json mcpServers[key] + 清该 server 的密钥 +
 * 清台账 + 断开运行期连接。key 由台账解析。
 */
export async function POST(request: Request) {
  try {
    const { serverName } = (await request.json()) as { serverName?: string };
    if (!serverName) {
      return NextResponse.json({ error: 'serverName is required' }, { status: 400 });
    }

    const entry = readLedger()[serverName];
    if (!entry) {
      return NextResponse.json({ error: `台账中未找到 "${serverName}"` }, { status: 404 });
    }

    // 1. 删 mcpServers[key]
    const uc = readJsonFile(userClaudeJsonPath());
    const servers = (uc.mcpServers || {}) as Record<string, MCPServerConfig>;
    if (servers[entry.key]) {
      delete servers[entry.key];
      uc.mcpServers = servers;
      writeJsonAtomic(userClaudeJsonPath(), uc);
    }

    // 2. 清密钥（置空；前缀 mcp_secret_ 仍走加密路径但值为空）
    for (const k of entry.secretKeys || []) {
      try { setSetting(k, ''); } catch { /* ignore */ }
    }

    // 3. 清台账 + 失效缓存
    removeInstall(serverName);
    invalidateMcpCache();

    // 4. 断开运行期连接（best-effort）
    try {
      const { disconnectServer } = await import('@/lib/mcp-connection-manager');
      await disconnectServer(entry.key);
    } catch { /* 未连接则忽略 */ }

    return NextResponse.json({ success: true, key: entry.key });
  } catch (error) {
    console.error('[mcp/marketplace/uninstall] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '卸载失败' },
      { status: 500 },
    );
  }
}

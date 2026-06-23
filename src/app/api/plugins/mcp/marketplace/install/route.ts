import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getOfficialServer } from '@/lib/mcp-registry-client';
import { assessMcp } from '@/lib/mcp-trust';
import { buildConfig, prefetchCommand, mapServer } from '@/lib/server-json-mapper';
import { setSetting } from '@/lib/db';
import { invalidateMcpCache } from '@/lib/mcp-loader';
import { recordInstall } from '@/lib/mcp-market-ledger';
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

/** 原子写：sibling tempfile + rename，避免破坏内置二进制的长存状态。 */
function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.codepilot-tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server';
}

/**
 * POST /api/plugins/mcp/marketplace/install
 * body: { serverName, key?, packageIndex?, prefer?, inputs?: Record<string,string> }
 *
 * SSE 流（event: output / done / error），对照 skills/marketplace/install：
 *  1. 拉 server.json → buildConfig（密钥→占位符 + secretsToStore）
 *  2. prefetch 预热包（流式进度，规避冷启动超时；best-effort，失败不阻断）
 *  3. 写密钥（加密）→ 写 ~/.claude.json mcpServers（原子）→ 记台账 → invalidateMcpCache
 */
export async function POST(request: Request) {
  let body: {
    serverName?: string;
    key?: string;
    packageIndex?: number;
    prefer?: 'package' | 'remote';
    inputs?: Record<string, string>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { serverName, prefer, packageIndex, inputs = {} } = body;
  if (!serverName) {
    return NextResponse.json({ error: 'serverName is required' }, { status: 400 });
  }

  // 拉 server.json（流前置校验，错误以 JSON 返回）
  const server = await getOfficialServer(serverName);
  if (!server) {
    return NextResponse.json({ error: `未找到 server "${serverName}"` }, { status: 404 });
  }

  // 服务端强制黑名单拦截（纵深防御——不信任客户端，命中即拒装）
  const assessment = assessMcp(server);
  if (assessment.blocked) {
    return NextResponse.json(
      { error: `该 server 已被安全黑名单拦截：${assessment.blockReason || '已知风险'}` },
      { status: 422 },
    );
  }

  const opts = { prefer, packageIndex };
  const { config, secretsToStore } = buildConfig(server, inputs, opts);
  if (!config.command && !config.url) {
    return NextResponse.json({ error: '该 server 无可用的本地包或远程端点' }, { status: 422 });
  }

  // 决定写入 mcpServers 的 key（去重）
  const userConfig = readJsonFile(userClaudeJsonPath());
  const existing = (userConfig.mcpServers || {}) as Record<string, MCPServerConfig>;
  let key = sanitizeKey(body.key || mapServer(server, opts).suggestedKey);
  if (existing[key]) {
    let n = 2;
    while (existing[`${key}-${n}`]) n++;
    key = `${key}-${n}`;
  }

  const prefetch = prefetchCommand(server, opts);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const finalize = () => {
        try {
          // 1. 写密钥（前缀 mcp_secret_ → db.ts 自动加密）
          for (const [k, v] of Object.entries(secretsToStore)) setSetting(k, v);

          // 2. 写 ~/.claude.json mcpServers（原子）
          const uc = readJsonFile(userClaudeJsonPath());
          const servers = (uc.mcpServers || {}) as Record<string, MCPServerConfig>;
          servers[key] = config;
          uc.mcpServers = servers;
          writeJsonAtomic(userClaudeJsonPath(), uc);

          // 3. 记台账 + 失效缓存
          recordInstall(serverName, {
            key,
            version: server.version,
            source: 'official',
            installedAt: new Date().toISOString(),
            secretKeys: Object.keys(secretsToStore),
          });
          invalidateMcpCache();

          send('output', `已写入配置 "${key}"，将在下次对话时自动连接。`);
          send('done', key);
        } catch (e) {
          send('error', e instanceof Error ? e.message : '写入配置失败');
        } finally {
          controller.close();
        }
      };

      if (!prefetch) {
        send('output', '远程 server，无需预热下载。');
        finalize();
        return;
      }

      send('output', `预热下载：${prefetch.command} ${prefetch.args.join(' ')}`);
      const child = spawn(prefetch.command, prefetch.args, {
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        shell: false,
      });
      // 兜底超时：预热慢不应卡死安装（失败则继续，首次连接退化为冷启动）
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 180_000);

      child.stdout?.on('data', (c: Buffer) => send('output', c.toString()));
      child.stderr?.on('data', (c: Buffer) => send('output', c.toString()));
      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) send('output', '预热完成 ✓');
        else send('output', `预热未完成（code ${code}），首次连接可能需要等待下载。`);
        finalize();
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        send('output', `预热跳过：${err.message}`);
        finalize();
      });
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

/**
 * runtime-check.ts — MCP 安装前运行时预检（Phase 2b）。
 *
 * stdio server 靠本机运行时拉起（npx→Node.js、uvx→uv、docker→Docker）。GUI 启动的打包版
 * 即便 Electron 主进程已扩展 PATH（见 electron/main.ts），用户也可能根本没装该运行时。
 * 这里在安装前检测命令是否可解析，缺失则给友好引导（软警告，不硬拦——用户可装完再补）。
 *
 * 解析范围：process.env.PATH（打包版已是 expanded PATH）∪ platform.getExtraPathDirs()。
 *
 * 文档：docs/exec-plans/active/mcp-marketplace.md
 */

import fs from 'fs';
import path from 'path';
import { getExtraPathDirs, isWindows } from '@/lib/platform';
import type { MCPServerConfig, McpRuntimeRequirement } from '@/types';

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 命令是否可在 PATH（含扩展目录）中解析到。绝对/相对路径直接判存在。 */
export function isCommandAvailable(command: string): boolean {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\')) {
    return isFile(command);
  }
  const exts = isWindows ? ['.cmd', '.exe', '.bat', ''] : [''];
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  const dirs = [...pathDirs, ...getExtraPathDirs()];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (const ext of exts) {
      if (isFile(path.join(dir, command + ext))) return true;
    }
  }
  return false;
}

interface RuntimeMeta {
  kind: McpRuntimeRequirement['kind'];
  name: string;
  url?: string;
}

/** 由命令名映射到运行时元信息。 */
export function runtimeMetaFor(command: string): RuntimeMeta {
  const base = (command.split(/[\\/]/).pop() || command).toLowerCase();
  if (base === 'npx' || base === 'node' || base === 'bunx' || base === 'pnpm' || base === 'yarn') {
    return { kind: 'node', name: 'Node.js', url: 'https://nodejs.org' };
  }
  if (base === 'uvx' || base === 'uv') {
    return { kind: 'uv', name: 'uv', url: 'https://docs.astral.sh/uv/getting-started/installation/' };
  }
  if (base === 'docker' || base === 'podman') {
    return { kind: 'docker', name: 'Docker', url: 'https://www.docker.com/products/docker-desktop/' };
  }
  if (base === 'dnx' || base === 'dotnet') {
    return { kind: 'dotnet', name: '.NET', url: 'https://dotnet.microsoft.com/download' };
  }
  return { kind: 'unknown', name: base };
}

/**
 * 预检某个配置所需运行时。远程（无 command）无需运行时 → 返回 null。
 */
export function checkRuntimeForConfig(config: MCPServerConfig | null | undefined): McpRuntimeRequirement | null {
  if (!config?.command) return null;
  const meta = runtimeMetaFor(config.command);
  return {
    kind: meta.kind,
    command: config.command,
    name: meta.name,
    url: meta.url,
    available: isCommandAvailable(config.command),
  };
}

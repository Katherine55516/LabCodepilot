/**
 * cowork-transfer.ts — 宿主 ↔ 沙箱 VM 的文件/查询通道。
 *
 * P1-C:传输从 SSH/scp 换成 guest-daemon 的 vsock RPC(见 cowork-vsock.ts +
 * scripts/poc/cowork/cowork-daemon.py)。claude-client 侧的函数签名保持稳定
 * (ensureSessionWorkspace/pushFileToVm/listNewFiles/removeSessionDir);流式
 * 读取因 vsock connect 变 async,同步改 API 路由这一个调用方。
 *
 * 安全边界:sessionId 强制 hex 校验;下载路径的权威校验(realpath + workspace
 * 前缀)在 daemon 侧完成(文件真身在那),本模块另做一道廉价的 `..` 早拒。
 */
import path from 'path';
import type { VmArtifactFile } from '@/types';
import {
  vsockHealthy,
  rpcMkdirWorkspace,
  rpcWriteFile,
  rpcListFiles,
  rpcReadFileStream,
  rpcArchiveStream,
  rpcRemoveSession,
  rpcReconcileSessions,
} from './cowork-vsock';
import fs from 'fs';

const SESSIONS_ROOT = '/home/agent/sessions';

function assertSessionId(sessionId: string): void {
  if (!/^[a-f0-9]{8,64}$/i.test(sessionId)) {
    throw new Error(`invalid cowork sessionId: ${sessionId.slice(0, 20)}`);
  }
}

export function sessionWorkspace(sessionId: string): string {
  assertSessionId(sessionId);
  return `${SESSIONS_ROOT}/${sessionId}/workspace`;
}

/** VM 通道是否可用(vsock daemon 健康应答)。轻量探活。 */
export async function vmChannelReady(): Promise<boolean> {
  return vsockHealthy();
}

/** 确保会话 workspace 存在(幂等)。 */
export async function ensureSessionWorkspace(sessionId: string): Promise<string> {
  assertSessionId(sessionId);
  return rpcMkdirWorkspace(sessionId);
}

/**
 * 推送一个本地文件进会话 workspace,返回 VM 内绝对路径。
 * fileName 的清洗与 daemon 侧一致(basename + 白名单)。
 */
export async function pushFileToVm(sessionId: string, localPath: string, fileName: string): Promise<string> {
  assertSessionId(sessionId);
  const data = await fs.promises.readFile(localPath);
  const dest = await rpcWriteFile(sessionId, fileName, data);
  const { audit } = await import('./cowork-audit');
  audit('file_upload', { sessionId, detail: `${fileName} (${data.length}B)` }); // P3-C 安全审计:数据进 VM
  return dest;
}

/**
 * 列出会话 workspace 中 sinceEpochMs 之后新增/修改的文件(回合产物 diff)。
 * excludePaths:本回合上传推入的文件,按精确路径排除。
 */
export async function listNewFiles(
  sessionId: string,
  sinceEpochMs: number,
  excludePaths: string[] = [],
): Promise<VmArtifactFile[]> {
  assertSessionId(sessionId);
  const exclude = new Set(excludePaths);
  const files = await rpcListFiles(sessionId, sinceEpochMs);
  return files
    .filter((f) => !exclude.has(f.path))
    .map((f) => ({ path: f.path, name: f.name, size: f.size, mtime: f.mtime }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 廉价的 host 侧路径早拒(拒绝明显的 `..` 逃逸与非本会话前缀)。权威校验
 * (realpath 解符号链接 + workspace 前缀)在 daemon 的 op_read_file 内完成。
 */
export function assertPathInWorkspace(sessionId: string, vmPath: string): string {
  const ws = sessionWorkspace(sessionId);
  if (vmPath.includes('\0') || vmPath.includes('..')) throw new Error('invalid path');
  if (vmPath !== ws && !vmPath.startsWith(ws + '/')) {
    throw new Error(`path escapes session workspace: ${vmPath.slice(0, 80)}`);
  }
  return vmPath;
}

/** 流式读取 VM 内单个文件(daemon 侧做 realpath 权威校验)。 */
export async function readFileStream(sessionId: string, vmPath: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  assertPathInWorkspace(sessionId, vmPath);
  const r = await rpcReadFileStream(sessionId, vmPath);
  const { audit } = await import('./cowork-audit');
  audit('file_download', { sessionId, detail: `${vmPath.split('/').pop()} (${r.size}B)` }); // P3-C:数据出 VM
  return r;
}

/** 流式打包整个会话 workspace 为 tar.gz。 */
export async function archiveStream(sessionId: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  assertSessionId(sessionId);
  const r = await rpcArchiveStream(sessionId);
  const { audit } = await import('./cowork-audit');
  audit('archive_download', { sessionId, detail: `workspace.tar.gz (${r.size}B)` }); // P3-C:数据出 VM
  return r;
}

/** 会话删除时清理 VM 内的会话目录。 */
export async function removeSessionDir(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  await rpcRemoveSession(sessionId);
}

/**
 * E4.1 存储对账:删除 VM 内不在 keep 名单里的孤儿会话目录。
 * removeSessionDir 是 best-effort(VM 休眠时删除会话会留残留),
 * VM 每次就绪后由 vm-manager 带全量现存会话 id 调用本函数兜底,
 * 防止 guest 磁盘被已删除会话的遗留文件占满。
 */
export async function reconcileSessionDirs(keepSessionIds: string[]): Promise<string[]> {
  return rpcReconcileSessions(keepSessionIds.filter((id) => /^[0-9a-f]{8,64}$/i.test(id)));
}

export { SESSIONS_ROOT };

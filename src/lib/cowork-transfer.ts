/**
 * cowork-transfer.ts — 宿主 ↔ 沙箱的文件/查询通道契约层。
 *
 * R1-3:底层从直连 vsock 改为委托 CoworkBackend(getCoworkBackend)——对 claude-client /
 * artifacts route / cowork-guards 的函数签名保持稳定,数据实际去向由当前后端(remote 容器 /
 * vfkit VM)决定。sessionWorkspace 保持同步(cowork-guards 拼能力边界系统提示时同步取用),
 * 按设置 cowork_backend 返回对应沙箱内路径。
 *
 * 安全边界:sessionId 强制 hex 校验;下载路径的权威校验(realpath + workspace 前缀)在后端侧
 * (vfkit daemon / remote 服务端)完成,本模块另做一道廉价的 `..` 早拒。
 */
import type { VmArtifactFile } from '@/types';
import { getCoworkBackend } from './cowork-backend';
import { getSetting } from './db';
import fs from 'fs';

const VFKIT_SESSIONS_ROOT = '/home/agent/sessions';

function assertSessionId(sessionId: string): void {
  if (!/^[a-f0-9]{8,64}$/i.test(sessionId)) {
    throw new Error(`invalid cowork sessionId: ${sessionId.slice(0, 20)}`);
  }
}

/**
 * 会话 workspace 在沙箱内的绝对路径。同步(按设置直接算,不取后端实例)以兼容
 * cowork-guards 的同步系统提示拼接:remote 容器统一 `/workspace`,vfkit VM 为
 * `/home/agent/sessions/<id>/workspace`。须与各 backend 的 sessionWorkspacePath 一致。
 */
export function sessionWorkspace(sessionId: string): string {
  assertSessionId(sessionId);
  return getSetting('cowork_backend') === 'remote'
    ? '/workspace'
    : `${VFKIT_SESSIONS_ROOT}/${sessionId}/workspace`;
}

/** 通道是否可用(后端健康应答)。轻量探活。 */
export async function vmChannelReady(): Promise<boolean> {
  return (await getCoworkBackend()).channelReady();
}

/** 确保会话 workspace 存在(幂等)。 */
export async function ensureSessionWorkspace(sessionId: string): Promise<string> {
  assertSessionId(sessionId);
  return (await getCoworkBackend()).ensureWorkspace(sessionId);
}

/** 推送一个本地文件进会话 workspace,返回沙箱内绝对路径。 */
export async function pushFileToVm(sessionId: string, localPath: string, fileName: string): Promise<string> {
  assertSessionId(sessionId);
  const data = await fs.promises.readFile(localPath);
  const dest = await (await getCoworkBackend()).writeFile(sessionId, fileName, data);
  const { audit } = await import('./cowork-audit');
  audit('file_upload', { sessionId, detail: `${fileName} (${data.length}B)` }); // P3-C:数据进沙箱
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
  const files = await (await getCoworkBackend()).listFiles(sessionId, sinceEpochMs);
  return files
    .filter((f) => !exclude.has(f.path))
    .map((f) => ({ path: f.path, name: f.name, size: f.size, mtime: f.mtime }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 廉价的 host 侧路径早拒(拒绝明显的 `..` 逃逸与非本会话前缀)。权威校验(realpath 解
 * 符号链接 + workspace 前缀)在后端侧完成。
 */
export function assertPathInWorkspace(sessionId: string, vmPath: string): string {
  const ws = sessionWorkspace(sessionId);
  if (vmPath.includes('\0') || vmPath.includes('..')) throw new Error('invalid path');
  if (vmPath !== ws && !vmPath.startsWith(ws + '/')) {
    throw new Error(`path escapes session workspace: ${vmPath.slice(0, 80)}`);
  }
  return vmPath;
}

/** 流式读取沙箱内单个文件(后端做权威校验)。 */
export async function readFileStream(sessionId: string, vmPath: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  assertPathInWorkspace(sessionId, vmPath);
  const r = await (await getCoworkBackend()).readFileStream(sessionId, vmPath);
  const { audit } = await import('./cowork-audit');
  audit('file_download', { sessionId, detail: `${vmPath.split('/').pop()} (${r.size}B)` }); // P3-C:数据出沙箱
  return r;
}

/** 流式打包整个会话 workspace 为 tar.gz。 */
export async function archiveStream(sessionId: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  assertSessionId(sessionId);
  const r = await (await getCoworkBackend()).archiveStream(sessionId);
  const { audit } = await import('./cowork-audit');
  audit('archive_download', { sessionId, detail: `workspace.tar.gz (${r.size}B)` }); // P3-C:数据出沙箱
  return r;
}

/** 会话删除时清理沙箱内的会话目录/容器。 */
export async function removeSessionDir(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  await (await getCoworkBackend()).removeSession(sessionId);
}

/**
 * E4.1 存储对账:删除沙箱内不在 keep 名单里的孤儿会话。removeSessionDir 是 best-effort
 * (休眠时删除会话会留残留),后端每次就绪后由调用方带全量现存会话 id 调用本函数兜底。
 */
export async function reconcileSessionDirs(keepSessionIds: string[]): Promise<string[]> {
  return (await getCoworkBackend()).reconcile(keepSessionIds.filter((id) => /^[0-9a-f]{8,64}$/i.test(id)));
}

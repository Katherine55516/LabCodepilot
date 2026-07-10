/**
 * cowork-transfer.ts — 宿主 ↔ 沙箱 VM 的文件/查询通道。
 *
 * P1-A 实现为 SSH(复用 POC 的密钥与 vm-ip 资产);P1-C 会替换为
 * guest-daemon 的 vsock RPC——调用方只依赖本模块导出的函数签名,
 * 传输机制平替时零改动。
 *
 * 安全边界(本模块自防,API 层另有一道):
 * - sessionId 严格校验(hex),它会拼进远端 shell 命令与路径
 * - 远端命令统一经 shq() 单引号转义,防注入
 * - vmPath 读取前 realpath 校验必须落在该会话 workspace 内(防 ../ 与符号链接逃逸)
 */
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { VmArtifactFile } from '@/types';

const execFileAsync = promisify(execFile);

const POC_DIR = path.join(os.homedir(), '.codepilot', 'cowork-poc');
const SSH_KEY = path.join(POC_DIR, 'ssh', 'id_ed25519');
const VM_IP_FILE = path.join(POC_DIR, 'vm-ip');
const GUEST_USER = 'agent';
const SESSIONS_ROOT = '/home/agent/sessions';

/** 单引号 shell 转义:'abc'"'"'def' 形式,适用于任意字节串。 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

function assertSessionId(sessionId: string): void {
  if (!/^[a-f0-9]{8,64}$/i.test(sessionId)) {
    throw new Error(`invalid cowork sessionId: ${sessionId.slice(0, 20)}`);
  }
}

export function sessionWorkspace(sessionId: string): string {
  assertSessionId(sessionId);
  return `${SESSIONS_ROOT}/${sessionId}/workspace`;
}

function vmIp(): string {
  const ip = fs.readFileSync(VM_IP_FILE, 'utf8').trim();
  if (!/^[0-9.]+$/.test(ip)) throw new Error('invalid vm-ip');
  return ip;
}

function sshArgs(): string[] {
  return [
    '-i', SSH_KEY,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR',
    '-o', 'ConnectTimeout=8',
  ];
}

async function sshExec(remoteCmd: string, timeoutMs = 20000): Promise<string> {
  const { stdout } = await execFileAsync(
    'ssh', [...sshArgs(), `${GUEST_USER}@${vmIp()}`, remoteCmd],
    { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

/** VM 通道是否可用(vm-ip 存在且 SSH 应答)。轻量探活,3s 超时。 */
export async function vmChannelReady(): Promise<boolean> {
  try {
    if (!fs.existsSync(VM_IP_FILE)) return false;
    await execFileAsync('ssh', [...sshArgs(), '-o', 'ConnectTimeout=3', `${GUEST_USER}@${vmIp()}`, 'true'], { timeout: 6000 });
    return true;
  } catch {
    return false;
  }
}

/** 确保会话 workspace 存在(幂等)。 */
export async function ensureSessionWorkspace(sessionId: string): Promise<string> {
  const ws = sessionWorkspace(sessionId);
  await sshExec(`mkdir -p ${shq(ws)}`);
  return ws;
}

/**
 * 推送一个本地文件进会话 workspace,返回 VM 内绝对路径。
 * fileName 会被 basename + 白名单清洗(与上传链路的 safeName 规则一致)。
 */
export async function pushFileToVm(sessionId: string, localPath: string, fileName: string): Promise<string> {
  const ws = await ensureSessionWorkspace(sessionId);
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._一-龥-]/g, '_');
  const dest = `${ws}/${safeName}`;
  await execFileAsync(
    'scp', [...sshArgs(), localPath, `${GUEST_USER}@${vmIp()}:${dest}`],
    { timeout: 120000 },
  );
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
  const ws = sessionWorkspace(sessionId);
  const sinceSec = Math.floor(sinceEpochMs / 1000);
  // stat -c '%s|%Y|%n':size|mtime|path,GNU coreutils(Debian guest)
  const out = await sshExec(
    `[ -d ${shq(ws)} ] && find ${shq(ws)} -type f -newermt @${sinceSec} -exec stat -c '%s|%Y|%n' {} + 2>/dev/null || true`,
  );
  const exclude = new Set(excludePaths);
  const files: VmArtifactFile[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d+)\|(\d+)\|(.+)$/);
    if (!m) continue;
    const [, size, mtime, p] = m;
    if (exclude.has(p)) continue;
    files.push({ path: p, name: path.posix.basename(p), size: Number(size), mtime: Number(mtime) * 1000 });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 校验 vmPath 确实位于该会话 workspace 内(realpath 解析符号链接后前缀判定)。
 * 通过则返回规范化路径,否则抛错。
 */
export async function assertPathInWorkspace(sessionId: string, vmPath: string): Promise<string> {
  const ws = sessionWorkspace(sessionId);
  if (vmPath.includes('\0')) throw new Error('invalid path');
  const real = (await sshExec(`realpath -e ${shq(vmPath)}`)).trim();
  if (real !== ws && !real.startsWith(ws + '/')) {
    throw new Error(`path escapes session workspace: ${vmPath.slice(0, 80)}`);
  }
  return real;
}

/**
 * 流式读取 VM 内单个文件(调用方需先 assertPathInWorkspace)。
 * 返回 ssh 子进程的 stdout 可读流与进程句柄(供上层处理退出码)。
 */
export function readFileStream(vmPath: string): { stream: NodeJS.ReadableStream; child: ReturnType<typeof spawn> } {
  const child = spawn('ssh', [...sshArgs(), `${GUEST_USER}@${vmIp()}`, `cat ${shq(vmPath)}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { stream: child.stdout!, child };
}

/** 流式打包整个会话 workspace 为 tar.gz。 */
export function archiveStream(sessionId: string): { stream: NodeJS.ReadableStream; child: ReturnType<typeof spawn> } {
  const ws = sessionWorkspace(sessionId);
  const child = spawn('ssh', [...sshArgs(), `${GUEST_USER}@${vmIp()}`, `cd ${shq(ws)} && tar czf - .`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { stream: child.stdout!, child };
}

/** 会话删除时清理 VM 内的会话目录。 */
export async function removeSessionDir(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  await sshExec(`rm -rf ${shq(`${SESSIONS_ROOT}/${sessionId}`)}`);
}

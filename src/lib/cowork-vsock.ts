/**
 * cowork-vsock.ts — 宿主侧 vsock RPC 客户端(Cowork 沙箱 P1-C)。
 *
 * 连 vfkit 暴露的 unix domain socket(透明代理到 guest 的 AF_VSOCK daemon,
 * 无握手、无魔数)。每个 RPC 一条新连接:写一行 JSON header,按 op 收发。
 * 取代 SSH/scp 成为运行时数据通道;cowork-transfer 的对外函数签名不变,
 * 只把内部实现从 ssh execFile 换成本模块。
 */
import net from 'net';
import fs from 'fs';

// M3:路径单一事实源迁至 cowork-paths;保留 re-export 兼容 claude-client 的既有 import。
export { VSOCK_SOCKET_PATH } from './cowork-paths';
import { VSOCK_SOCKET_PATH } from './cowork-paths';

export interface VmArtifact {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

function connect(timeoutMs = 8000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(VSOCK_SOCKET_PATH)) {
      reject(new Error('vsock socket not present (VM not started?)'));
      return;
    }
    const sock = net.createConnection({ path: VSOCK_SOCKET_PATH });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('vsock connect timeout'));
    }, timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function header(op: string, extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({ op, ...extra }) + '\n', 'utf8');
}

/**
 * 读到第一个 '\n' 为止的 JSON 响应,返回 {obj, rest}。
 * 关键:必须处理 'close'/'end' —— guest daemon 未监听时,vfkit 会 accept 宿主
 * 连接后立刻关闭(裸代理连不到 guest 就断),此时不会有 data 也不会有 error,
 * 只有 close;不处理就永久挂起(ensureDaemon 首探即卡死)。另加读超时兜底。
 */
function readJsonHeader(sock: net.Socket, timeoutMs = 8000): Promise<{ obj: Record<string, unknown>; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.off('data', onData);
      sock.off('error', onErr);
      sock.off('close', onClose);
      fn();
    };
    const onData = (d: Buffer) => {
      chunks.push(d);
      const buf = Buffer.concat(chunks);
      const nl = buf.indexOf(0x0a);
      if (nl >= 0) {
        finish(() => {
          try {
            resolve({ obj: JSON.parse(buf.subarray(0, nl).toString('utf8')), rest: buf.subarray(nl + 1) });
          } catch (e) {
            reject(e);
          }
        });
      }
    };
    const onErr = (e: Error) => finish(() => reject(e));
    const onClose = () => finish(() => reject(new Error('vsock closed before response (daemon not listening?)')));
    const timer = setTimeout(() => finish(() => { sock.destroy(); reject(new Error('vsock read timeout')); }), timeoutMs);
    sock.on('data', onData);
    sock.once('error', onErr);
    sock.once('close', onClose);
  });
}

/** 短 RPC:发 header(可选 body),读一行 JSON 响应,校验 ok。 */
async function rpcJson(op: string, extra: Record<string, unknown> = {}, body?: Buffer): Promise<Record<string, unknown>> {
  const sock = await connect();
  try {
    sock.write(header(op, extra));
    if (body) sock.write(body);
    const { obj } = await readJsonHeader(sock);
    if (!obj.ok) throw new Error(String(obj.error || `${op} failed`));
    return obj;
  } finally {
    sock.end();
  }
}

export interface VsockHealth {
  ok: boolean;
  /** daemon 版本(v1 时代的 daemon 不带此字段 → undefined,宿主据此走兼容路径)。 */
  version?: number;
  /** guest 内 ~/bin/claude 是否就绪(缺则宿主 installBinary 推入)。 */
  claude?: boolean;
  /** guest 内 claude binary 字节数(daemon v3;宿主比对不符则重推,版本偏斜自愈)。 */
  claudeSize?: number;
  /** daemon 进程 euid(daemon v4;宿主据此确认已提权 root 才开跑回合)。 */
  uid?: number;
}

/** 富健康探测:一次 RPC 拿全就绪信息(daemon 版本 + claude binary 状态)。 */
export async function vsockHealth(timeoutMs = 4000): Promise<VsockHealth> {
  let sock: net.Socket | null = null;
  try {
    sock = await connect(timeoutMs);
    sock.write(header('health'));
    const { obj } = await readJsonHeader(sock, timeoutMs);
    return {
      ok: obj.ok === true,
      version: typeof obj.version === 'number' ? obj.version : undefined,
      claude: obj.claude === true,
      claudeSize: typeof obj.claudeSize === 'number' ? obj.claudeSize : undefined,
      uid: typeof obj.uid === 'number' ? obj.uid : undefined,
    };
  } catch {
    return { ok: false };
  } finally {
    try { sock?.destroy(); } catch { /* ignore */ }
  }
}

/** 健康探活(布尔包装):连上并 health RPC 成功即就绪。daemon 未监听 → 连上即断 → false。 */
export async function vsockHealthy(timeoutMs = 4000): Promise<boolean> {
  return (await vsockHealth(timeoutMs)).ok;
}

/**
 * M1:把宿主侧可执行资产流式推入 guest(installBinary op,name 走 daemon 侧
 * 白名单,当前仅 'claude')。253MB 级文件走 createReadStream 管道(pipe 自带
 * 背压),daemon 落盘 + 原子替换后才回响应;本地 vsock 实测秒级,超时给足。
 */
export async function rpcInstallBinary(name: string, filePath: string, timeoutMs = 180_000): Promise<void> {
  const size = fs.statSync(filePath).size;
  const sock = await connect();
  try {
    sock.write(header('installBinary', { name, size }));
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(filePath);
      rs.once('error', reject);
      rs.once('end', () => resolve());
      sock.once('error', reject);
      rs.pipe(sock, { end: false });
    });
    const { obj } = await readJsonHeader(sock, timeoutMs);
    if (!obj.ok) throw new Error(String(obj.error || 'installBinary failed'));
  } finally {
    sock.end();
  }
}

export async function rpcMkdirWorkspace(sessionId: string): Promise<string> {
  const r = await rpcJson('mkdirWorkspace', { sessionId });
  return String(r.path);
}

export async function rpcWriteFile(sessionId: string, name: string, data: Buffer): Promise<string> {
  const r = await rpcJson('writeFile', { sessionId, name, size: data.length }, data);
  return String(r.path);
}

export async function rpcListFiles(sessionId: string, sinceMs: number): Promise<VmArtifact[]> {
  const r = await rpcJson('listFiles', { sessionId, since: sinceMs });
  return Array.isArray(r.files) ? (r.files as VmArtifact[]) : [];
}

export async function rpcRemoveSession(sessionId: string): Promise<void> {
  await rpcJson('removeSession', { sessionId });
}

/**
 * E4.1 存储对账:删除 VM 内 /home/agent/sessions 下不在 keep 名单里的孤儿
 * 会话目录(VM 休眠期间删除的会话残留)。返回被删除的目录名列表。
 */
export async function rpcReconcileSessions(keep: string[]): Promise<string[]> {
  const r = await rpcJson('reconcileSessions', { keep });
  return Array.isArray(r.removed) ? (r.removed as string[]) : [];
}

/**
 * 流式读取一个文件:先读 `{ok,size}` header,之后把 size 字节作为可读流吐出。
 * 返回一个 Readable(供 API 路由直接 pipe 到 HTTP 响应)。校验(realpath +
 * workspace 前缀)在 daemon 侧完成;失败会在 header 阶段抛错。
 */
export async function rpcReadFileStream(sessionId: string, vmPath: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  return streamOp('readFile', { sessionId, path: vmPath });
}

/** 流式打包 workspace 为 tar.gz(同 readFile 的 header+bytes 协议)。 */
export async function rpcArchiveStream(sessionId: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  return streamOp('archive', { sessionId });
}

async function streamOp(op: string, extra: Record<string, unknown>): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  const sock = await connect();
  let obj: Record<string, unknown>;
  let rest: Buffer;
  try {
    sock.write(header(op, extra));
    ({ obj, rest } = await readJsonHeader(sock));
  } catch (e) {
    sock.destroy();
    throw e;
  }
  if (!obj.ok) {
    sock.destroy();
    throw new Error(String(obj.error || `${op} failed`));
  }
  const size = Number(obj.size || 0);
  // 用 PassThrough 精确投递 size 字节:先灌 header 之后的 rest,再转发后续 data,
  // 满 size 即结束(daemon 发完 body 会关连接,这里以字节数为准更稳)。
  const { PassThrough } = require('stream') as typeof import('stream');
  const out = new PassThrough();
  let sent = 0;
  const push = (buf: Buffer) => {
    if (sent >= size) return;
    const take = buf.subarray(0, size - sent);
    out.write(take);
    sent += take.length;
    if (sent >= size) { out.end(); sock.end(); }
  };
  if (rest.length) push(rest);
  sock.on('data', push);
  sock.on('end', () => { if (sent < size) out.end(); });
  sock.on('error', (e) => out.destroy(e));
  return { stream: out, size };
}

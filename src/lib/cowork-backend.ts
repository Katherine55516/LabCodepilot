/**
 * cowork-backend.ts — 沙箱后端抽象(R1-2)。
 *
 * RD1(全平台统一远程):claude-client / cowork-transfer / cowork-status 只依赖本接口,
 * 不再直接摸 vfkit/vsock。接口收敛四组能力:生命周期、exec 端点、文件通道、凭证注入。
 *
 * 两个实现:
 *   - RemoteContainerBackend(cowork-backend-remote.ts,唯一活跃):调 cowork-server
 *     (HTTPS REST + WS forwarder),对应单公司裸金属服务器。
 *   - VfkitBackend(cowork-backend-vfkit.ts,保留不激活):把现有 cowork-vm-manager +
 *     cowork-vsock + cowork-proxy 包成 adapter,以防将来要本地离线版能捡回(RD1)。
 *
 * getCoworkBackend() 依设置 `cowork_backend` 选实现。R1-2 默认 'vfkit'(保持现状、零回归);
 * R1-3 切 'remote' 并改 claude-client 的注入链。
 */
import type { VmArtifact } from './cowork-vsock';

export type CoworkBackendKind = 'vfkit' | 'remote';

/** 后端就绪状态(平台无关,取代 vfkit 专属的 VmStatus 对外暴露)。 */
export interface CoworkBackendStatus {
  ready: boolean;
  /** 'ready' | 'starting' | 'stopped' | 'unavailable' | 'crashed' | ... */
  phase: string;
  reason?: string;
}

/** forwarder(SDK 当 claude spawn 的转发器)所需:脚本路径 + 连接 env。 */
export interface CoworkExecEndpoint {
  forwarderPath: string;
  env: Record<string, string>;
  /**
   * 跑 forwarder 用的 JS 运行时(传给 SDK 的 `executable`)。
   * forwarderPath 是 .mjs 时**必须给** —— 见 cowork-backend-remote.ts 的注释。
   * .sh 包装(vfkit)不需要:SDK 会直接 spawn 脚本本身。
   */
  runtimeExecutable?: string;
}

export interface CoworkCredential {
  realKey: string;
  realBase: string;
  authStyle: 'api_key' | 'auth_token';
}

export interface CoworkProgress {
  phase: string;
  detail?: string;
}

export interface CoworkBackend {
  readonly kind: CoworkBackendKind;

  // —— 生命周期 / 就绪 ——
  /** 确保会话沙箱就绪(vfkit:全局 VM;remote:会话容器)。冷启动会阻塞到就绪或判定不可用。 */
  ensureReady(sessionId: string): Promise<CoworkBackendStatus>;
  /** 只读状态探测,绝不触发启动(供 /api/cowork/status 可用性 gate,fail-closed)。 */
  getStatus(): Promise<CoworkBackendStatus>;
  /** 轻量通道探活。 */
  channelReady(): Promise<boolean>;
  /** 保活 / 释放(阻塞空闲回收;回合内 markActive、回合末 release)。 */
  markActive(sessionId: string): void;
  release(sessionId: string): void;
  /** 停止后端(vfkit:关 VM;remote:no-op,server 常驻)。 */
  stop(): Promise<void>;
  /** 冷启动进度发射器(starting/booting/provisioning/ready/failed);返回取消订阅。 */
  onProgress(cb: (p: CoworkProgress) => void): () => void;

  // —— exec 端点 ——
  execEndpoint(sessionId: string): CoworkExecEndpoint;
  /** 会话 workspace 在沙箱内的绝对路径(prompt 内文件路径改写用)。 */
  sessionWorkspacePath(sessionId: string): string;

  // —— 文件通道(cowork-transfer 委托)——
  ensureWorkspace(sessionId: string): Promise<string>;
  writeFile(sessionId: string, name: string, data: Buffer): Promise<string>;
  listFiles(sessionId: string, sinceMs: number): Promise<VmArtifact[]>;
  readFileStream(sessionId: string, vmPath: string): Promise<{ stream: NodeJS.ReadableStream; size: number }>;
  archiveStream(sessionId: string): Promise<{ stream: NodeJS.ReadableStream; size: number }>;
  removeSession(sessionId: string): Promise<void>;
  reconcile(keepSessionIds: string[]): Promise<string[]>;

  // —— 凭证注入(P3-B / R3;真 key 不进沙箱)——
  /** 注册会话凭证,返回给沙箱用的 token + 代理 base_url(真 key 只留宿主/服务端)。 */
  registerCredentials(sessionId: string, cred: CoworkCredential): Promise<{ token: string; baseUrl: string }>;
  revokeCredentials(sessionId: string): void;
}

// —— 工厂(单例,挂 globalThis 抗 hot-reload,呼应 vm-manager 哲学)——
type BackendGlobal = { __coworkBackend?: CoworkBackend; __coworkBackendKind?: CoworkBackendKind };
const g = globalThis as unknown as BackendGlobal;

/**
 * 当前后端。依设置 `cowork_backend`('vfkit' | 'remote')选实现,默认 'vfkit'(R1-2 保持现状)。
 * R1-3 起默认切 'remote'。切换设置后下次取用即新实现(单例按 kind 缓存)。
 */
export async function getCoworkBackend(): Promise<CoworkBackend> {
  // 延迟 import:只加载被选中的实现,未激活的后端不进冷启动路径(不触发其顶层副作用)。
  const { getSetting } = await import('./db');
  const kind: CoworkBackendKind = getSetting('cowork_backend') === 'remote' ? 'remote' : 'vfkit';
  if (g.__coworkBackend && g.__coworkBackendKind === kind) return g.__coworkBackend;
  const impl =
    kind === 'remote'
      ? (await import('./cowork-backend-remote')).remoteBackend
      : (await import('./cowork-backend-vfkit')).vfkitBackend;
  g.__coworkBackend = impl;
  g.__coworkBackendKind = kind;
  return impl;
}

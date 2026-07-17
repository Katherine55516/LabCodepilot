/**
 * cowork-backend-remote.ts — RemoteContainerBackend(唯一活跃,RD1)。
 *
 * 调 cowork-server(apps/cowork-server:HTTPS REST + WS forwarder),对应单公司裸金属
 * 服务器。配置来源:R1 dev 走设置 `cowork_remote_url` / `cowork_remote_token`;R5 由账号
 * 登录下发(复刻 image-cred-account-delivery 范式)。
 *
 * R1 完成度:生命周期(ensureReady/getStatus/channelReady/remove/reconcile)+ exec 端点
 * 已实现;**文件 op 留 R2**(throw NOT_IMPL);**凭证 R1 直通真 key、R3 换服务端一次性 token**。
 */
import fs from 'fs';
import path from 'path';
import type { CoworkBackend, CoworkBackendStatus, CoworkExecEndpoint, CoworkCredential, CoworkProgress } from './cowork-backend';
import type { VmArtifact } from './cowork-vsock';
import { getSetting } from './db';
import { bundledCoworkResource } from './cowork-paths';

const WORKSPACE = '/workspace'; // 容器内会话 workspace(named volume 挂载点)
const NOT_IMPL_R2 = 'cowork remote file op not implemented yet (R2)';

function remoteConfig() {
  const url = (getSetting('cowork_remote_url') || '').trim().replace(/\/+$/, '');
  const token = (getSetting('cowork_remote_token') || '').trim();
  return { url, token };
}

function wsEndpoint(url: string) {
  const u = new URL(url);
  return {
    scheme: u.protocol === 'https:' ? 'wss' : 'ws',
    host: u.hostname,
    port: u.port || (u.protocol === 'https:' ? '443' : '80'),
  };
}

async function api(method: string, pathname: string, body?: unknown): Promise<Record<string, unknown>> {
  const { url, token } = remoteConfig();
  if (!url) throw new Error('cowork_remote_url not configured');
  const res = await fetch(url + pathname, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`cowork-server ${method} ${pathname} → ${res.status}`);
  return res.json();
}

/** 解析 WS 转发器 forwarder-remote.mjs(R5 打包进 Resources;dev 走 apps/cowork-server)。 */
function remoteForwarderPath(): string {
  const candidates: string[] = [];
  const bundled = bundledCoworkResource('forwarder-remote.mjs');
  if (bundled) candidates.push(bundled);
  candidates.push(path.join(process.cwd(), 'apps/cowork-server/client/forwarder-remote.mjs'));
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

export const remoteBackend: CoworkBackend = {
  kind: 'remote',

  async ensureReady(sessionId: string): Promise<CoworkBackendStatus> {
    try { await api('POST', `/session/${sessionId}`); return { ready: true, phase: 'ready' }; }
    catch (e) { return { ready: false, phase: 'unavailable', reason: String((e as Error).message) }; }
  },
  async getStatus(): Promise<CoworkBackendStatus> {
    try { const h = await api('GET', '/health'); return { ready: !!h.ok, phase: h.ok ? 'ready' : 'unavailable' }; }
    catch (e) { return { ready: false, phase: 'unavailable', reason: String((e as Error).message) }; }
  },
  async channelReady(): Promise<boolean> { try { return !!(await api('GET', '/health')).ok; } catch { return false; } },
  markActive(_sessionId: string) { /* R4:远程侧 TTL 保活;R1 no-op(容器 sleep infinity 常驻) */ },
  release(_sessionId: string) { /* R4 */ },
  async stop() { /* server 常驻,no-op */ },
  onProgress(_cb: (p: CoworkProgress) => void) { return () => {}; /* remote ensure 秒级;进度细化 R4 */ },

  execEndpoint(sessionId: string): CoworkExecEndpoint {
    const { url, token } = remoteConfig();
    const { scheme, host, port } = wsEndpoint(url || 'http://127.0.0.1:8790');
    return {
      forwarderPath: remoteForwarderPath(),
      env: {
        COWORK_SESSION_ID: sessionId,
        COWORK_REMOTE_SCHEME: scheme,
        COWORK_REMOTE_HOST: host,
        COWORK_REMOTE_PORT: port,
        COWORK_NODE_BIN: process.execPath,
        ELECTRON_RUN_AS_NODE: '1',
        ...(token ? { COWORK_REMOTE_TOKEN: token } : {}),
      },
    };
  },
  sessionWorkspacePath(_sessionId: string) { return WORKSPACE; },

  async ensureWorkspace(sessionId: string): Promise<string> { await this.ensureReady(sessionId); return WORKSPACE; },
  async writeFile(_sessionId: string, _name: string, _data: Buffer): Promise<string> { throw new Error(NOT_IMPL_R2); },
  async listFiles(_sessionId: string, _sinceMs: number): Promise<VmArtifact[]> { return []; /* R1-3:先返回空产物(纯对话回合末 diff 不崩);R2 实现服务端 volume diff */ },
  async readFileStream(_sessionId: string, _vmPath: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> { throw new Error(NOT_IMPL_R2); },
  async archiveStream(_sessionId: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> { throw new Error(NOT_IMPL_R2); },
  async removeSession(sessionId: string): Promise<void> { try { await api('DELETE', `/session/${sessionId}`); } catch { /* best-effort */ } },
  async reconcile(keepSessionIds: string[]): Promise<string[]> {
    const r = await api('POST', '/reconcile', { keep: keepSessionIds });
    return (r.removed as string[]) || [];
  },

  async registerCredentials(_sessionId: string, cred: CoworkCredential): Promise<{ token: string; baseUrl: string }> {
    // R1:直通真 key(与 R0/R1-1 补验一致,先把链路跑通)。
    // R3:换成 POST /session/:id/cred → 服务端内存代理签发一次性 token(真 key 不进容器)。
    return { token: cred.realKey, baseUrl: cred.realBase };
  },
  revokeCredentials(_sessionId: string) { /* R3:通知服务端废止 token */ },
};

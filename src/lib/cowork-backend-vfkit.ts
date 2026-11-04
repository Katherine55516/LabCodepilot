/**
 * cowork-backend-vfkit.ts — VfkitBackend(保留不激活,RD1)。
 *
 * 把现有 cowork-vm-manager(vfkit 生命周期)+ cowork-vsock(文件/exec RPC)+
 * cowork-proxy(P3-B 凭证代理)包成 CoworkBackend adapter。现状行为等价、零新逻辑。
 * RD1 后不再是活跃路径,仅作"将来要本地离线版"的保留实现(用户明确要求代码不删)。
 */
import fs from 'fs';
import path from 'path';
import type { CoworkBackend, CoworkBackendStatus, CoworkExecEndpoint, CoworkCredential, CoworkProgress } from './cowork-backend';
import {
  ensureRunning, getStatus as vmGetStatus, markSessionActive, releaseSession, stop as vmStop, onVmProgress,
} from './cowork-vm-manager';
import type { VmStatus } from './cowork-vm-manager';
import {
  VSOCK_SOCKET_PATH, vsockHealthy,
  rpcMkdirWorkspace, rpcWriteFile, rpcListFiles, rpcReadFileStream, rpcArchiveStream, rpcRemoveSession, rpcReconcileSessions,
} from './cowork-vsock';
import { ensureProxyRunning, registerSession, revokeSession } from './cowork-proxy';
import { getSetting } from './db';
import { bundledCoworkResource } from './cowork-paths';

const SESSIONS_ROOT = '/home/agent/sessions';

/** 解析 forwarder-vsock.sh(与 cowork-poc.ts 原逻辑一致)。 */
function forwarderPath(): string {
  const candidates: string[] = [];
  const bundled = bundledCoworkResource('forwarder-vsock.sh');
  if (bundled) candidates.push(bundled);
  const fromSetting = (getSetting('cowork_forwarder_path') || '').trim();
  if (fromSetting) {
    candidates.push(path.join(path.dirname(fromSetting), 'forwarder-vsock.sh'));
    candidates.push(fromSetting);
  }
  candidates.push(path.join(process.cwd(), 'scripts/poc/cowork/forwarder-vsock.sh'));
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function mapStatus(s: VmStatus): CoworkBackendStatus {
  return { ready: s.phase === 'running', phase: s.phase, reason: s.reason };
}

export const vfkitBackend: CoworkBackend = {
  kind: 'vfkit',

  async ensureReady(_sessionId: string) { return mapStatus(await ensureRunning()); },
  async getStatus() { return mapStatus(vmGetStatus()); },
  async channelReady() { return vsockHealthy(); },
  markActive(sessionId: string) { markSessionActive(sessionId); },
  release(sessionId: string) { releaseSession(sessionId); },
  async stop() { await vmStop(); },
  onProgress(cb: (p: CoworkProgress) => void) { return onVmProgress((p) => cb({ phase: p.phase, detail: p.detail })); },

  execEndpoint(sessionId: string): CoworkExecEndpoint {
    return {
      forwarderPath: forwarderPath(),
      env: {
        COWORK_SESSION_ID: sessionId,
        COWORK_VSOCK_PATH: VSOCK_SOCKET_PATH,
        COWORK_NODE_BIN: process.execPath,
        ELECTRON_RUN_AS_NODE: '1',
      },
    };
  },
  sessionWorkspacePath(sessionId: string) { return `${SESSIONS_ROOT}/${sessionId}/workspace`; },

  async ensureWorkspace(sessionId: string) { return rpcMkdirWorkspace(sessionId); },
  async writeFile(sessionId: string, name: string, data: Buffer) { return rpcWriteFile(sessionId, name, data); },
  async listFiles(sessionId: string, sinceMs: number) { return rpcListFiles(sessionId, sinceMs); },
  async readFileStream(sessionId: string, vmPath: string) { return rpcReadFileStream(sessionId, vmPath); },
  async archiveStream(sessionId: string) { return rpcArchiveStream(sessionId); },
  async removeSession(sessionId: string) { await rpcRemoveSession(sessionId); },
  async reconcile(keepSessionIds: string[]) { return rpcReconcileSessions(keepSessionIds); },

  async registerCredentials(sessionId: string, cred: CoworkCredential) {
    await ensureProxyRunning();
    return registerSession(sessionId, cred);
  },
  revokeCredentials(sessionId: string) { revokeSession(sessionId); },
};

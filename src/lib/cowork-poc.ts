/**
 * cowork-poc.ts — Cowork 沙箱模式的宿主侧接线判定。
 *
 * 当会话开启 sandbox_enabled 且全局 cowork_enabled 打开时,经当前 CoworkBackend
 * (RD1:remote 容器)确保沙箱就绪,返回转发器路径 + 连接 env 交给 SDK 的
 * pathToClaudeCodeExecutable。SDK 以为在跑本地 claude,实际由转发器把 stdin/stdout
 * 接到远程容器(或保留态的 vfkit VM)内的 linux claude。
 *
 * R1-3:从直连 vfkit(ensureRunning + forwarder-vsock)改为走 getCoworkBackend()。
 * 资产门按后端分:vfkit 需本地镜像就绪;remote 无本地资产,就绪由 ensureReady 验(server 可达)。
 */
import fs from 'fs';
import { getSetting } from './db';
import { getCoworkBackend } from './cowork-backend';

export interface CoworkDecision {
  /** 是否走沙箱转发路径 */
  useSandbox: boolean;
  /** 传给 SDK 的 pathToClaudeCodeExecutable(useSandbox 时才有) */
  executablePath?: string;
  /** 转发器连接所需 env(COWORK_SESSION_ID + vsock 或 remote 端点;由 backend.execEndpoint 提供) */
  execEnv?: Record<string, string>;
  /** 不可用时的原因(日志/UI 提示) */
  reason?: string;
}

/**
 * 判定某会话本回合是否应走沙箱,并在需要时懒启动/重建沙箱。门:
 * 全局开关 + 会话开关 + (vfkit 才校验)本地镜像就绪 + 转发器存在 + backend.ensureReady。
 * 任一不满足都返回 useSandbox=false(claude-client 据此硬失败,绝不落宿主执行)。
 *
 * async:backend.ensureReady 可能要起容器/VM 并等就绪(冷启动数秒),首条沙箱消息因此阻塞到就绪。
 */
export async function decideCowork(sessionId: string, sandboxEnabled: boolean | number | undefined): Promise<CoworkDecision> {
  if (!sandboxEnabled) return { useSandbox: false };
  if (getSetting('cowork_enabled') !== 'true') {
    return { useSandbox: false, reason: 'cowork_disabled_globally' };
  }
  const backend = await getCoworkBackend();
  // 资产门:vfkit 需本地底镜 + claude binary;remote 无本地资产(就绪由 ensureReady 验)。
  if (backend.kind === 'vfkit') {
    const { assetsReady } = await import('./cowork-assets');
    if (!assetsReady()) return { useSandbox: false, reason: 'image_not_provisioned' };
  }
  const endpoint = backend.execEndpoint(sessionId);
  if (!fs.existsSync(endpoint.forwarderPath)) {
    return { useSandbox: false, reason: 'forwarder_missing' };
  }
  // 懒启动/重建 —— 崩溃态/未就绪会在这里被拉起或判不可用。
  const status = await backend.ensureReady(sessionId);
  if (!status.ready) {
    return { useSandbox: false, reason: `sandbox_${status.phase}${status.reason ? ':' + status.reason : ''}` };
  }
  return { useSandbox: true, executablePath: endpoint.forwarderPath, execEnv: endpoint.env };
}

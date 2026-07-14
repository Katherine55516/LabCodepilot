/**
 * cowork-poc.ts — Cowork 沙箱模式(POC)的宿主侧接线。
 *
 * POC 阶段只做一件事:当会话开启 sandbox_enabled 且全局 cowork_enabled 打开时,
 * 返回一个转发器脚本路径,交给 SDK 的 `pathToClaudeCodeExecutable`。SDK 以为在
 * 跑本地 claude,实际由转发器经 SSH 把 stdin/stdout 接到 VM 内的 linux claude。
 *
 * 生产形态会把这里换成正式的 VM 管理器(vfkit/WSL2 生命周期 + vsock + guest
 * daemon),并把执行目标建模成 session.execution_target。POC 先用最短路径验证
 * 转发桥拓扑是否成立。详见 docs/research/cowork-local-vm-mode.md。
 */
import fs from 'fs';
import path from 'path';
import { getSetting } from './db';
import { ensureRunning } from './cowork-vm-manager';
import { assetsReady } from './cowork-assets';

/**
 * POC 转发器脚本路径(仓库内)。P1-C 起指向 vsock 版转发器
 * (forwarder-vsock.mjs)。cowork_forwarder_path 设置若指向旧的
 * forwarder-ssh.sh,同目录解析出 vsock 版。生产会内置为签名 helper。
 */
function forwarderPath(): string {
  const fromSetting = (getSetting('cowork_forwarder_path') || '').trim();
  const candidates: string[] = [];
  if (fromSetting) {
    // 设置可能仍指向旧 ssh 脚本;取同目录的 vsock 版 bash 包装
    candidates.push(path.join(path.dirname(fromSetting), 'forwarder-vsock.sh'));
    candidates.push(fromSetting);
  }
  candidates.push(path.join(process.cwd(), 'scripts/poc/cowork/forwarder-vsock.sh'));
  candidates.push(path.join(process.cwd(), '../../scripts/poc/cowork/forwarder-vsock.sh'));
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

export interface CoworkDecision {
  /** 是否走沙箱转发路径 */
  useSandbox: boolean;
  /** 传给 SDK 的 pathToClaudeCodeExecutable(useSandbox 时才有) */
  executablePath?: string;
  /** 不可用时的原因(用于日志/未来 UI 提示) */
  reason?: string;
}

/**
 * 判定某会话本回合是否应走沙箱,并在需要时懒启动/重建 VM。三重门:
 * 全局开关 + 会话开关 + VM 管理器就绪(P1-B:自动 ensureRunning,不再只查
 * vm-ip 文件)。任一不满足都安全回退到宿主执行(useSandbox=false)。
 *
 * async 因为 ensureRunning 可能要 spawn vfkit 并等 SSH 就绪(冷启动数秒);
 * 首条沙箱消息因此会阻塞到 VM 起好,符合"点开就能用"的预期。
 */
export async function decideCowork(sandboxEnabled: boolean | number | undefined): Promise<CoworkDecision> {
  if (!sandboxEnabled) return { useSandbox: false };
  if (getSetting('cowork_enabled') !== 'true') {
    return { useSandbox: false, reason: 'cowork_disabled_globally' };
  }
  // M2:资产门 = 底镜 + claude binary 都在(缺任一走下载引导,reason 复用不变)
  if (!assetsReady()) {
    return { useSandbox: false, reason: 'image_not_provisioned' };
  }
  const fwd = forwarderPath();
  if (!fs.existsSync(fwd)) {
    return { useSandbox: false, reason: 'forwarder_missing' };
  }
  // 懒启动/重建 —— 崩溃态也会在这里被重新拉起。
  const vm = await ensureRunning();
  if (vm.phase !== 'running') {
    return { useSandbox: false, reason: `vm_${vm.phase}${vm.reason ? ':' + vm.reason : ''}` };
  }
  return { useSandbox: true, executablePath: fwd };
}

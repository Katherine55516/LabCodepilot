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
import os from 'os';
import { getSetting } from './db';

/** POC 转发器脚本路径(仓库内)。生产会内置为签名 helper。 */
function forwarderPath(): string {
  // 打包后 __dirname 在 .next/standalone 里,脚本不随包分发 —— POC 仅在 dev
  // 环境从仓库根解析。用 cwd 兜底(dev server 从仓库根启动)。
  const candidates = [
    path.join(process.cwd(), 'scripts/poc/cowork/forwarder-ssh.sh'),
    path.join(process.cwd(), '../../scripts/poc/cowork/forwarder-ssh.sh'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

/** VM 是否就绪(vm-up.sh 写下的 IP 文件)。 */
function vmReady(): boolean {
  const ipFile = path.join(os.homedir(), '.codepilot/cowork-poc/vm-ip');
  try {
    return fs.statSync(ipFile).isFile() && fs.readFileSync(ipFile, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
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
 * 判定某会话本回合是否应走沙箱。三重门:全局开关 + 会话开关 + VM 就绪。
 * 任一不满足都安全回退到宿主执行(useSandbox=false)。
 */
export function decideCowork(sandboxEnabled: boolean | number | undefined): CoworkDecision {
  if (!sandboxEnabled) return { useSandbox: false };
  if (getSetting('cowork_enabled') !== 'true') {
    return { useSandbox: false, reason: 'cowork_disabled_globally' };
  }
  if (!vmReady()) {
    return { useSandbox: false, reason: 'vm_not_ready' };
  }
  const fwd = forwarderPath();
  if (!fs.existsSync(fwd)) {
    return { useSandbox: false, reason: 'forwarder_missing' };
  }
  return { useSandbox: true, executablePath: fwd };
}

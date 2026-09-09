/**
 * cowork-guards.ts — 沙箱(办公)会话的执行层守卫(E1)。
 *
 * 沙箱会话的产品承诺是"agent 永不触碰真机文件"。POC 时代的兜底语义是
 * "沙箱不可用就安全回退宿主执行",这对产品是隔离违约 —— 本模块收敛
 * 三类守卫的纯逻辑,供 claude-client(SDK 路径)与 /api/chat(runtime
 * 分发)使用,详见 docs/exec-plans/active/cowork-office-mode.md(E1/D4/D5):
 *
 * 1. 硬失败:VM 不可用时终止回合,绝不静默回退宿主执行。
 * 2. native runtime 拒绝:native runtime 的工具在宿主执行且完全不感知
 *    sandbox_enabled,沙箱会话必须走 SDK 转发桥。
 * 3. 能力边界:沙箱回合不加载外部 MCP(stdio 会在 VM 内 spawn,没有
 *    npx/uvx 必然静默失败),并向 agent 注入环境说明。
 */
import { sessionWorkspace } from './cowork-transfer';

/** 隔离承诺尾注 —— 所有硬失败消息统一带上,向用户明确"没有落真机"。 */
const ISOLATION_TAIL = '为守住隔离承诺,本回合已终止,没有在真机上执行任何操作。';

export interface SandboxUnavailableError {
  /** 前端 error 事件的结构化分类(useSSEStream 按 category+userMessage 渲染) */
  category: 'sandbox_unavailable';
  userMessage: string;
  actionHint: string;
  retryable: boolean;
  /** 原始 reason 码,便于日志/排查 */
  rawMessage: string;
}

/**
 * 把 decideCowork 的失败 reason 映射成用户可读的结构化错误。
 * reason 码来源:src/lib/cowork-poc.ts(image_not_provisioned /
 * forwarder_missing / sandbox_<phase>[:detail])以及 claude-client 捕获异常时
 * 的 'decision_error'。
 */
export function buildSandboxUnavailableError(reason?: string): SandboxUnavailableError {
  const raw = reason || 'unknown';
  let userMessage: string;
  let actionHint: string;
  let retryable: boolean;

  if (raw === 'image_not_provisioned') {
    userMessage = '沙箱环境尚未下载完成,无法启动隔离环境。';
    actionHint = '到设置页或「办公」首页点击「下载沙箱环境」,完成后重试;或新建普通(研发)会话继续。';
    retryable = false;
  } else if (raw === 'forwarder_missing') {
    userMessage = '沙箱转发器脚本缺失,无法把执行转入虚拟机。';
    actionHint = '检查 cowork_forwarder_path 设置与 scripts/poc/cowork/ 目录后重试。';
    retryable = false;
  } else if (raw.startsWith('sandbox_') || raw.startsWith('vm_')) {
    userMessage = `沙箱环境未能就绪(${raw})。`;
    actionHint = '稍后重试;若持续失败,请把括号内的错误信息提供给管理员排查。';
    retryable = true;
  } else {
    userMessage = `沙箱环境检查失败(${raw})。`;
    actionHint = '稍后重试;若持续失败请查看应用日志。';
    retryable = true;
  }

  return {
    category: 'sandbox_unavailable',
    userMessage: `${userMessage}${ISOLATION_TAIL}`,
    actionHint,
    retryable,
    rawMessage: raw,
  };
}

/**
 * /api/chat 的 native runtime 拒绝响应体(HTTP 412)。
 * 触发条件:session.sandbox_enabled && predictNativeRuntime(...)
 * (openai-oauth 服务商 / cli_enabled=false / agent_runtime=native)。
 */
export const SANDBOX_NATIVE_RUNTIME_GUARD = {
  code: 'SANDBOX_REQUIRES_SDK_RUNTIME',
  error:
    '沙箱会话需要 Claude Code SDK 运行时,但当前配置会走 native 运行时(工具在真机执行)。' +
    '为守住隔离承诺已拒绝本次请求 —— 请改用托管模型,或取消 agent_runtime=native / cli_enabled=false 等强制设置。',
} as const;

/**
 * 沙箱回合注入的能力边界系统提示(coworkActive 时 append 到 systemPrompt)。
 * 告诉 agent:它在隔离沙箱内、工作目录在哪、宿主路径/公司内网/外部 MCP 不可用、
 * 产物会自动出现在下载卡片。
 */
export function buildSandboxSystemNote(sessionId: string): string {
  const ws = sessionWorkspace(sessionId);
  return [
    '## 沙箱执行环境(Cowork)',
    '本会话运行在一个与用户真机隔离的 Linux 沙箱环境内:',
    `- 你的工作目录是本会话专属的 ${ws}/,用户通过对话发送的文件已放在这里。`,
    '- 你无法访问用户真机的文件系统。不要引用或臆测宿主路径(如 /Users/**);所有读写都在上述 workspace 内进行。',
    '- 网络:可访问公网(安装依赖、调用外部 API 等);访问公司内网/局域网地址会被网络策略拒绝,不要尝试连接内网主机。',
    '- 外部 MCP 服务器在沙箱会话中不会加载;内置 codepilot-* 工具不受影响。',
    '- 你在 workspace 内新建或修改的文件,回合结束后会自动出现在用户界面的「沙箱产物」卡片中供下载,无需向用户解释如何取回文件。',
  ].join('\n');
}

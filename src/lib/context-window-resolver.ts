// ============================================================================
// FIX(分母统一 2B) — 上下文窗口单一 resolver。
//
// 背景（context-usage-accuracy-overhaul Phase 2）：此前 UI 与服务端压缩判断
// 各持一条窗口解析链 —— UI 走 managed 展示名表 ?? provider-models 下发值，
// 服务端压缩只走静态 catalog 的 substring 匹配。managed 模型 id（如
// claude-opus-4-8）命中子串 'opus' → 200K，而真实窗口 1M：压缩在 ~160K
// （80%×200K）误触发、清 sdk_session_id、抛弃 CLI transcript。UI 和执行
// 状态从此脱节。两侧必须共用这一个函数。
//
// 优先级（D1 已拍板：live 优先、静态表兜底）：
//   1. [1m] 运行时模型名标记（Connected (…) 里那个名字，最高 —— CLI 1M
//      变体只有它能标识）
//   2. live 窗口：token_usage.context_window（result.modelUsage 提取，2A
//      落库，运行时免费的权威值，自动跟随后端窗口调整）
//   3. account 窗口：managed 展示名表 ?? provider-models 下发值
//   4. 静态 catalog（含 upstream 消歧与 1M beta 开关）
//   5. null（调用方自行兜底 —— 服务端压缩兜 200K 并打日志，UI 显示原始
//      token 数不显示百分比）
//
// 纯函数、无 I/O，客户端与服务端（route.ts 压缩判断）共用。
// ============================================================================

import { getContextWindow, is1mContextModelName } from './model-context';

export interface ResolveContextWindowInputs {
  /**
   * 运行时实际请求的模型名（token_usage.model，可能带 [1m]）——
   * 不是下拉框展示名。
   */
  runtimeModelName?: string | null;
  /** live 窗口：token_usage.context_window（modelUsage 提取值）。 */
  liveWindow?: number | null;
  /** 账号侧窗口：managed 展示名表 ?? /api/providers/models 下发值。 */
  accountWindow?: number | null;
  /** 静态 catalog 查询用的模型别名（会话 model 字段）。 */
  model?: string | null;
  /** 解析后的 upstream 模型 id —— 消歧别名窗口（opus 4.6 vs 4.7）。 */
  upstreamModel?: string | null;
  /** 1M context beta 开关。 */
  context1m?: boolean;
}

export function resolveContextWindow(
  inputs: ResolveContextWindowInputs,
): number | null {
  if (is1mContextModelName(inputs.runtimeModelName)) return 1_000_000;
  if (typeof inputs.liveWindow === 'number' && inputs.liveWindow > 0) {
    return inputs.liveWindow;
  }
  if (typeof inputs.accountWindow === 'number' && inputs.accountWindow > 0) {
    return inputs.accountWindow;
  }
  return getContextWindow(inputs.model || '', {
    context1m: inputs.context1m,
    upstream: inputs.upstreamModel || undefined,
  });
}

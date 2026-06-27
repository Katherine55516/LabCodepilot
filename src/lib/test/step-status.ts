/**
 * 流水线「重跑下游复位」规则（纯函数，便于单测，无服务端依赖）。
 *
 * 四个步骤 需求分析 → 用例设计 → 测试执行 → 测试报告 有上下游依赖：重跑某步会让其下游各
 * 步的产物失效。故重跑时把当前步置「运行中」，其后所有步骤复位「未开始」(idle)，避免界面
 * 残留上次的「已完成」(例如重跑「测试执行」后「测试报告」节点仍显示已完成)。当前步之前的
 * 步骤保持不变。
 *
 * 步骤顺序由调用方以 `order` 传入（与 TEST_STEPS / 组件 STEPS 对齐）—— 本模块不 import
 * prompts.ts，避免把其服务端依赖（fs 等）带进客户端 bundle。所有重跑入口（运行任务 /
 * 单步重跑 / 批准接力 / auto-chain）都经由 runStep 调用本函数，规则一处生效、四节点统一。
 *
 * @param prev    当前各步状态
 * @param step    本次要(重)跑的步骤
 * @param order   步骤顺序（首→尾）
 * @param running 「运行中」状态值
 * @param idle    「未开始」状态值
 */
export function withDownstreamReset<K extends string, S>(
  prev: Record<K, S>,
  step: K,
  order: readonly K[],
  running: S,
  idle: S,
): Record<K, S> {
  const idx = order.indexOf(step);
  const next = { ...prev } as Record<K, S>;
  next[step] = running;
  for (let i = idx + 1; i < order.length; i++) next[order[i]] = idle;
  return next;
}

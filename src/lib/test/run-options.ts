/**
 * 测试运行请求的兼容选项归一化。
 *
 * 功能测试沿用历史口径：未传 / true = 开启脚本沉淀，false = 关闭。
 * 冒烟测试没有回归脚本产物，服务端无条件强制关闭，防止旧任务状态或旧客户端显式传 true
 * 绕过前端隐藏逻辑。
 */
export function resolveDepositScripts(
  taskType: 'smoke' | undefined,
  requested: unknown,
): boolean {
  return taskType !== 'smoke' && requested !== false;
}

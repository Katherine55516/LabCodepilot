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

/** 看板任务的状态分类（顶部概览 chip + 分组堆叠用）。互斥且穷尽。 */
export type TaskCategory = 'running' | 'queued' | 'pending' | 'done';

/** 分组的展示顺序：运行中 → 排队中 → 待处理 → 已完成。 */
export const TASK_CATEGORY_ORDER: readonly TaskCategory[] = ['running', 'queued', 'pending', 'done'];

/**
 * 计算一个看板任务落到哪个分类（纯函数，便于单测，无服务端依赖）。
 *
 * 优先级（从高到低）：
 *   1. running —— 有步在跑（`isRunning`，来自 runningTaskIds，含批量无头）
 *   2. queued  —— 在批量等待队列里（`isQueued`，来自 waitingTaskIds）
 *   3. done    —— 四步全部完成（终态）
 *   4. pending —— 其余（未开始 / 部分完成 k/4 / 待批准 review / 失败 error）
 *
 * running/queued 互斥（pumpQueue 出队即入跑），但若出现瞬时双态，按优先级取 running。
 *
 * @param status    当前各步状态（done/review/idle/running/error 字符串）
 * @param order     步骤顺序（首→尾，与 STEP_ORDER 对齐）
 * @param isRunning 该任务是否有步在执行
 * @param isQueued  该任务是否在批量等待队列中
 * @param doneValue 视为「已完成」的步状态值（默认 'done'）
 */
export function taskCategory<K extends string>(
  status: Record<K, string>,
  order: readonly K[],
  isRunning: boolean,
  isQueued: boolean,
  doneValue: string = 'done',
): TaskCategory {
  if (isRunning) return 'running';
  if (isQueued) return 'queued';
  if (order.length > 0 && order.every((k) => status[k] === doneValue)) return 'done';
  return 'pending';
}

/**
 * 全局并发占用的槽位数（纯函数，便于单测）。
 *
 * 占用 = 在跑(running) ∪ 已认领(autoRun) 的去重任务数。两集合可能重叠（一个任务既在跑又被
 * 认领），并集去重保证同一任务只占一个槽位。用并集而非单看 autoRun，是为了把「正在跑但未被
 * 认领」的任务（如手动单步运行）也算进占用 —— 否则会漏算导致排队调度超过并发上限。
 *
 * 调度判定：`occupiedSlots(...) < concurrency` → 还有空槽，可立即起跑；否则进排队。
 */
export function occupiedSlots(running: Iterable<string>, autoRun: Iterable<string>): number {
  const seen = new Set<string>(running);
  for (const id of autoRun) seen.add(id);
  return seen.size;
}

/** 「运行任务 · 选择起点」每个候选起点的可用性（纯函数，便于单测，无服务端依赖）。 */
export interface RunStartOption<K extends string> {
  step: K;
  /** 上游已完成 → 可作为起点（首步恒可）。否则锁定（需先完成上一步）。 */
  unlocked: boolean;
  /** 从此步起跑会重置「此步或其下游里已产出的步骤」(done/review) → 覆盖产物，需确认。 */
  willOverwrite: boolean;
  /** 此步是「下一个待办步」(第一个未 done 的步) → 弹窗默认高亮、作为「继续」入口。 */
  isNext: boolean;
}

/**
 * 计算「运行任务」可选起点的状态。
 *
 * @param status        当前各步状态（done/review/idle/running/error 字符串）
 * @param order         步骤顺序（首→尾，与 STEP_ORDER 对齐）
 * @param startSteps    作为起点提供给用户的步骤（如排除「测试报告」）
 * @param doneValues    视为「上游已完成」的状态（默认仅 done）
 * @param artifactValues 视为「已有产物、重跑会覆盖」的状态（默认 done + review）
 */
export function runStartOptions<K extends string>(
  status: Record<K, string>,
  order: readonly K[],
  startSteps: readonly K[],
  doneValues: readonly string[] = ['done'],
  artifactValues: readonly string[] = ['done', 'review'],
): RunStartOption<K>[] {
  const isDone = (s: string) => doneValues.includes(s);
  const hasArtifact = (s: string) => artifactValues.includes(s);
  // 下一个待办步 = order 中第一个未 done 的步（可能不在 startSteps 内，如 report）。
  const nextPending = order.find((k) => !isDone(status[k]));
  return startSteps.map((step) => {
    const idx = order.indexOf(step);
    const unlocked = idx <= 0 || isDone(status[order[idx - 1]]);
    let willOverwrite = false;
    for (let i = idx; i < order.length; i++) {
      if (hasArtifact(status[order[i]])) { willOverwrite = true; break; }
    }
    return { step, unlocked, willOverwrite, isNext: step === nextPending };
  });
}

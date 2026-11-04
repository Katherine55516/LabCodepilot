'use client';

// ============================================================================
// FIX(权威分子·交付链) — 把探针后补的 context_used_tokens 接进当前页面。
//
// 背景（context-usage-accuracy-overhaul Phase 1B）：回合结束时 UI 用 SSE
// result 里的 fallback usage 建临时 assistant 消息；无凭据探针 ~2s 后才把
// 权威 totalTokens patch 进 DB（fire-and-forget，绝不阻塞流 close 的既有
// 决策）。此前没有任何链路把这个迟到值送回当前页面 —— 卡片长期停留在
// fallback 口径，重进会话才跳到权威值。
//
// 机制：回合正常完成后按退避序列轮询 GET /api/chat/sessions/:id/context-usage，
// 拿到 context_used_tokens 且 input/output 与内存里目标 assistant 消息一致
// （防串扰 match，与探针 patch DB 的语义对齐）时，把上下文字段合并进该消息的
// token_usage —— walkContextUsage 对 context_used_tokens 的优先级自然生效，
// 不引入第二真相。三次未命中即停（探针失败/win32/cowork 等盲区，卡片保持
// fallback 口径）。
// ============================================================================

import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Message } from '@/types';

/** 回合完成后的退避序列：探针自带 1.5s 延迟 + 运行耗时（打包环境可能更久）。 */
const TURN_ATTEMPT_DELAYS_MS = [2000, 6000, 12000];
/** 挂载补拉（首轮重定向后初始加载可能早于探针落库）：立即 + 一次补偿。 */
const MOUNT_ATTEMPT_DELAYS_MS = [0, 4000];

interface FetchedContext {
  input_tokens?: number;
  output_tokens?: number;
  context_used_tokens?: number;
  context_window?: number;
  context_accounting?: unknown;
}

function parseUsage(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 把 fetched 的上下文字段合并进"最后一条 match 的 assistant 消息"。
 * 返回新数组；无 match 或已是同值时返回原数组（引用不变 → 不触发重渲）。
 * 导出仅为单测。
 */
export function mergeContextUsageIntoMessages(
  messages: Message[],
  ctx: FetchedContext,
): Message[] {
  if (!ctx.context_used_tokens || ctx.context_used_tokens <= 0) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const usage = parseUsage(msg.token_usage);
    if (!usage) continue;
    // match 防串扰：与探针 patch DB 的判据一致 —— input/output 同时相等。
    if (ctx.input_tokens !== undefined && usage.input_tokens !== ctx.input_tokens) return messages;
    if (ctx.output_tokens !== undefined && usage.output_tokens !== ctx.output_tokens) return messages;
    if (usage.context_used_tokens === ctx.context_used_tokens) return messages; // 已同步
    const merged: Record<string, unknown> = {
      ...usage,
      context_used_tokens: ctx.context_used_tokens,
    };
    if (ctx.context_window !== undefined) merged.context_window = ctx.context_window;
    if (ctx.context_accounting !== undefined) merged.context_accounting = ctx.context_accounting;
    const next = messages.slice();
    next[i] = { ...msg, token_usage: JSON.stringify(merged) };
    return next;
  }
  return messages;
}

export function useContextUsageRefresh(params: {
  sessionId: string;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}): {
  /** 回合正常完成（phase === 'completed'）后调用。 */
  onTurnCompleted: () => void;
  /** ChatView 挂载 / 会话切换后调用一次（首轮重定向补拉）。 */
  onMounted: () => void;
} {
  const { sessionId, setMessages } = params;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(false);
  const mountFiredRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  // 会话切换 / 卸载：取消在途轮询（避免 patch 打到别的会话的消息状态上），
  // 并重置 once 标记。重置必须在 cleanup 里做：dev StrictMode 的
  // mount→cleanup→mount 双跑会先清掉第一遍调度的定时器 —— once 标记若不
  // 随之重置，第二遍会被跳过，轮询整体失效（CDP 实测踩过）。
  useEffect(() => {
    return () => {
      clearTimers();
      mountFiredRef.current = false;
      doneRef.current = false;
    };
  }, [sessionId, clearTimers]);

  const attemptOnce = useCallback(async () => {
    if (doneRef.current) return;
    let ctx: FetchedContext | null = null;
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/context-usage`);
      if (!res.ok) return;
      ctx = ((await res.json()) as { context?: FetchedContext | null }).context ?? null;
    } catch {
      return; // 网络失败 → 等下一次退避
    }
    if (!ctx?.context_used_tokens || ctx.context_used_tokens <= 0) return;
    const fetched = ctx;
    setMessages((prev) => {
      const next = mergeContextUsageIntoMessages(prev, fetched);
      if (next !== prev) doneRef.current = true; // 命中即停，剩余定时器空转跳过
      return next;
    });
  }, [sessionId, setMessages]);

  const schedule = useCallback(
    (delays: readonly number[]) => {
      clearTimers();
      doneRef.current = false;
      for (const delay of delays) {
        timersRef.current.push(setTimeout(() => { void attemptOnce(); }, delay));
      }
    },
    [attemptOnce, clearTimers],
  );

  const onTurnCompleted = useCallback(() => schedule(TURN_ATTEMPT_DELAYS_MS), [schedule]);
  // 每会话一次的去重放在 hook 内部（而非调用方 once-ref）：调用方可以在
  // messages 每次变化时无脑重调，StrictMode 双跑下 cleanup 重置后第二遍
  // 仍能成功调度。
  const onMounted = useCallback(() => {
    if (mountFiredRef.current) return;
    mountFiredRef.current = true;
    schedule(MOUNT_ATTEMPT_DELAYS_MS);
  }, [schedule]);

  return { onTurnCompleted, onMounted };
}

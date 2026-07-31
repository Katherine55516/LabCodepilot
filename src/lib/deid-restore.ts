'use client';

/**
 * 脱敏网关 — 渲染层还原 context(决策 D5)。
 *
 * DB 里 assistant 消息按服务端原样存占位符;展示前的「占位符→原文」还原
 * 在渲染层单点完成:MessageResponse(所有 markdown 文本的唯一渲染出口)
 * 消费本 context。默认 null = 恒等(非 deid 会话零开销)。
 *
 * ChatView 在 deid 会话且 mapping 非空时提供 restore 函数;context 变更会
 * 绕过 MessageResponse 的 memo(React context 更新不受 memo 拦截),mapping
 * 更新后历史消息也能拿到新字典。
 */

import { createContext, useContext } from 'react';

export type DeidRestoreFn = (text: string) => string;

export const DeidRestoreContext = createContext<DeidRestoreFn | null>(null);

export function useDeidRestore(): DeidRestoreFn | null {
  return useContext(DeidRestoreContext);
}

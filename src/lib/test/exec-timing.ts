/**
 * 执行步逐用例计时（纯函数，服务端挂钟，不采信 AI 自报时间）。
 *
 * 执行 prompt 的格式契约（prompts.ts:280/284）：AI 每条用例先打印进度行
 * 「▶ 用例 N/总数：{标题}」，结束输出单行 `@@RESULT {json}`（id 与 cases.json
 * 完全一致、一条用例恰好一行）。计时口径 = ▶ 行完成时刻 → 下一条 @@RESULT 行
 * 完成时刻，id 取自 @@RESULT（进度行本身不含 id）。
 *
 * text 增量可能把一行拆到多帧（SSE delta 任意切分），这里做行缓冲；时间由调用方
 * 注入（wrapExecutionStream 传 Date.now()），因此本模块可在 node:test 下确定性单测。
 * AI 偶发不按格式输出时，相应用例只是缺 durationMs，不抛错、不阻塞（口径允许缺省）。
 */

import { harvestMarkerObjects, isProgressLine } from './markers';

export interface CaseTimer {
  /** 喂入一段 text 增量；nowMs 为该增量到达服务端的挂钟时刻。 */
  feedText(chunk: string, nowMs: number): void;
  /** 流结束：冲刷尾行（可能无换行结尾）并返回 id → durationMs。 */
  finish(nowMs: number): Record<string, number>;
}

export function createCaseTimer(): CaseTimer {
  let lineBuf = '';
  let openStartMs: number | null = null;
  const durations: Record<string, number> = {};

  const onLine = (rawLine: string, nowMs: number) => {
    const line = rawLine.trim();
    if (!line) return;
    if (isProgressLine(line)) {
      // 新用例开跑；上一条 ▶ 若没等到 @@RESULT（AI 漏输出）则直接丢弃其计时
      openStartMs = nowMs;
      return;
    }
    if (!line.includes('@@RESULT')) return;
    let id = '';
    // 与 reduce.harvestResults 共用 markers.ts 的解析器——两侧宽严必须完全一致,否则带
    // markdown 装饰的行会一边解析成功、一边失败,时长错挂到兜底补全的「未执行」条目上。
    const [parsed] = harvestMarkerObjects<{ id?: unknown }>(line, 'RESULT');
    if (parsed && typeof parsed.id === 'string') id = parsed.id;
    if (id && openStartMs !== null && !(id in durations)) {
      const d = nowMs - openStartMs;
      if (d > 0) durations[id] = d;
    }
    openStartMs = null;
  };

  return {
    feedText(chunk, nowMs) {
      lineBuf += chunk;
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() || '';
      for (const l of lines) onLine(l, nowMs);
    },
    finish(nowMs) {
      if (lineBuf) onLine(lineBuf, nowMs);
      lineBuf = '';
      return durations;
    },
  };
}

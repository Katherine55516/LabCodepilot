/**
 * live 窗口提取单测（src/lib/claude-client.ts extractLiveContextWindow）。
 *
 * 背景（context-usage-accuracy-overhaul Phase 2A）：result.modelUsage 携带
 * 每模型 contextWindow —— 运行时免费的权威分母，提取后随
 * token_usage.context_window 落库（walk 已支持读取）。
 *
 * 覆盖：
 * - connectedModel 精确命中
 * - 无精确命中但只有一个条目 → 取它
 * - 多条目且无精确命中（子代理混用模型）→ undefined（宁缺毋滥）
 * - 无 modelUsage / contextWindow 非正数 → undefined
 *
 * Run with: npx tsx --test src/__tests__/unit/context-window-live.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractLiveContextWindow } from '@/lib/claude-client';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

function resultMsg(modelUsage?: Record<string, { contextWindow?: number }>): SDKResultMessage {
  return { type: 'result', subtype: 'success', modelUsage } as unknown as SDKResultMessage;
}

describe('extractLiveContextWindow', () => {
  it('connectedModel 精确命中', () => {
    const w = extractLiveContextWindow(
      resultMsg({
        'claude-opus-4-8': { contextWindow: 1_000_000 },
        'claude-haiku-4-5-20251001': { contextWindow: 200_000 },
      }),
      'claude-opus-4-8',
    );
    assert.equal(w, 1_000_000);
  });

  it('无精确命中但只有一个条目 → 取它', () => {
    const w = extractLiveContextWindow(
      resultMsg({ 'qwen3.7-plus[1m]': { contextWindow: 1_000_000 } }),
      'some-other-name',
    );
    assert.equal(w, 1_000_000);
  });

  it('多条目且无精确命中（子代理混用模型）→ undefined，宁缺毋滥', () => {
    const w = extractLiveContextWindow(
      resultMsg({
        'model-a': { contextWindow: 1_000_000 },
        'model-b': { contextWindow: 200_000 },
      }),
      'model-c',
    );
    assert.equal(w, undefined);
  });

  it('无 modelUsage / 窗口非正数 → undefined', () => {
    assert.equal(extractLiveContextWindow(resultMsg(undefined), 'm'), undefined);
    assert.equal(
      extractLiveContextWindow(resultMsg({ m: { contextWindow: 0 } }), 'm'),
      undefined,
    );
    assert.equal(extractLiveContextWindow(resultMsg({ m: {} }), 'm'), undefined);
  });
});

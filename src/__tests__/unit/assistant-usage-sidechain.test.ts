/**
 * 占用口径 · sidechain 过滤单测（src/lib/claude-client.ts extractAssistantTurnUsage）。
 *
 * 背景：上下文用量卡片的 fallback 分子 = 回合内最后一条 assistant 请求的单次
 * usage。子代理(sidechain)的 assistant 消息带 parent_tool_use_id，其 usage 是
 * 子代理自己那条独立小上下文的——回合以 Task/子代理收尾时若不过滤，占用数会
 * 从主链的上百 K 骤降到子代理的几 K（context-usage-accuracy-overhaul Phase 1A）。
 *
 * 覆盖：
 * - 主链消息(parent_tool_use_id === null) → 正常提取四字段
 * - sidechain 消息(parent_tool_use_id 为字符串) → null（不参与占用口径）
 * - 缺 usage → null；缺 cache 字段 → 补 0
 * - 模拟"子代理收尾"消息序列：最后留任的应是主链末次 usage
 *
 * Run with: npx tsx --test src/__tests__/unit/assistant-usage-sidechain.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractAssistantTurnUsage } from '@/lib/claude-client';
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

function assistantMsg(params: {
  parentToolUseId: string | null;
  usage?: Record<string, number>;
}): SDKAssistantMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: params.parentToolUseId,
    message: {
      usage: params.usage,
      content: [],
    },
  } as unknown as SDKAssistantMessage;
}

describe('extractAssistantTurnUsage · sidechain 过滤', () => {
  it('主链消息正常提取 input/output/cacheR/cacheC', () => {
    const u = extractAssistantTurnUsage(
      assistantMsg({
        parentToolUseId: null,
        usage: {
          input_tokens: 1200,
          output_tokens: 300,
          cache_read_input_tokens: 98000,
          cache_creation_input_tokens: 4500,
        },
      }),
    );
    assert.deepEqual(u, {
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 98000,
      cache_creation_input_tokens: 4500,
    });
  });

  it('sidechain 消息(parent_tool_use_id 非空) → null，即使带 usage', () => {
    const u = extractAssistantTurnUsage(
      assistantMsg({
        parentToolUseId: 'toolu_01subagent',
        usage: { input_tokens: 8000, output_tokens: 50 },
      }),
    );
    assert.equal(u, null);
  });

  it('缺 usage → null；缺 cache 字段默认 0', () => {
    assert.equal(
      extractAssistantTurnUsage(assistantMsg({ parentToolUseId: null })),
      null,
    );
    const u = extractAssistantTurnUsage(
      assistantMsg({
        parentToolUseId: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    assert.deepEqual(u, {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });

  it('子代理收尾的消息序列：留任的是主链末次 usage，不被 sidechain 覆盖', () => {
    // 复刻 streamClaude 主循环的更新语义：turnUsage 非 null 才覆盖。
    const sequence = [
      assistantMsg({
        parentToolUseId: null,
        usage: { input_tokens: 2000, output_tokens: 100, cache_read_input_tokens: 150000 },
      }),
      // 回合以 Task 子代理收尾——两条子代理消息 usage 都很小
      assistantMsg({
        parentToolUseId: 'toolu_01task',
        usage: { input_tokens: 3000, output_tokens: 40 },
      }),
      assistantMsg({
        parentToolUseId: 'toolu_01task',
        usage: { input_tokens: 5000, output_tokens: 80 },
      }),
    ];
    let last: ReturnType<typeof extractAssistantTurnUsage> = null;
    for (const msg of sequence) {
      const turnUsage = extractAssistantTurnUsage(msg);
      if (turnUsage) last = turnUsage;
    }
    assert.ok(last, '主链消息应产生 usage');
    assert.deepEqual(last, {
      input_tokens: 2000,
      output_tokens: 100,
      cache_read_input_tokens: 150000,
      cache_creation_input_tokens: 0,
    });
  });
});

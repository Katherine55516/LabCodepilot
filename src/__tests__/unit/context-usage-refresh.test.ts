/**
 * 权威分子·交付链单测（src/hooks/useContextUsageRefresh.ts 纯函数部分）。
 *
 * mergeContextUsageIntoMessages 把 /api/chat/sessions/:id/context-usage 拉到的
 * 探针后补字段合并进内存消息（context-usage-accuracy-overhaul Phase 1B）。
 *
 * 覆盖：
 * - match 命中 → 合并 context_used_tokens/context_window/context_accounting，
 *   返回新数组且只替换目标消息
 * - input/output 任一不匹配（用户已进下一回合）→ 原样返回，绝不误 patch
 * - 已同步（同值）→ 引用不变（不触发重渲）
 * - 目标消息为最后一条 *assistant*：跳过 user 消息与无 usage 的 assistant
 * - context_used_tokens 缺失/0 → 原样返回
 *
 * Run with: npx tsx --test src/__tests__/unit/context-usage-refresh.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeContextUsageIntoMessages } from '@/hooks/useContextUsageRefresh';
import type { Message } from '@/types';

let seq = 0;
function msg(role: 'user' | 'assistant', usage: Record<string, unknown> | null): Message {
  return {
    id: `m-${++seq}`,
    session_id: 's',
    role,
    content: 'x',
    created_at: '2026-08-13T00:00:00Z',
    token_usage: usage ? JSON.stringify(usage) : null,
  };
}

describe('mergeContextUsageIntoMessages', () => {
  it('match 命中 → 合并进最后一条 assistant 的 token_usage，返回新数组', () => {
    const prev = [
      msg('user', null),
      msg('assistant', { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 90_000 }),
    ];
    const next = mergeContextUsageIntoMessages(prev, {
      input_tokens: 1200,
      output_tokens: 300,
      context_used_tokens: 116_842,
      context_window: 200_000,
    });
    assert.notEqual(next, prev);
    assert.equal(next[0], prev[0]); // 未涉及的消息引用不变
    const merged = JSON.parse(next[1].token_usage!);
    assert.equal(merged.context_used_tokens, 116_842);
    assert.equal(merged.context_window, 200_000);
    assert.equal(merged.cache_read_input_tokens, 90_000); // 原字段保留
  });

  it('input/output 任一不匹配（已进下一回合）→ 原样返回', () => {
    const prev = [msg('assistant', { input_tokens: 999, output_tokens: 300 })];
    assert.equal(
      mergeContextUsageIntoMessages(prev, {
        input_tokens: 1200, output_tokens: 300, context_used_tokens: 116_842,
      }),
      prev,
    );
    assert.equal(
      mergeContextUsageIntoMessages(prev, {
        input_tokens: 999, output_tokens: 1, context_used_tokens: 116_842,
      }),
      prev,
    );
  });

  it('已同步（同值）→ 引用不变，不触发重渲', () => {
    const prev = [
      msg('assistant', { input_tokens: 1200, output_tokens: 300, context_used_tokens: 116_842 }),
    ];
    assert.equal(
      mergeContextUsageIntoMessages(prev, {
        input_tokens: 1200, output_tokens: 300, context_used_tokens: 116_842,
      }),
      prev,
    );
  });

  it('跳过 user 与无 usage 的 assistant，patch 到更早的 match 消息', () => {
    const target = msg('assistant', { input_tokens: 1200, output_tokens: 300 });
    const prev = [target, msg('assistant', null), msg('user', null)];
    const next = mergeContextUsageIntoMessages(prev, {
      input_tokens: 1200, output_tokens: 300, context_used_tokens: 50_000,
    });
    assert.notEqual(next, prev);
    assert.equal(JSON.parse(next[0].token_usage!).context_used_tokens, 50_000);
  });

  it('context_used_tokens 缺失或 0 → 原样返回', () => {
    const prev = [msg('assistant', { input_tokens: 1200, output_tokens: 300 })];
    assert.equal(mergeContextUsageIntoMessages(prev, { input_tokens: 1200, output_tokens: 300 }), prev);
    assert.equal(
      mergeContextUsageIntoMessages(prev, {
        input_tokens: 1200, output_tokens: 300, context_used_tokens: 0,
      }),
      prev,
    );
  });
});

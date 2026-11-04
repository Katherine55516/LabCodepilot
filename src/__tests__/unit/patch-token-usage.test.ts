/**
 * Locks patchLatestAssistantTokenUsage — the late context-usage snapshot
 * backfill (FIX(权威分子)). The turn must NOT wait for getContextUsage (it can
 * take tens of seconds in packaged env), so the snapshot lands via this patch
 * after the message row already exists. Guards: latest-assistant-only,
 * match-mismatch rejection (next turn already started), merge-not-replace.
 *
 * Run with: npx tsx --test src/__tests__/unit/patch-token-usage.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Set a temp data dir before importing db module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-patch-usage-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  addMessage,
  getMessages,
  patchLatestAssistantTokenUsage,
  getLatestAssistantContextUsage,
} = require('../../lib/db') as typeof import('../../lib/db');

function latestUsage(sessionId: string): Record<string, unknown> {
  const { messages } = getMessages(sessionId);
  const assistants = messages.filter((m) => m.role === 'assistant');
  const last = assistants[assistants.length - 1];
  return last?.token_usage ? JSON.parse(last.token_usage) : {};
}

describe('patchLatestAssistantTokenUsage', () => {
  it('merges snapshot fields into the latest assistant message', () => {
    const s = createSession('t1', 'stub-model');
    addMessage(s.id, 'user', 'hi');
    addMessage(
      s.id, 'assistant', 'ok',
      JSON.stringify({ input_tokens: 12345, output_tokens: 5, model: 'stub-model' }),
    );

    const ok = patchLatestAssistantTokenUsage(
      s.id,
      { input_tokens: 12345, output_tokens: 5 },
      { context_used_tokens: 65432, cli_context_window: 200000 },
    );

    assert.equal(ok, true);
    const usage = latestUsage(s.id);
    assert.equal(usage.context_used_tokens, 65432);
    assert.equal(usage.cli_context_window, 200000);
    assert.equal(usage.input_tokens, 12345); // merge, not replace
    assert.equal(usage.model, 'stub-model');
  });

  it('rejects when match mismatches (next turn already persisted)', () => {
    const s = createSession('t2', 'stub-model');
    addMessage(
      s.id, 'assistant', 'turn-2 answer',
      JSON.stringify({ input_tokens: 999, output_tokens: 9 }),
    );

    // Snapshot from turn-1 (input 12345) arrives late — latest row is turn-2.
    const ok = patchLatestAssistantTokenUsage(
      s.id,
      { input_tokens: 12345, output_tokens: 5 },
      { context_used_tokens: 65432 },
    );

    assert.equal(ok, false);
    assert.equal(latestUsage(s.id).context_used_tokens, undefined); // untouched
  });

  it('patches only the latest assistant message', () => {
    const s = createSession('t3', 'stub-model');
    addMessage(s.id, 'assistant', 'old', JSON.stringify({ input_tokens: 1, output_tokens: 1 }));
    addMessage(s.id, 'assistant', 'new', JSON.stringify({ input_tokens: 2, output_tokens: 2 }));

    const ok = patchLatestAssistantTokenUsage(
      s.id,
      { input_tokens: 2, output_tokens: 2 },
      { context_used_tokens: 100 },
    );

    assert.equal(ok, true);
    const { messages } = getMessages(s.id);
    const assistants = messages.filter((m) => m.role === 'assistant');
    const oldUsage = JSON.parse(assistants[0].token_usage!);
    const newUsage = JSON.parse(assistants[1].token_usage!);
    assert.equal(oldUsage.context_used_tokens, undefined);
    assert.equal(newUsage.context_used_tokens, 100);
  });

  it('returns false when the session has no assistant message', () => {
    const s = createSession('t4', 'stub-model');
    addMessage(s.id, 'user', 'hi');
    assert.equal(
      patchLatestAssistantTokenUsage(s.id, null, { context_used_tokens: 1 }),
      false,
    );
  });

  it('null match patches unconditionally (no cross-turn guard requested)', () => {
    const s = createSession('t5', 'stub-model');
    addMessage(s.id, 'assistant', 'ok', null);
    const ok = patchLatestAssistantTokenUsage(s.id, null, { context_used_tokens: 7 });
    assert.equal(ok, true);
    assert.equal(latestUsage(s.id).context_used_tokens, 7);
  });
});

/**
 * getLatestAssistantContextUsage —— 上面那条后补链的读侧
 * (context-usage-accuracy-overhaul Phase 1B):
 * /api/chat/sessions/[id]/context-usage 端点与服务端压缩的分母解析都读它。
 * 字段是白名单:token_usage 里的成本/缓存等其余字段不得外泄给前端轮询。
 */
describe('getLatestAssistantContextUsage', () => {
  it('返回最新一条 assistant 的上下文字段(白名单,不含 cost/cache)', () => {
    const s = createSession('g1', 'stub-model');
    addMessage(s.id, 'user', 'hi');
    addMessage(
      s.id, 'assistant', 'ok',
      JSON.stringify({
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 90_000,
        cost_usd: 0.42,
        model: 'qwen3.7-plus[1m]',
        context_used_tokens: 116_842,
        context_window: 1_000_000,
      }),
    );

    const ctx = getLatestAssistantContextUsage(s.id);
    assert.deepEqual(ctx, {
      input_tokens: 1200,
      output_tokens: 300,
      context_used_tokens: 116_842,
      context_window: 1_000_000,
      context_accounting: undefined,
      model: 'qwen3.7-plus[1m]',
    });
  });

  it('探针未回填时 context_used_tokens 缺席（前端据此继续轮询）', () => {
    const s = createSession('g2', 'stub-model');
    addMessage(s.id, 'assistant', 'ok', JSON.stringify({ input_tokens: 5, output_tokens: 1 }));
    const ctx = getLatestAssistantContextUsage(s.id);
    assert.equal(ctx?.context_used_tokens, undefined);
    assert.equal(ctx?.input_tokens, 5);
  });

  it('无 assistant 消息 / token_usage 为空 / JSON 损坏 → null', () => {
    const s1 = createSession('g3', 'stub-model');
    addMessage(s1.id, 'user', 'hi');
    assert.equal(getLatestAssistantContextUsage(s1.id), null);

    const s2 = createSession('g4', 'stub-model');
    addMessage(s2.id, 'assistant', 'ok', null);
    assert.equal(getLatestAssistantContextUsage(s2.id), null);

    const s3 = createSession('g5', 'stub-model');
    addMessage(s3.id, 'assistant', 'ok', '{not json');
    assert.equal(getLatestAssistantContextUsage(s3.id), null);
  });

  it('非数字字段被丢弃（脏数据不得污染分母解析）', () => {
    const s = createSession('g6', 'stub-model');
    addMessage(
      s.id, 'assistant', 'ok',
      JSON.stringify({ input_tokens: 'oops', context_window: null, model: '' }),
    );
    const ctx = getLatestAssistantContextUsage(s.id);
    assert.equal(ctx?.input_tokens, undefined);
    assert.equal(ctx?.context_window, undefined);
    assert.equal(ctx?.model, undefined);
  });
});

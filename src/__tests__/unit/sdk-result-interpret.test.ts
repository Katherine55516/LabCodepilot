/**
 * generateTextViaSdk 的结果判读分支。
 *
 * 回归背景：脚本生成用 outputFormat: json_schema 时，SDK 把校验后的对象放进
 * result 消息的 `structured_output`，`result` 字段可能为空；而 error_* subtype
 * 的 result 消息根本没有 `result` 字段。旧代码只读 `result`，两种情况都被折叠成
 * 一句无信息量的 "SDK query returned no result"（用户实测报错）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { interpretSdkResult } from '@/lib/claude-client';

// 只填被判读逻辑读取的字段；其余用 as 收口，避免复制整个 SDK 类型。
const success = (extra: Record<string, unknown>) =>
  ({ type: 'result', subtype: 'success', is_error: false, ...extra }) as unknown as SDKResultMessage;
const failure = (subtype: string, errors?: string[]) =>
  ({ type: 'result', subtype, is_error: true, ...(errors ? { errors } : {}) }) as unknown as SDKResultMessage;

describe('interpretSdkResult', () => {
  it('json_schema 结果从 structured_output 取，即使 result 为空', () => {
    const payload = { scripts: [{ caseId: 'TC-1', fileName: 'TC-1.spec.ts', content: 'x' }] };
    const text = interpretSdkResult(success({ result: '', structured_output: payload }), true);
    // 契约：返回文本，且能被 script-generator 的 parseJsonResult 直接 JSON.parse。
    assert.deepEqual(JSON.parse(text), payload);
  });

  it('未请求 json_schema 时不碰 structured_output，仍走 result', () => {
    const text = interpretSdkResult(success({ result: 'plain answer', structured_output: { a: 1 } }), false);
    assert.equal(text, 'plain answer');
  });

  it('error_max_structured_output_retries 抛出携带 subtype 与 errors 的错误', () => {
    assert.throws(
      () => interpretSdkResult(failure('error_max_structured_output_retries', ['schema mismatch']), true),
      /\(error_max_structured_output_retries\): schema mismatch/,
    );
  });

  it('error_max_turns 无 errors 时仍带上 subtype', () => {
    assert.throws(() => interpretSdkResult(failure('error_max_turns'), false), /error_max_turns/);
  });

  it('subtype=success 但 is_error 时，把 result 当错误信息抛出而非当答案返回', () => {
    // 实测形态：未登录时 CLI 返回 success + is_error + result="Not logged in · Please run /login"
    assert.throws(
      () => interpretSdkResult(success({ is_error: true, result: 'Not logged in · Please run /login' }), false),
      /Not logged in/,
    );
  });

  it('is_error 优先于空 structured_output，不会被结构化分支吞掉', () => {
    assert.throws(
      () => interpretSdkResult(success({ is_error: true, result: 'boom', structured_output: null }), true),
      /boom/,
    );
  });

  it('成功但 result 为空且无 structured_output → 保留原有的 no result 错误', () => {
    assert.throws(() => interpretSdkResult(success({ result: '' }), false), /returned no result/);
  });

  it('从未收到 result 消息时报告该事实', () => {
    assert.throws(() => interpretSdkResult(null, false), /without a result message/);
  });

  // CLI 以退出码 0 静默结束时 SDK 既不抛异常也不发 result 消息
  // （sdk.mjs getProcessExitError：code===0 && !signal → 返回 undefined）。
  describe('CLI 未发 result 消息', () => {
    const trace = (o: Partial<{ assistantText: string; seenTypes: string[]; stderrTail: string }>) => ({
      assistantText: '', seenTypes: [], stderrTail: '', ...o,
    });

    it('有 assistant 文本时用它兜底，而不是失败', () => {
      const fenced = '```json\n{"scripts":[]}\n```';
      const text = interpretSdkResult(null, true, trace({ assistantText: fenced, seenTypes: ['system', 'assistant'] }));
      assert.equal(text, fenced);
    });

    it('无任何可用输出时，错误里带上见到的消息类型与 CLI stderr', () => {
      assert.throws(
        () => interpretSdkResult(null, true, trace({ seenTypes: ['system'], stderrTail: 'Failed to parse structured output' })),
        (err: unknown) => {
          const msg = (err as Error).message;
          assert.match(msg, /messages seen: system/);
          assert.match(msg, /CLI stderr: Failed to parse structured output/);
          return true;
        },
      );
    });

    it('assistant 文本全是空白时不当作有效结果', () => {
      assert.throws(() => interpretSdkResult(null, false, trace({ assistantText: '  \n ' })), /without a result message/);
    });
  });

  it('success 但结构化输出缺失且 result 为空时，回退到 assistant 文本', () => {
    const text = interpretSdkResult(
      success({ result: '', structured_output: null }),
      true,
      { assistantText: '{"scripts":[]}', seenTypes: ['assistant', 'result'], stderrTail: '' },
    );
    assert.equal(text, '{"scripts":[]}');
  });
});

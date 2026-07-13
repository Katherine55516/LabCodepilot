/**
 * 生成期瞬时错误分类器（决定单条生成是否退避重试）。
 *
 * 真机实测：企业代理不稳，单条脚本生成会以三种面孔失败——SDK 超时、连接中途掐断、
 * 平台后台刷 token 窗口内网关回绝那次调用的伪「未登录」。三者都是瞬时的、退避重发能自愈，
 * 必须判为可重试。反之，校验不过/断言不符/AI 未返回是确定性失败，重试只是空耗，绝不能重试。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientGenerationError } from '@/lib/test/script-job-manager';

describe('isTransientGenerationError', () => {
  it('三种真机实测的瞬时错误 → 可重试', () => {
    assert.equal(isTransientGenerationError('SDK query timed out after 240s'), true);
    assert.equal(isTransientGenerationError('Claude Code returned an error result: API Error: Connection closed mid-response. The response above may be incomplete.'), true);
    assert.equal(isTransientGenerationError('Claude Code returned an error result: Not logged in · Please run /login'), true);
  });

  it('常见网络错误码 / 网关码 → 可重试', () => {
    for (const m of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'socket hang up', 'fetch failed', 'network error', 'HTTP 429', 'status 502', '503 Service Unavailable', '504 Gateway Timeout']) {
      assert.equal(isTransientGenerationError(m), true, `预期可重试: ${m}`);
    }
  });

  it('确定性失败（校验/断言/AI 未返回）→ 不重试', () => {
    for (const m of [
      '禁止动态代码执行或直连网络（eval/Function/fetch）',
      '不允许 import 该模块: @playwright/test',
      'Playwright 自动重放失败: expect(locator).toBeVisible() failed',
      'AI 未返回该用例的脚本',
      'AI 返回的内容不是有效 JSON',
      '每个脚本必须恰好一个 test()',
    ]) {
      assert.equal(isTransientGenerationError(m), false, `预期不重试: ${m}`);
    }
  });

  it('不把 "fetch" 校验错误误判为网络瞬时错误（关键：措辞相近但语义相反）', () => {
    // 「直连网络（...fetch)」是校验拦截，不是网络故障——绝不能因为含 network/fetch 字样就重试。
    assert.equal(isTransientGenerationError('禁止动态代码执行或直连网络（eval/Function/fetch）'), false);
  });
});

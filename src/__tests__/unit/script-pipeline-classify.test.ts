/**
 * 自动流水线的环境失败分类器。
 *
 * 流水线「运行→失败自动修→再跑」的终止正确性依赖它：连接被拒 = 被测应用没起，
 * 不是脚本缺陷，绝不能喂给 AI 修（会浪费调用、且 AI 无从下手）；这类用例应被
 * park 为「环境阻塞」而非「未修复」。反之，定位器/断言失败必须归为可修复。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEnvironmentFailure } from '@/lib/test/script-job-manager';

describe('isEnvironmentFailure', () => {
  it('连接被拒（被测应用没起，实测最常见）→ 环境问题', () => {
    assert.equal(isEnvironmentFailure('Error: page.goto: net::ERR_CONNECTION_REFUSED at ${BASE_URL}/'), true);
  });

  it('域名解析失败 / 主机不可达 / 连接重置 → 环境问题', () => {
    assert.equal(isEnvironmentFailure('net::ERR_NAME_NOT_RESOLVED'), true);
    assert.equal(isEnvironmentFailure('net::ERR_ADDRESS_UNREACHABLE'), true);
    assert.equal(isEnvironmentFailure('net::ERR_CONNECTION_RESET'), true);
    assert.equal(isEnvironmentFailure('connect ECONNREFUSED 127.0.0.1:3000'), true);
    assert.equal(isEnvironmentFailure('getaddrinfo ENOTFOUND localhost'), true);
  });

  it('定位器歧义 / 找不到元素 / 断言失败 → 不是环境问题（应交给 AI 修或人工）', () => {
    assert.equal(isEnvironmentFailure('Error: strict mode violation: resolved to 6 elements'), false);
    assert.equal(isEnvironmentFailure('Error: expect(locator).toBeVisible() failed'), false);
    assert.equal(isEnvironmentFailure('Error: expect(locator).toBeDisabled() failed'), false);
    assert.equal(isEnvironmentFailure('locator.click: element(s) not found'), false);
  });

  it('脚本超时不算环境问题（可能是脚本缺等待，交给 AI 修）', () => {
    assert.equal(isEnvironmentFailure('TimeoutError: locator.click: Timeout 5000ms exceeded'), false);
  });
});

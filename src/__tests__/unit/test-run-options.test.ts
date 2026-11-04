import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDepositScripts } from '../../lib/test/run-options';

describe('resolveDepositScripts', () => {
  it('冒烟测试无论请求缺省、true 或 false 都强制关闭脚本沉淀', () => {
    assert.equal(resolveDepositScripts('smoke', undefined), false);
    assert.equal(resolveDepositScripts('smoke', true), false);
    assert.equal(resolveDepositScripts('smoke', false), false);
  });

  it('功能测试保留旧客户端口径：缺省/true 开启，false 关闭', () => {
    assert.equal(resolveDepositScripts(undefined, undefined), true);
    assert.equal(resolveDepositScripts(undefined, true), true);
    assert.equal(resolveDepositScripts(undefined, false), false);
  });
});

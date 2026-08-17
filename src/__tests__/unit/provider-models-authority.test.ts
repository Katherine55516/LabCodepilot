/**
 * 模型列表权威性判定单测（src/hooks/useProviderModels.ts isModelListAuthoritative）。
 *
 * 背景（2026-08-17 线上取证，main.log 自 07-27 累计 28 次）：
 * /api/providers/models 失败/中断/托管未同步时，useProviderModels 会把选项
 * 顶替成内置 DEFAULT_MODEL_OPTIONS 或别的服务商的组；MessageInput 的模型
 * 自动纠偏在顶替列表上误开火 → PATCH 改模型 → 服务端 #343/#346 守卫清
 * sdk_session_id → 下一轮 resume 没了，上下文被静默重置成 fallback 文本包
 * （用量卡片 24%→10% 骤降的真凶）。纠偏只允许在"本会话服务商自己的、服务端
 * 成功返回的"列表上开火。
 *
 * Run with: npx tsx --test src/__tests__/unit/provider-models-authority.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isModelListAuthoritative } from '@/hooks/useProviderModels';

describe('isModelListAuthoritative', () => {
  it('fetch 成功 + 组匹配本会话服务商 → 可信（纠偏允许开火）', () => {
    assert.equal(
      isModelListAuthoritative({
        fetchSucceeded: true,
        currentGroupProviderId: 'managed-deepseek',
        resolvedProviderId: 'managed-deepseek',
      }),
      true,
    );
  });

  it('fetch 失败（网络中断 → catch 顶替内置列表）→ 不可信', () => {
    assert.equal(
      isModelListAuthoritative({
        fetchSucceeded: false,
        currentGroupProviderId: 'env',
        resolvedProviderId: 'env',
      }),
      false,
    );
  });

  it('首次渲染 fetch 未返回 → 不可信', () => {
    assert.equal(
      isModelListAuthoritative({
        fetchSucceeded: false,
        currentGroupProviderId: undefined,
        resolvedProviderId: 'managed-deepseek',
      }),
      false,
    );
  });

  it('托管会话但响应里没有该服务商（组被 providerGroups[0] 顶替）→ 不可信', () => {
    // 线上事故形态:managed 列表未同步,组顶替成 env/Anthropic,
    // deepseek-v4-flash[1m] 必然"不在列表"。
    assert.equal(
      isModelListAuthoritative({
        fetchSucceeded: true,
        currentGroupProviderId: 'env',
        resolvedProviderId: 'managed-deepseek',
      }),
      false,
    );
  });

  it('env 会话 fetch 成功且落在 env 组 → 可信（合法纠偏保留:模型真被下架时仍要纠）', () => {
    assert.equal(
      isModelListAuthoritative({
        fetchSucceeded: true,
        currentGroupProviderId: 'env',
        resolvedProviderId: 'env',
      }),
      true,
    );
  });
});

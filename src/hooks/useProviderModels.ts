import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ProviderModelGroup } from '@/types';

// Default Claude model options — used as fallback when API is unavailable
export interface DefaultModelOption {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

export const DEFAULT_MODEL_OPTIONS: DefaultModelOption[] = [
  {
    value: 'sonnet',
    label: 'Sonnet 4.6',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  },
  {
    value: 'opus',
    label: 'Opus 4.7',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'haiku',
    label: 'Haiku 4.5',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
];

export interface UseProviderModelsReturn {
  providerGroups: ProviderModelGroup[];
  currentProviderIdValue: string;
  modelOptions: typeof DEFAULT_MODEL_OPTIONS;
  currentModelOption: (typeof DEFAULT_MODEL_OPTIONS)[number];
  /** Global default model (model value) */
  globalDefaultModel: string | undefined;
  /** Global default model's provider ID */
  globalDefaultProvider: string | undefined;
  /**
   * modelOptions 是否是"本会话服务商自己的、服务端成功返回的"列表 ——
   * MessageInput 的模型自动纠偏(不在列表则回退第一项并 PATCH 持久化)
   * **只允许在 true 时开火**。
   *
   * 为什么(2026-08-17 线上取证,main.log 共 28 次误清):/api/providers/models
   * 请求失败/被中断/托管列表未同步时,本 hook 会把选项顶替成内置
   * DEFAULT_MODEL_OPTIONS(sonnet/opus/haiku)或别的服务商的组 —— 托管会话
   * 的模型(如 deepseek-v4-flash[1m])当然不在顶替列表里,纠偏误开火 →
   * PATCH 改模型 → 服务端 #343/#346 守卫清 sdk_session_id → 下一轮 resume
   * 没了,上下文被静默重置成 fallback 文本包(用户可感知:用量卡片 24%→10%)。
   * 真列表几秒后到达再纠回来,模型看起来没变,会话血统已毁。
   */
  modelListAuthoritative: boolean;
}

/**
 * 纯函数:判定"当前 modelOptions 可信,允许自动纠偏持久化"。
 * 导出仅为单测(provider-models-authority.test.ts)。
 */
export function isModelListAuthoritative(params: {
  /** /api/providers/models 是否已成功应答过(catch/未返回 = false)。 */
  fetchSucceeded: boolean;
  /** 实际选中的组的 provider_id(可能是 providerGroups[0] 顶替)。 */
  currentGroupProviderId: string | undefined;
  /** 会话解析出的 provider id(providerId ?? 全局默认 ?? 首组)。 */
  resolvedProviderId: string;
}): boolean {
  return (
    params.fetchSucceeded &&
    !!params.currentGroupProviderId &&
    params.currentGroupProviderId === params.resolvedProviderId
  );
}

export function useProviderModels(
  providerId?: string,
  modelName?: string,
): UseProviderModelsReturn {
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string>('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState<string | undefined>();
  const [globalDefaultProvider, setGlobalDefaultProvider] = useState<string | undefined>();
  // 服务端是否成功应答过模型列表。catch(网络失败/中断)会顶替内置默认列表
  // 用于**展示**,但那不是权威数据 —— 见 modelListAuthoritative。
  const [fetchSucceeded, setFetchSucceeded] = useState(false);

  const fetchAll = useCallback(() => {
    fetch('/api/providers/models')
      .then((r) => r.json())
      .then((data) => {
        if (data.groups && data.groups.length > 0) {
          setProviderGroups(data.groups);
        } else {
          setProviderGroups([{
            provider_id: 'env',
            provider_name: 'Anthropic',
            provider_type: 'anthropic',
            models: DEFAULT_MODEL_OPTIONS,
          }]);
        }
        setDefaultProviderId(data.default_provider_id || '');
        setFetchSucceeded(true);
      })
      .catch(() => {
        setProviderGroups([{
          provider_id: 'env',
          provider_name: 'Anthropic',
          provider_type: 'anthropic',
          models: DEFAULT_MODEL_OPTIONS,
        }]);
        setDefaultProviderId('');
        setFetchSucceeded(false); // 顶替列表不可信,禁自动纠偏
      });

    // Fetch global default model
    fetch('/api/providers/options?providerId=__global__')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setGlobalDefaultModel(data?.options?.default_model || undefined);
        setGlobalDefaultProvider(data?.options?.default_model_provider || undefined);
      })
      .catch(() => {});
  }, []);

  // Load on mount and listen for provider changes
  useEffect(() => {
    fetchAll();
    const handler = () => fetchAll();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchAll]);

  // Derive flat model list for current provider
  // Use globalDefaultProvider as fallback instead of the legacy default_provider_id
  const currentProviderIdValue = providerId || globalDefaultProvider || defaultProviderId || (providerGroups[0]?.provider_id ?? '');
  const currentGroup = providerGroups.find(g => g.provider_id === currentProviderIdValue) || providerGroups[0];
  const modelOptions = (currentGroup?.models && currentGroup.models.length > 0)
    ? currentGroup.models
    : DEFAULT_MODEL_OPTIONS;

  // Project to the current provider's first model when the session has no model
  // (managed mode) rather than the bare 'sonnet' alias, which may not exist in
  // the managed catalog. env mode keeps sonnet via DEFAULT_MODEL_OPTIONS[0].
  const currentModelValue = modelName || modelOptions[0]?.value || 'sonnet';
  // 在 useMemo 之前算好(而非 return 里内联):return 对象里引用 memo 依赖之外
  // 的派生值会让 React Compiler 放弃保留下方手写 memo(preserve-manual-memoization)。
  const modelListAuthoritative = isModelListAuthoritative({
    fetchSucceeded,
    currentGroupProviderId: currentGroup?.provider_id,
    resolvedProviderId: currentProviderIdValue,
  });
  const currentModelOption = useMemo(
    () => modelOptions.find((m) => m.value === currentModelValue) || modelOptions[0],
    [modelOptions, currentModelValue],
  );

  return {
    providerGroups,
    currentProviderIdValue,
    modelOptions,
    currentModelOption,
    globalDefaultModel,
    globalDefaultProvider,
    modelListAuthoritative,
  };
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { localize } from '@/i18n/zh-hk-runtime';
import { Badge } from '@/components/ui/badge';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';
import { resolveLegacyRuntimeForDisplay, type ConcreteRuntime } from '@/lib/runtime/legacy';

interface RuntimeBadgeProps {
  providerId?: string;
}

const LABELS: Record<ConcreteRuntime, { en: string; zh: string }> = {
  native: { en: 'Agent: AI SDK', zh: 'Agent 引擎：AI SDK' },
  'claude-code-sdk': { en: 'Agent: Claude Code', zh: 'Agent 引擎：Claude Code' },
};

export function RuntimeBadge({ providerId }: RuntimeBadgeProps) {
  // 0.50.3 removed 'auto' as a user-visible state. We still read whatever is
  // stored (possibly 'auto' on legacy rows) but coerce immediately via
  // resolveLegacyRuntimeForDisplay — the badge never surfaces 'Agent: Auto'.
  const [runtimeSetting, setRuntimeSetting] = useState<ConcreteRuntime>('claude-code-sdk');
  const router = useRouter();
  const { t, locale } = useTranslation();

  // OpenAI models can't use Claude Code SDK — forced to AI SDK
  const isNonAnthropicProvider = providerId === 'openai-oauth';
  const effectiveRuntime: ConcreteRuntime = isNonAnthropicProvider ? 'native' : runtimeSetting;
  const isOverridden = isNonAnthropicProvider && runtimeSetting === 'claude-code-sdk';

  useEffect(() => {
    const loadRuntime = async () => {
      try {
        const settingsRes = await fetch('/api/settings/app').catch(() => null);
        const settings = settingsRes?.ok ? await settingsRes.json() : null;
        const saved = settings?.settings?.agent_runtime;
        // Bundled Claude Code is always available, so the legacy
        // `cliConnected` argument is irrelevant — pass true.
        setRuntimeSetting(resolveLegacyRuntimeForDisplay(saved, true));
      } catch {
        /* ignore — keep previous runtimeSetting */
      }
    };
    loadRuntime();
    const handler = () => loadRuntime();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, []);

  const label = LABELS[effectiveRuntime];

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-accent"
          onClick={() => router.push('/settings#cli')}
        >
          {localize(locale, label.zh, label.en)}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-56 p-3 text-xs space-y-1.5">
        {isOverridden ? (
          <>
            <p>{localize(locale,
              `当前使用 AI SDK 引擎（全局设置为 ${LABELS[runtimeSetting].zh}）`,
              `Using AI SDK engine (global setting: ${LABELS[runtimeSetting].en})`
            )}</p>
            <p className="text-muted-foreground">
              {localize(locale,
                'OpenAI 模型不支持 Claude Code 引擎，已自动切换为 AI SDK',
                'OpenAI models are not compatible with Claude Code engine, automatically switched to AI SDK'
              )}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">
            {effectiveRuntime === 'native'
              ? localize(locale, 'AI SDK：内置多模型引擎，无需 CLI', 'AI SDK: built-in multi-model engine, no CLI required')
              : localize(locale, 'Claude Code：内置原生二进制，开箱即用', 'Claude Code: bundled native binary, ready out of the box')
            }
          </p>
        )}
        <p className="text-muted-foreground">
          {localize(locale, '点击前往设置', 'Click to open settings')}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

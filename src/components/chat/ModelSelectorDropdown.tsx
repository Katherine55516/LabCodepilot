'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown, Gear } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import type { ProviderModelGroup } from '@/types';
import {
  CommandList,
  CommandListSearch,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
  CommandListFooter,
  CommandListFooterAction,
} from '@/components/patterns';

// Managed provider row returned by /api/providers — only the fields we need.
interface ManagedProviderRow {
  id: string;
  name: string;
  source?: string;
  sort_order?: number;
}

interface ModelOption {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

interface ModelSelectorDropdownProps {
  currentModelValue: string;
  currentProviderIdValue: string;
  providerGroups: ProviderModelGroup[];
  modelOptions: ModelOption[];
  onModelChange?: (model: string) => void;
  onProviderModelChange?: (providerId: string, model: string) => void;
  /** Global default model value */
  globalDefaultModel?: string;
  /** Global default model's provider ID */
  globalDefaultProvider?: string;
}

export function ModelSelectorDropdown({
  currentModelValue,
  currentProviderIdValue,
  providerGroups,
  modelOptions,
  onModelChange,
  onProviderModelChange,
  globalDefaultModel,
  globalDefaultProvider,
}: ModelSelectorDropdownProps) {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  // Managed providers (source='managed') — drives the flat 6-item list.
  // Local / built-in providers are intentionally excluded so the menu only
  // surfaces what the account backend has pushed.
  const [managedProviders, setManagedProviders] = useState<ManagedProviderRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/providers')
        .then((r) => (r.ok ? r.json() : { providers: [] }))
        .then((data) => {
          if (cancelled) return;
          const all: ManagedProviderRow[] = data?.providers ?? [];
          const managed = all
            .filter((p) => p.source === 'managed')
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          setManagedProviders(managed);
        })
        .catch(() => { if (!cancelled) setManagedProviders([]); });
    };
    load();
    // Refresh when provider list changes elsewhere (settings refresh, login).
    const handler = () => load();
    window.addEventListener('provider-changed', handler);
    return () => { cancelled = true; window.removeEventListener('provider-changed', handler); };
  }, []);

  const currentModelOption = modelOptions.find((m) => m.value === currentModelValue) || modelOptions[0];
  // Prefer showing the managed provider's name on the trigger button so the
  // label in the chat composer matches what users selected from the menu.
  const currentProviderName = managedProviders.find((p) => p.id === currentProviderIdValue)?.name
    ?? providerGroups.find((g) => g.provider_id === currentProviderIdValue)?.provider_name;

  // Is the currently displayed model the global default?
  const isCurrentDefault = !!(
    globalDefaultModel &&
    globalDefaultProvider &&
    currentModelValue === globalDefaultModel &&
    currentProviderIdValue === globalDefaultProvider
  );

  // Click outside to close model menu
  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
        setModelSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  const handleModelSelect = useCallback((providerId: string, modelValue: string) => {
    onModelChange?.(modelValue);
    onProviderModelChange?.(providerId, modelValue);
    localStorage.setItem('codepilot:last-model', modelValue);
    localStorage.setItem('codepilot:last-provider-id', providerId);
    setModelMenuOpen(false);
    setModelSearch('');
  }, [onModelChange, onProviderModelChange]);

  const mq = modelSearch.toLowerCase();
  // Flat list: one entry per managed provider, in sort_order order.
  // The legacy `filteredGroups` (grouped by provider, multiple models each)
  // is no longer rendered — kept here for reference / future restore.
  // const filteredGroups = providerGroups.map(group => ({
  //   ...group,
  //   models: group.models.filter(opt =>
  //     !mq || opt.label.toLowerCase().includes(mq) || group.provider_name.toLowerCase().includes(mq)
  //   ),
  // })).filter(group => group.models.length > 0);

  const flatItems = managedProviders
    .map((mp) => {
      const group = providerGroups.find((g) => g.provider_id === mp.id);
      const firstModel = group?.models[0];
      return {
        providerId: mp.id,
        providerName: mp.name,
        modelValue: firstModel?.value ?? currentModelValue,
      };
    })
    .filter((item) => !mq || item.providerName.toLowerCase().includes(mq));

  return (
    <div className="relative" ref={modelMenuRef}>
      <PromptInputButton
        onClick={() => setModelMenuOpen((prev) => !prev)}
      >
        <span className="text-xs font-mono">{currentProviderName ?? currentModelOption?.label}</span>
        {isCurrentDefault && (
          <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-medium ml-0.5">
            {isZh ? '默认' : 'Default'}
          </span>
        )}
        <CaretDown size={10} className={cn("transition-transform duration-200", modelMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {modelMenuOpen && (
        <CommandList className="w-64 mb-1.5">
          {/* Search input hidden — modelSearch state stays empty so
              flatItems filter is effectively a no-op (all managed providers
              shown). CommandListSearch import + Escape-to-close behaviour
              preserved; restore by uncommenting. */}
          {/* <CommandListSearch
            placeholder={t('composer.searchModels' as TranslationKey)}
            value={modelSearch}
            onChange={setModelSearch}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setModelMenuOpen(false);
                setModelSearch('');
              }
            }}
          /> */}
          <CommandListItems>
            <div className="py-0.5">
              {flatItems.map((item) => {
                const isActive = item.providerId === currentProviderIdValue;
                const isDefault = !!(
                  globalDefaultProvider && item.providerId === globalDefaultProvider
                );
                return (
                  <CommandListItem
                    key={item.providerId}
                    active={isActive}
                    onClick={() => handleModelSelect(item.providerId, item.modelValue)}
                    className="justify-between"
                  >
                    <span className="font-mono text-xs flex items-center gap-1.5">
                      {item.providerName}
                      {isDefault && (
                        <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-medium">
                          {isZh ? '默认' : 'Default'}
                        </span>
                      )}
                    </span>
                    {isActive && <span className="text-xs">&#10003;</span>}
                  </CommandListItem>
                );
              })}
            </div>
            {flatItems.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                {managedProviders.length === 0
                  ? (isZh ? '暂无托管配置' : 'No managed configs')
                  : (isZh ? '无匹配项' : 'No matches')}
              </div>
            )}
          </CommandListItems>
          {/* "管理服务商" footer button hidden — handleModelSelect / providers
              route still functional via /settings#providers direct link.
              Restore by uncommenting. */}
          {/* <CommandListFooter>
            <CommandListFooterAction onClick={() => { setModelMenuOpen(false); setModelSearch(''); window.location.href = '/settings#providers'; }}>
              <Gear size={14} />
              {t('composer.manageProviders' as TranslationKey)}
            </CommandListFooterAction>
          </CommandListFooter> */}
        </CommandList>
      )}
    </div>
  );
}

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown, Gear } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { localize } from '@/i18n/zh-hk-runtime';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import type { ProviderModelGroup } from '@/types';
import { useManagedMultimodal } from '@/hooks/useManagedMultimodal';
import {
  CommandList,
  CommandListSearch,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
  CommandListFooter,
  CommandListFooterAction,
} from '@/components/patterns';

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
  /** Which side the menu opens. 'top' (default) = upward, for the bottom composer.
   *  'bottom' = downward, for triggers in a top header (e.g. the test workbench). */
  menuSide?: 'top' | 'bottom';
  /** Horizontal anchor. 'left' (default) anchors the menu's left edge to the
   *  trigger (left-aligned composer). 'right' anchors the right edge, so a
   *  right-aligned trigger (e.g. the test workbench header) doesn't overflow
   *  the viewport's right edge. */
  menuAlign?: 'left' | 'right';
}

export function ModelSelectorDropdown({
  currentModelValue,
  currentProviderIdValue,
  providerGroups,
  onModelChange,
  onProviderModelChange,
  globalDefaultModel,
  globalDefaultProvider,
  menuSide = 'top',
  menuAlign = 'left',
}: ModelSelectorDropdownProps) {
  const { t, locale } = useTranslation();
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  // Managed providers (source='managed') enriched with a multimodal flag —
  // drives the flat list. Local / built-in providers are intentionally
  // excluded so the menu only surfaces what the account backend has pushed.
  // The「多模态」detection + fetch + provider-changed refresh live in the
  // shared useManagedMultimodal hook (also used by the composer upload guard).
  const { managed: managedProviders } = useManagedMultimodal();

  // The trigger label MUST be a strict projection of the rendered list
  // (flatItems below is built from managedProviders). This dropdown only ever
  // lists MANAGED providers (source==='managed'); the built-in env "Claude
  // Code" group and local/BYOK providers are intentionally NOT rendered. So we
  // resolve the trigger label ONLY against managedProviders — never against
  // `providerGroups`, which still contains the env group whose provider_name is
  // literally "Claude Code". When the active selection is not a rendered
  // managed provider (env / local / empty list), the trigger shows a neutral
  // placeholder instead of a phantom identifier the list does not contain.
  // This enforces the invariant: the selector never displays a model identifier
  // absent from the list.
  const selectedManaged = managedProviders.find((p) => p.id === currentProviderIdValue);

  // The "默认" badge is only meaningful when the trigger actually shows a
  // rendered managed provider — never decorate the placeholder.
  const isCurrentDefault = !!(
    selectedManaged &&
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

  // Self-correct an out-of-list selection: if the active provider is not one of
  // the rendered managed providers (e.g. it resolved to the built-in env
  // "Claude Code" group via useProviderModels' providerGroups[0] fallback, or a
  // stale localStorage id), snap to the first managed provider that actually has
  // models so the label, the highlighted row, and the model that gets sent all
  // agree with the list. Do NOTHING when there are no managed providers —
  // env-only / local installs legitimately run through the Claude Code SDK and
  // must keep their default; the trigger simply shows the placeholder. The guard
  // `managedProviders.length === 0` also prevents firing during the initial load
  // race (managed list still empty), and once a valid provider is selected the
  // membership check short-circuits, so this never loops.
  useEffect(() => {
    if (managedProviders.length === 0) return;
    const inList = managedProviders.some((p) => p.id === currentProviderIdValue);
    if (inList) return;
    const target = managedProviders.find((p) => {
      const g = providerGroups.find((gr) => gr.provider_id === p.id);
      return (g?.models?.length ?? 0) > 0;
    });
    if (!target) return;
    const targetModel = providerGroups.find((g) => g.provider_id === target.id)?.models[0]?.value;
    if (!targetModel) return;
    onProviderModelChange?.(target.id, targetModel);
    onModelChange?.(targetModel);
  }, [managedProviders, currentProviderIdValue, providerGroups, onProviderModelChange, onModelChange]);

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
        isMultimodal: mp.isMultimodal,
      };
    })
    .filter((item) => !mq || item.providerName.toLowerCase().includes(mq));

  return (
    <div className="relative" ref={modelMenuRef}>
      <PromptInputButton
        onClick={() => setModelMenuOpen((prev) => !prev)}
      >
        <span className="text-xs font-mono">
          {selectedManaged?.name ?? localize(locale, '选择模型', 'Select model')}
        </span>
        {isCurrentDefault && (
          <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-medium ml-0.5">
            {localize(locale, '默认', 'Default')}
          </span>
        )}
        <CaretDown size={10} className={cn("transition-transform duration-200", modelMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {modelMenuOpen && (
        <CommandList className={cn("w-64", menuSide === 'bottom' ? "top-full bottom-auto mt-1.5 mb-0" : "mb-1.5", menuAlign === 'right' && "left-auto right-0")}>
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
                      {item.isMultimodal && (
                        <span className="text-muted-foreground/60">
                          {t('composer.multimodalSuffix' as TranslationKey)}
                        </span>
                      )}
                      {isDefault && (
                        <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-medium">
                          {localize(locale, '默认', 'Default')}
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
                  ? localize(locale, '暂无托管配置', 'No managed configs')
                  : localize(locale, '无匹配项', 'No matches')}
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

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { ProviderModelGroup } from '@/types';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
} from '@/components/patterns';

interface BridgeModelSelectorProps {
  /** Composite "providerId::model" value (or a bare model / empty string). */
  value: string;
  /** Emits the new composite "providerId::model" on selection. */
  onChange: (composite: string) => void;
  /** Provider+model groups from /api/providers/models (owned by the parent). */
  providerGroups: ProviderModelGroup[];
}

/**
 * Bridge default-model picker — flat one-row-per-provider list, matching the
 * chat composer's ModelSelectorDropdown look & behaviour: rounded popover,
 * hover/active rows, checkmark on the selected row, and a trigger showing the
 * current provider's name.
 *
 * Each row selects that provider's PRIMARY (first) model. Multi-model
 * providers are therefore not individually addressable here — that's an
 * intentional trade chosen by the user in favour of matching the chat UI
 * exactly (an earlier grouped variant kept every model selectable but looked
 * too much like the old native <select>).
 *
 * Difference from the chat dropdown: that one lists managed providers only;
 * the bridge default may target any configured provider (env "Claude Code",
 * local BYOK, or managed), so we render every group from providerGroups.
 *
 * Form-context tweaks: full-width form-style trigger (not a PromptInputButton),
 * popover opens downward (top-full), and no localStorage side effects.
 */
export function BridgeModelSelector({
  value,
  onChange,
  providerGroups,
}: BridgeModelSelectorProps) {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Parse the composite "providerId::model". indexOf (not split) so a model id
  // that itself contains "::" stays intact.
  const sepIdx = value.indexOf('::');
  const currentProviderId = sepIdx >= 0 ? value.slice(0, sepIdx) : '';
  const currentModel = sepIdx >= 0 ? value.slice(sepIdx + 2) : value;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // One row per provider; selecting a row uses that provider's first model.
  const flatItems = providerGroups.map((g) => ({
    providerId: g.provider_id,
    providerName: g.provider_name,
    modelValue: g.models[0]?.value ?? '',
  }));

  // Trigger shows the current provider's name; falls back to the raw model id
  // (e.g. a stale "default") or a placeholder when nothing resolves.
  const currentProviderName = providerGroups.find(
    (g) => g.provider_id === currentProviderId,
  )?.provider_name;
  const triggerLabel = currentProviderName ?? (currentModel || undefined);

  const handleSelect = useCallback(
    (providerId: string, modelValue: string) => {
      onChange(`${providerId}::${modelValue}`);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm transition-colors',
          'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <span className={cn('truncate font-mono', !triggerLabel && 'text-muted-foreground')}>
          {triggerLabel ?? (isZh ? '选择模型' : 'Select a model')}
        </span>
        <CaretDown
          size={14}
          className={cn('shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        // Override CommandList's default upward placement (bottom-full, for the
        // chat composer) with a downward popover suited to a mid-form field.
        <CommandList className="w-full bottom-auto top-full mb-0 mt-2">
          <CommandListItems>
            <div className="py-0.5">
              {flatItems.map((item) => {
                const isActive = item.providerId === currentProviderId;
                return (
                  <CommandListItem
                    key={item.providerId}
                    active={isActive}
                    onClick={() => handleSelect(item.providerId, item.modelValue)}
                    className="justify-between"
                  >
                    <span className="truncate font-mono text-xs">{item.providerName}</span>
                    {isActive && <span className="shrink-0 text-xs">&#10003;</span>}
                  </CommandListItem>
                );
              })}
            </div>
            {flatItems.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                {isZh ? '暂无可用模型' : 'No models available'}
              </div>
            )}
          </CommandListItems>
        </CommandList>
      )}
    </div>
  );
}

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
  CommandListGroup,
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
 * Bridge default-model picker.
 *
 * Reuses the chat composer's CommandList look & feel (rounded popover,
 * hover/active states, checkmark on the selected row) but keeps the bridge's
 * original data shape: every provider group is shown, with each concrete model
 * individually selectable — unlike the chat ModelSelectorDropdown which lists
 * only managed providers as a flat one-row-per-provider list.
 *
 * Why the difference: the bridge default can target any configured provider
 * (env "Claude Code", local BYOK like GLM, or managed), and multi-model
 * providers must remain fully addressable. The visual container is what was
 * asked to match — not the managed-only filtering.
 *
 * Form-context tweaks vs the chat dropdown:
 *   - trigger is a full-width form-style button, not a PromptInputButton
 *   - popover opens downward (top-full) instead of upward
 *   - no localStorage side effects (Settings saves explicitly via its button)
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

  // Trigger label: prefer the selected model's display label (prefixed with its
  // provider when resolvable); fall back to the raw model id, then placeholder.
  const currentGroup = providerGroups.find((g) => g.provider_id === currentProviderId);
  const currentModelLabel = currentGroup?.models.find((m) => m.value === currentModel)?.label;
  const triggerLabel = currentModelLabel
    ? currentGroup
      ? `${currentGroup.provider_name} / ${currentModelLabel}`
      : currentModelLabel
    : currentModel || undefined;

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
            {providerGroups.map((group, idx) => (
              <CommandListGroup
                key={group.provider_id}
                label={group.provider_name}
                separator={idx > 0}
              >
                {group.models.map((m) => {
                  const isActive =
                    group.provider_id === currentProviderId && m.value === currentModel;
                  return (
                    <CommandListItem
                      key={`${group.provider_id}::${m.value}`}
                      active={isActive}
                      onClick={() => handleSelect(group.provider_id, m.value)}
                      className="justify-between"
                    >
                      <span className="truncate font-mono text-xs">{m.label}</span>
                      {isActive && <span className="shrink-0 text-xs">&#10003;</span>}
                    </CommandListItem>
                  );
                })}
              </CommandListGroup>
            ))}
            {providerGroups.length === 0 && (
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

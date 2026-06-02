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

// Managed provider row from /api/providers — only the fields we need.
interface ManagedProviderRow {
  id: string;
  name: string;
  source?: string;
  sort_order?: number;
}

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
 * Like the chat dropdown, this lists MANAGED providers only (source==='managed',
 * fetched from /api/providers). The built-in env "Claude Code" group and local
 * BYOK providers are intentionally excluded so the bridge default surfaces only
 * what the account backend pushed. providerGroups is still used to resolve each
 * managed provider's primary model value.
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
  // Managed providers (source==='managed') — same source as the chat dropdown,
  // so the bridge default only offers account-pushed providers (no built-in
  // env "Claude Code", no local BYOK).
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
    const handler = () => load();
    window.addEventListener('provider-changed', handler);
    return () => { cancelled = true; window.removeEventListener('provider-changed', handler); };
  }, []);

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

  // One row per MANAGED provider; selecting a row uses that provider's first
  // model (resolved from providerGroups). Non-managed groups (env "Claude Code",
  // local BYOK) never appear because managedProviders is the base list.
  const flatItems = managedProviders.map((mp) => {
    const group = providerGroups.find((g) => g.provider_id === mp.id);
    return {
      providerId: mp.id,
      providerName: mp.name,
      modelValue: group?.models[0]?.value ?? '',
    };
  });

  // Trigger shows the current provider's name; falls back to the raw model id
  // (e.g. a stale "default") or a placeholder when nothing resolves.
  const currentProviderName = managedProviders.find((p) => p.id === currentProviderId)?.name
    ?? providerGroups.find((g) => g.provider_id === currentProviderId)?.provider_name;
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

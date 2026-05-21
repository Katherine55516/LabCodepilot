'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface ManagedProviderRow {
  id: string;
  name: string;
  base_url: string;
  managed_config_id?: string;
  sort_order: number;
}

/**
 * Read-only listing of providers pushed by the managed-account backend.
 *
 * Re-fetches whenever the prop `refreshKey` changes — the parent
 * (AccountSection) bumps it after `refreshConfigs()` returns.
 */
export function ManagedConfigsList({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ManagedProviderRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Use the existing /api/providers endpoint and filter client-side by
    // source='managed' — avoids inventing yet another DB-touching route.
    fetch('/api/providers')
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((data) => {
        if (cancelled) return;
        const all: Array<ManagedProviderRow & { source?: string }> = data?.providers ?? [];
        setProviders(all.filter((p) => p.source === 'managed'));
      })
      .catch(() => { if (!cancelled) setProviders([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }
  if (!providers || providers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('auth.noManagedConfigs')}</p>;
  }

  return (
    <ul className="space-y-2">
      {providers.map((p) => (
        <li
          key={p.id}
          className={cn(
            'rounded-md border border-border bg-card px-3 py-2',
            'flex items-center justify-between gap-3',
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{p.name}</div>
            <div className="truncate text-xs text-muted-foreground">{p.base_url}</div>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {t('auth.managedTag')}
          </span>
        </li>
      ))}
    </ul>
  );
}

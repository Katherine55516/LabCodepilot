'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowsClockwise, UserCircle } from '@/components/ui/icon';
import { useAccount } from '@/hooks/useAccount';
import { useTranslation } from '@/hooks/useTranslation';
import { ManagedConfigsList } from './ManagedConfigsList';

/**
 * Settings page card surfacing managed-account login state — distinct from
 * the OpenAI OAuth card (which lives elsewhere in ProviderManager).
 */
export function AccountSection() {
  const { t } = useTranslation();
  const { authenticated, offline, me, managedConfigCount, triggerLogin, logout, refreshConfigs, loading } = useAccount();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (typeof window !== 'undefined' && !window.electronAPI?.auth) {
    return null;
  }

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshFeedback(null);
    try {
      const r = await refreshConfigs();
      if (r.ok) {
        setRefreshFeedback(t('auth.refreshSuccess').replace('{count}', String(r.count ?? 0)));
        setRefreshKey((k) => k + 1);
      } else {
        setRefreshFeedback(r.error || t('auth.refreshFailed'));
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('auth.account')}</h2>
        {offline && (
          <span className="rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] text-status-warning">
            {t('auth.offline')}
          </span>
        )}
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : !authenticated ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('auth.accountCardSubtitle')}</p>
          <Button onClick={() => void triggerLogin()} size="sm" className="w-fit">
            <UserCircle size={16} />
            <span>{t('auth.login')}</span>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {me?.display_name || me?.username || '—'}
            </div>
            {me?.email && (
              <div className="text-xs text-muted-foreground">{me.email}</div>
            )}
            {me?.plan && (
              <div className="text-xs text-muted-foreground">
                {t('auth.accountCardPlan').replace('{plan}', me.plan)}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">
                {t('auth.managedConfigs')} · {managedConfigCount}
              </h3>
              <Button size="sm" variant="outline" onClick={() => void handleRefresh()} disabled={refreshing}>
                <ArrowsClockwise size={14} />
                <span>{refreshing ? t('auth.refreshingConfigs') : t('auth.refreshConfigs')}</span>
              </Button>
            </div>
            {refreshFeedback && (
              <p className="text-xs text-muted-foreground">{refreshFeedback}</p>
            )}
            <ManagedConfigsList refreshKey={refreshKey} />
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <Button size="sm" variant="ghost" onClick={() => void logout()}>
              {t('auth.logout')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

'use client';

import { useState } from 'react';
import { UserCircle, SignOut, ArrowsClockwise } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogoutConfirmDialog } from './LogoutConfirmDialog';
import { useAccount } from '@/hooks/useAccount';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { usedPercent, levelOf, type UsageInfo } from '@/lib/usage';

/**
 * Wide account chip with avatar + username, designed for the bottom row of
 * ChatListPanel where horizontal space is available. Clicking opens a
 * dropdown with profile info / refresh-configs / logout actions.
 *
 * - Signed in    → [avatar] [username]  (clickable chip; offline shows a dot)
 * - Signed out   → "Sign in" chip (rare under strict-login, kept for safety)
 *
 * Strictly tied to the managed-account login system — does NOT surface
 * OpenAI OAuth state.
 */
export function UserMenu() {
  const { t } = useTranslation();
  const { authenticated, offline, me, managedConfigCount, triggerLogin, logout, refreshConfigs, getUsage } = useAccount();
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<{ status?: number; kind?: string } | null>(null);

  // Renderer running outside Electron (e.g. plain browser dev): no auth API.
  if (typeof window !== 'undefined' && !window.electronAPI?.auth) {
    return null;
  }

  const displayName = me?.display_name?.trim() || me?.username?.trim() || '';
  const initials = displayName.slice(0, 1).toUpperCase() || '?';

  const handleLogin = async () => {
    await triggerLogin();
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshConfigs();
    } finally {
      setRefreshing(false);
    }
  };

  // Fetch usage only when the menu opens (no polling). Keep the last value so
  // re-opening doesn't flash empty while the request is in flight.
  const loadUsage = async () => {
    if (usageLoading) return;
    setUsageLoading(true);
    try {
      const res = await getUsage();
      if (res.ok) {
        setUsage(res.usage);
        setUsageError(null);
      } else {
        setUsageError({ status: res.status, kind: res.kind });
      }
    } catch {
      setUsageError({ kind: 'unknown' });
    } finally {
      setUsageLoading(false);
    }
  };

  // Confirmation is handled inside LogoutConfirmDialog now — it calls
  // onConfirm after closing itself.


  // ── Not signed in ────────────────────────────────────────────────────────
  // Strict-login means startup blocks the main window until login, so this
  // branch is mostly defensive. Show a single-button chip that mirrors the
  // signed-in chip so the bottom row layout doesn't shift.
  if (!authenticated) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="flex-1 min-w-0 justify-start gap-2 h-9 px-1.5"
        onClick={handleLogin}
        aria-label={t('auth.login')}
      >
        <UserCircle size={20} weight="regular" />
        <span className="text-xs">{t('auth.login')}</span>
      </Button>
    );
  }

  // ── Signed in ────────────────────────────────────────────────────────────
  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (open) void loadUsage(); }}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 min-w-0 justify-start gap-2 h-9 px-1.5 hover:bg-accent/50"
            aria-label={t('auth.account')}
          >
            <span
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-full shrink-0',
                'bg-foreground/10 text-foreground text-[11px] font-semibold uppercase',
              )}
            >
              {initials}
            </span>
            <span className="truncate text-xs font-medium">{displayName || t('auth.account')}</span>
            {offline && (
              <span
                className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-status-warning shrink-0"
                aria-label={t('auth.offline')}
              />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
            <span className="text-sm font-medium">
              {displayName || t('auth.account')}
            </span>
            {me?.email && (
              <span className="text-xs text-muted-foreground">{me.email}</span>
            )}
            {/* Plan label hidden — me.plan is still fetched and surfaced
                via IPC, but not shown in the dropdown. Restore by
                uncommenting the block below. */}
            {/* {me?.plan && (
              <span className="text-xs text-muted-foreground">
                {t('auth.accountCardPlan').replace('{plan}', me.plan)}
              </span>
            )} */}
            {offline && (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] text-status-warning">
                {t('auth.offline')}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            {t('auth.managedConfigCount').replace('{count}', String(managedConfigCount))}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); void handleRefresh(); }}>
            <ArrowsClockwise size={14} />
            <span>{refreshing ? t('auth.refreshingConfigs') : t('auth.refreshConfigs')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Quota usage — refreshed only when the menu opens (see onOpenChange). */}
          <div className="px-2 py-1.5">
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              {t('auth.usageTitle')}
            </div>
            {usage ? (
              <div className="space-y-1.5">
                {([
                  ['auth.usageTotal', usage.quota],
                  ['auth.usageCn', usage.quota_cn],
                  ['auth.usageIntl', usage.quota_intl],
                ] as const).map(([labelKey, q]) => {
                  const pct = usedPercent(q);
                  const level = levelOf(pct);
                  return (
                    <div key={labelKey}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{t(labelKey)}</span>
                        <span className="tabular-nums text-foreground">
                          {t('auth.usageUsedPercent').replace('{percent}', String(pct))}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            level === 'danger'
                              ? 'bg-destructive'
                              : level === 'warning'
                                ? 'bg-status-warning'
                                : 'bg-primary',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">
                {usageError
                  ? usageError.status === 409
                    ? t('auth.usageNotProvisioned')
                    : usageError.status === 503
                      ? t('auth.usageServiceDown')
                      : t('auth.usageError')
                  : t('auth.usageLoading')}
              </div>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); setLogoutDialogOpen(true); }}
            className="text-destructive focus:text-destructive"
          >
            <SignOut size={14} />
            <span>{t('auth.logout')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LogoutConfirmDialog
        open={logoutDialogOpen}
        onOpenChange={setLogoutDialogOpen}
        onConfirm={logout}
      />
    </>
  );
}

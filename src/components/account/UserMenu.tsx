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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAccount } from '@/hooks/useAccount';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

/**
 * Compact user-account control for the NavRail bottom slot.
 *
 * - Logged out → icon button that triggers the login flow on click
 * - Logged in  → avatar + dropdown with profile / refresh / logout
 * - Offline    → small red dot on the avatar
 *
 * Strictly tied to the managed-account login system — does NOT surface
 * OpenAI OAuth state.
 */
export function UserMenu() {
  const { t } = useTranslation();
  const { authenticated, offline, me, managedConfigCount, triggerLogin, logout, refreshConfigs } = useAccount();
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Renderer running outside Electron (e.g. plain browser dev): no auth API.
  if (typeof window !== 'undefined' && !window.electronAPI?.auth) {
    return null;
  }

  const initials = me?.display_name?.trim().slice(0, 1).toUpperCase()
    || me?.username?.trim().slice(0, 1).toUpperCase()
    || '?';

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

  const handleConfirmLogout = async () => {
    setLogoutDialogOpen(false);
    await logout();
  };

  // ── Not signed in ────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={handleLogin}
            aria-label={t('auth.login')}
          >
            <UserCircle size={16} weight="regular" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('auth.login')}</TooltipContent>
      </Tooltip>
    );
  }

  // ── Signed in ────────────────────────────────────────────────────────────
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9"
                aria-label={t('auth.account')}
              >
                <span
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full',
                    'bg-sidebar-accent text-sidebar-accent-foreground text-[11px] font-semibold uppercase',
                  )}
                >
                  {initials}
                </span>
                {offline && (
                  <span
                    className="absolute right-1 top-1 inline-block h-2 w-2 rounded-full bg-status-warning"
                    aria-label={t('auth.offline')}
                  />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">
            {me ? t('auth.signedInAs').replace('{name}', me.display_name || me.username) : t('auth.account')}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent side="right" align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
            <span className="text-sm font-medium">
              {me?.display_name || me?.username || t('auth.account')}
            </span>
            {me?.email && (
              <span className="text-xs text-muted-foreground">{me.email}</span>
            )}
            {me?.plan && (
              <span className="text-xs text-muted-foreground">
                {t('auth.accountCardPlan').replace('{plan}', me.plan)}
              </span>
            )}
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
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); setLogoutDialogOpen(true); }}
            className="text-destructive focus:text-destructive"
          >
            <SignOut size={14} />
            <span>{t('auth.logout')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('auth.confirmLogout')}</AlertDialogTitle>
            <AlertDialogDescription>{t('auth.confirmLogoutBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLogout}>
              {t('auth.logout')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * React hook that surfaces the managed-account login state to renderer UI.
 *
 * State is owned by the main process — we never request /api/v1/me directly
 * from the renderer, and we never see the bearer token. The main process
 * pushes 'auth:changed' over IPC whenever anything moves; this hook just
 * subscribes and re-renders.
 *
 * Outside Electron (e.g. running the Next.js dev server in the browser),
 * `window.electronAPI` is undefined; in that case the hook stays in its
 * default "not authenticated" state and all action functions are no-ops.
 */

type AuthSnapshot = NonNullable<NonNullable<Window['electronAPI']>['auth']> extends infer A
  ? A extends { getState: () => Promise<infer S> }
    ? S
    : never
  : never;

const DEFAULT_STATE: AuthSnapshot = {
  authenticated: false,
  offline: false,
  me: null,
  managedConfigCount: 0,
};

export interface UseAccountResult {
  authenticated: boolean;
  offline: boolean;
  me: AuthSnapshot['me'];
  managedConfigCount: number;
  /** True while the hook is doing the very first getState() round-trip */
  loading: boolean;
  /** Open the login window (no skip option — explicit user choice). */
  triggerLogin: () => Promise<{ ok: boolean; outcome?: 'success' | 'skipped' | 'cancelled'; error?: string }>;
  /** Log out + purge managed providers + reset state. */
  logout: () => Promise<{ ok: true }>;
  /** Force a /api/v1/configs refresh + re-sync to api_providers. */
  refreshConfigs: () => Promise<{ ok: boolean; count?: number; error?: string }>;
  /** Re-probe /api/v1/auth/status (transitions offline ↔ online if token is fine). */
  probe: () => Promise<{ alive: boolean; offline: boolean }>;
}

export function useAccount(): UseAccountResult {
  const [state, setState] = useState<AuthSnapshot>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = window.electronAPI?.auth;
    if (!api) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api.getState()
      .then((s) => { if (!cancelled) setState(s); })
      .catch(() => { /* ignore — keep DEFAULT_STATE */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    const unsubscribe = api.onChange((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const triggerLogin = useCallback<UseAccountResult['triggerLogin']>(async () => {
    const api = window.electronAPI?.auth;
    if (!api) return { ok: false, error: 'desktop API unavailable' };
    return api.triggerLogin();
  }, []);

  const logout = useCallback<UseAccountResult['logout']>(async () => {
    const api = window.electronAPI?.auth;
    if (!api) return { ok: true as const };
    return api.logout();
  }, []);

  const refreshConfigs = useCallback<UseAccountResult['refreshConfigs']>(async () => {
    const api = window.electronAPI?.auth;
    if (!api) return { ok: false, error: 'desktop API unavailable' };
    return api.refreshConfigs();
  }, []);

  const probe = useCallback<UseAccountResult['probe']>(async () => {
    const api = window.electronAPI?.auth;
    if (!api) return { alive: false, offline: false };
    return api.probe();
  }, []);

  return {
    authenticated: state.authenticated,
    offline: state.offline,
    me: state.me,
    managedConfigCount: state.managedConfigCount,
    loading,
    triggerLogin,
    logout,
    refreshConfigs,
    probe,
  };
}

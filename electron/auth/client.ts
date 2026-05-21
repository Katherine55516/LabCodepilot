/**
 * High-level managed-account login client — orchestrates the OAuth dance and
 * the post-login data fetch (me / devices / configs).
 *
 * All functions are safe to call from the main process. Each one logs through
 * electron/auth/log.ts so tokens never reach stdout in full.
 */

import * as crypto from 'crypto';
import * as os from 'os';
import { app, shell } from 'electron';

import { getBackendBase } from './config';
import { apiRequest, probeAuthStatus } from './http';
import { startCallbackServer } from './callback-server';
import {
  saveToken,
  loadToken,
  clearAuthState,
  getOrCreateDeviceId,
  saveConfigs,
  loadConfigs,
  loadConfigsHash,
  saveSelectedConfigId,
  loadSelectedConfigId,
} from './storage';
import {
  AuthExpiredError,
  NetworkError,
  type AuthProbeResult,
  type MeInfo,
  type ModelConfig,
} from './types';
import { logInfo, logWarn, maskToken, maskConfigsForLog } from './log';

// The maximum time we'll wait for the user to complete the OAuth dance in the
// browser. 10 minutes leaves time for legit cases (e.g. user goes to look up
// their password) without holding a server socket open forever.
const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

// ── 1. Try cached token on startup ──────────────────────────────────────────

export async function tryUseCachedToken(): Promise<AuthProbeResult> {
  const cached = loadToken();
  if (!cached) return { alive: false, offline: false };
  logInfo('cached token present (', maskToken(cached), ') — probing /api/v1/auth/status');
  const probe = await probeAuthStatus();
  logInfo('probe result:', probe);
  return probe;
}

// ── 2. Login via browser ────────────────────────────────────────────────────

/**
 * Open the system browser to the backend's OAuth gateway, wait for the
 * callback, then persist the token. Returns the bearer on success.
 *
 * Throws on user cancellation, state mismatch (CSRF), timeout, or network
 * failure. The login window UI is owned by login-window.ts — this function
 * is purely the "OAuth side car".
 */
export async function loginViaBrowser(): Promise<string> {
  const state = crypto.randomBytes(32).toString('hex');
  const cb = await startCallbackServer(state);
  try {
    const callbackUrl = `http://127.0.0.1:${cb.port}/cb`;
    const loginUrl =
      `${getBackendBase()}/auth/cli/start` +
      `?callback=${encodeURIComponent(callbackUrl)}` +
      `&state=${encodeURIComponent(state)}`;
    logInfo('opening browser to', getBackendBase() + '/auth/cli/start');
    await shell.openExternal(loginUrl);
    const result = await cb.waitForCallback(CALLBACK_TIMEOUT_MS);
    saveToken(result.session_token);
    logInfo('login succeeded; token saved (', maskToken(result.session_token), ')');
    return result.session_token;
  } finally {
    cb.close();
  }
}

// ── 3. /api/v1/me ──────────────────────────────────────────────────────────

export async function fetchMe(): Promise<MeInfo> {
  const r = await apiRequest<MeInfo>('/api/v1/me');
  if (!r.json) throw new Error('/api/v1/me returned empty body');
  return r.json;
}

// ── 4. /api/v1/me/devices ──────────────────────────────────────────────────

export async function registerDevice(): Promise<void> {
  const payload = {
    device_id: getOrCreateDeviceId(),
    device_name: `${os.hostname()} (CodePilot)`,
    os: process.platform,
    os_version: os.release(),
    app_version: app.getVersion(),
  };
  const r = await apiRequest('/api/v1/me/devices', { method: 'POST', body: payload });
  if (r.status !== 200 && r.status !== 204) {
    throw new Error(`registerDevice failed: status=${r.status}`);
  }
}

// ── 5. /api/v1/configs (+ /api/v1/configs/hash for polling) ────────────────

function sortConfigs(arr: ModelConfig[]): ModelConfig[] {
  return [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Fetch the model config list.
 *
 *   opts.force=false  (default for polling): probe /configs/hash first; if
 *     the server-side hash equals our cache, return the cache and avoid the
 *     full transfer. On network failure we degrade to cache silently.
 *
 *   opts.force=true   (startup / explicit refresh): skip the hash probe and
 *     hit /configs directly with an If-None-Match header so the server can
 *     still 304 on us.
 *
 * On network failure with a cache present, we degrade rather than throw —
 * the caller (boot sequence) treats this as offline mode.
 */
export async function getConfigs(opts: { force?: boolean } = {}): Promise<ModelConfig[]> {
  try {
    const localHash = loadConfigsHash();

    // Polling fast path: hash probe → cache hit
    if (!opts.force && localHash) {
      try {
        const hashRes = await apiRequest<{ hash: string }>('/api/v1/configs/hash');
        if (hashRes.json?.hash === localHash) {
          const cached = loadConfigs();
          if (cached) {
            logInfo('configs hash unchanged — using cache (', cached.length, 'items)');
            return sortConfigs(cached);
          }
        }
      } catch (e) {
        if (e instanceof NetworkError) {
          const cached = loadConfigs();
          if (cached) {
            logInfo('hash probe offline — using cache');
            return sortConfigs(cached);
          }
        }
        throw e;
      }
    }

    // Full GET (server can still 304 if our hash matches)
    const r = await apiRequest<ModelConfig[]>('/api/v1/configs', {
      extraHeaders: localHash ? { 'If-None-Match': `"${localHash}"` } : undefined,
    });

    if (r.status === 304) {
      const cached = loadConfigs();
      if (cached) return sortConfigs(cached);
      // Cache vanished between the hash probe and the GET — refetch full.
      return getConfigs({ force: true });
    }
    if (!r.json) throw new Error('/api/v1/configs returned empty body');

    const etag = (r.headers.get('ETag') ?? '').replace(/^"|"$/g, '');
    const hash = etag || sha256(JSON.stringify(r.json));
    saveConfigs(r.json, hash);
    logInfo('configs fetched & cached:', maskConfigsForLog(r.json));
    return sortConfigs(r.json);
  } catch (e) {
    if (e instanceof NetworkError) {
      const cached = loadConfigs();
      if (cached) {
        logWarn('configs fetch failed (network) — falling back to local cache');
        return sortConfigs(cached);
      }
    }
    throw e;
  }
}

/**
 * Pick the active managed config: honour the user's last selection if it's
 * still in the list, otherwise default to sort_order=0. Persists the choice
 * so the same config sticks across restarts.
 */
export function pickSelectedConfig(configs: ModelConfig[]): ModelConfig | null {
  if (configs.length === 0) return null;
  const sorted = sortConfigs(configs);
  const savedId = loadSelectedConfigId();
  if (savedId) {
    const found = sorted.find((c) => c.id === savedId);
    if (found) return found;
  }
  saveSelectedConfigId(sorted[0].id);
  return sorted[0];
}

// ── 6. Logout ──────────────────────────────────────────────────────────────

/**
 * Best-effort server-side logout, then clear local auth state.
 *
 * If the network is down we still clear local state — otherwise users would
 * be stuck logged in offline forever.
 */
export async function anlLogout(): Promise<void> {
  try {
    await apiRequest('/auth/cli/logout', { method: 'POST' });
    logInfo('server logout succeeded');
  } catch (e) {
    if (e instanceof AuthExpiredError) {
      logInfo('server logout: token already invalid (continuing)');
    } else {
      logWarn('server logout failed (continuing with local cleanup):', (e as Error).message);
    }
  }
  clearAuthState();
}

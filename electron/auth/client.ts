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
import { apiRequest, probeAuthStatus, type ApiResponse } from './http';
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
  saveImageConfig,
  loadImageConfig,
} from './storage';
import {
  AuthExpiredError,
  HttpError,
  NetworkError,
  type AuthProbeResult,
  type ImageProviderConfig,
  type MeInfo,
  type ModelConfig,
  type UsageInfo,
} from './types';
import { logInfo, logWarn, maskToken, maskConfigsForLog } from './log';
import { decryptAuthToken, decryptConfigAuthTokens } from './config-crypto';

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
    device_name: `${os.hostname()} (AI Native Lab - 研发平台)`,
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

    // Full GET — prefer the encrypted endpoint; on 503 (server-side encryption
    // key not configured) fall back to the plaintext endpoint. The server can
    // still 304 if our hash matches: the hash/ETag is over the *plaintext*
    // payload and shared by both endpoints.
    const extraHeaders = localHash ? { 'If-None-Match': `"${localHash}"` } : undefined;
    let r: ApiResponse<ModelConfig[]>;
    let encrypted = true;
    try {
      r = await apiRequest<ModelConfig[]>('/api/v1/configs/encrypted', { extraHeaders });
    } catch (e) {
      if (e instanceof HttpError && e.status === 503) {
        logWarn('encrypted configs unavailable (503) — falling back to plaintext /api/v1/configs');
        encrypted = false;
        r = await apiRequest<ModelConfig[]>('/api/v1/configs', { extraHeaders });
      } else {
        throw e;
      }
    }

    if (r.status === 304) {
      const cached = loadConfigs();
      if (cached) return sortConfigs(cached);
      // Cache vanished between the hash probe and the GET — refetch full.
      return getConfigs({ force: true });
    }
    if (!r.json) throw new Error('/api/v1/configs returned empty body');

    // Encrypted endpoint returns auth_token as AES-256-GCM ciphertext — decrypt
    // each to plaintext so every downstream consumer (local cache, broker →
    // SQLite, provider-resolver) sees the real key, exactly as before.
    const configs = encrypted ? decryptConfigAuthTokens(r.json) : r.json;

    // Hash/ETag is over the plaintext payload. Prefer the server ETag (matches
    // /api/v1/configs/hash for the polling fast-path); fall back to a local hash
    // over the *decrypted* configs so it's stable across the random nonce.
    const etag = (r.headers.get('ETag') ?? '').replace(/^"|"$/g, '');
    const hash = etag || sha256(JSON.stringify(configs));
    saveConfigs(configs, hash);
    logInfo('configs fetched & cached:', maskConfigsForLog(configs));
    return sortConfigs(configs);
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

// ── 7. /api/v1/usage ─────────────────────────────────────────────────────────

/**
 * 查询当前登录用户的额度用量。错误(401/409/503/网络)直接上抛,由 main 的
 * IPC handler 归类后回传 renderer。token 由 apiRequest 自动注入,不出主进程。
 */
export async function fetchUsage(): Promise<UsageInfo> {
  const r = await apiRequest<UsageInfo>('/api/v1/usage');
  if (!r.json) throw new Error('/api/v1/usage returned empty body');
  return r.json;
}

// ── 8. /api/v1/asr/token ─────────────────────────────────────────────────────

export interface AsrTokenResp {
  token: string;
  /** unix 秒；客户端据此缓存到近过期才再换 */
  expiresAt: number;
  /** 百炼模型名，服务端下发（客户端不硬编码） */
  model: string;
  /** 百炼 realtime WS 基址（不含 query），服务端下发 */
  wsUrl: string;
}

/** 向自建服务器换百炼实时 ASR 的临时 token + 下发配置（模型名/WS 地址）。token 不出主进程。 */
export async function fetchAsrToken(): Promise<AsrTokenResp> {
  const r = await apiRequest<AsrTokenResp>('/api/v1/asr/token', { method: 'POST' });
  if (!r.json) throw new Error('/api/v1/asr/token returned empty body');
  if (!r.json.token || !r.json.model || !r.json.wsUrl) {
    throw new Error('/api/v1/asr/token 响应缺少 token/model/wsUrl —— 模型名与 WS 地址需由服务端下发');
  }
  return r.json;
}

// ── 9. /api/v1/image/config（文生图凭证下发）─────────────────────────────────

/** 归一化下发的图片配置：encrypted 变体解密 apiKey；缺字段回填，避免部分缺失致不可用。 */
function normalizeImageConfig(raw: ImageProviderConfig, encrypted: boolean): ImageProviderConfig {
  let apiKey = raw.apiKey || '';
  if (encrypted && apiKey) {
    try {
      apiKey = decryptAuthToken(apiKey);
    } catch (e) {
      // fail-safe：解密失败置空（视为无凭证），不 crash —— 同 configs 的 auth_token 容错。
      logWarn('[image config] decrypt apiKey failed — treating as no-key:', (e as Error).message);
      apiKey = '';
    }
  }
  return {
    apiKey,
    workspaceId: raw.workspaceId || '',
    model: raw.model || '',
    region: raw.region || '',
    models: Array.isArray(raw.models) ? raw.models : [],
  };
}

/**
 * 拉取全局百炼文生图配置（本期所有用户同一份）。镜像 getConfigs：
 *   - 优先 `/api/v1/image/config/encrypted`（apiKey 为 AES-256-GCM 密文）；
 *   - 503 回退明文 `/api/v1/image/config`；
 *   - 解密 apiKey → 加密缓存落盘 → 网络失败时降级用缓存。
 * apiKey 仅在主进程内解出，随后经 broker 推送到嵌入式 Next 服务密封落盘，绝不下行 renderer。
 */
export async function fetchImageConfig(): Promise<ImageProviderConfig> {
  try {
    let r: ApiResponse<ImageProviderConfig>;
    let encrypted = true;
    try {
      r = await apiRequest<ImageProviderConfig>('/api/v1/image/config/encrypted');
    } catch (e) {
      if (e instanceof HttpError && e.status === 503) {
        logWarn('encrypted image config unavailable (503) — falling back to plaintext /api/v1/image/config');
        encrypted = false;
        r = await apiRequest<ImageProviderConfig>('/api/v1/image/config');
      } else {
        throw e;
      }
    }
    if (!r.json) throw new Error('/api/v1/image/config returned empty body');
    const cfg = normalizeImageConfig(r.json, encrypted);
    saveImageConfig(cfg);
    logInfo(
      'image config fetched & cached: model=', cfg.model,
      'models=', cfg.models.length, 'hasKey=', !!cfg.apiKey,
    );
    return cfg;
  } catch (e) {
    if (e instanceof NetworkError) {
      const cached = loadImageConfig();
      if (cached) {
        logWarn('image config fetch failed (network) — falling back to local cache');
        return cached;
      }
    }
    throw e;
  }
}

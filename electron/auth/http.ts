/**
 * HTTP client for the managed-account backend.
 *
 * Wraps fetch() with:
 *   - Bearer header injection (auto-reads from storage.loadToken)
 *   - AbortController-based timeout
 *   - Discriminated error types (NetworkError vs AuthExpiredError vs generic)
 *
 * Does NOT log token values — debug callers must use log.maskToken() on
 * anything that might contain a bearer.
 */

import { getBackendBase } from './config';
import { loadToken } from './storage';
import { AuthExpiredError, NetworkError } from './types';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  extraHeaders?: Record<string, string>;
  /** Default true — set false for endpoints that must NOT carry the bearer */
  authRequired?: boolean;
  /** Default 15s */
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  status: number;
  json?: T;
  headers: Headers;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const url = new URL(getBackendBase() + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(opts.extraHeaders ?? {}),
  };
  if (opts.authRequired !== false) {
    const token = loadToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    throw new NetworkError((e as Error).message || 'fetch failed');
  }
  clearTimeout(timeout);

  if (res.status === 401) throw new AuthExpiredError();
  if (res.status === 304) {
    return { status: 304, headers: res.headers };
  }
  if (res.status >= 400) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  let json: T | undefined;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      json = (await res.json()) as T;
    } catch {
      // 204 / empty body OK
    }
  }
  return { status: res.status, json, headers: res.headers };
}

/**
 * Liveness check against /api/v1/auth/status.
 *
 * Three-way result:
 *   - 200          → { alive: true,  offline: false }
 *   - 401          → { alive: false, offline: false } (token rejected)
 *   - network err  → { alive: true,  offline: true  } (keep token, degrade)
 *   - other err    → { alive: false, offline: false } (treat as bad)
 */
export async function probeAuthStatus(): Promise<{ alive: boolean; offline: boolean }> {
  try {
    await apiRequest('/api/v1/auth/status');
    return { alive: true, offline: false };
  } catch (e) {
    if (e instanceof AuthExpiredError) return { alive: false, offline: false };
    if (e instanceof NetworkError) return { alive: true, offline: true };
    return { alive: false, offline: false };
  }
}

/**
 * Token-safe logging helpers for the managed-account login system.
 *
 * Rule: never let a bearer or per-config api key reach stdout/stderr in
 * full. Pass values through maskToken() or maskConfigsForLog() before
 * logging.
 */

import type { ModelConfig } from './types';

/** Show first 8 chars + ellipsis. Empty input → "(empty)". */
export function maskToken(t: string | undefined | null): string {
  if (!t) return '(empty)';
  return t.length <= 8 ? `${t.slice(0, 2)}...` : `${t.slice(0, 8)}...`;
}

/** Strip secret-ish fields from a configs array for safe logging. */
export function maskConfigsForLog(configs: ModelConfig[]): unknown[] {
  return configs.map((c) => ({
    id: c.id,
    name: c.name,
    sort_order: c.sort_order,
    model: c.model,
    base_url: c.base_url,
    auth_token_prefix: maskToken(c.auth_token),
  }));
}

/** Prefix all auth log lines so they're easy to filter in stdout. */
const PREFIX = '[auth]';

export function logInfo(msg: string, ...rest: unknown[]): void {
  console.log(PREFIX, msg, ...rest);
}

export function logWarn(msg: string, ...rest: unknown[]): void {
  console.warn(PREFIX, msg, ...rest);
}

export function logError(msg: string, ...rest: unknown[]): void {
  console.error(PREFIX, msg, ...rest);
}

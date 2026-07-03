/**
 * Persistent cache of SDK session init metadata (slash_commands / skills).
 *
 * Why this exists: CLI-built-in commands like /simplify are embedded inside
 * the bundled `claude` binary — they have no file on disk, so the /api/skills
 * filesystem scan can never discover them. Their only source is the SDK init
 * message, which arrives after a session's FIRST message round-trips. Without
 * a cache, a fresh conversation's slash popover is missing every CLI built-in
 * until one message has been sent.
 *
 * Contract for consumers: cached metadata is ADDITIVE ONLY — use it to add
 * commands missing from the filesystem scan, never as a filter. It may be
 * stale (CLI update, plugin unloaded since last session) and must not hide
 * commands that verifiably exist on disk. Live init metadata remains the
 * truth source and overwrites the cache on every session init.
 */

export interface SdkInitMeta {
  tools?: unknown;
  slash_commands?: unknown;
  skills?: unknown;
}

const STORAGE_KEY = 'codepilot:sdk-init-meta:v1';

export function saveCachedSdkInitMeta(meta: SdkInitMeta | null | undefined): void {
  if (typeof window === 'undefined' || !meta) return;
  const slash_commands = Array.isArray(meta.slash_commands) ? meta.slash_commands : [];
  const skills = Array.isArray(meta.skills) ? meta.skills : [];
  // A degraded init (no commands reported) must not clobber a useful cache.
  if (slash_commands.length === 0 && skills.length === 0) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ slash_commands, skills }));
  } catch {
    // localStorage unavailable/full — the cache is best-effort.
  }
}

export function loadCachedSdkInitMeta(): SdkInitMeta | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SdkInitMeta;
    if (!Array.isArray(parsed.slash_commands) && !Array.isArray(parsed.skills)) return null;
    return parsed;
  } catch {
    return null;
  }
}

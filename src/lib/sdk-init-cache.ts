/**
 * Persistent cache of SDK session init metadata (slash_commands / skills).
 *
 * Why this exists: CLI-built-in commands like /simplify are embedded inside
 * the bundled `claude` binary — they have no file on disk, so the /api/skills
 * filesystem scan can never discover them. They are knowable two ways:
 *  1. a live session's init message (arrives after a conversation's FIRST
 *     message round-trips) — written here by useSSEStream;
 *  2. the /api/sdk-commands control-channel enumeration (no model call) —
 *     fetched at app startup by warmSdkCommandCache() below, which also
 *     carries real descriptions/argument hints.
 *
 * Contract for consumers: cached metadata is ADDITIVE ONLY — use it to add
 * commands missing from the filesystem scan, never as a filter. It may be
 * stale (CLI update, plugin unloaded since last session) and must not hide
 * commands that verifiably exist on disk. Live init metadata remains the
 * truth source for filtering.
 */

export interface SdkInitMeta {
  tools?: unknown;
  slash_commands?: unknown;
  skills?: unknown;
}

const STORAGE_KEY = 'codepilot:sdk-init-meta:v1';

/**
 * Keep richer object entries (with description, from /api/sdk-commands) when
 * a later save provides only bare names (the init message's string[] shape).
 */
function mergeCommandEntries(fresh: unknown[], prev: unknown[]): unknown[] {
  const prevByName = new Map<string, unknown>();
  for (const p of prev) {
    if (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string') {
      prevByName.set((p as { name: string }).name, p);
    }
  }
  return fresh.map((c) => (typeof c === 'string' && prevByName.has(c) ? prevByName.get(c)! : c));
}

export function saveCachedSdkInitMeta(meta: SdkInitMeta | null | undefined): void {
  if (typeof window === 'undefined' || !meta) return;
  const freshCmds = Array.isArray(meta.slash_commands) ? meta.slash_commands : [];
  const freshSkills = Array.isArray(meta.skills) ? meta.skills : [];
  // A degraded init (nothing reported) must not clobber a useful cache.
  if (freshCmds.length === 0 && freshSkills.length === 0) return;

  const prev = loadCachedSdkInitMeta();
  const prevCmds = Array.isArray(prev?.slash_commands) ? prev.slash_commands : [];
  const prevSkills = Array.isArray(prev?.skills) ? prev.skills : [];

  // Per-field merge: a save that omits one field keeps the previous value
  // (e.g. /api/sdk-commands provides commands only — don't drop skills).
  const slash_commands = freshCmds.length > 0 ? mergeCommandEntries(freshCmds, prevCmds) : prevCmds;
  const skills = freshSkills.length > 0 ? freshSkills : prevSkills;

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

let warmupStarted = false;

/**
 * Refresh the cache at app startup via /api/sdk-commands (control-channel
 * enumeration — no model call, no tokens, ~500ms server-side cold). Makes CLI
 * built-ins appear in the slash popover on the very first launch, before any
 * conversation has ever produced an init message. Fire-and-forget; runs at
 * most once per page load (the server route additionally caches in-process).
 */
export function warmSdkCommandCache(): void {
  if (warmupStarted || typeof window === 'undefined') return;
  warmupStarted = true;
  void fetch('/api/sdk-commands')
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { commands?: unknown } | null) => {
      if (Array.isArray(data?.commands) && data.commands.length > 0) {
        saveCachedSdkInitMeta({ slash_commands: data.commands });
      }
    })
    .catch(() => {
      // Server unreachable / no provider — popover falls back to the
      // filesystem scan and any previously cached init metadata.
    });
}

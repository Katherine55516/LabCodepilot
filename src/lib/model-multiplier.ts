/**
 * model-multiplier.ts — pure helpers for the "model multiplier" (模型倍率)
 * feature.
 *
 * The managed-account backend computes a per-model `model_multiplier` — the
 * model's weighted call cost relative to the baseline model (glm-5.2 = 1.0x),
 * see the server's docs/config-delivery-api.md §3.2.1. It rides along in the
 * ModelConfig payload, which electron/auth/managed-providers.ts preserves
 * verbatim under `managed_extra_json.raw`.
 *
 * These functions are pure and unit-tested so the extraction rule and the
 * display format live in one place, shared by the composer model picker
 * (办公 / 研发) and the scheduled-routine model picker (定时任务).
 *
 * Design note — no fallback value on purpose: a model whose multiplier the
 * server has not pushed yet reads as `null`, and every call site renders
 * nothing for it. Defaulting to 1.0x would invent a cost figure the backend
 * never stated, which is worse than showing nothing: users make spend
 * decisions off this number.
 */

/**
 * Extract `model_multiplier` from a provider row's `managed_extra_json`.
 *
 * Returns null for anything that isn't a usable number — missing column,
 * malformed JSON, absent field (rows synced before the server shipped it),
 * negative / non-finite values. Callers must render nothing on null rather
 * than substituting a default (see the design note above).
 */
export function parseManagedMultiplier(managedExtraJson?: string | null): number | null {
  if (!managedExtraJson) return null;
  let raw: unknown;
  try {
    raw = (JSON.parse(managedExtraJson) as { raw?: unknown })?.raw;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as { model_multiplier?: unknown }).model_multiplier;
  return normalizeMultiplier(value);
}

/**
 * Coerce an unknown value into a usable multiplier, or null. Exported so the
 * API-response consumers (which receive an already-extracted number) share the
 * exact same validity rule as the extraction path above.
 */
export function normalizeMultiplier(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Format a multiplier for display: `1.4x`, `1.0x`, `10.5x`.
 *
 * Fixed to one decimal place to match the server's stated precision — the
 * backend stores an already-rounded one-decimal float, so `1` on the wire is
 * the baseline and must read as `1.0x`, not `1x`. Returns null when the
 * multiplier is unusable, so call sites can `{formatMultiplier(m) && ...}`.
 */
export function formatMultiplier(value: unknown): string | null {
  const n = normalizeMultiplier(value);
  if (n === null) return null;
  return `${n.toFixed(1)}x`;
}

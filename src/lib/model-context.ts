// Opus 4.7 ships a default 1M context window (no beta header required);
// Opus 4.6 (claude-opus-4-20250514) still needs context-1m-2025-08-07 to
// reach 1M. Other 4.x models default to 200K.
//
// The `opus` alias is intentionally left at 200K (Opus 4.6 semantics).
// Callers that know the resolved upstream model must pass it to
// getContextWindow via the `upstream` option so first-party sessions
// (which resolve to claude-opus-4-7) get their 1M window while
// Bedrock/Vertex sessions (where opus still resolves to 4.6) stay at
// 200K. This avoids the previous bug where all `opus` lookups were
// budgeted as 1M, over-estimating Bedrock/Vertex by ~5×.
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'sonnet': 200000,
  'opus': 200000,
  'haiku': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-opus-4-7': 1_000_000,
  'claude-haiku-4-5-20251001': 200000,
};

// Substring fallback keys ordered by length (longest first) so a vendor-
// prefixed or date-suffixed upstream name (e.g.
// 'us.anthropic.claude-opus-4-7-v1:0') hits 'claude-opus-4-7' before
// 'opus'. Without this, insertion order would make the short 'opus' alias
// (200K) win and strip the real 1M window.
const CONTEXT_LOOKUP_KEYS_BY_LENGTH = Object.keys(MODEL_CONTEXT_WINDOWS)
  .slice()
  .sort((a, b) => b.length - a.length);

/**
 * Try to resolve a single key via exact match first, then longest-suffix
 * substring. Returns null when neither strategy finds anything so callers
 * can chain with ?? to a different key.
 */
function resolveWindow(key: string): number | null {
  if (!key) return null;
  if (MODEL_CONTEXT_WINDOWS[key] != null) return MODEL_CONTEXT_WINDOWS[key];
  const match = CONTEXT_LOOKUP_KEYS_BY_LENGTH.find(k => key.includes(k));
  return match ? MODEL_CONTEXT_WINDOWS[match] : null;
}

export function getContextWindow(
  model: string,
  options?: { context1m?: boolean; upstream?: string },
): number | null {
  // Prefer the upstream model ID when known — it unambiguously selects
  // between alias variants (e.g. `opus` on first-party Anthropic is
  // claude-opus-4-7 but on Bedrock/Vertex it's Opus 4.6). Fall through
  // to the model alias when upstream is absent OR when it resolves
  // to nothing (e.g. unknown vendor-prefixed name that doesn't substring-
  // match any known key).
  const base = (options?.upstream ? resolveWindow(options.upstream) : null)
    ?? resolveWindow(model);
  if (base === null) return null;
  // When 1M context beta is enabled, all supported models get 1M window.
  // (Opus 4.7 already defaults to 1M so the toggle is a no-op there.)
  if (options?.context1m) return 1_000_000;
  return base;
}

// ── Managed-provider context windows keyed by DISPLAY NAME ──────────────────
// Managed models are configured & dispatched by the account backend; their
// model ids (e.g. claude-opus-4-8) don't reliably map to the real window via
// the static catalog above (claude-opus-4-8 substring-matches `opus` → 200K,
// but it's actually 1M). So for managed providers we resolve the window from
// the human-facing display name instead. Names are normalized (lowercase +
// strip spaces/hyphens/underscores/dots) so "高阶模型-C48" / "GLM5.2" /
// "Qwen3.7-Max" all match regardless of punctuation.
const MANAGED_CONTEXT_WINDOW_BY_NAME: Record<string, number> = {
  // 1000K
  '高阶模型c48': 1_000_000,
  '高阶模型c47': 1_000_000,
  '高阶模型g55': 1_000_000,
  glm52: 1_000_000,
  qwen37max: 1_000_000,
  qwen37plus: 1_000_000,
  minimaxm3: 1_000_000,
  // 200K（两个 Kimi 经逐模型探针实测后端真实窗口均为 200K，modelUsage.contextWindow=200000，非 256K）
  kimik27code: 200_000,
  kimik26: 200_000,
  glm51: 200_000,
};

function normalizeManagedName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]/g, '');
}

/**
 * Resolve a managed provider's context window from its display name.
 * Returns null when the name isn't in the table, so callers can fall back to
 * the provider-models contextWindow / static catalog.
 */
export function getManagedContextWindowByName(displayName?: string): number | null {
  if (!displayName) return null;
  return MANAGED_CONTEXT_WINDOW_BY_NAME[normalizeManagedName(displayName)] ?? null;
}

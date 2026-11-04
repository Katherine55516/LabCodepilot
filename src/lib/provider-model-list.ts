/**
 * Pure helpers for assembling the chat model-picker list returned by
 * `/api/providers/models`. Extracted from the route handler so the ordering
 * rules are unit-testable without the route's DB dependencies.
 */

/** Minimal shape the ordering logic needs. The route's richer ModelEntry
 *  (with capabilities/variants) is structurally compatible. */
export interface RoleModelListEntry {
  value: string;
  label: string;
  upstreamModelId?: string;
}

/** Role keys checked, in priority order. `default` (= ANTHROPIC_MODEL, the
 *  provider's primary model) is intentionally first so it lands at index 0. */
const ROLE_ORDER = ['default', 'reasoning', 'small', 'haiku', 'sonnet', 'opus'] as const;

/**
 * Prepend the models declared in `role_models_json` to an existing model
 * list, keeping `default` at index 0.
 *
 * Why this exists: the flat model picker (ModelSelectorDropdown) sends
 * `group.models[0].value` as the request model when a managed provider is
 * selected. So whichever model sits at index 0 IS the model the user gets.
 * For a managed provider whose role_models has both `default` (gpt-5.5) and
 * `sonnet` (gpt-5.4), index 0 MUST be `default` — otherwise selecting the
 * provider silently sends ANTHROPIC_DEFAULT_SONNET_MODEL instead of
 * ANTHROPIC_MODEL.
 *
 * The earlier implementation used `rawModels.unshift()` per entry inside a
 * forward loop, which reversed the role order and pushed the LAST role
 * (sonnet) to the front. This helper collects the new entries in role order
 * and prepends them as a single block, preserving `default`-first.
 *
 * Entries already present in `rawModels` (matched by value OR upstreamModelId)
 * are skipped, as are intra-block duplicates (e.g. opus === default).
 *
 * Malformed JSON returns `rawModels` unchanged.
 */
export function prependRoleModels<T extends RoleModelListEntry>(
  rawModels: T[],
  roleModelsJson: string | null | undefined,
): T[] {
  let rm: Record<string, string>;
  try {
    rm = JSON.parse(roleModelsJson || '{}') as Record<string, string>;
  } catch {
    return rawModels;
  }

  // Collect unique model IDs across role fields, in ROLE_ORDER.
  const roleEntries: { id: string; role: string }[] = [];
  for (const role of ROLE_ORDER) {
    if (rm[role] && !roleEntries.some(e => e.id === rm[role])) {
      roleEntries.push({ id: rm[role], role });
    }
  }

  const toPrepend: T[] = [];
  for (const entry of roleEntries) {
    const already =
      rawModels.some(m => m.value === entry.id || m.upstreamModelId === entry.id) ||
      toPrepend.some(m => m.value === entry.id);
    if (already) continue;
    const label = entry.role === 'default' ? entry.id : `${entry.id} (${entry.role})`;
    // The injected entry only carries value+label; T's extra fields are all
    // optional on the route's ModelEntry, so this cast is structurally safe.
    toPrepend.push({ value: entry.id, label } as T);
  }

  return [...toPrepend, ...rawModels];
}

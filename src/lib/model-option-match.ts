// Map a canonical / alias model id back to its provider-models option row so
// the UI can show a friendly label instead of a raw id. Pure function.
// See docs/run-cockpit-context-card-spec.md §6.6.

export interface ModelOptionLike {
  value: string;
  label: string;
  upstreamModelId?: string;
}

/**
 * Resolve `modelName` (which may be an alias like `sonnet`, a canonical
 * upstream id, or differ only by case) to the matching option row.
 */
export function findModelOption<T extends ModelOptionLike>(
  models: T[] | undefined,
  modelName: string | undefined,
): T | undefined {
  if (!models || !modelName) return undefined;
  return (
    models.find((m) => m.value === modelName) ??
    models.find((m) => m.upstreamModelId === modelName) ??
    models.find((m) => m.value?.toLowerCase() === modelName.toLowerCase())
  );
}

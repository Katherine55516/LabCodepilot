/** Manual order is independent of Pin and of the project's updatedAt. */
const rank = item => Number.isSafeInteger(item.manualOrder) && item.manualOrder >= 0 ? item.manualOrder : Number.MAX_SAFE_INTEGER;

export function sortManual(items, fallback) {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    rank(a) - rank(b) || fallback(a, b));
}

export function reorderManual(items, movedId, targetId, position = 'before', fallback) {
  if (!['before', 'after'].includes(position) || movedId === targetId) throw new Error('invalid manual reorder');
  const moved = items.find(item => item.id === movedId);
  const target = items.find(item => item.id === targetId);
  if (!moved || !target) throw new Error('manual reorder target is missing');
  if (Boolean(moved.pinned) !== Boolean(target.pinned)) throw new Error('pinned and regular items cannot be reordered together');
  const group = sortManual(items.filter(item => Boolean(item.pinned) === Boolean(moved.pinned)), fallback)
    .filter(item => item.id !== movedId);
  const at = group.findIndex(item => item.id === targetId) + Number(position === 'after');
  group.splice(at, 0, moved);
  group.forEach((item, index) => { item.manualOrder = index; });
  return group;
}

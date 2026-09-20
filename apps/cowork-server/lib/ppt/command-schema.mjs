import { newId } from './ir.mjs';

export const COMMAND_TYPES = new Set([
  'slide.insert', 'slide.delete', 'slide.duplicate', 'slide.reorder', 'slide.setLayout',
  'node.insert', 'node.delete', 'node.setContent', 'node.setStyle', 'node.setGeometry', 'node.setZIndex',
  'deck.replace', 'ai.objectPatch',
]);

export function normalizeCommand(input, project) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('command body is required'), { statusCode: 400 });
  const type = String(input.type || '');
  if (!COMMAND_TYPES.has(type)) throw Object.assign(new Error(`unsupported command: ${type}`), { statusCode: 400 });
  const baseRevision = Number(input.baseRevision);
  if (!Number.isInteger(baseRevision) || baseRevision < 0) throw Object.assign(new Error('baseRevision must be a non-negative integer'), { statusCode: 400 });
  return {
    id: typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.id) ? input.id : newId('cmd'),
    type,
    baseRevision,
    payload: input.payload && typeof input.payload === 'object' ? structuredClone(input.payload) : {},
    actor: String(input.actor || project.uid || 'user').slice(0, 120),
    createdAt: new Date().toISOString(),
  };
}

export function commandTargets(command) {
  const p = command.payload || {};
  const targets = [];
  if (p.slideId) targets.push(`slide:${p.slideId}`);
  if (p.nodeId) targets.push(`node:${p.slideId || '*'}:${p.nodeId}`);
  if (command.type === 'slide.reorder' || command.type === 'deck.replace') targets.push('deck:*');
  if (!targets.length && command.type.startsWith('slide.')) targets.push('deck:slides');
  return targets;
}

export function commandsConflict(left, right) {
  const a = commandTargets(left); const b = commandTargets(right);
  return a.some(one => b.some(two => one === two || one === 'deck:*' || two === 'deck:*' ||
    (one.startsWith('slide:') && two.startsWith(`${one.replace('slide:', 'node:')}:`)) ||
    (two.startsWith('slide:') && one.startsWith(`${two.replace('slide:', 'node:')}:`))));
}

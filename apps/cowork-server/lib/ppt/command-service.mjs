import { appendJsonLine, enqueueProject, getProject, operationsFile, saveProject, saveRevision } from './repository.mjs';
import { commandTargets, commandsConflict, normalizeCommand } from './command-schema.mjs';
import { findOperation, latestRedoable, latestUndoable, operationHistory } from './command-history.mjs';
import { ensureDeckV3, ensureSlideV3, findNode, materializeLegacySlide, newId } from './ir.mjs';
import { rebuildRenderTree } from './render-tree.mjs';
import { enrichAssetRefs } from './assets.mjs';

function fail(message, statusCode = 400, details) { throw Object.assign(new Error(message), { statusCode, details }); }
function slide(deck, id) { const value = deck.slides.find(item => item.id === id); if (!value) fail(`slide not found: ${id}`, 404); return value; }

function syncSlide(value) { return materializeLegacySlide(ensureSlideV3(value)); }

function applyToDeck(deckInput, command) {
  const deck = ensureDeckV3(deckInput);
  const p = command.payload;
  let inverse;
  switch (command.type) {
    case 'slide.insert': {
      const value = ensureSlideV3({ ...(p.slide || {}), id: p.slide?.id || newId('slide') });
      const index = Math.max(0, Math.min(deck.slides.length, Number.isInteger(p.index) ? p.index : deck.slides.length));
      deck.slides.splice(index, 0, value); inverse = { type: 'slide.delete', payload: { slideId: value.id } }; break;
    }
    case 'slide.delete': {
      const index = deck.slides.findIndex(item => item.id === p.slideId); if (index < 0) fail(`slide not found: ${p.slideId}`, 404);
      const [value] = deck.slides.splice(index, 1); inverse = { type: 'slide.insert', payload: { slide: value, index } }; break;
    }
    case 'slide.duplicate': {
      const source = slide(deck, p.slideId); const copy = structuredClone(source); copy.id = newId('slide');
      copy.nodes = copy.nodes.map(node => ({ ...node, id: newId('node'), content: node.type === 'list' ? { ...(node.content || {}), items: (node.content?.items || []).map(item => ({ ...item, id: newId('item') })) } : node.content }));
      const value = ensureSlideV3(copy);
      const index = deck.slides.indexOf(source) + 1; deck.slides.splice(index, 0, value); inverse = { type: 'slide.delete', payload: { slideId: value.id } }; break;
    }
    case 'slide.reorder': {
      const before = deck.slides.map(item => item.id); const requested = Array.isArray(p.slideIds) ? p.slideIds : [];
      if (requested.length !== before.length || new Set(requested).size !== before.length || requested.some(id => !before.includes(id))) fail('slideIds must contain every slide exactly once');
      const byId = new Map(deck.slides.map(item => [item.id, item])); deck.slides = requested.map(id => byId.get(id));
      inverse = { type: 'slide.reorder', payload: { slideIds: before } }; break;
    }
    case 'slide.setLayout': {
      const value = slide(deck, p.slideId); const before = value.layoutRef || value.layoutId; value.layoutRef = String(p.layoutId); value.layoutId = value.layoutRef;
      inverse = { type: command.type, payload: { slideId: p.slideId, layoutId: before } }; break;
    }
    case 'node.insert': {
      const value = slide(deck, p.slideId); const node = { ...(p.node || {}), id: p.node?.id || newId('node') };
      const index = Math.max(0, Math.min(value.nodes.length, Number.isInteger(p.index) ? p.index : value.nodes.length));
      value.nodes.splice(index, 0, node); inverse = { type: 'node.delete', payload: { slideId: p.slideId, nodeId: node.id } }; break;
    }
    case 'node.delete': {
      const value = slide(deck, p.slideId); const index = value.nodes.findIndex(node => node.id === p.nodeId); if (index < 0) fail(`node not found: ${p.nodeId}`, 404);
      const [node] = value.nodes.splice(index, 1); inverse = { type: 'node.insert', payload: { slideId: p.slideId, node, index } }; break;
    }
    case 'node.setContent':
    case 'node.setStyle':
    case 'node.setGeometry':
    case 'node.setZIndex': {
      const { node } = findNode(deck, p.slideId, p.nodeId); if (!node) fail(`node not found: ${p.nodeId}`, 404);
      if (node.locked) fail('node is locked', 409);
      const field = command.type.slice('node.set'.length); const key = field[0].toLowerCase() + field.slice(1);
      const before = structuredClone(node[key]); node[key] = structuredClone(p[key]);
      inverse = { type: command.type, payload: { slideId: p.slideId, nodeId: p.nodeId, [key]: before } }; break;
    }
    case 'ai.objectPatch': {
      if (!p.slideId || !p.nodeId) fail('AI patch requires slideId and nodeId');
      const { node } = findNode(deck, p.slideId, p.nodeId); if (!node) fail(`node not found: ${p.nodeId}`, 404);
      if (node.locked) fail('node is locked', 409);
      const before = { content: structuredClone(node.content), style: structuredClone(node.style), geometry: structuredClone(node.geometry) };
      for (const key of ['content', 'style', 'geometry']) if (p.patch?.[key] !== undefined) node[key] = p.replace ? structuredClone(p.patch[key]) : { ...(node[key] || {}), ...structuredClone(p.patch[key]) };
      inverse = { type: 'ai.objectPatch', payload: { slideId: p.slideId, nodeId: p.nodeId, patch: before, replace: true } }; break;
    }
    case 'deck.replace': {
      inverse = { type: 'deck.replace', payload: { deck: structuredClone(deck) } }; return { deck: ensureDeckV3(p.deck), inverse };
    }
    default: fail(`unsupported command: ${command.type}`);
  }
  deck.slides = deck.slides.map(syncSlide);
  return { deck, inverse };
}

function priorConflicts(project, command) {
  if (command.baseRevision === project.revision) return [];
  return operationHistory(project.uid, project.id)
    .filter(operation => operation.revision > command.baseRevision && operation.command && commandsConflict(operation.command, command));
}

async function commit(project, command, meta = {}) {
  const existing = findOperation(project.uid, project.id, command.id);
  if (existing) return { project, operation: existing, idempotent: true };
  if (command.baseRevision > project.revision) fail('baseRevision is newer than the project', 409, { currentRevision: project.revision });
  const conflicts = priorConflicts(project, command);
  if (conflicts.length) fail('command conflicts with newer changes', 409, { currentRevision: project.revision, conflicts: conflicts.map(item => ({ id: item.id, revision: item.revision, targets: item.targets })) });
  if (project.externalPptx && !meta.allowExternalStructure && !['node.setContent', 'node.setStyle', 'node.setGeometry', 'node.setZIndex', 'ai.objectPatch'].includes(command.type)) {
    fail('imported PPTX currently supports conservative object edits only', 409);
  }
  const { deck, inverse } = applyToDeck(project.deck, command);
  project.deck = deck; enrichAssetRefs(project);
  project.revision += 1; project.draftRevision = project.revision; project.updatedAt = new Date().toISOString();
  const affectedSlideIds = [...new Set([command.payload.slideId].filter(Boolean))];
  project.renderTree = rebuildRenderTree(project, project.renderTree, command.type === 'deck.replace' || command.type.startsWith('slide.') ? [] : affectedSlideIds);
  saveProject(project); saveRevision(project, meta.kind || command.type);
  const operation = {
    schemaVersion: 1, id: command.id, status: 'committed', kind: meta.kind || 'command', targetOperationId: meta.targetOperationId || null,
    projectId: project.id, revision: project.revision, baseRevision: command.baseRevision, at: new Date().toISOString(), actor: command.actor,
    targets: commandTargets(command), command, inverse: { ...inverse, baseRevision: project.revision }, affectedSlideIds,
  };
  appendJsonLine(operationsFile(project.uid, project.id), operation);
  return { project, operation, idempotent: false };
}

export function applyCommand(uid, projectId, input, options = {}) {
  return enqueueProject(uid, projectId, async () => {
    const project = getProject(uid, projectId); if (!project) fail('project not found', 404);
    return commit(project, normalizeCommand(input, project), options);
  });
}

export function undo(uid, projectId, actor = uid) {
  return enqueueProject(uid, projectId, async () => {
    const project = getProject(uid, projectId); if (!project) fail('project not found', 404);
    const target = latestUndoable(uid, projectId); if (!target) fail('nothing to undo', 409);
    const command = normalizeCommand({ ...target.inverse, id: newId('undo'), baseRevision: project.revision, actor }, project);
    return commit(project, command, { kind: 'undo', targetOperationId: target.id });
  });
}

export function redo(uid, projectId, actor = uid) {
  return enqueueProject(uid, projectId, async () => {
    const project = getProject(uid, projectId); if (!project) fail('project not found', 404);
    const undone = latestRedoable(uid, projectId); if (!undone) fail('nothing to redo', 409);
    const original = findOperation(uid, projectId, undone.targetOperationId); if (!original) fail('redo target is missing', 409);
    const command = normalizeCommand({ ...original.command, id: newId('redo'), baseRevision: project.revision, actor }, project);
    return commit(project, command, { kind: 'redo', targetOperationId: original.id });
  });
}

export const _internals = { applyToDeck, priorConflicts, commit };

import { appendJsonLine, enqueueProject, getProject, operationsFile, saveProject, saveRevision, readRevision, checkpointCommit, finishCommit } from './repository.mjs';
import { commandTargets, commandsConflict, normalizeCommand } from './command-schema.mjs';
import { findOperation, latestRedoable, latestUndoable, operationHistory } from './command-history.mjs';
import { ensureDeckV3, ensureSlideV3, findNode, materializeLegacySlide, newId } from './ir.mjs';
import { rebuildRenderTree } from './render-tree.mjs';
import { enrichAssetRefs } from './assets.mjs';
import { digest } from './edit-context.mjs';
import { invalidateReviews, semanticReviewKey, synchronizePlan } from './versioning.mjs';

function fail(message, statusCode = 400, details) { throw Object.assign(new Error(message), { statusCode, details }); }
function slide(deck, id) { const value = deck.slides.find(item => item.id === id); if (!value) fail(`slide not found: ${id}`, 404); return value; }
const INTERNAL_COMMANDS = new Set(['nodes.restore', 'nodes.setGroup', 'deck.replace']);

function nativeTextContent(node, candidate) {
  const next = structuredClone(candidate);
  if (!node.nativeRef || node.type !== 'text') return next;
  const original = (node.nativeTextFrame?.paragraphs || []).filter(item => item.text?.trim());
  if (original.length > 1) {
    if (!next.paragraphs) {
      const lines = String(next.text || '').split(/\r?\n/u).map(item => item.trim());
      if (lines.length !== original.length) fail(`this template text box requires ${original.length} points`, 409);
      next.paragraphs = lines.map((line, index) => {
        const hasLabel = original[index].runs?.[0]?.bold && original[index].runs?.slice(1).some(run => !run.bold && run.text?.trim());
        const parts = hasLabel ? line.split(/[：:]/u) : [];
        return hasLabel ? { label: (parts.shift() || '').trim(), body: parts.join('：').trim() } : { label: '', body: line };
      });
    }
    if (next.paragraphs.length !== original.length || next.paragraphs.some((item, index) => !item.body?.trim() ||
      (original[index].runs?.[0]?.bold && original[index].runs?.slice(1).some(run => !run.bold && run.text?.trim()) && !item.label?.trim()))) {
      fail('template point count or label/body structure is invalid', 409);
    }
    next.text = next.paragraphs.map(item => [item.label, item.body].filter(Boolean).join('：')).join('\n');
  }
  return { ...next, templateFit: Boolean(node.nativeTextFrame) };
}

function syncSlide(value) {
  const slide = materializeLegacySlide(ensureSlideV3(value));
  const items = slide.nodes?.find(node => node.type === 'list' && node.semanticRole === 'body')?.content?.items || [];
  if (Array.isArray(slide.copy?.blocks)) slide.copy.blocks = items.map(item => {
    const parts = String(item.text || '').split('\n');
    const heading = String(item.heading ?? (parts.length > 1 ? parts[0] : ''));
    const body = String(item.body ?? (parts.length > 1 ? parts.slice(1).join('\n') : parts[0] || ''));
    return { type: item.pointType || 'support', heading, body };
  });
  return slide;
}

function finalizeDeck(deck, project) {
  deck.slides = deck.slides.map(syncSlide);
  if (project.templateFidelity?.mode === 'preserve') for (const value of deck.slides) {
    for (const node of value.nodes.filter(item => item.templateSlot)) {
      node.templateSlot.mapped = Boolean(String(node.content?.text || '').trim());
      if (node.semanticRole === 'template-title') {
        value.title = String(node.content?.text || '');
        const title = value.nodes.find(item => item.semanticRole === 'title');
        if (title) title.content = { ...(title.content || {}), text: value.title };
      }
    }
  }
  return deck;
}

function applyToDeck(deckInput, command, project = {}) {
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
      if (deck.slides.length <= 1) fail('a deck must contain at least one slide');
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
    case 'node.duplicate': {
      const value = slide(deck, p.slideId); const source = value.nodes.find(node => node.id === p.nodeId); if (!source) fail(`node not found: ${p.nodeId}`, 404);
      if (source.locked) fail('node is locked', 409);
      const node = structuredClone(source); node.id = newId('node'); node.groupId = null;
      if (node.content?.items) node.content.items = node.content.items.map(item => ({ ...item, id: newId('item') }));
      if (node.geometry) node.geometry = { ...node.geometry, x: Math.min(node.geometry.x + 182880, 12191695 - node.geometry.width), y: Math.min(node.geometry.y + 182880, 6858000 - node.geometry.height) };
      const index = value.nodes.indexOf(source) + 1; value.nodes.splice(index, 0, node); inverse = { type: 'node.delete', payload: { slideId: p.slideId, nodeId: node.id } }; break;
    }
    case 'node.delete': {
      const value = slide(deck, p.slideId); const index = value.nodes.findIndex(node => node.id === p.nodeId); if (index < 0) fail(`node not found: ${p.nodeId}`, 404);
      if (value.nodes[index].locked) fail('node is locked', 409);
      const [node] = value.nodes.splice(index, 1); inverse = { type: 'node.insert', payload: { slideId: p.slideId, node, index } }; break;
    }
    case 'nodes.delete': {
      const value = slide(deck, p.slideId); const ids = new Set(p.nodeIds); const entries = value.nodes.map((node, index) => ({ node, index })).filter(entry => ids.has(entry.node.id));
      if (entries.length !== ids.size) fail('one or more nodes were not found', 404); if (entries.some(entry => entry.node.locked)) fail('node is locked', 409);
      for (const entry of [...entries].sort((a, b) => b.index - a.index)) value.nodes.splice(entry.index, 1);
      inverse = { type: 'nodes.restore', payload: { slideId: p.slideId, entries } }; break;
    }
    case 'nodes.restore': {
      const value = slide(deck, p.slideId); const restoredIds = [];
      for (const entry of [...p.entries].sort((a, b) => a.index - b.index)) { value.nodes.splice(Math.min(entry.index, value.nodes.length), 0, structuredClone(entry.node)); restoredIds.push(entry.node.id); }
      inverse = { type: 'nodes.delete', payload: { slideId: p.slideId, nodeIds: restoredIds } }; break;
    }
    case 'nodes.duplicate': {
      const value = slide(deck, p.slideId); const ids = new Set(p.nodeIds); const sources = value.nodes.filter(node => ids.has(node.id)); if (sources.length !== ids.size) fail('one or more nodes were not found', 404);
      if (sources.some(node => node.locked)) fail('node is locked', 409);
      const copies = sources.map(source => { const node = structuredClone(source); node.id = newId('node'); node.groupId = null; if (node.content?.items) node.content.items = node.content.items.map(item => ({ ...item, id: newId('item') })); if (node.geometry) node.geometry = { ...node.geometry, x: Math.min(node.geometry.x + 182880, 12191695 - node.geometry.width), y: Math.min(node.geometry.y + 182880, 6858000 - node.geometry.height) }; return node; });
      value.nodes.push(...copies); inverse = { type: 'nodes.delete', payload: { slideId: p.slideId, nodeIds: copies.map(node => node.id) } }; break;
    }
    case 'node.setContent':
    case 'node.setStyle':
    case 'node.setGeometry':
    case 'node.setZIndex':
    case 'node.setRotation':
    case 'node.setLocked': {
      const { node } = findNode(deck, p.slideId, p.nodeId); if (!node) fail(`node not found: ${p.nodeId}`, 404);
      if (node.locked && command.type !== 'node.setLocked') fail('node is locked', 409);
      const field = command.type.slice('node.set'.length); const key = field[0].toLowerCase() + field.slice(1);
      const before = node[key] === undefined ? null : structuredClone(node[key]);
      if (p[key] === null) delete node[key]; else node[key] = key === 'content' ? nativeTextContent(node, p[key]) : structuredClone(p[key]);
      inverse = { type: command.type, payload: { slideId: p.slideId, nodeId: p.nodeId, [key]: before } }; break;
    }
    case 'nodes.setGeometry': {
      const changes = []; const value = slide(deck, p.slideId);
      for (const change of p.changes) {
        const node = value.nodes.find(item => item.id === change.nodeId); if (!node) fail(`node not found: ${change.nodeId}`, 404); if (node.locked) fail('node is locked', 409);
        changes.push({ nodeId: node.id, geometry: structuredClone(node.geometry) }); node.geometry = structuredClone(change.geometry);
      }
      inverse = { type: command.type, payload: { slideId: p.slideId, changes } }; break;
    }
    case 'nodes.group':
    case 'nodes.ungroup':
    case 'nodes.setGroup': {
      const value = slide(deck, p.slideId); const requested = command.type === 'nodes.setGroup' ? p.entries : p.nodeIds.map(nodeId => ({ nodeId, groupId: command.type === 'nodes.group' ? null : null }));
      const groupId = command.type === 'nodes.group' ? newId('group') : null; const entries = [];
      for (const request of requested) {
        const node = value.nodes.find(item => item.id === request.nodeId); if (!node) fail(`node not found: ${request.nodeId}`, 404); if (node.locked) fail('node is locked', 409);
        entries.push({ nodeId: node.id, groupId: node.groupId || null }); node.groupId = command.type === 'nodes.setGroup' ? request.groupId : groupId;
      }
      inverse = { type: 'nodes.setGroup', payload: { slideId: p.slideId, entries } }; break;
    }
    case 'ai.objectPatch': {
      if (!p.slideId || !p.nodeId) fail('AI patch requires slideId and nodeId');
      const { node } = findNode(deck, p.slideId, p.nodeId); if (!node) fail(`node not found: ${p.nodeId}`, 404);
      if (node.locked) fail('node is locked', 409);
      const before = { content: structuredClone(node.content) };
      const patchedContent = p.replace ? { ...p.patch.content } : { ...(node.content || {}), ...p.patch.content };
      if (Object.hasOwn(p.patch.content, 'text') && !Object.hasOwn(p.patch.content, 'paragraphs')) delete patchedContent.paragraphs;
      node.content = nativeTextContent(node, patchedContent);
      inverse = { type: 'ai.objectPatch', payload: { slideId: p.slideId, nodeId: p.nodeId, patch: before, replace: true } }; break;
    }
    case 'ai.slidePatch': {
      const value = slide(deck, p.slideId); const patches = [];
      for (const patch of p.patches) {
        const node = value.nodes.find(item => item.id === patch.nodeId); if (!node) fail(`node not found: ${patch.nodeId}`, 404); if (node.locked) fail('node is locked', 409);
        patches.push({ nodeId: node.id, content: structuredClone(node.content) }); node.content = nativeTextContent(node, patch.content);
      }
      const layoutId = value.layoutRef || value.layoutId; if (p.layoutId) { value.layoutRef = p.layoutId; value.layoutId = p.layoutId; }
      inverse = { type: command.type, payload: { slideId: p.slideId, patches, ...(p.layoutId ? { layoutId } : {}) } }; break;
    }
    case 'theme.setPalette': {
      const before = structuredClone(project.templateSpec?.palette || deck.themePalette || p.palette);
      deck.themePalette = structuredClone(p.palette);
      inverse = { type: command.type, payload: { palette: before } }; break;
    }
    case 'theme.setTokens': {
      const before = structuredClone(deck.themeTokens || { titleScale: 1, bodyScale: 1, spacingScale: 1 });
      deck.themeTokens = structuredClone(p.tokens);
      inverse = { type: command.type, payload: { tokens: before } }; break;
    }
    case 'deck.replace': {
      const before = Object.fromEntries(['template', 'templateSpec', 'outline', 'pages', 'pageDecision', 'planning', 'constraints'].map(key => [key, structuredClone(project[key] ?? null)]));
      inverse = { type: 'deck.replace', payload: { deck: structuredClone(deck), projectState: before } };
      return { deck: finalizeDeck(ensureDeckV3(p.deck), { ...project, ...(p.projectState || {}) }), inverse };
    }
    default: fail(`unsupported command: ${command.type}`);
  }
  return { deck: finalizeDeck(deck, project), inverse };
}

function priorConflicts(project, command) {
  if (command.baseRevision === project.revision) return [];
  return operationHistory(project.uid, project.id)
    .filter(operation => operation.revision > command.baseRevision && operation.command && commandsConflict(operation.command, command));
}

async function commit(project, command, meta = {}) {
  const beforeReviewKey = semanticReviewKey(project);
  const existing = findOperation(project.uid, project.id, command.id);
  if (existing) return { project, operation: existing, idempotent: true };
  if (meta.guard) meta.guard(project, command);
  if (!['completed', 'quality_blocked', 'paused'].includes(project.status) && !meta.allowGenerating)
    fail('project is not editable in its current state', 409);
  if (command.baseRevision > project.revision) fail('baseRevision is newer than the project', 409, { currentRevision: project.revision });
  const conflicts = priorConflicts(project, command);
  if (conflicts.length) fail('command conflicts with newer changes', 409, { currentRevision: project.revision, conflicts: conflicts.map(item => ({ id: item.id, revision: item.revision, targets: item.targets })) });
  if ((project.externalPptx || project.templateFidelity?.mode === 'preserve') && !meta.allowExternalStructure && !['node.setContent', 'node.setStyle', 'node.setGeometry', 'node.setLocked', 'nodes.setGeometry', 'ai.objectPatch', 'ai.slidePatch'].includes(command.type)) {
    fail('imported PPTX currently supports conservative object edits only', 409);
  }
  if (project.templateFidelity?.mode === 'preserve' && !meta.allowExternalStructure) {
    const ids = [command.payload.nodeId, ...(command.payload.changes || []).map(item => item.nodeId), ...(command.payload.patches || []).map(item => item.nodeId)].filter(Boolean);
    const native = ids.map(nodeId => project.deck.slides.flatMap(item => item.nodes || []).find(node => node.id === nodeId));
    if (native.some(node => !node?.nativeRef)) fail('template edits must target an original template object', 409);
    if (['node.setContent', 'ai.objectPatch', 'ai.slidePatch'].includes(command.type) && native.some(node => node.type !== 'text')) {
      fail('template content edits are limited to native text objects', 409);
    }
    if (command.type === 'node.setStyle' && native.some(node => node.type !== 'text' && node.type !== 'shape')) {
      fail('template style edits are limited to native text and shapes', 409);
    }
    if (command.type === 'node.setLocked' && native.some(node => node.type !== 'text' && command.payload.locked === false)) {
      fail('template artwork cannot be unlocked', 409);
    }
    if (command.type === 'ai.slidePatch' && command.payload.layoutId) fail('template slide layout cannot be replaced', 409);
  }
  // Fill legacy published snapshots before the first draft mutation.
  if (project.revision === project.publishedRevision && !readRevision(project.uid, project.id, project.revision)?.templateSpec)
    saveRevision(project, 'published-baseline');
  const beforeSlides = new Map(project.deck.slides.map(slide => [slide.id, digest(slide)]));
  const { deck, inverse } = applyToDeck(project.deck, command, project);
  project.deck = deck;
  if (command.type === 'deck.replace' && command.payload.projectState) for (const key of ['template', 'templateSpec', 'outline', 'pages', 'pageDecision', 'planning', 'constraints']) {
    if (Object.hasOwn(command.payload.projectState, key)) project[key] = structuredClone(command.payload.projectState[key]);
  }
  if (command.type === 'theme.setPalette') project.templateSpec = { ...(project.templateSpec || {}), palette: structuredClone(command.payload.palette) };
  if (command.type === 'deck.replace') synchronizePlan(project, 'proposal');
  enrichAssetRefs(project, { strict: true });
  project.revision += 1; project.draftRevision = project.revision; project.updatedAt = new Date().toISOString();
  if (command.type.startsWith('slide.') && command.type !== 'slide.setLayout') {
    const previous = new Map((project.outline || []).map(item => [item.id, item]));
    project.outline = project.deck.slides.map(item => previous.get(item.id) || { id: item.id, title: item.title, refs: item.sourceRefs || [] });
    project.pages = project.deck.slides.length;
    project.pageDecision = { ...project.pageDecision, finalPageCount: project.pages, source: 'user' };
    synchronizePlan(project, command.type);
  }
  // A paused draft is also the generation cache. Resume must not reconstruct an older
  // page from node.slide or execute an intent queued before this manual command.
  if (project.status === 'paused' && !meta.allowGenerating) {
    project.nodes ||= {};
    const changed = new Set(project.deck.slides.filter(slide => beforeSlides.get(slide.id) !== digest(slide)).map(slide => slide.id));
    for (const id of beforeSlides.keys()) if (!project.deck.slides.some(slide => slide.id === id)) { changed.add(id); delete project.nodes[id]; }
    for (const slide of project.deck.slides) if (changed.has(slide.id)) {
      if (project.editing) project.editing.epochs[slide.id] = (project.editing.epochs[slide.id] || 0) + 1;
      project.nodes[slide.id] = { ...project.nodes[slide.id], status: 'done', slide: structuredClone(slide), epoch: project.editing?.epochs?.[slide.id] || 0 };
      delete project.nodes[slide.id].error;
    }
    for (const intent of Object.values(project.editing?.intents || {})) {
      for (const id of changed) {
        const result = intent.perSlideResults?.[id];
        if (!result || !['queued', 'applying', 'proposed'].includes(result.status)) continue;
        Object.assign(result, { status: 'conflicted', error: 'manual draft edit superseded the pending mutation' });
        for (const entry of project.constraints?.entries || []) if (entry.active && entry.intentId === intent.id && entry.slideId === id) { entry.active = false; project.constraints.version++; }
      }
      const statuses = Object.values(intent.perSlideResults || {}).map(result => result.status);
      intent.status = statuses.includes('proposed') ? 'proposed' : statuses.includes('applying') ? 'applying' : statuses.includes('queued') ? 'queued' : statuses.includes('applied') && statuses.includes('conflicted') ? 'partially_applied' : statuses.includes('conflicted') ? 'conflicted' : intent.status;
    }
  }
  invalidateReviews(project, beforeReviewKey);
  const affectedSlideIds = [...new Set([command.payload.slideId].filter(Boolean))];
  project.renderTree = rebuildRenderTree(project, project.renderTree, command.type === 'deck.replace' || command.type.startsWith('slide.') ? [] : affectedSlideIds);
  if (project.runtime) {
    for (const tree of project.renderTree.slides) {
      const state = project.runtime.slides[tree.id] || {};
      project.runtime.slides[tree.id] = { ...state, preview: tree, renderHash: digest(tree), phase: 'render_ready' };
    }
    for (const id of Object.keys(project.runtime.slides)) if (!project.deck.slides.some(slide => slide.id === id)) delete project.runtime.slides[id];
  }
  const operation = {
    schemaVersion: 1, id: command.id, status: 'committed', kind: meta.kind || 'command', targetOperationId: meta.targetOperationId || null,
    projectId: project.id, revision: project.revision, baseRevision: command.baseRevision, at: new Date().toISOString(), actor: command.actor,
    targets: commandTargets(command), command, inverse: { ...inverse, baseRevision: project.revision }, affectedSlideIds,
  };
  checkpointCommit(project, operation, meta.kind || command.type);
  saveProject(project); saveRevision(project, meta.kind || command.type);
  appendJsonLine(operationsFile(project.uid, project.id), operation);
  finishCommit(project);
  return { project, operation, idempotent: false };
}

export function applyCommand(uid, projectId, input, options = {}) {
  return enqueueProject(uid, projectId, async () => {
    const project = getProject(uid, projectId); if (!project) fail('project not found', 404);
    if (INTERNAL_COMMANDS.has(String(input?.type || '')) && !options.allowInternal) fail('internal command type is not available through the public command API');
    return commit(project, normalizeCommand(input, project), options);
  });
}

export function undo(uid, projectId, actor = uid, operationId = null) {
  return enqueueProject(uid, projectId, async () => {
    const project = getProject(uid, projectId); if (!project) fail('project not found', 404);
    const target = operationId ? findOperation(uid, projectId, operationId) : latestUndoable(uid, projectId); if (!target) fail('nothing to undo', 409);
    if (operationId) {
      if (target.kind !== 'command') fail('only committed commands can be undone', 409);
      const later = operationHistory(uid, projectId).filter(row => row.revision > target.revision);
      if (later.some(row => row.command && commandsConflict(row.command, target.command)))
        fail('the target has newer changes; preview the current page before restoring', 409);
    }
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

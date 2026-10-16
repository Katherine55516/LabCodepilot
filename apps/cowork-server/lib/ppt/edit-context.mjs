import { inputFramework } from '../ppt-input-scope.mjs';
import crypto from 'node:crypto';
import { maxPreservedPages } from '../ppt-template-scheduler.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'null').digest('hex');
}

export function planKey(project) {
  return digest({ inputFrameworkHash: inputFramework(project).frameworkHash, sourceRevision: project.sourceRevision || 0, source: project.source?.sha256 || project.source?.text || project.prompt,
    template: project.templateSpec || project.template, decision: project.pageDecision,
    planning: project.planning, generationPolicy: project.generationPolicy, model: { configId: project.configId, model: project.model },
    outline: (project.outline || []).filter(slide => !slide.manualBlank).map(slide=>{const {titleEditBaseline,...planning}=slide;return titleEditBaseline?{...planning,title:titleEditBaseline.title,titleLocked:titleEditBaseline.titleLocked}:planning;}).sort((a, b) => String(a.id).localeCompare(String(b.id))) });
}

export function slideFingerprint(project, slideId) {
  return digest({ slide: project.deck?.slides.find(slide => slide.id === slideId), template: project.templateSpec,
    constraints: project.constraints?.entries?.filter(entry => entry.slideId === slideId && entry.active),
    palette: project.deck?.themePalette, tokens: project.deck?.themeTokens });
}

export function editError(message, statusCode = 409, details) {
  return Object.assign(new Error(message), { statusCode, details });
}

export function editableCapabilities(project) {
  const native = Boolean(project.externalPptx || project.templateFidelity?.mode === 'preserve');
  return { semanticEdit: true, relayout: !native, insertSlide: !native, minPages: project.update ? 6 : 3, maxPages: 100 };
}

export function templateCapabilities(template) {
  const native = template?.kind === 'uploaded' && template.extension === 'pptx';
  const count = Number(template?.pages || 0);
  return { relayout: !native, insertSlide: !native, minPages: 3,
    // Upper bound only: the existing scheduler still validates compatible native layouts.
    maxPages: native ? maxPreservedPages(count) : 100,
    capacityCheck: native ? 'native-scheduler' : 'content-plan' };
}

/** A failed later stage must not make a verified page inaccessible. Pending
 * pages and deck-wide mutations still require a frozen generation scope. */
export function pageEditContext(project, slideId, type = 'content', scope = 'slide') {
  if (!project || project.deletedAt) throw editError('project is unavailable', 409);
  const live = ['generating', 'failed'].includes(project.status);
  if (!live) {
    if (!['completed', 'quality_blocked', 'paused'].includes(project.status)) throw editError('wait for the target page to finish before editing', 409);
    return null;
  }
  if (project.status === 'failed' && project.stage !== 'generation') throw editError('resolve the input or outline failure before editing pages', 409);
  if (scope === 'deck' || !['content', 'title', 'object'].includes(type)) throw editError('freeze generation scope before changing layout or the whole deck', 409);
  const state = project.runtime?.slides?.[slideId];
  if (project.nodes?.[slideId]?.status !== 'done' || !state?.preview || state.phase !== 'render_ready' || state.quality?.issues?.some(issue => issue.severity === 'error'))
    throw editError('wait for this page to finish validation before editing', 409);
  return { runId: project.currentRunId || null, epoch: Number(project.editing?.epochs?.[slideId] || 0) };
}
export function assertPageEditContext(project, proposal) {
  pageEditContext(project, proposal.slideId, proposal.type || 'content', proposal.scope);
  if (proposal.liveEditContext && (proposal.liveEditContext.runId !== (project.currentRunId || null) || proposal.liveEditContext.epoch !== Number(project.editing?.epochs?.[proposal.slideId] || 0)))
    throw editError('the page generation changed; preview again', 409);
}

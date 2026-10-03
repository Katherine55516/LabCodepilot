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
  return digest({ sourceRevision: project.sourceRevision || 0, source: project.source?.sha256 || project.source?.text || project.prompt,
    template: project.templateSpec || project.template, decision: project.pageDecision,
    planning: project.planning, generationPolicy: project.generationPolicy, model: { configId: project.configId, model: project.model },
    outline: (project.outline || []).filter(slide => !slide.manualBlank).sort((a, b) => String(a.id).localeCompare(String(b.id))) });
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

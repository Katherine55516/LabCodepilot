import { createHash } from 'node:crypto';
import { effectiveKnowledge } from './ppt-generation-policy.mjs';

function sourceInputs(source) {
  return {
    sourceText: String(source?.text || ''),
    segments: (source?.segments || []).map(({ id, text, location }) => ({ id, text, location })),
    objects: (source?.semantic?.blocks || []).map(({ id, type, text, rows, code, steps }) => ({ id, kind: type, text, rows, code, steps })),
    images: (source?.images || []).map(({ id, caption, imageSha256 }) => ({ id, caption, imageSha256 })),
  };
}

/** The model's brief, generated copy and local instructions are never authority
 * for widening the input. Retain complete inputs: a truncated tail can hide a
 * constraint or make a valid claim look unsupported. */
export function inputFramework(project) {
  const material = {
    prompt: String(project.prompt || ''),
    ...sourceInputs(project.source),
    // Only actual imported input decks receive this immutable baseline. A deck
    // selected as a design template must never become source material.
    importedInput: project.importedInputScope || null,
    previousVersionInput: project.update?.baseSnapshot ? {
      prompt: project.update.baseSnapshot.prompt || '',
      ...sourceInputs(project.update.baseSnapshot.source),
      importedInput: project.update.baseSnapshot.importedInputScope || null,
    } : null,
    knowledge: effectiveKnowledge(project),
  };
  return { version: 1, frameworkHash: createHash('sha256').update(JSON.stringify(material)).digest('hex'), material };
}

export const INPUT_SCOPE_RULES = `INPUT_FRAMEWORK is the original topic and factual authority, not the model-written brief.
Stay strictly within the input's subjects, purpose, relationships and boundaries, including its exclusions and uncertainty.
source_only: paraphrase, organize and explain supplied facts/relationships; do not add new factual premises.
source_plus_explanation: add only definitions, causal bridges or conditions necessary to understand an existing input topic; anchor each addition to that topic. Mark a hypothetical illustration as illustrative. Do not create an additional agenda, section or recommendation unrelated to the input.
Neither mode permits invented companies, owners, deadlines, measurements, thresholds, references, results, datasets or empirical/generalized claims. Plausibility and a source ID are not evidence.
Do not derive facts or topic permissions from template/sample copy, desired density/page count, prior generated slides, critic suggestions, local edit instructions or a self-authored sourceScope.
When the input is insufficient, preserve uncertainty, report the gap or use fewer pages in automatic-page mode; never fill space by repetition or invented content. Preserve user-locked pages/titles and report an unresolved capacity gap.
Local optimization changes expression/depth within this framework. A request to add an outside topic is an unresolved scope conflict, not permission to silently expand the source. Source updates must use the input workflow.`;

/** Prompt view of the framework. The full material stays the authority and
 * the hash is computed over it; the prompt carries the source text once and
 * refers to segments/prose objects by [start,end) offsets into it, instead of
 * repeating the same text three times. Tables, code and math keep their text. */
function compactInputs(material) {
  if (!material) return material;
  const text = String(material.sourceText || '');
  let cursor = 0;
  const span = value => {
    const needle = String(value || '').trim(); if (!needle) return null;
    let at = text.indexOf(needle, cursor); if (at < 0) at = text.indexOf(needle);
    if (at < 0) return null; cursor = at + needle.length; return [at, at + needle.length];
  };
  const segments = (material.segments || []).map(segment => { const range = span(segment.text); return range ? { id: segment.id, location: segment.location, span: range } : segment; });
  cursor = 0;
  const objects = (material.objects || []).map(object => {
    if (['table', 'code', 'equation', 'math', 'diagram'].includes(object.kind) || object.rows) return object;
    const range = span(object.text); return range ? { id: object.id, kind: object.kind, span: range } : object;
  });
  return { ...material, segments, objects };
}
export function compactFramework(framework) {
  const material = framework.material;
  return { version: framework.version, frameworkHash: framework.frameworkHash, encoding: 'segments/objects use [start,end) offsets into sourceText',
    material: { ...compactInputs(material), previousVersionInput: material.previousVersionInput ? compactInputs(material.previousVersionInput) : null } };
}

export function inputScopeContext(project) {
  return `<input_scope_rules>${INPUT_SCOPE_RULES}</input_scope_rules>\nINPUT_FRAMEWORK=${JSON.stringify(compactFramework(inputFramework(project)))}`;
}

/** Protocol completeness is deterministic; semantic truth remains a model
 * judgment. Never turn a missing audit into an implicit pass. */
export function normalizeScopeAudit(value, project, slideIds) {
  const expected = inputFramework(project).frameworkHash;
  const ids = value?.checkedSlideIds;
  if (!value || value.frameworkHash !== expected || !Array.isArray(ids) ||
      ids.length !== slideIds.length || new Set(ids).size !== ids.length || ids.some(id => !slideIds.includes(id)) ||
      !['complete', 'not_evaluated'].includes(value.status)) {
    throw new Error('input scope audit requires the current frameworkHash and every slide ID exactly once');
  }
  return { frameworkHash: expected, checkedSlideIds: [...ids], status: value.status };
}

export function scopeAuditIsCurrent(review, project) {
  try { return normalizeScopeAudit(review?.scopeAudit, project, (project.deck?.slides || []).map(slide => slide.id)).status === 'complete'; }
  catch { return false; }
}

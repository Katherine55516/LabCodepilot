/** Gamma reference is a density/style calibration, never a source of facts.
 * Character quartiles are observations of one deck, not universal hard limits. */
import { templateVisualUnits } from './ppt-presentation-writing.mjs';
import { sourceDisplayText } from './ppt-source-text.mjs';
export const GAMMA_DENSITY_PROFILE = Object.freeze({
  id: 'gamma-reference-v1', version: 1,
  referenceSha256: 'c8be44407f0e757e8958c314b076143bc220566feacbea1dea7ddfe34b41ec49',
  referenceSize: { widthIn: 13.333, heightIn: 7.5 },
  observedBody: { q1Chars: 909.5, medianChars: 1019, q3Chars: 1097.5 },
  // English-dominant reference measured in the same width units as native slots.
  bodyVisualUnits: { low: 601, target: 674, high: 740 },
  patterns: ['definition-framework', 'multi-column-comparison', 'dual-table', 'method-and-risk',
    'boundary-and-example', 'expanded-workflow', 'checklist-and-summary'],
  chapterFloor: false, autoShrinkToFit: false,
});
export function densityText(value) { return sourceDisplayText(value); }
export function actualTextChars(value) { return [...String(value || '').replace(/\s/gu, '')].length; }
export function displayUnits(value) { return templateVisualUnits(densityText(value)); }
export function densityProfile() { return GAMMA_DENSITY_PROFILE; }
export function automaticPages(project) {
  const d = project?.pageDecision;
  // Legacy projects with a confirmedAt remain frozen. New auto decisions do not
  // gain confirmation merely by opening the syllabus generation step.
  return !project?.update && !project?.externalPptx && !project?.requestedOutline && !project?.outlineSeed?.length &&
    d?.source === 'estimate' && d?.mode !== 'explicit' && d?.mode !== 'preserve_import' && !d?.confirmedAt;
}
export function densityPrompt(project) {
  return `<density_profile>${JSON.stringify(GAMMA_DENSITY_PROFILE)}</density_profile>
Group by a concrete reader question before assigning pages. Connected definitions form one framework;
comparison subjects share an axis, short tables may sit side by side, methods retain their conditions and examples,
workflow stages include actions/checks/outputs, and a conclusion may combine checklist, summary and judgement.
Headings are source locations, never a minimum of one page each. Standard and detailed both use this organization;
detailed includes more necessary explanations. Width units, source tokens and semantic units are distinct.
Observed character counts are calibration, not a quota. Preserve input languages, facts and required relationships.
Do not fill sparse sources, silently shrink type, truncate cells or duplicate claims to reach a target.
${automaticPages(project) ? 'Page count is provisional until candidate grouping and code-owned capacity validation finish.' : 'Preserve the explicit or confirmed page count; report genuine capacity conflicts.'}`;
}

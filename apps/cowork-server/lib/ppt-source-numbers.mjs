/** Numbers on slides must come from the input. Under source_only an
 * unsupported number blocks publication; under bounded explanation it is a
 * warning (illustrative values need a visible label). Ordinal badges, single
 * digits and page numbers are labels, not data. Template sample text is
 * allowed here because template-residue is checked separately.
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md. */
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { effectiveKnowledge } from './ppt-generation-policy.mjs';

const NUMBER = /(?<![\w.])[-−]?\d+(?:[.,]\d+)*/gu;
// "1,000" = "1000", "0.50" = "0.5"; but "3.0" stays distinct from "3".
const norm = value => value.replace(/[−]/gu, '-').replace(/,(?=\d{3}(?:\D|$))/gu, '').replace(/^-/u, '')
  .replace(/^(\d+)\.(\d*?)0+$/u, (_, whole, fraction) => `${whole}.${fraction || '0'}`);
const numbersIn = text => (String(text || '').match(NUMBER) || []).map(norm);
const isLabel = value => value.replace(/\D/gu, '').length < 2 || /^0\d$/u.test(value);

export function allowedNumbers(project) {
  const allowed = new Set();
  const add = text => numbersIn(text).forEach(value => allowed.add(value));
  add(project.source?.text); add(project.prompt); add(project.deckTitle?.raw);
  for (const segment of project.source?.segments || []) add(segment.text);
  for (const spec of project.templateFidelity?.slides || []) for (const node of spec.nodes || []) add(nodeContentText(node));
  return allowed;
}

export function inspectSourceNumbers(project, slides = project.deck?.slides || []) {
  if (!project.source?.text && !project.source?.segments?.length) return [];
  const allowed = allowedNumbers(project), strict = effectiveKnowledge(project) === 'source_only';
  const issues = [];
  slides.forEach((slide, index) => {
    const found = new Map();
    for (const node of visibleNodes(slide)) {
      if (['page-number', 'slide-number'].includes(node.semanticRole)) continue;
      for (const value of numbersIn(nodeContentText(node))) if (!isLabel(value) && !allowed.has(value)) found.set(value, node.id);
    }
    if (!found.size) return;
    issues.push({ code: 'source_number_unsupported', severity: strict ? 'error' : 'warning', slideId: slide.id, nodeIds: [...new Set(found.values())],
      values: [...found.keys()].slice(0, 12), repairable: true, index,
      message: `Numbers not found in the input: ${[...found.keys()].slice(0, 8).join(', ')}. Use the input's values, or mark an illustration explicitly (bounded explanation only).` });
  });
  return issues;
}

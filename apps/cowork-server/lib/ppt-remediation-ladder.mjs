/** Capacity remediation ladder (F3 of the capacity/remediation fixture plan).
 * One place defines the order of fixes for a page that does not fit, and the
 * rules each fix must respect:
 *   1. relayout  - another layout/template page of the same style; no font or
 *                  content change;
 *   2. shrink    - smaller type, never below the readable floor (a native
 *                  template keeps its own size);
 *   3. continue  - continuation pages, only within the authorized page count;
 *   4. compress  - shorter wording, only when editorial selection is allowed,
 *                  keeping numbers, units, years and citations;
 *   5. suggest_template - a higher-capacity template is suggested to the
 *                  user, never switched automatically.
 * The ladder decides and validates; it does not itself call a model. */
import { LAYOUTS } from './ppt-layout.mjs';
import { allowsEditorialSelection } from './ppt-generation-policy.mjs';

export const LADDER = Object.freeze(['relayout', 'shrink', 'continue', 'compress', 'suggest_template']);
const invalid = (message, details = {}) => Object.assign(new Error(message), { code: 'remediation_invalid', outlineContract: true, details });

/** Readable body floor for a page: a native template keeps its own size;
 * otherwise the layout's declared minimum body size. */
export function readableFloorPt({ layoutId, native = false, nativeBaselinePt } = {}) {
  if (native && Number.isFinite(nativeBaselinePt)) return nativeBaselinePt;
  return LAYOUTS[layoutId]?.minBodyPt ?? 14;
}

/** Facts that compression may not drop: numbers with units/percent, years and citations. */
export function mustKeepTokens(text = '') {
  const found = String(text).match(/\b(?:1[89]|20)\d{2}\b|\d+(?:[.,]\d+)?\s*(?:%|bps|bp|x|pp|万|亿|倍|个百分点)|\[\d+(?:[,–-]\d+)*\]|\b[A-Z][a-z]+(?:\s(?:&|and)\s[A-Z][a-z]+)?(?:\set al\.)?\s\(\d{4}\)/gu) || [];
  return [...new Set(found.map(token => token.replace(/\s+/gu, ' ').trim()))];
}

/** Next rung for a page that still does not fit, given what was already tried. */
export function nextRemediation(state = {}) {
  const tried = new Set(state.tried || []);
  const floor = readableFloorPt(state);
  const font = Number(state.fontSizePt);
  const canContinue = state.pagesAuthorized !== undefined && Number(state.pages) < Number(state.pagesAuthorized) && Number(state.continuations || 0) < 2;
  const candidates = [
    ['relayout', state.alternativeLayouts !== false],
    ['shrink', !state.native && Number.isFinite(font) && font > floor],
    ['continue', canContinue],
    ['compress', Boolean(state.editorialSelection)],
    ['suggest_template', true],
  ];
  const [rung] = candidates.find(([name, allowed]) => allowed && !tried.has(name)) || ['suggest_template'];
  return { rung, automatic: rung !== 'suggest_template', floorPt: floor };
}

const ids = slides => [...new Set(slides.flatMap(slide => slide.sourceUnitIds || []))].sort();
const texts = slides => slides.map(slide => JSON.stringify((slide.nodes || []).map(node => node.content?.text ?? node.content?.items?.map(i => i.text) ?? null)));

/** Validate one proposed fix against its rung. `before`/`after` are page lists. */
export function assertRemediationStep(rung, { before = [], after = [], fontBefore, fontAfter, floorPt, pagesAuthorized, project, sourceText = '', summaryText = '' } = {}) {
  if (!LADDER.includes(rung)) throw invalid('Unknown remediation rung.', { rung });
  if (rung === 'suggest_template') {
    if (JSON.stringify(after) !== JSON.stringify(before)) throw invalid('A template switch is only suggested to the user; the deck must not change automatically.', { rung });
    return true;
  }
  if (rung === 'compress') {
    if (!allowsEditorialSelection(project || {})) throw invalid('Compression requires an editorial selection policy; full-source content keeps its wording.', { rung });
    const missing = mustKeepTokens(sourceText).filter(token => !String(summaryText).includes(token));
    if (missing.length) throw invalid('Compression dropped numbers, units, years or citations: ' + missing.slice(0, 10).join(', '), { rung, missing });
    return true;
  }
  if (JSON.stringify(ids(after)) !== JSON.stringify(ids(before))) throw invalid(`A ${rung} fix may not add or remove source content.`, { rung, before: ids(before), after: ids(after) });
  if (rung === 'relayout') {
    if (fontAfter !== undefined && fontAfter !== fontBefore) throw invalid('Relayout keeps the type size; shrinking is the next rung.', { rung, fontBefore, fontAfter });
    if (JSON.stringify(texts(after)) !== JSON.stringify(texts(before))) throw invalid('Relayout keeps the wording.', { rung });
    return true;
  }
  if (rung === 'shrink') {
    if (!(fontAfter < fontBefore)) throw invalid('A shrink fix must reduce the type size.', { rung, fontBefore, fontAfter });
    if (fontAfter < floorPt) throw invalid(`Type may not go below the readable floor (${floorPt}pt); continue on a new page instead.`, { rung, fontAfter, floorPt });
    if (JSON.stringify(texts(after)) !== JSON.stringify(texts(before))) throw invalid('Shrinking keeps the wording.', { rung });
    return true;
  }
  if (rung === 'continue') {
    if (after.length <= before.length) throw invalid('A continuation adds pages.', { rung });
    if (Number.isFinite(pagesAuthorized) && after.length > pagesAuthorized) throw invalid(`Continuation exceeds the authorized ${pagesAuthorized} pages.`, { rung, pages: after.length, pagesAuthorized });
    return true;
  }
  return true;
}

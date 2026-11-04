import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';

/** Old template content in a new deck (gap 5, decided with the Fable advisor,
 * 2026-10-23). A template that is a real deck must not leave its own text in
 * the result: a final text equal to an original template text of two or more
 * words (four CJK characters), or carrying a run of six words (twelve CJK
 * characters) from one, is a leak, unless the user kept that object or the new
 * input says the same. Single names and brand words are left to the number
 * check and the inherited-object picker. */
const normal = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
const latinWords = text => text.match(/[a-z0-9][a-z0-9'’.-]*/gu) || [];
const cjkRuns = text => text.match(/\p{Script=Han}+/gu) || [];
const substantial = text => latinWords(text).length >= 2 || cjkRuns(text).join('').length >= 4;
function shingles(text) {
  const set = new Set(), words = latinWords(text);
  for (let i = 0; i + 6 <= words.length; i++) set.add('w:' + words.slice(i, i + 6).join(' '));
  for (const run of cjkRuns(text)) for (let i = 0; i + 12 <= run.length; i++) set.add('c:' + run.slice(i, i + 12));
  return set;
}
const cache = new WeakMap();
function originals(project) {
  const fidelity = project.templateFidelity;
  if (cache.has(fidelity)) return cache.get(fidelity);
  const fixed = new Set(project.templateFixedObjectIds || []);
  const texts = (fidelity?.sourceCatalog || []).flatMap(slide => (slide.nodes || [])
    .filter(node => node.type === 'text' && !fixed.has(node.id) && !node.content?.mustPreserve).map(node => normal(node.content?.text))).filter(Boolean);
  const source = normal(project.source?.text || project.prompt || ''), sourceRuns = shingles(source);
  const value = { whole: new Set(texts.filter(text => substantial(text) && !source.includes(text))),
    runs: new Set(texts.flatMap(text => [...shingles(text)]).filter(run => !sourceRuns.has(run))) };
  cache.set(fidelity, value);
  return value;
}
const applies = project => project.templateFidelity?.mode === 'preserve' && ['design_only', 'keep_fixed'].includes(project.templateContentMode);

/** The old template text a visible text carries, or null. */
export function templateLeak(project, text) {
  if (!applies(project)) return null;
  const value = normal(text);
  if (!value) return null;
  const known = originals(project);
  if (known.whole.has(value)) return value;
  for (const run of shingles(value)) if (known.runs.has(run)) return run.slice(2);
  return null;
}

/** Publish gate over the final visible text of every page. */
export function inspectTemplateLeak(project, slides = project.deck?.slides || []) {
  if (!applies(project)) return [];
  return slides.flatMap(slide => visibleNodes(slide).filter(node => ['text', 'list'].includes(node.type) && !node.content?.mustPreserve &&
    !node.content?.derivedFrom && node.semanticRole !== 'closing-greeting').flatMap(node => {
    const leak = templateLeak(project, nodeContentText(node));
    return leak ? [{ code: 'template_content_leak', severity: 'error', slideId: slide.id, nodeIds: [node.id], repairable: true,
      message: `Old template content is still visible: "${leak.slice(0, 80)}". Replace it with this deck's content or leave the slot out.` }] : [];
  }));
}

/** F-P1-6: terminology lock. Source section headings name the concepts
 * ("5. Genetic Programming for Alpha Mining | 遗传编程与因子挖掘"); the planner
 * and writer receive these names as locked terms so a page never renames a
 * source concept (遗传编程 → 遗传规划). Detection stays in
 * ppt-deck-coherence (`terminology_drift`), which now triggers a local rewrite. */
import { parseSourceHeading } from './ppt-section-eyebrow.mjs';

const HAN = /\p{Script=Han}/u;

function headingsOf(source) {
  const seen = new Set(), out = [];
  for (const item of source?.semantic?.inventory?.items || []) for (const heading of (item.sectionPath || []).slice(1)) if (!seen.has(heading)) { seen.add(heading); out.push(heading); }
  if (!out.length) for (const match of String(source?.text || '').matchAll(/^#{2,4}\s+(.+)$/gmu)) if (!seen.has(match[1])) { seen.add(match[1]); out.push(match[1].trim()); }
  return out;
}

/** [{ number, en, zh, terms }] for headings; terms are the Han names split at connectors. */
export function sourceHeadingTerms(source, limit = 40) {
  return headingsOf(source).map(heading => {
    const { number, names } = parseSourceHeading(heading);
    const zh = names.find(name => HAN.test(name)) || '', en = names.find(name => !HAN.test(name)) || '';
    const terms = [...new Set(zh.split(/[^\p{Script=Han}A-Za-z0-9]|[与與和及的、]/u).map(item => item.trim()).filter(item => [...item].filter(c => HAN.test(c)).length >= 2))];
    return { ...(number ? { number } : {}), ...(en ? { en } : {}), ...(zh ? { zh } : {}), terms };
  }).filter(entry => entry.terms.length || entry.en).slice(0, limit);
}

export function withHeadingTerms(registry, source) {
  const headingTerms = sourceHeadingTerms(source);
  return headingTerms.length ? { ...registry, headingTerms } : registry;
}

/** Planner instruction: locked names, compact. Empty when the source has no headings. */
export function terminologyLockPrompt(source) {
  const entries = sourceHeadingTerms(source);
  if (!entries.some(entry => entry.terms.length)) return '';
  return `<locked_terms>${JSON.stringify(entries.map(({ en, zh }) => [en, zh].filter(Boolean).join(' | ')))}</locked_terms>
来源节标题中的术语是锁定名称：标题、focus、keyPoints 使用这些术语原文，不得换成近义词或另一种译法；需要别名时以括号补充，不替换原词。`;
}

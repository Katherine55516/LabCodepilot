/** Deck-level coherence checks found by the Alpha Mining / Gamma comparison
 * (outputs/ppt-factor-zoo-postmortem-20261009/analysis.md, 2026-10-10 section).
 * Single-page checks cannot see these: a translation pair or a lead-in and its
 * list split across pages, a cover that drops the document title, a generated
 * title that renames a source term, and commentary that only restates the page.
 * All findings are warnings until a real-model baseline calibrates them. */
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { preservesReadingOrder } from './ppt-density-capacity.mjs';

const HAN = /\p{Script=Han}/u;
const hanRuns = text => String(text || '').match(/\p{Script=Han}+/gu) || [];
const bigrams = text => { const s = hanRuns(text).join('|'); const out = new Set(); for (let i = 0; i < s.length - 1; i++) if (s[i] !== '|' && s[i + 1] !== '|') out.add(s.slice(i, i + 2)); return out; };
const words = text => new Set((String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/gu) || []));
const issue = (code, slide, message, extra = {}) => ({ code, severity: 'warning', repairable: true, slideId: slide?.id, message, ...extra });

function sourceUnitsBySlide(slides) {
  const owner = new Map();
  slides.forEach((slide, index) => {
    for (const node of [...(slide.nodes || []), ...(slide.sourceArtifactNodes || [])]) {
      for (const id of [node.sourceArtifact?.sourceUnitId, ...(node.sourceUnitIds || []), ...(node.content?.sourceUnitIds || [])].filter(Boolean))
        if (!owner.has(id)) owner.set(id, index);
    }
  });
  return owner;
}

/** A translation pair, or a lead-in ("You define:") and the list it opens,
 * is one reading unit; showing its halves on different pages breaks it. */
export function inspectRelationGroups(project, slides) {
  const items = project.source?.semantic?.inventory?.items || [], owner = sourceUnitsBySlide(slides), issues = [];
  const pairs = new Map();
  for (const item of items) if (item.languagePairId) pairs.set(item.languagePairId, [...(pairs.get(item.languagePairId) || []), item.id]);
  for (const [pairId, ids] of pairs) {
    const pages = [...new Set(ids.map(id => owner.get(id)).filter(page => page !== undefined))];
    if (ids.length === 2 && pages.length === 2)
      issues.push(issue('relation_pair_split', slides[Math.max(...pages)], `Translation pair ${pairId} is split across pages ${pages.map(p => p + 1).join(' and ')}; keep both languages of one claim on the same page.`, { sourceUnitIds: ids, pages: pages.map(p => p + 1) }));
  }
  items.forEach((item, index) => {
    if (!/[:：]\s*$/u.test(String(item.text || '').trim()) || owner.get(item.id) === undefined) return;
    let next = index + 1;
    while (next < items.length && item.languagePairId && items[next].languagePairId === item.languagePairId) next++;
    while (next < items.length && /[:：]\s*$/u.test(String(items[next].text || '').trim()) && items[next].languagePairId && items[next].languagePairId === items[next - 1]?.languagePairId) next++;
    const target = items[next];
    if (!target || !/^\s*(?:[-*+•]|\d+[.)])\s+/mu.test(String(target.text || '')) || owner.get(target.id) === undefined) return;
    if (owner.get(target.id) !== owner.get(item.id))
      issues.push(issue('relation_leadin_split', slides[owner.get(target.id)], `The lead-in “${String(item.text).trim().slice(-40)}” is on page ${owner.get(item.id) + 1} but its list starts on page ${owner.get(target.id) + 1}.`, { sourceUnitIds: [item.id, target.id] }));
  });
  return issues;
}

/** Multi-column source pages must read down-then-across in source order. */
export function inspectReadingOrder(slides) {
  return slides.filter(slide => slide.sourceArtifactFit?.boxes?.length >= 3 && (slide.sourceArtifactFit.readingOrder ?? preservesReadingOrder(slide.sourceArtifactFit.boxes)) === false)
    .map(slide => issue('layout_reading_order_broken', slide, `Source components are packed by column height (${slide.sourceArtifactFit.layoutId}); the visual order no longer follows the source. Regroup the page or split it so a reading-order layout fits.`));
}

/** The source document title (first level-1 heading, bilingual "A | B" kept as
 * variants) should be visible on the cover; a template without a subtitle slot
 * is reported, not silently truncated. */
export function sourceDocumentTitle(project) {
  const text = String(project.source?.text || '');
  const heading = text.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  if (!heading) return null;
  const variants = heading.split(/\s+\|\s+/u).map(value => {
    const plain = value.replace(/[*_`]/gu, '').trim();
    const [main, ...rest] = plain.split(/[:：]\s*/u);
    return { text: plain, main: main.replace(/^(?:tutorial|lesson|chapter|part|教程|第)\s*[\w\d]+\s*[—–-]\s*/iu, '').trim(), subtitle: rest.join(': ').trim() };
  });
  return { heading, variants };
}
/** An explicitly single-language overview keeps the other original title in
 * the complete notes archive instead of forcing bilingual cover reproduction. */
export function displayedDocumentTitle(project){
  const title=sourceDocumentTitle(project),policy=project.generationPolicy;
  if(!title||policy?.content!=='overview'||policy.details!=='notes'||policy.language?.mode!=='output')return title;
  const variants=title.variants.filter(v=>policy.language.locale==='en'?!/\p{Script=Han}/u.test(v.text):/\p{Script=Han}/u.test(v.text));
  return variants.length?{...title,variants}:title;
}
export function inspectCoverTitle(project, slides) {
  const title = displayedDocumentTitle(project), cover = slides[0];
  if (!title || !cover || project.deckTitle?.source === 'user') return [];
  const visible = visibleNodes(cover).map(nodeContentText).join('\n') + '\n' + (cover.title || '');
  const norm = value => String(value).normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  const missing = [];
  for (const variant of title.variants) {
    if (variant.main && !norm(visible).includes(norm(variant.main))) missing.push(variant.main);
    if (variant.subtitle && !norm(visible).includes(norm(variant.subtitle))) missing.push(variant.subtitle);
  }
  return missing.length ? [issue('cover_source_title_incomplete', cover, `The cover omits parts of the source title: ${missing.join(' / ')}. Use the template subtitle region or a measured subtitle line; do not shorten the document title silently.`, { missing })] : [];
}

/** Flag known technical-name substitutions against the page's source heading.
 * A shared two-character prefix alone does not establish a terminology error;
 * other changes of name or scope are evaluated by the semantic critic. */
export function inspectTerminology(project, slides) {
  const items = new Map((project.source?.semantic?.inventory?.items || []).map(item => [item.id, item]));
  const sourceText = String(project.source?.text || ''), FUNCTION = /[的了是有在把被会會由或没沒和与與及也就都而且将將对對从從这這那]/u;
  // Source terms: complete four-character heading segments (split at connectors).
  const termsOf = slide => { const terms = new Set();
    for (const node of slide.nodes || []) for (const heading of items.get(node.sourceArtifact?.sourceUnitId)?.sectionPath || [])
      for (const segment of String(heading).split(/[^\p{Script=Han}]|[与與和及的、]/u)) if (segment.length === 4) terms.add(segment);
    return terms; };
  const generatedOf = slide => [slide.title, ...visibleNodes(slide).filter(node => !node.sourceArtifact && node.semanticRole !== 'page-number').map(nodeContentText)].join('\n');
  const deckGenerated = slides.map(generatedOf).join('\n'), issues = [];
  for (const slide of slides) {
    const terms = termsOf(slide);
    if (!terms.size) continue;
    const drift = new Map();
    for (const run of hanRuns(generatedOf(slide))) for (let i = 0; i + 4 <= run.length; i++) {
      const gram = run.slice(i, i + 4);
      if (sourceText.includes(gram) || FUNCTION.test(gram)) continue;
      const repeated = deckGenerated.split(gram).length - 1 >= 2 || String(slide.title || '').includes(gram);
      const term = [...terms].find(value => value !== gram && value.slice(0, 2) === gram.slice(0, 2));
      const aliases={'遗传编程':['遗传规划','遗传程序'],'遺傳編程':['遺傳規劃','遺傳程序']};
      // Shared prefixes do not prove a renamed technical concept: 挖掘过程
      // and 挖掘能力 can coexist; 算子库作为 is a sentence, not a term.
      // Explicit known name substitutions are actionable; other scope/name
      // changes remain the semantic critic's responsibility.
      if (term && repeated && aliases[term]?.includes(gram)) drift.set(gram, term);
    }
    for (const [used, term] of drift) issues.push(issue('terminology_drift', slide, `“${used}” renames the source term “${term}” used in this section's heading; keep the source terminology.`, { used, sourceTerm: term }));
  }
  return issues;
}

/** Commentary should add a mechanism, condition or implication. When nearly
 * all of it is already in the page's own source text, it is restatement. */
export function inspectExplanationNovelty(project, slides) {
  const issues = [];
  for (const slide of slides) {
    const nodes = visibleNodes(slide), source = nodes.filter(node => node.sourceArtifact).map(nodeContentText).join('\n');
    if (!source) continue;
    const sourceBigrams = bigrams(source), sourceWords = words(source);
    for (const node of nodes.filter(node => node.semanticRole === 'source-explanation')) {
      const text = nodeContentText(node), cjk = HAN.test(text);
      const units = cjk ? bigrams(text) : words(text), known = cjk ? sourceBigrams : sourceWords;
      if (units.size < (cjk ? 30 : 15)) continue;
      const covered = [...units].filter(unit => known.has(unit)).length / units.size;
      if (covered >= .72) issues.push(issue('explanation_restates_source', slide, `About ${Math.round(covered * 100)}% of this commentary repeats the page's own source text; add a mechanism, condition or consequence, or leave the space to the source.`, { nodeIds: [node.id], coverage: Number(covered.toFixed(2)) }));
    }
  }
  return issues;
}

/** Bilingual source preserved in both languages, but titles in one: the deck
 * reads as two languages under a monolingual navigation. */
export function inspectTitleLanguage(project, slides) {
  const items = project.source?.semantic?.inventory?.items || [];
  const paired = items.filter(item => item.languagePairId).length;
  if (project.generationPolicy?.language?.mode === 'output' || paired < Math.max(4, items.length * .3)) return [];
  const content = slides.slice(1).filter(slide => slide.title);
  const mixed = content.filter(slide => HAN.test(slide.title) && /[A-Za-z]{3,}/u.test(slide.title.replace(/\b(?:IC|ICIR|LLM|GP|RL|PBO|SPA|ST|alpha|Alpha\d*|WorldQuant|A)\b/gu, '')));
  const cjkOnly = content.filter(slide => HAN.test(slide.title)).length, latinOnly = content.length - cjkOnly;
  // F-P1-5: a recorded policy (primary-language titles, other language in the
  // bilingual eyebrow) is deliberate; only titles off that language are reported.
  if (project.titlePolicy?.otherLanguage === 'eyebrow') {
    const off = content.filter(slide => project.titlePolicy.primary === 'zh' ? !HAN.test(slide.title) : HAN.test(slide.title));
    return off.length ? [issue('title_language_inconsistent', off[0], `${off.length} title(s) leave the deck's ${project.titlePolicy.primary} title language; the other language belongs in the bilingual eyebrow.`, { off: off.map(slide => slide.id), policy: project.titlePolicy })] : [];
  }
  if (content.length < 4 || mixed.length >= content.length * .5) return [];
  return [issue('title_language_inconsistent', content[0], `Body text keeps both source languages, but ${Math.max(cjkOnly, latinOnly)}/${content.length} titles use one language. Keep titles bilingual (e.g. “English | 中文”) or record a deliberate single-language title policy.`, { cjkOnly, latinOnly, bilingual: mixed.length })];
}

/** Wrapped code without a hanging indent (fits made before F-P1-9) restarts
 * at the left edge and loses its indentation. */
export function inspectCodeWrap(slides) {
  return slides.filter(slide => slide.sourceArtifactFit?.codeWraps > 0 && !slide.sourceArtifactFit.codeHangingIndent).map(slide => issue('code_line_wrapped', slide,
    `${slide.sourceArtifactFit.codeWraps} code line(s) wrap in ${slide.sourceArtifactFit.layoutId}; give the code block the full width (move commentary) or present it with disclosure instead of breaking indentation.`));
}

export function inspectDeckCoherence(project, slides = project.deck?.slides || []) {
  return [...inspectRelationGroups(project, slides), ...inspectReadingOrder(slides), ...inspectCodeWrap(slides), ...inspectCoverTitle(project, slides),
    ...inspectTerminology(project, slides), ...inspectExplanationNovelty(project, slides), ...inspectTitleLanguage(project, slides)];
}

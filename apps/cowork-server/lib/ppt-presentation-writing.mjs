/**
 * Deterministic presentation-writing helpers. These are deliberately pure:
 * the existing outline/content/quality DAG owns when they run, while this
 * module owns copy contracts, title fitting, and source-grounded diagnostics.
 */
import { pointBudgetFor } from './ppt-content-depth.mjs';
const CJK = /[\u2e80-\u9fff\uf900-\ufaff]/u;
const WORD = /[A-Za-z][A-Za-z0-9_/-]*/g;
const HAN = /[\u3400-\u9fff]/gu;

const ROLE_SUPPORT = Object.freeze({
  architecture: ['definition', 'mechanism', 'implication'],
  framework: ['definition', 'mechanism', 'implication'],
  process: ['mechanism', 'implication'],
  comparison: ['contrast', 'implication'],
  problem: ['evidence', 'implication'],
  evidence: ['evidence', 'implication'],
  metric: ['evidence', 'implication'],
  timeline: ['decision', 'next_step'],
  roadmap: ['decision', 'next_step'],
  recommendation: ['decision', 'implication'],
  system: ['mechanism', 'constraint', 'implication'],
  runtime: ['mechanism', 'constraint', 'implication'],
  mechanism: ['mechanism', 'implication'],
  decision: ['contrast', 'decision'],
});

const GENERIC_TERMS = [
  'Presentation Studio', 'Artifact Intent Router', 'Intent Router', 'Deck Brief',
  'Story Planner', 'Presentation IR', 'Layout Engine', 'Theme Engine',
  'Media Engine', 'Render Tree', 'Structured Artifact Engine', 'PPTX Export',
];

function text(value, max = 240) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function unique(values, max = 12) { return [...new Set((Array.isArray(values) ? values : []).map(value => text(value)).filter(Boolean))].slice(0, max); }
function words(value) { return new Set((String(value || '').toLocaleLowerCase().match(WORD) || []).map(item => item.toLocaleLowerCase())); }
function han(value) { return new Set(String(value || '').match(HAN) || []); }

export function normalizeTypography(value, max = 240) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    // Underscores are part of code/math identifiers (ts_mean, raw_group).
    // Strip surrounding Markdown emphasis only when it is delimited by
    // whitespace or punctuation; never flatten an identifier.
    // Remove paired Markdown emphasis, but keep single * as multiplication in
    // source formulas. Deleting every asterisk silently changes the claim.
    .replace(/\*{2,3}([^*\n]+)\*{2,3}/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`/g, '')
    .replace(/(^|[\s(])_{1,2}([^_\n]+?)_{1,2}(?=$|[\s).,;:])/g, '$1$2')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2')
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
    .replace(/\s*→\s*/g, ' → ')
    .replace(/(?<!\+)\s*\+\s*(?!\+)/g, ' + ')
    .replace(/(?<![:/])\s*\/\s*(?!\/)/g, ' / ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*([，。；：！？、])\s*/gu, '$1')
    .trim()
    .slice(0, max);
}

export function visualUnits(value) {
  let units = 0;
  for (const char of String(value || '')) {
    if (CJK.test(char)) units += 1;
    else if (/[A-Z]/.test(char)) units += .72;
    else if (/[a-z]/.test(char)) units += .58;
    else if (/\d/.test(char)) units += .58;
    else if (/\s/.test(char)) units += .32;
    else units += .42;
  }
  return Math.round(units * 100) / 100;
}

export function normalizeHeadline(value, registry = {}) {
  let title = normalizeTypography(value, 240)
    .replace(/^[\s#>*•\-–—]+/gu, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。；：！？、])/gu, '$1')
    .replace(/([，。；：！？、])\s*/gu, '$1')
    .trim();
  // Preserve known technical terms exactly. We never insert a line break, so
  // the renderer can treat these phrases as non-breaking semantic units.
  for (const term of registry.protectedPhrases || []) {
    if (!term) continue;
    const loose = term.replace(/\s+/g, '\\s+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(loose, 'gi'), term);
  }
  return title.slice(0, 160);
}

function splitTitleAtBoundary(value, preferredUnits) {
  const chars = [...value];
  let units = 0;
  const candidates = [];
  for (let index = 0; index < chars.length - 1; index++) {
    units += visualUnits(chars[index]);
    if (/[,，:：;；。!?！？/]/u.test(chars[index]) || /\s/u.test(chars[index]) || /[与和及]/u.test(chars[index + 1])) {
      candidates.push({ index: index + 1, distance: Math.abs(preferredUnits - units) });
    }
  }
  const boundary = candidates.sort((a, b) => a.distance - b.distance || a.index - b.index)[0]?.index;
  const index = boundary || Math.max(1, Math.min(chars.length - 1, Math.round(chars.length / 2)));
  return `${chars.slice(0, index).join('').trim()}\n${chars.slice(index).join('').trim()}`;
}

/** Preserve user title words exactly. Only controls, surrounding whitespace and
 * a single visual line break may change. */
export function formatUserDeckTitle(value, budget = copyBudgetFor('cover', 'cover')) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n').map(line => line.trim().replace(/[ \t]+/g, ' ')).filter(Boolean).join(' ')
    .trim().slice(0, 160);
  const units = visualUnits(normalized);
  const title = units > budget.titlePreferredUnits ? splitTitleAtBoundary(normalized, units / 2) : normalized;
  const lines = title ? title.split('\n').length : 1;
  const lineUnits = title.split('\n').map(visualUnits);
  const maxLineUnits = Math.max(0, ...lineUnits);
  return {
    title, source: 'user', locked: true, visualUnits: units,
    maxVisualUnits: budget.titlePreferredUnits * budget.titleMaxLines,
    estimatedLines: lines, maxLineUnits,
    fits: lines <= budget.titleMaxLines && maxLineUnits <= budget.titleHardUnits,
  };
}

export function titleFidelityValue(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f\s]/g, '');
}

export function compileSectionLabel(value) {
  const source = normalizeHeadline(value).replace(/^[第\d一二三四五六七八九十]+[章节部分篇]\s*/u, '');
  const latinWords = source.match(/[A-Za-z][A-Za-z0-9-]*/g) || [];
  const preferredUnits = latinWords.length ? 18 : 12;
  const hardUnits = latinWords.length ? 24 : 16;
  if (visualUnits(source) <= preferredUnits) return source;
  const candidates = source.split(/[：:；;，,。!?！？—–|]|并(?:实现|支持|完成)|以及|并且/u).map(item => item.trim()).filter(Boolean);
  const short = candidates.find(item => visualUnits(item) >= 4 && visualUnits(item) <= hardUnits);
  const selected = short || candidates[0] || source;
  if (visualUnits(selected) <= hardUnits) return selected;
  const words = selected.split(/\s+/u);
  let result = '';
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (visualUnits(next) > hardUnits) break;
    result = next;
  }
  return result || [...selected].slice(0, hardUnits).join('');
}

export function buildTerminologyRegistry(source, outline = []) {
  const corpus = `${source?.text || ''}\n${outline.map(item => `${item.title || ''} ${item.focus || ''}`).join('\n')}`;
  const protectedPhrases = [...GENERIC_TERMS.filter(term => corpus.toLocaleLowerCase().includes(term.toLocaleLowerCase()))];
  const seen = new Set(protectedPhrases.map(term => term.toLocaleLowerCase()));
  const matches = corpus.match(/\b(?:[A-Z][A-Za-z0-9-]*)(?:\s+[A-Z][A-Za-z0-9-]*){1,3}\b/g) || [];
  for (const term of matches) {
    const normalized = term.trim();
    if (normalized.length > 48 || seen.has(normalized.toLocaleLowerCase())) continue;
    seen.add(normalized.toLocaleLowerCase()); protectedPhrases.push(normalized);
    if (protectedPhrases.length >= 24) break;
  }
  const canonicalTerms = {};
  if (/Presentation Intermediate Representation/i.test(corpus)) canonicalTerms['Presentation Intermediate Representation'] = 'Presentation IR';
  if (/Artifact Intent Router/i.test(corpus)) canonicalTerms['Artifact Intent Router'] = 'Intent Router';
  return { version: 1, protectedPhrases, canonicalTerms };
}

export function requiredSupportFor(role, depth = 'balanced', supportingPoints = []) {
  const aliases = { claim: 'main_claim', mainclaim: 'main_claim', mechanism: 'mechanism', evidence: 'evidence', example: 'example',
    definition: 'definition', contrast: 'contrast', constraint: 'constraint', tradeoff: 'tradeoff', implication: 'implication',
    impact: 'implication', decision: 'decision', risk: 'risk', nextstep: 'next_step', next_step: 'next_step' };
  const explicit = unique(supportingPoints, 6).map(value => aliases[value.toLocaleLowerCase().replace(/[\s-]+/g, '')] || null).filter(Boolean);
  // Existing supportingPoints are source topics, not support-type labels. Only
  // an explicit canonical support type can override the role contract.
  if (explicit.length) return unique(['main_claim', ...explicit], 6);
  if (depth === 'concise') return ['main_claim', 'support'];
  const required = ROLE_SUPPORT[role] || ['mechanism', 'implication'];
  return depth === 'detailed' ? ['main_claim', ...required] : ['main_claim', required[0] || 'support'];
}

export function copyBudgetFor(role, layoutId, language) {
  const cover = role === 'cover' || layoutId === 'cover';
  const section = role === 'section';
  return {
    titlePreferredUnits: cover ? 26 : section ? 18 : 28,
    titleHardUnits: cover ? 32 : section ? 24 : language === 'en' ? 44 : 36,
    titleMaxLines: section ? 1 : 2,
    titleMinPt: cover ? 38 : 32,
    bodyUnits: layoutId === 'comparison' ? 600 : layoutId === 'timeline' ? 500 : 750,
    maxSupportUnits: layoutId === 'comparison' ? 6 : 8,
  };
}

function overlap(a, b) {
  const first = words(a); const second = words(b); const firstHan = han(a); const secondHan = han(b);
  const common = [...first].filter(item => second.has(item)).length + [...firstHan].filter(item => secondHan.has(item)).length;
  const total = new Set([...first, ...second, ...firstHan, ...secondHan]).size;
  return total ? common / total : 0;
}

function candidateScore(candidate, message, previousTitles, budget) {
  const units = visualUnits(candidate);
  const fidelity = overlap(candidate, message);
  const brevity = Math.max(0, 1 - Math.max(0, units - budget.titlePreferredUnits) / Math.max(1, budget.titleHardUnits));
  const novelty = previousTitles.length ? 1 - Math.max(...previousTitles.map(item => overlap(candidate, item))) : 1;
  const fit = units <= budget.titleHardUnits ? 1 : Math.max(0, 1 - (units - budget.titleHardUnits) / 24);
  return .35 * fidelity + .25 * brevity + .20 * novelty + .20 * fit;
}

function compactCandidates(value) {
  const source = normalizeHeadline(value);
  if (!source) return [];
  const parts = source.split(/[：；。！？]/u).map(item => item.trim()).filter(Boolean);
  const candidates = [source, ...parts];
  const compressed = source
    .replace(/^(当前|本页|系统|该|这个)(?:的)?/u, '')
    .replace(/(各自)?承担确定性职责$/u, '实现确定性交付')
    .replace(/先固定[^，。；]*和/u, '先定')
    .replace(/决定何时进入/gu, '决定是否进入')
    .trim();
  if (compressed && compressed !== source) candidates.push(compressed);
  return unique(candidates, 8);
}

export function compileTitle({ title, candidates = [], message = '', registry = {}, previousTitles = [], budget = copyBudgetFor() }) {
  // The writer's selected title is the primary signal. The plan message is a
  // fallback for overflow repair, not a replacement that can make every page
  // inherit the same generic focus sentence.
  const explicitTitle = normalizeHeadline(title, registry);
  const explicitUnits = visualUnits(explicitTitle);
  if (explicitTitle && explicitUnits <= budget.titleHardUnits) return {
    title: explicitTitle, candidates: [{ value: explicitTitle, units: explicitUnits, score: 1 }],
    visualUnits: explicitUnits, maxVisualUnits: budget.titleHardUnits,
    estimatedLines: Math.max(1, Math.ceil(explicitUnits / Math.max(1, budget.titlePreferredUnits))), fits: true,
  };
  const raw = [
    ...((Array.isArray(candidates) ? candidates : []).flatMap(compactCandidates).map(value => ({ value, preference: .35 }))),
    ...compactCandidates(title).map(value => ({ value, preference: .6 })),
    ...compactCandidates(message).map(value => ({ value, preference: 0 })),
  ];
  const byValue = new Map();
  for (const item of raw) {
    const value = normalizeHeadline(item.value, registry);
    if (value && (!byValue.has(value) || byValue.get(value) < item.preference)) byValue.set(value, item.preference);
  }
  const ranked = [...byValue.entries()].slice(0, 12).map(([value, preference]) => ({ value, preference, units: visualUnits(value), score: candidateScore(value, message || title, previousTitles, budget) + preference }))
    .sort((a, b) => b.score - a.score || a.units - b.units || a.value.localeCompare(b.value));
  const fitting = ranked.filter(item => item.units <= budget.titleHardUnits);
  const explicit = fitting.find(item => item.preference >= .6);
  const conciseCandidate = fitting.find(item => item.preference === .35 && item.units <= budget.titlePreferredUnits);
  const best = (explicit && conciseCandidate && (explicit.units > budget.titlePreferredUnits || explicit.units > conciseCandidate.units * 1.35) ? conciseCandidate : fitting[0]) || ranked[0]
    || { value: normalizeHeadline(title, registry), units: visualUnits(title), score: 0 };
  return {
    title: best.value,
    candidates: ranked.slice(0, 5),
    visualUnits: best.units,
    maxVisualUnits: budget.titleHardUnits,
    estimatedLines: Math.max(1, Math.ceil(best.units / Math.max(1, budget.titlePreferredUnits))),
    fits: best.units <= budget.titleHardUnits,
  };
}

const BLOCK_TYPES = new Set(['definition', 'mechanism', 'evidence', 'example', 'contrast', 'constraint', 'tradeoff', 'impact', 'implication', 'decision', 'risk', 'next_step', 'stage', 'runtime']);
export function normalizeContentBlocks(value, maxBody = 4000) {
  if (!Array.isArray(value)) return [];
  if (value.length > 10) throw new Error('contentBlocks exceeds 10 points; redistribute across pages');
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const type = BLOCK_TYPES.has(item.type) ? item.type : 'support';
    const heading = normalizeTypography(text(item.heading || item.label, 48), 48);
    const sourceBody = String(item.body || item.text || item.description || '').trim();
    if (sourceBody.length > maxBody) throw new Error(`point body exceeds ${maxBody} characters; split it before rendering`);
    const body = normalizeTypography(sourceBody, maxBody);
    if (!body) return null;
    return { type, heading, body };
  }).filter(Boolean);
}

export function materializeCopy(value, outlineSlide, planning, previousTitles = []) {
  const contract = planning?.slidePlan?.find(item => item.slideId === outlineSlide.id) || {};
  const registry = planning?.terminology || { protectedPhrases: [] };
  const budget = contract.copyBudget || copyBudgetFor(contract.role, value.layoutId);
  const title = compileTitle({ title: value.title, candidates: value.titleCandidates || value.title_candidates, message: contract.message || outlineSlide.focus, registry, previousTitles, budget });
  const blocks = normalizeContentBlocks(value.contentBlocks || value.content_blocks, value.nativeCopy ? 5000 : 4000);
  const bullets = blocks.length
    ? blocks.map(block => normalizeTypography(block.heading ? `${block.heading}\n${block.body}` : block.body, value.nativeCopy ? 5200 : 4200))
    : (Array.isArray(value.bullets) ? value.bullets.map(item => {
      if (typeof item !== 'string' || item.length > 4000) throw new Error('bullet exceeds 4000 characters; split it before rendering');
      return normalizeTypography(item, 4000);
    }).filter(Boolean) : []);
  const takeaway = normalizeTypography(text(value.takeaway, 300), 300);
  const duplicateTakeaway = takeaway && [title.title, value.subtitle, ...bullets, ...blocks.flatMap(block => [block.heading, block.body])]
    .some(item => overlap(takeaway, item) >= .72);
  return {
    title,
    bullets,
    copy: {
      eyebrow: normalizeTypography(text(value.eyebrow, 48), 48), subtitle: normalizeTypography(text(value.subtitle || value.subhead, 180), 180),
      takeaway: duplicateTakeaway ? '' : takeaway, blocks,
      role: contract.role || outlineSlide.role || 'evidence', depth: contract.depth || planning?.brief?.depth || 'balanced',
      density: contract.density || 'medium', distributionType: contract.distributionType || 'four_medium_cards',
      pointLengthProfile: contract.pointLengthProfile || 'standard', semanticUnitBudget: contract.semanticUnitBudget || budget.maxSupportUnits,
      requiredSupport: contract.requiredSupport || [], requiredDetails: contract.requiredDetails || [], copyBudget: budget,
    },
  };
}

/** Native slot geometry and native body QA must use the same unit scale. */
export function templateVisualUnits(value) {
  return [...String(value || '')].reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 1 : .55), 0);
}

/** Visible body budget uses native geometry, never the amount of old copy. */
export function visibleBodyTarget(capacity, depth) {
  return Math.min(Math.max(0, Number(capacity || 0)) * .48, depth === 'detailed' ? 440 : 330);
}

function availableSupport(slide, visibleOnly = false) {
  const found = new Set(['main_claim']);
  const synthesis = slide.factSynthesis || {};
  if (!visibleOnly) {
    if ((synthesis.mechanisms || synthesis.relationships || []).length) found.add('mechanism');
    if ((synthesis.facts || synthesis.numbers || []).length) { found.add('evidence'); found.add('definition'); }
    if ((synthesis.examples || []).length) found.add('example');
    if ((synthesis.limitations || synthesis.constraints || []).length) { found.add('constraint'); found.add('tradeoff'); }
    if ((synthesis.implications || []).length) found.add('implication');
  }
  for (const block of slide.copy?.blocks || []) {
    found.add(block.type);
    if (block.type === 'impact') found.add('implication');
    if (block.type === 'runtime') found.add('mechanism');
  }
  if (slide.copy?.takeaway && (!visibleOnly || (slide.nodes || []).some(node => node.nativeRef &&
    String(node.content?.text || '').includes(slide.copy.takeaway)))) found.add('implication');
  return found;
}

export function inspectSlideCopy(slide, contract, index, count, options = {}) {
  if (index === 0 || index === count - 1) return [];
  const issues = [];
  const title = slide.titleQuality || { visualUnits: visualUnits(slide.title), maxVisualUnits: contract?.copyBudget?.titleHardUnits || 46, estimatedLines: Math.ceil(visualUnits(slide.title) / 24) };
  if (title.visualUnits > title.maxVisualUnits || title.estimatedLines > 2) issues.push({ code: 'title_overflow', severity: 'error', repair: 'rewrite_title', message: '标题超过两行或版式宽度上限' });
  const support = availableSupport(slide, options.templatePreserved);
  const missing = contract?.depth === 'detailed'
    ? (contract?.requiredSupport || []).filter(item => item !== 'main_claim' && !support.has(item)) : [];
  if (missing.length) issues.push({ code: 'under_expanded', severity: 'warning', repair: 'expand_support', message: `详细内容页缺少：${missing.join('、')}`, missingSupport: missing });
  const supportUnits = (slide.copy?.blocks || []).length || (slide.bullets || []).length;
  const pointBudget = contract?.pointBudget || pointBudgetFor(contract?.pointLengthProfile, contract?.role, contract?.density, contract?.distributionType);
  const minimum = Math.min(pointBudget.preferredCount[0], contract?.semanticUnitBudget || pointBudget.preferredCount[0]);
  if (!options.templatePreserved && contract?.depth === 'detailed' && supportUnits < minimum) issues.push({ code: 'content_density', severity: 'warning', repair: 'expand_support', message: `本页语义单元少于密度规划要求（${minimum}）` });
  const lengths = (slide.copy?.blocks || []).map(block => visualUnits(block.body));
  if (options.templatePreserved && lengths.filter(length => length < 8).length >= 2)
    issues.push({ code: 'content_block_shallow', severity: 'warning', repair: 'expand_support',
      message: '多个内容块只有标签或残短说明；应把来源中的机制、条件或例子实际写入可见模板槽位' });
  const profile = contract?.pointLengthProfile || 'standard';
  if (!options.templatePreserved && lengths.length && lengths.every(length => length < pointBudget.min * .75) && contract?.depth === 'detailed') issues.push({ code: 'point_under_expanded', severity: 'warning', repair: 'expand_support', message: `本页 ${profile} 内容块说明过短` });
  if (!options.templatePreserved && lengths.some(length => length > pointBudget.max)) issues.push({ code: 'point_too_long', severity: 'warning', repair: 'redistribute', message: `本页 ${profile} 内容块说明超过 ${pointBudget.max} 个视觉字，应拆分或改用适合的分布` });
  if (!options.templatePreserved && profile === 'mixed' && contract?.depth === 'detailed' && lengths.length >= 3) {
    const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
    const spread = Math.sqrt(lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) / lengths.length) / Math.max(1, average);
    if (average >= 20 && spread < .15) issues.push({ code: 'point_distribution_flat', severity: 'warning', repair: 'redistribute',
      message: '混合篇幅页面的各点长度几乎相同；应按论证作用保留长解释和短支撑的节奏' });
  }
  return issues;
}

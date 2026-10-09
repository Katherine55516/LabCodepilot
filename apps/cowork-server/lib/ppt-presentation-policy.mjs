/** Presentation policies decide what reaches slides, never what the source
 * says. Every policy-driven omission or merge is recorded on the inventory item
 * and disclosed through planningAssumptions(); nothing is dropped silently.
 * Plan: docs/exec-plans/active/ppt-general-content-media-balance.md (Phase 1). */

const BOX_CHARS = /[┌┐└┘├┤┬┴┼│─═║╔╗╚╝]/u;
const PROGRAM_SYNTAX = /^\s*(?:def |class |import |from \S+ import |return\b|for\b.+\bin\b.+:|while\b.+:|if\b.+:|elif\b|else:|try:|except\b|with\b.+:|@\w|function\b|const |let |var |#include|public |private |SELECT\b|INSERT\b|UPDATE\b)|^\s*[A-Za-z_][\w.[\]'"]*\s*=\s*\S/mu;

/** A fenced block drawn with box characters and no program syntax is a
 * diagram (a process), not code. */
export function isAsciiDiagram(text) {
  const lines = String(text || '').split('\n').filter(line => line.trim());
  if (lines.length < 3 || PROGRAM_SYNTAX.test(text)) return false;
  const drawn = lines.filter(line => BOX_CHARS.test(line) || /^\s*[▼▲↓↑→⇒]\s*$/u.test(line)).length;
  return drawn / lines.length >= .5;
}

/** Box labels (left of the right border) become step labels; text after the
 * box becomes the step note; free text below the last box is a final step. */
export function asciiDiagramSteps(text) {
  const boxes = []; const tail = []; let box = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\s+$/u, '');
    if (/^\s*┌/u.test(line)) { box = { label: [], note: [] }; continue; }
    if (/^\s*└/u.test(line)) { if (box && (box.label.length || box.note.length)) boxes.push(box); box = null; continue; }
    if (box) {
      const match = line.match(/^\s*[│║](.*?)[│║](.*)$/u);
      if (match) { if (match[1].trim()) box.label.push(match[1].trim()); if (match[2].trim()) box.note.push(match[2].trim()); }
      continue;
    }
    const free = line.replace(/[▼▲↓↑│─┬┴]/gu, '').trim();
    if (free) tail.push(free);
  }
  if (boxes.length < 2) return null;
  return [...boxes.map(item => ({ label: item.label.join(' ').replace(/\s+/gu, ' '), note: item.note.join(' ').replace(/\s+/gu, ' ') })),
    ...tail.map(label => ({ label, note: '' }))];
}

export function isMermaidFlow(text, language = '') {
  return /^mermaid$/iu.test(String(language).trim()) && /^\s*(?:flowchart|graph)\b/iu.test(String(text || ''))
    || /^\s*(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b/iu.test(String(text || ''));
}

/** Nodes in edge order. A decision node keeps its labelled branches on the
 * same step so the relation is not flattened into a linear list. */
export function mermaidSteps(text) {
  const nodes = new Map(); const edges = []; const order = [];
  const see = id => { if (!order.includes(id)) order.push(id); };
  for (const line of String(text || '').split('\n').slice(1)) {
    for (const match of line.matchAll(/([A-Za-z_][\w-]*)\s*(\[\[?|\(\(?|\{\{?)([^\]\)\}]*)(\]\]?|\)\)?|\}\}?)/gu))
      if (!nodes.has(match[1])) nodes.set(match[1], { label: match[3].trim().replace(/^"|"$/gu, ''), decision: match[2].startsWith('{') });
    const plain = line.replace(/([A-Za-z_][\w-]*)\s*(?:\[\[?[^\]]*\]\]?|\(\(?[^)]*\)\)?|\{\{?[^}]*\}\}?)/gu, '$1');
    const edge = plain.match(/^\s*([A-Za-z_][\w-]*)\s*(?:--\s*([^-|>][^>]*?)\s*-->|-->\s*(?:\|([^|]*)\|)?|-\.->|==>)\s*([A-Za-z_][\w-]*)/u);
    if (edge) { edges.push({ from: edge[1], to: edge[4], label: (edge[2] || edge[3] || '').trim() }); see(edge[1]); see(edge[4]); }
  }
  if (order.length < 2) return null;
  const label = id => nodes.get(id)?.label || id;
  const branchTargets = new Set(edges.filter(edge => nodes.get(edge.from)?.decision && !edges.some(next => next.from === edge.to)).map(edge => edge.to));
  return order.filter(id => !branchTargets.has(id)).map(id => {
    if (!nodes.get(id)?.decision) return { label: label(id), note: '' };
    const branches = edges.filter(edge => edge.from === id).map(edge => `${edge.label || '→'}: ${label(edge.to)}`);
    return { label: label(id), note: branches.join('; ') };
  });
}

/** Converts a fenced diagram into ordered step text. "→" inside a note is
 * rewritten to "⇒" because ProcessBlock steps are split on arrows. */
export function codeDiagram(text, language = '') {
  const steps = isMermaidFlow(text, language) ? mermaidSteps(text) : isAsciiDiagram(text) ? asciiDiagramSteps(text) : null;
  if (!steps?.length) return null;
  const clean = value => String(value || '').replace(/->|→/gu, '⇒').trim();
  return { kind: isMermaidFlow(text, language) ? 'mermaid' : 'ascii',
    text: steps.map((step, index) => `${index + 1}. ${clean(step.label)}${step.note ? `: ${clean(step.note)}` : ''}`).join('\n') };
}

const words = text => new Set((String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{1,}|[㐀-鿿]{2,4}/gu) || [])
  .filter(word => !['the', 'and', 'for', 'with', 'step', 'e.g'].includes(word)));
const stepLabels = item => String(item.text || '').split('\n').map(line => line.replace(/^\s*\d+[.)]\s*/u, '').split(':')[0]).join(' ');
/** Two process diagrams in the same top-level section whose step labels
 * mostly coincide describe one flow. The later one is presented once, through
 * the earlier owner, and the merge is disclosed. Tables are never merged:
 * a stage/question table adds information. */
export function markEquivalentStructures(items) {
  const processes = items.filter(item => item.type === 'ProcessBlock' && !item.presentation);
  for (let i = 0; i < processes.length; i++) for (let j = i + 1; j < processes.length; j++) {
    const a = processes[i], b = processes[j];
    if (b.presentation || (a.sectionPath || [])[0] !== (b.sectionPath || [])[0]) continue;
    const left = words(stepLabels(a)), right = words(stepLabels(b));
    const shared = [...left].filter(word => right.has(word)).length;
    const stepsA = String(a.text).split('\n').length, stepsB = String(b.text).split('\n').length;
    if (Math.min(left.size, right.size) >= 4 && shared / Math.min(left.size, right.size) >= .7 && Math.abs(stepsA - stepsB) <= 3) {
      b.presentation = 'merged_equivalent'; b.equivalentTo = a.id; b.presentationBasis = `same flow as ${a.id}`;
      b.must_preserve_structure = false; b.priority = 'normal';
    }
  }
  return items;
}

const HAN = /\p{Script=Han}/gu, LATIN = /[A-Za-z]+/gu;
const scriptOf = text => {
  const han = (String(text).match(HAN) || []).length, latin = (String(text).match(LATIN) || []).length;
  return han > latin * 1.2 ? 'han' : latin > 0 && han <= latin * .25 ? 'latin' : 'mixed';
};
// Single digits are often written as words/numerals in the other language
// ("eight stages" / "八个阶段"); multi-digit and decimal numbers must agree.
const numbersOf = text => new Set((String(text).match(/\d+(?:\.\d+)?/gu) || []).filter(value => value.length > 1));
const PAIRABLE = new Set(['MechanismBlock', 'DefinitionBlock', 'ComparisonBlock', 'ExampleBlock', 'WarningBlock', 'EvidenceBlock', 'SummaryBlock', 'ChecklistBlock', 'TimelineBlock']);
/** Adjacent paragraphs in the same section, one Latin and one Han, with
 * compatible length and the same numbers, are a translation pair. A pair is
 * one claim for duplication/depth; both languages keep their display cost
 * (the output language follows the input). */
export function markLanguagePairs(items) {
  for (let i = 0; i + 1 < items.length; i++) {
    const a = items[i], b = items[i + 1];
    if (a.languagePairId || b.languagePairId || !PAIRABLE.has(a.type) || !PAIRABLE.has(b.type)) continue;
    if ((a.sectionPath || []).join('\0') !== (b.sectionPath || []).join('\0')) continue;
    const sa = scriptOf(a.text), sb = scriptOf(b.text);
    if (!(sa === 'latin' && sb === 'han' || sa === 'han' && sb === 'latin')) continue;
    const latin = sa === 'latin' ? a.text : b.text, han = sa === 'han' ? a.text : b.text;
    const ratio = (String(han).match(HAN) || []).length / Math.max(1, (String(latin).match(LATIN) || []).length);
    const na = numbersOf(a.text), nb = numbersOf(b.text);
    const numbersMatch = [...na].every(n => nb.has(n)) && [...nb].every(n => na.has(n));
    if (ratio < .6 || ratio > 4.5 || !numbersMatch) continue;
    const id = `lp_${a.id}`;
    Object.assign(a, { languagePairId: id, languageRole: 'primary' });
    Object.assign(b, { languagePairId: id, languageRole: 'translation' });
    i++;
  }
  return items;
}

const CODE_KEEP_INTENT = /(?:\b(?:source\s+code|code\s+(?:samples?|snippets?|blocks?|examples?|listings?)|(?:include|keep|show|preserve)\s+(?:the\s+|all\s+)?code)\b|(?:保留|展示|包含|放入|附上)(?:完整)?(?:的)?(?:代码|源码)|代码(?:示例|片段|清单)要?(?:保留|展示))/iu;
const CODE_OMIT_INTENT = /(?:\b(?:no|without|exclude|omit|skip)\s+(?:the\s+)?code\b|不(?:要|需要|用)?(?:放|展示|包含|保留|附)(?:任何)?(?:代码|源码))/iu;
const MONO = /mono|consol|courier|menlo|inconsolata|fira\s*code|jetbrains|source\s*code/iu;
export function templateHasCodeComponent(project = {}) {
  if (MONO.test(Object.values(project.templateSpec?.fonts || {}).join(' '))) return true;
  return (project.templateFidelity?.slides || []).some(slide => (slide.nodes || [])
    .some(node => node.type === 'text' && MONO.test(String(node.style?.fontFamily || ''))));
}
/** Decision 2026-10-08: explanatory code in a non-code template is not put on
 * slides and the omission is disclosed. Code is kept when the user chooses or
 * asks for it, or when the template has a code component. */
export function codePresentation(project = {}) {
  const choice = project.generationPolicy?.code?.presentation;
  if (choice === 'keep') return { mode: 'keep', basis: 'user_choice' };
  if (choice === 'omit') return { mode: 'omit_with_disclosure', basis: 'user_choice' };
  const intent = String(project.inputKind === 'prompt' ? '' : project.prompt || '');
  if (CODE_OMIT_INTENT.test(intent)) return { mode: 'omit_with_disclosure', basis: 'user_intent' };
  if (CODE_KEEP_INTENT.test(intent)) return { mode: 'keep', basis: 'user_intent' };
  if (templateHasCodeComponent(project)) return { mode: 'keep', basis: 'template_code_component' };
  return { mode: 'omit_with_disclosure', basis: 'default_non_code_template' };
}

/** Pure: returns a source whose inventory reflects the project's
 * presentation policy. Idempotent and reversible (switching code back to keep
 * restores the original required-object flags). */
export function applyPresentationPolicy(source, project = {}) {
  const inventory = source?.semantic?.inventory;
  if (!inventory?.items) return source;
  const code = codePresentation(project);
  const items = inventory.items.map(item => {
    if (item.type !== 'CodeBlock') return item;
    const { presentation, presentationBasis, ...rest } = item;
    return code.mode === 'keep' ? { ...rest, must_preserve_structure: true, priority: 'high' }
      : { ...rest, must_preserve_structure: false, priority: 'normal', presentation: 'omitted_by_policy', presentationBasis: code.basis };
  });
  return { ...source, semantic: { ...source.semantic, inventory: { ...inventory, items,
    must_cover_topics: items.filter(item => item.priority === 'high').map(item => item.id),
    presentationPolicy: { version: 1, code } } } };
}
export function syncPresentationPolicy(project) {
  if (project?.source?.semantic?.inventory) project.source = applyPresentationPolicy(project.source, project);
  return project;
}

const sectionLabel = item => String((item.sectionPath || []).at(-1) || '').split('|')[0].trim();
/** The disclosed list shown with the estimate and in the Syllabus (the
 * equivalent of Gamma's "My calls to check"). */
export function planningAssumptions(project = {}, source = project.source) {
  const items = source?.semantic?.inventory?.items || [];
  const result = [];
  const codes = items.filter(item => item.type === 'CodeBlock');
  if (codes.length) {
    const code = codePresentation(project);
    const omitted = code.mode !== 'keep';
    result.push({ topic: 'code', decision: code.mode, basis: code.basis, reversible: true, affectedSourceIds: codes.map(item => item.id),
      reason: omitted ? `${codes.length} 段代码不上页${code.basis === 'default_non_code_template' ? '（所选模板没有代码组件）' : code.basis === 'user_intent' ? '（按你的要求）' : ''}；公式、阈值与流程逻辑仍以文字、步骤或公式呈现。可改为保留代码。`
        : `${codes.length} 段代码按原文保留为代码组件${code.basis === 'template_code_component' ? '（所选模板有代码组件）' : code.basis === 'user_intent' ? '（按你的要求）' : ''}。可改为不上页。` });
  }
  const diagrams = items.filter(item => item.diagramSource);
  if (diagrams.length) result.push({ topic: 'diagram', decision: 'native_steps', reversible: false, affectedSourceIds: diagrams.map(item => item.id),
    reason: `${diagrams.length} 张文本流程图（ASCII/mermaid）转为可编辑的有序步骤，不作为代码展示。` });
  const merged = items.filter(item => item.presentation === 'merged_equivalent');
  if (merged.length) result.push({ topic: 'merge', decision: 'present_once', reversible: false, affectedSourceIds: merged.map(item => item.id),
    reason: `${merged.length} 处与前文表达同一流程的结构只呈现一次（${merged.map(item => `${sectionLabel(item)}`).filter(Boolean).slice(0, 3).join('、') || '同一章节'}）。` });
  const pairs = new Set(items.map(item => item.languagePairId).filter(Boolean)).size;
  if (pairs) result.push({ topic: 'language', decision: 'bilingual_pairs', reversible: false, affectedSourceIds: [],
    reason: `输出语言与输入一致：${pairs} 组平行双语段落两种语言都保留，在同一组件内成对呈现；配对算一条内容，两种语言分别占用版面。` });
  const tables = source?.semantic?.inventory?.warnings?.filter(item => item.code === 'source_table_ragged_rows') || [];
  if (tables.length) result.push({ topic: 'table', decision: 'normalized', reversible: false, affectedSourceIds: tables.map(item => item.sourceUnitId),
    reason: `${tables.length} 个表格的行列数不一致，已按表头列数对齐（多出的单元格并入最后一列），请检查原表。` });
  return result;
}
export function assumptionSummary(assumptions = []) {
  return assumptions.map(item => item.reason).join(' ');
}

import { userRequirements } from './ppt-outline-protocol.mjs';
import { densityProfile } from './ppt-density-profile.mjs';
import { sourceDensityPlan, pageCapacity } from './ppt-density-packing.mjs';
import { normalizePaste } from './ppt-source.mjs';
import { coverageMapV2, topicGroupDecisions } from './ppt-content-inventory.mjs';
/** Planning data stays inside the existing outline node and project JSON. */
import { buildTerminologyRegistry, copyBudgetFor, requiredSupportFor } from './ppt-presentation-writing.mjs';
import { presentationBudget } from './ppt-outline-concision.mjs';
import { withHeadingTerms } from './ppt-terminology-lock.mjs';
import { evidenceRelevance, selectEvidenceForSlide } from './ppt-evidence.mjs';
import { planSparseInput, pointBudgetFor, profilePptInput, sparsePageEstimate } from './ppt-content-depth.mjs';
import { effectiveKnowledge } from './ppt-generation-policy.mjs';
import { outputLanguage } from './ppt-prompt-contracts.mjs';
import { applyPresentationPolicy, planningAssumptions, assumptionSummary } from './ppt-presentation-policy.mjs';
import { pageContractFor } from './ppt-page-contract.mjs';

const ROLES = new Set(['navigation', 'cover', 'section', 'thesis', 'problem', 'comparison', 'architecture', 'process', 'framework', 'evidence', 'metric', 'timeline', 'case', 'recommendation', 'summary', 'roadmap', 'closing', 'mechanism', 'system', 'runtime', 'decision', 'appendix']);
const VISUALS = new Set(['none', 'hero', 'comparison', 'pipeline', 'architecture', 'timeline', 'matrix', 'cards', 'chart', 'table', 'metric', 'hub-and-spoke', 'before-after', 'process']);
const userIntent = project => String(userRequirements(project)||'').replace(/\S+\.(?:md|txt|pdf|docx?|pptx?|html?)\b/giu, '');

function bounded(value, max, fallback = '') {
  return (typeof value === 'string' && value.trim() ? value : String(fallback || '')).trim().slice(0, max);
}

function distinct(values, max = 20) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, max);
}

function clamp(value, min = 3, max = 100) { return Math.max(min, Math.min(max, Math.round(value))); }
const substantiveChunks = source => (source?.semantic?.chunks || []).filter(chunk =>
  chunk.contentKind !== 'navigation' && !/^(?:table of contents|contents|目录)(?:\s*\||$)/iu.test(String(chunk.topic || '').trim()));

/** Estimate display costs across connected source units; headings carry refs,
 * never a per-chapter floor. The outline planner refines this provisional plan. */
export function sourceCapacityPlan(source, selectedPages = null, project = {}) {
  return sourceDensityPlan(source, { ...project, pages: selectedPages || project.pages });
}
export function estimationSource(project) {
  if (project.source?.semantic?.inventory) return project.source;
  const text = String(project.source?.text || project.prompt || '').trim();
  if (!text || project.source?.kind === 'file' && !project.source.text) return null;
  // Substantial Prompt/Paste/File text shares one semantic source path. Short
  // topic prompts remain conceptual plans rather than claims of source facts.
  if (project.source?.text || project.generationPolicy?.content==='full_source'&&/^#{1,4}\s+/mu.test(text)&&text.includes('\n\n')&&/\d/u.test(text)&&!/(?:^|\n)\s*(?:please\s+)?(?:write|create|generate|make|produce)\b|(?:^|\n)\s*(?:请|請|帮我|幫我)/iu.test(text) || text.length >= 1200 || (text.match(/^#{1,4}\s+/gm) || []).length >= 2)
    return { ...normalizePaste(text), kind: project.source?.kind || project.inputKind || 'prompt' };
  return null;
}

export function estimatePageRecommendation(project) {
  const rawSource = estimationSource(project);
  // The disclosed presentation policy (code on/off, merged equivalent flows)
  // shapes the estimate; the stored source is never mutated here.
  const source = rawSource ? applyPresentationPolicy(rawSource, project || {}) : rawSource;
  const inputProfile = project?.inputProfile || profilePptInput(project);
  const contentPlan = project?.contentPlan || (source?.kind === 'file' && !source?.text ? null : planSparseInput(project, inputProfile));
  const sparseEstimate = sparsePageEstimate(contentPlan, project?.generationPolicy?.detail);
  const warnings = [...(source?.semantic?.inventory?.warnings || [])];
  let capacity = null;
  // An estimate degrades, it never fails the step: a malformed source object
  // is reported and the structural estimate is used instead.
  try { capacity = sourceCapacityPlan(source, project?.pages, project); }
  catch (error) { warnings.push({ code: 'capacity_estimate_failed', message: String(error?.message || error).slice(0, 300) }); }
  const assumptions = source?.semantic?.inventory ? planningAssumptions(project || {}, source) : [];
  const chunks = substantiveChunks(source);
  const text = String(source?.text || project?.prompt || '');
  const headings = (text.match(/^#{1,4}\s+.+$/gm) || []).length;
  const tables = (text.match(/^\s*\|.+\|\s*$/gm) || []).length;
  const implementationSignals = (text.match(/architecture|workflow|pipeline|implementation|runtime|constraint|example|架构|流程|实现|运行时|约束|示例/gi) || []).length;
  const highPriority = chunks.filter(chunk => chunk.priority === 'high').length;
  const fileWeight = Number(source?.kind === 'file' ? Math.min(16, Math.ceil(Number(source.bytes || 0) / 180_000)) : 0);
  // A long HTML chapter often becomes several bounded chunks. Counting every
  // split as an independent slide makes page estimates jump to 100 even when
  // many chunks share the same section. Use source volume and section variety.
  const substantialSections = new Set(chunks.filter(chunk => chunk.tokenCount >= 120)
    .map(chunk => (chunk.sectionPath || []).slice(0, 3).join('\u0000') || chunk.topic)).size;
  const semanticTokens = chunks.reduce((sum, chunk) => sum + Number(chunk.tokenCount || 0), 0);
  const semanticTopics = chunks.length
    ? Math.max(1, Math.ceil(semanticTokens / 550), Math.ceil(substantialSections * .85))
    : Math.max(1, headings, Math.ceil(text.length / 2400), fileWeight);
  const detailWeight = Math.min(6, Math.ceil((tables + implementationSignals) / 10));
  // A filename is source metadata, not authorization to compress a tutorial.
  const intent = userIntent(project);
  const overviewIntent = /(?:\b(?:overview|survey)\b|概览|综述|导览|入门)/iu.test(intent);
  const chapters = (text.match(/^##\s+\d+[.)]\s+.+$/gm) || []).length;
  const overviewEstimate = overviewIntent && chapters >= 6 ? clamp(2 + Math.ceil(chapters / 1.75), 5, 100) : null;
  const uncapped = capacity?.recommended || sparseEstimate?.recommended || overviewEstimate || clamp(2 + Math.ceil(semanticTopics * .7) + Math.ceil(highPriority * .25) + detailWeight, 5, 100);
  // Overview decks are sized by purpose first (major sections), then checked
  // against capacity; the estimate never exceeds that budget's cap.
  const budget = rawSource ? presentationBudget(project || {}, source) : null;
  const recommended = budget ? Math.min(uncapped, budget.max) : uncapped;
  const spread = Math.max(2, Math.ceil(recommended * .18));
  const min = Math.min(recommended, capacity?.range[0] || sparseEstimate?.range[0] || clamp(recommended - spread, 3, 100));
  const max = Math.min(budget ? budget.max : 100, capacity?.range[1] || sparseEstimate?.range[1] || clamp(recommended + spread, 3, 100));
  const selected = clamp(project?.pages || recommended);
  const strict = ['file', 'paste', 'update', 'base'].includes(source?.kind || project?.inputKind);
  const independentSections = substantialSections || Math.max(1, headings);
  const evidenceUnits = (source?.semantic?.evidenceAtoms || []).filter(atom => atom.kind === 'number' || atom.kind === 'example').length;
  const baseReason = capacity ? `按 ${capacity.groups.length} 个可组合内容组、Gamma参照密度与模板可读容量初估；章节不保底分页，大纲阶段校准` : sparseEstimate ? `先规划 ${sparseEstimate.semanticUnits} 个待论证语义单元，再按页面角色与容量估算；证据缺口须在内容阶段明确`
      : overviewEstimate ? `检测到 ${chapters} 个主章节；按概览用途将相关章节合并，详细推导仍需标注取舍`
      : `检测到 ${semanticTopics} 个语义主题${implementationSignals ? `、${implementationSignals} 个实现或约束信号` : ''}`;
  return {
    recommended, range: [min, max], selected,
    reason: [baseReason, budget ? `按 ${budget.sections} 个主要小节规划约 ${budget.target} 页（上限 ${budget.max} 页），细节进备注` : '', assumptionSummary(assumptions)].filter(Boolean).join('。'),
    reasonBase: baseReason, assumptions, warnings,
    densityProfileId: densityProfile().id, estimateVersion: 1, provisional: true,
    ...(budget ? { presentationBudget: budget, uncappedRecommended: uncapped } : {}),
    estimationBasis: budget && uncapped > budget.max ? 'presentation_budget' : capacity ? 'gamma_density_capacity' : sparseEstimate ? 'planned_semantic_units' : overviewEstimate ? 'overview_chapters' : 'source_structure', inputProfile,
    ...(capacity ? { contentCost: capacity.contentCost, costUnit: capacity.costUnit, groups: capacity.groups, capacity: capacity.capacity, preservedObjects: capacity.preservedObjects,
      sectionAllocation: capacity.sections.map(({ title, slides, sourceTokens, objects }) => ({ title, slides, sourceTokens, objects })) } : {}),
    ...(sparseEstimate ? { plannedSemanticUnits: sparseEstimate.semanticUnits, plannedContentCost: sparseEstimate.contentCost } : {}),
    depthPolicy: strict ? (project?.compressionApproved ? 'balanced' : 'strict') : 'flexible',
    compressionRisk: strict && selected < min,
    feasibleWithoutCompression: !strict || selected >= min,
    evidenceUnits, independentSections, evidenceThin: Boolean(chunks.length && selected > Math.max(8, independentSections * 3 + evidenceUnits)),
    projectionRisk: Boolean(project?.templateFidelity?.slides?.length && project.templateFidelity.slides.some(slide =>
      slide.slots?.some(slot => ['body', 'list', 'point-description'].includes(slot.purpose) && Number(slot.fontSizePt || 0) < 18))),
    userConfirmed: Boolean(project?.pageDecision?.confirmedAt || project?.pages && project?.pageDecision?.source !== 'estimate'),
  };
}

export function sourcePlanningContext(source, maxChars = 28000) {
  const chunks = substantiveChunks(source);
  if (!chunks.length) return (source?.segments || []).map(segment => `[${segment.id}] ${segment.location}: ${segment.text}`).join('\n').slice(0, maxChars);
  // A global high-priority sort used to exhaust the prompt budget in early
  // chapters of long courses. Interleave sections so every chapter is visible
  // before adding second and third excerpts from a large chapter.
  const roots = chunks.map(chunk => chunk.sectionPath?.[0] || '');
  const sharedRoot = roots.length > 1 && roots.every(root => root && root === roots[0]);
  const groups = new Map();
  for (const chunk of chunks) {
    const key = chunk.sectionPath?.[sharedRoot ? 1 : 0] || chunk.topic;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chunk);
  }
  for (const group of groups.values()) group.sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || a.id.localeCompare(b.id));
  const priorities = [];
  while (priorities.length < chunks.length) for (const group of groups.values()) {
    if (group.length) priorities.push(group.shift());
  }
  const directoryBudget = Math.floor(maxChars * .36);
  const directoryLines = [];
  let directoryLength = 0;
  for (const chunk of priorities) {
    const line = `[${chunk.id}] ${chunk.topic.slice(0, 36)} | ${chunk.semanticType} | ${chunk.contentKind || 'concept'} | refs=${chunk.sourceRefs.slice(0, 3).join(',')} | evidence=${(chunk.evidenceIds || []).slice(0, 3).join(',')}`;
    if (directoryLength + line.length + 1 > directoryBudget) break;
    directoryLines.push(line); directoryLength += line.length + 1;
  }
  const omitted = chunks.length - directoryLines.length;
  const header = `语义目录（每个 chunk 可与别的 chunk 合并成一页，也可拆成多页；共 ${chunks.length} 个${omitted ? `，上下文预算内省略 ${omitted} 个目录项` : ''}）：\n${directoryLines.join('\n')}\n详细内容：\n`;
  const budget = Math.max(0, maxChars - header.length);
  let details = '';
  for (const chunk of priorities) {
    const perChunk = Math.max(80, Math.min(1100, Math.floor((budget - priorities.length * 75) / Math.max(1, priorities.length))));
    const entry = `[${chunk.id}] ${chunk.topic} [refs:${chunk.sourceRefs.join(',')}]\n${chunk.text.slice(0, perChunk)}${chunk.text.length > perChunk ? '…' : ''}\n`;
    if (details.length + entry.length > budget) break;
    details += entry;
  }
  return (header + details).slice(0, maxChars);
}

export function normalizeBrief(value, project) {
  const raw = value && typeof value === 'object' ? value : {};
  const chunks = substantiveChunks(project.source);
  const defaultMessages = chunks.length
    ? chunks.filter(chunk => chunk.priority === 'high').slice(0, 8).map(chunk => chunk.topic)
    : (project.contentPlan?.coreQuestions || []).slice(0, 8);
  const pageRecommendation = estimatePageRecommendation(project);
  const intent = userIntent(project);
  const requestedReport = /决策|管理层|行动建议|decision|executive/i.test(intent) ? 'decision'
    : /汇报|报告|report/i.test(intent) ? 'informational' : 'presentation';
  const selectedReport = ['decision', 'informational', 'presentation'].includes(raw.reportMode) ? raw.reportMode : requestedReport;
  const reportMode = requestedReport === 'decision' ? 'decision'
    : requestedReport === 'informational' && selectedReport === 'presentation' ? 'informational' : selectedReport;
  const requestedUse = project.generationPolicy?.content==='course'||/培训|课程|教学|tutorial|course|training|notebook/i.test(intent) ? 'course_walkthrough'
    : reportMode !== 'presentation' ? 'workplace_report' : 'technical_explainer';
  const presentationUse = ['course_walkthrough', 'technical_explainer', 'workplace_report'].includes(raw.presentationUse)
    ? raw.presentationUse : requestedUse;
  const conciseRequested = /摘要|简要|簡要|概览|概覽|\b(?:overview|high.level|executive summary)\b/iu.test(intent);
  const richCourse = presentationUse === 'course_walkthrough' && chunks.length > project.pages * 2 && !conciseRequested;
  // A pasted document is material, not a presentation goal. Repeating it in
  // three fallback fields made every writer request contain the source again.
  const defaultGoal = intent || project.source?.semantic?.blocks?.find(block => block.type === 'heading')?.text || project.source?.name || project.title || '';
  return {
    outputLanguage: outputLanguage(project),
    goal: bounded(raw.goal, 240, defaultGoal), audience: bounded(raw.audience, 160, '演示文稿读者'),
    objective: bounded(raw.objective, 240, defaultGoal), thesis: bounded(raw.thesis, 360, defaultGoal),
    reportMode, presentationUse, decisionQuestion: bounded(raw.decisionQuestion, 240), sourceScope: bounded(raw.sourceScope, 240,
      project.source?.name ? `仅依据 ${project.source.name}` : project.contentPlan ? '短输入仅提供主题，具体事实和效果待来源验证' : ''),
    tone: bounded(raw.tone, 80, '清晰、专业'), depth: project.generationPolicy?.detail || (richCourse ? 'detailed'
      : ['concise', 'balanced', 'detailed'].includes(raw.depth) ? raw.depth : chunks.length > project.pages * 2 ? 'detailed' : 'balanced'),
    keyMessages: distinct(raw.keyMessages || raw.key_messages || defaultMessages, 12).map(item => item.slice(0, 160)),
    mustInclude: distinct(raw.mustInclude || raw.must_include || defaultMessages, Infinity),
    slideBudget: project.pages, finalPageCount: project.pages, depthPolicy: pageRecommendation.depthPolicy,
    evidencePolicy: effectiveKnowledge(project) === 'source_only'
      ? '只使用已提供来源；未经来源支持的数字、引用和事实不得输出'
      : '可解释通用概念、机制与示意框架；具体引用和数字需核实，未经核实的组织专属数据、客户、项目和效果不得输出',
  };
}

export function normalizeStoryArc(value, outline) {
  const raw = value && typeof value === 'object' ? value : {};
  const middle = outline.slice(1, -1);
  return {
    opening: bounded(raw.opening, 240, outline[0]?.focus || ''),
    development: bounded(raw.development, 240, middle.slice(0, Math.ceil(middle.length / 2)).map(item => item.focus).join('；').slice(0, 240)),
    turningPoint: bounded(raw.turningPoint || raw.turning_point, 240, middle[Math.floor(middle.length / 2)]?.focus || ''),
    resolution: bounded(raw.resolution, 240, outline.at(-1)?.focus || ''),
  };
}

export function inferRole(slide, index, count, source = null) {
  if (ROLES.has(slide.role)) return slide.role;
  if (index === 0) return 'cover';
  if (index === count - 1) return 'closing';
  const plannedRole={definition:'framework',mechanism:'mechanism',workflow:'process',comparison:'comparison',diagnostic:'system',evidence:'evidence',synthesis:'evidence'}[slide.pageContract?.job];
  if(plannedRole)return plannedRole;
  const text = `${slide.title || ''} ${slide.focus || ''} ${(slide.sourceTopics || []).join(' ')} ${slide.narrativeRole || ''}`;
  const intent = typeof slide.visualIntent === 'string' ? slide.visualIntent : slide.visualIntent?.type;
  if (intent === 'comparison') return 'comparison';
  if (intent === 'architecture') return 'architecture';
  if (intent === 'pipeline' || intent === 'process') return 'process';
  if (intent === 'timeline') return 'timeline';
  if (intent === 'metric') return 'metric';
  const cited = substantiveChunks(source).filter(chunk => (slide.chunkRefs || []).includes(chunk.id) ||
    (slide.refs || []).some(ref => chunk.sourceRefs?.includes(ref)));
  const sourceTypes = new Set(cited.map(chunk => chunk.semanticType));
  for (const [kind, role] of [['comparison', 'comparison'], ['architecture', 'architecture'],
    ['process', 'process'], ['timeline', 'timeline'], ['metric', 'metric']]) {
    if (sourceTypes.has(kind)) return role;
  }
  if (/定义|概念|边界|definition|concept/i.test(text)) return 'framework';
  if (/机制|原理|推导|mechanism|derivation/i.test(text)) return 'mechanism';
  if (/算例|案例|示例|worked example|case study/i.test(text)) return 'case';
  if (/对比|比较|差异|\bvs\b|before|after/i.test(text)) return 'comparison';
  if (/架构|architecture|系统组成/i.test(text)) return 'architecture';
  if (/流程|步骤|pipeline|process/i.test(text)) return 'process';
  if (/时间线|里程碑|roadmap|timeline/i.test(text)) return 'timeline';
  if (/风险|问题|挑战/i.test(text)) return 'problem';
  if (/建议|下一步|行动/i.test(text)) return 'recommendation';
  if (/指标|度量|metric|kpi/i.test(text)) return 'metric';
  return 'evidence';
}

export function inferVisualIntent(slide) {
  const raw = slide.visualIntent || slide.visual_intent;
  const type = typeof raw === 'string' ? raw : raw?.type;
  if (VISUALS.has(type)) return { type };
  return { type: ({ comparison: 'comparison', architecture: 'architecture', process: 'pipeline', timeline: 'timeline', roadmap: 'timeline', metric: 'metric' })[slide.role] || 'none' };
}

function slideDepth(slide, brief, index, count) {
  if (index === 0 || index === count - 1) return 'concise';
  if (brief?.depth === 'detailed') return 'detailed';
  const normalized = { low: 'concise', medium: 'balanced', high: 'detailed' }[slide.density] || slide.density;
  return ['concise', 'balanced', 'detailed'].includes(normalized) ? normalized : (brief?.depth || 'balanced');
}


function densityContract(slide, role, depth, index, count, richSource = false) {
  if (index === 0) return { density: 'low', distributionType: 'three_deep_points', semanticUnitBudget: 1, pointLengthProfile: 'compact' };
  if (index === count - 1) return richSource
    ? { density: 'high', distributionType: 'principles_grouped', semanticUnitBudget: 8, pointLengthProfile: 'mixed' }
    : { density: 'low', distributionType: 'three_deep_points', semanticUnitBudget: 3, pointLengthProfile: 'compact' };
  const complex = ['mechanism', 'architecture', 'process', 'comparison', 'case', 'runtime', 'system'].includes(role);
  const density = ['low', 'medium', 'high'].includes(slide.density) ? slide.density
    : depth === 'concise' ? 'low' : complex && depth === 'detailed' ? 'high' : 'medium';
  const defaults = {
    framework: ['four_medium_cards', 6, 'standard'],
    closing: ['principles_grouped', 5, 'mixed'],
    process: ['process_6_steps', 6, 'compact'],
    timeline: ['process_6_steps', 6, 'compact'],
    roadmap: ['process_6_steps', 6, 'compact'],
    comparison: ['comparison_2x3', density === 'high' ? 6 : 4, 'standard'],
    architecture: ['architecture_layers', density === 'high' ? 6 : 4, density === 'high' ? 'deep' : 'standard'],
    mechanism: ['three_deep_points', density === 'high' ? 4 : 3, 'deep'],
    runtime: ['architecture_layers', density === 'high' ? 6 : 4, 'deep'],
    system: ['architecture_layers', density === 'high' ? 6 : 4, 'deep'],
    recommendation: ['principles_grouped', density === 'high' ? 5 : 4, 'standard'],
  }[role] || (density === 'high' ? ['four_medium_cards', 5, 'mixed'] : density === 'low' ? ['three_deep_points', 3, 'compact'] : ['four_medium_cards', 5, 'standard']);
  const distributionType = bounded(slide.distributionType || slide.distribution_type, 40, defaults[0]);
  const semanticUnitBudget = clamp(Number(slide.semanticUnitBudget || slide.semantic_unit_budget) || defaults[1], 2, 10);
  const pointLengthProfile = ['compact', 'standard', 'deep', 'very_deep', 'mixed'].includes(slide.pointLengthProfile || slide.point_length_profile)
    ? (slide.pointLengthProfile || slide.point_length_profile) : defaults[2];
  return { density, distributionType, semanticUnitBudget, pointLengthProfile,
    pointBudget: pointBudgetFor(pointLengthProfile, role, density, distributionType) };
}

function templatePointCapacity(templateFidelity, index) {
  const slots = templateFidelity?.slides?.[index]?.slots || [];
  return new Set(slots.filter(slot => slot.role === 'content' && slot.purpose !== 'footnote')
    .map(slot => String(slot.groupId || slot.pairedWith || slot.shapeId))).size;
}

const formulaKey = value => String(value || '').replace(/[`\s]/g, '').toLocaleLowerCase();
function codeLikeDetail(value) {
  const text = String(value || '');
  return /\b[A-Za-z_]\w*\s*=\s*[-A-Za-z_\d.(]/u.test(text) ||
    /\b[A-Za-z_]\w*\s*\([^\n]{2,}\)[-+*/]/u.test(text) ||
    /\b[A-Za-z_]\w*\s*\([^\n]*[-+*/][^\n]*\)/u.test(text);
}

export function sourceBackedDetails(slide, source) {
  const relevant = (source?.semantic?.chunks || []).filter(chunk => (slide.chunkRefs || []).includes(chunk.id));
  const owned = slide.planningProtocolVersion === 2 && Array.isArray(slide.sourceUnitIds)
    ? (source?.semantic?.inventory?.items || []).filter(item => slide.sourceUnitIds.includes(item.id)) : null;
  const sourceText = (owned || relevant).map(item => item.text || '').join('\n');
  const fullSource = String(source?.text || '');
  const explicit = distinct(slide.requiredDetails || slide.required_details || slide.supportingPoints, Infinity)
    .filter(detail => !fullSource || !codeLikeDetail(detail) || formulaKey(fullSource).includes(formulaKey(detail)));
  // A worked example containing source code must keep its actual calculation.
  // Prefer the computed expression over a plausible formula reconstructed by
  // the outline model from the surrounding prose.
  if (/example|worked|loop|formula|算例|示例|案例|公式|实例/iu.test(`${slide.title || ''} ${slide.focus || ''}`)) {
    const assignments = [...sourceText.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*([^\n]{6,})/gm)]
      .map(match => `${match[1]} = ${match[2].trim()}`)
      .filter(value => /[+*/-]/u.test(value.split('=').slice(1).join('=')));
    const formula = assignments.find(value => /^raw\s*=/iu.test(value)) || assignments[0];
    if (formula && !explicit.some(detail => formulaKey(detail) === formulaKey(formula))) explicit.unshift(formula);
  }
  return distinct(explicit, Infinity);
}

export function slidePlan(outline, brief = {}, source = null, templateFidelity = null) {
  return outline.map((slide, index) => {
    const role = inferRole(slide, index, outline.length, source);
    const depth = slideDepth(slide, brief, index, outline.length);
    const richSource = String(source?.text || '').length >= 8000 && outline.length <= 24 &&
      ['course_walkthrough', 'technical_explainer'].includes(brief?.presentationUse);
    const density = densityContract(slide, role, depth, index, outline.length, richSource);
    const templateCapacity = templatePointCapacity(templateFidelity, index);
    // A preserved page has visible point regions of its own. Rich source pages
    // should plan against those regions, instead of carrying a generic three
    // point budget into a five or six point native layout.
    const sourceDetailCount = new Set([...(slide.keyPoints || []).map(point => point.text), ...(slide.requiredDetails || []), ...(slide.supportingPoints || []),
      ...(slide.sourceTopics || [])].filter(Boolean).map(value => String(value).trim().toLocaleLowerCase())).size;
    const templatePointTarget = templateCapacity && index > 0 && index < outline.length - 1
      ? Math.min(templateCapacity, Math.max(density.semanticUnitBudget, richSource ? sourceDetailCount : 0)) : 0;
    const validEvidence = new Map((source?.semantic?.evidenceAtoms || []).map(atom => [atom.id, atom]));
    const explicitEvidence = distinct(slide.requiredEvidenceIds || slide.required_evidence_ids, 6).filter(id => {
      const atom = validEvidence.get(id);
      const chunkRefs = slide.chunkRefs || [];
      return atom && (chunkRefs.length
        ? chunkRefs.includes(atom.chunkId)
        : (!(slide.refs || []).length || (atom.sourceRefs || []).some(ref => (slide.refs || []).includes(ref))));
    });
    const requiredEvidenceIds = explicitEvidence.length ? explicitEvidence : selectEvidenceForSlide(source, { ...slide, role }, 1);
    return ({
    slideId: slide.id, role, section: slide.section,
    narrativeRole: bounded(slide.narrativeRole || slide.narrative_role, 40, role),
    claimIds: distinct(slide.claimIds || slide.claim_ids, 8), requiredEvidenceIds,
    evidenceIntent: bounded(slide.evidenceIntent || slide.evidence_intent, 80,
      /\b(?:evidence|results?|benchmark)\b|证据|结果|数据/iu.test(slide.title || '') ? 'required' : requiredEvidenceIds.length ? 'supporting' : 'none'),
    question: bounded(slide.question, 240, slide.focus), message: bounded(slide.focus, 360, slide.title), headlineIntent: bounded(slide.headlineIntent || slide.headline_intent, 160, slide.focus),
    audienceTakeaway: bounded(slide.audienceTakeaway || slide.audience_takeaway || slide.takeaway, 240, slide.focus),
    sourceArtifacts: (source?.semantic?.inventory?.items || []).filter(item => (item.must_preserve_structure || item.type === 'SummaryBlock') && (Array.isArray(slide.sourceUnitIds) ? slide.sourceUnitIds.includes(item.id) : item.chunkRefs.some(id => slide.chunkRefs?.includes(id)))).flatMap(({ id, type, rows }) => { const ranges = (slide.sourceArtifactRanges || []).filter(ref => ref.sourceUnitId === id); return (ranges.length ? ranges : [{sourceUnitId:id}]).map(ref => ({ ...ref, type, rows: rows?.length, columns: rows?.[0]?.length })); }),
    sourceRefs: [...(slide.refs || [])], sourceChunks: [...(slide.chunkRefs || [])], sourceTopics: distinct(slide.sourceTopics || slide.source_topics, 8).map(item => item.slice(0, 120)),
    keyPoints: slide.keyPoints || [],
    supportingPoints: distinct(slide.supportingPoints, 6).map(item => item.slice(0, 160)),
    requiredSupport: requiredSupportFor(role, depth, slide.requiredSupport || slide.required_support || slide.supportingPoints),
    requiredDetails: sourceBackedDetails(slide, source),
    visualIntent: inferVisualIntent(slide), depth, ...density,
    pageContract: pageContractFor(slide, source, role),
    densityProfileId: densityProfile().id, densityFit: slide.densityFit || null, sourceUnitIds: slide.sourceUnitIds || [],
    ...(templateCapacity ? { templatePointCapacity: templateCapacity,
      templatePointTarget: templatePointTarget || Math.min(templateCapacity, density.semanticUnitBudget),
      semanticUnitBudget: templatePointTarget || Math.min(templateCapacity, density.semanticUnitBudget) } : {}),
    transitionFromPrevious: bounded(slide.transitionFromPrevious || slide.transition_from_previous, 180, index ? outline[index - 1]?.focus : ''),
    transitionToNext: bounded(slide.transitionToNext || slide.transition_to_next, 180, index < outline.length - 1 ? outline[index + 1]?.focus : ''),
    copyBudget: { ...copyBudgetFor(role, slide.layoutId, templateFidelity?.mode === 'preserve' ? undefined : outputLanguage({ source, prompt: brief.goal, outputLanguage: brief.outputLanguage })),
      ...(index > 0 ? { bodyUnits: pageCapacity({ templateFidelity }, index).high, densityTargetUnits: pageCapacity({ templateFidelity }, index).target } : {}) },
  }); });
}

export function coverageMap(source, outline, explicit = []) {
  const chunks = substantiveChunks(source);
  const decisions = new Map((Array.isArray(explicit) ? explicit : []).filter(item => item && typeof item === 'object').map(item => [item.chunkId, item]));
  return chunks.map(chunk => {
    const slideIds = outline.filter(slide => slide.chunkRefs?.length ? slide.chunkRefs.includes(chunk.id) : (slide.refs || []).some(ref => chunk.sourceRefs.includes(ref))).map(slide => slide.id);
    const decision = decisions.get(chunk.id);
    const units=(source.semantic?.inventory?.items||[]).filter(item=>item.chunkRefs?.includes(chunk.id));
    const notesOnly=units.length&&units.every(item=>['notes_by_contract','omitted_by_policy'].includes(item.presentation)&&item.presentationBasis);
    return { chunkId: chunk.id, topic: chunk.topic, priority: chunk.priority, slideIds,
      action: slideIds.length ? 'included' : notesOnly ? 'notes' : decision?.action === 'omitted' ? 'omitted' : 'unmapped',
      reason: !slideIds.length ? notesOnly?'Every source unit in this chunk is retained under its validated notes/code-presentation contract':bounded(decision?.reason, 240, '') : '' };
  });
}

/** One outline-node revision can fix repeated or ungrounded page claims.
 * Source insufficiency is recorded for QA, never "repaired" by inventing facts. */
export function inspectLongDeckOutline(project, outline) {
  if (!Array.isArray(outline) || outline.length < 3) return [];
  const chunks = substantiveChunks(project.source);
  const hasSource = Boolean(project.source?.segments?.length || chunks.length) &&
    !(project.inputKind === 'prompt' && project.inputProfile?.level === 'sparse');
  const issues = [];
  const seen = new Map();
  if(project.generationPolicy?.content==='overview'&&outline.length>=6&&!project.requestedOutline){
    const last=outline.at(-1),items=project.source?.semantic?.inventory?.items||[];
    const owned=items.filter(item=>last.sourceUnitIds?.includes(item.id));
    const isConclusion=/summary|conclusion|closing|decision|总结|小结|結論|總結|结论|结语|結語|决策|決策/iu.test(last.title||'');
    if(!last.titleLocked&&!isConclusion&&owned.length&&owned.every(item=>['EquationBlock','CodeBlock'].includes(item.type))){
      const preceding=outline.slice(1,-1).map((slide,index)=>({slide,index:index+1})).filter(({slide})=>/summary|conclusion|closing|decision|decide|总结|结论|结语|决策/iu.test(slide.title||slide.section||'')).at(-1)?.index;
      issues.push({code:'outline_closing_new_structure',repairable:true,message:'The final overview page introduces only a new technical formula/code object. Move that complete object before the actual decision/conclusion page; preserve every source ID and use the closing to conclude the story.',
        details:{pageIndex:outline.length-1,relatedPageIndexes:[preceding??outline.length-2],sourceUnitIds:owned.map(item=>item.id)}});
    }
  }
  for (const [index, slide] of outline.entries()) {
    if (index === 0 || index === outline.length - 1 || ['section','navigation'].includes(slide.role)) continue;
    const focus = String(slide.focus || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    const prior = seen.get(focus), previous = prior === undefined ? null : outline[prior];
    // A real table continuation carries a distinct row interval. Repeating
    // its topic is legitimate; repeating the same complete claim is not.
    const ranges = slide.sourceArtifactRanges || [], oldRanges = previous?.sourceArtifactRanges || [];
    const continuation = ranges.length && oldRanges.length && ranges.every(a=>oldRanges.some(b=>a.sourceUnitId===b.sourceUnitId)) &&
      ranges.every(a=>oldRanges.every(b=>a.sourceUnitId!==b.sourceUnitId || a.rowEnd<=b.rowStart || b.rowEnd<=a.rowStart));
    const recap = slide.repeatSourceUnitIds?.length && slide.repeatSourceUnitIds.every(id=>previous?.sourceUnitIds?.includes(id));
    if (focus.length >= 6 && seen.has(focus) && !continuation && !recap) issues.push({ code: 'outline_repeated_claim',
      message: `第 ${index + 1} 页与第 ${seen.get(focus) + 1} 页重复同一核心消息`, details:{pageIndex:index,duplicatesPageIndex:seen.get(focus),field:'focus'},repairable: true });
    else if (focus) seen.set(focus, index);
    const knownUnits=new Set((project.source?.semantic?.inventory?.items||[]).map(item=>item.id));
    const semanticOwner=(slide.sourceUnitIds||[]).some(id=>knownUnits.has(id))||(slide.sourceArtifactRanges||[]).some(ref=>knownUnits.has(ref.sourceUnitId));
    const inheritedOwner=slide.change==='keep'&&project.update?.baseSnapshot?.deck?.slides?.some(prior=>prior.id===slide.baseSlideId);
    if (hasSource && !(slide.chunkRefs?.length || slide.refs?.length || semanticOwner || inheritedOwner)) issues.push({ code: 'outline_ungrounded_page',
      message: `第 ${index + 1} 页没有对应来源；请引用实际来源或把它改为明确的结构/过渡页`, repairable: true });
  }
  let highRun = 0;
  for (const [index, slide] of outline.entries()) {
    highRun = slide.density === 'high' && !['cover', 'closing', 'section'].includes(slide.role) ? highRun + 1 : 0;
    if (highRun === 4) issues.push({ code: 'density_rhythm',
      message: `第 ${index - 2}–${index + 1} 页连续高密度；检查能否把摘要、深解释和流程页交错安排`, repairable: true });
  }
  return issues.slice(0, 12);
}

export function buildPlanning(project, modelOutput, outline) {
  const brief = normalizeBrief(modelOutput?.brief, project);
  const pageRecommendation = estimatePageRecommendation(project);
  return { version: 8, densityProfile: densityProfile(), densityPacking: modelOutput?.densityPacking || project.planning?.densityPacking || null, brief, inventory: project.source?.semantic?.inventory, coverageV2: coverageMapV2(project.source, outline, modelOutput?.coverageV2?.detail || []), topicGroups: topicGroupDecisions(project.source, outline, slidePlan(outline, brief, project.source, project.templateFidelity), modelOutput?.topicGroups || []), inputProfile: project.inputProfile || profilePptInput(project),
    contentPlan: project.contentPlan || planSparseInput(project),
    storyArc: normalizeStoryArc(modelOutput?.storyArc || modelOutput?.story_arc, outline),
    terminology: withHeadingTerms(buildTerminologyRegistry(project.source, outline), project.source), slidePlan: slidePlan(outline, brief, project.source, project.templateFidelity), coverage: coverageMap(project.source, outline, modelOutput?.coverage),
    sourceStats: project.source?.semantic?.stats || null, sourceCapacity: sourceCapacityPlan(estimationSource(project), project.pages, project), sourceDetailInventory: {
      chunks: substantiveChunks(project.source).length,
      highPriorityChunks: substantiveChunks(project.source).filter(chunk => chunk.priority === 'high').length,
      semanticTypes: [...new Set(substantiveChunks(project.source).map(chunk => chunk.semanticType))],
    }, pageRecommendation, feasibility: {
      userPages: project.pages, recommendedPages: pageRecommendation.recommended, depthPolicy: pageRecommendation.depthPolicy,
      feasibleWithoutCompression: pageRecommendation.feasibleWithoutCompression,
      compressionApproved: Boolean(project.compressionApproved),
    } };
}

export function refreshPlanning(project) {
  const previous = project.planning || {};
  const pageRecommendation = estimatePageRecommendation(project);
  return { ...previous, version: 8, densityProfile: densityProfile(), inventory: project.source?.semantic?.inventory, coverageV2: coverageMapV2(project.source, project.outline || [], previous.coverageV2?.detail || []), topicGroups: topicGroupDecisions(project.source, project.outline || [], slidePlan(project.outline || [], previous.brief, project.source, project.templateFidelity), (previous.topicGroups || []).filter(item=>item.origin==='planner')), terminology: withHeadingTerms(buildTerminologyRegistry(project.source, project.outline || []), project.source), pageRecommendation,
    sourceCapacity: sourceCapacityPlan(estimationSource(project), project.pages, project),
    feasibility: { userPages: project.pages, recommendedPages: pageRecommendation.recommended, depthPolicy: pageRecommendation.depthPolicy,
      feasibleWithoutCompression: pageRecommendation.feasibleWithoutCompression, compressionApproved: Boolean(project.compressionApproved) },
    slidePlan: slidePlan(project.outline || [], previous.brief || normalizeBrief(null, project), project.source, project.templateFidelity), coverage: coverageMap(project.source, project.outline || [], previous.coverage) };
}

export function normalizeFactSynthesis(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const list = name => distinct(raw[name], 10).map(item => item.slice(0, 240));
  return { claims: list('claims'), facts: list('facts'), numbers: list('numbers'), examples: list('examples'),
    relationships: list('relationships'), mechanisms: list('mechanisms'), implications: list('implications'),
    constraints: list('constraints'), definitions: list('definitions'), decisions: list('decisions'), limitations: list('limitations') };
}

function retrievalTokens(value) {
  return new Set((String(value || '').toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,5}/g) || []));
}

/** Re-retrieval is deterministic and runs inside each existing content node. */
export function retrieveSlideSources(project, outlineSlide, contract, maxChunks = contract?.density === 'high' ? 8 : 6) {
  const chunks = substantiveChunks(project.source);
  const evidenceAtoms = project.source?.semantic?.evidenceAtoms || [];
  const atomById = new Map(evidenceAtoms.map(atom => [atom.id, atom]));
  const direct = new Set(outlineSlide?.chunkRefs || contract?.sourceChunks || []);
  const directRefs = new Set(outlineSlide?.refs || contract?.sourceRefs || []);
  const locked = [...new Set([...(contract?.requiredEvidenceIds || []), ...(outlineSlide?.requiredEvidenceIds || [])])]
    .map(id => atomById.get(id)).filter(atom => atom && (!direct.size || direct.has(atom.chunkId)));
  const lockedChunks = new Set(locked.map(atom => atom.chunkId));
  const lockedRefs = [...new Set(locked.flatMap(atom => atom.sourceRefs || [atom.sourceRef]).filter(Boolean))];
  const query = [contract?.message, contract?.question, ...(outlineSlide?.keyPoints || []).map(point => point.text), ...(contract?.requiredSupport || []), ...(contract?.sourceTopics || []), outlineSlide?.focus, outlineSlide?.title].filter(Boolean).join(' ');
  const wanted = retrievalTokens(query);
  const scored = chunks.map(chunk => {
    const terms = retrievalTokens(`${chunk.topic} ${chunk.text}`);
    const overlap = [...wanted].filter(term => terms.has(term)).length;
    const directScore = lockedChunks.has(chunk.id) ? 1500 : direct.has(chunk.id) ? 1000 :
      (!direct.size && chunk.sourceRefs.some(ref => directRefs.has(ref)) ? 600 : 0);
    const priority = chunk.priority === 'high' ? 40 : chunk.priority === 'medium' ? 10 : 0;
    return { chunk, score: directScore + priority + overlap * 12 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id)).slice(0, maxChunks).map(item => item.chunk);
  const sourceRefs = [...new Set([...lockedRefs, ...directRefs, ...scored.flatMap(chunk => chunk.sourceRefs || [])])];
  // Provenance is complete; the writer's context is separately bounded. Put
  // locked and retrieved excerpts first so long early chapters cannot hide a
  // relevant later formula behind a character-budget truncation.
  const contextRefs = [...new Set([...lockedRefs, ...scored.flatMap(chunk => chunk.sourceRefs || []), ...directRefs])];
  const segmentById = new Map((project.source?.segments || []).map(segment => [segment.id, segment]));
  const segments = contextRefs.map(id => segmentById.get(id)).filter(Boolean);
  const selectedEvidence = evidenceAtoms.filter(atom => scored.some(chunk => chunk.id === atom.chunkId) || locked.includes(atom))
    .map(atom => ({ atom, score: locked.includes(atom) ? 2 : evidenceRelevance(atom, query) }))
    .filter(item => item.score >= .12).sort((a, b) => b.score - a.score || a.atom.id.localeCompare(b.atom.id))
    .slice(0, Math.max(8, locked.length)).map(item => item.atom);
  return { version: 2, query: query.slice(0, 600), chunkIds: scored.map(chunk => chunk.id), sourceRefs,
    requiredChunkIds: [...new Set([...lockedChunks, ...direct])],
    requiredEvidenceIds: locked.map(atom => atom.id), evidenceAtoms: selectedEvidence, chunks: scored, segments };
}

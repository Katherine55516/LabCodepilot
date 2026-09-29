/** M1 PPT Workspace API and durable, server-side job orchestration.
 * All model calls and PPTX rendering run in a Cowork container. Project JSON
 * lives on the server data disk, so a second signed-in desktop sees the same
 * project and can export its completed presentation. */
import * as store from './ppt-store.mjs';
import * as orch from './orchestrator.mjs';
import * as files from './files.mjs';
import { runRoutine } from './routine-runner.mjs';
import { renderPptx } from './ppt/exporters/pptx.mjs';
import { renderPdf } from './ppt/exporters/pdf.mjs';
import { extractFile, normalizePaste, validateFile, sha256 } from './ppt-source.mjs';
import { BUILT_INS, templateFor, validateTemplate, analyzeTemplate, snapshotTemplate } from './ppt-template.mjs';
import { normalizeBlocks, normalizeSourceImages } from './ppt-blocks.mjs';
import { applyLayoutRegistry, LAYOUTS } from './ppt-layout.mjs';
import { boundedAll, dagNodeId, nodeRecord } from './ppt-dag.mjs';
import { deckReviewPrompt, deterministicReview, finalQualityReport, inspectMedia, inspectSourceForSlide, normalizeModelReview, repairProject } from './ppt-quality.mjs';
import { ensureDeckV3, ensureProjectV3, newId as newIrId, stableId } from './ppt/ir.mjs';
import { buildRenderTree } from './ppt/render-tree.mjs';
import { emitRunProgress, completeRun, recoverRun, startRun, transitionNode } from './ppt/run-service.mjs';
import { getProject as getStructuredProject, saveProject as saveStructuredProject, saveRevision } from './ppt/repository.mjs';
import { handleStructuredPpt } from './ppt/api.mjs';
import { importEditablePptx, renderImportedPptx } from './ppt/import-pptx.mjs';
import { enrichAssetRefs } from './ppt/assets.mjs';
import { withSemanticIndex } from './ppt-semantic.mjs';
import { missingRequiredEvidence } from './ppt-evidence.mjs';
import { buildPlanning, estimatePageRecommendation, inspectLongDeckOutline, normalizeFactSynthesis, refreshPlanning, retrieveSlideSources, sourceCapacityPlan, sourcePlanningContext } from './ppt-planning.mjs';
import { planSparseInput, profilePptInput } from './ppt-content-depth.mjs';
import { compileSectionLabel, formatUserDeckTitle, inspectSlideCopy, materializeCopy } from './ppt-presentation-writing.mjs';
import { prepareTemplateFidelity, rescheduleTemplateFidelity, templateSlotPrompt, templateOutlinePrompt, inspectTemplateSlotDraft, autoTemplateMediaOmissions, bindTemplateFidelity, renderTemplatePptx } from './ppt-template-fidelity.mjs';
import { templateReuseError } from './ppt-template-scheduler.mjs';
import { inspectReportOutline } from './ppt-report-qa.mjs';
import { reorderManual, sortManual } from './ppt-manual-order.mjs';

const running = new Set();
const editing = new Set();
const MAX_PROMPT = 12000;
const MAX_TEXT = 160;
const PPT_NODE_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.PPT_NODE_CONCURRENCY) || 3));
const PPT_RE = /^\/ppt\/projects(?:\/([a-f0-9]{32}))?(?:\/(outline|generate|retry|export|pdf|source|duplicate|trash|restore|permanent|versions|rewrite|blank))?$/i;
const FOLDER_RE = /^\/ppt\/folders(?:\/([a-f0-9]{32}))?$/i;
const TEMPLATE_RE = /^\/ppt\/templates(?:\/(violet|blue|light|marketing|education|[a-f0-9]{32}))?$/i;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function bounded(value, max, field, required = true) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = value.trim();
  if ((required && !s) || s.length > max) throw new HttpError(400, `${field} length invalid`);
  return s;
}
function pages(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 3 || n > 100) throw new HttpError(400, 'pages must be between 3 and 100');
  return n;
}
function parseModelJson(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); }
  catch {
    const first = raw.indexOf('{'); const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
    try { return JSON.parse(raw); }
    catch { throw new Error('模型未返回有效的结构化内容，请重试'); }
  }
}
function sourceFromDeck(base) {
  const segments = (base.deck?.slides || []).map((slide, index) => ({ id: String(index + 1), location: `旧版第 ${index + 1} 页`, text: `${slide.title}\n${(slide.bullets || []).join('\n')}` }));
  return { kind: 'base', name: base.title, text: segments.map(s => s.text).join('\n\n'), segments };
}
function mergeSources(parts) {
  const segments = parts.flatMap(({ origin, info }) => (info.segments || []).map((item, index) => ({
    id: `${origin === 'base' ? 'B' : 'U'}${index + 1}`, origin,
    location: `${origin === 'base' ? '旧版' : '进展'} · ${item.location}`, text: item.text,
  })));
  return withSemanticIndex({ kind: 'update', name: parts.map(p => p.info.name).join(' + '), text: segments.map(s => s.text).join('\n\n').slice(0, 80000), segments, truncated: parts.some(p => p.info.truncated) });
}
function normalizeOutline(value, count, source, update = null, deckTitle = null) {
  if (!Array.isArray(value?.slides) || value.slides.length !== count) throw new HttpError(400, `大纲需要恰好 ${count} 页`);
  const validRefs = new Set((source?.segments || []).map(s => s.id));
  const validChunkRefs = new Set((source?.semantic?.chunks || []).map(chunk => chunk.id));
  const usedBaseIds = new Set();
  return value.slides.map((s, index) => {
    if (!s || typeof s !== 'object') throw new HttpError(400, `slide ${index + 1} invalid`);
    const proposedBaseId = s.change === 'add' ? null : s.baseSlideId;
    if (update && proposedBaseId && !update.baseSnapshot?.deck?.slides.some(slide => slide.id === proposedBaseId)) throw new HttpError(400, 'unknown base slide id');
    const baseSlideId = update && typeof proposedBaseId === 'string' && update.baseSnapshot?.deck?.slides.some(slide => slide.id === proposedBaseId) ? proposedBaseId : null;
    if (baseSlideId && usedBaseIds.has(baseSlideId)) throw new HttpError(400, 'one old slide may only map to one new slide');
    if (baseSlideId) usedBaseIds.add(baseSlideId);
    let change = update ? (baseSlideId ? (s.change === 'keep' ? 'keep' : 'rewrite') : 'add') : undefined;
    const base = baseSlideId ? update.baseSnapshot.deck.slides.find(slide => slide.id === baseSlideId) : null;
    const generatedTitle = bounded(s.title, MAX_TEXT, `slide ${index + 1} title`);
    const title = index === 0 && deckTitle?.source === 'user' && deckTitle?.text ? deckTitle.text : generatedTitle;
    const focus = bounded(s.focus || s.summary || s.title, 360, `slide ${index + 1} focus`);
    const oldFocus = update?.baseSnapshot.outline?.find(slide => slide.id === baseSlideId)?.focus;
    if (change === 'keep' && (title !== base.title || (oldFocus && focus !== oldFocus))) change = 'rewrite';
    const children = Array.isArray(s.children) ? s.children.slice(0, 12).map((child, childIndex) => ({
      id: typeof child?.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(child.id) ? child.id : newIrId('item'),
      title: bounded(child?.title || `子章节 ${childIndex + 1}`, MAX_TEXT, `slide ${index + 1} child title`),
      description: bounded(child?.description || child?.title || '', 360, `slide ${index + 1} child description`, false),
    })) : [];
    return { id: typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s.id) ? s.id : newIrId('slide'), title,
      focus, description: bounded(s.description || s.focus || s.title, 360, `slide ${index + 1} description`, false), children,
      section: compileSectionLabel(bounded(s.section || s.title, MAX_TEXT, `slide ${index + 1} section`)),
      refs: Array.isArray(s.refs) ? [...new Set(s.refs.map(String))].filter(ref => validRefs.has(ref)).slice(0, 10) : [],
      ...(Array.isArray(s.chunkRefs) ? { chunkRefs: [...new Set(s.chunkRefs.map(String))].filter(ref => validChunkRefs.has(ref)).slice(0, 12) } : {}),
      ...(typeof s.role === 'string' ? { role: s.role.slice(0, 40) } : {}),
      ...(typeof s.question === 'string' ? { question: s.question.slice(0, 240) } : {}),
      ...(typeof s.headlineIntent === 'string' || typeof s.headline_intent === 'string' ? { headlineIntent: String(s.headlineIntent || s.headline_intent).slice(0, 160) } : {}),
      ...(typeof s.audienceTakeaway === 'string' || typeof s.audience_takeaway === 'string' || typeof s.takeaway === 'string' ? { audienceTakeaway: String(s.audienceTakeaway || s.audience_takeaway || s.takeaway).slice(0, 240) } : {}),
      ...(Array.isArray(s.sourceTopics || s.source_topics) ? { sourceTopics: (s.sourceTopics || s.source_topics).filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 120)) } : {}),
      ...(typeof s.transitionFromPrevious === 'string' || typeof s.transition_from_previous === 'string' ? { transitionFromPrevious: String(s.transitionFromPrevious || s.transition_from_previous).slice(0, 180) } : {}),
      ...(typeof s.transitionToNext === 'string' || typeof s.transition_to_next === 'string' ? { transitionToNext: String(s.transitionToNext || s.transition_to_next).slice(0, 180) } : {}),
      ...(Array.isArray(s.supportingPoints) ? { supportingPoints: s.supportingPoints.filter(item => typeof item === 'string').slice(0, 6).map(item => item.slice(0, 160)) } : {}),
      ...(Array.isArray(s.requiredSupport || s.required_support) ? { requiredSupport: (s.requiredSupport || s.required_support).filter(item => typeof item === 'string').slice(0, 6).map(item => item.slice(0, 48)) } : {}),
      ...(s.visualIntent && typeof s.visualIntent === 'object' && typeof s.visualIntent.type === 'string' ? { visualIntent: { type: s.visualIntent.type.slice(0, 40) } } : {}),
      ...(typeof s.density === 'string' ? { density: s.density.slice(0, 20) } : {}),
      ...(typeof s.distributionType === 'string' || typeof s.distribution_type === 'string' ? { distributionType: String(s.distributionType || s.distribution_type).slice(0, 40) } : {}),
      ...(Number.isInteger(s.semanticUnitBudget || s.semantic_unit_budget) ? { semanticUnitBudget: Math.max(2, Math.min(10, Number(s.semanticUnitBudget || s.semantic_unit_budget))) } : {}),
      ...(typeof s.pointLengthProfile === 'string' || typeof s.point_length_profile === 'string' ? { pointLengthProfile: String(s.pointLengthProfile || s.point_length_profile).slice(0, 24) } : {}),
      ...(Array.isArray(s.requiredDetails || s.required_details) ? { requiredDetails: (s.requiredDetails || s.required_details).filter(item => typeof item === 'string').slice(0, 10).map(item => item.slice(0, 160)) } : {}),
      ...(Array.isArray(s.requiredEvidenceIds || s.required_evidence_ids) ? { requiredEvidenceIds: [...new Set(s.requiredEvidenceIds || s.required_evidence_ids)].filter(id =>
        (source?.semantic?.evidenceAtoms || []).some(atom => atom.id === id)).slice(0, 6) } : {}),
      ...(Array.isArray(s.claimIds || s.claim_ids) ? { claimIds: (s.claimIds || s.claim_ids).filter(id => typeof id === 'string').slice(0, 8) } : {}),
      ...(typeof s.narrativeRole === 'string' || typeof s.narrative_role === 'string' ? { narrativeRole: String(s.narrativeRole || s.narrative_role).slice(0, 40) } : {}),
      ...(typeof s.evidenceIntent === 'string' || typeof s.evidence_intent === 'string' ? { evidenceIntent: String(s.evidenceIntent || s.evidence_intent).slice(0, 80) } : {}),
      ...(s.titleLocked === true || s.title_locked === true || (index === 0 && deckTitle?.locked) ? { titleLocked: true } : {}),
      ...(update ? { baseSlideId, change } : {}) };
  });
}
function normalizeDeck(value, outline) {
  if (!Array.isArray(value?.slides) || value.slides.length !== outline.length) throw new HttpError(400, `内容需要恰好 ${outline.length} 页`);
  const deck = {
    schemaVersion: 1,
    slides: value.slides.map((s, index) => {
      if (!s || typeof s !== 'object') throw new HttpError(400, `slide ${index + 1} invalid`);
      if (!Array.isArray(s.bullets) || s.bullets.length > 10) throw new HttpError(400, `第 ${index + 1} 页要点无效`);
      if (s.bullets.reduce((n, b) => n + (typeof b === 'string' ? b.length : 0), 0) > 15000) {
        throw new HttpError(400, `第 ${index + 1} 页文字过多，请缩短要点`);
      }
      let blocks;
      try { blocks = normalizeBlocks(s.blocks); } catch (error) { throw new HttpError(400, `slide ${index + 1}: ${error.message}`); }
      if (blocks.length && (s.bullets.length > 10 || s.bullets.join('').length > 10000)) throw new HttpError(400, `slide ${index + 1}: visual slide copy exceeds capacity`);
      const layout = s.layout || 'text-first';
      if (!['text-first', 'visual-first'].includes(layout)) throw new HttpError(400, `slide ${index + 1}: invalid layout`);
      const layoutId = s.layoutId === undefined ? undefined : bounded(s.layoutId, 40, `slide ${index + 1} layout`);
      if (layoutId && !LAYOUTS[layoutId]) throw new HttpError(400, `slide ${index + 1}: unknown layout`);
      return {
        id: outline[index].id,
        title: bounded(s.title, MAX_TEXT, `slide ${index + 1} title`),
        bullets: s.bullets.map((b) => bounded(b, 4000, 'bullet')),
        sourceRefs: outline[index].refs || [],
        blocks,
        layout,
        ...(s.manualBlank || outline[index].manualBlank ? { manualBlank: true } : {}),
        ...(layoutId ? { layoutId } : {}),
      };
    }),
  };
  return ensureDeckV3(applyLayoutRegistry(deck));
}
function outlinePrompt(p) {
  const sourceContext = sourcePlanningContext(p.source);
  const pageRecommendation = estimatePageRecommendation(p);
  const capacity = sourceCapacityPlan(p.source, p.pages);
  const allocationContract = capacity ? `按用户最终 ${p.pages} 页重新分配内容：封面与结论各 1 页；以下章节建议为正文页配额（不是模板页号）：${capacity.sections.map(section => `${section.title}=${section.slides}页${section.objects.length ? `，保留${section.objects.join('/')}` : ''}`).join('；').slice(0, 6000)}。${capacity.compactSections.length ? `这些章节无独立页，必须并入相邻相关页并保留核心主张：${capacity.compactSections.join('、').slice(0, 1000)}。` : ''}来源内容负载/可读容量比约 ${capacity.compressionRatio}；低页数时优先明确合并和取舍，高页数时按不同问题、证据或算例拆开。coverage 对未映射的高优先级 chunk 必须给出具体省略理由，不得静默丢弃公式、代码、表格或案例。` : '';
  const userOutlineContract = p.outlineSeed?.length ? `用户手动编辑过的大纲草稿：${JSON.stringify(p.outlineSeed).slice(0, 9000)}。在调整为 ${p.pages} 页时优先保留用户改过的标题和重点；需要合并或拆分时保持原意，不复制同一观点凑页。` : '';
  const sparsePlan = p.contentPlan || planSparseInput(p);
  const userTitle = p.deckTitle?.source === 'user' ? p.deckTitle.raw : '';
  const titleContract = userTitle
    ? `用户 Deck Title 为「${userTitle}」。它已锁定：封面 title 必须保持原词、原语言和原术语，不得改写、缩短或翻译；只能由渲染器换行。`
    : '用户没有填写 Deck Title。为封面生成一个精炼标题：中文优先 6–18 字，英文优先 2–8 个词，最多两行；额外背景放入 focus 或后续 subtitle。';
  const planningContract = `先在内部建立 Presentation Brief（目标、受众、核心论点、深度、mustInclude、reportMode、decisionQuestion、sourceScope），再规划有起承转合的 storyArc。reportMode 只选 presentation、informational 或 decision；决策或职场汇报需在前 3 页给出摘要或需要回答的决定，较早展示核心流程/证据，结尾给出来源支持的条件性建议与下一步；资料不足时不要虚构建议或案例，而应在 sourceScope 与页面中说明缺口。主文尽量集中，补充细节放 appendix。页数优先级固定为：用户手动调整或明确指定 > PPT 模块估算 > 模板原有页数。模板页数只决定原生版式选择和安全复用，不得更改输出页数。当前 project.pages=${p.pages} 是本轮最终页数硬参数（含封面），必须准确规划成 ${p.pages} 页；不得根据模板页数或固定 10/12 页假设改动。模块估算为 ${pageRecommendation.recommended} 页（范围 ${pageRecommendation.range[0]}–${pageRecommendation.range[1]}），只用于未指定页数时的默认值及判断内容密度、压缩风险。${allocationContract}${userOutlineContract}${titleContract} Story Planner 输出 section label、title intent 和 slide message，section 使用 4–12 个中文字符或 2–8 个英文词；不要直接复制来源长标题。同一页可整合多个来源，一个来源也可支持多页，但拆分后的每页须有不同的问题、独立主张或证据作用；不可用同义改写凑足页数。来源不足时在 sourceScope 和相应页面明确不足，不要补造材料。每页根据角色选择 low/medium/high 密度、内容分布、2–10 个语义单元和 point length profile；不要固定三条 bullet。整稿应有密度节奏：摘要与过渡、普通说明、高密度流程或深机制交错；不要连续多页都写成高密度卡片。若来源包含可复算的公式、代码或算例，必须把核心表达式、变量含义和适用条件列入相应页 requiredDetails，不能只保留流程概述；特殊数学符号要规划成可见的普通文本表示。每个高优先级主题必须出现在页面 refs 中，或在 coverage 中说明省略原因。${templateOutlinePrompt(p)}`;
  const planningSchema = '{"brief":{"goal":"目标","audience":"受众","objective":"目的","thesis":"核心论点","presentationUse":"course_walkthrough|technical_explainer|workplace_report","reportMode":"presentation|informational|decision","decisionQuestion":"需要回答的决定","sourceScope":"来源和不足","tone":"语气","depth":"balanced|detailed","keyMessages":["关键消息"],"mustInclude":["必讲主题"]},"storyArc":{"opening":"开场","development":"展开","turningPoint":"转折","resolution":"结论"},"slides":[{"section":"短章节标签","title":"标题意图（封面按 Deck Title 规则）","focus":"本页 slide message","question":"本页要回答的问题","role":"cover|section|summary|thesis|problem|comparison|architecture|process|mechanism|runtime|evidence|decision|recommendation|appendix|closing","narrativeRole":"概念|算例|证据|决策之一","claimIds":["本页稳定主张 ID"],"requiredEvidenceIds":["来源语义目录中真实存在的 evidence ID"],"evidenceIntent":"required|supporting|none","headlineIntent":"标题要表达的判断","audienceTakeaway":"读者应带走的结论","sourceTopics":["来源主题"],"requiredSupport":["mechanism|evidence|example|contrast|constraint|implication|decision|next_step"],"requiredDetails":["必须保留的来源细节"],"supportingPoints":["要保留的来源主题"],"visualIntent":{"type":"none|image|comparison|pipeline|architecture|timeline|table|metric"},"density":"low|medium|high","distributionType":"three_deep_points|four_medium_cards|two_macro_regions|process_6_steps|comparison_2x3|architecture_layers|principles_grouped","semanticUnitBudget":6,"pointLengthProfile":"compact|standard|deep|very_deep|mixed","chunkRefs":["语义 chunk ID"],"refs":["原始来源编号"]}],"coverage":[{"chunkId":"c_001","action":"omitted","reason":"页数限制下的明确取舍"}]}';
  if (p.update) {
    const base = p.update.baseSnapshot;
    const old = base.deck?.slides?.map(slide => `[${slide.id}] ${slide.title}: ${(slide.bullets || []).join('；')}`).join('\n').slice(0, 16000) || base.source?.text?.slice(0, 16000) || '';
    const progress = (p.source?.segments || []).filter(s => s.origin === 'progress').map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 14000);
    return `你是演示文稿版本更新规划器。${planningContract} 仅分析旧版与用户提供的新进展；不搜索、不调用工具、不编造数字。旧版：${base.title}\n旧版内容：\n${old}\n最新进展：\n${progress || p.prompt}\n语义索引：\n${sourceContext.slice(0, 12000)}\n生成恰好 ${p.pages} 页的新大纲，返回唯一 JSON：${planningSchema}。每个 slide 另加 baseSlideId（旧页 ID 或 null）和 change（keep|rewrite|add）。原样保留且内容不变的页用 keep；需要改写的旧页用 rewrite；新页用 add。不得虚构旧页 ID 或来源编号。只输出 JSON。`;
  }
  if (p.source?.segments?.length) {
    return `你是演示文稿叙事规划器。${planningContract} 只分析以下用户提供的来源，不搜索、不调用工具、不编造数字。文件名：${p.title}；页数：${p.pages}。\n来源（chunkRefs 用语义 chunk ID；refs 用索引列出的原始来源编号）：\n${sourceContext}\n返回唯一 JSON：${planningSchema}。slides 恰好 ${p.pages} 个；第一页封面，最后一页总结。相邻页面可以共享 section，每页 chunkRefs 和 refs 只能引用上面实际存在的编号。只输出 JSON。`;
  }
  return `你是演示文稿叙事规划器。${planningContract} 只做内容结构，不写代码、不调用工具、不生成 PPTX、不搜索网页。\n主题：${p.prompt}\n短输入预规划（这些是待论证问题，不是已证实事实）：${JSON.stringify(sparsePlan || {})}\n先依据该 Content Plan 与 Semantic Unit Inventory 扩展完整的概念结构和故事骨架，再按用户确定的 ${p.pages} 页分配。缺乏来源时可解释通用机制、示意框架和评估方法；不得把公司特定数据、客户、项目、效果或财务数字写成事实。页数少时合并相邻问题，页数多时把机制、条件和评估拆开，不能添加同义 filler。\n文件名：${p.title}\n页数：${p.pages}。\n返回唯一 JSON：${planningSchema}。slides 必须恰好 ${p.pages} 个，第一页是封面，最后一页是结论。每页有不同的逻辑作用，不要编造具体数字；纯 Prompt 输入时 refs 为空。只输出 JSON。`;
}
function contentPrompt(p, slide, index) {
  const plan = p.outline.map((s, i) => `${i + 1}. ${s.title} — ${s.focus}`).join('\n');
  const brief = p.planning?.brief || {};
  const storyArc = p.planning?.storyArc || {};
  const contract = p.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
  const pointBudget = contract.pointBudget || { min: 20, target: 35, max: 50, preferredCount: [3, 5] };
  const pointRule = p.templateFidelity?.mode === 'preserve'
    ? `原生模板的文本槽位数量、每槽容量和字体优先于通用 point 长度目标。本页内容组目标 ${contract.templatePointTarget || contract.semanticUnitBudget || 1}/${contract.templatePointCapacity || '模板容量'}；每一组应体现具体对象、机制、条件或结果，并在可见 slotTexts 中完整表达。用长短不同的点分配信息，不写只有主题名的空洞短句；来源支撑不足时说明缺口，不复制别的点。公式中的指数、根号、变量名和单位必须以 PowerPoint 可见的普通文本或可靠的原生公式表达，不得留下空白占位。`
    : `本页 point 目标 ${pointBudget.preferredCount[0]}–${pointBudget.preferredCount[1]} 个；每条解释目标约 ${pointBudget.target} 个中英混排视觉字，通常在 ${pointBudget.min}–${pointBudget.max} 之间。${pointBudget.guidance || ''} 每个 point 应有独立信息功能（定义、机制、证据、例子、限制或启示）；长解释与短支撑可混排，不要机械等长。来源支撑的模型名称、公式变量、阈值和适用条件应保留。不能为了凑数编造证据或重复标题；证据不足可用更少但更完整的点，并明确缺口。过长内容先重组或换版式，不得机械截断。`;
  const retrieval = retrieveSlideSources(p, slide, contract);
  const deckTitleRule = index === 0 && p.deckTitle?.source === 'user'
    ? `本页是封面。Deck Title 已由用户锁定为「${p.deckTitle.raw}」，title 字段必须逐字返回该标题，不得润色、缩短、翻译或改变术语。`
    : index === 0 ? '本页是封面且用户未提供 Deck Title；生成精炼 Deck Title，中文 6–18 字或英文 2–8 词，额外上下文放入 subtitle。' : '';
  const sourceCitationRule = /\b(?:sources?|references?|citations?)\b|来源|参考文献|引用/iu.test(slide.title || '') && p.source?.kind === 'file'
    ? `这是来源页；可见 slotTexts 或正文必须明确写出输入文件名「${p.source.name}」及本页引用来源的位置，不得只写“来源可追溯”之类的概括。` : '';
  const editorial = `演示目标：${brief.objective || p.prompt}；受众：${brief.audience || '演示文稿读者'}；用途：${brief.presentationUse || 'technical_explainer'}；核心论点：${brief.thesis || p.prompt}；最终用户确认页数：${p.pages}（不得更改）；深度：${contract.depth || brief.depth || 'balanced'}；密度：${contract.density || 'medium'}；内容分布：${contract.distributionType || 'four_medium_cards'}；语义单元预算：${contract.semanticUnitBudget || 5}；point length profile：${contract.pointLengthProfile || 'standard'}；${pointRule} 必讲主题：${(brief.mustInclude || []).join('、').slice(0, 600)}。故事弧：${[storyArc.opening, storyArc.development, storyArc.turningPoint, storyArc.resolution].filter(Boolean).join(' → ').slice(0, 600)}。本页角色：${contract.role || 'evidence'}；本页要回答：${contract.question || slide.focus}；本页核心消息：${contract.message || slide.focus}；本页叙事作用：${contract.narrativeRole || contract.role || ''}；本页必需支撑：${(contract.requiredSupport || []).join('、').slice(0, 300)}；必须保留的细节：${(contract.requiredDetails || []).join('、').slice(0, 600)}；锁定证据 ID：${(contract.requiredEvidenceIds || []).join('、')}；视觉意图：${contract.visualIntent?.type || 'none'}。${deckTitleRule}${sourceCitationRule} 先基于原始页级召回完成 factSynthesis，再写 presentation-native 结构化内容。每页按“问题→主张→机制/例子/证据→启示”论证，并说明相对相邻页新增了什么；禁止同义改写凑页。详细页保留主张、机制、实现细节、约束、例子与启示中由来源支持且规划要求的部分；不得用上游摘要替代原始语义 chunk，不得编造来源没有的内容。evidence/results/benchmark 页面应给可复查的数值、对照或具体质性证据及条件；来源不足则明确说明或改成“评估方法”，不可只写空泛原则。不要为满足最短长度加无意义尾语；来源不足时用完整短句并标识待补证据。takeaway 必须提供新的综合判断，不能重复标题或正文。模型只决定语义，不给坐标、字号或 PPTX。非封面标题是 message-first headline，生成 3–5 个候选；标准内容标题最多 36 visual units、最多两行，不靠缩小字号解决。`;
  const reportEditorial = brief.reportMode === 'presentation' ? '' : `这是 ${brief.reportMode === 'decision' ? '决策' : '信息'}汇报。待回答的问题：${brief.decisionQuestion || '未指定'}；证据边界：${brief.sourceScope || '仅依据当前输入'}。summary 页先写读者可采取的结论及依据；process 或 architecture 页给出完整链路及分支条件；evidence 页区分来源事实、推断和未验证项；recommendation 或 decision 页只写由来源支持的条件、可执行的下一步与仍需核实的问题；appendix 页用于补充定义、异常与来源细节。每个要点写“判断或概念＋一句简洁解释”，禁止只重复名词，也不能通过同义改写把单一事实拆成多页。当前来源不足以支撑的行动建议要明确标为待验证。`;
  const contentSchema = '{"factSynthesis":{"claims":["主张"],"facts":["来源支持的事实"],"numbers":["来源数值"],"examples":["例子"],"relationships":["因果或结构关系"],"mechanisms":["机制"],"implications":["启示"],"constraints":["约束"],"limitations":["局限"]},"evidenceUsedIds":["在可见文字中实际表达的 evidence ID"],"titleCandidates":["候选标题"],"title":"结论式标题或锁定的用户 Deck Title","eyebrow":"可选短标签","subtitle":"可选背景句","contentBlocks":[{"type":"definition|mechanism|evidence|example|implication|contrast|constraint|tradeoff|decision|next_step|stage|runtime","heading":"短标题","body":"来源支持的说明"}],"takeaway":"可选且不可重复的结论","bullets":["仅用于兼容的结构化要点"],"slotTexts":{"普通模板 shape ID":"单行或多行文字","多点列表 shape ID":[{"label":"要点名称","body":"来源支持的简洁说明"}]},"omitTemplateShapes":[{"shapeId":123,"reason":"该原生图解与本页主题无关，且无来源支持"}]}';
  const slotContract = templateSlotPrompt(p, index);
  if (p.update) {
    const old = slide.baseSlideId ? p.update.baseSnapshot.deck?.slides.find(item => item.id === slide.baseSlideId) : null;
    const selected = slide.refs?.length ? p.source.segments.filter(s => slide.refs.includes(s.id)) : p.source.segments.filter(s => s.origin === 'progress').slice(0, 8);
    const progress = selected.map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 16000);
    return `你是演示文稿更新文案编辑。${editorial}${reportEditorial}${slotContract} 仅写第 ${index + 1} 页，不调用工具、不编造数字。旧页：${old ? `${old.title}；${(old.bullets || []).join('；')}` : '新增'}。最新进展：${progress}\n已确认大纲：\n${plan}\n本页主张：${slide.focus}\n返回唯一 JSON：${contentSchema}，contentBlocks 数量服从本页语义单元预算，每条说明服从 point length profile。先填 factSynthesis，再据此写 copy。只用旧版与最新进展中的事实。只输出 JSON。`;
  }
  if (p.source?.segments?.length) {
    const selected = retrieval.segments.length ? retrieval.segments : (slide.refs?.length ? p.source.segments.filter(s => slide.refs.includes(s.id)) : p.source.segments.slice(0, 8));
    const perSource = Math.max(500, Math.floor(15000 / Math.max(1, selected.length)));
    const excerpts = selected.map(s => `[${s.id}] ${s.location}: ${s.text.slice(0, perSource)}${s.text.length > perSource ? '…' : ''}`).join('\n').slice(0, 16000);
    const semantic = retrieval.chunks.map(chunk => `[${chunk.id}] ${chunk.topic} | ${chunk.semanticType} | ${chunk.contentKind || 'concept'} | ${chunk.discourseRole} | ${chunk.visualCandidates.join(',')}\n${chunk.text.slice(0, 900)}`).join('\n').slice(0, 6200);
    const evidence = retrieval.evidenceAtoms.map(atom => `[${atom.id}] ${atom.kind} refs=${atom.sourceRefs.join(',')} ${atom.location}: ${atom.exactText}`).join('\n').slice(0, 6800);
    return `你是演示文稿文案编辑。${editorial}${reportEditorial}${slotContract} 只用给定来源写第 ${index + 1} 页，不搜索、不调用工具、不编造数字、来源或单位。\n大纲：\n${plan}\n本页主张：${slide.focus}\n页级召回查询：${retrieval.query}\n来源证据原子（锁定 ID 必须在可见页面表达完整数值、单位和适用条件；不能只在 factSynthesis 中列出）：\n${evidence}\n相关语义单元：\n${semantic}\n本页来源：\n${excerpts}\n术语表：${JSON.stringify(p.planning?.terminology || {})}\n返回唯一 JSON：${contentSchema}。contentBlocks 数量与长度必须服从本页角色、分布和语义单元预算；先填 factSynthesis，再据此写 copy；保留来源支持的主张、机制、证据、细节和启示。来源没有的事实不要写。只输出 JSON。`;
  }
  return `你是演示文稿文案编辑。${editorial}${reportEditorial}${slotContract} 只写文本，不调用工具、不写代码、不生成坐标或 PPTX。不得编造数字或来源。\n用户主题：${p.prompt}\n已确认大纲：\n${plan}\n当前任务只写第 ${index + 1} 页，标题意图：${slide.title}；核心观点：${slide.focus}。\n返回唯一 JSON：${contentSchema}。contentBlocks 数量与长度服从本页角色和语义单元预算；封面可以 0 条。只输出 JSON。`;
}
function contentRepairPrompt(p, slide, index, draft, issues) {
  const diagnostics = issues.map(item => ({ code: item.code, repair: item.repair, missingSupport: item.missingSupport || [], message: item.message })).slice(0, 6);
  return `${contentPrompt(p, slide, index)}\n上一稿：${JSON.stringify({ title: draft.title, bullets: draft.bullets, copy: draft.copy, factSynthesis: draft.factSynthesis, slotTexts: draft.templateSlotTexts, omitTemplateShapes: draft.templateOmissions }).slice(0, 7000)}\n确定性检查结果：${JSON.stringify(diagnostics)}\n仅重写当前页。优先用给定来源补齐缺失的支撑类型；如果来源没有例子或数字，不得编造。标题超限时写更短的候选标题并将背景放入 subtitle。保持同一 JSON schema，只输出 JSON。`;
}
async function modelCall(p, prompt, activity, log, options = {}) {
  const sid = options.nodeKey ? sha256(Buffer.from(`${p.id}:${options.nodeKey}`)).slice(0, 32) : p.id;
  try {
    const result = await runRoutine({ sid, uid: p.uid, kind: orch.KIND_PPT, prompt, model: p.model, configId: p.configId, activity, log });
    if (!result.ok) throw new Error(result.error || `模型任务失败：${result.status}`);
    return parseModelJson(result.resultText);
  } finally {
    if (sid !== p.id) await orch.removeContainer(sid, { keepVolume: false }).catch(() => {});
  }
}
const defaultDeps = { modelCall, renderPptx: project => project.templateFidelity?.mode === 'preserve' ? renderTemplatePptx(project) : renderPptx(project),
  prepareTemplateFidelity, renderPdf, extractFile, analyzeTemplate, readFile: files.readFile, removeContainer: orch.removeContainer };
function normalizeSlide(value, outlineSlide, project = null, previousTitles = []) {
  const visual = outlineSlide?.visualIntent?.type;
  const suggestedLayout = ({ image: 'image-text', comparison: 'comparison', pipeline: 'timeline', process: 'timeline', timeline: 'timeline', table: 'table', chart: 'chart', metric: 'big-number' })[visual];
  const compatible = suggestedLayout && (!['table', 'chart'].includes(suggestedLayout) || value?.blocks?.some(block => block.type === suggestedLayout));
  const preparedValue = { ...value, bullets: Array.isArray(value?.bullets) ? value.bullets : [] };
  const prepared = value?.layoutId || !compatible ? preparedValue : { ...preparedValue, layoutId: suggestedLayout };
  const slide = normalizeDeck({ slides: [prepared] }, [outlineSlide]).slides[0];
  const compiled = materializeCopy(value || {}, outlineSlide, project?.planning, previousTitles);
  slide.title = compiled.title.title || slide.title;
  slide.titleQuality = compiled.title;
  const isCover = Boolean(project?.outline?.[0]?.id && project.outline[0].id === outlineSlide.id);
  if (isCover && project?.deckTitle?.source === 'user' && project.deckTitle.text) {
    const locked = formatUserDeckTitle(project.deckTitle.raw || project.deckTitle.text, compiled.copy.copyBudget);
    slide.title = locked.title;
    slide.titleQuality = locked;
    slide.titleLocked = true;
  } else if (isCover && slide.title) {
    const formatted = formatUserDeckTitle(slide.title, compiled.copy.copyBudget);
    slide.title = formatted.title;
    slide.titleQuality = { ...compiled.title, ...formatted, source: 'agent', locked: false, maxVisualUnits: compiled.copy.copyBudget.titleHardUnits,
      fits: compiled.title.visualUnits <= compiled.copy.copyBudget.titleHardUnits && formatted.estimatedLines <= compiled.copy.copyBudget.titleMaxLines };
  }
  slide.bullets = compiled.bullets;
  slide.copy = compiled.copy;
  let resolvedDistributionLayout = false;
  if (!value?.layoutId && !compatible && slide.blocks.length === 0) {
    const distributionLayout = {
      two_macro_regions: 'comparison', comparison_2x3: 'comparison', process_6_steps: 'timeline',
    }[compiled.copy.distributionType] || (compiled.copy.density === 'high' ? 'editorial' : null);
    if (distributionLayout && !isCover) { slide.layoutId = distributionLayout; slide.layoutRef = distributionLayout; resolvedDistributionLayout = true; }
  }
  const retrieval = project && !isCover ? retrieveSlideSources(project, outlineSlide, project.planning?.slidePlan?.find(item => item.slideId === outlineSlide.id)) : null;
  // Retrieval improves the writer's context, but it must not silently turn a
  // planned page with no cited source into a cited page. Formal source refs
  // remain the outline contract and QA can still expose missing attribution.
  if (retrieval) {
    slide.retrieval = { version: retrieval.version, query: retrieval.query, chunkIds: retrieval.chunkIds,
      sourceRefs: retrieval.sourceRefs, evidenceIds: retrieval.evidenceAtoms.map(atom => atom.id),
      requiredEvidenceIds: retrieval.requiredEvidenceIds };
    slide.sourceRefs = [...new Set([...(slide.sourceRefs || []), ...retrieval.requiredEvidenceIds.flatMap(id =>
      (project.source?.semantic?.evidenceAtoms || []).find(atom => atom.id === id)?.sourceRefs || [])])];
  }
  const titleNode = slide.nodes.find(node => node.semanticRole === 'title');
  if (titleNode) titleNode.content = { ...(titleNode.content || {}), text: slide.title };
  const bodyNode = slide.nodes.find(node => node.semanticRole === 'body');
  if (bodyNode) bodyNode.content = { ...(bodyNode.content || {}), items: slide.bullets.map((item, itemIndex) => ({
    id: stableId('item', slide.id, 'body', itemIndex), text: item,
    ...(slide.copy.blocks[itemIndex] ? { heading: slide.copy.blocks[itemIndex].heading,
      body: slide.copy.blocks[itemIndex].body, pointType: slide.copy.blocks[itemIndex].type } : {}),
  })) };
  for (const [role, content] of [['eyebrow', slide.copy.eyebrow], ['subtitle', slide.copy.subtitle], ['takeaway', slide.copy.takeaway]]) {
    if (!content) continue;
    const existing = slide.nodes.find(node => node.semanticRole === role);
    if (existing) existing.content = { ...(existing.content || {}), text: content };
    else slide.nodes.push({ id: stableId('node', slide.id, role), type: 'text', semanticRole: role, slotId: role, styleRef: `typography.${role}`, content: { text: content } });
  }
  slide.factSynthesis = normalizeFactSynthesis(value?.factSynthesis);
  slide.evidenceUsedIds = [...new Set(Array.isArray(value?.evidenceUsedIds) ? value.evidenceUsedIds : [])]
    .filter(id => retrieval?.evidenceAtoms.some(atom => atom.id === id)).slice(0, 10);
  if (project?.templateFidelity?.mode === 'preserve') {
    const valid = new Set(project.templateFidelity.slides[project.outline.findIndex(item => item.id === outlineSlide.id)]?.slots.map(slot => String(slot.shapeId)) || []);
    slide.templateSlotTexts = Object.fromEntries(Object.entries(value?.slotTexts || {}).filter(([key, text]) => valid.has(key) && (typeof text === 'string' || Array.isArray(text))).map(([key, text]) => [key,
      typeof text === 'string' ? text.slice(0, 500) : text.slice(0, 30).map(item => ({ label: String(item?.label || '').slice(0, 120), body: String(item?.body || '').slice(0, 500) }))]));
    const sourceNodes = project.templateFidelity.slides[project.outline.findIndex(item => item.id === outlineSlide.id)]?.nodes || [];
    const omittable = new Set(sourceNodes.filter(node => ['image', 'chart', 'table'].includes(node.type) ||
      (node.type === 'text' && project.templateFidelity.slides[project.outline.findIndex(item => item.id === outlineSlide.id)]?.slots.some(slot => slot.shapeId === node.nativeRef?.shapeId && slot.role === 'content')))
      .map(node => String(node.nativeRef.shapeId)));
    slide.templateOmissions = (Array.isArray(value?.omitTemplateShapes) ? value.omitTemplateShapes : [])
      .filter(item => item && omittable.has(String(item.shapeId)) && String(item.reason || '').trim().length >= 8)
      .slice(0, 40).map(item => ({ shapeId: Number(item.shapeId), reason: String(item.reason).trim().slice(0, 180) }));
    slide.templateOmissions.push(...autoTemplateMediaOmissions(project, project.outline.findIndex(item => item.id === outlineSlide.id), slide.templateOmissions));
  }
  if (prepared?.layoutId === undefined && !resolvedDistributionLayout) { delete slide.layoutId; delete slide.layoutRef; }
  return slide;
}
function applySourceImages(deck, source) {
  const images = source?.images || [];
  if (!images.length || !deck?.slides?.length) return deck;
  // Place source images only on pages that explicitly request an image. An
  // incidental attachment must not consume an unrelated page's copy area.
  const slides = deck.slides.map(({ nodes: _nodes, nodeOrder: _nodeOrder, ...slide }) => ({ ...slide, blocks: [...(slide.blocks || [])] }));
  const targets = slides.filter(slide => slide.layoutId === 'image-text' && slide.blocks.length < 2);
  if (!targets.length) return deck;
  for (let index = 0; index < images.length; index++) {
    const slide = targets[Math.floor(index / 2) % targets.length];
    if (slide.blocks.length >= 2) continue;
    slide.blocks.push(images[index]);
    slide.layout = 'visual-first';
  }
  return { ...deck, slides };
}

function persistDagNode(uid, id, nodeId, status, patch = {}) {
  const project = store.get(uid, id);
  if (!project) return null;
  try { return transitionNode(project, nodeId, status === 'done' ? 'completed' : status, patch, { useInput: true }).project.dagNodes[nodeId]; }
  catch {
    project.dagNodes ||= {};
    project.dagNodes[nodeId] = nodeRecord(status, project.dagNodes[nodeId], patch);
    store.save(project);
    return project.dagNodes[nodeId];
  }
}

function ensureProjectTemplate(project) {
  if (!project) return project;
  if (project.templateSpec?.fonts && project.templateSpec?.palette) return project;
  const template = templateFor(project.uid, project.template, store);
  project.templateSpec = snapshotTemplate(template);
  return project;
}

function deterministicGate(project, modelReview = project.quality?.modelReview || { missing: [], repeated: [], conflicts: [], unsupported: [] }) {
  project = ensureProjectTemplate(project);
  const initial = deterministicReview(project);
  const repaired = repairProject(project, initial);
  const report = finalQualityReport(repaired.review, repaired.repairs, modelReview);
  repaired.project.quality = report;
  return repaired.project;
}
function qualityError(project) {
  return project.quality?.deterministic?.issues?.filter(item => item.severity === 'error').slice(0, 3).map(item => item.message).join('；') || '';
}
function fail(uid, id, stage, error, log) {
  const p = store.get(uid, id);
  if (!p) return;
  if (p.status === 'cancelled') return;
  p.status = 'failed'; p.stage = stage;
  p.error = String(error?.message || error).slice(0, 400);
  store.save(p);
  try { transitionNode(p, stage, 'failed', { error: p.error }); emitRunProgress(p, 'run.failed', { stage, error: p.error }); } catch {}
  log(`ppt ${id} ${stage} failed: ${p.error}`);
}
function startIngest(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  void (async () => {
    let next = false;
    try {
      const p = store.get(uid, id);
      if (!p || p.status !== 'ingesting') return;
      try { transitionNode(p, 'source', 'running'); } catch {}
      let source;
      let baseSource = null;
      if (p.update) {
        const parts = [];
        if (p.update.baseFile) { baseSource = await deps.extractFile(p, p.update.baseFile.name, store.readInput(uid, id, 'base')); parts.push({ origin: 'base', info: baseSource }); }
        else if (p.update.baseSnapshot.deck) parts.push({ origin: 'base', info: sourceFromDeck(p.update.baseSnapshot) });
        else if (p.update.baseSnapshot.source) parts.push({ origin: 'base', info: p.update.baseSnapshot.source });
        if (p.update.progressKind === 'file') parts.push({ origin: 'progress', info: await deps.extractFile(p, p.update.progressFile.name, store.readInput(uid, id, 'progress')) });
        else if (p.update.progressKind === 'paste') parts.push({ origin: 'progress', info: p.update.progressSource });
        else parts.push({ origin: 'progress', info: normalizePaste(p.update.progressText) });
        source = mergeSources(parts);
      } else source = await deps.extractFile(p, p.source.name, store.readSource(uid, id));
      const latest = store.get(uid, id);
      if (!latest || latest.status !== 'ingesting') return;
      if (baseSource) latest.update.baseSnapshot.source = baseSource;
      latest.source = withSemanticIndex(source); latest.status = 'outlining'; latest.stage = 'outline'; latest.error = '';
      latest.inputProfile = profilePptInput(latest);
      latest.contentPlan = planSparseInput(latest, latest.inputProfile);
      if (latest.pageDecision?.source === 'estimate' && !latest.requestedOutline) {
        const suggestion = estimatePageRecommendation(latest);
        const reuseCount = latest.templateFidelity?.originalSlideCount || latest.templateFidelity?.slides?.length;
        const reuseError = latest.templateFidelity?.mode === 'preserve' && reuseCount
          ? templateReuseError(reuseCount, suggestion.recommended) : null;
        if (!reuseError) {
          latest.pages = suggestion.recommended;
          latest.pageDecision = { ...latest.pageDecision, finalPageCount: latest.pages,
            estimationBasis: suggestion.estimationBasis, estimatedAfterIngest: true };
        }
      }
      store.save(latest); next = true;
      try { transitionNode(latest, 'source', 'completed', { segments: source.segments?.length || 0 }); } catch {}
    } catch (error) { fail(uid, id, 'ingest', error, log); }
    finally { running.delete(id); if (next) startOutline(uid, id, activity, log, deps); }
  })();
}
function startOutline(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  let generateAfterOutline = false;
  void (async () => {
    try {
      const p = store.get(uid, id);
      if (!p || p.status !== 'outlining') return;
      if (p.source?.segments?.length && !p.source.semantic) { p.source = withSemanticIndex(p.source); store.save(p); }
      try { transitionNode(p, 'outline', 'running'); } catch {}
      let rawOutline = p.requestedOutline
        ? { slides: p.requestedOutline, brief: null, storyArc: null, coverage: [] }
        : await deps.modelCall(p, outlinePrompt(p), activity, log);
      let outline = normalizeOutline(rawOutline, p.pages, p.source, p.update, p.deckTitle);
      if (!p.requestedOutline) {
        const initialPlanning = buildPlanning(p, rawOutline, outline);
        const initialIssues = [...inspectReportOutline(p, outline, initialPlanning.brief), ...inspectLongDeckOutline(p, outline)];
        const repairableIssues = initialIssues.filter(item => item.repairable !== false);
        if (repairableIssues.length) {
          const repairPrompt = `${outlinePrompt(p)}\n初稿结构检查：${JSON.stringify(initialIssues.map(item => ({ code: item.code, message: item.message })))}。请在相同页数和有效来源编号内修订大纲，不改变用户锁定的标题，不虚构事实或证据。初稿：${JSON.stringify(rawOutline).slice(0, 14000)}。返回完整的同一 JSON schema。`;
          try {
            const revisedRaw = await deps.modelCall(p, repairPrompt, activity, log);
            const revisedOutline = normalizeOutline(revisedRaw, p.pages, p.source, p.update, p.deckTitle);
            const revisedPlanning = buildPlanning(p, revisedRaw, revisedOutline);
            if (revisedPlanning.brief.reportMode === initialPlanning.brief.reportMode &&
                [...inspectReportOutline(p, revisedOutline, revisedPlanning.brief), ...inspectLongDeckOutline(p, revisedOutline)].length < initialIssues.length) {
              rawOutline = revisedRaw; outline = revisedOutline;
            }
          } catch (error) { log(`ppt ${id} outline revision skipped: ${String(error?.message || error).slice(0, 180)}`); }
        }
      }
      const current = store.get(uid, id);
      if (!current || current.status !== 'outlining') return;
      current.outline = outline; rescheduleTemplateFidelity(current);
      current.status = current.autoGenerate ? 'generating' : 'outline_ready'; current.stage = current.autoGenerate ? 'content' : 'outline'; current.error = '';
      if (current.deckTitle?.source !== 'user') {
        current.deckTitle = { text: outline[0]?.title || current.title, raw: outline[0]?.title || current.title, source: 'agent', locked: false };
      }
      current.planning = buildPlanning(current, rawOutline, outline);
      current.diff = diffSummary(current);
      generateAfterOutline = Boolean(current.autoGenerate);
      delete current.autoGenerate;
      delete current.requestedOutline;
      delete current.outlineSeed;
      store.save(current);
      try { transitionNode(current, 'outline', 'completed', { slideCount: outline.length }); emitRunProgress(current, 'outline.ready', { outline }); } catch {}
    } catch (error) { fail(uid, id, 'outline', error, log); }
    finally { running.delete(id); if (generateAfterOutline) startGeneration(uid, id, activity, log, deps); }
  })();
}
function startGeneration(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  void (async () => {
    try {
      const p = ensureProjectTemplate(store.get(uid, id));
      if (!p || p.status !== 'generating') return;
      try { emitRunProgress(p, 'generation.started', { slideCount: p.outline.length }); } catch {}
      p.stage = 'source-check'; p.nodes ||= {}; p.dagNodes ||= {}; store.save(p);
      if (p.update?.baseSnapshot?.deck) {
        for (const slide of p.outline.filter(slide => slide.change === 'keep' && slide.baseSlideId)) {
          if (p.nodes[slide.id]?.status === 'done') continue;
          const original = p.update.baseSnapshot.deck.slides.find(item => item.id === slide.baseSlideId);
          if (original) {
            p.nodes[slide.id] = { status: 'done', attempts: 0, slide: { ...original, id: slide.id, sourceRefs: slide.refs } };
            p.dagNodes[dagNodeId('content', slide.id)] = nodeRecord('done', p.dagNodes[dagNodeId('content', slide.id)], { reused: true });
          }
        }
        store.save(p);
      }
      // Older snapshots persisted completed page content in project.nodes but
      // did not always mirror it into the durable Run DAG. Reconcile before
      // scheduling so recovery and cross-device progress report the same work.
      for (const slide of p.outline.filter(item => p.nodes?.[item.id]?.status === 'done')) {
        const latest = store.get(uid, id);
        const nodeId = dagNodeId('content', slide.id);
        if (latest?.nodes?.[slide.id]?.status === 'done' && !['done', 'completed'].includes(latest.dagNodes?.[nodeId]?.status))
          transitionNode(latest, nodeId, 'completed', { slideId: slide.id, recovered: true }, { useInput: true });
      }

      await boundedAll(p.outline, PPT_NODE_CONCURRENCY, async (slide) => {
        const nodeId = dagNodeId('source', slide.id);
        const existing = store.get(uid, id)?.dagNodes?.[nodeId];
        if (['done', 'completed'].includes(existing?.status)) return existing.result;
        persistDagNode(uid, id, nodeId, 'running');
        const latest = store.get(uid, id);
        const issues = inspectSourceForSlide(latest, slide);
        const hard = issues.filter(item => item.severity === 'error');
        persistDagNode(uid, id, nodeId, 'done', { result: { passed: hard.length === 0, issues } });
        return issues;
      });
      const checkedSource = store.get(uid, id);
      if (p.outline.some(slide => !['done', 'completed'].includes(checkedSource?.dagNodes?.[dagNodeId('source', slide.id)]?.status)))
        throw new Error('source DAG is incomplete; resume pending page checks before publishing');

      const contentSlides = p.outline.map((slide, index) => ({ slide, index })).filter(({ slide }) => store.get(uid, id)?.nodes?.[slide.id]?.status !== 'done');
      const sourceImages = p.source?.images || [];
      const readyNodes = [
        ...contentSlides.map(item => ({ kind: 'content', ...item })),
        ...sourceImages.map((image, index) => ({ kind: 'media', image, index })),
      ];
      await boundedAll(readyNodes, PPT_NODE_CONCURRENCY, async (work) => {
        if (work.kind === 'media') {
          const targetIndex = p.outline.length > 1 ? 1 + Math.floor(work.index / 2) % (p.outline.length - 1) : 0;
          const slideId = p.outline[targetIndex].id;
          const nodeId = dagNodeId('media', work.image.id);
          const existing = store.get(uid, id)?.dagNodes?.[nodeId];
          if (['done', 'completed'].includes(existing?.status)) return existing.result;
          persistDagNode(uid, id, nodeId, 'running', { slideId });
          const issues = inspectMedia(work.image, slideId);
          const hard = issues.filter(item => item.severity === 'error');
          persistDagNode(uid, id, nodeId, 'done', { result: { slideId, passed: hard.length === 0, issues } });
          return issues;
        }
        const { slide, index } = work;
        const nodeId = dagNodeId('content', slide.id);
        const snapshot = store.get(uid, id);
        if (!snapshot || snapshot.status !== 'generating') throw new Error('generation stopped');
        if (snapshot.nodes?.[slide.id]?.status === 'done') return snapshot.nodes[slide.id].slide;
        snapshot.stage = 'content'; snapshot.nodes ||= {};
        snapshot.nodes[slide.id] = { status: 'running', attempts: (snapshot.nodes[slide.id]?.attempts || 0) + 1 };
        transitionNode(snapshot, nodeId, 'running', { slideId: slide.id }, { useInput: true });
        try {
          const previousTitles = snapshot.outline.slice(0, index).map(item => item.title);
          let content = normalizeSlide(await deps.modelCall(snapshot, contentPrompt(snapshot, slide, index), activity, log, { nodeKey: nodeId }), slide, snapshot, previousTitles);
          const contract = snapshot.planning?.slidePlan?.find(item => item.slideId === slide.id);
          const copyIssues = [
            ...inspectSlideCopy(content, contract, index, snapshot.outline.length,
              { templatePreserved: snapshot.templateFidelity?.mode === 'preserve' }).filter(item => ['rewrite_title', 'expand_support', 'redistribute'].includes(item.repair)),
            ...inspectTemplateSlotDraft(snapshot, index, content),
            ...missingRequiredEvidence(snapshot, content, contract).map(atom => ({ code: 'required_evidence_missing', severity: 'error',
              message: `锁定证据 ${atom.id} 尚未出现在可见页面：${atom.exactText.slice(0, 180)}`, repair: 'expand_support', missingSupport: [atom.id] })),
          ];
          // A bounded local rewrite is still the same durable content node: it
          // does not add a DAG stage or restart other completed slides.
          if (copyIssues.length) {
            content = normalizeSlide(await deps.modelCall(snapshot, contentRepairPrompt(snapshot, slide, index, content, copyIssues), activity, log,
              { nodeKey: `${nodeId}:repair` }), slide, snapshot, previousTitles);
            content.localRepair = { attempts: 1, reasons: copyIssues.map(item => item.code) };
          }
          const latest = store.get(uid, id);
          if (!latest || latest.status !== 'generating') throw new Error('generation stopped');
          latest.nodes[slide.id] = { ...latest.nodes[slide.id], status: 'done', slide: content };
          if (index === 0 && latest.deckTitle?.source !== 'user') {
            latest.deckTitle = { text: content.title, raw: content.title, source: 'agent', locked: false };
          }
          transitionNode(latest, nodeId, 'completed', { slideId: slide.id }, { useInput: true });
          return content;
        } catch (error) {
          persistDagNode(uid, id, nodeId, 'failed', { error: String(error?.message || error).slice(0, 300) });
          throw error;
        }
      });

      let current = store.get(uid, id);
      if (!current || current.status !== 'generating') return;
      current.deck = applyLayoutRegistry(applySourceImages({ schemaVersion: 2, slides: current.outline.map((s) => current.nodes[s.id].slide) }, current.source));
      current.deck = ensureDeckV3(current.deck);
      bindTemplateFidelity(current);
      enrichAssetRefs(current);
      current.renderTree = buildRenderTree(current);
      current.stage = 'review'; store.save(current);
      try { transitionNode(current, 'content', 'completed'); transitionNode(current, 'media', 'completed'); transitionNode(current, 'layout', 'completed'); transitionNode(current, 'preview', 'completed'); transitionNode(current, 'quality', 'running'); } catch {}

      const initialReview = deterministicReview(current);
      const reviewNodeId = 'review:deck';
      let modelReview = current.quality?.modelReview || current.dagNodes?.[reviewNodeId]?.result;
      if (!modelReview) {
        persistDagNode(uid, id, reviewNodeId, 'running');
        const reviewStarted = Date.now();
        try {
          const rawReview = await deps.modelCall(current, deckReviewPrompt(current), activity, log, { nodeKey: reviewNodeId });
          modelReview = normalizeModelReview(rawReview, current.deck.slides.map(slide => slide.id));
          persistDagNode(uid, id, reviewNodeId, 'done', { durationMs: Date.now() - reviewStarted, result: modelReview });
        } catch (error) {
          persistDagNode(uid, id, reviewNodeId, 'failed', { durationMs: Date.now() - reviewStarted, error: String(error?.message || error).slice(0, 300) });
          throw error;
        }
      }

      current = store.get(uid, id);
      current.stage = 'repair'; store.save(current);
      try { transitionNode(current, 'quality', 'completed'); transitionNode(current, 'review', 'completed'); transitionNode(current, 'repair', 'running'); } catch {}
      const repaired = repairProject(current, initialReview);
      current = repaired.project;
      const reviewDuration = current.dagNodes?.[reviewNodeId]?.durationMs || 0;
      current.quality = finalQualityReport(repaired.review, repaired.repairs, modelReview, { reviewMs: reviewDuration });
      current.stage = 'publish'; store.save(current);
      try { transitionNode(current, 'repair', 'completed'); } catch {}
      if (current.quality.status === 'blocked') {
        current.status = 'quality_blocked'; current.stage = 'repair';
        current.error = `PPT quality gate blocked publish: ${qualityError(current) || current.quality.modelIssues?.find(item => item.severity === 'error')?.detail || 'content review failed'}`;
        store.save(current);
        return;
      }
      persistDagNode(uid, id, 'publish:deck', 'running');
      const exportInfo = await deps.renderPptx(current);
      const finished = store.get(uid, id);
      if (!finished || finished.status !== 'generating') return;
      finished.exportBytes = exportInfo.bytes; finished.status = 'completed'; finished.stage = 'completed';
      finished.dagNodes['publish:deck'] = nodeRecord('done', finished.dagNodes['publish:deck'], { bytes: exportInfo.bytes });
      finished.error = ''; finished.revision = Math.max(1, Number(finished.revision || 0)); finished.draftRevision = finished.revision;
      finished.publishedRevision = finished.revision; finished.renderTree = buildRenderTree(finished); saveStructuredProject(finished); saveRevision(finished, 'initial-publish');
      try { transitionNode(finished, 'publish:deck', 'completed', { bytes: exportInfo.bytes }); transitionNode(finished, 'publish', 'completed', { bytes: exportInfo.bytes }); completeRun(finished, { revision: finished.revision }); } catch {}
    } catch (error) { fail(uid, id, 'generation', error, log); }
    finally { running.delete(id); }
  })();
}

export function recoverPptJobs(activity, log = () => {}, deps = defaultDeps) {
  for (const p of store.listPending()) {
    try { recoverRun(ensureProjectV3(p)); } catch {}
    if (p.status === 'ingesting') startIngest(p.uid, p.id, activity, log, deps);
    else if (p.status === 'outlining') startOutline(p.uid, p.id, activity, log, deps);
    else startGeneration(p.uid, p.id, activity, log, deps);
  }
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 24_000_000) throw new HttpError(413, 'request too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const data = JSON.parse(raw || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
    return data;
  } catch { throw new HttpError(400, 'invalid JSON object'); }
}

function folderName(value) { return bounded(value, 80, 'folder name'); }
function folderExists(uid, id) { return store.listFolders(uid).some(folder => folder.id === id); }
function folderSummary(uid) {
  const projects = store.list(uid).filter(project => !project.deletedAt);
  return sortManual(store.listFolders(uid).map(folder => ({ ...folder, count: projects.filter(project => project.folderId === folder.id).length })),
    (a, b) => a.name.localeCompare(b.name));
}
function listProjects(uid, url) {
  let projects = store.list(uid);
  const trash = url.searchParams.get('trash') === '1';
  projects = projects.filter(project => Boolean(project.deletedAt) === trash);
  const q = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  if (q) projects = projects.filter(project => `${project.title} ${(project.tags || []).join(' ')}`.toLocaleLowerCase().includes(q));
  if (url.searchParams.get('favorite') === '1') projects = projects.filter(project => project.favorite);
  if (url.searchParams.get('status')) projects = projects.filter(project => project.status === url.searchParams.get('status'));
  if (url.searchParams.has('folderId')) projects = projects.filter(project => (project.folderId || '') === url.searchParams.get('folderId'));
  const sort = url.searchParams.get('sort') || 'updated';
  const order = { manual: (a, b) => b.updatedAt.localeCompare(a.updatedAt), updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt), created: (a, b) => b.createdAt.localeCompare(a.createdAt), name: (a, b) => a.title.localeCompare(b.title) }[sort];
  if (!order) throw new HttpError(400, 'invalid sort mode');
  return (sort === 'manual' ? sortManual(projects, order) : projects.sort((a, b) => Number(b.pinned) - Number(a.pinned) || order(a, b)))
    .map(({ source, nodes, update, updateRequest, ...project }) => ({
      ...project,
      source: source ? { kind: source.kind, name: source.name, extension: source.extension } : null,
      deck: project.deck ? { slides: project.deck.slides.slice(0, 1).map(slide => ({ title: slide.title })) } : null,
      outline: project.outline?.slice(0, 1).map(slide => ({ title: slide.title })) || [],
    }));
}
async function permanentlyRemove(project, deps = defaultDeps) {
  if (running.has(project.id) || editing.has(project.id)) throw new HttpError(409, 'project has an active job');
  await deps.removeContainer(project.id, { keepVolume: false });
  store.remove(project.uid, project.id);
}
function setMetadata(project, data) {
  if (data.title !== undefined) {
    const title = bounded(data.title, 160, 'title');
    if (title === project.title) throw new HttpError(400, 'name is unchanged');
    project.title = title;
  }
  if (data.favorite !== undefined) {
    if (typeof data.favorite !== 'boolean') throw new HttpError(400, 'favorite must be boolean');
    project.favorite = data.favorite;
  }
  if (data.pinned !== undefined) {
    if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean');
    project.pinned = data.pinned;
  }
  if (data.folderId !== undefined) {
    if (data.folderId !== null && (typeof data.folderId !== 'string' || !folderExists(project.uid, data.folderId))) throw new HttpError(400, 'folder does not exist');
    project.folderId = data.folderId;
  }
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags) || data.tags.length > 10) throw new HttpError(400, 'invalid tags');
    project.tags = [...new Set(data.tags.map(tag => bounded(tag, 40, 'tag')))];
  }
  return store.save(project);
}
function createFolder(uid, name) {
  const folders = store.listFolders(uid);
  const value = folderName(name);
  if (folders.some(folder => folder.name.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new HttpError(409, 'folder name already exists');
  const folder = { id: store.newId(), name: value, pinned: false, createdAt: new Date().toISOString() };
  store.saveFolders(uid, [...folders, folder]);
  return folder;
}
function decodeFile(name, encoded, validator = validateFile) {
  if (typeof encoded !== 'string' || encoded.length > 11_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HttpError(400, 'invalid file payload');
  const bytes = Buffer.from(encoded, 'base64');
  let extension;
  try { extension = validator(name, bytes); } catch (error) { throw new HttpError(400, error.message); }
  return { bytes, extension, name, sha256: sha256(bytes) };
}
function resolveTemplate(uid, id) {
  try { return templateFor(uid, id, store); }
  catch (error) { throw new HttpError(400, error.message); }
}
function templateList(uid, url) {
  const pins = new Set(store.listTemplatePins(uid));
  let rows = [...BUILT_INS.map(item => ({ ...item, pinned: pins.has(item.id) })), ...store.listTemplates(uid)];
  const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  if (query) rows = rows.filter(item => `${item.name} ${item.category} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLocaleLowerCase().includes(query));
  const category = url.searchParams.get('category');
  if (category && category !== '全部') rows = rows.filter(item => item.category === category);
  return rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}
async function handleTemplates(req, id, uid, url, send, deps) {
  const customs = store.listTemplates(uid);
  if (!id && req.method === 'GET') return send(200, { templates: templateList(uid, url) });
  if (!id && req.method === 'POST') {
    const data = await body(req);
    if (customs.length >= 30) throw new HttpError(409, 'template limit is 30');
    const upload = decodeFile(data.fileName, data.fileBase64, validateTemplate);
    const templateId = store.newId();
    let analysis;
    try { analysis = await deps.analyzeTemplate(uid, templateId, upload.extension, upload.bytes); }
    catch (error) { throw new HttpError(422, String(error?.message || error).slice(0, 300)); }
    finally { await deps.removeContainer(templateId, { keepVolume: false }).catch(() => {}); }
    if (!analysis || !['mapped', 'reference'].includes(analysis.compatibility) || !Number.isInteger(analysis.pages) || analysis.pages < 1 || analysis.pages > 100) throw new HttpError(422, 'template analysis is invalid');
    const palette = analysis.compatibility === 'mapped' ? analysis.palette : null;
    if (palette && ['background', 'accent', 'foreground', 'muted'].some(key => !/^#[a-f0-9]{6}$/i.test(palette[key] || ''))) throw new HttpError(422, 'template colors are invalid');
    const fonts = analysis.compatibility === 'mapped' ? analysis.fonts : null;
    if (fonts && ['title', 'body', 'titleEastAsia', 'bodyEastAsia'].some(key => typeof fonts[key] !== 'string' || !fonts[key].trim() || fonts[key].length > 120)) throw new HttpError(422, 'template fonts are invalid');
    if (analysis.compatibility === 'mapped' && !fonts) throw new HttpError(422, 'mapped template must include extracted fonts');
    const item = { id: templateId, name: bounded(data.name || data.fileName.replace(/\.[^.]+$/, ''), 120, 'template name'), category: '我的模板',
      description: String(analysis.reason || '').slice(0, 300), kind: 'uploaded', compatibility: analysis.compatibility, version: 1,
      pages: analysis.pages, palette, fonts, sampleTitles: (analysis.sampleTitles || []).slice(0, 3), tags: ['自定义', '上传'], pinned: false,
      fileName: data.fileName, extension: upload.extension, sha256: upload.sha256, createdAt: new Date().toISOString() };
    store.writeTemplate(uid, templateId, upload.bytes);
    store.saveTemplates(uid, [...customs, item]);
    return send(201, { template: item });
  }
  const builtIn = BUILT_INS.find(row => row.id === id);
  if (builtIn && req.method === 'PATCH') {
    const data = await body(req);
    if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean');
    const pins = new Set(store.listTemplatePins(uid));
    if (data.pinned) pins.add(id); else pins.delete(id);
    store.saveTemplatePins(uid, [...pins]);
    return send(200, { template: { ...builtIn, pinned: data.pinned } });
  }
  const item = customs.find(row => row.id === id);
  if (!item) return send(404, { error: 'template not found' });
  if (req.method === 'PATCH') {
    const data = await body(req);
    if (data.pinned !== undefined) { if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean'); item.pinned = data.pinned; }
    if (data.name !== undefined) item.name = bounded(data.name, 120, 'template name');
    store.saveTemplates(uid, customs);
    return send(200, { template: item });
  }
  if (req.method === 'DELETE') {
    store.saveTemplates(uid, customs.filter(row => row.id !== id));
    store.removeTemplate(uid, id);
    return send(200, { ok: true });
  }
  return send(404, { error: 'not found' });
}
function diffSummary(project) {
  if (!project.update) return null;
  const used = new Set(project.outline.map(slide => slide.baseSlideId).filter(Boolean));
  return { kept: project.outline.filter(slide => slide.change === 'keep').length,
    rewritten: project.outline.filter(slide => slide.change === 'rewrite').length,
    added: project.outline.filter(slide => slide.change === 'add').length,
    removed: (project.update.baseSnapshot.deck?.slides || []).filter(slide => !used.has(slide.id)).map(slide => ({ id: slide.id, title: slide.title })) };
}
async function handleUpdates(req, uid, send, activity, log, deps) {
  if (req.method !== 'POST') return send(404, { error: 'not found' });
  const data = await body(req);
  const requestId = data.requestId === undefined ? null : bounded(data.requestId, 80, 'requestId');
  if (requestId && !/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new HttpError(400, 'invalid requestId');
  const requestHash = requestId ? sha256(Buffer.from(JSON.stringify({ ...data, requestId: undefined }))) : null;
  if (requestId) {
    const prior = store.list(uid).find(item => item.updateRequest?.id === requestId);
    if (prior) {
      if (prior.updateRequest.hash !== requestHash) throw new HttpError(409, 'requestId was used for different inputs');
      return send(200, { project: prior });
    }
  }
  if (store.list(uid).filter(item => !item.deletedAt).length >= 50) throw new HttpError(409, 'workspace limit is 50 presentations');
  if (Boolean(data.baseProjectId) === Boolean(data.baseFileBase64)) throw new HttpError(400, 'choose exactly one base version');
  if (data.baseProjectId && (typeof data.baseProjectId !== 'string' || !/^[a-f0-9]{32}$/.test(data.baseProjectId))) throw new HttpError(400, 'invalid base project id');
  let baseProject = null; let baseFile = null;
  if (data.baseProjectId) {
    baseProject = store.get(uid, data.baseProjectId);
    if (!baseProject || baseProject.deletedAt || baseProject.status !== 'completed') throw new HttpError(404, 'completed base presentation not found');
  } else baseFile = decodeFile(data.baseFileName, data.baseFileBase64);
  const progressKind = data.progressKind || 'prompt';
  if (!['prompt', 'paste', 'file'].includes(progressKind)) throw new HttpError(400, 'invalid progress kind');
  const progressFile = progressKind === 'file' ? decodeFile(data.progressFileName, data.progressFileBase64) : null;
  const progressText = progressKind === 'file' ? '' : bounded(data.progressText, progressKind === 'paste' ? 80000 : MAX_PROMPT, 'latest progress');
  const progressSource = progressKind === 'paste' ? normalizePaste(progressText) : null;
  const template = resolveTemplate(uid, data.template || baseProject?.template || 'violet');
  const baseSnapshot = baseProject ? { id: baseProject.id, title: baseProject.title, deck: structuredClone(baseProject.deck), outline: structuredClone(baseProject.outline), source: null, revision: baseProject.revision }
    : { id: null, title: baseFile.name.replace(/\.[^.]+$/, ''), deck: null, outline: [], source: null, revision: 0 };
  const rootId = baseProject?.version?.rootId || baseProject?.id || null;
  const nextVersion = rootId ? Math.max(1, ...store.list(uid).filter(item => item.version?.rootId === rootId).map(item => item.version.number || 1)) + 1 : 1;
  const updateTitle = typeof data.title === 'string' && data.title.trim() ? bounded(data.title, 160, 'title') : '';
  const formattedUpdateTitle = updateTitle ? formatUserDeckTitle(updateTitle) : null;
  const id = store.newId();
  const update = { baseSnapshot, baseFile: baseFile && { name: baseFile.name, extension: baseFile.extension, sha256: baseFile.sha256 },
    progressKind, progressText, progressSource, progressFile: progressFile && { name: progressFile.name, extension: progressFile.extension, sha256: progressFile.sha256 } };
  const mustIngest = Boolean(baseFile || progressFile);
  const source = mustIngest ? null : mergeSources([{ origin: 'base', info: sourceFromDeck(baseSnapshot) },
    { origin: 'progress', info: progressSource || normalizePaste(progressText) }]);
  const estimateSource = source || { kind: 'file', bytes: (baseFile?.bytes?.length || 0) + (progressFile?.bytes?.length || 0), text: progressText };
  const count = pages(data.pages ?? Math.max(6, estimatePageRecommendation({ inputKind: 'update', source: estimateSource, prompt: progressText }).recommended));
  if (count < 6) throw new HttpError(400, 'update pages must be between 6 and 100');
  if (template.kind === 'uploaded' && template.extension === 'pptx' && data.templateMode !== 'mapped') {
    const reuseError = templateReuseError(template.pages, count);
    if (reuseError) throw new HttpError(400, reuseError);
  }
  const project = { id, uid, title: updateTitle || `${baseSnapshot.title} · 更新版`.slice(0, 160), prompt: progressText || progressFile.name, pages: count,
    deckTitle: updateTitle ? { text: formattedUpdateTitle.title, raw: updateTitle, source: 'user', locked: true } : { text: '', raw: '', source: 'agent', locked: false },
    template: template.id, templateSpec: snapshotTemplate(template), inputKind: 'update',
    update, updateRequest: requestId ? { id: requestId, hash: requestHash } : null,
    version: { rootId: rootId || id, parentId: baseProject?.id || null, number: nextVersion, baseFileName: baseFile?.name || null }, source,
    sourceRevision: 1, outlineRevision: 0, status: mustIngest ? 'ingesting' : 'outlining', stage: mustIngest ? 'ingest' : 'outline',
    model: typeof data.model === 'string' ? data.model.slice(0, 120) : '', configId: bounded(data.configId, 120, 'configId'),
    outline: [], deck: null, nodes: {}, revision: 0, favorite: false, pinned: false, folderId: baseProject?.folderId || null,
    tags: ['更新', template.name.slice(0, 40)].slice(0, 10), deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (template.kind === 'uploaded' && template.extension === 'pptx' && data.templateMode !== 'mapped' && deps.prepareTemplateFidelity) {
    project.templateFidelity = await deps.prepareTemplateFidelity(project, store.readTemplate(uid, template.id), template.sha256);
  }
  if (baseFile) store.writeInput(uid, id, 'base', baseFile.bytes);
  if (progressFile) store.writeInput(uid, id, 'progress', progressFile.bytes);
  store.save(project);
  if (mustIngest) startIngest(uid, id, activity, log, deps); else startOutline(uid, id, activity, log, deps);
  return send(201, { project });
}
async function handleFolders(req, id, uid, send) {
  const folders = store.listFolders(uid);
  if (!id) {
    if (req.method === 'GET') return send(200, { folders: folderSummary(uid) });
    if (req.method === 'POST') return send(201, { folder: createFolder(uid, (await body(req)).name) });
    return send(404, { error: 'not found' });
  }
  const folder = folders.find(item => item.id === id);
  if (!folder) return send(404, { error: 'not found' });
  if (req.method === 'PATCH') {
    const data = await body(req);
    if (data.name !== undefined) {
      const value = folderName(data.name);
      if (value === folder.name) throw new HttpError(400, 'name is unchanged');
      if (folders.some(item => item.id !== id && item.name.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new HttpError(409, 'folder name already exists');
      folder.name = value;
    }
    if (data.pinned !== undefined) {
      if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean');
      folder.pinned = data.pinned;
    }
    store.saveFolders(uid, folders);
    return send(200, { folder });
  }
  if (req.method === 'DELETE') {
    for (const project of store.list(uid).filter(project => project.folderId === id)) { project.folderId = null; store.save(project); }
    store.saveFolders(uid, folders.filter(item => item.id !== id));
    return send(200, { ok: true });
  }
  return send(404, { error: 'not found' });
}

async function handleFolderOrder(req, uid, send) {
  if (req.method !== 'POST') return send(404, { error: 'not found' });
  const data = await body(req);
  const folders = store.listFolders(uid);
  let group;
  try { group = reorderManual(folders, data.movedId, data.targetId, data.position,
    (a, b) => a.name.localeCompare(b.name)); }
  catch (error) { throw new HttpError(409, error.message); }
  store.saveFolders(uid, folders);
  return send(200, { folders: folderSummary(uid), order: group.map(item => item.id) });
}

async function handleProjectOrder(req, uid, send) {
  if (req.method !== 'POST') return send(404, { error: 'not found' });
  const data = await body(req);
  const projects = store.list(uid).filter(project => !project.deletedAt);
  let group;
  try { group = reorderManual(projects, data.movedId, data.targetId, data.position,
    (a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  catch (error) { throw new HttpError(409, error.message); }
  for (const project of group) store.save(project, { touch: false });
  return send(200, { order: group.map(item => item.id) });
}

async function handleBulk(req, uid, send, deps) {
  if (req.method !== 'POST') return send(404, { error: 'not found' });
  const data = await body(req);
  if (!Array.isArray(data.ids) || data.ids.length < 1 || data.ids.length > 100 || new Set(data.ids).size !== data.ids.length || data.ids.some(id => !/^[a-f0-9]{32}$/.test(id))) throw new HttpError(400, 'invalid project ids');
  const projects = data.ids.map(id => store.get(uid, id));
  if (projects.some(project => !project)) return send(404, { error: 'not found' });
  if (!['move', 'trash', 'restore', 'permanent'].includes(data.action)) throw new HttpError(400, 'invalid bulk action');
  if (data.action === 'move' && data.folderId !== null && !folderExists(uid, data.folderId)) throw new HttpError(400, 'folder does not exist');
  if (data.action === 'permanent' && projects.some(project => !project.deletedAt || running.has(project.id) || editing.has(project.id))) throw new HttpError(409, 'projects must be in trash and idle');
  if (data.action === 'restore' && store.list(uid).filter(project => !project.deletedAt).length + projects.filter(project => project.deletedAt).length > 50) throw new HttpError(409, 'workspace limit is 50 presentations');
  const at = new Date().toISOString();
  for (const project of projects) {
    if (data.action === 'move') project.folderId = data.folderId;
    if (data.action === 'trash') project.deletedAt = at;
    if (data.action === 'restore') project.deletedAt = null;
    if (data.action === 'permanent') await permanentlyRemove(project, deps);
    else store.save(project);
  }
  return send(200, { ok: true, count: projects.length });
}

export async function handlePpt(req, url, { uid, send, res, readBody, activity, log = () => {}, deps = defaultDeps }) {
  const structured = await handleStructuredPpt(req, url, { uid, send, res, readBody, activity, log, deps });
  if (structured) return true;
  const folderMatch = url.pathname.match(FOLDER_RE);
  const templateMatch = url.pathname.match(TEMPLATE_RE);
  const updates = url.pathname === '/ppt/updates';
  const bulk = url.pathname === '/ppt/projects/bulk';
  const projectOrder = url.pathname === '/ppt/projects/order';
  const folderOrder = url.pathname === '/ppt/folders/order';
  const match = url.pathname.match(PPT_RE);
  if (!match && !folderMatch && !templateMatch && !bulk && !updates && !projectOrder && !folderOrder) return false;
  const [, id, action] = match || [];
  try {
    if (folderOrder) return await handleFolderOrder(req, uid, send);
    if (projectOrder) return await handleProjectOrder(req, uid, send);
    if (folderMatch) return await handleFolders(req, folderMatch[1], uid, send);
    if (templateMatch) return await handleTemplates(req, templateMatch[1], uid, url, send, deps);
    if (updates) return await handleUpdates(req, uid, send, activity, log, deps);
    if (bulk) return await handleBulk(req, uid, send, deps);
    if (!id) {
      if (req.method === 'GET') return send(200, { projects: listProjects(uid, url) });
      if (req.method === 'POST') {
        const data = await body(req);
        if (store.list(uid).filter(project => !project.deletedAt).length >= 50) throw new HttpError(409, 'workspace limit is 50 presentations');
        const inputKind = data.inputKind || 'prompt';
        if (!['prompt', 'paste', 'file'].includes(inputKind)) throw new HttpError(400, 'invalid input kind');
        let source = null; let sourceBytes = null;
        if (inputKind === 'paste') {
          try { source = { ...normalizePaste(data.text), images: normalizeSourceImages(data.images) }; } catch (error) { throw new HttpError(400, error.message); }
        }
        if (inputKind === 'file') {
          if (typeof data.fileBase64 !== 'string' || data.fileBase64.length > 11_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.fileBase64)) throw new HttpError(400, 'invalid file payload');
          sourceBytes = Buffer.from(data.fileBase64, 'base64');
          let ext;
          try { ext = validateFile(data.fileName, sourceBytes); } catch (error) { throw new HttpError(400, error.message); }
          source = { kind: 'file', name: data.fileName, extension: ext, bytes: sourceBytes.length, sha256: sha256(sourceBytes), text: '', segments: [], truncated: false };
        }
        const prompt = inputKind === 'prompt' ? bounded(data.prompt, MAX_PROMPT, 'prompt') : bounded(data.prompt || source.name, MAX_PROMPT, 'prompt');
        const userTitle = typeof data.title === 'string' && data.title.trim() ? bounded(data.title, 160, 'title') : '';
        const title = bounded(userTitle || prompt.slice(0, 60), 160, 'title');
        const template = resolveTemplate(uid, data.template || 'violet');
        const inputProfile = profilePptInput({ inputKind, source, prompt });
        const contentPlan = planSparseInput({ inputKind, source, prompt }, inputProfile);
        const estimatedPages = estimatePageRecommendation({ inputKind, source, prompt, inputProfile, contentPlan }).recommended;
        const promptPageMatch = prompt.match(/(?:^|[^第\d])(\d{1,3})\s*(?:页|slides?)/i);
        const promptPages = promptPageMatch ? Number(promptPageMatch[1]) : undefined;
        const selectedPages = pages(data.pages ?? promptPages ?? estimatedPages);
        const requestedOutline = data.outline === undefined ? null : data.outline;
        if (requestedOutline !== null && (!Array.isArray(requestedOutline) || requestedOutline.length !== selectedPages)) throw new HttpError(400, 'outline must match the user-confirmed page count');
        const formattedUserTitle = userTitle ? formatUserDeckTitle(userTitle) : null;
        if (template.kind === 'uploaded' && template.extension === 'pptx' && data.templateMode !== 'mapped') {
          const reuseError = templateReuseError(template.pages, selectedPages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        const project = { id: store.newId(), uid, title, prompt, pages: selectedPages, inputProfile, contentPlan, template: template.id,
          templateSpec: snapshotTemplate(template), inputKind, source, sourceRevision: source ? 1 : 0, outlineRevision: 0,
          deckTitle: userTitle ? { text: formattedUserTitle.title, raw: userTitle, source: 'user', locked: true } : { text: '', raw: '', source: 'agent', locked: false },
          pageDecision: { finalPageCount: selectedPages, source: data.pages === undefined && promptPages === undefined ? 'estimate' : 'user',
            includesCover: true, confirmedAt: new Date().toISOString() },
          compressionApproved: data.compressionApproved === true,
          ...(requestedOutline ? { requestedOutline } : {}),
          model: typeof data.model === 'string' ? data.model.slice(0, 120) : '',
          configId: bounded(data.configId || (source?.extension === 'pptx' && data.importMode === 'editable' ? 'pptx-import' : ''), 120, 'configId'),
          status: sourceBytes ? 'ingesting' : 'outlining', stage: sourceBytes ? 'ingest' : 'outline', error: '', outline: [], deck: null, nodes: {}, revision: 0,
          favorite: false, pinned: false, folderId: null, tags: [], deletedAt: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (template.kind === 'uploaded' && template.extension === 'pptx' && data.templateMode !== 'mapped' && deps.prepareTemplateFidelity) {
          project.templateFidelity = await deps.prepareTemplateFidelity(project, store.readTemplate(uid, template.id), template.sha256);
        }
        if (sourceBytes) store.writeSource(uid, project.id, sourceBytes);
        store.save(project);
        const editableImport = Boolean(sourceBytes && source?.extension === 'pptx' && data.importMode === 'editable');
        if (editableImport) {
          startRun(ensureProjectV3(project), 'pptx-import');
          try {
            const imported = await importEditablePptx(project, sourceBytes, source.sha256);
            const analysis = await deps.analyzeTemplate(uid, project.id, 'pptx', sourceBytes);
            if (analysis?.fonts) imported.templateSpec.fonts = analysis.fonts;
            if (analysis?.palette) imported.templateSpec.palette = analysis.palette;
            imported.renderTree = buildRenderTree(imported); imported.status = 'completed'; imported.stage = 'completed'; imported.error = '';
            imported.revision = 1; imported.draftRevision = 1; imported.publishedRevision = 1;
            await renderImportedPptx(imported); saveStructuredProject(imported); saveRevision(imported, 'external-import');
            for (const nodeId of ['source', 'outline', 'content', 'media', 'layout', 'preview', 'quality', 'review', 'repair', 'publish']) transitionNode(imported, nodeId, 'completed');
            completeRun(imported, { imported: true, revision: 1 });
            return send(201, { project: getStructuredProject(uid, project.id) });
          } catch (error) {
            fail(uid, project.id, 'ingest', error, log); throw error;
          }
        }
        try {
          startRun(ensureProjectV3(project), sourceBytes ? 'ingest-and-generate' : 'generation');
          if (!sourceBytes) transitionNode(project, 'source', 'completed', { inputKind });
        } catch {}
        if (sourceBytes) startIngest(uid, project.id, activity, log, deps);
        else startOutline(uid, project.id, activity, log, deps);
        return send(201, { project: getStructuredProject(uid, project.id) || project });
      }
      return send(404, { error: 'not found' });
    }
    const project = getStructuredProject(uid, id, { persistMigration: true });
    if (!project) return send(404, { error: 'not found' });
    if (project.deletedAt && !['restore', 'permanent'].includes(action)) return send(404, { error: 'not found' });

    if (action === 'trash' && req.method === 'POST') {
      project.deletedAt = new Date().toISOString();
      return send(200, { project: store.save(project) });
    }
    if (action === 'restore' && req.method === 'POST') {
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 presentations' });
      project.deletedAt = null;
      return send(200, { project: store.save(project) });
    }
    if (action === 'permanent' && req.method === 'DELETE') {
      if (!project.deletedAt) return send(409, { error: 'move project to trash first' });
      await permanentlyRemove(project, deps);
      return send(200, { ok: true });
    }
    if (action === 'duplicate' && req.method === 'POST') {
      if (project.status !== 'completed') return send(409, { error: 'only completed presentations can be duplicated' });
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 presentations' });
      const copy = structuredClone(project);
      copy.id = store.newId(); copy.title = `${project.title} · 副本`.slice(0, 160);
      delete copy.update; delete copy.updateRequest; delete copy.diff;
      copy.version = { rootId: copy.id, parentId: null, number: 1 };
      copy.favorite = false; copy.pinned = false; copy.deletedAt = null;
      copy.status = 'generating'; copy.stage = 'rendering'; copy.error = ''; copy.revision = 0; copy.pdfRevision = 0;
      copy.createdAt = new Date().toISOString();
      copy.nodes = Object.fromEntries(copy.deck.slides.map(slide => [slide.id, { status: 'done', attempts: 0, slide }]));
      if (copy.source?.kind === 'file') store.writeSource(uid, copy.id, store.readSource(uid, id));
      store.save(copy);
      startGeneration(uid, copy.id, activity, log, deps);
      return send(202, { project: copy });
    }

    if (action === 'export' && req.method === 'GET') {
      if (project.status !== 'completed') return send(409, { error: 'presentation is not ready' });
      const { stream, size } = await deps.readFile(id, '/workspace/presentation.pptx');
      const safe = project.title.replace(/[\\/\r\n"<>|:*?]/g, '_').slice(0, 120) || 'presentation';
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-length': size, 'content-disposition': `attachment; filename="presentation.pptx"; filename*=UTF-8''${encodeURIComponent(safe)}.pptx` });
      stream.on('error', () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      res.on('close', () => { try { stream.destroy(); } catch {} });
      return true;
    }
    if (action === 'pdf' && req.method === 'GET') {
      if (project.status !== 'completed') return send(409, { error: 'presentation is not ready' });
      if (project.pdfRevision !== project.revision) {
        await deps.renderPdf(project);
        const latest = store.get(uid, id);
        if (latest?.revision === project.revision) { latest.pdfRevision = project.revision; store.save(latest); }
      }
      const { stream, size } = await deps.readFile(id, '/workspace/presentation.pdf');
      const safe = project.title.replace(/[\\/\r\n"<>|:*?]/g, '_').slice(0, 120) || 'presentation';
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': size,
        'content-disposition': `attachment; filename="presentation.pdf"; filename*=UTF-8''${encodeURIComponent(safe)}.pdf` });
      stream.on('error', () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      res.on('close', () => { try { stream.destroy(); } catch {} });
      return true;
    }
    if (action === 'versions' && req.method === 'GET') {
      const rootId = project.version?.rootId || project.id;
      const versions = store.list(uid).filter(item => !item.deletedAt && (item.id === rootId || item.version?.rootId === rootId))
        .map(item => ({ id: item.id, title: item.title, status: item.status, parentId: item.version?.parentId || null,
          number: item.version?.number || 1, updatedAt: item.updatedAt, pages: item.pages })).sort((a, b) => a.number - b.number);
      return send(200, { versions });
    }
    if (action === 'rewrite' && req.method === 'POST') {
      const data = await body(req);
      if (!['completed', 'quality_blocked'].includes(project.status)) throw new HttpError(409, 'presentation is not editable');
      if (editing.has(id)) throw new HttpError(409, 'another save is in progress');
      if (data.revision !== project.revision) throw new HttpError(409, 'presentation changed on another device; reload first');
      const slide = project.deck.slides.find(item => item.id === data.slideId);
      if (!slide) throw new HttpError(404, 'slide not found');
      const instruction = bounded(data.instruction, 1000, 'instruction');
      editing.add(id);
      try {
        const source = (project.source?.segments || []).filter(item => slide.sourceRefs?.includes(item.id)).map(item => `[${item.id}] ${item.text}`).join('\n').slice(0, 8000);
        const block = data.blockId ? (slide.blocks || []).find(item => item.id === data.blockId) : null;
        if (data.blockId && (!block || !['image', 'shape'].includes(block.type))) throw new HttpError(400, 'only image captions and shape labels can be rewritten');
        const prompt = block
          ? `你只改写一个演示文稿视觉元素的文字，不调用工具，不改图片、图表数据、形状或坐标。用户指令：${instruction}\n元素原文：${block.type === 'image' ? block.caption : block.text}\n本页来源：${source || '无额外来源'}\n仅返回 JSON：{"text":"..."}，最多 100 字。`
          : `你只修改一页演示文稿的标题和要点。不得调用工具、生成坐标、改变图表数据或添加没有来源的数字。用户指令：${instruction}\n当前页：${slide.title}\n${slide.bullets.join('\n')}\n来源：${source || '无额外来源'}\n仅返回 JSON：{"title":"...","bullets":["..."]}；不超过 6 个要点。`;
        const result = await deps.modelCall(project, prompt, activity, log);
        const index = project.deck.slides.findIndex(item => item.id === slide.id);
        const raw = block ? { ...slide, blocks: slide.blocks.map(item => item.id === block.id
          ? { ...item, [block.type === 'image' ? 'caption' : 'text']: bounded(result.text, 100, 'rewritten text') } : item) } : { ...result, blocks: slide.blocks || [], layout: slide.layout, layoutId: slide.layoutId };
        const rewritten = normalizeDeck({ slides: [raw] }, [project.outline[index]]).slides[0];
        const gated = deterministicGate({ ...project, deck: applyLayoutRegistry({ ...project.deck, slides: project.deck.slides.map(item => item.id === slide.id ? rewritten : item) }) });
        gated.revision++;
        gated.pdfRevision = 0;
        if (gated.quality.status === 'blocked') {
          gated.status = 'quality_blocked'; gated.stage = 'repair'; gated.error = `PPT quality gate blocked publish: ${qualityError(gated)}`;
          return send(200, { project: store.save(gated) });
        }
        await deps.renderPptx(gated);
        gated.status = 'completed'; gated.stage = 'completed'; gated.error = '';
        return send(200, { project: store.save(gated) });
      } finally { editing.delete(id); }
    }
    if (action === 'source' && req.method === 'PATCH') {
      if (project.inputKind !== 'paste' || project.status !== 'outline_ready') return send(409, { error: 'pasted source is not editable now' });
      const data = await body(req);
      if (data.sourceRevision !== project.sourceRevision) return send(409, { error: 'source changed on another device; reload first' });
      let source;
      try { source = { ...normalizePaste(data.text), images: project.source?.images || [] }; } catch (error) { throw new HttpError(400, error.message); }
      if (source.text === project.source.text) return send(200, { project });
      project.source = source; project.sourceRevision++; project.outlineRevision = 0;
      project.outline = []; project.nodes = {}; project.status = 'outlining'; project.stage = 'outline';
      store.save(project); startOutline(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'outline' && req.method === 'PATCH') {
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      const data = await body(req);
      const nextPages = pages(data.slides?.length);
      if (data.finalPageCount !== undefined && nextPages !== pages(data.finalPageCount)) throw new HttpError(400, 'outline must match the user-confirmed page count');
      if (data.template !== undefined && data.template !== project.template) {
        const selectedTemplate = resolveTemplate(uid, data.template);
        if (selectedTemplate.kind === 'uploaded' && selectedTemplate.extension === 'pptx') {
          const reuseError = templateReuseError(selectedTemplate.pages, nextPages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        project.template = selectedTemplate.id;
        project.templateSpec = snapshotTemplate(selectedTemplate);
        project.templateFidelity = selectedTemplate.kind === 'uploaded' && selectedTemplate.extension === 'pptx' && deps.prepareTemplateFidelity
          ? await deps.prepareTemplateFidelity(project, store.readTemplate(uid, selectedTemplate.id), selectedTemplate.sha256)
          : undefined;
      }
      project.pages = nextPages;
      if (data.compressionApproved !== undefined) project.compressionApproved = data.compressionApproved === true;
      project.pageDecision = { finalPageCount: nextPages, source: 'user', includesCover: true, confirmedAt: new Date().toISOString() };
      if (project.update && project.pages < 6) throw new HttpError(400, 'update outline needs 6 to 100 slides');
      project.outline = normalizeOutline({ slides: data.slides }, project.pages, project.source, project.update, project.deckTitle);
      rescheduleTemplateFidelity(project);
      project.planning = refreshPlanning(project);
      project.outlineRevision = (project.outlineRevision || 0) + 1;
      project.nodes = {};
      project.diff = diffSummary(project);
      store.save(project);
      return send(200, { project });
    }
    if (action === 'outline' && req.method === 'POST') {
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      const data = await body(req);
      project.outlineSeed = Array.isArray(data.seedOutline) ? data.seedOutline.slice(0, 100).map(item => ({
        section: String(item?.section || '').slice(0, 120), title: String(item?.title || '').slice(0, 160),
        focus: String(item?.focus || '').slice(0, 360), description: String(item?.description || '').slice(0, 360),
        children: Array.isArray(item?.children) ? item.children.slice(0, 12).map(child => ({
          title: String(child?.title || '').slice(0, 160), description: String(child?.description || '').slice(0, 360),
        })) : [],
      })) : null;
      if (data.pages !== undefined) project.pages = pages(data.pages);
      if (data.template !== undefined && data.template !== project.template) {
        const selectedTemplate = resolveTemplate(uid, data.template);
        if (selectedTemplate.kind === 'uploaded' && selectedTemplate.extension === 'pptx') {
          const reuseError = templateReuseError(selectedTemplate.pages, project.pages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        project.template = selectedTemplate.id;
        project.templateSpec = snapshotTemplate(selectedTemplate);
        project.templateFidelity = selectedTemplate.kind === 'uploaded' && selectedTemplate.extension === 'pptx' && deps.prepareTemplateFidelity
          ? await deps.prepareTemplateFidelity(project, store.readTemplate(uid, selectedTemplate.id), selectedTemplate.sha256)
          : undefined;
      }
      project.pageDecision = { finalPageCount: project.pages, source: 'user', includesCover: true, confirmedAt: new Date().toISOString() };
      project.outline = []; project.nodes = {}; project.outlineRevision = 0;
      project.planning = null;
      project.diff = null;
      project.status = 'outlining'; project.stage = 'outline'; project.error = '';
      store.save(project); startOutline(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'generate' && req.method === 'POST') {
      if (['ingesting', 'outlining'].includes(project.status)) {
        project.autoGenerate = true;
        store.save(project);
        return send(202, { project });
      }
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      project.status = 'generating'; project.stage = 'content'; project.error = '';
      store.save(project);
      startGeneration(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'blank' && req.method === 'POST') {
      if (project.status !== 'generating') return send(409, { error: 'presentation is not generating' });
      if (project.outline.length >= 100) return send(409, { error: 'presentation already has 100 slides' });
      const data = await body(req);
      const requested = typeof data.afterSlideId === 'string' ? project.outline.findIndex(slide => slide.id === data.afterSlideId) : -1;
      const index = requested >= 0 ? requested + 1 : project.outline.length;
      const id = newIrId('slide');
      const outlineSlide = { id, section: '手动页面', title: '新页面', focus: 'manual blank', description: '', children: [], refs: [], manualBlank: true };
      project.outline.splice(index, 0, outlineSlide);
      project.nodes ||= {};
      project.nodes[id] = { status: 'done', attempts: 0, slide: { id, title: '新页面', bullets: [], blocks: [], layoutId: 'summary', manualBlank: true } };
      project.pages = project.outline.length;
      project.updatedAt = new Date().toISOString();
      store.save(project);
      try { emitRunProgress(project, 'slide.manual-added', { slideId: id, index }); } catch {}
      return send(201, { project });
    }
    if (action === 'retry' && req.method === 'POST') {
      if (project.status !== 'failed') return send(409, { error: 'project is not failed' });
      project.status = project.stage === 'ingest' ? 'ingesting' : project.stage === 'outline' ? 'outlining' : 'generating';
      project.error = ''; store.save(project);
      if (project.status === 'ingesting') startIngest(uid, id, activity, log, deps);
      else if (project.status === 'outlining') startOutline(uid, id, activity, log, deps);
      else startGeneration(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (!action && req.method === 'GET') return send(200, { project });
    if (!action && req.method === 'PATCH') {
      const data = await body(req);
      if (data.slides === undefined && data.slidePatches === undefined && data.template === undefined) {
        if (!['title', 'favorite', 'pinned', 'folderId', 'tags'].some(key => key in data)) return send(400, { error: 'no metadata changes' });
        return send(200, { project: setMetadata(project, data) });
      }
      if (!['completed', 'quality_blocked'].includes(project.status)) return send(409, { error: 'presentation is not editable' });
      if (editing.has(id)) return send(409, { error: 'another save is in progress' });
      if (data.revision !== project.revision) return send(409, { error: 'presentation changed on another device; reload first' });
      if (data.slides !== undefined && data.slidePatches !== undefined) throw new HttpError(400, 'choose full slides or slide patches');
      if (data.slides !== undefined && (!Array.isArray(data.slides) || data.slides.length < project.deck.slides.length || data.slides.length > project.deck.slides.length + 1 || data.slides.length > 100)) {
        return send(400, { error: 'slides may only be edited or one slide appended' });
      }
      editing.add(id);
      try {
        let nextSlides = data.slides || project.deck.slides;
        if (data.slidePatches !== undefined) {
          if (!Array.isArray(data.slidePatches) || data.slidePatches.length > project.deck.slides.length || (data.appendSlide && project.deck.slides.length >= 100)) throw new HttpError(400, 'invalid slide patches');
          const patches = new Map();
          for (const patch of data.slidePatches) {
            if (!patch || !project.deck.slides.some(slide => slide.id === patch.id) || patches.has(patch.id)) throw new HttpError(400, 'invalid or duplicate slide patch');
            patches.set(patch.id, patch);
          }
          nextSlides = project.deck.slides.map(slide => patches.get(slide.id) || slide);
          if (data.appendSlide) nextSlides = [...nextSlides, data.appendSlide];
        }
        const outline = nextSlides.length > project.outline.length
          ? [...project.outline, { id: String(project.outline.length + 1), title: nextSlides.at(-1)?.title, focus: nextSlides.at(-1)?.title }]
          : project.outline;
        const template = data.template === undefined ? null : resolveTemplate(uid, data.template);
        const updated = { ...project, outline, pages: outline.length, deck: normalizeDeck({ slides: nextSlides }, outline),
          template: template?.id || project.template,
          templateSpec: template ? snapshotTemplate(template) : project.templateSpec };
        const gated = deterministicGate(updated);
        gated.revision++;
        gated.pdfRevision = 0;
        if (gated.quality.status === 'blocked') {
          gated.status = 'quality_blocked'; gated.stage = 'repair'; gated.error = `PPT quality gate blocked publish: ${qualityError(gated)}`;
          return send(200, { project: store.save(gated) });
        }
        await deps.renderPptx(gated);
        gated.status = 'completed'; gated.stage = 'completed'; gated.error = '';
        return send(200, { project: store.save(gated) });
      } finally { editing.delete(id); }
    }
    return send(404, { error: 'not found' });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error?.code === 'TEMPLATE_REUSE_UNAVAILABLE' ? 400 : 500;
    if (status === 500) log(`ppt API error: ${String(error?.message || error).slice(0, 300)}`);
    return send(status, { error: status === 500 ? 'PPT service error' : error.message });
  }
}

export const _internals = { normalizeOutline, normalizeDeck, normalizeSlide, parseModelJson, pages, outlinePrompt, contentPrompt, defaultDeps };

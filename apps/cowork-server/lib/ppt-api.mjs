import { normalizeGenerationPolicy, requestedPageCount, PPT_PROMPT_CONTRACT_VERSION } from './ppt-generation-policy.mjs';
/** M1 PPT Workspace API and durable, server-side job orchestration.
 * All model calls and PPTX rendering run in a Cowork container. Project JSON
 * lives on the server data disk, so a second signed-in desktop sees the same
 * project and can export its completed presentation. */
import * as store from './ppt-store.mjs';
import * as orch from './orchestrator.mjs';
import * as files from './files.mjs';
import { runRoutine } from './routine-runner.mjs';
import { promptPolicy, writingGuide, normalizeKeyPoints, canonicalWriterOutput, criticRewriteTargets, sourcePacket, slideSemanticContext, writerPrompt, writerRepairPrompt, outlineContentContract, OUTLINE_SCHEMA } from './ppt-prompt-contracts.mjs';
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
import { getProject as getStructuredProject, saveProject as saveStructuredProject, saveRevision, enqueueProject, readRevision } from './ppt/repository.mjs';
import { editingState, generationEpoch, contentEditResult, recoverContentEdits, processGenerationEdits, recoverGenerationEdits } from './ppt/generation-edit-service.mjs';
import { templatePreview } from './ppt/template-preview-service.mjs';
import { editableCapabilities, templateCapabilities } from './ppt/edit-context.mjs';
import { _internals as commandInternals } from './ppt/command-service.mjs';
import { normalizeCommand } from './ppt/command-schema.mjs';
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
import { runtimeState, checkpoint, updateSlidePreview, finishPause, reconcileCheckpoint, acquireGenerationLease } from './ppt/runtime.mjs';
import { synchronizePlan, bindReview, reviewIsCurrent, semanticReviewKey } from './ppt/versioning.mjs';
import { effectiveConstraints } from './ppt/mutation-router.mjs';
import { digest } from './ppt/edit-context.mjs';
import { transformGeneratedSlide } from './ppt/generation-edit-service.mjs';

const running = new Set();
const editing = new Set();
const MAX_PROMPT = 12000;
const MAX_TEXT = 160;
const PPT_NODE_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.PPT_NODE_CONCURRENCY) || 3));
const PPT_RE = /^\/ppt\/projects(?:\/([a-f0-9]{32}))?(?:\/(outline|generate|retry|export|pdf|source|duplicate|trash|restore|permanent|versions|rewrite|blank))?$/i;
const FOLDER_RE = /^\/ppt\/folders(?:\/([a-f0-9]{32}))?$/i;
const TEMPLATE_PREVIEW_RE = /^\/ppt\/templates\/(violet|blue|light|marketing|education|[a-f0-9]{32})\/preview$/i;
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
  const segments = (base.deck?.slides || []).map((slide, index) => ({ id: String(index + 1), location: `旧版第 ${index + 1} 页`, text: JSON.stringify(slideSemanticContext(slide)) }));
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
    const keyPoints = normalizeKeyPoints(s.keyPoints || s.key_points, source);
    return { id: typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s.id) ? s.id : newIrId('slide'), title,
      focus, description: bounded(s.description || s.focus || s.title, 360, `slide ${index + 1} description`, false), children,
      section: compileSectionLabel(bounded(s.section || s.title, MAX_TEXT, `slide ${index + 1} section`)),
      refs: [...new Set([...(Array.isArray(s.refs) ? s.refs.map(String) : []), ...keyPoints.flatMap(point => point.refs)])].filter(ref => validRefs.has(ref)),
      ...((Array.isArray(s.chunkRefs) || keyPoints.some(point => point.chunkRefs.length)) ? { chunkRefs: [...new Set([...(Array.isArray(s.chunkRefs) ? s.chunkRefs.map(String) : []), ...keyPoints.flatMap(point => point.chunkRefs)])].filter(ref => validChunkRefs.has(ref)) } : {}),
      ...(typeof s.role === 'string' ? { role: s.role.slice(0, 40) } : {}),
      ...(typeof s.question === 'string' ? { question: s.question.slice(0, 240) } : {}),
      ...(typeof s.headlineIntent === 'string' || typeof s.headline_intent === 'string' ? { headlineIntent: String(s.headlineIntent || s.headline_intent).slice(0, 160) } : {}),
      ...(typeof s.audienceTakeaway === 'string' || typeof s.audience_takeaway === 'string' || typeof s.takeaway === 'string' ? { audienceTakeaway: String(s.audienceTakeaway || s.audience_takeaway || s.takeaway).slice(0, 240) } : {}),
      ...(Array.isArray(s.sourceTopics || s.source_topics) ? { sourceTopics: (s.sourceTopics || s.source_topics).filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 120)) } : {}),
      ...(typeof s.transitionFromPrevious === 'string' || typeof s.transition_from_previous === 'string' ? { transitionFromPrevious: String(s.transitionFromPrevious || s.transition_from_previous).slice(0, 180) } : {}),
      ...(typeof s.transitionToNext === 'string' || typeof s.transition_to_next === 'string' ? { transitionToNext: String(s.transitionToNext || s.transition_to_next).slice(0, 180) } : {}),
      keyPoints,
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
  const userOutlineContract = p.outlineSeed?.length ? `用户手动编辑过的大纲草稿：${JSON.stringify(p.outlineSeed)}。在调整为 ${p.pages} 页时优先保留用户改过的标题和重点；需要合并或拆分时保持原意，不复制同一观点凑页。` : '';
  const sparsePlan = p.contentPlan || planSparseInput(p);
  const userTitle = p.deckTitle?.source === 'user' ? p.deckTitle.raw : '';
  const titleContract = userTitle
    ? `用户 Deck Title 为「${userTitle}」。它已锁定：封面 title 必须保持原词、原语言和原术语，不得改写、缩短或翻译；只能由渲染器换行。`
    : '用户没有填写 Deck Title。为封面生成一个精炼标题：中文优先 6–18 字，英文优先 2–8 个词，最多两行；额外背景放入 focus 或后续 subtitle。';
  const planningContract = `先在内部建立 Presentation Brief（目标、受众、核心论点、深度、mustInclude、reportMode、decisionQuestion、sourceScope），再规划有起承转合的 storyArc。reportMode 只选 presentation、informational 或 decision；决策或职场汇报需在前 3 页给出摘要或需要回答的决定，较早展示核心流程/证据，结尾给出来源支持的条件性建议与下一步；资料不足时不要虚构建议或案例，而应在 sourceScope 记录缺口，在页面保留影响理解的限制。主文尽量集中，补充细节放 appendix。页数优先级固定为：用户手动调整或明确指定 > PPT 模块估算 > 模板原有页数。模板页数只决定原生版式选择和安全复用，不得更改输出页数。当前 project.pages=${p.pages} 是本轮最终页数硬参数（含封面），必须准确规划成 ${p.pages} 页；不得根据模板页数或固定 10/12 页假设改动。模块估算为 ${pageRecommendation.recommended} 页（范围 ${pageRecommendation.range[0]}–${pageRecommendation.range[1]}），只用于未指定页数时的默认值及判断内容密度、压缩风险。${allocationContract}${userOutlineContract}${titleContract} Story Planner 输出 section label、title intent 和 slide message，section 使用 4–12 个中文字符或 2–8 个英文词；不要直接复制来源长标题。同一页可整合多个来源，一个来源也可支持多页，但拆分后的每页须有不同的问题、独立主张或证据作用；不可用同义改写凑足页数。来源不足时在 sourceScope 记录，并在页面保留必要的适用边界，不要补造材料。每页根据内容规划解释深度、分布和结构，不要固定三条 bullet。整稿应有密度节奏：摘要与过渡、普通说明、高密度流程或深机制交错；不要连续多页都写成高密度卡片。若来源包含可复算的公式、代码或算例，必须把核心表达式、变量含义和适用条件列入相应页 requiredDetails，不能只保留流程概述；特殊数学符号要规划成可见的普通文本表示。每个高优先级主题必须出现在页面 refs 中，或在 coverage 中说明省略原因。${templateOutlinePrompt(p)}`;
  const planningSchema = OUTLINE_SCHEMA;
  const contentPlanning = outlineContentContract(p);

  if (p.update) {
    const base = p.update.baseSnapshot;
    const old = base.deck?.slides ? JSON.stringify(base.deck.slides.map(slide => ({ id: slide.id, ...slideSemanticContext(slide) }))) : base.source?.text || '';
    const progress = (p.source?.segments || []).filter(s => s.origin === 'progress').map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 14000);
    return `你是演示文稿版本更新规划器。${planningContract}${contentPlanning} 仅分析旧版与用户提供的新进展；不搜索、不调用工具、不编造数字。旧版：${base.title}\n旧版内容：\n${old}\n最新进展：\n${progress || p.prompt}\n语义索引：\n${sourceContext.slice(0, 12000)}\n生成恰好 ${p.pages} 页的新大纲，返回唯一 JSON：${planningSchema}。每个 slide 另加 baseSlideId（旧页 ID 或 null）和 change（keep|rewrite|add）。原样保留且内容不变的页用 keep；需要改写的旧页用 rewrite；新页用 add。不得虚构旧页 ID 或来源编号。只输出 JSON。`;
  }
  if (p.source?.segments?.length) {
    return `你是演示文稿叙事规划器。${planningContract}${contentPlanning} 只分析以下用户提供的来源，不搜索、不调用工具、不编造数字。文件名：${p.title}；页数：${p.pages}。\n来源（chunkRefs 用语义 chunk ID；refs 用索引列出的原始来源编号）：\n${sourceContext}\n返回唯一 JSON：${planningSchema}。slides 恰好 ${p.pages} 个；第一页封面，最后一页总结。相邻页面可以共享 section，每页 chunkRefs 和 refs 只能引用上面实际存在的编号。只输出 JSON。`;
  }
  return `你是演示文稿叙事规划器。${planningContract}${contentPlanning} 只做内容结构，不写代码、不调用工具、不生成 PPTX、不搜索网页。\n主题：${p.prompt}\n短输入预规划（这些是待论证问题，不是已证实事实）：${JSON.stringify(sparsePlan || {})}\n先依据该 Content Plan 与 Semantic Unit Inventory 扩展完整的概念结构和故事骨架，再按用户确定的 ${p.pages} 页分配。缺乏来源时可解释通用机制、示意框架和评估方法；不得把公司特定数据、客户、项目、效果或财务数字写成事实。页数少时合并相邻问题，页数多时把机制、条件和评估拆开，不能添加同义 filler。\n文件名：${p.title}\n页数：${p.pages}。\n返回唯一 JSON：${planningSchema}。slides 必须恰好 ${p.pages} 个，第一页是封面，最后一页是结论。每页有不同的逻辑作用，不要编造具体数字；纯 Prompt 输入时 refs 为空。只输出 JSON。`;
}
function contentPrompt(p, slide, index) {
  const contract = p.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
  const constraints = effectiveConstraints(p, slide.id);
  const edits = constraints.length ? constraints.filter(item => ['content', 'title'].includes(item.type)).map(item => item.instruction) : p.editing?.instructions?.[slide.id] || [];
  return writerPrompt(p, slide, index, { retrieval: retrieveSlideSources(p, slide, contract), contract, slotContract: templateSlotPrompt(p, index), edits });
}
function contentRepairPrompt(p, slide, index, draft, issues) {
  return writerRepairPrompt(contentPrompt(p, slide, index), draft, issues);
}
async function modelCall(p, prompt, activity, log, options = {}) {
  const sid = options.nodeKey ? sha256(Buffer.from(`${p.id}:${options.nodeKey}`)).slice(0, 32) : p.id;
  try {
    const result = await runRoutine({ sid, uid: p.uid, kind: orch.KIND_PPT, prompt, model: p.model, configId: p.configId, activity, log,
      canStart: () => { const latest = store.get(p.uid, p.id); return Boolean(latest && !latest.deletedAt && latest.status !== 'cancelled' && (!(options.nodeKey || '').startsWith('content:') && !(options.nodeKey || '').startsWith('review:deck') || (latest.status !== 'paused' && !latest.runtime?.pauseRequested))); } });
    if (!result.ok) throw new Error(result.error || `模型任务失败：${result.status}`);
    return parseModelJson(result.resultText);
  } finally {
    if (sid !== p.id) await orch.removeContainer(sid, { keepVolume: false }).catch(() => {});
  }
}
const defaultDeps = { modelCall, renderPptx: project => project.templateFidelity?.mode === 'preserve' ? renderTemplatePptx(project) : renderPptx(project),
  prepareTemplateFidelity, renderPdf, extractFile, analyzeTemplate, readFile: files.readFile, removeContainer: orch.removeContainer };
function normalizeSlide(value, outlineSlide, project = null, previousTitles = []) {
  const index = project?.outline?.findIndex(item => item.id === outlineSlide.id) ?? -1;
  value = canonicalWriterOutput(value || {}, project?.templateFidelity?.mode === 'preserve' ? project.templateFidelity.slides[index] : null);
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
    slide.templateSlotTexts = Object.fromEntries(Object.entries(value?.slotTexts || {}).filter(([key, text]) => valid.has(key) && (typeof text === 'string' || Array.isArray(text))).map(([key, text]) => {
      if (typeof text === 'string') {
        if (text.length > 5000) throw new HttpError(400, `template slot ${key} exceeds the text safety limit; rewrite without truncation`);
        return [key, text];
      }
      if (text.length > 30 || text.some(item => String(item?.label || '').length > 120 || String(item?.body || '').length > 2000))
        throw new HttpError(400, `template slot ${key} exceeds the list safety limit; redistribute without truncation`);
      return [key, text.map(item => ({ label: String(item?.label || ''), body: String(item?.body || '') }))];
    }));
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
  const slides = structuredClone(deck.slides);
  const targets = slides.filter(slide => slide.layoutId === 'image-text' && (slide.blocks || []).length < 2);
  const terms = text => new Set((String(text || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,4}/g) || []));
  for (const image of images) {
    const imageTerms = terms(`${image.caption || ''} ${image.text || ''}`);
    const ranked = targets.filter(slide => (slide.blocks || []).length < 2).map(slide => {
      const wanted = terms(`${slide.title} ${(slide.bullets || []).join(' ')} ${slide.copy?.visualIntent?.query || ''}`);
      const refs = image.sourceRefs || (image.sourceRef ? [image.sourceRef] : []);
      return { slide, score: [...imageTerms].filter(term => wanted.has(term)).length + (refs.some(ref => slide.sourceRefs?.includes(ref)) ? 10 : 0) + (slide.copy?.visualIntent?.assetId === image.id ? 100 : 0) };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    const slide = ranked[0]?.slide; if (!slide) continue;
    slide.blocks ||= []; slide.blocks.push(image); slide.layout = 'visual-first';
    slide.assetBindings ||= []; slide.assetBindings.push({ assetId: image.id, reason: 'source-or-topic-match', score: ranked[0].score });
    if (slide.nodes) slide.nodes.push({ id: image.id, type: 'image', semanticRole: 'visual', slotId: 'visual', content: Object.fromEntries(Object.entries(image).filter(([key]) => !['id','type'].includes(key))) });
  }
  return { ...deck, slides };
}

function persistDagNode(uid, id, nodeId, status, patch = {}) {
  const project = store.get(uid, id);
  if (!project || project.deletedAt || project.status === 'cancelled') return null;
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

/** Compatibility saves use the same revision journal and project writer as the structured editor. */
function commitCompatibility(project, gated, deps) {
  return enqueueProject(project.uid, project.id, async () => {
    const latest = getStructuredProject(project.uid, project.id);
    if (!latest || latest.deletedAt || latest.revision !== project.revision) throw new HttpError(409, 'presentation changed; reload first');
    const result = await commandInternals.commit(latest, normalizeCommand({ type: 'deck.replace', baseRevision: project.revision, payload: { deck: gated.deck, projectState: { template: gated.template, templateSpec: gated.templateSpec, outline: gated.outline, pages: gated.pages } } }, latest));
    const updated = result.project; updated.quality = gated.quality; updated.pdfRevision = 0;
    if (gated.quality.status === 'blocked') {
      updated.status = 'quality_blocked'; updated.stage = 'repair'; updated.error = `PPT quality gate blocked publish: ${qualityError(gated)}`;
      saveStructuredProject(updated); return updated;
    }
    updated.status = 'completed'; updated.stage = 'completed'; updated.error = '';
    saveStructuredProject(updated); return updated;
  });
}
function fail(uid, id, stage, error, log) {
  const p = store.get(uid, id);
  if (!p || p.deletedAt) return;
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
          const repairPrompt = `${outlinePrompt(p)}\n初稿结构检查：${JSON.stringify(initialIssues.map(item => ({ code: item.code, message: item.message })))}。请在相同页数和有效来源编号内修订大纲，不改变用户锁定的标题，不虚构事实或证据。初稿：${JSON.stringify(rawOutline)}。返回完整的同一 JSON schema。`;
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
      synchronizePlan(current, 'outline-confirmation');
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
  const lease = acquireGenerationLease(store.get(uid, id)); if (!lease) return;
  running.add(id);
  void (async () => {
    try {
      const p = ensureProjectTemplate(store.get(uid, id));
      if (!p || p.status !== 'generating') return;
      try { emitRunProgress(p, 'generation.started', { slideCount: p.outline.length }); } catch {}
      reconcileCheckpoint(p);
      const runtime = runtimeState(p); runtime.lifecycle = 'active';
      p.stage = 'source-check'; p.nodes ||= {}; p.dagNodes ||= {}; editingState(p).contentOpen = true; recoverContentEdits(p); synchronizePlan(p); store.save(p);
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
        if (latest?.nodes?.[slide.id]?.status === 'done' && (!latest.runtime?.slides?.[slide.id]?.preview || latest.runtime.slides[slide.id].contentHash !== digest(latest.nodes[slide.id].slide) || latest.runtime.slides[slide.id].epoch !== generationEpoch(latest, slide.id))) { updateSlidePreview(latest, slide.id);
          for (const stage of ['layout', 'preview', 'quality']) transitionNode(latest, `${stage}:${slide.id}`, 'completed', { slideId: slide.id, recovered: true, inputHash: latest.runtime.slides[slide.id].contentHash }, { useInput: true });
          store.save(latest); }
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
      const runWork = async (work) => {
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
        for (;;) {
        const snapshot = await enqueueProject(uid, id, () => {
          const latest = store.get(uid, id);
          if (!latest || latest.deletedAt || latest.status !== 'generating' || latest.runtime?.pauseRequested || latest.nodes?.[slide.id]?.status === 'done') return null;
          const epoch = generationEpoch(latest, slide.id);
          latest.stage = 'content'; latest.nodes ||= {};
          runtimeState(latest).attempts[`${nodeId}:${epoch}`] = { phase: 'content_running', runId: latest.currentRunId, epoch,
            inputHash: digest({ plan: latest.planRevision?.hash, constraints: effectiveConstraints(latest, slide.id), slide }),
            planRevision: latest.planRevision?.version, constraintRevision: latest.constraints?.version,
            modelRef: { configId: latest.configId, model: latest.model }, startedAt: new Date().toISOString() };
          latest.nodes[slide.id] = { ...latest.nodes[slide.id], status: 'running', epoch, attempts: (latest.nodes[slide.id]?.attempts || 0) + 1 };
          contentEditResult(latest, slide.id, epoch, 'applying');
          transitionNode(latest, nodeId, 'running', { slideId: slide.id, epoch }, { useInput: true });
          return latest;
        });
        if (!snapshot) return;
        const epoch = generationEpoch(snapshot, slide.id);
        const runId = snapshot.currentRunId;

        try {
          const previousTitles = snapshot.outline.slice(0, index).map(item => item.title);
          const prior = snapshot.nodes?.[slide.id]?.slide;
          const mutations = effectiveConstraints(snapshot, slide.id);
          const requested = mutations.filter(item => { const result = snapshot.editing?.intents?.[item.intentId]?.perSlideResults?.[slide.id]; return result?.epoch === epoch && result.phase === 'content' && ['queued','applying'].includes(result.status); });
          const mutation = requested.at(-1);
          const minimal = prior && requested.length && requested.every(item => ['title', 'layout', 'style'].includes(item.type));
          let content = minimal ? structuredClone(prior) : normalizeSlide(await deps.modelCall(snapshot, contentPrompt(snapshot, slide, index), activity, log, { nodeKey: nodeId }), slide, snapshot, previousTitles);
          for (const item of (minimal ? requested : mutations.filter(item => ['layout', 'style'].includes(item.type)))) {
            snapshot.nodes[slide.id].slide = content; content = await transformGeneratedSlide(snapshot, slide.id, item, deps, activity, log);
          }
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
          if (copyIssues.length && !minimal) {
            content = normalizeSlide(await deps.modelCall(snapshot, contentRepairPrompt(snapshot, slide, index, content, copyIssues), activity, log,
              { nodeKey: `${nodeId}:repair` }), slide, snapshot, previousTitles);
            content.localRepair = { attempts: 1, reasons: copyIssues.map(item => item.code) };
          }
          const committed = await enqueueProject(uid, id, () => {
            const latest = store.get(uid, id);
            if (!lease.owns() || !latest || latest.deletedAt || latest.status !== 'generating' || latest.currentRunId !== runId) return 'stopped';
            if (generationEpoch(latest, slide.id) !== epoch) {
              const mutation = effectiveConstraints(latest, slide.id).at(-1);
              if (!latest.nodes[slide.id].slide && mutation && ['title', 'layout', 'style'].includes(mutation.type)) latest.nodes[slide.id].slide = content;
              store.save(latest); return 'superseded';
            }
            latest.nodes[slide.id] = { ...latest.nodes[slide.id], status: 'done', epoch, slide: content };
            runtimeState(latest).slides[slide.id] = { ...latest.runtime.slides[slide.id], phase: 'content_ready' };
            transitionNode(latest, nodeId, 'completed', { slideId: slide.id, epoch }, { useInput: true });
            updateSlidePreview(latest, slide.id);
            latest.runtime.slides[slide.id].quality.issues.push(...copyIssues);
            latest.runtime.attempts = { ...latest.runtime.attempts, ...snapshot.runtime?.attempts };
            Object.assign(latest.runtime.attempts[`${nodeId}:${epoch}`], { phase: 'render_ready', completedAt: new Date().toISOString(), outputHash: latest.runtime.slides[slide.id].contentHash });
            for (const stage of ['layout', 'preview', 'quality']) transitionNode(latest, `${stage}:${slide.id}`, 'completed', { slideId: slide.id, epoch, inputHash: latest.runtime.slides[slide.id].contentHash, renderHash: latest.runtime.slides[slide.id].renderHash }, { useInput: true });
            checkpoint(latest, `slide:${slide.id}:content`);
            if (index === 0 && latest.deckTitle?.source !== 'user') latest.deckTitle = { text: content.title, raw: content.title, source: 'agent', locked: false };
            contentEditResult(latest, slide.id, epoch, 'applied');
            store.save(latest); emitRunProgress(latest, 'slide.render_ready', { slideId: slide.id, epoch, renderHash: latest.runtime.slides[slide.id].renderHash });
            return 'committed';
          });
          if (committed === 'superseded') continue;
          return content;
        } catch (error) {
          const stale = await enqueueProject(uid, id, () => {
            const latest = store.get(uid, id);
            if (!latest || latest.deletedAt || latest.status !== 'generating' || latest.currentRunId !== runId) return true;
            if (latest.runtime?.pauseRequested) { latest.nodes[slide.id].status = 'pending'; store.save(latest); return true; }
            if (generationEpoch(latest, slide.id) !== epoch) return true;
            contentEditResult(latest, slide.id, epoch, 'failed', String(error?.message || error));
            store.save(latest);
            persistDagNode(uid, id, latest.nodes?.[slide.id]?.status === 'done' ? `preview:${slide.id}` : nodeId, 'failed', { epoch, error: String(error?.message || error).slice(0, 300) });
            return false;
          });
          if (stale) continue;
          throw error;
        }
        }
      };
      await boundedAll(readyNodes, PPT_NODE_CONCURRENCY, runWork);
      const afterWave = store.get(uid, id);
      if (afterWave?.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(store.get(uid, id))); return; }
      let current;
      for (;;) {
        // The barrier closes content edits atomically. Later intents become draft edits.
        const wave = await enqueueProject(uid, id, () => {
          const latest = store.get(uid, id);
          if (!latest || latest.deletedAt || latest.status !== 'generating') return null;
          if (latest.runtime?.pauseRequested) { finishPause(latest); return null; }
          const pending = latest.outline.map((slide, index) => ({ kind: 'content', slide, index })).filter(({ slide }) => latest.nodes?.[slide.id]?.status !== 'done');
          if (pending.length) return { pending };
          editingState(latest).contentOpen = false;
          latest.deck = applyLayoutRegistry(applySourceImages({ schemaVersion: 2, slides: latest.outline.map((s) => latest.nodes[s.id].slide) }, latest.source));
          latest.deck = ensureDeckV3(latest.deck);
          bindTemplateFidelity(latest);
          enrichAssetRefs(latest);
          latest.renderTree = buildRenderTree(latest);
          for (const tree of latest.renderTree.slides) runtimeState(latest).slides[tree.id] = { ...latest.runtime.slides[tree.id], phase: 'render_ready', preview: tree, renderHash: digest(tree) };
          checkpoint(latest, 'content-barrier');
          latest.stage = 'review'; store.save(latest);
          return { project: latest };
        });
        if (!wave) return;
        if (wave.project) { current = wave.project; break; }
        await boundedAll(wave.pending, PPT_NODE_CONCURRENCY, runWork);
      }

      if (!current || current.status !== 'generating') return;
      try { transitionNode(current, 'content', 'completed'); transitionNode(current, 'media', 'completed'); transitionNode(current, 'layout', 'completed'); transitionNode(current, 'preview', 'completed'); transitionNode(current, 'quality', 'running'); } catch {}

      let initialReview = deterministicReview(current);
      const reviewNodeId = 'review:deck';
      let reviewedInputHash = semanticReviewKey(current);
      let modelReview = reviewIsCurrent(current) ? current.quality.modelReview : null;
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
      if (!current || current.deletedAt || current.status !== 'generating') return;
      if (current.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(store.get(uid, id))); return; }
      for (let attempt = 0; semanticReviewKey(current) !== reviewedInputHash; attempt++) {
        if (attempt >= 3) throw new Error('review inputs keep changing; retry after edits settle');
        reviewedInputHash = semanticReviewKey(current); initialReview = deterministicReview(current);
        modelReview = normalizeModelReview(await deps.modelCall(current, deckReviewPrompt(current), activity, log, { nodeKey: 'review:deck:refresh' }), current.deck.slides.map(slide => slide.id));
        current = store.get(uid, id); if (!current || current.deletedAt || current.status !== 'generating') return;
        if (current.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(store.get(uid, id))); return; }
      }
      // Critic findings are actionable input to the writer, not just a final
      // report. Persist the round bound so pause/recovery cannot loop forever.
      for (;;) {
        const targets = criticRewriteTargets(current, modelReview);
        const prior = current.runtime?.criticRepair;
        const round = prior?.runId === current.currentRunId ? prior.rounds || 0 : 0;
        if (!targets.length || round >= 2) break;
        current = await enqueueProject(uid, id, () => {
          const latest = store.get(uid, id);
          if (!lease.owns() || !latest || latest.deletedAt || latest.status !== 'generating') return null;
          if (latest.runtime?.pauseRequested) { finishPause(latest); return null; }
          if (latest.currentRunId !== current.currentRunId || semanticReviewKey(latest) !== reviewedInputHash) throw new Error('content changed before critic repair; retry after edits settle');
          runtimeState(latest).criticRepair = { runId: latest.currentRunId, rounds: round + 1,
            attempts: prior?.runId === latest.currentRunId ? prior.attempts || [] : [] };
          store.save(latest); return latest;
        });
        if (!current) return;
        for (const target of targets) {
          const index = current.outline.findIndex(slide => slide.id === target.slideId);
          const slide = current.outline[index];
          const epoch = generationEpoch(current, slide.id);
          const beforeKey = semanticReviewKey(current);
          const draft = current.nodes[slide.id].slide;
          const attemptKey = `content:${slide.id}:critic:${round + 1}`;
          const started = Date.now();
          const raw = await deps.modelCall(current, contentRepairPrompt(current, slide, index, draft, target.findings), activity, log, { nodeKey: attemptKey });
          const candidate = normalizeSlide(raw, slide, current, current.deck.slides.slice(0, index).map(item => item.title));
          current = await enqueueProject(uid, id, () => {
            const latest = store.get(uid, id);
            if (!lease.owns() || !latest || latest.deletedAt || latest.status !== 'generating') return null;
            if (latest.runtime?.pauseRequested) { finishPause(latest); return null; }
            if (latest.currentRunId !== current.currentRunId || generationEpoch(latest, slide.id) !== epoch || semanticReviewKey(latest) !== beforeKey)
              throw new Error('content changed during critic repair; stale rewrite discarded');
            if (criticRewriteTargets(latest, modelReview).some(item => item.slideId === slide.id)) {
              latest.nodes[slide.id] = { ...latest.nodes[slide.id], status: 'done', slide: candidate };
              latest.deck = ensureDeckV3(applyLayoutRegistry(applySourceImages({ schemaVersion: 2,
                slides: latest.outline.map(item => latest.nodes[item.id].slide) }, latest.source)));
              bindTemplateFidelity(latest); enrichAssetRefs(latest);
              updateSlidePreview(latest, slide.id);
              for (const stage of ['content', 'layout', 'preview', 'quality']) transitionNode(latest, `${stage}:${slide.id}`, 'completed',
                { slideId: slide.id, epoch, criticRound: round + 1, inputHash: latest.runtime.slides[slide.id].contentHash, renderHash: latest.runtime.slides[slide.id].renderHash }, { useInput: true });
              runtimeState(latest).criticRepair.attempts.push({ slideId: slide.id, nodeKey: attemptKey,
                beforeHash: digest(draft), afterHash: digest(candidate), findings: target.findings, durationMs: Date.now() - started });
              checkpoint(latest, 'critic-rewrite');
            }
            store.save(latest);
            emitRunProgress(latest, 'slide.render_ready', { slideId: slide.id, epoch, criticRound: round + 1, renderHash: latest.runtime.slides[slide.id].renderHash });
            return latest;
          });
          if (!current) return;
        }
        reviewedInputHash = semanticReviewKey(current);
        modelReview = normalizeModelReview(await deps.modelCall(current, deckReviewPrompt(current), activity, log,
          { nodeKey: `review:deck:critic:${round + 1}` }), current.deck.slides.map(slide => slide.id));
        current = store.get(uid, id);
        if (!current || current.deletedAt || current.status !== 'generating') return;
        if (current.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(current)); return; }
        if (semanticReviewKey(current) !== reviewedInputHash) throw new Error('content changed during critic review; retry after edits settle');
        initialReview = deterministicReview(current);
      }
      const repairBaseline = semanticReviewKey(current);
      current.stage = 'repair'; store.save(current);
      try { transitionNode(current, 'quality', 'completed'); transitionNode(current, 'review', 'completed'); transitionNode(current, 'repair', 'running'); } catch {}
      const repaired = repairProject(current, initialReview);
      current = repaired.project;
      const reviewDuration = current.dagNodes?.[reviewNodeId]?.durationMs || 0;
      current.quality = finalQualityReport(repaired.review, repaired.repairs, modelReview, { reviewMs: reviewDuration });
      if (semanticReviewKey(current) !== reviewedInputHash) {
        modelReview = normalizeModelReview(await deps.modelCall(current, deckReviewPrompt(current), activity, log, { nodeKey: 'review:deck:repair' }), current.deck.slides.map(slide => slide.id));
        current.quality = finalQualityReport(repaired.review, repaired.repairs, modelReview, { reviewMs: reviewDuration });
      }
      const latestBeforePublish = store.get(uid, id);
      if (!latestBeforePublish || latestBeforePublish.deletedAt || latestBeforePublish.status !== 'generating') return;
      if (latestBeforePublish.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(latestBeforePublish)); return; }
      if (semanticReviewKey(latestBeforePublish) !== repairBaseline) throw new Error('content changed during repair review; retry before publishing');
      current.editing = latestBeforePublish.editing; current.constraints = latestBeforePublish.constraints; current.runtime = latestBeforePublish.runtime;
      current.renderTree = buildRenderTree(current);
      for (const tree of current.renderTree.slides) runtimeState(current).slides[tree.id] = { ...current.runtime.slides[tree.id], preview: tree, renderHash: digest(tree) };
      bindReview(current, modelReview);
      transitionNode(current, reviewNodeId, 'completed', { result: modelReview,
        criticRounds: current.runtime?.criticRepair?.rounds || 0, inputHash: semanticReviewKey(current) }, { useInput: true });
      current.stage = 'publish'; store.save(current);
      try { transitionNode(current, 'repair', 'completed'); } catch {}
      if (current.quality.status === 'blocked') {
        current.status = 'quality_blocked'; current.stage = 'repair';
        current.error = `PPT quality gate blocked publish: ${qualityError(current) || current.quality.modelIssues?.find(item => item.severity === 'error')?.detail || 'content review failed'}`;
        store.save(current);
        return;
      }
      persistDagNode(uid, id, 'publish:deck', 'running');
      const artifactPath = `/workspace/published-${Math.max(1, Number(current.revision || 0))}-${newIrId('artifact')}.pptx`;
      const exportInfo = await deps.renderPptx({ ...current, renderOutput: artifactPath });
      await enqueueProject(uid, id, () => {
        const finished = store.get(uid, id);
        if (!lease.owns() || !finished || finished.deletedAt || finished.status !== 'generating' || finished.currentRunId !== current.currentRunId) return;
        if (finished.runtime?.pauseRequested) { finishPause(finished); return; }
        if (semanticReviewKey(finished) !== semanticReviewKey(current)) throw new Error('generation changed during publication; retry review before publishing');
        finished.exportBytes = exportInfo.bytes; finished.status = 'completed'; finished.stage = 'completed';
        finished.dagNodes['publish:deck'] = nodeRecord('done', finished.dagNodes['publish:deck'], { bytes: exportInfo.bytes });
        finished.error = ''; finished.revision = Math.max(1, Number(finished.revision || 0)); finished.draftRevision = finished.revision;
        finished.publishedArtifactPath = artifactPath; finished.publishedRevision = finished.revision;
        finished.renderTree = buildRenderTree(finished); saveStructuredProject(finished); saveRevision(finished, 'initial-publish');
        runtimeState(finished).lifecycle = 'completed';
        for (const tree of finished.renderTree.slides) finished.runtime.slides[tree.id] = { ...finished.runtime.slides[tree.id], phase: 'validated', preview: tree, renderHash: digest(tree) };
        checkpoint(finished, 'initial-publish'); saveStructuredProject(finished);
        try { transitionNode(finished, 'publish:deck', 'completed', { bytes: exportInfo.bytes }); transitionNode(finished, 'publish', 'completed', { bytes: exportInfo.bytes }); completeRun(finished, { revision: finished.revision }); } catch {}
      });
    } catch (error) { fail(uid, id, 'generation', error, log); }
    finally { lease.release(); running.delete(id); void processGenerationEdits(uid, id, deps, activity, log).catch(error => log(String(error))); }
  })();
}

export function recoverPptJobs(activity, log = () => {}, deps = defaultDeps) {
  recoverGenerationEdits(deps, activity, log);
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
  return rows.map(item => ({ ...item, capabilities: templateCapabilities(item) })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
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
    sourceRevision: 1, outlineRevision: 0, pageDecision: { finalPageCount: count, source: data.pages === undefined ? 'estimate' : 'user', includesCover: true }, status: mustIngest ? 'ingesting' : 'outlining', stage: mustIngest ? 'ingest' : 'outline',
    model: typeof data.model === 'string' ? data.model.slice(0, 120) : '', configId: bounded(data.configId, 120, 'configId'),
    generationPolicy: normalizeGenerationPolicy(data.generationPolicy ?? baseProject?.generationPolicy), promptContractVersion: PPT_PROMPT_CONTRACT_VERSION,
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
    for (const project of store.list(uid).filter(project => project.folderId === id)) await enqueueProject(uid, project.id, () => { const latest = getStructuredProject(uid, project.id); if (latest?.folderId === id) { latest.folderId = null; store.save(latest); } });
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
  for (const project of group) await enqueueProject(uid, project.id, () => { const latest = getStructuredProject(uid, project.id); if (latest) { latest.manualOrder = project.manualOrder; store.save(latest, { touch: false }); } });
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
  for (const project of projects) await enqueueProject(uid, project.id, async () => {
    const latest = getStructuredProject(uid, project.id);
    if (!latest) throw new HttpError(404, 'project not found');
    if (data.action === 'move') latest.folderId = data.folderId;
    if (data.action === 'trash') latest.deletedAt = at;
    if (data.action === 'restore') latest.deletedAt = null;
    if (data.action === 'permanent') {
      if (!latest.deletedAt || running.has(latest.id) || editing.has(latest.id)) throw new HttpError(409, 'project must be in trash and idle');
      await permanentlyRemove(latest, deps);
    } else store.save(latest);
  });
  return send(200, { ok: true, count: projects.length });
}

export async function handlePpt(req, url, { uid, send, res, readBody, activity, log = () => {}, deps = defaultDeps }) {
  const structured = await handleStructuredPpt(req, url, { uid, send, res, readBody, activity, log, deps, resumeGeneration: (owner, id) => startGeneration(owner, id, activity, log, deps) });
  if (structured) return true;
  const folderMatch = url.pathname.match(FOLDER_RE);
  const templateMatch = url.pathname.match(TEMPLATE_RE);
  const previewMatch = url.pathname.match(TEMPLATE_PREVIEW_RE);
  const updates = url.pathname === '/ppt/updates';
  const bulk = url.pathname === '/ppt/projects/bulk';
  const projectOrder = url.pathname === '/ppt/projects/order';
  const folderOrder = url.pathname === '/ppt/folders/order';
  const pageEstimate = url.pathname === '/ppt/page-estimate';
  const match = url.pathname.match(PPT_RE);
  if (!match && !folderMatch && !templateMatch && !previewMatch && !bulk && !updates && !projectOrder && !folderOrder && !pageEstimate) return false;
  const [, id, action] = match || [];
  try {
    if (pageEstimate) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await body(req);
      if (!['prompt', 'paste', 'file'].includes(data.inputKind)) throw new HttpError(400, 'invalid input kind');
      const prompt = String(data.prompt || '').slice(0, MAX_PROMPT);
      const text = String(data.text || '').slice(0, 80000);
      const source = data.inputKind === 'paste' ? normalizePaste(text) : null;
      const candidate = { inputKind: data.inputKind, source, prompt, generationPolicy: normalizeGenerationPolicy(data.generationPolicy) };
      candidate.inputProfile = profilePptInput(candidate); candidate.contentPlan = planSparseInput(candidate, candidate.inputProfile);
      const result = estimatePageRecommendation(candidate);
      const weight = data.inputKind === 'file' ? Math.min(16, Math.ceil(Math.max(0, Number(data.fileBytes) || 0) / 180000)) : 0;
      const recommended = Math.min(100, Math.max(result.recommended, weight ? 4 + weight : 3));
      return send(200, { recommendation: { recommended, min: Math.min(result.range[0], recommended), max: Math.min(100, Math.max(result.range[1], recommended)),
        requested: requestedPageCount(prompt, text), reason: data.inputKind === 'file' ? '文件体量与补充要求初估；解析来源后校准。' : result.reason } });
    }
    if (folderOrder) return await handleFolderOrder(req, uid, send);
    if (projectOrder) return await handleProjectOrder(req, uid, send);
    if (folderMatch) return await handleFolders(req, folderMatch[1], uid, send);
    if (previewMatch && req.method === 'GET') {
      const template = resolveTemplate(uid, previewMatch[1]);
      const svg = await templatePreview(uid, template, Number(url.searchParams.get('slide') || 0), deps);
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, max-age=60' }); res.end(svg); return true;
    }
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
        const promptPages = requestedPageCount(prompt, source?.text);
        const selectedPages = pages(data.pages ?? promptPages ?? estimatedPages);
        const requestedOutline = data.outline === undefined ? null : data.outline;
        if (requestedOutline !== null && (!Array.isArray(requestedOutline) || requestedOutline.length !== selectedPages)) throw new HttpError(400, 'outline must match the user-confirmed page count');
        const formattedUserTitle = userTitle ? formatUserDeckTitle(userTitle) : null;
        if (template.kind === 'uploaded' && template.extension === 'pptx' && data.templateMode !== 'mapped') {
          const reuseError = templateReuseError(template.pages, selectedPages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        const generationPolicy = normalizeGenerationPolicy(data.generationPolicy);
        const project = { id: store.newId(), uid, title, prompt, generationPolicy, promptContractVersion: PPT_PROMPT_CONTRACT_VERSION, pages: selectedPages, inputProfile, contentPlan, template: template.id,
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
      return send(200, { project: await enqueueProject(uid, id, () => { const latest = getStructuredProject(uid, id); latest.deletedAt = new Date().toISOString(); return store.save(latest); }) });
    }
    if (action === 'restore' && req.method === 'POST') {
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 presentations' });
      return send(200, { project: await enqueueProject(uid, id, () => { const latest = getStructuredProject(uid, id); latest.deletedAt = null; return store.save(latest); }) });
    }
    if (action === 'permanent' && req.method === 'DELETE') {
      if (!project.deletedAt) return send(409, { error: 'move project to trash first' });
      await enqueueProject(uid, id, () => permanentlyRemove(getStructuredProject(uid, id), deps));
      return send(200, { ok: true });
    }
    if (action === 'duplicate' && req.method === 'POST') {
      if (project.status !== 'completed') return send(409, { error: 'only completed presentations can be duplicated' });
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 presentations' });
      const copy = structuredClone(project);
      copy.id = store.newId(); copy.title = `${project.title} · 副本`.slice(0, 160);
      delete copy.update; delete copy.updateRequest; delete copy.diff; delete copy.editing; delete copy.publishedArtifactPath; delete copy.currentRunId; delete copy.runId;
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
      if (!['completed', 'quality_blocked'].includes(project.status) || !project.publishedRevision) return send(409, { error: 'presentation has no published version' });
      const { stream, size } = await deps.readFile(id, project.publishedArtifactPath || '/workspace/presentation.pptx');
      const safe = project.title.replace(/[\\/\r\n"<>|:*?]/g, '_').slice(0, 120) || 'presentation';
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-length': size, 'content-disposition': `attachment; filename="presentation.pptx"; filename*=UTF-8''${encodeURIComponent(safe)}.pptx` });
      stream.on('error', () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      res.on('close', () => { try { stream.destroy(); } catch {} });
      return true;
    }
    if (action === 'pdf' && req.method === 'GET') {
      if (!['completed', 'quality_blocked'].includes(project.status) || !project.publishedRevision) return send(409, { error: 'presentation has no published version' });
      const pdf = await enqueueProject(uid, id, async () => {
        const latest = getStructuredProject(uid, id);
        const revision = latest.publishedRevision;
        if (latest.pdfRevision !== revision) {
          const snapshot = readRevision(uid, id, revision);
          if (!snapshot) throw new HttpError(409, 'published revision snapshot is unavailable');
          if (!snapshot.templateSpec && latest.revision !== revision) throw new HttpError(409, 'legacy published template snapshot is unavailable; publish the draft before exporting PDF');
          const pdfArtifactPath = `/workspace/published-${revision}.pdf`;
          await deps.renderPdf({ ...latest, deck: snapshot.deck, renderTree: snapshot.renderTree, template: snapshot.template ?? latest.template, templateSpec: snapshot.templateSpec ?? latest.templateSpec, pdfArtifactPath });
          latest.pdfRevision = revision; latest.pdfArtifactPath = pdfArtifactPath; store.save(latest);
        }
        return deps.readFile(id, latest.pdfArtifactPath || '/workspace/presentation.pdf');
      });
      const { stream, size } = pdf;
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
        const source = JSON.stringify(sourcePacket({ segments: (project.source?.segments || []).filter(item => slide.sourceRefs?.includes(item.id)) }, 12000));
        const block = data.blockId ? (slide.blocks || []).find(item => item.id === data.blockId) : null;
        if (data.blockId && (!block || !['image', 'shape'].includes(block.type))) throw new HttpError(400, 'only image captions and shape labels can be rewritten');
        const localPolicy = `${promptPolicy({ ...project, prompt: `${project.prompt || ''}\n${instruction}` })}\n${writingGuide(project, slide.copy || {})}`;
        const prompt = block
          ? `${localPolicy}\n你只改写一个演示文稿视觉元素的文字，不调用工具，不改图片、图表数据、形状或坐标。用户指令：${instruction}\n元素原文：${block.type === 'image' ? block.caption : block.text}\n本页来源：${source || '无额外来源'}\n仅返回 JSON：{"text":"..."}，最多 100 字。`
          : `${localPolicy}\n你只修改一页演示文稿的标题和要点。不得调用工具、生成坐标、改变图表数据或添加没有来源的数字。用户指令：${instruction}\n当前页：${slide.title}\n${slide.bullets.join('\n')}\n来源：${source || '无额外来源'}\n仅返回 JSON：{"title":"...","bullets":["..."]}；不超过 10 个要点，保留当前必要内容，不要为缩短而丢失机制、条件或对照。`;
        const result = await deps.modelCall(project, prompt, activity, log);
        const index = project.deck.slides.findIndex(item => item.id === slide.id);
        const raw = block ? { ...slide, blocks: slide.blocks.map(item => item.id === block.id
          ? { ...item, [block.type === 'image' ? 'caption' : 'text']: bounded(result.text, 100, 'rewritten text') } : item) } : { ...result, blocks: slide.blocks || [], layout: slide.layout, layoutId: slide.layoutId };
        const rewritten = normalizeDeck({ slides: [raw] }, [project.outline[index]]).slides[0];
        const gated = deterministicGate({ ...project, deck: applyLayoutRegistry({ ...project.deck, slides: project.deck.slides.map(item => item.id === slide.id ? rewritten : item) }) });
        return send(200, { project: await commitCompatibility(project, gated, deps) });
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
      if (data.generationPolicy !== undefined) project.generationPolicy = normalizeGenerationPolicy(data.generationPolicy);
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
      if (data.generationPolicy !== undefined) project.generationPolicy = normalizeGenerationPolicy(data.generationPolicy);
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
      const data = await body(req);
      const result = await enqueueProject(uid, id, () => {
        const latest = store.get(uid, id);
        if (latest?.status !== 'generating' || !latest.editing?.contentOpen) throw new HttpError(409, 'content generation has finished; add pages in the editor');
        if (!editableCapabilities(latest).insertSlide) throw new HttpError(409, 'native templates do not support blank insertion');
        if (latest.outline.length >= 100) throw new HttpError(409, 'presentation already has 100 slides');
        const requested = typeof data.afterSlideId === 'string' ? latest.outline.findIndex(slide => slide.id === data.afterSlideId) : -1;
        if (data.afterSlideId && requested < 0) throw new HttpError(409, 'target slide no longer exists');
        const index = requested >= 0 ? requested + 1 : latest.outline.length;
        const slideId = newIrId('slide');
        latest.outline.splice(index, 0, { id: slideId, section: '手动页面', title: '新页面', focus: 'manual blank', description: '', children: [], refs: [], manualBlank: true });
        latest.nodes ||= {};
        latest.nodes[slideId] = { status: 'done', attempts: 0, slide: { id: slideId, title: '新页面', bullets: [], blocks: [], layoutId: 'summary', manualBlank: true } };
        latest.pages = latest.outline.length; store.save(latest);
        try { emitRunProgress(latest, 'slide.manual-added', { slideId, index }); } catch {}
        return latest;
      });
      return send(201, { project: result });
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
        return send(200, { project: await enqueueProject(uid, id, () => setMetadata(getStructuredProject(uid, id), data)) });
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
        return send(200, { project: await commitCompatibility(project, gated, deps) });
      } finally { editing.delete(id); }
    }
    return send(404, { error: 'not found' });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error?.code === 'TEMPLATE_REUSE_UNAVAILABLE' ? 400 : error.statusCode === 400 ? 400 : 500;
    if (status === 500) log(`ppt API error: ${String(error?.message || error).slice(0, 300)}`);
    return send(status, { error: status === 500 ? 'PPT service error' : error.message });
  }
}

export const _internals = { normalizeOutline, normalizeDeck, normalizeSlide, parseModelJson, pages, outlinePrompt, contentPrompt, defaultDeps };

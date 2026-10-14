import {outlineRangeRepairPrompt,applyOutlineRangeRepair} from './ppt-outline-range-repair.mjs';
import {prepareLanguagePairAudit,languagePairAuditSchema} from './ppt-language-pair-audit.mjs';
import {prepareLanguageProjection} from './ppt-language-projection.mjs';
import {displayedDocumentTitle}from './ppt-deck-coherence.mjs';
import {operationHistory}from './ppt/command-history.mjs';
import {optionalCopyRepair}from './ppt-optional-copy-repair.mjs';
import {refreshDerivedSource}from './ppt-source-refresh.mjs';
import {refitSourceMedia}from './ppt-media-refit.mjs';
import {libraryEligible}from './ppt-library.mjs';
import {reviewResponseSchema}from './ppt-review-schema.mjs';
import {normalizeDeckEyebrows} from './ppt-section-eyebrow.mjs';
import {recordRepairComparison,recordRepairSet} from './ppt/repair-comparison.mjs';
import {confirmNativeOutlineFit,outlineConfirmationHash,recordOutlineConfirmation} from './ppt-outline-confirmation.mjs';
import {outlineSelectionRepairPrompt,applyOutlineSelectionRepair,selectionDeltaResponseSchema} from './ppt-outline-selection-repair.mjs';
import {prepareNavigationPlan,navigationResponseSchema} from './ppt-navigation-plan.mjs';
import {bindDeckNavigation,finalDeckNavigation,navigationWriterHeaders} from './ppt-deck-navigation.mjs';
import {commitSourceComponents,componentLeaseToken} from './ppt/component-commit.mjs';
import {executePostWriterPlan} from './ppt-postwriter-executor.mjs';
import {postWriterPlan} from './ppt-postwriter-plan.mjs';
import {confirmedPageDecision,automaticPageDecision} from './ppt-page-decision.mjs';
import {writerDeltaResponseSchema, writerLocalRepairScope,applyWriterLocalDelta,writerLocalRepairPrompt} from './ppt-writer-local-repair.mjs';
import {RENDER_CONTRACT_VERSION} from './ppt/render-contract.mjs';
import {renderIssues} from './ppt/render-audit.mjs';
import {compileContentSelection,selectionSource,exactPageConflict,coalesceEquivalentSelections, visibleEquivalentCandidates } from './ppt-content-selection.mjs';
import {taskSummary,liveProjectView} from './ppt/project-view.mjs';
import { repeatedFocusMetadataError,pruneEmptySelectedPages,retainOutlineRepair,resumeOutlineRepair,outlineSummaryRepairPrompt,applyOutlineSummaryRepair,outlineMetadataRepairPrompt,applyOutlineMetadataRepair,repairOutlineMetadataBatch,outlineOwnershipRepairPrompt,applyOutlineOwnershipRepair,outlineRelationBatchRepairPrompt,applyOutlineRelationBatchRepair,outlineRelationRepairPrompt,applyOutlineRelationRepair,orderSourceConclusion, contentDistribution, inspectSkeletonOwnership, skeletonBatches, outlineDraftFromPartialJson, assembleSkeletonBatches, outlineResponseSchema, outlineDeltaPrompt, applyOutlineDelta, compileSkeleton, skeletonPrompt, parseOutlineJson, userRequirements, candidateRecord, promptTelemetry, fragmentTitle, outlineError } from './ppt-outline-protocol.mjs';
import { pptModelJobs, PPT_BYOK_CAPABILITIES } from './ppt-model-jobs.mjs';
import { preserveCopyRepairFrame, validateRepairCandidate, validateSourceRewriteWithReflow } from './ppt-repair-routing.mjs';
import { assertCandidateScope } from './ppt/input-scope-service.mjs';
import { automaticPages, densityProfile, densityPrompt } from './ppt-density-profile.mjs';
import { candidateFit, packOutline, inspectDensityOutline, revalidateOutlineFits } from './ppt-density-packing.mjs';
import {isSourceArtifactItem} from './ppt-density-capacity.mjs';
import { outlineCapacityRepairPrompt, applyOutlineCapacityRepair, outlineCapacityRepairScopes, partitionOutlineWithMeasuredComponents, restoreMissingSourceArtifacts, splitReadingUnits } from './ppt-outline-capacity-repair.mjs';
import { replaceTemplateSourceRegion, bindSourceArtifacts, bindSourceMedia, isSourceOwnedNode } from './ppt-source-artifacts.mjs';
import { acceptExportVerification, blockExportVerification } from './ppt-export-integrity.mjs';
import { templateLimits } from './ppt-template-security.mjs';
import { importEditablePptx as importTemplateIR } from './ppt/import-pptx.mjs';
import { markPptTime } from './ppt-trace.mjs';
import { normalizeGenerationPolicy, defaultGenerationPolicy, requestedPageCount, PPT_PROMPT_CONTRACT_VERSION } from './ppt-generation-policy.mjs';
import { outlineGrowth, outlineConcisionMetrics, concisionPlannerRule, routeTranslationsToNotes } from './ppt-outline-concision.mjs';
import { condenseOverflowingTables, mergeUnderfilledPages, pageLoad } from './ppt-outline-condense.mjs';
import { syncPresentationPolicy } from './ppt-presentation-policy.mjs';
import { normalizePageContract } from './ppt-page-contract.mjs';
/** M1 PPT Workspace API and durable, server-side job orchestration.
 * All model calls and PPTX rendering run in a Cowork container. Project JSON
 * lives on the server data disk, so a second signed-in desktop sees the same
 * project and can export its completed presentation. */
import * as store from './ppt-store.mjs';
import * as orch from './orchestrator.mjs';
import * as files from './files.mjs';
import { runRoutine } from './routine-runner.mjs';
import { writerSourceEvidenceIds, promptPolicy, writingGuide, outputLanguage, normalizeKeyPoints, canonicalWriterOutput, criticRewriteTargets, sourcePacket, slideSemanticContext, writerPrompt, writerRepairPrompt, writerCorrectionContext, outlineContentContract, OUTLINE_SCHEMA } from './ppt-prompt-contracts.mjs';
import { renderPptx } from './ppt/exporters/pptx.mjs';
import { renderPdf } from './ppt/exporters/pdf.mjs';
import { extractFile, normalizePaste, mergeSourceMedia, validateFile, sha256 } from './ppt-source.mjs';
import { BUILT_INS, templateFor, validateTemplate, analyzeTemplate, snapshotTemplate } from './ppt-template.mjs';
import { normalizeBlocks, normalizeSourceImages } from './ppt-blocks.mjs';
import { applyLayoutRegistry, LAYOUTS } from './ppt-layout.mjs';
import { boundedAll, dagNodeId, nodeRecord } from './ppt-dag.mjs';
import { deterministicReview, finalQualityReport, inspectMedia, inspectSourceForSlide, reviewWithContractRepair, repairProject } from './ppt-quality.mjs';
import { ensureDeckV3, ensureProjectV3, newId as newIrId, stableId } from './ppt/ir.mjs';
import { buildRenderTree } from './ppt/render-tree.mjs';
import { emitRunProgress, completeRun, recoverRun, startRun, transitionNode } from './ppt/run-service.mjs';
import { updateDraft, clearDraft } from './ppt/draft-store.mjs';
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
import { sourceBackedDetails, buildPlanning, estimatePageRecommendation, inspectLongDeckOutline, normalizeFactSynthesis, refreshPlanning, retrieveSlideSources, sourceCapacityPlan, estimationSource, sourcePlanningContext } from './ppt-planning.mjs';
import { planSparseInput, profilePptInput } from './ppt-content-depth.mjs';
import { compileSectionLabel, formatUserDeckTitle, inspectSlideCopy, materializeCopy } from './ppt-presentation-writing.mjs';
import { dominantInputLanguage, normalizeTopicTitle, closingTopic } from './ppt-topic-language.mjs';
import { inspectNativeCoverTitle, inspectNativeOutlineTitles, prepareTemplateFidelity, repairNativePageAssignment, rescheduleTemplateFidelity, templateSlotPrompt, templateOutlinePrompt, inspectTemplateSlotDraft, autoTemplateMediaOmissions, bindTemplateFidelity, renderTemplatePptx } from './ppt-template-fidelity.mjs';
import { templateReuseError } from './ppt-template-scheduler.mjs';
import { inspectReportOutline } from './ppt-report-qa.mjs';
import { reorderManual, sortManual } from './ppt-manual-order.mjs';
import { runtimeState, checkpoint, updateSlidePreview, finishPause, reconcileCheckpoint, acquireGenerationLease } from './ppt/runtime.mjs';
import { synchronizePlan, bindReview, reviewIsCurrent, semanticReviewKey, invalidateReviews } from './ppt/versioning.mjs';
import { effectiveConstraints } from './ppt/mutation-router.mjs';
import { digest } from './ppt/edit-context.mjs';
import { transformGeneratedSlide } from './ppt/generation-edit-service.mjs';

const running = new Set();
const editing = new Set();
const MAX_PROMPT = 80000;
const MAX_TEXT = 160;
const PPT_NODE_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.PPT_NODE_CONCURRENCY) || 3));
const PPT_RE = /^\/ppt\/projects(?:\/([a-f0-9]{32}))?(?:\/(outline|generate|retry|export|pdf|source|duplicate|trash|restore|permanent|versions|rewrite|blank|media-exclusions|page-policy))?$/i;
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
const parseModelJson = parseOutlineJson;
function sourceFromDeck(base) {
  const segments = (base.deck?.slides || []).map((slide, index) => ({ id: String(index + 1), location: `旧版第 ${index + 1} 页`, text: JSON.stringify(slideSemanticContext(slide)) }));
  return { kind: 'base', name: base.title, text: segments.map(s => s.text).join('\n\n'), segments };
}
function mergeSources(parts) {
  const segments = parts.flatMap(({ origin, info }) => (info.segments || []).map((item, index) => ({
    ...item,id: `${origin === 'base' ? 'B' : 'U'}${index + 1}`, origin,
    location: `${origin === 'base' ? '旧版' : '进展'} · ${item.location}`, text: item.text,
  })));
  const images=parts.flatMap(({origin,info})=>(info.images||[]).map(image=>({...image,
    sourceRefs:(image.sourceRefs||[]).map(ref=>{const index=(info.segments||[]).findIndex(s=>s.id===ref);return index<0?ref:`${origin==='base'?'B':'U'}${index+1}`;})})));
  return withSemanticIndex({ kind: 'update', name: parts.map(p => p.info.name).join(' + '), text: segments.map(s => s.text).join('\n\n').slice(0, 80000), segments, truncated: parts.some(p => p.info.truncated),...mergeSourceMedia({images}),mediaWarnings:parts.flatMap(p=>p.info.mediaWarnings||[]) });
}
function mergeSourceSupplement(source, supplement, prompt = '', includeSegments = true) {
  if (includeSegments && supplement?.segments?.length && /^\s*\|.+\|\s*$|```|<svg\b/imu.test(prompt)) {
    const extra=supplement.segments.map((segment,i)=>({...segment,id:`S${i+1}`,location:'补充输入 · '+segment.location}));
    const refs=new Map(supplement.segments.map((segment,i)=>[segment.id,extra[i].id]));
    supplement={...supplement,images:(supplement.images||[]).map(image=>({...image,sourceRefs:(image.sourceRefs||[]).map(ref=>refs.get(ref)||ref)}))};
    source={...source,segments:[...(source.segments||[]),...extra],text:[source.text,...extra.map(s=>s.text)].filter(Boolean).join('\n\n')};
  }
  return {...source,...mergeSourceMedia({images:[...(source.images||[]),...(supplement?.images||[])]}),mediaWarnings:[...(source.mediaWarnings||[]),...(supplement?.mediaWarnings||[])]};
}
function outlineValues(values,count,max,field) {
  if(!Array.isArray(values))return [];
  if(values.length>count || values.some(value=>typeof value!=='string'||value.trim().length>max))throw new Error(`${field} exceeds its contract; redistribute full facts rather than truncating them`);
  return values.map(value=>value.trim());
}
function normalizeOutline(value, count, source, update = null, deckTitle = null, topicLanguage = null) {
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
    const generatedTitle = normalizeTopicTitle(bounded(s.title, MAX_TEXT, `slide ${index + 1} title`), topicLanguage);
    const title = index === 0 && deckTitle?.source === 'user' && deckTitle?.text ? deckTitle.text : generatedTitle;
    const focus = bounded(s.focus || s.summary || s.title, 360, `slide ${index + 1} focus`);
    const oldFocus = update?.baseSnapshot.outline?.find(slide => slide.id === baseSlideId)?.focus;
    // A former closing page shows the greeting as its deck title; its planned
    // outline title is the identity a keep decision is compared with.
    const baseTitles = new Set([base?.title, update?.baseSnapshot.outline?.find(slide => slide.id === baseSlideId)?.title].filter(Boolean));
    if (change === 'keep' && (!baseTitles.has(title) || (oldFocus && focus !== oldFocus))) change = 'rewrite';
    const children = Array.isArray(s.children) ? s.children.slice(0, 12).map((child, childIndex) => ({
      id: typeof child?.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(child.id) ? child.id : newIrId('item'),
      title: normalizeTopicTitle(bounded(child?.title || `子章节 ${childIndex + 1}`, MAX_TEXT, `slide ${index + 1} child title`), topicLanguage),
      description: bounded(child?.description || child?.title || '', 360, `slide ${index + 1} child description`, false),
    })) : [];
    const keyPoints = normalizeKeyPoints(s.keyPoints || s.key_points, source);
    return { id: typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s.id) ? s.id : newIrId('slide'), title,
      focus, description: bounded(s.description && s.description !== focus ? s.description : '', 360, `slide ${index + 1} description`, false), children,
      section: compileSectionLabel(normalizeTopicTitle(bounded(s.section || s.title, MAX_TEXT, `slide ${index + 1} section`), topicLanguage)),
      refs: [...new Set([...(Array.isArray(s.refs) ? s.refs.map(String) : []), ...keyPoints.flatMap(point => point.refs)])].filter(ref => validRefs.has(ref)),
      ...((Array.isArray(s.chunkRefs) || keyPoints.some(point => point.chunkRefs.length)) ? { chunkRefs: [...new Set([...(Array.isArray(s.chunkRefs) ? s.chunkRefs.map(String) : []), ...keyPoints.flatMap(point => point.chunkRefs)])].filter(ref => validChunkRefs.has(ref)) } : {}),
      ...(s.planningProtocolVersion===2?{planningProtocolVersion:2}:{}),
      ...(s.region==='appendix'?{region:'appendix'}:{}),
      ...(typeof s.role === 'string' ? { role: s.role.slice(0, 40) } : {}),
      ...(typeof s.question === 'string' ? { question: s.question.slice(0, 240) } : {}),
      ...(typeof s.headlineIntent === 'string' || typeof s.headline_intent === 'string' ? { headlineIntent: String(s.headlineIntent || s.headline_intent).slice(0, 160) } : {}),
      ...(typeof s.audienceTakeaway === 'string' || typeof s.audience_takeaway === 'string' || typeof s.takeaway === 'string' ? { audienceTakeaway: String(s.audienceTakeaway || s.audience_takeaway || s.takeaway).slice(0, 240) } : {}),
      ...(Array.isArray(s.sourceTopics || s.source_topics) ? { sourceTopics: (s.sourceTopics || s.source_topics).filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 120)) } : {}),
      ...(typeof s.transitionFromPrevious === 'string' || typeof s.transition_from_previous === 'string' ? { transitionFromPrevious: String(s.transitionFromPrevious || s.transition_from_previous).slice(0, 180) } : {}),
      ...(typeof s.transitionToNext === 'string' || typeof s.transition_to_next === 'string' ? { transitionToNext: String(s.transitionToNext || s.transition_to_next).slice(0, 180) } : {}),
      keyPoints,
      ...(Array.isArray(s.sourceUnitIds) ? { sourceUnitIds: [...new Set(s.sourceUnitIds)].filter(id => source?.semantic?.inventory?.items?.some(item => item.id === id)) } : {}),
      ...(s.pageContract && typeof s.pageContract === 'object' ? { pageContract: normalizePageContract(s.pageContract, source) } : {}),
      ...(Array.isArray(s.sourceImageIds) ? {sourceImageIds:[...new Set(s.sourceImageIds)].filter(id=>source?.images?.some(image=>image.id===id))}:{}),
      ...(Array.isArray(s.repeatSourceUnitIds)?{repeatSourceUnitIds:s.repeatSourceUnitIds}:{}),
      ...(Array.isArray(s.sourceArtifactRanges) ? { sourceArtifactRanges: s.sourceArtifactRanges } : {}),
      ...(s.densityFit ? { densityFit: s.densityFit } : {}),
      ...(Array.isArray(s.packedFrom) ? { packedFrom: s.packedFrom } : {}),
      ...(s.capacityPartition ? {capacityPartition:true} : {}),
      ...(typeof s.groupId === 'string' ? { groupId: s.groupId.slice(0, 80) } : {}),
      ...(Array.isArray(s.supportingPoints) ? { supportingPoints: outlineValues(s.supportingPoints,6,2000,'supportingPoints') } : {}),
      ...(Array.isArray(s.requiredSupport || s.required_support) ? { requiredSupport: outlineValues(s.requiredSupport || s.required_support,6,200,'requiredSupport') } : {}),
      ...(s.visualIntent && typeof s.visualIntent === 'object' && typeof s.visualIntent.type === 'string' ? { visualIntent: { type: s.visualIntent.type.slice(0, 40) } } : {}),
      ...(typeof s.density === 'string' ? { density: s.density.slice(0, 20) } : {}),
      ...(typeof s.distributionType === 'string' || typeof s.distribution_type === 'string' ? { distributionType: String(s.distributionType || s.distribution_type).slice(0, 40) } : {}),
      ...(Number.isInteger(s.semanticUnitBudget || s.semantic_unit_budget) ? { semanticUnitBudget: Math.max(2, Math.min(10, Number(s.semanticUnitBudget || s.semantic_unit_budget))) } : {}),
      ...(typeof s.pointLengthProfile === 'string' || typeof s.point_length_profile === 'string' ? { pointLengthProfile: String(s.pointLengthProfile || s.point_length_profile).slice(0, 24) } : {}),
      ...(Array.isArray(s.requiredDetails || s.required_details) ? { requiredDetails: outlineValues(s.requiredDetails || s.required_details,1000,4000,'requiredDetails') } : {}),
      ...(Array.isArray(s.requiredEvidenceIds || s.required_evidence_ids) ? { requiredEvidenceIds: [...new Set(s.requiredEvidenceIds || s.required_evidence_ids)].filter(id =>
        (source?.semantic?.evidenceAtoms || []).some(atom => atom.id === id)).slice(0, 6) } : {}),
      ...(Array.isArray(s.claimIds || s.claim_ids) ? { claimIds: (s.claimIds || s.claim_ids).filter(id => typeof id === 'string').slice(0, 1000) } : {}),
      ...(typeof s.narrativeRole === 'string' || typeof s.narrative_role === 'string' ? { narrativeRole: String(s.narrativeRole || s.narrative_role).slice(0, 40) } : {}),
      ...(typeof s.evidenceIntent === 'string' || typeof s.evidence_intent === 'string' ? { evidenceIntent: String(s.evidenceIntent || s.evidence_intent).slice(0, 80) } : {}),
      ...(s.titleLocked === true || s.title_locked === true || (index === 0 && deckTitle?.locked) ? { titleLocked: true } : {}),
      ...(update ? { baseSlideId, change } : {}) };
  });
}
function normalizeDeck(value, outline, previousDeck) {
  if (!Array.isArray(value?.slides) || value.slides.length !== outline.length) throw new HttpError(400, `内容需要恰好 ${outline.length} 页`);
  const deck = {
    ...(previousDeck || {}), schemaVersion: 1,
    slides: value.slides.map((s, index) => {
      if (!s || typeof s !== 'object') throw new HttpError(400, `slide ${index + 1} invalid`);
      const previous=previousDeck?.slides?.find(slide=>slide.id===outline[index].id);
      // Legacy fields are projections, not a second source of truth. A save
      // round-trip must preserve rich tables, math, captions and stable IDs.
      if(previous && ['title','bullets','blocks','layout','layoutId'].every(key=>JSON.stringify(s[key])===JSON.stringify(previous[key]))) return structuredClone(previous);
      if (!Array.isArray(s.bullets) || s.bullets.length > 10) throw new HttpError(400, `第 ${index + 1} 页要点无效`);
      if (s.bullets.reduce((n, b) => n + (typeof b === 'string' ? b.length : 0), 0) > 15000) {
        throw new HttpError(400, `第 ${index + 1} 页文字过多，请缩短要点`);
      }
      let blocks;
      const protectedNodes=previous?.nodes?.filter(node=>isSourceOwnedNode(node)||node.nativeRef)||[];
      const protectedIds=new Set(protectedNodes.map(node=>node.id));
      for(const block of s.blocks || []) if(protectedIds.has(block.id) && JSON.stringify(block)!==JSON.stringify(previous.blocks?.find(item=>item.id===block.id))) throw new HttpError(400,'Edit source or native objects through the component editor');
      try { blocks = normalizeBlocks((s.blocks||[]).filter(block=>!protectedIds.has(block.id))); } catch (error) { throw new HttpError(400, `slide ${index + 1}: ${error.message}`); }
      if (blocks.length && (s.bullets.length > 10 || s.bullets.join('').length > 10000)) throw new HttpError(400, `slide ${index + 1}: visual slide copy exceeds capacity`);
      const layout = s.layout || 'text-first';
      if (!['text-first', 'visual-first'].includes(layout)) throw new HttpError(400, `slide ${index + 1}: invalid layout`);
      const layoutId = s.layoutId === undefined ? undefined : bounded(s.layoutId, 40, `slide ${index + 1} layout`);
      if (layoutId && !LAYOUTS[layoutId]) throw new HttpError(400, `slide ${index + 1}: unknown layout`);
      const normalized = {
        id: outline[index].id,
        title: bounded(s.title, MAX_TEXT, `slide ${index + 1} title`),
        bullets: s.bullets.map((b) => bounded(b, 4000, 'bullet')),
        sourceRefs: outline[index].refs || [],
        blocks,
        layout,
        ...(s.manualBlank || outline[index].manualBlank ? { manualBlank: true } : {}),
        ...(layoutId ? { layoutId } : {}),
      };
      if(!previous)return normalized;
      const updated=structuredClone(previous);
      updated.title=normalized.title;updated.bullets=normalized.bullets;
      updated.layoutId=normalized.layoutId||updated.layoutId;updated.layoutRef=updated.layoutId;
      const titleNode=updated.nodes.find(node=>node.semanticRole==='title'&&node.type==='text');
      if(titleNode)titleNode.content.text=normalized.title;
      else if(normalized.title!==previous.title)throw new HttpError(400,'Edit native titles through the component editor');
      const bodyNode=updated.nodes.find(node=>node.semanticRole==='body'&&node.type==='list');
      if(bodyNode)bodyNode.content.items=normalized.bullets.map((text,n)=>{
        const old=bodyNode.content.items[n];
        return old?.text===text?old:{id:old?.id||stableId('item',updated.id,'body',n),text};
      });
      else if(normalized.bullets.length)throw new HttpError(400,'Edit structured source text through the component editor');
      if(bodyNode && updated.copy)updated.copy.blocks=bodyNode.content.items.map(item=>({type:item.pointType||'support',heading:item.heading||'',body:item.body||item.text,
        ...(item.claimId?{claimId:item.claimId}:{}),...(item.repeatPurpose?{repeatPurpose:item.repeatPurpose}:{}),...(item.sourceRefs?{sourceRefs:item.sourceRefs}:{})}));
      updated.nodes=updated.nodes.filter(node=>!['image','chart','table','shape'].includes(node.type)||protectedIds.has(node.id));
      for(const block of blocks){const {id,type,...content}=block;const old=previous.nodes.find(node=>node.id===id);updated.nodes.push({...old,id,type,content,semanticRole:old?.semanticRole||'visual',slotId:old?.slotId||'visual',styleRef:old?.styleRef||`${type}.default`});}
      updated.nodeOrder=updated.nodes.map(node=>node.id);
      return updated;
    }),
  };
  return ensureDeckV3(applyLayoutRegistry(deck));
}
function outlinePrompt(p) {
  if(!p.update && !p.requestedOutline){
    const auto=automaticPages(p);
    const overviewNotes=p.generationPolicy?.content==='overview'&&p.generationPolicy?.details==='notes';
    const preservation=overviewNotes
      ?'Preserve the complete immutable original in speaker notes. Main slides are a concise overview, NOT full-source reproduction: put core definitions, mechanisms, necessary numbers/formulas, conditions/limitations and explicit list members on slides. Use semantic summaryText for eligible non-structured target-language prose; move authorized secondary details and omitted code to notes with an explicit selection ledger. Never list a notes ID as a primary slide owner. Group several related units under one shared reader question and real measured component layout; neither one paragraph nor one source unit earns a page. Definitions, evidence and their qualifiers belong in one coherent reading group when they fit.'
      :'Keep every required source object, all table columns/tail rows, formulas/variables/conditions.';
    const pairPolicy=overviewNotes&&p.generationPolicy?.language?.mode==='output'
      ?'Detected equivalent language pairs use one target-language visible owner, with the complete originals in notes and a verified visibleEquivalentSourceUnitId. Budget the target-language display only; protected structures still retain every member and condition.'
      :overviewNotes&&p.generationPolicy?.language?.body==='primary'?'Detected bilingual pairs: the original-language unit is the one visible owner; its translation goes to notes with visibleEquivalentSourceUnitId. Budget one display cost per pair; titles and section labels stay bilingual.'
      :'Translation pairs are one claim with two display costs.';
    return skeletonPrompt(p,`You are a source-grounded presentation planner. No tools, no fabricated facts. output_language=${p.generationPolicy?.language?.mode==='output'?outputLanguage(p):'preserve source languages'}; knowledge=${p.generationPolicy?.knowledge||'source_only'}; content_contract=${p.generationPolicy?.content||'full_source'}. ${auto?'Pages are provisional; choose 3–100 pages by semantic relationships and native capacity.':`Exactly ${p.pages} pages including cover and conclusion.`} ${preservation} ${pairPolicy} ${concisionPlannerRule(p)} Avoid repeating tables as prose. Native capacity=${JSON.stringify(sourceCapacityPlan(estimationSource(p),p.pages,p)?.capacity)}. Locked cover title=${JSON.stringify(p.deckTitle?.source==='user'?p.deckTitle.raw:null)}; required images=${JSON.stringify((p.source?.images||[]).filter(x=>x.required||x.mustPreserve).map(x=>x.id))}.`);
  }
  const sourceContext = sourcePlanningContext(p.source);
  const pageRecommendation = estimatePageRecommendation(p);
  const automatic = automaticPages(p);
  const capacity = sourceCapacityPlan(estimationSource(p), p.pages, p);
  const allocationContract = capacity ? `来源负载为 ${capacity.contentCost} projected_display_visual_units；候选内容组：${JSON.stringify(capacity.groups).slice(0, 14000)}。它们是可组合的初估，不是章节页配额。按受众问题将相关定义、条件、比较与实例组合，保留末尾总结、表格列、公式与条件、流程关系。` : '';
  const pageContract = automatic
    ? `project.pages=${p.pages} 是初步建议，不是最终页数命令；按候选语义组与真实版面容量输出3–100页的完整大纲。允许与初估不同，不以每章至少一页或固定10/12页决定数量。代码会校验分组与拟合后冻结数量。`
    : `当前 project.pages=${p.pages} 是本轮最终页数硬参数（含封面），必须准确规划成 ${p.pages} 页；用户指定和最终确认优先，不得依据模板页数更改。`;
  const userOutlineContract = p.outlineSeed?.length ? `用户手动编辑过的大纲草稿：${JSON.stringify(p.outlineSeed)}。在调整为 ${p.pages} 页时优先保留用户改过的标题和重点；需要合并或拆分时保持原意，不复制同一观点凑页。` : '';
  const sparsePlan = p.contentPlan || planSparseInput(p);
  const userTitle = p.deckTitle?.source === 'user' ? p.deckTitle.raw : '';
  const titleContract = userTitle
    ? `用户 Deck Title 为「${userTitle}」。它已锁定：封面 title 必须保持原词、原语言和原术语，不得改写、缩短或翻译；只能由渲染器换行。`
    : '用户没有填写 Deck Title。为封面生成一个精炼标题：中文优先 6–18 字，英文优先 2–8 个词，最多两行；额外背景放入 focus 或后续 subtitle。';
  const planningContract = `先在内部建立 Presentation Brief（目标、受众、核心论点、深度、mustInclude、reportMode、decisionQuestion、sourceScope），再规划有起承转合的 storyArc。reportMode 只选 presentation、informational 或 decision；决策或职场汇报需在前 3 页给出摘要或需要回答的决定，较早展示核心流程/证据，结尾给出来源支持的条件性建议与下一步；资料不足时不要虚构建议或案例，而应在 sourceScope 记录缺口，在页面保留影响理解的限制。主文尽量集中，补充细节放 appendix。页数优先级固定为：用户手动调整或明确指定 > PPT 模块估算 > 模板原有页数。模板页数只决定原生版式选择和安全复用，不得更改输出页数。${pageContract}${densityPrompt(p)}模块估算为 ${pageRecommendation.recommended} 页（范围 ${pageRecommendation.range[0]}–${pageRecommendation.range[1]}），只用于未指定页数时的默认值及判断内容密度、压缩风险。${allocationContract}${userOutlineContract}${titleContract} Story Planner 输出 section label、title intent 和 slide message，section 使用 4–12 个中文字符或 2–8 个英文词；不要直接复制来源长标题。同一页可整合多个来源，一个来源也可支持多页，但拆分后的每页须有不同的问题、独立主张或证据作用；不可用同义改写凑足页数。来源不足时在 sourceScope 记录，并在页面保留必要的适用边界，不要补造材料。每页根据内容规划解释深度、分布和结构，不要固定三条 bullet。整稿应有密度节奏：摘要与过渡、普通说明、高密度流程或深机制交错；不要连续多页都写成高密度卡片。若来源包含可复算的公式、代码或算例，必须把核心表达式、变量含义和适用条件列入相应页 requiredDetails，不能只保留流程概述；特殊数学符号要规划成可见的普通文本表示。每个高优先级主题必须出现在页面 refs 中，或在 coverage 中说明省略原因。${templateOutlinePrompt(p)}`;
  const planningSchema = OUTLINE_SCHEMA;
  const contentPlanning = outlineContentContract(p)+`\n来源媒体目录：${JSON.stringify((p.source?.images||[]).map(({id,caption,sourceRefs,width,height,role,required})=>({id,caption,sourceRefs,width,height,role,required})))}。必保留图片通过sourceImageIds分配到回答相关问题的页面，图片大小不是省略理由。`;

  if (p.update) {
    const base = p.update.baseSnapshot;
    const old = base.deck?.slides ? JSON.stringify(base.deck.slides.map(slide => ({ id: slide.id, ...slideSemanticContext(slide) }))) : base.source?.text || '';
    const progress = (p.source?.segments || []).filter(s => s.origin === 'progress').map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 14000);
    return `你是演示文稿版本更新规划器。${planningContract}${contentPlanning} 仅分析旧版与用户提供的新进展；不搜索、不调用工具、不编造数字。旧版：${base.title}\n旧版内容：\n${old}\n最新进展：\n${progress || p.prompt}\n语义索引：\n${sourceContext.slice(0, 12000)}\n生成恰好 ${p.pages} 页的新大纲，返回唯一 JSON：${planningSchema}。每个 slide 另加 baseSlideId（旧页 ID 或 null）和 change（keep|rewrite|add）。原样保留且内容不变的页用 keep；需要改写的旧页用 rewrite；新页用 add。不得虚构旧页 ID 或来源编号。只输出 JSON。`;
  }
  if (p.source?.segments?.length) {
    return `你是演示文稿叙事规划器。${planningContract}${contentPlanning} 只分析以下用户提供的来源，不搜索、不调用工具、不编造数字。文件名：${p.title}；页数：${p.pages}。\n来源（chunkRefs 用语义 chunk ID；refs 用索引列出的原始来源编号）：\n${sourceContext}\n返回唯一 JSON：${planningSchema}。${automatic ? 'slides 数量按问题分组与拟合决定；' : `slides 恰好 ${p.pages} 个；`}第一页封面，最后一页总结。相邻页面可以共享 section，每页 chunkRefs 和 refs 只能引用上面实际存在的编号。只输出 JSON。`;
  }
  return `你是演示文稿叙事规划器。${planningContract}${contentPlanning} 只做内容结构，不写代码、不调用工具、不生成 PPTX、不搜索网页。\n主题：${p.prompt}\n短输入预规划（这些是待论证问题，不是已证实事实）：${JSON.stringify(sparsePlan || {})}\n先依据该 Content Plan 与 Semantic Unit Inventory 扩展完整的概念结构和故事骨架，${automatic ? '再组合成有容量依据的候选页面，不受初估数量约束。' : `再按用户确定的 ${p.pages} 页分配。`}缺乏来源时可解释通用机制、示意框架和评估方法；不得把公司特定数据、客户、项目、效果或财务数字写成事实。页数少时合并相邻问题，页数多时把机制、条件和评估拆开，不能添加同义 filler。\n文件名：${p.title}\n页数：${p.pages}。\n返回唯一 JSON：${planningSchema}。${automatic ? 'slides 数量按分组与容量决定，' : `slides 必须恰好 ${p.pages} 个，`}第一页是封面，最后一页是结论。每页有不同的逻辑作用，不要编造具体数字；纯 Prompt 输入时 refs 为空。只输出 JSON。`;
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
  const canStart = () => { const latest = store.get(p.uid, p.id,{hydrate:false}); return Boolean(latest && !latest.deletedAt && latest.status !== 'cancelled' && (!(options.nodeKey || '').startsWith('content:') && !(options.nodeKey || '').startsWith('review:deck') || (latest.status !== 'paused' && !latest.runtime?.pauseRequested))); };
  const writerSlide=p.outline?.find(slide=>options.nodeKey===`content:${slide.id}`||String(options.nodeKey||'').startsWith(`content:${slide.id}:`));
  const writerEpoch=writerSlide?generationEpoch(p,writerSlide.id):null,writerRun=p.currentRunId,writerBaseRevision=p.revision,writerLease=componentLeaseToken(p);
  const onProgress=writerSlide?progress=>{
    const latest=store.get(p.uid,p.id);
    if(!latest||latest.deletedAt||latest.status!=='generating'||latest.currentRunId!==writerRun||generationEpoch(latest,writerSlide.id)!==writerEpoch)return;
    const draft=updateDraft(latest,writerSlide.id,{...progress,runId:writerRun,epoch:writerEpoch,sourceHash:p.source?.sha256||''});
    const refs=draft?.blocks?.map(block=>block.sourceRef).filter(Boolean)||[];
    if(refs.length)void enqueueProject(p.uid,p.id,()=>{
      const current=store.get(p.uid,p.id);if(!current)return;
      const result=commitSourceComponents(current,{slideId:writerSlide.id,runId:writerRun,epoch:writerEpoch,baseRevision:writerBaseRevision,sourceHash:p.source?.sha256||'',lease:writerLease,refs});
      if(result.status==='committed'){store.save(current);emitRunProgress(current,'slide.component_commit',result.commit);}
    }).catch(error=>log?.warn?.('PPT component commit failed: '+String(error.message).slice(0,200)));
  }:options.onProgress;
  const selectionBudget=p.generationPolicy?.details==='notes'&&String(options.nodeKey||p.stage).startsWith('outline')
    ?((p.originalSourceInventory?.items||p.source?.semantic?.inventory?.items||[]).length*96+Number(p.pages||3)*128>16384?32768:16384):undefined;
  if (pptModelJobs.eligible(p.configId)) return parseModelJson(await pptModelJobs.request(p, prompt, canStart, {stage:options.nodeKey||p.stage,...(onProgress?{onProgress}:{}), ...promptTelemetry(prompt),maxOutputTokens:options.maxOutputTokens??selectionBudget,jsonSchema:languagePairAuditSchema(prompt)||writerDeltaResponseSchema(prompt)||selectionDeltaResponseSchema(prompt)||outlineResponseSchema(prompt)||reviewResponseSchema(prompt)||navigationResponseSchema(prompt),onTelemetry:telemetry=>{const latest=store.get(p.uid,p.id);if(latest){latest.modelUsage=[...(latest.modelUsage||[]).slice(-199),{stage:options.nodeKey||p.stage,model:p.model,...promptTelemetry(prompt),telemetry}];store.save(latest);}}}));
  try {
    const result = await runRoutine({ sid, uid: p.uid, kind: orch.KIND_PPT, prompt, model: p.model, configId: p.configId, activity, log,
      canStart });
    if (!result.ok) throw new Error(result.error || `模型任务失败：${result.status}`);
    return parseModelJson(result.resultText);
  } finally {
    if (sid !== p.id) await orch.removeContainer(sid, { keepVolume: false }).catch(() => {});
  }
}
const defaultDeps = { modelCall, renderPptx: project => project.templateFidelity?.mode === 'preserve' ? renderTemplatePptx(project) : renderPptx(project),
  prepareTemplateFidelity, importTemplateIR, renderPdf, extractFile, analyzeTemplate, readFile: files.readFile, removeContainer: orch.removeContainer };
function normalizeSlide(value, outlineSlide, project = null, previousTitles = []) {
  const index = project?.outline?.findIndex(item => item.id === outlineSlide.id) ?? -1;
  value = canonicalWriterOutput(value || {}, project?.templateFidelity?.mode === 'preserve' ? project.templateFidelity.slides[index] : null);
  if(outlineSlide.role==='navigation'&&!(outlineSlide.sourceUnitIds||[]).length){
    // The final approved plan owns chapter labels/ranges. A writer's unowned
    // course introduction must not replace that derived navigation object.
    value={...value,sourceCommentary:[],sourceArtifacts:[],sourceEvidenceIds:[],
      ...(project?.templateFidelity?.mode==='preserve'?{slotTexts:navigationWriterHeaders(project,outlineSlide,index)}:{})};
  }
  const frozenTitle=project?.confirmedOutline&&project.confirmedOutline.titlesFrozen!==false&&!project.editOutputLanguage&&!effectiveConstraints(project,outlineSlide.id).some(c=>c.type==='title');
  if(frozenTitle&&value.title!==outlineSlide.title)throw new Error('writer changed the confirmed outline title: return title exactly '+JSON.stringify(outlineSlide.title)+'; retain its frozen source ownership and page count');
  const visual = outlineSlide?.visualIntent?.type;
  const suggestedLayout = ({ image: 'image-text', comparison: 'comparison', pipeline: 'timeline', process: 'timeline', timeline: 'timeline', table: 'table', chart: 'chart', metric: 'big-number' })[visual];
  const compatible = suggestedLayout && (!['table', 'chart'].includes(suggestedLayout) || value?.blocks?.some(block => block.type === suggestedLayout));
  const preparedValue = { ...value, bullets: Array.isArray(value?.bullets) ? value.bullets : [] };
  const prepared = value?.layoutId || !compatible ? preparedValue : { ...preparedValue, layoutId: suggestedLayout };
  const slide = normalizeDeck({ slides: [prepared] }, [outlineSlide]).slides[0];
  const topicLanguage = project?.editOutputLanguage || dominantInputLanguage(project || {});
  const compiled = materializeCopy(value || {}, outlineSlide, project?.planning, previousTitles, topicLanguage);
  if(index===0&&project?.templateFidelity?.mode!=='preserve'&&!(outlineSlide.sourceUnitIds||[]).length&&(compiled.copy.blocks.length||value?.sourceCommentary?.length||slide.blocks.length))throw new Error('writer cover contract: unowned cover body is forbidden. Return contentBlocks=[], blocks=[], sourceCommentary=[], subtitle="", takeaway=""; preserve title only. All factual source units belong to the content pages.');
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
  if(frozenTitle)slide.title=outlineSlide.title;
  slide.bullets = compiled.bullets;
  const sectionSlot=project?.templateFidelity?.mode==='preserve'?project.templateFidelity.slides[index]?.slots.find(slot=>slot.role==='section'):null;
  const writtenSection=sectionSlot?value?.slotTexts?.[String(sectionSlot.shapeId)]:undefined;
  // The source chapter remains in the outline/contract. The native section
  // slot is a short navigation label, supplied and measured by the writer.
  slide.section = normalizeTopicTitle(typeof writtenSection==='string'&&writtenSection.trim()?writtenSection: value?.section || outlineSlide.section || compiled.copy.eyebrow, topicLanguage);
  slide.copy = compiled.copy;
  if (index > 0 && index === project?.outline?.length - 1 && !outlineSlide.titleLocked) {
    slide.title = closingTopic(topicLanguage); slide.closingGreeting = true;
    slide.titleQuality = {...slide.titleQuality,...formatUserDeckTitle(slide.title,compiled.copy.copyBudget),source:'agent',locked:false};
  }
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
    slide.templateSlotContentTypes = value?.slotContentTypes || {};
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
  if (project) {
    const assigned=project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id)?.sourceArtifacts||[];
    // The planner owns required structures. A writer cannot drop them by
    // returning an empty array; unsupported selections still fail validation.
    const selected=value?.sourceArtifacts?.length?value.sourceArtifacts:assigned;
    if(assigned.some(ref=>!selected.some(item=>item.sourceUnitId===ref.sourceUnitId &&
      (item.rowStart??1)===(ref.rowStart??1) && (item.rowEnd??project.source?.semantic?.inventory?.items?.find(o=>o.id===ref.sourceUnitId)?.rows?.length)===(ref.rowEnd??project.source?.semantic?.inventory?.items?.find(o=>o.id===ref.sourceUnitId)?.rows?.length))))throw new HttpError(400,`writer omitted a required source object or changed its row selection: ${JSON.stringify({expected:assigned,received:selected})}. Copy the frozen source selection exactly; row ranges are only valid for tables.`);
    const exactSourceOnly=project.generationPolicy?.content==='full_source'&&project.generationPolicy?.language?.mode==='source'&&project.generationPolicy?.knowledge==='source_only'&&assigned.length&&(outlineSlide.sourceUnitIds||[]).every(id=>assigned.some(ref=>ref.sourceUnitId===id));
    if(exactSourceOnly&&value?.sourceCommentary?.some(entry=>(typeof entry==='string'?entry:entry.text)?.trim()))throw new Error('writer source-only contract: complete frozen source already owns the visible body; sourceCommentary must be []. Do not repeat its statements or add a paraphrase. All original source objects and conditions stay visible.');
    const commentary=exactSourceOnly?[]:value?.sourceCommentary?.length?value.sourceCommentary:assigned.length && !value?.slotTexts
      ? slide.copy.blocks.map(block=>block.body):[];
    const requiredEvidence=writerSourceEvidenceIds(project,index,project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id),retrieval);
    if(value?.sourceEvidenceIds?.some(id=>!requiredEvidence.includes(id)))throw new Error('invalid source evidence selection: only frozen required evidence IDs may be bound');
    bindSourceArtifacts(project, slide, selected, index, commentary,requiredEvidence);
    bindSourceMedia(project,slide,outlineSlide.sourceImageIds||[],index);
    if(project.templateFidelity?.mode==='preserve')normalizeDeckEyebrows({...project,deck:{slides:project.outline.map((o,i)=>i===index?slide:{id:o.id,title:o.title,section:o.section,nodes:[]})}},{onlySlideId:slide.id});
  }
  if(project?.templateSpec&&project.templateFidelity?.mode!=='preserve'&&project.outline?.some(o=>o.id===slide.id)){
    const slides=project.outline.map(o=>o.id===slide.id?slide:project.deck?.slides?.find(s=>s.id===o.id)||{id:o.id,title:o.title,nodes:[]});
    const projected={...project,deck:ensureDeckV3(applyLayoutRegistry({slides}))};
    const failure=renderIssues(buildRenderTree(projected)).find(issue=>issue.slideId===slide.id&&issue.code==='rendered_title_capacity');
    if(failure)throw Object.assign(new Error(`rendered_title_capacity: ${JSON.stringify(failure.details)}. Shorten only the unlocked title to a complete concise topic; all body source facts and fonts remain unchanged.`),{code:'capacity_invalid'});
  }
  if(outlineSlide.role==='navigation'&&!(outlineSlide.sourceUnitIds||[]).length){
    const projected={...project,deck:{slides:project.outline.map(o=>o.id===slide.id?slide:{id:o.id,title:o.title,section:o.section,nodes:[]})},nodes:{}};
    bindDeckNavigation(projected);
  }
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
    if (slides.some(slide => slide.nodes?.some(node => node.type === 'image' && node.content?.dataUrl === image.dataUrl))) continue;
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

function deterministicGate(project) {
  project = ensureProjectTemplate(project);
  const beforeKey=semanticReviewKey(project);
  const current=reviewIsCurrent(project);
  const unevaluated={evaluation:'not_evaluated',missing:[],repeated:[],conflicts:[],unsupported:[]};
  const initial = deterministicReview(project);
  const repaired = repairProject(project, initial);
  recordRepairSet(project,repaired.project,repaired.repairs);
  const unchanged=current && beforeKey===semanticReviewKey(repaired.project);
  const report = finalQualityReport(repaired.review, repaired.repairs, unchanged?project.quality.modelReview:unevaluated);
  repaired.project.quality = {...project.quality,...report,...(!unchanged?{reviewState:'stale',reviewInputHash:null}:{})};
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
    if(gated.quality.reviewState==='valid')bindReview(updated,gated.quality.modelReview);
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
  const message=String(error?.message||error);
  const code=error?.code||error?.causes?.[0]?.error?.code||(/writer_copy_gate|writer.*contract|template_slot|template_text_fragment|source.*(?:coverage|capacity)|writer_math/u.test(message)?'content_invalid':/export verification|PPTX.*(?:integrity|visibility)|render.*(?:overflow|capacity)/iu.test(message)?'render_invalid':/review.*(?:contract|invalid)|claim.*(?:audit|invalid)/iu.test(message)?'review_invalid':stage==='outline'?'schema_invalid':'transport');
  p.failure={version:2,stage,code,model:p.model,at:new Date().toISOString()};
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
      const supplement = latest.prompt?.trim() ? /<svg\b/iu.test(latest.prompt)
        ? await deps.extractFile(latest,'supplement.html',Buffer.from(latest.prompt))
        : normalizePaste(latest.prompt, latest.source?.images || []) : latest.source;
      source = mergeSourceSupplement(source, supplement, latest.prompt || '', !latest.update);
      latest.source = withSemanticIndex(source); syncPresentationPolicy(latest); latest.status = 'outlining'; latest.stage = 'outline'; latest.error = '';
      latest.inputProfile = profilePptInput(latest);
      latest.contentPlan = planSparseInput(latest, latest.inputProfile);
      if (automaticPages(latest)) {
        const suggestion = estimatePageRecommendation(latest);
        const reuseCount = latest.templateFidelity?.originalSlideCount || latest.templateFidelity?.slides?.length;
        const reuseError = latest.templateFidelity?.mode === 'preserve' && reuseCount
          ? templateReuseError(reuseCount, suggestion.recommended) : null;
        if (!reuseError) {
          latest.pages = suggestion.recommended;
          latest.pageDecision = { ...latest.pageDecision, finalPageCount: latest.pages,
            initialPageCount: latest.pageDecision.initialPageCount || latest.pages, densityProfileId: densityProfile().id, recommended: suggestion.recommended, range: suggestion.range, estimationBasis: suggestion.estimationBasis, estimatedAfterIngest: true };
        }
      }
      store.save(latest); next = true;
      try { transitionNode(latest, 'source', 'completed', { segments: source.segments?.length || 0 }); } catch {}
    } catch (error) { fail(uid, id, 'ingest', error, log); }
    finally { running.delete(id); if (next) startOutline(uid, id, activity, log, deps); }
  })();
}
// Candidate assessment is isolated from the stored project. Native assignment
// must finish before its fit is recorded or compared with a repaired candidate.
function assessOutlineCandidate(project, raw, {finalRepack=false}={}) {
  raw=routeTranslationsToNotes(project,coalesceEquivalentSelections(raw),item=>visibleEquivalentCandidates(project,item));
  const automatic=automaticPages(project);
  let contentSelection;try{contentSelection=compileContentSelection(project,raw);}catch(error){error.outlineContract=true;error.code='coverage_invalid';throw error;}
  if(contentSelection||project.languageProjection)project={...project,...(contentSelection?{contentSelection}:{}),originalSourceInventory:project.originalSourceInventory||project.source.semantic.inventory,source:selectionSource(project,contentSelection)};
  try{raw=compileSkeleton(project,raw);if(automatic)raw=pruneEmptySelectedPages(project,raw);}catch(error){error.outlineContract=true;throw error;}
  let rawOutline,outline;
  const candidateProject={...project,...(automatic&&project.templateFidelity?{nativeCapacityAssignment:true}:{})};
  try {
    rawOutline=project.requestedOutline||project.nativeTitleRepairSeed?raw:packOutline(project,raw,{finalRepack});
    if(automatic)candidateProject.pages=pages(rawOutline.slides.length);
    rawOutline={...rawOutline,slides:rawOutline.slides.map(slide=>fragmentTitle(slide,project.source))};
    outline=normalizeOutline(rawOutline,candidateProject.pages,project.source,project.update,project.deckTitle,project.requestedOutline ? null : project.editOutputLanguage || dominantInputLanguage(project));
  } catch(error){error.code='schema_invalid';error.outlineContract=true;throw error;}
  candidateProject.outline=outline;
  // Explicit N fixes quantity, not a role-only layout reassignment. Preserve
  // an accepted assignment during title review; other plans choose by fit.
  if(!project.nativeTitleRepairSeed)rescheduleTemplateFidelity(candidateProject,{scoreSlide:(p,index)=>candidateFit(outline[index],p,index).predictedOverflow,allowOverflowCandidate:automatic&&!project.confirmedOutline});
  rawOutline=revalidateOutlineFits(candidateProject,rawOutline,outline);
  outline=outline.map((slide,index)=>({...slide,densityFit:rawOutline.slides[index].densityFit}));
  candidateProject.outline=outline;
  const planning=buildPlanning(candidateProject,rawOutline,outline);
  const issues=[...exactPageConflict(candidateProject,rawOutline),...inspectSkeletonOwnership(candidateProject,rawOutline),...inspectReportOutline(candidateProject,outline,planning.brief),...inspectLongDeckOutline(candidateProject,outline),...inspectDensityOutline(rawOutline,candidateProject)];
  return {project:candidateProject,rawOutline,outline,planning,issues};
}
function startOutline(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  let generateAfterOutline = false;
  void (async () => {
    try {
      const p = store.get(uid, id);
      if (!p || p.status !== 'outlining') return;
      if(p.failure){p.outlineFailureHistory=[...(p.outlineFailureHistory||[]).slice(-49),p.failure];delete p.failure;p.error='';store.save(p);}
      if (p.source?.segments?.length && !p.source.semantic) { p.source = withSemanticIndex(p.source); store.save(p); }
      syncPresentationPolicy(p);
      await prepareLanguageProjection(p,(prompt,nodeKey)=>deps.modelCall(p,prompt,activity,log,{nodeKey,maxOutputTokens:8192}),async projected=>{const current=store.get(uid,id);if(current?.status!=='outlining')throw outlineError('cancelled');current.originalSourceInventory=projected.originalSourceInventory;current.languageProjection=projected.languageProjection;store.save(current);});
      await prepareLanguagePairAudit(p,(prompt,nodeKey)=>deps.modelCall(p,prompt,activity,log,{nodeKey,maxOutputTokens:8192}),async audited=>{const current=store.get(uid,id);if(current?.status!=='outlining')throw outlineError('cancelled');current.languagePairAudit=audited.languagePairAudit;store.save(current);});
      try { transitionNode(p, 'outline', 'running'); } catch {}
      const automatic = automaticPages(p);
      if (automatic) p.pages = estimatePageRecommendation(p).recommended;
      const saveCandidate=(raw,issues=[])=>{const current=store.get(uid,id);if(current?.status==='outlining'){current.candidateOutline=candidateRecord(current,raw,issues);current.outlineTrace=[...(current.outlineTrace||[]).slice(-99),{at:new Date().toISOString(),candidateHash:current.candidateOutline.hash,pages:raw?.slides?.length,issues:issues.map(item=>item.code),metrics:current.candidateOutline.metrics}];store.save(current);}};
      const batches=skeletonBatches({...p,planningNativeCapacity:sourceCapacityPlan(estimationSource(p),p.pages,p)?.capacity});
      const planningIdentity=sha256(Buffer.from(JSON.stringify({model:p.model,contractVersion:p.promptContractVersion,template:p.template,templateSpec:p.templateSpec,templateIdentity:p.templateFidelity?.sha256,policy:p.generationPolicy,prompts:batches.length?batches.map(batch=>batch.prompt):[outlinePrompt(p)]})));
      const resumedRepair=!p.requestedOutline&&resumeOutlineRepair(p.outlineRepairCheckpoint,planningIdentity);
      const saveAssessedCheckpoint=assessed=>{const current=store.get(uid,id);if(current?.status==='outlining'&&current.source?.sha256===p.source?.sha256&&current.model===p.model){current.outlineRepairCheckpoint=retainOutlineRepair(assessed.rawOutline,planningIdentity);store.save(current);}};
      p.outlineBatchTotal=batches.length||1;store.save(p);
      const batchResults=[],batchDrafts=[],draftTimes=new Map();
      const planBatches=async()=>assembleSkeletonBatches(p,batches,await boundedAll(batches,PPT_NODE_CONCURRENCY,async batch=>{
        const promptHash=sha256(Buffer.from(batch.prompt));
        const current=store.get(uid,id),saved=current?.outlineBatches?.find(item=>item.index===batch.index&&item.promptHash===promptHash&&item.model===p.model);
        let raw=saved?.raw||await deps.modelCall(p,batch.prompt,activity,log,{nodeKey:'outline:group:'+batch.index,maxOutputTokens:16384,onProgress:progress=>{
          const now=Date.now();if(now-(draftTimes.get(batch.index)||0)<1000)return;
          const current=store.get(uid,id);if(current?.status!=='outlining'||current.source?.sha256!==p.source?.sha256)return;
          const slides=outlineDraftFromPartialJson(progress.text,batch.allowedIds);if(!slides.length)return;draftTimes.set(batch.index,now);batchDrafts[batch.index]=slides;
          saveCandidate({version:2,slides:batches.flatMap(b=>batchResults[b.index]?.slides||batchDrafts[b.index]||[])},[{code:'outline_partial_unvalidated',message:'Closed streamed planning objects; global ownership, content and capacity are not yet accepted.'}]);
          emitRunProgress(store.get(uid,id),'outline.partial',{groupIndex:batch.index,seq:progress.seq,closedPages:slides.length,chars:progress.chars});
        }});
        // Validate scoped IDs before retaining a restart checkpoint.
        if(raw?.version!==2||!Array.isArray(raw.slides)||raw.slides.some(slide=>!Array.isArray(slide.sourceUnitIds)||slide.sourceUnitIds.some(id=>!batch.allowedIds.includes(id))))throw outlineError('schema_invalid');
        const owned=new Set(raw.slides.flatMap(slide=>slide.sourceUnitIds));
        const missing=(p.source?.semantic?.inventory?.items||[]).filter(item=>batch.allowedIds.includes(item.id)&&isSourceArtifactItem(item)&&!owned.has(item.id)).map(item=>item.id);
        if(missing.length&&p.generationPolicy?.content==='full_source'){
          const correction=await deps.modelCall(p,`${batch.prompt}\n<missing_source_coverage>${JSON.stringify(missing)}</missing_source_coverage>\nCoverage repair only: preserve the accepted pages unchanged. Return version 2 JSON with additional content slides assigning ALL and ONLY the missing IDs above. Keep bilingual/related reading units together. No cover, no invented facts, no selection outside this list. Native capacity is checked after assembly.`,activity,log,{nodeKey:'outline'});
          const recovered=correction?.slides;
          if(correction?.version!==2||!Array.isArray(recovered)||recovered.some(slide=>!Array.isArray(slide.sourceUnitIds)||slide.sourceUnitIds.some(id=>!missing.includes(id))))throw outlineError('coverage_invalid');
          const repaired=new Set(recovered.flatMap(slide=>slide.sourceUnitIds));
          if(missing.some(id=>!repaired.has(id)))throw outlineError('coverage_invalid');
          const order=new Map((p.source.semantic.inventory.items||[]).map((item,index)=>[item.id,index]));
          const rank=slide=>slide.role==='cover'?-1:Math.min(Infinity,...slide.sourceUnitIds.map(id=>order.get(id)??Infinity));
          raw={...raw,slides:[...raw.slides,...recovered].sort((a,b)=>rank(a)-rank(b))};
        }
        batchResults[batch.index]=raw;
        const latest=store.get(uid,id);
        if(latest?.status==='outlining'){
          latest.outlineBatches=[...(latest.outlineBatches||[]).filter(item=>item.index!==batch.index),{index:batch.index,promptHash,model:p.model,raw}];store.save(latest);
          saveCandidate({version:2,slides:batchResults.flatMap(result=>result?.slides||[]),selection:batchResults.flatMap(result=>result?.selection||[])},[{code:'outline_groups_pending',message:`${batchResults.filter(Boolean).length}/${batches.length} source groups retained; global coverage and template fit are not yet accepted.`}]);
          // V-P0-1: the editor shows the syllabus forming group by group.
          try{emitRunProgress(store.get(uid,id),'outline.group_ready',{done:batchResults.filter(Boolean).length,total:batches.length});}catch{}
        }
        return raw;
      }));
      let rawOutline = p.requestedOutline
        ? { slides: p.requestedOutline, brief: null, storyArc: null, coverage: [] }
        : p.nativeTitleRepairSeed?.executionPlan || resumedRepair || (batches.length ? await planBatches() : await deps.modelCall(p, outlinePrompt(p), activity, log,{nodeKey:'outline',onProgress:progress=>{
          const now=Date.now();if(now-(draftTimes.get('single')||0)<1500)return;
          const closed=outlineDraftFromPartialJson(progress.text,(p.source?.semantic?.inventory?.items||[]).map(item=>item.id));if(!closed.length)return;
          draftTimes.set('single',now);saveCandidate({version:2,slides:closed},[{code:'outline_partial_unvalidated',message:'Closed live planning pages; selection ownership, facts and native capacity are not yet accepted.'}]);
          emitRunProgress(store.get(uid,id),'outline.partial',{seq:progress.seq,closedPages:closed.length,chars:progress.chars});
        }}));
      if(resumedRepair)emitRunProgress(store.get(uid,id),'outline.repair_resumed',{candidatePages:rawOutline.slides.length,validated:false});
      saveCandidate(rawOutline);
      let assessed,validationError;
      try {assessed=assessOutlineCandidate(p,rawOutline);} catch(error){
        if(!error.outlineContract||p.requestedOutline)throw error;
        validationError=error;
      }
      if(assessed)saveAssessedCheckpoint(assessed);
      saveCandidate(assessed?.rawOutline||rawOutline,assessed?.issues||[{code:validationError?.code||'schema_invalid',message:validationError?.message,details:validationError?.details}]);
      // Repairs compose over the retained candidate: an ownership fix may
      // expose a bilingual conflict, then metadata. Never discard a valid delta
      // merely because the NEXT independent gate discovers another issue.
      for(let pass=0;!assessed&&!p.requestedOutline&&pass<10;pass++){
        const rangePrompt=outlineRangeRepairPrompt(p,rawOutline,validationError);
        const metadataPrompt=outlineMetadataRepairPrompt(p,rawOutline,validationError);
        const summaryPrompt=outlineSummaryRepairPrompt(p,rawOutline,validationError);
        const selectionPrompt=outlineSelectionRepairPrompt(p,rawOutline,validationError);
        const ownerPrompt=outlineOwnershipRepairPrompt(p,rawOutline,validationError);
        const batchPrompt=outlineRelationBatchRepairPrompt(p,rawOutline,validationError);
        const relationPrompt=batchPrompt||outlineRelationRepairPrompt(p,rawOutline,validationError);
        // Valid summary/notes dispositions with missing ownership need only an
        // ownership delta. A broader selection repair would let the model turn
        // audited concise summaries back into full source prose unnecessarily.
        const prompt=rangePrompt||metadataPrompt||summaryPrompt||ownerPrompt||selectionPrompt||relationPrompt;if(!prompt)break;
        const kind=rangePrompt?'artifact-range':metadataPrompt?'metadata':summaryPrompt?'summary':ownerPrompt?'ownership':selectionPrompt?'selection':'relations';
        const applyDelta=delta=>rangePrompt?applyOutlineRangeRepair(p,rawOutline,validationError,delta):metadataPrompt?applyOutlineMetadataRepair(rawOutline,validationError,delta):summaryPrompt?applyOutlineSummaryRepair(p,rawOutline,validationError,delta):ownerPrompt?applyOutlineOwnershipRepair(rawOutline,delta,validationError):selectionPrompt?applyOutlineSelectionRepair(rawOutline,validationError,delta):batchPrompt?applyOutlineRelationBatchRepair(p,rawOutline,validationError,delta):applyOutlineRelationRepair(p,rawOutline,validationError,delta);
        let revised,delta,deltaFailure;
        for(let deltaAttempt=0;deltaAttempt<2;deltaAttempt++){
          const correction=deltaAttempt?`\n<delta_validation_error>${JSON.stringify(deltaFailure)}</delta_validation_error>\n<rejected_delta>${JSON.stringify(delta)}</rejected_delta>\nThe delta violates the exact schema/dispositions above. Correct ONLY the actual reported validation error, using the EXACT delta schema above. Do not add notes, page-index or ownership fields unless that schema explicitly defines them. Preserve all valid content, frozen candidate, selections, source facts, titles and page count. Return the same delta schema, not a new outline.`:'';
          delta=await deps.modelCall(p,prompt+correction,activity,log,{nodeKey:'outline:'+kind+':'+pass+(deltaAttempt?':delta-repair':''),maxOutputTokens:8192});
          try{revised=applyDelta(delta);break;}catch(error){deltaFailure={code:error.code,message:String(error.message).slice(0,500),details:error.details};if(error.code!=='schema_invalid'||deltaAttempt===1)throw error;}
        }
        if(JSON.stringify(revised)===JSON.stringify(rawOutline))break;
        rawOutline=revised;
        const checkpointProject=store.get(uid,id);if(checkpointProject?.status==='outlining'){checkpointProject.outlineRepairCheckpoint=retainOutlineRepair(revised,planningIdentity);store.save(checkpointProject);}
        try{assessed=assessOutlineCandidate(p,revised);validationError=undefined;saveCandidate(assessed.rawOutline,assessed.issues);}
        catch(error){if(!error.outlineContract)throw error;validationError=error;saveCandidate(revised,[{code:error.code,message:error.message,details:error.details}]);}
      }
      for(let pass=0;assessed&&!p.requestedOutline&&pass<2;pass++){
        const diagnostic=repeatedFocusMetadataError(assessed.issues);if(!diagnostic)break;
        const prompt=outlineMetadataRepairPrompt(assessed.project,assessed.rawOutline,diagnostic);if(!prompt)break;
        const delta=await deps.modelCall(p,prompt,activity,log,{nodeKey:'outline:metadata:resumed:'+pass,maxOutputTokens:8192});
        assessed=assessOutlineCandidate(p,applyOutlineMetadataRepair(assessed.rawOutline,diagnostic,delta));rawOutline=assessed.rawOutline;saveAssessedCheckpoint(assessed);saveCandidate(rawOutline,assessed.issues);
      }
      // Overview contract: condense (selected table rows, details in notes)
      // before any measured partition adds pages (outline concision, item 5).
      if(assessed&&automatic&&!p.requestedOutline){const condensed=condenseOverflowingTables(p,assessed,assessOutlineCandidate);if(condensed){assessed=condensed;saveAssessedCheckpoint(assessed);rawOutline=assessed.rawOutline;saveCandidate(rawOutline,assessed.issues);}}
      // Prefer a measured partition of unchanged source objects to asking a
      // model to create more explanatory pages. This keeps geometry repair
      // separate from semantic planning, with the same coverage/fit gates.
      if (assessed && automatic && !p.requestedOutline) for(let pass=0;pass<3;pass++) {
        const density=inspectDensityOutline(assessed.rawOutline,assessed.project);
        if(!density.length||density.some(issue=>!['planned_density_overflow','planned_source_object_duplicate'].includes(issue.code)))break;
        const replacements=new Map(),removed=new Set();
        for(const scope of outlineCapacityRepairScopes(assessed))try{
          replacements.set(scope[0],partitionOutlineWithMeasuredComponents(assessed,scope));scope.slice(1).forEach(index=>removed.add(index));
        }catch(error){log(`ppt ${id} pre-model measured partition skipped: ${String(error?.message||error).slice(0,180)}`);}
        if(!replacements.size)break;
        const slides=assessed.rawOutline.slides.flatMap((slide,index)=>removed.has(index)?[]:replacements.get(index)||[slide]);
        if(slides.length>100)break;
        const revised=assessOutlineCandidate(p,{...assessed.rawOutline,slides});
        const load=candidate=>candidate.rawOutline.slides.reduce((sum,slide)=>sum+(slide.densityFit?.predictedOverflow||0),0);
        if(revised.issues.filter(issue=>issue.code!=='planned_density_overflow').length>assessed.issues.filter(issue=>issue.code!=='planned_density_overflow').length||load(revised)>=load(assessed))break;
        assessed=revised;saveAssessedCheckpoint(assessed);rawOutline=revised.rawOutline;saveCandidate(rawOutline,assessed.issues);
      }
      const initialIssues=assessed?.issues||[{code:'invalid_outline_contract',message:String(validationError?.message||'invalid candidate').slice(0,500),details:validationError?.details,repairable:true}];
      if(!p.requestedOutline && initialIssues.some(item=>item.repairable!==false)){
        const repairTask=`这是修复任务，不是重述初稿。初稿结构检查：${JSON.stringify(initialIssues.map(item=>({code:item.code,message:item.message,details:item.details})))}。${automatic?'请在有效来源编号、完整关系和可读容量内实际修改 slides 数组：增加分片页或移动完整单元，允许改变初稿页数，最终数量由代码拟合决定':'请在相同页数和有效来源编号内修订大纲'}，不改变用户锁定的标题，不虚构事实或证据；不同明确question不能靠相同groupId合并；表格分片必须是整数、仅用于表格且同页不重叠。容量建议是代码对实际原生模板的测量结果，不是要抄到 keyPoints 的正文。不能仅修改 topicGroups 的 capacity_ok 来声明通过；实际分片与可见文字须解决列出的溢出。componentFits 中 capacity_ok=false 表示该来源组件单独放入也不能容纳，缩短 keyPoints 无法解决；对这样的表格必须实际改变 sourceArtifactRanges 并分配到多个页面，可采用完整覆盖的 tableFragments 测量方案，不能继续保留整表范围。${p.generationPolicy?.language?.mode==='output'&&p.generationPolicy?.details==='notes'?'遵守用户的目标语言正文与完整原文备注合同：只对有实际目标语言主讲 owner 的可投影配对使用 visibleEquivalentSourceUnitId；destination=notes 的 ID 不得再次出现在任何 slides.sourceUnitIds 中；保留全部原文备注和正文必要事实。':'保留全部语言和事实；若用户或来源未锁定同页，双语长段落/小结可放到连续两页，分别保留各语言完整来源单元，不得自行添加双语必须同页的 adjacencyPairs 使容量冲突。'}`;
        const shortProtocol=rawOutline.version===2;
        const repairPrompt=shortProtocol?outlineDeltaPrompt(p,assessed?.rawOutline||rawOutline,initialIssues):`${repairTask}\n${outlinePrompt(p)}\n待修复初稿：${JSON.stringify(rawOutline)}\n返回完整的同一 JSON schema，使用紧凑 JSON 格式，不缩减事实内容。`;
        let correctionPrompt=repairPrompt;
        for(let attempt=0;repairPrompt&&attempt<2;attempt++){
          let response;
          try {
            response=await deps.modelCall(p,correctionPrompt,activity,log,{nodeKey:'outline'});
            const revised=assessOutlineCandidate(p,shortProtocol?applyOutlineDelta(p,assessed?.rawOutline||rawOutline,response,repairPrompt):response);
            if(!assessed || revised.planning.brief.reportMode===assessed.planning.brief.reportMode && revised.issues.length<initialIssues.length){assessed=revised;saveAssessedCheckpoint(assessed);}
            break;
          } catch(error){
            log(`ppt ${id} outline revision ${attempt+1} skipped: ${String(error?.message||error).slice(0,180)}`);
            if(error.outlineContract&&response){saveCandidate(response,[{code:error.code,message:error.message,details:error.details}]);validationError=error;}
            if(shortProtocol||!error.outlineContract||!response||attempt===1)break;
            correctionPrompt=`${outlinePrompt(p)}\n<invalid_candidate>${JSON.stringify(response)}</invalid_candidate>\n<exact_contract_diagnostic>${JSON.stringify({code:error.code,message:error.message,details:error.details})}</exact_contract_diagnostic>\nReturn the complete corrected same schema, preserving every source ID according to its authorized disposition and the exact requested page count. Repair the specifically identified ownership/repeat conflict; never delete a required condition or change the original source.`;
          }
        }
      }
      if(!assessed)throw validationError;
      if(automatic&&!p.requestedOutline){
        const restored=restoreMissingSourceArtifacts(assessed);
        if(restored!==assessed.rawOutline){
          assessed=assessOutlineCandidate(p,restored);
          log(`ppt ${id} restored complete missing source artifacts: ${assessed.project.pages} candidate pages`);
        }
      }
      // The original whole-outline repair is retained. Automatic-page drafts
      // with complete ownership can then repair only physical overflows; copy
      // and selected rows cannot change. Every batch rebinds native templates.
      if(automatic && !p.requestedOutline){
        const overflowLoad=candidate=>candidate.rawOutline.slides.reduce((sum,s)=>sum+(s.densityFit?.predictedOverflow||0),0);
        for(let round=0;round<3;round++){
          const density=inspectDensityOutline(assessed.rawOutline,assessed.project);
          if(!density.length||density.some(issue=>!['planned_density_overflow','planned_source_object_duplicate'].includes(issue.code)))break;
          const indexes=outlineCapacityRepairScopes(assessed);
          if(!indexes.length||indexes.length>16)break;
          log(`ppt ${id} outline capacity partition round ${round+1}: ${indexes.length} pages`);
          const base=assessed;
          const partitions=await boundedAll(indexes,PPT_NODE_CONCURRENCY,async index=>{
            try{
              const prompt=outlineCapacityRepairPrompt(base,index);
              const response=await deps.modelCall(p,prompt,activity,log,{nodeKey:'outline:capacity:'+round+':'+index.join('-'),maxOutputTokens:8192});
              try{return applyOutlineCapacityRepair(base,index,response);}
              catch(error){
                const correction=`${prompt}\n<invalid_partition>${JSON.stringify(response)}</invalid_partition>\n<contract_error>${String(error.message)}</contract_error>\n修复此 JSON 分配合同。保留全部原索引和完整来源行；每个 keyPointIndexes / requiredDetailIndexes 索引只分配一次，不在每个表格分片上重复。按 measured_native_advice 的全部 tableFragments 分配，不合并会溢出的片段。返回修复后的同一 JSON schema。`;
                return applyOutlineCapacityRepair(base,index,await deps.modelCall(p,correction,activity,log,{nodeKey:'outline:capacity:'+round+':'+index.join('-')+':repair',maxOutputTokens:8192}));
              }
            }catch(error){log(`ppt ${id} local outline partition skipped: ${String(error?.message||error).slice(0,180)}`);return null;}
          });
          const replacements=new Map(),removed=new Set();
          for(const [i,scope] of indexes.entries())if(partitions[i]){replacements.set(scope[0],partitions[i]);for(const index of scope.slice(1))removed.add(index);}
          const slides=base.rawOutline.slides.flatMap((s,index)=>removed.has(index)?[]:replacements.get(index)||[s]);
          if(slides.length>100)break;
          try{
            const revised=assessOutlineCandidate(p,{...base.rawOutline,slides});
            const revisedDensity=inspectDensityOutline(revised.rawOutline,revised.project);
            const structural=d=>d.filter(issue=>issue.code!=='planned_density_overflow');
            const previousStructural=structural(density),nextStructural=structural(revisedDensity);
            if(nextStructural.some(issue=>!previousStructural.some(old=>old.code===issue.code&&old.message===issue.message))||
              nextStructural.length>previousStructural.length||nextStructural.length===previousStructural.length&&overflowLoad(revised)>=overflowLoad(base))break;
            assessed=revised;saveAssessedCheckpoint(assessed);
          }catch(error){log(`ppt ${id} outline partition batch rejected: ${String(error?.message||error).slice(0,180)}`);break;}
        }
      }
      // Overview contract: condense (selected table rows, details in notes)
      // before any measured partition adds pages (outline concision, item 5).
      if(assessed&&automatic&&!p.requestedOutline){const condensed=condenseOverflowingTables(p,assessed,assessOutlineCandidate);if(condensed){assessed=condensed;saveAssessedCheckpoint(assessed);rawOutline=assessed.rawOutline;saveCandidate(rawOutline,assessed.issues);}}
      // No generated copy is changed by the measured fallback. It partitions
      // complete original atoms only after bounded model repair is exhausted.
      if(automatic&&!p.requestedOutline)assessed=assessOutlineCandidate(p,orderSourceConclusion(p,assessed.rawOutline));
      if(automatic&&!p.requestedOutline)for(let pass=0;pass<3;pass++){
        const density=inspectDensityOutline(assessed.rawOutline,assessed.project);
        // A translation pair or lead-in+list planned across pages is also
        // re-partitioned here (measured, no new copy); it never fails the outline.
        const splitUnits=splitReadingUnits(assessed);
        if((!density.length&&!splitUnits.length)||density.some(issue=>!['planned_density_overflow','planned_source_object_duplicate'].includes(issue.code)))break;
        {
          const base=assessed,scopes=outlineCapacityRepairScopes(base),replacements=new Map(),removed=new Set();
          for(const scope of scopes)try{
            replacements.set(scope[0],partitionOutlineWithMeasuredComponents(base,scope));for(const index of scope.slice(1))removed.add(index);
          }catch(error){log(`ppt ${id} measured outline partition skipped: ${String(error?.message||error).slice(0,180)}`);}
          if(!replacements.size)break;
          const slides=base.rawOutline.slides.flatMap((s,index)=>removed.has(index)?[]:replacements.get(index)||[s]);
          if(slides.length>100)break;
          try{assessed=assessOutlineCandidate(p,{...base.rawOutline,slides});saveAssessedCheckpoint(assessed);log(`ppt ${id} measured complete-component partition pass ${pass+1}: ${assessed.project.pages} candidate pages`);}
          catch(error){log(`ppt ${id} measured outline partition rejected: ${String(error?.message||error).slice(0,180)}`);break;}
        }
      }
      if(automatic&&!p.requestedOutline)assessed=assessOutlineCandidate(p,orderSourceConclusion(p,assessed.rawOutline));
      if(automatic&&!p.requestedOutline)for(let pass=0;pass<3;pass++){
        const repacked=assessOutlineCandidate(assessed.project,assessed.rawOutline,{finalRepack:true});
        if(repacked.outline.length>=assessed.outline.length||inspectDensityOutline(repacked.rawOutline,repacked.project).length)break;
        assessed=repacked;
      }
      // Underfilled neighbours merge (across sections) while above budget.
      if(automatic&&!p.requestedOutline){const merged=mergeUnderfilledPages(p,assessed,assessOutlineCandidate,{capacity:assessed.rawOutline.slides[1]?.densityFit?.targetVisualUnits||671});if(merged){assessed=merged;saveAssessedCheckpoint(assessed);log(`ppt ${id} merged ${merged.concisionMerges} underfilled page pair(s): ${assessed.outline.length} pages`);}}
      // Physical partitions may keep identical planning focuses even though
      // their frozen source owners differ. Repair intent metadata only, then
      // re-run the same source and physical checks before explicit confirmation.
      for(let pass=0;!p.requestedOutline&&pass<2;pass++){
        const diagnostic=repeatedFocusMetadataError(assessed.issues);if(!diagnostic)break;
        const prompt=outlineMetadataRepairPrompt(assessed.project,assessed.rawOutline,diagnostic);if(!prompt)break;
        const delta=await deps.modelCall(p,prompt,activity,log,{nodeKey:'outline:metadata:partition:'+pass,maxOutputTokens:8192});
        assessed=assessOutlineCandidate(p,applyOutlineMetadataRepair(assessed.rawOutline,diagnostic,delta));saveAssessedCheckpoint(assessed);
      }
      // Metadata repair is confined to titles of the final measured native
      // assignment. Never let a writer rename an already confirmed outline.
      for(let pass=0;!p.requestedOutline&&pass<3;pass++){
        const conflicts=inspectNativeOutlineTitles(assessed.project,assessed.outline);if(!conflicts.length)break;
        const cover=conflicts.filter(c=>c.pageIndex===0),body=conflicts.filter(c=>c.pageIndex!==0),batches=cover.length?[cover]:[];
        for(let at=0;at<body.length;at+=8)batches.push(body.slice(at,at+8));
        const base=assessed;let retainedTitles=base.rawOutline;
        saveCandidate(base.rawOutline,[...base.issues,...conflicts]);
        const retainTitles=(diagnostic,delta)=>{
          retainedTitles=applyOutlineMetadataRepair(retainedTitles,diagnostic,delta);
          const latest=store.get(uid,id);if(latest?.status==='outlining'){latest.outlineRepairCheckpoint=retainOutlineRepair(retainedTitles,planningIdentity);store.save(latest);saveCandidate(retainedTitles,[...base.issues,...inspectNativeOutlineTitles(base.project,retainedTitles.slides)]);}
        };
        const repairs=await boundedAll(batches,PPT_NODE_CONCURRENCY,async(batch,index)=>{
          const diagnostic={details:{metadataConflicts:batch}};
          try{
            const delta=await repairOutlineMetadataBatch(base.project,base.rawOutline,diagnostic,(prompt,correction)=>deps.modelCall(p,prompt,activity,log,{nodeKey:`outline:native-titles:${pass}:${index}:${correction}`,maxOutputTokens:4096}));
            retainTitles(diagnostic,delta);return {diagnostic,delta};
          }catch(error){
            const valid=error.details?.validatedUpdates||[];
            if(valid.length)retainTitles({details:{metadataConflicts:batch.filter(c=>valid.some(u=>u.pageIndex===c.pageIndex&&u.field===c.field))}},{version:2,updates:valid});
            throw error;
          }
        });
        let revised=base.rawOutline;for(const {diagnostic,delta}of repairs)revised=applyOutlineMetadataRepair(revised,diagnostic,delta);
        assessed=assessOutlineCandidate(p,revised);saveAssessedCheckpoint(assessed);
      }
      const titleIssues=[...inspectNativeOutlineTitles(assessed.project,assessed.outline),...inspectNativeCoverTitle(assessed.project,assessed.outline)];
      if(titleIssues.length){saveCandidate(assessed.rawOutline,titleIssues);throw outlineError('capacity_invalid');}
      rawOutline=assessed.rawOutline;saveAssessedCheckpoint(assessed);
      saveCandidate(rawOutline,assessed.issues);
      if(assessed.issues.some(issue=>issue.code==='outline_repeated_claim'||issue.code==='outline_ungrounded_page'))throw outlineError('coverage_invalid');
      const outline=assessed.outline;
      if(exactPageConflict(assessed.project,rawOutline).length){const diagnostic=store.get(uid,id);diagnostic.pageBudgetConflict=exactPageConflict(assessed.project,rawOutline)[0];store.save(diagnostic);throw outlineError('capacity_invalid');}
      if(inspectSkeletonOwnership(assessed.project,rawOutline).length)throw outlineError('coverage_invalid');
      // Exact-N is a display budget, never an exemption from ownership or fit.
      if(inspectDensityOutline(rawOutline,assessed.project).length){
        const diagnostic=store.get(uid,id);
        if(diagnostic?.status==='outlining'){diagnostic.outlineCapacityDiagnostic={diagnosticOnly:true,candidatePages:assessed.project.pages,rawOutline,issues:inspectDensityOutline(rawOutline,assessed.project)};store.save(diagnostic);}
        throw outlineError(inspectDensityOutline(rawOutline,assessed.project).some(x=>x.code!=='planned_density_overflow')?'coverage_invalid':'capacity_invalid');
      }
      const current = store.get(uid, id);
      if (!current || current.status !== 'outlining') return;
      await prepareNavigationPlan(assessed.project,finalDeckNavigation({...assessed.project,navigationPlan:undefined,deck:null}).entries,(prompt,nodeKey)=>deps.modelCall(p,prompt,activity,log,{nodeKey,maxOutputTokens:8192}));
      current.navigationPlan=assessed.project.navigationPlan;
      current.pages = assessed.project.pages;
      if(assessed.project.contentSelection){current.contentSelection=assessed.project.contentSelection;current.originalSourceInventory=assessed.project.originalSourceInventory;current.source=assessed.project.source;}
      if(assessed.project.templateFidelity)current.templateFidelity=assessed.project.templateFidelity;
      const reuseCount = current.templateFidelity?.originalSlideCount;
      const reuseError = reuseCount && templateReuseError(reuseCount, current.pages);
      if (reuseError) throw new HttpError(400, reuseError);
      const growth = automatic ? outlineGrowth(current, current.pages) : null;
      current.pageDecision = { ...current.pageDecision, finalPageCount: current.pages, densityProfileId: densityProfile().id,
        estimateVersion: 1, fitValidated: rawOutline.slides?.slice(1).every(s => s.densityFit?.capacity_ok) || false,
        ...(automatic ? { mode: 'auto', initialPageCount: current.pageDecision.initialPageCount, calibratedAt: new Date().toISOString() } : {}),
        ...(current.autoGenerate && !growth ? { confirmedAt: new Date().toISOString() } : {}),
        concision: outlineConcisionMetrics(current, outline, slide => pageLoad(current, slide, rawOutline.selection || [])), ...(growth ? { growth } : {}) };
      if (!growth) delete current.pageDecision.growth;
      current.outline = outline;
      current.candidateOutline=candidateRecord(current,rawOutline,[],true);
      delete current.failure;
      // An automatic outline that outgrew its budget waits for confirmation.
      const proceed = current.autoGenerate && !growth;
      current.status = proceed ? 'generating' : 'outline_ready'; current.stage = proceed ? 'content' : 'outline'; current.error = '';
      if (current.deckTitle?.source !== 'user') {
        if(current.titleSource==='derived'&&outline[0]?.title){const identity=displayedDocumentTitle(current);current.title=identity?.variants?.map(v=>v.text).join(' | ').slice(0,160)||outline[0].title;}
        current.deckTitle = { text: outline[0]?.title || current.title, raw: outline[0]?.title || current.title, source: 'agent', locked: false };
      }
      current.planning = buildPlanning(current, rawOutline, outline);
      current.planning.contentDistribution=contentDistribution(current,outline);
      synchronizePlan(current, 'outline-confirmation');
      current.diff = diffSummary(current);
      generateAfterOutline = proceed;
      delete current.autoGenerate;
      delete current.requestedOutline;
      delete current.outlineSeed;
      delete current.nativeTitleRepairSeed;
      store.save(current);
      try { transitionNode(current, 'outline', 'completed', { slideCount: outline.length }); emitRunProgress(current, 'outline.ready', { outline }); } catch {}
    } catch (error) { fail(uid, id, 'outline', error, log); }
    finally { running.delete(id); if (generateAfterOutline) startGeneration(uid, id, activity, log, deps); }
  })();
}
async function writeWithContractRepair({prompt,call,normalize,nodeKey,maxRepairs=3}) {
  let nextPrompt=prompt,response,localScope=null,localBase=null,localAudit=[];
  for(let attempt=0;attempt<=maxRepairs;attempt++){
    response=undefined;
    try{
      const reply=await call(nextPrompt,attempt?`${nodeKey}:contract-repair:${attempt}`:nodeKey);
      if(localScope){const applied=applyWriterLocalDelta(localBase,localScope,reply);response=applied.value;localAudit.push(applied.audit);}
      else response=reply;
      const mathScope=writerLocalRepairScope(response,new Error('writer_math_invalid'));
      if(mathScope)throw new Error(`writer_math_invalid: ${JSON.stringify(mathScope.targets.map(({path,start,end})=>({path,start,end})))}`);
      const content=normalize(response);
      if(localAudit.length)content.localSpanRepair={attempts:localAudit.length,audit:localAudit};
      return {content,attempts:attempt};
    }
    catch(error){
      // Invalid deltas never fall back to a broad page rewrite. Reuse the
      // immutable base and the same finite scope within the original bound.
      if(/^writer_local_repair_/u.test(String(error.message))){if(attempt===maxRepairs)throw error;nextPrompt=writerLocalRepairPrompt(writerCorrectionContext(prompt),localBase,localScope,error)+'\n<rejected_delta>'+JSON.stringify({error:error.message,response:response??null})+'</rejected_delta> The previous delta was invalid. Preserve the exact numeric tokens of each allowed string, including numeric identifiers such as p05; shorten the surrounding words instead. The unchanged base and allowed targets remain authoritative.';continue;}
      const contractFailure=/writer changed the confirmed outline title|rendered_title_capacity|writer_math_invalid|模型未返回有效的结构化内容|slide \d+ title must be text|bullet must be text|source_artifact_capacity|writer cover contract|writer source-only contract|invalid visible native copy type|invalid source commentary|invalid source evidence selection|writer omitted|source artifact|row range|range.*table|template slot.*safety|block id|block \d+ invalid|duplicate block|visual blocks per slide|unsupported visual block|table dimensions invalid|chart data invalid|shape invalid/iu.test(String(error.message));
      if(contractFailure&&!error.code)error.code=/source_artifact_capacity/iu.test(error.message)?'capacity_invalid':/writer omitted|source evidence selection|row range|range.*table/iu.test(error.message)?'coverage_invalid':'schema_invalid';
      if(attempt===maxRepairs||!contractFailure)throw error;
      let contract;try{contract=JSON.parse(prompt.match(/<slide_contract>([\s\S]*?)<\/slide_contract>/u)?.[1]||'null');}catch{}
      const boundIds=new Set([...(response?.sourceArtifacts||[]).map(ref=>ref.sourceUnitId),...(response?.sourceEvidenceIds||[])]);
      const allOwnedSourceBound=Boolean(contract?.sourceUnitIds?.length&&contract.sourceUnitIds.every(id=>boundIds.has(id)));
      localScope=writerLocalRepairScope(response,error,{allOwnedSourceBound});localBase=response;
      if(localScope){
        if(localScope.optionalCommentaryCanOmit&&localScope.targets.every(t=>t.kind==='commentary')){
          const omitted=applyWriterLocalDelta(response,localScope,{edits:localScope.targets.map(t=>({path:t.path,start:t.start,end:t.end,before:t.before,after:''}))});
          try{const content=normalize(omitted.value);content.localSpanRepair={attempts:localAudit.length+1,audit:[...localAudit,{...omitted.audit,basis:'measured overflowing optional commentary; all owned frozen source retained and normal validator passed'}]};return {content,attempts:attempt+1};}catch{ /* The full validator rejected omission; use the same bounded model repair. */ }
        }
        nextPrompt=writerLocalRepairPrompt(writerCorrectionContext(prompt),response,localScope,error);continue;}
      nextPrompt=`${writerCorrectionContext(prompt)}\n<invalid_response>${response===undefined?'No parseable JSON was returned':JSON.stringify(response)}</invalid_response>\n<writer_contract_error>${String(error.message)}</writer_contract_error>\n<repair>Return valid JSON in the same schema. Preserve exact frozen sources, all selected cells and necessary facts. Visual block id must match ^[A-Za-z0-9_-]{1,40}$ and be unique; do not put human labels or step captions in id. Correct the precise type/count/height error above; do not repeat a rejected expanded draft. For sourceFits=true, keep all frozen structures and required excerpts. Use the measured source_commentary_budget: if its paragraphCount is one, return no more than one paragraph, targeting 85% of singleParagraphCjkCharacters in total including punctuation/formula text. Never repeat facts already automatically displayed by frozen sourceArtifacts/sourceEvidenceIds. Remove only duplicate explanation, never required facts or locked excerpts. Do not change source row ranges, fonts or page count.</repair>`;
    }
  }
}
function revalidateCompletedCopy(project) {
  const reopened=[];
  const fidelity=project.templateFidelity;
  if(fidelity?.mode==='preserve'&&project.deck?.slides?.length){
    if(fidelity.sourceCatalog?.some(s=>s.nodes?.some(n=>n.type==='image'&&!n.content?.dataUrl))){
      const cached=store.readTemplateIR(project.templateSpec?.kind==='managed'?'managed':project.uid,project.template,fidelity.sha256);
      if(cached?.parserVersion==='pptx-ir-7'&&cached.imported?.deck?.slides?.length===fidelity.originalSlideCount){
        fidelity.sourceCatalog=structuredClone(cached.imported.deck.slides);
        project.runtime ||= {};project.runtime.templateCatalogRecovery={templateHash:fidelity.sha256,basis:'complete original parser cache; immutable native media retained'};
      }
    }
    project.sourceFontFloors={...project.sourceFontFloors};
    for(const s of project.deck.slides){const fonts=s.nodes?.filter(isSourceOwnedNode).map(n=>Number(n.style?.fontSizePt)||0)||[];if(fonts.length)project.sourceFontFloors[s.id]=Math.max(project.sourceFontFloors[s.id]||0,...fonts);}
    const beforeMap=[...fidelity.slideMap];confirmNativeOutlineFit(project,{useRenderedLegacyTitles:true});
    const changed=project.outline.flatMap((s,index)=>beforeMap[index]!==project.templateFidelity.slideMap[index]?[{slideId:s.id,page:index+1,beforeSource:beforeMap[index],afterSource:project.templateFidelity.slideMap[index]}]:[]);
    if(changed.length){
      project.planning=refreshPlanning(project);invalidateReviews(project);
      for(const change of changed){const node=project.nodes?.[change.slideId];if(!node)continue;node.status='pending';delete node.retryCopyIssues;
        project.dagNodes ||= {};project.dagNodes[dagNodeId('content',change.slideId)]=nodeRecord('pending',project.dagNodes[dagNodeId('content',change.slideId)],{reason:'native coverage assignment changed; regenerate only this page with complete frozen source and unchanged font floor'});
        if(project.runtime?.slides?.[change.slideId]){project.runtime.slides[change.slideId]={...project.runtime.slides[change.slideId],phase:'content',preview:undefined,renderHash:undefined,accepted:false};}
      }
      project.runtime ||= {}; (project.runtime.nativeCoverageRevalidation ||= []).push({runId:project.currentRunId,pages:project.pages,changes:changed,sourceHash:project.source?.sha256,basis:'restore original template coverage at frozen N and existing source fonts'});
    }
  }
  for(const outline of project.outline.filter(slide=>slide.planningProtocolVersion===2)){
    const contract=project.planning?.slidePlan?.find(item=>item.slideId===outline.id);if(!contract)continue;
    const details=sourceBackedDetails(outline,project.source);
    if(JSON.stringify(contract.requiredDetails||[])!==JSON.stringify(details)){
      project.runtime ||= {};
      (project.runtime.sourceDetailRevalidation ||= []).push({slideId:outline.id,runId:project.currentRunId,previousDetails:contract.requiredDetails||[],currentDetails:details,basis:'current source-owned units; neighboring chapter formulas cannot create obligations'});
      contract.requiredDetails=details;
    }
  }
  for(const [index,slide]of project.outline.entries()){
    const node=project.nodes?.[slide.id];if(node?.status!=='done'||!node.slide||project.runtime?.slides?.[slide.id]?.accepted)continue;
    if((node.slide.nodes||[]).some(item=>item.locked&&['text','list','table','chart'].includes(item.type)))continue;
    const coverNeedsRewrite=index===0&&!(slide.sourceUnitIds||[]).length&&!(node.slide.sourceArtifactNodes||[]).some(n=>n.sourceArtifact)&&
      (project.templateFidelity?.mode!=='preserve'||!project.templateFidelity.slides[index]?.slots?.some(slot=>slot.role==='content'&&slot.purpose!=='footnote'))&&
      ((node.slide.copy?.blocks||[]).length||(node.slide.bullets||[]).length||(node.slide.sourceArtifactNodes||[]).some(n=>n.semanticRole==='source-explanation'&&!n.content?.derivedFrom));
    if(coverNeedsRewrite&&(!project.uid||!operationHistory(project.uid,project.id).length)){
      const issues=[{code:'template_cover_body',severity:'error',repair:'recompose',message:'The title-only cover has an old unowned body draft. Regenerate title/navigation only; retain all frozen source units on their existing content pages.'}];node.status='pending';node.retryCopyIssues=issues;
      project.dagNodes ||= {};project.dagNodes[dagNodeId('content',slide.id)]=nodeRecord('pending',project.dagNodes[dagNodeId('content',slide.id)],{reason:'revalidate title-only cover contract'});reopened.push({slideId:slide.id,issues});continue;
    }
    if(node.slide.sourceArtifactFit?.canvas&&project.templateFidelity){
      // Recompute media-aware geometry from the same canonical source selection.
      // A retry must not retire artwork that the accepted fit deliberately kept.
      const before=digest(node.slide),sourceNodes=node.slide.sourceArtifactNodes||[];
      const refs=sourceNodes.filter(item=>item.sourceArtifact).map(item=>{const {sourceUnitId,rowStart,rowEnd}=item.sourceArtifact;return {sourceUnitId,...(rowStart!==undefined?{rowStart,rowEnd}:{})};});
      const uniqueRefs=[...new Map(refs.map(ref=>[JSON.stringify(ref),ref])).values()];
      const evidenceIds=[...new Set(sourceNodes.flatMap(item=>item.content?.sourceEvidenceIds||[]))];
      const commentary=sourceNodes.filter(item=>!item.sourceArtifact&&!item.content?.derivedFrom&&!item.content?.sourceEvidenceIds?.length).map(item=>({type:item.content?.pointType||'mechanism',text:item.content?.rawText||item.content?.richText?.source||item.content?.text||''}));
      const original=structuredClone(node.slide);
      try{bindSourceArtifacts(project,node.slide,uniqueRefs,index,commentary,evidenceIds);}
      catch(error){
        if(!/^source_artifact_capacity:/u.test(String(error.message)))throw error;
        // A cached page can become infeasible under the current native fit.
        // Retain its draft for comparison and let the real writer repair it;
        // a failed cache rebind must not prevent the retry itself from starting.
        node.slide=original;node.status='pending';
        const issues=[{code:'source_artifact_capacity',severity:'error',repair:'recompose',message:String(error.message)}];
        node.retryCopyIssues=issues;project.dagNodes ||= {};
        project.dagNodes[dagNodeId('content',slide.id)]=nodeRecord('pending',project.dagNodes[dagNodeId('content',slide.id)],{reason:'cached source fit failed current capacity; regenerate with unchanged source and font'});
        reopened.push({slideId:slide.id,issues});continue;
      }
      if(before!==digest(node.slide)){
        project.runtime ||= {}; (project.runtime.templateDispositionRevalidation ||= []).push({slideId:slide.id,runId:project.currentRunId,beforeHash:before,afterHash:digest(node.slide),basis:'recompute measured media-aware fit from the unchanged frozen source IDs, excerpts, commentary and font floor; preserve kept media on retry'});
        invalidateReviews(project);
      }
      if(commentary.length&&project.generationPolicy?.content==='full_source'){
        const candidate=structuredClone(node.slide);
        try{
          bindSourceArtifacts(project,candidate,uniqueRefs,index,[],evidenceIds);
          const images=new Set(project.templateFidelity.slides[index].nodes.filter(n=>n.type==='image').map(n=>n.nativeRef.shapeId));
          const count=s=>(s.sourceArtifactFit?.keptMediaShapeIds||[]).filter(id=>images.has(id)).length;
          if(count(candidate)>count(node.slide)){
            const issue={code:'native_component_reflow',severity:'error',repair:'recompose',message:'Measured complete frozen sources fit native point cards when optional added commentary is omitted. Resolve the commentary: retain any necessary relationship not already in source, remove only redundant/unsupported additions; do not alter source IDs, content, font or page count.',details:{beforeMedia:count(node.slide),candidateMedia:count(candidate),sourceHash:project.source.sha256,layout:candidate.sourceArtifactFit.layoutId}};
            node.status='pending';node.retryCopyIssues=[issue];
            project.dagNodes ||= {};project.dagNodes[dagNodeId('content',slide.id)]=nodeRecord('pending',project.dagNodes[dagNodeId('content',slide.id)],{reason:'measured source-preserving native component recovery; requires real writer and all gates'});
            reopened.push({slideId:slide.id,issues:[issue]});continue;
          }
        }catch{/* An infeasible optional-copy candidate never changes the accepted page. */}
      }
    }
    const contract=project.planning?.slidePlan?.find(item=>item.slideId===slide.id);
    const issues=[...inspectTemplateSlotDraft(project,index,node.slide).filter(issue=>issue.severity==='error'),
      ...missingRequiredEvidence(project,node.slide,contract).map(atom=>({code:'required_evidence_missing',severity:'error',repair:'expand_support',evidenceId:atom.id,message:`Frozen source evidence ${atom.id} is absent from the cached visible page`}))];
    if(!issues.length)continue;
    node.status='pending';node.retryCopyIssues=issues;
    project.dagNodes ||= {};project.dagNodes[dagNodeId('content',slide.id)]=nodeRecord('pending',project.dagNodes[dagNodeId('content',slide.id)],{reason:'cached content does not pass current native copy gates'});
    reopened.push({slideId:slide.id,issues});
  }
  return reopened;
}
function startGeneration(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  const lease = acquireGenerationLease(store.get(uid, id)); if (!lease) return;
  running.add(id);
  void (async () => {
    try {
      const p = ensureProjectTemplate(store.get(uid, id));
      if (!p || p.status !== 'generating') return;
      if(p.titleSource==='derived'){const identity=displayedDocumentTitle(p);if(identity?.variants?.length)p.title=identity.variants.map(v=>v.text).join(' | ').slice(0,160);}
      for(let index=1;index<p.outline.length-1;index++){const changed=repairNativePageAssignment(p,index,(q,i)=>candidateFit(q.outline[i],q,i));if(changed){p.runtime||={};(p.runtime.nativePageRepairs||=[]).push(changed);log(`ppt ${id} measured native page reassignment: page ${index+1}`);}await new Promise(resolve=>setImmediate(resolve));}
      markPptTime(p, 't_generation_started');
      try { emitRunProgress(p, 'generation.started', { slideCount: p.outline.length }); } catch {}
      reconcileCheckpoint(p);
      const runtime = runtimeState(p); runtime.lifecycle = 'active';
      p.stage = 'source-check'; p.nodes ||= {}; p.dagNodes ||= {}; editingState(p).contentOpen = true; recoverContentEdits(p); synchronizePlan(p); store.save(p);
      if (p.update?.baseSnapshot?.deck) {
        for (const slide of p.outline.filter(slide => slide.change === 'keep' && slide.baseSlideId)) {
          if (p.nodes[slide.id]?.status === 'done') continue;
          const original = p.update.baseSnapshot.deck.slides.find(item => item.id === slide.baseSlideId);
          if (original) {
            // A kept former closing page that is no longer last regains its topic title.
            const last = p.outline.at(-1)?.id === slide.id;
            const title = original.closingGreeting && !last ? slide.title : original.title;
            p.nodes[slide.id] = { status: 'done', attempts: 0, slide: { ...original, id: slide.id, sourceRefs: slide.refs, title, ...(original.closingGreeting && !last ? { closingGreeting: false } : {}) } };
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
        if (latest?.nodes?.[slide.id]?.status === 'done' && (!latest.runtime?.slides?.[slide.id]?.preview || !latest.runtime.slides[slide.id].canonicalSlide || latest.runtime.slides[slide.id].renderContractVersion !== RENDER_CONTRACT_VERSION || latest.runtime.slides[slide.id].contentHash !== digest(latest.nodes[slide.id].slide) || latest.runtime.slides[slide.id].epoch !== generationEpoch(latest, slide.id))) { updateSlidePreview(latest, slide.id);
          for (const stage of ['layout', 'preview', 'quality']) transitionNode(latest, `${stage}:${slide.id}`, 'completed', { slideId: slide.id, recovered: true, inputHash: latest.runtime.slides[slide.id].contentHash }, { useInput: true });
          store.save(latest); }
        if (latest?.nodes?.[slide.id]?.status === 'done' && !['done', 'completed'].includes(latest.dagNodes?.[nodeId]?.status))
          transitionNode(latest, nodeId, 'completed', { slideId: slide.id, recovered: true }, { useInput: true });
        await new Promise(resolve=>setImmediate(resolve));
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
          let content;
          if(minimal)content=structuredClone(prior);
          else {
            const prompt=snapshot.nodes[slide.id]?.retryCopyIssues?.length && prior
              ? contentRepairPrompt(snapshot,slide,index,prior,snapshot.nodes[slide.id].retryCopyIssues)
              : contentPrompt(snapshot,slide,index);
            const written=await writeWithContractRepair({prompt,nodeKey:nodeId,call:(prompt,nodeKey)=>deps.modelCall(snapshot,prompt,activity,log,{nodeKey}),normalize:response=>normalizeSlide(response,slide,snapshot,previousTitles)});
            content=written.content;if(written.attempts)content.localRepair={attempts:written.attempts,reasons:['writer_contract']};
          }
          for (const item of (minimal ? requested : mutations.filter(item => ['layout', 'style'].includes(item.type)))) {
            snapshot.nodes[slide.id].slide = content; content = await transformGeneratedSlide(snapshot, slide.id, item, deps, activity, log);
          }
          const contract = snapshot.planning?.slidePlan?.find(item => item.slideId === slide.id);
          const inspectCopy = candidate => [
            ...inspectSlideCopy(candidate, contract, index, snapshot.outline.length,
              { templatePreserved: snapshot.templateFidelity?.mode === 'preserve' }).filter(item => ['rewrite_title', 'expand_support', 'redistribute'].includes(item.repair)),
            ...inspectTemplateSlotDraft(snapshot, index, candidate),
            ...missingRequiredEvidence(snapshot, candidate, contract).map(atom => ({ code: 'required_evidence_missing', severity: 'error',
              message: `锁定证据 ${atom.id} 尚未出现在可见页面：${atom.exactText.slice(0, 180)}`, repair: 'expand_support', missingSupport: [atom.id] })),
          ];
          let copyIssues=inspectCopy(content),repairAttempts=0,rejectedCopy=[];
          // A bounded local rewrite is still the same durable content node: it
          // does not add a DAG stage or restart other completed slides.
          while (copyIssues.length && !minimal && repairAttempts<3) {
            const reasons=copyIssues.map(item=>item.code);
            const repairPrompt=contentRepairPrompt(snapshot,slide,index,content,[...copyIssues,...rejectedCopy]);
            const nodeKey=repairAttempts?`${nodeId}:repair:${repairAttempts+1}`:`${nodeId}:repair`;repairAttempts++;
            try{
              const written=await writeWithContractRepair({prompt:repairPrompt,nodeKey,maxRepairs:1,call:(prompt,nodeKey)=>deps.modelCall(snapshot,prompt,activity,log,{nodeKey}),normalize:response=>normalizeSlide(response,slide,snapshot,previousTitles)});
              const candidateIssues=inspectCopy(written.content);
              if(candidateIssues.filter(issue=>issue.severity==='error').length>copyIssues.filter(issue=>issue.severity==='error').length){rejectedCopy=candidateIssues.filter(issue=>issue.severity==='error');continue;}
              content=written.content;copyIssues=candidateIssues;rejectedCopy=[];
            }catch(error){
              if(!/模型未返回有效的结构化内容|source_artifact_capacity|writer cover contract|writer source-only contract|invalid visible native copy type|invalid source commentary|writer omitted|source artifact|row range/iu.test(String(error.message)))throw error;
              rejectedCopy=[{code:'writer_rejected_candidate',severity:'error',repair:'expand_support',message:String(error.message)}];
            }
            content.localRepair = { attempts:repairAttempts,reasons,rejectedCandidates:rejectedCopy };
            if(!copyIssues.some(issue=>issue.severity==='error'))break;
          }
          const unresolved=copyIssues.filter(issue=>issue.severity==='error');
          if(unresolved.length&&!minimal)throw new Error(`writer_copy_gate: ${JSON.stringify(unresolved.map(({code,shapeId,message})=>({code,shapeId,message})))}`);
          if(repairAttempts)content.localRepair={...content.localRepair,attempts:repairAttempts,rejectedCandidates:rejectedCopy};
          if (inspectSlideCopy(content, contract, index, snapshot.outline.length).some(issue => issue.code === 'visible_copy_placeholder'))
            throw new Error('visible_copy_placeholder: show the actual source/table explanation before committing a page');
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
            if (index === 0 && latest.deckTitle?.source !== 'user') {latest.deckTitle = { text: content.title, raw: content.title, source: 'agent', locked: false };if(latest.titleSource!=='user'){const identity=displayedDocumentTitle(latest);latest.title=identity?.variants?.map(v=>v.text).join(' | ').slice(0,160)||content.title;}}
            contentEditResult(latest, slide.id, epoch, 'applied');
            store.save(latest); clearDraft(latest.id, slide.id); emitRunProgress(latest, 'slide.render_ready', { slideId: slide.id, epoch, renderHash: latest.runtime.slides[slide.id].renderHash });
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
            if(latest.nodes[slide.id]?.status!=='done')latest.nodes[slide.id].status='failed';
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
      // Source/media checks can run concurrently; visible page creation follows
      // the reading order and commits each real preview before starting the
      // next (Gamma: finished pages, then the current page; edits to the
      // remaining pages apply before those pages are written).
      await boundedAll(readyNodes.filter(work=>work.kind==='media'), PPT_NODE_CONCURRENCY, runWork);
      await boundedAll(readyNodes.filter(work=>work.kind==='content'), 1, runWork);
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
        await boundedAll(wave.pending, 1, runWork);
      }

      if (!current || current.status !== 'generating') return;
      try { transitionNode(current, 'content', 'completed'); transitionNode(current, 'media', 'completed'); transitionNode(current, 'layout', 'completed'); transitionNode(current, 'preview', 'completed'); transitionNode(current, 'quality', 'running'); } catch {}

      await prepareNavigationPlan(current,finalDeckNavigation({...current,navigationPlan:undefined}).entries,(prompt,nodeKey)=>deps.modelCall(current,prompt,activity,log,{nodeKey,maxOutputTokens:8192}),async planned=>{await enqueueProject(uid,id,()=>{const latest=store.get(uid,id);if(latest?.status==='generating'&&semanticReviewKey(latest)===semanticReviewKey(planned)){latest.navigationPlan=planned.navigationPlan;store.save(latest);}});});
      bindDeckNavigation(current);
      enrichAssetRefs(current);
      current.postWriterPlan=postWriterPlan(current);store.save(current);
      const consolidateActualPages=async()=>{
        const actualPlan=await executePostWriterPlan(current,{inspect:deterministicReview,rewrite:async(candidate,outline,index,proposal)=>{
        const prompt=contentPrompt(candidate,outline,index)+'\n<actual_object_consolidation>'+JSON.stringify({slideIds:proposal.slideIds,sourceUnitIds:proposal.sourceUnitIds})+'</actual_object_consolidation>Rewrite one coherent page title and only necessary explanations. Keep every frozen source object/range and every condition; no font shrink or invented facts.';
        const result=await writeWithContractRepair({prompt,nodeKey:`content:${outline.id}:postwriter`,call:text=>deps.modelCall(candidate,text,activity,log,{nodeKey:`content:${outline.id}:postwriter`}),normalize:raw=>normalizeSlide(raw,outline,candidate,candidate.deck.slides.slice(0,index).map(s=>s.title))});
        return result.content;
      }});
      if(actualPlan.executions.length){
        const latest=store.get(uid,id);
        if(!lease.owns()||!latest||latest.currentRunId!==current.currentRunId||latest.status!=='generating'||semanticReviewKey(latest)!==semanticReviewKey(current))throw Error('postwriter transaction superseded by a user edit');
        const beforeReplan=current;current=actualPlan.project;recordRepairSet(beforeReplan,current,actualPlan.executions.filter(e=>e.status==='committed').map(e=>({code:'postwriter_consolidation',detail:e.proposal.reason})));store.save(current);emitRunProgress(current,'deck.replanned',{executions:actualPlan.executions});
      }
        bindDeckNavigation(current);enrichAssetRefs(current);current.postWriterPlan=postWriterPlan(current);store.save(current);
      };
      await consolidateActualPages();
      let initialReview = deterministicReview(current);
      const reviewNodeId = 'review:deck';
      let reviewedInputHash = semanticReviewKey(current);
      let modelReview = reviewIsCurrent(current) ? current.quality.modelReview : null;
      if (!modelReview) {
        persistDagNode(uid, id, reviewNodeId, 'running');
        const reviewStarted = Date.now();
        try {
          modelReview = await checkpointedDeckReview(current,(prompt,nodeKey)=>deps.modelCall(current,prompt,activity,log,{nodeKey}),{nodeKey:reviewNodeId});
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
        modelReview = await checkpointedDeckReview(current,(prompt,nodeKey)=>deps.modelCall(current,prompt,activity,log,{nodeKey}),{nodeKey:'review:deck:refresh'});
        current = store.get(uid, id); if (!current || current.deletedAt || current.status !== 'generating') return;
        if (current.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(store.get(uid, id))); return; }
      }
      // Critic findings are actionable input to the writer, not just a final
      // report. Persist the round bound so pause/recovery cannot loop forever.
      for (;;) {
        const targets = criticRewriteTargets(current, modelReview, initialReview);
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
          const frozenSource = hasFrozenSourceArtifacts(draft);
          const attemptKey = `content:${slide.id}:critic:${round + 1}`;
          const started = Date.now();
          const optional=optionalCopyRepair(current,modelReview,slide.id,deterministicReview);
          let candidate;
          try { ({content:candidate}=optional?{content:optional.slide}:await writeWithContractRepair({prompt:contentRepairPrompt(current,slide,index,draft,target.findings),nodeKey:attemptKey,
            call:(prompt,nodeKey)=>deps.modelCall(current,prompt,activity,log,{nodeKey}),normalize:raw=>{
              // The critic edits source copy; native header/section slots stay frozen.
              const candidate=normalizeSlide(frozenSource?{...raw,slotTexts:draft.templateSlotTexts,omitTemplateShapes:draft.templateOmissions}:raw,slide,current,current.deck.slides.slice(0,index).map(item=>item.title));
              if(frozenSource)candidate.templateOmissions=(candidate.templateOmissions||[]).map(item=>{
                const prior=draft.templateOmissions?.find(old=>old.shapeId===item.shapeId&&old.version===2);return prior?structuredClone(prior):item;
              });
              return candidate;
            }})); } catch(error) {
            // An invalid bounded critic candidate must not destroy a verified
            // writer page or abort all remaining repair targets. Keep the old
            // page and unresolved gate finding. An optional repair transport
            // failure also retains the verified baseline: final review and
            // publication gates still block unresolved findings. Cancellation,
            // authentication and stale-edit failures must propagate.
            const rejectedCode = error.code || (/^ppt_(?:timeout|network)$/u.test(error.message) ? error.message : undefined);
            if(!['capacity_invalid','coverage_invalid','schema_invalid','timeout','network','ppt_timeout','ppt_network'].includes(rejectedCode))throw error;
            current=await enqueueProject(uid,id,()=>{
              const latest=store.get(uid,id);
              if(!lease.owns()||!latest||latest.status!=='generating'||latest.currentRunId!==current.currentRunId||semanticReviewKey(latest)!==beforeKey)throw Error('content changed during rejected critic repair');
              runtimeState(latest).criticRepair.attempts.push({slideId:slide.id,nodeKey:attemptKey,rolledBack:true,progressed:false,violations:[{code:rejectedCode,detail:String(error.message).slice(0,700)}],beforeHash:digest(draft),durationMs:Date.now()-started});
              store.save(latest);return latest;
            });
            continue;
          }
          current = await enqueueProject(uid, id, () => {
            const latest = store.get(uid, id);
            if (!lease.owns() || !latest || latest.deletedAt || latest.status !== 'generating') return null;
            if (latest.runtime?.pauseRequested) { finishPause(latest); return null; }
            if (latest.currentRunId !== current.currentRunId || generationEpoch(latest, slide.id) !== epoch || semanticReviewKey(latest) !== beforeKey)
              throw new Error('content changed during critic repair; stale rewrite discarded');
            if (criticRewriteTargets(latest, modelReview, deterministicReview(latest)).some(item => item.slideId === slide.id)) {
              const beforeRepair = structuredClone(latest);
              const beforeReview = deterministicReview(beforeRepair);
              latest.nodes[slide.id] = { ...latest.nodes[slide.id], status: 'done', slide: candidate };
              // A single-page critic must not rematerialize neighboring pages
              // from older writer caches or regenerate their derived navigation.
              const untouched=new Map(latest.deck.slides.filter(item=>item.id!==slide.id).map(item=>[item.id,structuredClone(item)]));
              latest.deck.slides[index]=structuredClone(candidate);
              latest.deck=ensureDeckV3(latest.deck);
              bindTemplateFidelity(latest);
              latest.deck.slides=latest.deck.slides.map(item=>untouched.get(item.id)||item);
              // Copy remains inside the actual current layout/media frame even
              // when its prose is generated and editable rather than frozen.
              if(draft.sourceArtifactNodes?.length)preserveCopyRepairFrame(beforeRepair.deck.slides[index],latest.deck.slides[index]);
              latest.nodes[slide.id].slide=structuredClone(latest.deck.slides[index]);
              enrichAssetRefs(latest,{slideIds:[slide.id]});
              const repairViolations = validateSourceRewriteWithReflow(beforeRepair, latest, { scopeSlideIds: [slide.id], beforeReview, afterReview: deterministicReview(latest) });
              if (repairViolations.length) {
                Object.assign(latest, beforeRepair);
                runtimeState(latest).criticRepair.attempts.push({ slideId: slide.id, nodeKey: attemptKey, rolledBack: true, progressed:false, operations:optional?.operations||['rewrite_with_source','reflow'], violations: repairViolations, beforeHash: digest(draft), afterHash: digest(candidate) });
                store.save(latest); return latest;
              }
              updateSlidePreview(latest, slide.id);
              latest.runtime.slides[slide.id].repairComparison=recordRepairComparison(beforeRepair,latest,slide.id,target.findings);
              for (const stage of ['content', 'layout', 'preview', 'quality']) transitionNode(latest, `${stage}:${slide.id}`, 'completed',
                { slideId: slide.id, epoch, criticRound: round + 1, inputHash: latest.runtime.slides[slide.id].contentHash, renderHash: latest.runtime.slides[slide.id].renderHash }, { useInput: true });
              runtimeState(latest).criticRepair.attempts.push({ slideId: slide.id, nodeKey: attemptKey,
                beforeHash: digest(draft), afterHash: digest(candidate), progressed:semanticReviewKey(latest)!==beforeKey,
                findings: target.findings, durationMs: Date.now() - started });
              checkpoint(latest, 'critic-rewrite');
            }
            store.save(latest);
            clearDraft(latest.id, slide.id); emitRunProgress(latest, 'slide.render_ready', { slideId: slide.id, epoch, criticRound: round + 1, renderHash: latest.runtime.slides[slide.id].renderHash });
            return latest;
          });
          if (!current) return;
        }
        // Optional-copy removals can expose a genuinely smaller complete-source
        // layout. Re-measure/execute atomically, then audit the actual new deck.
        await consolidateActualPages();
        reviewedInputHash = semanticReviewKey(current);
        modelReview = await checkpointedDeckReview(current,(prompt,nodeKey)=>deps.modelCall(current,prompt,activity,log,{nodeKey}),{nodeKey:`review:deck:critic:${round+1}`});
        current = store.get(uid, id);
        if (!current || current.deletedAt || current.status !== 'generating') return;
        if (current.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(current)); return; }
        if (semanticReviewKey(current) !== reviewedInputHash) throw new Error('content changed during critic review; retry after edits settle');
        initialReview = deterministicReview(current);
        const thisRound=current.runtime?.criticRepair?.attempts?.filter(attempt=>attempt.nodeKey.endsWith(`:critic:${round+1}`))||[];
        if(thisRound.length && thisRound.every(attempt=>attempt.progressed===false)){
          current.runtime.criticRepair.stoppedReason='no_progress';store.save(current);break;
        }
      }
      const repairBaseline = semanticReviewKey(current);
      current.stage = 'repair'; store.save(current);
      try { transitionNode(current, 'quality', 'completed'); transitionNode(current, 'review', 'completed'); transitionNode(current, 'repair', 'running'); } catch {}
      const beforeFinalRepair=structuredClone(current);
      const repaired = repairProject(current, initialReview);
      current = repaired.project;
      const reviewDuration = current.dagNodes?.[reviewNodeId]?.durationMs || 0;
      current.quality = finalQualityReport(repaired.review, repaired.repairs, modelReview, { reviewMs: reviewDuration });
      if (semanticReviewKey(current) !== reviewedInputHash) {
        modelReview = await checkpointedDeckReview(current,(prompt,nodeKey)=>deps.modelCall(current,prompt,activity,log,{nodeKey}),{nodeKey:'review:deck:repair'});
        current.quality = finalQualityReport(repaired.review, repaired.repairs, modelReview, { reviewMs: reviewDuration });
      }
      const latestBeforePublish = store.get(uid, id);
      if (!latestBeforePublish || latestBeforePublish.deletedAt || latestBeforePublish.status !== 'generating') return;
      if (latestBeforePublish.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(latestBeforePublish)); return; }
      if (semanticReviewKey(latestBeforePublish) !== repairBaseline) throw new Error('content changed during repair review; retry before publishing');
      current.editing = latestBeforePublish.editing; current.constraints = latestBeforePublish.constraints; current.runtime = latestBeforePublish.runtime;
      recordRepairSet(beforeFinalRepair,current,repaired.repairs);
      bindDeckNavigation(current);
      enrichAssetRefs(current);
      current.postWriterPlan=postWriterPlan(current);
      current.renderTree = buildRenderTree(current);
      for (const tree of current.renderTree.slides) runtimeState(current).slides[tree.id] = { ...current.runtime.slides[tree.id], preview: tree, renderHash: digest(tree) };
      bindReview(current, modelReview);
      transitionNode(current, reviewNodeId, 'completed', { result: modelReview,
        criticRounds: current.runtime?.criticRepair?.rounds || 0, inputHash: semanticReviewKey(current) }, { useInput: true });
      current.stage = 'publish'; store.save(current);
      try { transitionNode(current, 'repair', 'completed'); } catch {}
      if (!current.quality.publishEligible) {
        current.status = 'quality_blocked'; current.stage = 'repair';
        current.error = `PPT quality gate blocked publish: ${qualityError(current) || current.quality.modelIssues?.find(item => item.severity === 'error')?.detail || 'content review failed'}`;
        store.save(current);
        return;
      }
      persistDagNode(uid, id, 'publish:deck', 'running');
      const artifactPath = `/workspace/published-${Math.max(1, Number(current.revision || 0))}-${newIrId('artifact')}.pptx`;
      current=await enqueueProject(uid,id,()=>{
        const latest=store.get(uid,id);
        if(!latest||latest.status!=='generating'||semanticReviewKey(latest)!==semanticReviewKey(current))throw new Error('generation changed before export; review again');
        latest.revision=Math.max(1,Number(latest.revision||0));latest.draftRevision=latest.revision;store.save(latest);return latest;
      });
      let exportInfo;
      try {
        exportInfo=await deps.renderPptx({...current,renderOutput:artifactPath});acceptExportVerification(current,exportInfo);
      } catch(error) {
        await enqueueProject(uid,id,()=>{
          const latest=store.get(uid,id);
          if(latest&&latest.status==='generating'&&semanticReviewKey(latest)===semanticReviewKey(current)){
            blockExportVerification(latest,error);store.save(latest);persistDagNode(uid,id,'publish:deck','failed',{error:latest.error});
          }
        });
        return;
      }
      await enqueueProject(uid, id, () => {
        const finished = store.get(uid, id);
        if (!lease.owns() || !finished || finished.deletedAt || finished.status !== 'generating' || finished.currentRunId !== current.currentRunId) return;
        if (finished.runtime?.pauseRequested) { finishPause(finished); return; }
        if (semanticReviewKey(finished) !== semanticReviewKey(current)) throw new Error('generation changed during publication; retry review before publishing');
        acceptExportVerification(finished,exportInfo);
        finished.exportBytes = exportInfo.bytes; finished.status = 'completed'; finished.stage = 'completed';
        finished.dagNodes['publish:deck'] = nodeRecord('done', finished.dagNodes['publish:deck'], { bytes: exportInfo.bytes });
        finished.error = ''; finished.revision = Math.max(1, Number(finished.revision || 0)); finished.draftRevision = finished.revision;
        delete finished.renderUpgradePending; finished.publishedArtifactPath = artifactPath; finished.publishedRevision = finished.revision;finished.publishedPageCount=finished.deck.slides.length;finished.publishedAt=new Date().toISOString();
        finished.renderTree = buildRenderTree(finished); saveStructuredProject(finished); saveRevision(finished, 'initial-publish');
        runtimeState(finished).lifecycle = 'completed';
        for (const tree of finished.renderTree.slides) finished.runtime.slides[tree.id] = { ...finished.runtime.slides[tree.id], phase: 'validated', preview: tree, renderHash: digest(tree) };
        checkpoint(finished, 'initial-publish'); saveStructuredProject(finished);
        try { transitionNode(finished, 'publish:deck', 'completed', { bytes: exportInfo.bytes }); transitionNode(finished, 'publish', 'completed', { bytes: exportInfo.bytes }); completeRun(finished, { revision: finished.revision }); } catch {}
      });
    } catch (error) {
      const latest=store.get(uid,id);
      if(error.code==='cancelled'&&latest?.status==='generating'&&latest.runtime?.pauseRequested)finishPause(latest);
      else fail(uid, id, 'generation', error, log);
    }
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
  const projects = store.list(uid,{hydrate:false}).filter(project => !project.deletedAt&&libraryEligible(project));
  return sortManual(store.listFolders(uid).map(folder => ({ ...folder, count: projects.filter(project => project.folderId === folder.id).length })),
    (a, b) => a.name.localeCompare(b.name));
}
function listProjects(uid, url) {
  // The account task list needs statuses/counts, never hydrated image payloads.
  let projects = store.list(uid,{hydrate:false});
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
    .map(taskSummary);
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
    project.title = title;project.titleSource='user';
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
  if (typeof encoded !== 'string' || encoded.length > (validator === validateTemplate ? Math.ceil(templateLimits().userBytes / 3) * 4 : 11_200_000) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HttpError(400, 'invalid file payload');
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
  let rows = [...BUILT_INS.map(item => ({ ...item, pinned: pins.has(item.id) })), ...store.listTemplates(uid), ...store.listTemplates('managed').map(item => ({ ...item, pinned: pins.has(item.id) }))];
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
    const binary = req.headers?.['content-type']?.startsWith('application/octet-stream');
    let data, upload;
    if (binary) {
      data = { fileName: url.searchParams.get('fileName'), name: url.searchParams.get('name') || undefined };
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > templateLimits().userBytes) throw new HttpError(413, 'template_too_large: upload exceeds configured limit');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      let extension;
      try { extension = validateTemplate(data.fileName, bytes); } catch (error) { throw new HttpError(400, error.message); }
      upload = { bytes, extension, sha256: sha256(bytes) };
    } else {
      data = await body(req);
      // Compatibility for existing clients; new clients upload raw bytes.
      upload = decodeFile(data.fileName, data.fileBase64, validateTemplate);
    }
    const duplicate = customs.find(item => item.sha256 === upload.sha256);
    if (duplicate) return send(200, { template: duplicate, cacheHit: true });
    if (customs.length >= 30) throw new HttpError(409, 'template limit is 30');
    const templateId = store.newId();
    let analysis, imported;
    try {
      analysis = await deps.analyzeTemplate(uid, templateId, upload.extension, upload.bytes);
      if (['pptx','potx'].includes(upload.extension) && deps.importTemplateIR)
        imported = await deps.importTemplateIR({ uid, id: templateId }, upload.bytes, upload.sha256);
    }
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
      fileName: data.fileName, extension: upload.extension, bytes: upload.bytes.length, sha256: upload.sha256, irVersion: imported ? 'pptx-ir-7' : null, createdAt: new Date().toISOString() };
    store.writeTemplate(uid, templateId, upload.bytes);
    if (imported) store.writeTemplateIR(uid, templateId, { schemaVersion: 1, parserVersion: 'pptx-ir-7', sha256: upload.sha256, imported });
    store.saveTemplates(uid, [...customs, item]);
    return send(201, { template: item });
  }
  const builtIn = BUILT_INS.find(row => row.id === id) || store.listTemplates('managed').find(row => row.id === id);
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
  if (store.list(uid).filter(item => !item.deletedAt).length >= 50) throw new HttpError(409, 'workspace limit is 50 stored projects, including presentations and tasks; move unused tasks to trash');
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
  if (['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension) && data.templateMode !== 'mapped') {
    const reuseError = templateReuseError(template.pages, count);
    if (reuseError) throw new HttpError(400, reuseError);
  }
  const project = { id, uid, title: updateTitle || `${baseSnapshot.title} · 更新版`.slice(0, 160), prompt: progressText || progressFile.name, pages: count,
    deckTitle: updateTitle ? { text: formattedUpdateTitle.title, raw: updateTitle, source: 'user', locked: true } : { text: '', raw: '', source: 'agent', locked: false },
    template: template.id, templateContentMode: data.templateContentMode==='keep_fixed'?'keep_fixed':'design_only', templateSpec: snapshotTemplate(template), inputKind: 'update',
    update, updateRequest: requestId ? { id: requestId, hash: requestHash } : null,
    version: { rootId: rootId || id, parentId: baseProject?.id || null, number: nextVersion, baseFileName: baseFile?.name || null }, source,
    sourceRevision: 1, outlineRevision: 0, pageDecision: { finalPageCount: count, source: data.pages === undefined ? 'estimate' : 'user', includesCover: true }, status: mustIngest ? 'ingesting' : 'outlining', stage: mustIngest ? 'ingest' : 'outline',
    model: typeof data.model === 'string' ? data.model.slice(0, 120) : '', configId: bounded(data.configId, 120, 'configId'),
    generationPolicy: normalizeGenerationPolicy(data.generationPolicy ?? baseProject?.generationPolicy), promptContractVersion: PPT_PROMPT_CONTRACT_VERSION,
    outline: [], deck: null, nodes: {}, revision: 0, favorite: false, pinned: false, folderId: baseProject?.folderId || null,
    tags: ['更新', template.name.slice(0, 40)].slice(0, 10), deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension) && deps.prepareTemplateFidelity) {
    project.templateMode = data.templateMode === 'mapped' ? 'mapped' : 'preserve';
    project.templateFidelity = await deps.prepareTemplateFidelity(project, store.readTemplate(template.kind === 'managed' ? 'managed' : uid, template.id), template.sha256, template);
  }
  if (baseFile) store.writeInput(uid, id, 'base', baseFile.bytes);
  if (progressFile) store.writeInput(uid, id, 'progress', progressFile.bytes);
  store.save(project);
  startRun(ensureProjectV3(project), 'version-update');
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
  if (data.action === 'restore' && store.list(uid).filter(project => !project.deletedAt).length + projects.filter(project => project.deletedAt).length > 50) throw new HttpError(409, 'workspace limit is 50 stored projects, including presentations and tasks; move unused tasks to trash');
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

async function checkpointedDeckReview(project,call,options){
 const visibleCall=async(prompt,nodeKey)=>{
  await enqueueProject(project.uid,project.id,()=>{
   const latest=store.get(project.uid,project.id);
   if(!latest||latest.deletedAt||latest.status!=='generating'||latest.currentRunId!==project.currentRunId)return;
   latest.stage='review:deck';latest.runtime ||= {};
   latest.runtime.reviewProgress={nodeKey,phase:'writing',startedAt:new Date().toISOString()};
   store.save(latest);emitRunProgress(latest,'review.batch_started',{nodeKey});
  });
  return call(prompt,nodeKey);
 };
 return reviewWithContractRepair(project,visibleCall,{...options,checkpoint:{
  load:key=>store.get(project.uid,project.id)?.reviewCheckpoints?.[key]?.review,
  save:(key,review)=>enqueueProject(project.uid,project.id,()=>{
   const latest=store.get(project.uid,project.id);if(!latest||latest.deletedAt)return;
   const records=latest.reviewCheckpoints||{};records[key]={review,at:new Date().toISOString(),model:project.model};
   latest.reviewCheckpoints=Object.fromEntries(Object.entries(records).slice(-20));store.save(latest);
  })
 }});
}

export async function handlePpt(req, url, { uid, send:sendRaw, res, readBody, activity, log = () => {}, deps = defaultDeps }) {
  // Mutations use the same lean scene as polling. Returning the full durable
  // project here can ship tens of MB of repeated template image data and
  // freeze the editor just when it should show the next real stage.
  const send=(status,value)=>sendRaw(status,url.searchParams.get('view')==='live'&&value?.project?.uid?{...value,project:liveProjectView(value.project)}:value);
  if (uid === 'managed') return send(403, { error: 'reserved template registry namespace' });
  if (url.pathname === '/ppt/capabilities') return req.method === 'GET'
    ? send(200, { byok: PPT_BYOK_CAPABILITIES }) : send(405, { error: 'method not allowed' });
  const modelJob = url.pathname.match(/^\/ppt\/model-jobs(?:\/([a-f0-9]{32})\/(claim|complete|progress))?$/);
  if (modelJob) {
    const [, id, action] = modelJob;
    if (!id && req.method === 'GET') return send(200, { jobs: pptModelJobs.list(uid) });
    if (id && req.method === 'POST') {
      if (action === 'claim') { const job = pptModelJobs.claim(uid, id); return send(job ? 200 : 409, job || { error: 'Job unavailable' }); }
      if (action === 'progress') { try { const accepted = pptModelJobs.progress(uid, id, await body(req)); return send(accepted ? 200 : 409, accepted ? { ok: true } : { error: 'Job unavailable' }); } catch { return send(400, { error: 'Invalid progress' }); } }
      try { const accepted = pptModelJobs.complete(uid, id, await body(req)); return send(accepted ? 200 : 409, accepted ? { ok: true } : { error: 'Job unavailable' }); }
      catch { return send(400, { error: 'Invalid model result' }); }
    }
    return send(405, { error: 'method not allowed' });
  }
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
      const source = data.inputKind === 'paste' && text.trim() ? normalizePaste(text) : data.inputKind === 'file' ? { kind: 'file', text: '', bytes: Number(data.fileBytes) || 0 } : null;
      const estimateTemplate = data.template ? resolveTemplate(uid, data.template) : null;
      const candidate = { templateSpec: estimateTemplate ? snapshotTemplate(estimateTemplate) : null, inputKind: data.inputKind, source, prompt, generationPolicy: normalizeGenerationPolicy(data.generationPolicy)||defaultGenerationPolicy(prompt) };
      candidate.inputProfile = profilePptInput(candidate); candidate.contentPlan = planSparseInput(candidate, candidate.inputProfile);
      const result = estimatePageRecommendation(candidate);
      const weight = data.inputKind === 'file' ? Math.min(16, Math.ceil(Math.max(0, Number(data.fileBytes) || 0) / 180000)) : 0;
      const recommended = Math.min(100, Math.max(result.recommended, weight ? 4 + weight : 3));
      return send(200, { recommendation: { recommended, min: Math.min(result.range[0], recommended), max: Math.min(100, Math.max(result.range[1], recommended)),
        densityProfileId: result.densityProfileId, estimationBasis: result.estimationBasis, provisional: true, requested: requestedPageCount(candidate.source?.text?.trim()===prompt.trim()?'':prompt), reason: data.inputKind === 'file' ? '文件体量与补充要求初估；解析来源后校准。' : result.reason,
        reasonBase: data.inputKind === 'file' ? '文件体量与补充要求初估；解析来源后校准。' : result.reasonBase, assumptions: result.assumptions || [], warnings: result.warnings || [] } });
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
        if (store.list(uid).filter(project => !project.deletedAt).length >= 50) throw new HttpError(409, 'workspace limit is 50 stored projects, including presentations and tasks; move unused tasks to trash');
        const inputKind = data.inputKind || 'prompt';
        if (!['prompt', 'paste', 'file'].includes(inputKind)) throw new HttpError(400, 'invalid input kind');
        let source = null; let sourceBytes = null;
        if (inputKind === 'paste') {
          try {
            source = normalizePaste(data.text || '', data.images);
          } catch (error) { throw new HttpError(400, error.message); }
        }
        if (inputKind === 'file') {
          if (typeof data.fileBase64 !== 'string' || data.fileBase64.length > 11_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.fileBase64)) throw new HttpError(400, 'invalid file payload');
          sourceBytes = Buffer.from(data.fileBase64, 'base64');
          let ext;
          try { ext = validateFile(data.fileName, sourceBytes); } catch (error) { throw new HttpError(400, error.message); }
          source = { kind: 'file', name: data.fileName, extension: ext, bytes: sourceBytes.length, sha256: sha256(sourceBytes), text: '', segments: [], truncated: false };
        }
        const prompt = inputKind === 'prompt' ? bounded(data.prompt || '', MAX_PROMPT, 'prompt', !(Array.isArray(data.images) && data.images.length)) : bounded(data.prompt || '', MAX_PROMPT, 'prompt', false);
        const userTitle = typeof data.title === 'string' && data.title.trim() ? bounded(data.title, 160, 'title') : '';
        const sourceTitle=source?displayedDocumentTitle({source,generationPolicy:data.generationPolicy}):null;
        const derivedTitle=sourceTitle?.variants.map(v=>v.main||v.text).join(' | ')||prompt.replace(/^\s*#{1,6}\s+/u,'').split('\n')[0].trim()||source?.name?.replace(/\.[^.]+$/,'')||'Presentation';
        const title = bounded(userTitle || derivedTitle.slice(0,160), 160, 'title');
        const template = resolveTemplate(uid, data.template || 'violet');
        const generationPolicy = normalizeGenerationPolicy(data.generationPolicy)||defaultGenerationPolicy(prompt);
        if (inputKind === 'prompt') {
          // Prompt text, pasted images, Markdown/HTML image references and
          // inline tables/SVG enter the same semantic source as a file.
          const parsed = normalizePaste(prompt, data.images);
          source = estimationSource({ inputKind, prompt, generationPolicy }) || (parsed.images.length || parsed.mediaWarnings.length || /\|.*\||```|<svg\b/iu.test(prompt) ? {...parsed,kind:'prompt'} : null);
          if (source) source = {...source,...mergeSourceMedia({images:[...(source.images||[]),...parsed.images]}),mediaWarnings:[...(source.mediaWarnings||[]),...parsed.mediaWarnings]};
        } else if (inputKind === 'file') source = {...source,...mergeSourceMedia({},data.images)};
        const inputProfile = profilePptInput({ inputKind, source, prompt });
        const contentPlan = planSparseInput({ inputKind, source, prompt }, inputProfile);
        const estimatedPages = estimatePageRecommendation({ inputKind, source, prompt, inputProfile, contentPlan, generationPolicy, templateSpec: snapshotTemplate(template) }).recommended;
        const requirements = source?.text?.trim()===prompt.trim()?'':prompt;
        const promptPages = requestedPageCount(requirements);
        const selectedPages = pages(data.pages ?? promptPages ?? estimatedPages);
        const requestedOutline = data.outline === undefined ? null : data.outline;
        if (requestedOutline !== null && (!Array.isArray(requestedOutline) || requestedOutline.length !== selectedPages)) throw new HttpError(400, 'outline must match the user-confirmed page count');
        const formattedUserTitle = userTitle ? formatUserDeckTitle(userTitle) : null;
        if (['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension) && data.templateMode !== 'mapped') {
          const reuseError = templateReuseError(template.pages, selectedPages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        const project = { id: store.newId(), uid, title, titleSource:userTitle?'user':'derived', prompt, userRequirements:requirements, generationPolicy, promptContractVersion: PPT_PROMPT_CONTRACT_VERSION, pages: selectedPages, inputProfile, contentPlan, template: template.id, templateContentMode: data.templateContentMode==='keep_fixed'?'keep_fixed':'design_only',
          templateSpec: snapshotTemplate(template), inputKind, source, sourceRevision: source ? 1 : 0, outlineRevision: 0,
          deckTitle: userTitle ? { text: formattedUserTitle.title, raw: userTitle, source: 'user', locked: true } : { text: '', raw: '', source: 'agent', locked: false },
          pageDecision: { finalPageCount: selectedPages, source: data.pages === undefined && promptPages === undefined ? 'estimate' : 'user',
            mode: data.pages === undefined && promptPages === undefined && !requestedOutline ? 'auto' : 'explicit', initialPageCount: selectedPages,
            densityProfileId: densityProfile().id, estimateVersion: 1, estimatedBeforeParse: Boolean(sourceBytes), includesCover: true,
            confirmedAt: data.pages === undefined && promptPages === undefined && !requestedOutline ? null : new Date().toISOString() },
          compressionApproved: data.compressionApproved === true,
          ...(requestedOutline ? { requestedOutline } : {}),
          model: typeof data.model === 'string' ? data.model.slice(0, 120) : '',
          configId: bounded(data.configId || (source?.extension === 'pptx' && data.importMode === 'editable' ? 'pptx-import' : ''), 120, 'configId'),
          status: sourceBytes ? 'ingesting' : 'outlining', stage: sourceBytes ? 'ingest' : 'outline', error: '', outline: [], deck: null, nodes: {}, revision: 0,
          favorite: false, pinned: false, folderId: null, tags: [], deletedAt: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        const inputText = inputKind==='paste' ? data.text || '' : prompt;
        if (inputKind!=='file' && /<svg\b/iu.test(inputText)) {
          const extracted = await deps.extractFile(project,'input.html',Buffer.from(inputText));
          project.source = withSemanticIndex({...extracted,kind:inputKind,...mergeSourceMedia(extracted,data.images)});
          project.sourceRevision=1;
        }
        if (['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension) && deps.prepareTemplateFidelity) {
          project.templateMode = data.templateMode === 'mapped' ? 'mapped' : 'preserve';
          project.templateFidelity = await deps.prepareTemplateFidelity(project, store.readTemplate(template.kind === 'managed' ? 'managed' : uid, template.id), template.sha256, template);
        }
        if(project.templateFidelity && !sourceBytes){
          const calibrated=estimatePageRecommendation(project);
          project.pageDecision.parsedRecommendation=calibrated.recommended;
          project.pageDecision.capacityBasis=calibrated.estimationBasis;
          if(automaticPages(project)){project.pages=calibrated.recommended;rescheduleTemplateFidelity(project);}
        }
        if (sourceBytes) store.writeSource(uid, project.id, sourceBytes);
        syncPresentationPolicy(project);
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
            imported.revision = 1; imported.draftRevision = 1; imported.publishedRevision = 1;imported.publishedPageCount=imported.deck.slides.length;imported.publishedAt=new Date().toISOString();
            // Import creates an editable source baseline, not a certified new
            // generation. Preserve the original even if its layout needs repair.
            try {const importExport=await renderImportedPptx(imported);acceptExportVerification(imported,importExport);}
            catch(error){imported.quality={...imported.quality,exportable:false,renderedTextVerified:false,exportVerification:{status:'not_evaluated',basis:'imported_original',sha256:source.sha256},baselineRenderError:String(error.message||error).slice(-1000)};imported.publishedArtifactPath=imported.externalPptx.originalPath;}
            imported.quality={...imported.quality,status:'imported_baseline',publishEligible:false,contentReady:false,visualVerified:false,reviewState:'stale',baselineReason:'Imported original preserved; source/content quality not evaluated'};
            saveStructuredProject(imported); saveRevision(imported, 'external-import');
            for (const nodeId of ['source', 'outline', 'content', 'media', 'layout', 'preview', 'publish']) transitionNode(imported, nodeId, 'completed', {basis:'imported_baseline'});
            for (const nodeId of ['quality','review','repair']) transitionNode(imported,nodeId,'pending');
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
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 stored projects, including presentations and tasks; move unused tasks to trash' });
      return send(200, { project: await enqueueProject(uid, id, () => { const latest = getStructuredProject(uid, id); latest.deletedAt = null; return store.save(latest); }) });
    }
    if (action === 'permanent' && req.method === 'DELETE') {
      if (!project.deletedAt) return send(409, { error: 'move project to trash first' });
      await enqueueProject(uid, id, () => permanentlyRemove(getStructuredProject(uid, id), deps));
      return send(200, { ok: true });
    }
    if (action === 'duplicate' && req.method === 'POST') {
      if (project.status !== 'completed') return send(409, { error: 'only completed presentations can be duplicated' });
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 stored projects, including presentations and tasks; move unused tasks to trash' });
      const copy = structuredClone(project);
      copy.id = store.newId(); copy.title = `${project.title} · 副本`.slice(0, 160);
      delete copy.update; delete copy.updateRequest; delete copy.diff; delete copy.editing; delete copy.publishedArtifactPath; delete copy.currentRunId; delete copy.runId;
      delete copy.publishedPageCount;delete copy.publishedAt;delete copy.publishedRenderTree;delete copy.publishedRevision; delete copy.exportManifest; delete copy.pdfArtifactPath; delete copy.quality; delete copy.runtime; delete copy.renderOutput;
      // The copy is a new task until its own native export passes publication.
      if (copy.templateFidelity?.mode === "preserve" && deps.prepareTemplateFidelity || copy.externalPptx?.mode==='preserve'&&deps.importTemplateIR) {
        const original=copy.templateFidelity?.mode==='preserve'?copy.templateFidelity:copy.externalPptx;
        const file=await deps.readFile(project.id,original.originalPath),chunks=[];let total=0;
        for await(const chunk of file.stream){const bytes=Buffer.from(chunk);total+=bytes.length;if(total>64*1024*1024)throw new HttpError(413,'native original exceeds copy limit');chunks.push(bytes);}
        const archive=Buffer.concat(chunks),hash=sha256(archive);
        if(original.sha256&&hash!==original.sha256)throw new HttpError(409,'native original hash changed; copy cannot replace source assets');
        if(copy.templateFidelity?.mode==='preserve'){
          // Use this project's exact opaque original, even when the template
          // catalog was renamed, deleted or updated. Do not mutate the deck.
          const scratch={uid,id:copy.id,pages:copy.pages,outline:copy.outline,templateSpec:copy.templateSpec};
          const prepared=await deps.prepareTemplateFidelity(scratch,archive,hash,null);
          copy.templateFidelity.originalPath=prepared.originalPath;
        }else{
          const baseline=await deps.importTemplateIR({uid,id:copy.id,templateSpec:copy.templateSpec},archive,hash);
          copy.externalPptx.originalPath=baseline.externalPptx.originalPath;
        }
      }
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
        const localPolicy = `${promptPolicy(project)}\n${writingGuide(project, slide.copy || {})}`;
        const prompt = block
          ? `${localPolicy}\n你只改写一个演示文稿视觉元素的文字，不调用工具，不改图片、图表数据、形状或坐标。用户指令：${instruction}\n元素原文：${block.type === 'image' ? block.caption : block.text}\n本页来源：${source || '无额外来源'}\n仅返回 JSON：{"text":"..."}，最多 100 字。`
          : `${localPolicy}\n你只修改一页演示文稿的标题和要点。不得调用工具、生成坐标、改变图表数据或添加没有来源的数字。用户指令：${instruction}\n当前页：${slide.title}\n${slide.bullets.join('\n')}\n来源：${source || '无额外来源'}\n仅返回 JSON：{"title":"...","bullets":["..."]}；不超过 10 个要点，保留当前必要内容，不要为缩短而丢失机制、条件或对照。`;
        const result = await deps.modelCall(project, prompt, activity, log);
        const index = project.deck.slides.findIndex(item => item.id === slide.id);
        const raw = block ? { ...slide, blocks: slide.blocks.map(item => item.id === block.id
          ? { ...item, [block.type === 'image' ? 'caption' : 'text']: bounded(result.text, 100, 'rewritten text') } : item) } : { ...result, blocks: slide.blocks || [], layout: slide.layout, layoutId: slide.layoutId };
        const rewritten = normalizeDeck({ slides: [raw] }, [project.outline[index]], {slides:[slide]}).slides[0];
        const gated = deterministicGate({ ...project, deck: applyLayoutRegistry({ ...project.deck, slides: project.deck.slides.map(item => item.id === slide.id ? rewritten : item) }) });
        await assertCandidateScope(project, gated, deps, activity, log);
        return send(200, { project: await commitCompatibility(project, gated, deps) });
      } finally { editing.delete(id); }
    }
    if (action === 'source' && req.method === 'PATCH') {
      if (project.inputKind !== 'paste' || project.status !== 'outline_ready') return send(409, { error: 'pasted source is not editable now' });
      const data = await body(req);
      if (data.sourceRevision !== project.sourceRevision) return send(409, { error: 'source changed on another device; reload first' });
      let source;
      try { source = normalizePaste(data.text);source.images=[...source.images,...(project.source?.images||[]).filter(image=>!image.id.startsWith('inline-image-'))]; } catch (error) { throw new HttpError(400, error.message); }
      if (source.sha256 === project.source.sha256) return send(200, { project });
      project.source = source; syncPresentationPolicy(project); project.sourceRevision++; project.outlineRevision = 0;
      project.outline = []; project.nodes = {}; project.status = 'outlining'; project.stage = 'outline';
      store.save(project); startOutline(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'outline' && req.method === 'PATCH') {
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      const data = await body(req);
      if (data.generationPolicy !== undefined) project.generationPolicy = normalizeGenerationPolicy(data.generationPolicy);
      const nextPages = pages(data.slides?.length);
      const confirmedDecision = confirmedPageDecision(project, { nextPages, pageSource: data.pageSource, template: data.template });
      if (data.finalPageCount !== undefined && nextPages !== pages(data.finalPageCount)) throw new HttpError(400, 'outline must match the user-confirmed page count');
      if (data.template !== undefined && data.template !== project.template) {
        const selectedTemplate = resolveTemplate(uid, data.template);
        if (['uploaded','managed'].includes(selectedTemplate.kind) && ['pptx','potx'].includes(selectedTemplate.extension) && (data.templateMode || project.templateMode) !== 'mapped') {
          const reuseError = templateReuseError(selectedTemplate.pages, nextPages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        project.templateMode = data.templateMode || project.templateMode || 'preserve';
        project.template = selectedTemplate.id;
        project.templateSpec = snapshotTemplate(selectedTemplate);
        project.templateFidelity = ['uploaded','managed'].includes(selectedTemplate.kind) && ['pptx','potx'].includes(selectedTemplate.extension) && deps.prepareTemplateFidelity
          ? await deps.prepareTemplateFidelity(project, store.readTemplate(selectedTemplate.kind === 'managed' ? 'managed' : uid, selectedTemplate.id), selectedTemplate.sha256, selectedTemplate)
          : undefined;
      }
      project.pages = nextPages;
      if (data.compressionApproved !== undefined) project.compressionApproved = data.compressionApproved === true;
      project.pageDecision = confirmedDecision;
      if (project.update && project.pages < 6) throw new HttpError(400, 'update outline needs 6 to 100 slides');
      syncPresentationPolicy(project);
      project.outline = normalizeOutline({ slides: data.slides }, project.pages, project.source, project.update, project.deckTitle);
      try{confirmNativeOutlineFit(project);}catch(error){throw new HttpError(409,error.message);}
      project.planning = refreshPlanning(project);
      project.outlineRevision = (project.outlineRevision || 0) + 1;
      project.nodes = {};
      project.diff = diffSummary(project);
      recordOutlineConfirmation(project);
      store.save(project);
      return send(200, { project });
    }
    if (action === 'outline' && req.method === 'POST') {
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      const data = await body(req);
      if (data.generationPolicy !== undefined) project.generationPolicy = normalizeGenerationPolicy(data.generationPolicy);
      syncPresentationPolicy(project);
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
        if (['uploaded','managed'].includes(selectedTemplate.kind) && ['pptx','potx'].includes(selectedTemplate.extension) && (data.templateMode || project.templateMode) !== 'mapped') {
          const reuseError = templateReuseError(selectedTemplate.pages, project.pages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        project.templateMode = data.templateMode || project.templateMode || 'preserve';
        project.template = selectedTemplate.id;
        project.templateSpec = snapshotTemplate(selectedTemplate);
        project.templateFidelity = ['uploaded','managed'].includes(selectedTemplate.kind) && ['pptx','potx'].includes(selectedTemplate.extension) && deps.prepareTemplateFidelity
          ? await deps.prepareTemplateFidelity(project, store.readTemplate(selectedTemplate.kind === 'managed' ? 'managed' : uid, selectedTemplate.id), selectedTemplate.sha256, selectedTemplate)
          : undefined;
      }
      if(data.pageSource==='estimate'){
        project.pages=estimatePageRecommendation(project).recommended;
        project.pageDecision={finalPageCount:project.pages,initialPageCount:project.pages,source:'estimate',mode:'auto',includesCover:true,confirmedAt:null};
      }else project.pageDecision = { finalPageCount: project.pages, source: 'user', mode: 'explicit', includesCover: true, confirmedAt: new Date().toISOString() };
      project.outline = []; project.nodes = {}; project.outlineRevision = 0;
      project.planning = null;
      project.diff = null;
      project.status = 'outlining'; project.stage = 'outline'; project.error = '';
      store.save(project); startOutline(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'generate' && req.method === 'POST') {
      if (['ingesting', 'outlining'].includes(project.status)) {
        return send(409,{error:'Read the input and finish the validated outline first; confirm that outline before generating slides.'});
      }
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      if(project.confirmedOutline&&project.confirmedOutline.hash!==outlineConfirmationHash(project))return send(409,{error:'The outline, source or presentation policy changed; confirm the current outline again.'});
      if(!project.confirmedOutline)recordOutlineConfirmation(project,{titlesFrozen:false});project.autoGenerate=false;
      // A new explicit confirmation starts generation anew. A pause requested
      // in a prior failed run is not a request to pause this new run.
      if(project.runtime){project.runtime.pauseRequested=false;project.runtime.lifecycle='active';}
      project.pageDecision = { ...project.pageDecision, finalPageCount: project.pages, confirmedAt: new Date().toISOString() };
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
    if (action === 'media-exclusions' && req.method === 'POST') {
      // MD-P0-3: a retired template image is only accepted as removed when the
      // user confirms it, with a reason, against the current source hash.
      const data = await body(req), retired = new Set((project.quality?.mediaLedger?.retired || []).map(item => item.objectId));
      const ids = Array.isArray(data.objectIds) ? [...new Set(data.objectIds.map(String))] : [];
      const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : '';
      if (!ids.length || ids.length > 64 || !reason) return send(400, { error: 'objectIds and a reason are required' });
      if (ids.some(objectId => !retired.has(objectId))) return send(409, { error: 'only media listed as retired in the current quality report can be excluded' });
      if (!project.source?.sha256) return send(409, { error: 'source hash unavailable' });
      const saved = await enqueueProject(uid, id, () => {
        const latest = getStructuredProject(uid, id);
        const at = new Date().toISOString(), kept = (latest.sourceObjectExclusions || []).filter(item => !ids.includes(item.objectId));
        latest.sourceObjectExclusions = [...kept, ...ids.map(objectId => ({ objectId, approvedBy: 'user', sourceHash: latest.source.sha256, reason, approvedAt: at, kind: 'template_media' }))];
        // Refresh the media ledger so the confirmation is visible now; the
        // publish gate itself is re-evaluated by the next quality run (retry).
        if (latest.quality?.deterministic) {
          const review = deterministicReview(latest), media = issue => /^media_(conservation|text_only)/u.test(issue.code);
          const issues = [...latest.quality.deterministic.issues.filter(issue => !media(issue)), ...review.issues.filter(media)];
          latest.quality = { ...latest.quality, mediaLedger: review.mediaLedger,
            deterministic: { ...latest.quality.deterministic, issues, hardErrors: issues.filter(issue => issue.severity === 'error').length } };
        }
        return store.save(latest);
      });
      return send(200, { project: saved, excluded: ids.length });
    }
    if(action==='page-policy'&&req.method==='POST'){
      const data=await body(req);if(data.mode!=='auto')throw new HttpError(400,'unsupported page policy');
      const saved=await enqueueProject(uid,id,()=>{const latest=store.get(uid,id),decision=automaticPageDecision(latest,data.baseRevision);latest.pageDecisionHistory=[...(latest.pageDecisionHistory||[]),{...latest.pageDecision,changedBy:'user',at:decision.confirmedAt}];latest.pageDecision=decision;latest.revision++;invalidateReviews(latest);latest.renderTree=buildRenderTree(latest);store.save(latest);saveRevision(latest,'user-released-page-budget');return latest;});
      return send(200,{project:saved});
    }
    if (action === 'retry' && req.method === 'POST') {
      if (!['failed','quality_blocked'].includes(project.status)) return send(409, { error: 'project is not failed or quality blocked' });
      const retryRequest=await body(req);
      if(retryRequest.refreshDerivedSource===true){
        const refreshed=refreshDerivedSource(project,assessOutlineCandidate);
        if(refreshed.changedSourceIds.length){
          Object.assign(project,refreshed.project);
          project.runtime ||= {};
          if(project.runtime.criticRepair)(project.runtime.criticRepairHistory ||= []).push(structuredClone(project.runtime.criticRepair));
          startRun(project,'derived-source-refresh');invalidateReviews(project);
          project.confirmedOutline={...project.confirmedOutline,hash:outlineConfirmationHash(project),sourceRefreshAt:new Date().toISOString(),basis:'Explicit source-refresh retry; identical immutable input and existing confirmed titles, IDs, page count and ownership retained'};
          project.stage='generation';
        }
      }
      if(retryRequest.refitTemplateMedia===true){
        if(project.revision>0||project.publishedRevision||Object.values(project.runtime?.slides||{}).some(s=>s.accepted))return send(409,{error:'Preserve edited/accepted pages; use scoped layout recovery.'});
        Object.assign(project,refitSourceMedia(project));
        project.stage='generation';
      }
      if(retryRequest.repairOutlineTitles===true){
        const issues=inspectNativeOutlineTitles(project),seed=project.candidateOutline;
        if(project.stage!=='generation'||!issues.length||!seed?.accepted||!seed.executionPlan||seed.executionPlan.slides.length!==project.pages)
          return send(409,{error:'Only a failed generation with an accepted outline and oversized native titles can reopen title planning.'});
        if(project.revision>0||Object.values(project.editing?.epochs||{}).some(epoch=>epoch>0)||Object.values(project.runtime?.slides||{}).some(s=>s.accepted))
          return send(409,{error:'This draft contains user edits or accepted pages. Preserve them and use scoped page editing; global title review cannot replace protected objects.'});
        // Explicit user action; preserve the complete accepted source selection
        // and N, but require a fresh visible confirmation after model repair.
        project.outlineRepairHistory=[...(project.outlineRepairHistory||[]),{at:new Date().toISOString(),confirmedOutline:project.confirmedOutline,candidateHash:seed.hash,issues,nodes:project.nodes,runtime:project.runtime}];
        project.nativeTitleRepairSeed={executionPlan:structuredClone(seed.executionPlan),basis:'explicit native title review; accepted ownership and N retained'};
        delete project.confirmedOutline;project.nodes={};project.runtime={schemaVersion:1,lifecycle:'active',pauseRequested:false,slides:{},attempts:{},checkpoint:null};project.status='outlining';project.stage='outline';project.error='';project.autoGenerate=false;
        store.save(project);startOutline(uid,id,activity,log,deps);return send(202,{project});
      }
      if(project.stage==='outline')project.promptContractVersion=PPT_PROMPT_CONTRACT_VERSION;
      // A legacy completed-page checkpoint already has a settled outline.
      // Retrying quality/export must not silently consolidate or replan it.
      if(project.stage!=='outline'&&project.outline?.length&&!project.confirmedOutline)recordOutlineConfirmation(project,{titlesFrozen:false});
      if(project.stage==='outline'&&project.titleSource==='derived'&&project.deckTitle?.source!=='user'){
        const identity=displayedDocumentTitle(project);
        if(identity?.variants.length)project.title=identity.variants.map(v=>v.main||v.text).join(' | ').slice(0,160);
      }
      // Older clients treated the BYOK cancellation used by Pause as failure.
      // Explicit Retry resumes that retained checkpoint, rather than remaining
      // stuck with pauseRequested=true or discarding completed page work.
      if(project.failure?.code==='cancelled'&&project.runtime?.pauseRequested){project.runtime.pauseRequested=false;project.runtime.lifecycle='recovering';}
      // An explicit quality retry creates a new auditable run. Keep the prior
      // critic's results and its round limit intact; never resume that run with
      // a silently reset counter or inherit its review as an approval.
      if(project.status==='quality_blocked'||retryRequest.restartReviewRun===true&&project.stage==='generation'){
        project.runtime ||= {};
        if(project.runtime.criticRepair)(project.runtime.criticRepairHistory ||= []).push(structuredClone(project.runtime.criticRepair));
        startRun(project,'quality-retry');
        invalidateReviews(project);
        project.stage='generation';
      }
      if(project.stage==='generation'){try{revalidateCompletedCopy(project);}catch(error){if(['capacity_invalid','coverage_invalid','schema_invalid'].includes(error.code))throw new HttpError(409,error.message);throw error;}}
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
        const updated = { ...project, outline, pages: outline.length, deck: normalizeDeck({ slides: nextSlides }, outline,project.deck),
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

// Generated explanation frames are editable prose, even when the renderer puts
// them in sourceArtifactNodes. Only actual bound originals freeze carriers.
function hasFrozenSourceArtifacts(slide) {
  return Boolean(slide.sourceArtifactNodes?.some(node => node.sourceArtifact || node.content?.sourceEvidenceIds?.length));
}
export const _internals = { assessOutlineCandidate, writeWithContractRepair, revalidateCompletedCopy, mergeSourceSupplement, hasFrozenSourceArtifacts, normalizeOutline, normalizeDeck, normalizeSlide, parseModelJson, pages, outlinePrompt, contentPrompt, defaultDeps };

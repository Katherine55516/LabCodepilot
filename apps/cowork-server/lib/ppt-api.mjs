import {fitHeaderPills} from './ppt-header-pills.mjs';
import {readableWrittenText} from './ppt-text-contrast.mjs';
import {applyChromeFallback,chromeSlot} from './ppt-chrome-slots.mjs';
import {sourceParsingReceipt,generationReceipt,reparseInput} from './ppt-provenance.mjs';
import {retireUnboundContainers} from './ppt-component-regions.mjs';
import {cardCapacityHint,preflightCardCapacity,repairCapacityBatch} from './ppt-card-capacity-preflight.mjs';
/** M1 PPT Workspace API and durable, server-side job orchestration.
 * All model calls and PPTX rendering run in a Cowork container. Project JSON
 * lives on the server data disk, so a second signed-in desktop sees the same
 * project and can export its completed presentation. */
import {continuationRevision,commitContinuation} from './ppt-outline-continuation.mjs';
import {failureTrace} from './ppt-failure-trace.mjs';
import {outlineFirst,newPlanningContract,capacityIdentity,pagePreference,planningView,assertPlanningReady,assertLogicalOwnership,semanticIdentity,sourceReadIdentity,misplacedAddenda} from './ppt-outline-first.mjs';
import {cardFactIssues} from './ppt-content-qa.mjs';
import {inspectSourceNumbers} from './ppt-source-numbers.mjs';
import {pageReassessmentTask,validatePageReassessment,currentPageReassessment,pageReassessmentIdentity,pageReassessmentRepairTask,applyPageReassessmentRepair} from './ppt-page-reassessment.mjs';
import {editorialOwnershipContract} from './ppt-editorial-contract.mjs';
import {planCardIcons} from './ppt-card-icons.mjs';
import {balanceCardShapes,cardShape,placeScheduledCardFigures,numberCardParts,withPartTitle,patchPartCounter,continuedPageTitle,repeatedTitlePages,cardPageScore,coverParts,figurePhotoCost,cardPageDraft,builtinCardDraft,bindThemeCardPage,applyCardPageOmissions,deterministicCoverDraft,cardObjectPageDraft,cardTitleFits,objectContinuation,objectPageScore,objectsFitPage,planTableFonts,unfitCardTitles,titleShortenTask,acceptShortTitles,fallbackCardTitle,preferredShortTitle} from './ppt-card-pages.mjs';
import {renderWithPageFallback} from './ppt-export-fallback.mjs';
import {matchTemplatePages,fillShortenTask,acceptFillShorten,fillExtendTask,acceptFillExtend,applyTemplateFill,fillOffer} from './ppt-template-fill-match.mjs';
import {retitleItems,retitleTask,acceptRetitles,applyRetitles,dropSubjectTitles,retitleRetryTask,deckTitleIssues,titleStandardTask,acceptStandardTitles,titleStandardAdvisories,acceptFigureCaptions,foreignTitleFallbacks} from './ppt-card-retitle.mjs';
import {sourceFigureScore} from './ppt-figure-composition.mjs';
import {headerFrameReason} from './ppt-template-roles.mjs';
import {dropEmptyCardPages,unplacedSourceObjects,labelCompletionTask,settleLabels,echoRewriteTask,applyEchoRewrites,isBrief,planBriefDeck,briefDeckTask,acceptBriefDeck,sanitizeBriefDeck,defaultLength,requestedOutlineCards,codeUnderstandingIdentity,codeInputUnderstanding,planCardDeck,deckCardsTasks,topicReply,deckFinishTask,acceptDeckFinish,acceptCover,coverCorrectionTask,acceptTakeaway,takeawayCorrectionTask,takeawayDropped,assembleCardDeck,cardDeckSummary,LENGTHS} from './ppt-card-outline.mjs';
import {languagePolicy,defaultLanguageChoice,LANGUAGE_CHOICES} from './ppt-card-language.mjs';
import {cardFactRepairTask,acceptCardFactRepair,cardsFlow,cardTopicTask,cardLineBudget,acceptCardTopic,sanitizeCardTopic,rescueForeignExcerpts,assembleCardOutline,applyCardEdits,splitCardPage,missingCardPoints,fitCardLabels,placeCardPoints,cardSlotPlan,applyCardSlotPlan} from './ppt-outline-cards.mjs';
import {criticSlotTexts} from './ppt-critic-slot-scope.mjs';
import {planTitleHierarchy} from './ppt-title-hierarchy.mjs';
import {restoreOutlineSubjectDrafts,retainConfirmedOutlineDrafts} from './ppt-outline-subject-audit.mjs';
import {understandingIdentity} from './ppt-input-understanding.mjs';
import {allowsEditorialSelection} from './ppt-generation-policy.mjs';
import {safeModelDiagnostic,archiveModelFailure} from './ppt-model-diagnostics.mjs';
import {findingConfirmationResponseSchema} from './ppt/review-findings-confirmation.mjs';
import {recoverSourceCheckpoint} from './ppt-source-checkpoint-recovery.mjs';
import {evidenceBelongsToSlide} from './ppt-evidence.mjs';
import {inspectFrozenOutlineSources} from './ppt-outline-source-fit.mjs';
import {unmappedFixedTemplatePages} from './ppt-template-fixed-authority.mjs';
import {inspectSystemOutlineTitles} from './ppt-outline-title-fit.mjs';
import {PPTX_IR_VERSION} from './ppt-native-shape-ids.mjs';
import {ensureOutlineClosing,ownsClosingContent,appendClosingGreeting,isDedicatedClosing,deterministicClosingDraft,prepareClosingLayout,cardThemeClosing} from './ppt-closing-page.mjs';
import {componentCopyDeck} from './ppt-component-copy.mjs';
import {normalizeExecutionPolicy,resolveTaskRoute,thinkingModeForRoute,taskFingerprint,reserveModelAttempt,recoverExecutionHistory} from './ppt-execution-policy.mjs';
import {taskComplexity,taskRole} from './ppt-task-complexity.mjs';
import {withSourceArithmeticWarnings} from './ppt-source-arithmetic.mjs';
import {deckLanguage,pageTopicLanguage,deckLanguageVariant} from './ppt-presentation-contract.mjs';
import {prepareNativeExportFrames} from './ppt-native-text-fit.mjs';
import {displayedDocumentTitle} from './ppt-deck-coherence.mjs';
import {operationHistory} from './ppt/command-history.mjs';
import {optionalCopyRepair,hasNecessaryExplanationRepair} from './ppt-optional-copy-repair.mjs';
import {refreshDerivedSource} from './ppt-source-refresh.mjs';
import {failureOrigin} from './ppt-failure-origin.mjs';
import {markSchemaUnreliable,schemaPromptBlock,schemaReliabilityKey,schemaUnreliable,topLevelShape,callWithContract,parseModelValue} from './ppt-contract-call.mjs';
import {applyReadingPageBudget} from './ppt-page-floor.mjs';
import {normalizeReply} from './ppt-reply-normalize.mjs';
import {acknowledgeSourceWarnings,sourceReadinessWarnings,unresolvedSourceWarnings,sourceWarningKey} from './ppt-source-readiness.mjs';
import {refitSourceMedia} from './ppt-media-refit.mjs';
import {summaryRecoveryScope,applySummaryRecovery} from './ppt-summary-recovery.mjs';
import {hasPublishedPresentation,libraryEligible,taskEligible} from './ppt-library.mjs';
import {reviewResponseSchema} from './ppt-review-schema.mjs';
import {normalizeDeckEyebrows,diagramEyebrow,repairDiagnosedEyebrow} from './ppt-section-eyebrow.mjs';
import {richTextContent} from './ppt-source-text.mjs';
import {recordRepairComparison,recordRepairSet} from './ppt/repair-comparison.mjs';
import {confirmNativeOutlineFit,outlineConfirmationHash,recordOutlineConfirmation} from './ppt-outline-confirmation.mjs';
import {prepareNavigationPlan} from './ppt-navigation-plan.mjs';
import {bindDeckNavigation,finalDeckNavigation,navigationWriterHeaders} from './ppt-deck-navigation.mjs';
import {commitSourceComponents,componentLeaseToken} from './ppt/component-commit.mjs';
import {executePostWriterPlan} from './ppt-postwriter-executor.mjs';
import {postWriterPlan} from './ppt-postwriter-plan.mjs';
import {confirmedPageDecision,automaticPageDecision} from './ppt-page-decision.mjs';
import {writerDeltaResponseSchema,writerLocalRepairScope,applyWriterLocalDelta,writerLocalRepairPrompt,wrapBareMath} from './ppt-writer-local-repair.mjs';
import {claimSupportSourceIds,closingEvidenceSourceIds} from './ppt-claim-semantics.mjs';
import {RENDER_CONTRACT_VERSION} from './ppt/render-contract.mjs';
import {renderIssues} from './ppt/render-audit.mjs';
import {compileContentSelection,selectionSource,exactPageConflict,coalesceEquivalentSelections,visibleEquivalentCandidates} from './ppt-content-selection.mjs';
import {taskSummary,liveProjectView,readingPlanningView,templateFidelitySummary} from './ppt/project-view.mjs';
import {pruneEmptySelectedPages,contentDistribution,inspectSkeletonOwnership,compileSkeleton,parseOutlineJson,userRequirements,candidateRecord,promptTelemetry,fragmentTitle,outlineError} from './ppt-outline-protocol.mjs';
import {pptModelJobs,PPT_BYOK_CAPABILITIES} from './ppt-model-jobs.mjs';
import {preserveCopyRepairFrame,validateSourceRewriteWithReflow} from './ppt-repair-routing.mjs';
import {assertCandidateScope} from './ppt/input-scope-service.mjs';
import {automaticPages,densityProfile} from './ppt-density-profile.mjs';
import {candidateFit,packOutline,inspectDensityOutline,revalidateOutlineFits} from './ppt-density-packing.mjs';
import {sourceComponentParts,fitComponents,INCH,contentCanvas} from './ppt-density-capacity.mjs';
import {bindSourceArtifacts,bindSourceMedia,isSourceOwnedNode} from './ppt-source-artifacts.mjs';
import {applyLayoutPicture} from './ppt-layout-pictures.mjs';
import {applyContentSlotPictures} from './ppt-content-slot-pictures.mjs';
import {applyFillPictures,figureSlotDraft,figureSlotPlan} from './ppt-template-fill-bind.mjs';
import {acceptExportVerification,blockExportVerification,publishedRenderCurrent,publishedPdfIdentity} from './ppt-export-integrity.mjs';
import {templateLimits} from './ppt-template-security.mjs';
import {importEditablePptx as importTemplateIR} from './ppt/import-pptx.mjs';
import {markPptTime} from './ppt-trace.mjs';
import {normalizeGenerationPolicy,defaultGenerationPolicy,requestedPageCount,PPT_PROMPT_CONTRACT_VERSION} from './ppt-generation-policy.mjs';
import {outlineConcisionMetrics,routeTranslationsToNotes} from './ppt-outline-concision.mjs';
import {pageLoad} from './ppt-outline-condense.mjs';
import {compileOutlineCandidate,summarizeOutlineCorrections} from './ppt-outline-compile.mjs';
import {syncPresentationPolicy} from './ppt-presentation-policy.mjs';
import {normalizePageContract} from './ppt-page-contract.mjs';
import {runRoutine} from './routine-runner.mjs';
import {boundWriterResponseSchema,writerSourceEvidenceIds,promptPolicy,writingGuide,normalizeKeyPoints,canonicalWriterOutput,sourcePacket,slideSemanticContext,writerPrompt,writerRepairPrompt,writerCorrectionContext} from './ppt-prompt-contracts.mjs';
import {renderPptx} from './ppt/exporters/pptx.mjs';
import {renderPdf} from './ppt/exporters/pdf.mjs';
import {extractFile,normalizePaste,validateFile,sha256,mergeSourceMedia,pasteAsFileInput} from './ppt-source.mjs';
import {PPT_TEMPLATE_ANALYSIS_VERSION,BUILT_INS,templateFor,validateTemplate,analyzeTemplate,snapshotTemplate} from './ppt-template.mjs';
import {normalizeBlocks,normalizeSourceImages} from './ppt-blocks.mjs';
import {applyLayoutRegistry,chooseLayout,LAYOUTS} from './ppt-layout.mjs';
import {boundedAll,dagNodeId,nodeRecord} from './ppt-dag.mjs';
import {deterministicReview,finalQualityReport,inspectMedia,inspectSourceForSlide,reviewWithContractRepair,repairProject,keepReviewAfterUnavailable} from './ppt-quality.mjs';
import {confirmReviewFindings} from './ppt/review-findings-confirmation.mjs';
import {confirmNegativeClaimAudits,claimConfirmationResponseSchema} from './ppt/claim-audit-confirmation.mjs';
import {ensureDeckV3,ensureProjectV3,newId as newIrId,stableId} from './ppt/ir.mjs';
import {buildRenderTree} from './ppt/render-tree.mjs';
import {emitRunProgress,completeRun,recoverRun,startRun,transitionNode,cancelRun} from './ppt/run-service.mjs';
import {moveLongTablesToAppendix,oneRowTablesOff} from './ppt-table-appendix.mjs';
import {runCardPostProcess,runAssessCandidate} from './ppt-outline-worker.mjs';
import {updateDraft,clearDraft,draftsFor} from './ppt/draft-store.mjs';
import {getProject as getStructuredProject,saveProject as saveStructuredProject,saveRevision,enqueueProject,readRevision,recoverCommit} from './ppt/repository.mjs';
import {editingState,generationEpoch,contentEditResult,recoverContentEdits,processGenerationEdits,recoverGenerationEdits} from './ppt/generation-edit-service.mjs';
import {templatePreview} from './ppt/template-preview-service.mjs';
import {editableCapabilities,templateCapabilities} from './ppt/edit-context.mjs';
import {checkTemplatePictures} from './ppt-template-picture-check.mjs';
import {_internals as commandInternals,applyCommand} from './ppt/command-service.mjs';
import {normalizeCommand} from './ppt/command-schema.mjs';
import {handleStructuredPpt} from './ppt/api.mjs';
import {importEditablePptx,renderImportedPptx} from './ppt/import-pptx.mjs';
import {enrichAssetRefs} from './ppt/assets.mjs';
import {withSemanticIndex} from './ppt-semantic.mjs';
import {missingRequiredEvidence} from './ppt-evidence.mjs';
import {sourceBackedDetails,buildPlanning,estimatePageRecommendation,inspectLongDeckOutline,normalizeFactSynthesis,refreshPlanning,retrieveSlideSources,scopeRetrievalToSources,estimationSource} from './ppt-planning.mjs';
import {planSparseInput,profilePptInput} from './ppt-content-depth.mjs';
import {compileSectionLabel,formatUserDeckTitle,inspectSlideCopy,materializeCopy} from './ppt-presentation-writing.mjs';
import {normalizeTopicTitle,closingTopic,keepCardContinuation} from './ppt-topic-language.mjs';
import {prepareTopicTitleProjection} from './ppt-topic-title-projection.mjs';
import {moveCardPageFrame,inspectNativeCoverTitle,inspectNativeOutlineTitles,prepareTemplateFidelity,repairNativePageAssignment,rescheduleTemplateFidelity,templateSlotPrompt,inspectTemplateSlotDraft,autoTemplateMediaOmissions,bindTemplateFidelity,renderTemplatePptx} from './ppt-template-fidelity.mjs';
import {templateReuseError} from './ppt-template-scheduler.mjs';
import {inspectReportOutline} from './ppt-report-qa.mjs';
import {reorderManual,sortManual} from './ppt-manual-order.mjs';
import {runtimeState,checkpoint,updateSlidePreview,finishPause,reconcileCheckpoint,acquireGenerationLease} from './ppt/runtime.mjs';
import {synchronizePlan,bindReview,reviewIsCurrent,semanticReviewKey,invalidateReviews} from './ppt/versioning.mjs';
import {effectiveConstraints} from './ppt/mutation-router.mjs';
import {digest} from './ppt/edit-context.mjs';
import {transformGeneratedSlide} from './ppt/generation-edit-service.mjs';
import * as store from './ppt-store.mjs';
// The project list reads this summary from each project's sidecar (ppt-store).
store.registerListProjection('task-summary-v1',taskSummary);
import * as orch from './orchestrator.mjs';
import * as files from './files.mjs';

const running = new Set();
const editing = new Set();
const pageReassessments = new Set();
const MAX_PROMPT = 80000;
const MAX_TEXT = 160;
const PPT_NODE_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.PPT_NODE_CONCURRENCY) || 3));
// Outline calls use every provider slot (2026-10-31); pages keep the node limit.
const PPT_OUTLINE_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.PPT_OUTLINE_CONCURRENCY) || 4));
// A card outline without a requested count: every topic gets its measured need.
// Card pages continued during one deck's generation (each split is code, no model call).
const CARD_CONTINUATIONS = 8;
const planningRequests=new Set();
const PPT_RE = /^\/ppt\/projects(?:\/([a-f0-9]{32}))?(?:\/(outline|planning|requirements|generate|retry|export|pdf|source|duplicate|trash|restore|permanent|versions|rewrite|blank|media-exclusions|source-warnings|page-policy|execution|execution-policy|conversation|source-assets|component-copy|task-record|cover|discard|table-representation))?$/i;
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
/** A code-placed card page is checked for numbers the moment it is built
 * (Fable F3, 2026-11-01: a KPI tile showed "2,000,000" without its words and
 * the publish gate, the first check, blocked the deck). On a failure the page
 * is rebuilt as plain points, the points' own words; a point still failing
 * goes to the speaker notes and the page is flagged (numericNotes). */
function numberGuard(project,slide,index,page){
 // Only the card's own points count: a title (its counter, its words) is the
 // gate's page flag, never a reason to rebuild or move points (live
 // Mood-Board, 2026-11-02: an unverified "· 1/2" counter turned score tiles
 // into plain text and moved every point holding the digit 2 to the notes).
 const failing=()=>{const points=new Set((slide.nodes||[]).filter(node=>node.content?.derivedFrom==='card-page').map(node=>node.id));
  return inspectSourceNumbers({...project,deck:{...project.deck,slides:(project.deck?.slides||[]).map(item=>item?.id===slide.id?slide:item)}},[slide]).filter(issue=>issue.code==='source_number_unsupported').flatMap(issue=>issue.numericFindings||[]).filter(item=>points.has(item.nodeId)&&item.reason!=='attribution_unverified');};
 let findings=failing();if(!findings.length)return;
 if(page.cardShapeOverride!=='points'){page.cardShapeOverride='points';bindThemeCardPage(project,slide,index,page);mirrorPlanned(project,page);findings=failing();if(!findings.length)return;}
 // A point moves by the whole number ("2" is not in "422,368").
 const values=[...new Set(findings.map(item=>item.raw))];
 const whole=value=>new RegExp(`(?<![\\d.,])${value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')}(?![\\d]|[.,]\\d)`,'u');
 const moved=(page.keyPoints||[]).filter(point=>values.some(value=>whole(value).test(String(point.text||''))));
 // A page whose every point fails keeps its points (an empty page says less)
 // and is flagged by name.
 if(!moved.length)return;
 if(moved.length===(page.keyPoints||[]).length){page.numericNotes=findings.map(item=>({value:item.raw,reason:item.reason,kept:true}));mirrorPlanned(project,page);return;}
 page.keyPoints=page.keyPoints.filter(point=>!moved.includes(point));
 page.notePoints=[...(page.notePoints||[]),...moved];
 // The slide keeps them too: generation binds a copy of the outline, and only
 // the slide is saved (3197 85a2621c p5: a moved point reached neither slide nor notes).
 slide.guardNotePoints=[...(slide.guardNotePoints||[]),...moved.map(point=>({text:String(point.label?`${point.label}：${point.text}`:point.text),sourceUnitIds:point.sourceUnitIds||[]}))];
 // The ledger names each moved point, its node and the number (Fable 2026-11-02).
 page.numericNotes=findings.map(item=>({value:item.raw,reason:item.reason,nodeId:item.nodeId,point:String(moved.find(point=>whole(item.raw).test(String(point.text||'')))?.text||'').slice(0,160)}));
 bindThemeCardPage(project,slide,index,page);
 mirrorPlanned(project,page);
}
// The card plan keeps what the guard changed: the exported notes read it.
function mirrorPlanned(project,page){
 const planned=project.planningContract?.cardOutline?.raw?.slides?.find(item=>item.id===page.id);
 if(planned)Object.assign(planned,{keyPoints:page.keyPoints,...(page.cardShapeOverride?{cardShapeOverride:page.cardShapeOverride}:{}),...(page.notePoints?{notePoints:page.notePoints}:{}),...(page.numericNotes?{numericNotes:page.numericNotes}:{})});
}
function normalizeOutline(value, count, source, update = null, deckTitle = null,topicLanguage=null,{keepContinuation=false}={}) {
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
    const generatedTitle = bounded(keepCardContinuation(keepContinuation,s.title,normalizeTopicTitle(s.title,topicLanguage)), MAX_TEXT, `slide ${index + 1} title`);
    const title = index === 0 && deckTitle?.source === 'user' && deckTitle?.text ? deckTitle.text : generatedTitle;
    const focus = bounded(s.focus || s.summary || s.title, 360, `slide ${index + 1} focus`);
    const oldFocus = update?.baseSnapshot.outline?.find(slide => slide.id === baseSlideId)?.focus;
    if (change === 'keep' && (title !== base.title || (oldFocus && focus !== oldFocus))) change = 'rewrite';
    const children = Array.isArray(s.children) ? s.children.slice(0, 12).map((child, childIndex) => ({
      id: typeof child?.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(child.id) ? child.id : newIrId('item'),
      title: bounded(normalizeTopicTitle(child?.title || `子章节 ${childIndex + 1}`,topicLanguage), MAX_TEXT, `slide ${index + 1} child title`),
      description: bounded(child?.description || child?.title || '', 360, `slide ${index + 1} child description`, false),
    })) : [];
    const keyPoints = normalizeKeyPoints(s.keyPoints || s.key_points, source);
    let section = compileSectionLabel(bounded(normalizeTopicTitle(s.section || s.title,topicLanguage), MAX_TEXT, `slide ${index + 1} section`));
    // A card page's section label differs from its title once both are
    // normalized; else a cited source heading, deepest first, that does
    // (3143, 058cd50b pages 7-8: "4. Data Fields for Mining | 挖掘用数据字段"
    // and "Candidate Generation: ..." both became the title).
    const labelKey = value => String(value || '').replace(/^[\d.\s]+/u, '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    // A frame page's label is set by code (the takeaway's "Takeaway | 小结").
    if (Array.isArray(s.cardObjects) && index > 0 && !s.cardFrame && labelKey(section) === labelKey(title)) {
      const units = new Map((source?.semantic?.inventory?.items || []).map(item => [item.id, item]));
      // The part labels of an update source (旧版 / 最新进展) are internal, never an eyebrow.
      const headings = (s.sourceUnitIds || []).flatMap(id => [...(units.get(id)?.sectionPath || [])].reverse()).filter(heading => typeof heading === 'string' && heading.trim() && heading.length <= MAX_TEXT && !['旧版', '最新进展'].includes(heading.trim()));
      section = headings.map(heading => compileSectionLabel(normalizeTopicTitle(heading.trim(), topicLanguage))).find(label => label && labelKey(label) !== labelKey(title)) || section;
    }
    return { id: typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s.id) ? s.id : newIrId('slide'), title,...(s.titlePair?{titlePair:s.titlePair,titleSecondary:s.titleSecondary}:{}),
      focus, description: bounded(s.description && s.description !== focus ? s.description : '', 360, `slide ${index + 1} description`, false), children,
      section,
      // A figure page cites its figures' own pages (live JEPA on Professional-
      // Portfolio, 2026-11-01: figure pages read as content without a source).
      refs: [...new Set([...(Array.isArray(s.refs) ? s.refs.map(String) : []), ...keyPoints.flatMap(point => point.refs),
        ...(s.figurePage===true&&Array.isArray(s.sourceImageIds)?s.sourceImageIds.flatMap(id=>(source?.images?.find(image=>image.id===id)?.sourceRefs||[]).map(String)):[])])].filter(ref => validRefs.has(ref)),
      ...((Array.isArray(s.chunkRefs) || keyPoints.some(point => point.chunkRefs.length)) ? { chunkRefs: [...new Set([...(Array.isArray(s.chunkRefs) ? s.chunkRefs.map(String) : []), ...keyPoints.flatMap(point => point.chunkRefs)])].filter(ref => validChunkRefs.has(ref)) } : {}),
      ...(s.planningProtocolVersion===2?{planningProtocolVersion:2}:{}),
      ...(s.userLocked===true?{userLocked:true}:{}),
      ...(index===0&&typeof s.coverSourceTitle==='string'&&s.coverSourceTitle?{coverSourceTitle:s.coverSourceTitle.slice(0,160)}:{}),
      ...(index===0&&typeof s.coverTranslation==='string'&&s.coverTranslation?{coverTranslation:s.coverTranslation.slice(0,160)}:{}),
      ...(index===0&&s.coverSummarized===true?{coverSummarized:true}:{}),
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
      ...(s.cardFigureLayout===true?{cardFigureLayout:true}:{}),
      ...(s.pairedFigurePage===true?{pairedFigurePage:true}:{}),
      ...(s.inlineFigureFallback===true?{inlineFigureFallback:true}:{}),
      // The shape the deck's variety budget or number guard chose, and the guard's notes (Fable M3/F3).
      ...(['points','steps','grid','compare','kpi'].includes(s.cardShapeOverride)?{cardShapeOverride:s.cardShapeOverride,...(s.cardShapeReason==='variety_budget'?{cardShapeReason:'variety_budget'}:{})}:{}),
      ...(Array.isArray(s.numericNotes)?{numericNotes:s.numericNotes.slice(0,24)}:{}),
      ...(Array.isArray(s.cardIcons)&&s.cardIcons.every(name=>typeof name==='string')?{cardIcons:s.cardIcons.slice(0,6)}:{}),
      ...(Array.isArray(s.notePoints)?{notePoints:s.notePoints}:{}),
      // A card's lead sentence under its title (the hand deck, Fable G4).
      ...(typeof s.lead==='string'&&s.lead.trim()?{lead:s.lead.replace(/\s+/gu,' ').trim().slice(0,200)}:{}),
      // The template page a card fills, and the blocks the binding writes there (fill-template-first, 2026-11-03).
      ...(s.templateFill&&typeof s.templateFill==='object'&&['filled','fill_fallback'].includes(s.templateFill.status)?{templateFill:{page:Number.isInteger(s.templateFill.page)?s.templateFill.page:null,profileId:typeof s.templateFill.profileId==='string'?s.templateFill.profileId:null,kind:String(s.templateFill.kind||''),blocks:Number(s.templateFill.blocks)||0,figures:Number(s.templateFill.figures)||0,citedFigures:Number(s.templateFill.citedFigures)||0,sticky:s.templateFill.sticky===true,status:s.templateFill.status,...(typeof s.templateFill.reason==='string'?{reason:s.templateFill.reason.slice(0,60)}:{}),...(s.templateFill.segment&&typeof s.templateFill.segment==='object'?{segment:s.templateFill.segment}:{})}}:{}),
      ...(Array.isArray(s.fillBlocks)?{fillBlocks:s.fillBlocks.filter(block=>block&&typeof block.body==='string').map(block=>({heading:String(block.heading||'').slice(0,200),body:String(block.body).slice(0,600)})).slice(0,8)}:{}),
      ...(typeof s.fillLead==='string'&&s.fillLead.trim()?{fillLead:s.fillLead.trim().slice(0,300)}:{}),
      ...(s.fallbackEmpty===true?{fallbackEmpty:true}:{}),
      ...(typeof s.fillSummary==='string'&&s.fillSummary.trim()?{fillSummary:s.fillSummary.trim().slice(0,300)}:{}),
      ...(s.tableTextNotes===true?{tableTextNotes:true}:{}),
      // A figure page (F2): its figures and captions only, placed by code.
      ...(s.figurePage===true ? {figurePage:true,...(typeof s.restoredFrom==='string'?{restoredFrom:s.restoredFrom.slice(0,80)}:{}),...(['no_points','space','titles'].includes(s.figureOnlyReason)?{figureOnlyReason:s.figureOnlyReason,...(s.figureOnlyDetail&&typeof s.figureOnlyDetail==='object'?{figureOnlyDetail:s.figureOnlyDetail}:{})}:{}),...(Number.isInteger(s.titleRepeat)&&s.titleRepeat>1&&s.titleRepeat<100?{titleRepeat:s.titleRepeat}:{})} : {}),
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
      ...(s.numberedPoints === true ? { numberedPoints: true } : {}),
      ...(['divider','takeaway'].includes(s.cardFrame) ? { cardFrame: s.cardFrame } : {}),
      ...(s.authorEdited === true ? { authorEdited: true } : {}),
      ...(Array.isArray(s.cardObjects) ? { cardObjects: s.cardObjects.filter(objectId => typeof objectId === 'string').slice(0, 20) } : {}),
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
function contentPrompt(p, slide, index) {
  const contract = p.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
  const constraints = effectiveConstraints(p, slide.id);
  const edits = constraints.length ? constraints.filter(item => ['content', 'title'].includes(item.type)).map(item => item.instruction) : p.editing?.instructions?.[slide.id] || [];
  return writerPrompt(p, slide, index, { retrieval: writerRetrieval(p, slide, contract), contract, slotContract: templateSlotPrompt(p, index), edits });
}
/** An owned-scope page is reviewed against its own sources only, so its writer
 * gets no other page's facts as context (they produced unsupported claims). */
function writerRetrieval(p, slide, contract) {
  const retrieval = retrieveSlideSources(p, slide, contract);
  if ((contract.pageContract || slide.pageContract)?.sourceScope !== 'owned') return retrieval;
  const owned = [...new Set([...(slide.sourceUnitIds || []), ...(slide.sourceArtifactRanges || []).map(ref => ref.sourceUnitId), ...(contract.sourceArtifacts || []).map(ref => ref.sourceUnitId)].filter(Boolean))];
  return scopeRetrievalToSources(p, retrieval, [...owned, ...claimSupportSourceIds(p, owned), ...closingEvidenceSourceIds(p, slide.id)]);
}
function contentRepairPrompt(p, slide, index, draft, issues) {
  const necessary=hasFrozenSourceArtifacts(draft)&&p.generationPolicy?.content==='overview'&&(issues.some(f=>f.category==='missing')||hasNecessaryExplanationRepair(p,slide.id));
  const supportIds=necessary?claimSupportSourceIds(p,slide.sourceUnitIds||[]):[];
  const support=(p.originalSourceInventory?.items||p.source?.semantic?.inventory?.items||[]).filter(i=>supportIds.includes(i.id)).map(i=>({sourceUnitId:i.id,text:i.text}));
  return writerRepairPrompt(contentPrompt(p, slide, index), draft, issues)+(necessary?'\n<necessary_explanation_repair>sourceCommentary must retain the necessary supported mechanism. Rewrite only the unsupported clause in a mixed paragraph; do not erase its supported causal explanation or return empty commentary. For conceptual formulas, explain the operators and their modelling meaning without asserting measured speed, unpublished implementation or execution order not stated in source. Write ordinary plain prose: no Markdown emphasis, dollar-delimited formulas or raw LaTeX in explanation; the original formula objects already exist. Keep all frozen source objects, uncertainty and conditions. Capacity and semantic validators remain authoritative.</necessary_explanation_repair>':'')+(support.length?'\n<missing_mechanism_support>'+JSON.stringify(support)+'</missing_mechanism_support> These immutable same-chunk notes may support the necessary missing relationship. Repair sourceCommentary with a concise complete explanation, preserving uncertainty and conditions. Do not return empty commentary, repeat the frozen objects, change sourceArtifacts or promote these note IDs to primary ownership. The ordinary capacity and semantic validators still decide acceptance.':'');
}
function readExecutionPolicy(value){try{return normalizeExecutionPolicy(value);}catch(error){throw new HttpError(400,error.message);}}
async function modelCallTransport(p, prompt, activity, log, options = {}) {
  if(p.sourceVisualAnalysis?.items?.length&&!String(options.nodeKey||'').startsWith('vision:'))prompt+='\n<derived_visual_observations>Unverified visual interpretations for image selection, not numerical source facts: '+JSON.stringify(p.sourceVisualAnalysis.items)+'</derived_visual_observations>';

  const sid = options.nodeKey ? sha256(Buffer.from(`${p.id}:${options.nodeKey}`)).slice(0, 32) : p.id;
  const canStart = () => { const latest = store.getProjected(p.uid,p.id,'model-availability-v1',project=>({status:project.status,deletedAt:project.deletedAt,runtime:{pauseRequested:project.runtime?.pauseRequested}})); return Boolean(latest && !latest.deletedAt && latest.status !== 'cancelled' && (!(options.nodeKey || '').startsWith('content:') && !(options.nodeKey || '').startsWith('review:deck') || (latest.status !== 'paused' && !latest.runtime?.pauseRequested))); };
  const writerSlide=p.outline?.find(slide=>options.nodeKey===`content:${slide.id}`||String(options.nodeKey||'').startsWith(`content:${slide.id}:`));
  const writerEpoch=writerSlide?generationEpoch(p,writerSlide.id):null,writerRun=p.currentRunId,writerBaseRevision=p.revision,writerLease=componentLeaseToken(p);
  const queuedProgressRefs=new Set();let committedProgressRefs='';
  const onProgress=writerSlide?progress=>{
    const latest=store.getProjected(p.uid,p.id,'writer-draft-state-v1',project=>({id:project.id,uid:project.uid,status:project.status,deletedAt:project.deletedAt,currentRunId:project.currentRunId,editing:{epochs:project.editing?.epochs},source:{sha256:project.source?.sha256,semantic:{inventory:project.source?.semantic?.inventory}},planning:{slidePlan:project.planning?.slidePlan}}));
    if(!latest||latest.deletedAt||latest.status!=='generating'||latest.currentRunId!==writerRun||generationEpoch(latest,writerSlide.id)!==writerEpoch)return;
    const draft=updateDraft(latest,writerSlide.id,{...progress,runId:writerRun,epoch:writerEpoch,sourceHash:p.source?.sha256||''});
    const refs=draft?.blocks?.map(block=>block.sourceRef).filter(Boolean)||[];
    const refsKey=JSON.stringify(refs);
    // Partial JSON tokens can report the same closed source references many
    // times. Re-commit only when the set changes, retaining full authoritative
    // lease/revision/source checks inside the project transaction.
    if(refs.length&&refsKey!==committedProgressRefs&&!queuedProgressRefs.has(refsKey)){queuedProgressRefs.add(refsKey);void enqueueProject(p.uid,p.id,()=>{
      const current=store.get(p.uid,p.id);if(!current)return;
      const result=commitSourceComponents(current,{slideId:writerSlide.id,runId:writerRun,epoch:writerEpoch,baseRevision:writerBaseRevision,sourceHash:p.source?.sha256||'',lease:writerLease,refs});
      if(['committed','unchanged'].includes(result.status))committedProgressRefs=refsKey;
      if(result.status==='committed'){store.save(current);emitRunProgress(current,'slide.component_commit',result.commit);}
    }).catch(error=>log?.warn?.('PPT component commit failed: '+String(error.message).slice(0,200))).finally(()=>queuedProgressRefs.delete(refsKey));}
  }:options.onProgress;
  const selectionBudget=allowsEditorialSelection(p)&&String(options.nodeKey||p.stage).startsWith('outline')
    ?((p.originalSourceInventory?.items||p.source?.semantic?.inventory?.items||[]).length*96+Number(p.pages||3)*128>16384?32768:16384):undefined;
  // Providers that ignore response_format get the schema in the prompt once
  // they have been seen to miss required fields (see ppt-contract-call.mjs).
  const responseSchema=modelResponseSchema(prompt,options);
  if(responseSchema&&schemaUnreliable(schemaReliabilityKey(p))&&!prompt.includes('<required_json_schema>'))prompt+=schemaPromptBlock(responseSchema);
  if (pptModelJobs.eligible(p.configId)) return settleReply(p,responseSchema,noteSchemaCompliance(p,responseSchema,parseModelJson(await pptModelJobs.request(p, prompt, canStart, {stage:options.nodeKey||p.stage,...(options.images?{images:options.images}:{}),...(p.executionTask?{role:p.executionTask.role,thinkingMode:p.executionTask.thinkingMode,maxWireAttempts:p.executionTask.maxWireAttempts}:{}),...(onProgress?{onProgress}:{}), ...promptTelemetry(prompt),maxOutputTokens:options.maxOutputTokens??selectionBudget,jsonSchema:responseSchema,onTelemetry:telemetry=>{options.onTelemetry?.(telemetry);const latest=store.get(p.uid,p.id);if(latest){latest.modelUsage=[...(latest.modelUsage||[]).slice(-199),{stage:options.nodeKey||p.stage,model:p.model,...promptTelemetry(prompt),telemetry}];store.save(latest);}}})),log),log);
  try {
    const result = await runRoutine({ sid, uid: p.uid, kind: orch.KIND_PPT, prompt, model: p.model, configId: p.configId, activity, log,
      canStart, ...(onProgress ? { onProgress } : {}), images:options.images,maxWireAttempts:p.executionTask?.maxWireAttempts,maxOutputTokens:options.maxOutputTokens });
    options.onTelemetry?.({wireAttempts:result.wireAttempts||1,inputTokens:result.usage?.input_tokens,outputTokens:result.usage?.output_tokens});
    if (!result.ok) throw Object.assign(new Error(result.error || `模型任务失败：${result.status}`),{code:result.status==='credential_error'?'auth':result.status==='attempt_limit'?'execution_attempt_limit':'transport'});
    return settleReply(p,responseSchema,noteSchemaCompliance(p,responseSchema,parseModelJson(result.resultText),log),log);
  } finally {
    if (sid !== p.id) await orch.removeContainer(sid, { keepVolume: false }).catch(() => {});
  }
}
function noteSchemaCompliance(p,schema,value,log){
  const {missing}=topLevelShape(schema,value);
  if(missing.length&&markSchemaUnreliable(schemaReliabilityKey(p),{missing:missing.slice(0,8)})&&typeof log==='function')log(`ppt ${p.id} model ${p.model} ignored the JSON schema (missing ${missing.slice(0,5).join(', ')}); later prompts embed the schema`);
  return value;
}
/** Phase 4: what carries no meaning (a repeated ID, an enum in whitespace, an
 * over-long planning reason) is settled before any stage validator sees it. */
function settleReply(p,schema,value,log){
  if(!schema)return value;
  const {value:settled,notes}=normalizeReply(value,schema);
  if(notes.length&&typeof log==='function')log(`ppt ${p.id} settled reply: ${notes.slice(0,5).map(note=>note.code+'@'+note.path).join(', ')}`);
  return settled;
}
function modelResponseSchema(prompt,options){return options.jsonSchema||findingConfirmationResponseSchema(prompt)||claimConfirmationResponseSchema(prompt)||writerDeltaResponseSchema(prompt)||boundWriterResponseSchema(prompt)||reviewResponseSchema(prompt);}
async function modelCall(p, prompt, activity, log, options = {}) {
  // A route override names its model explicitly.
  const override=options.routeOverride;
  if (!p.executionPolicy || p.executionPolicy.legacy) return modelCallTransport(override?{...p,configId:override.configId,model:override.model}:p,prompt,activity,log,options);
  const stage=String(options.nodeKey||p.stage),complexity=taskComplexity(p,stage,prompt),role=taskRole(stage,complexity);
  const contractRepair=stage.startsWith('content:')&&(/:contract-repair(?::|$)/u.test(stage)||/<(?:writer_local_repair|writer_contract_error)>/u.test(prompt));
  const formatCorrection=contractRepair||/:contract(?::\d+)?$/u.test(stage);
  // Logical task accounting spans local repair prompts and transport fallbacks.
  const logicalStage=stage.startsWith('content:')?stage.split(':').slice(0,2).join(':'):stage.replace(/:(?:retry|repair|delta-repair|source-witness|contract)(?::\d+)?$/u,'');
  const taskKey=taskFingerprint(p,logicalStage,''),inputHash=taskFingerprint(p,stage,prompt);
  let transientRetries=0;
  for (;;) {
    let record,route;
    await enqueueProject(p.uid,p.id,()=>{
      const latest=store.get(p.uid,p.id);if(!latest||latest.deletedAt||latest.status==='cancelled')throw outlineError('cancelled');
      const prior=(latest.executionHistory||[]).filter(row=>row.taskKey===taskKey);
      const repairStage=value=>value.startsWith('content:')&&/:(?:contract-repair|repair|postwriter|critic)(?::|$)/u.test(value);
      // Format corrections belong to their existing semantic repair round.
      // All wire calls still consume the shared five-attempt reservation.
      const qualityRepairs=prior.filter(row=>repairStage(row.stage||'')&&row.routingReason?.repairKind!=='contract'&&!/:contract-repair(?::|$)/u.test(row.stage||'')&&(row.status==='completed'||row.status==='failed'&&!['transport','network','rate_limit','model_unavailable','timeout'].includes(row.errorCode)));
      if(!contractRepair&&repairStage(stage)&&qualityRepairs.length>=(latest.executionPolicy.maxQualityRepairs??2))throw Object.assign(new Error('Quality repair budget reached for this task; inspect the preserved candidate before retrying'),{code:'execution_repair_limit'});
      const semanticAttempts=prior.filter(row=>row.routingReason?.repairKind!=='contract'&&!/:contract-repair(?::|$)/u.test(row.stage||'')&&(row.status==='completed'||row.status==='failed'&&!['transport','network','rate_limit','model_unavailable','timeout'].includes(row.errorCode))).length;
      route=override?{configId:override.configId,model:override.model,...(override.thinkingControl?{thinkingControl:true}:{}),...(override.maxOutputTokens?{maxOutputTokens:override.maxOutputTokens}:{}),role,qualityLevel:latest.executionPolicy?.qualityLevel||'legacy_single_model',complexity}:resolveTaskRoute(latest,role,complexity,contractRepair?0:semanticAttempts);
      record=reserveModelAttempt(latest,taskKey,route,prompt,Math.min(options.maxOutputTokens||32768,route.maxOutputTokens||32768),{images:options.images,schemaBytes:Buffer.byteLength(JSON.stringify(modelResponseSchema(prompt,options)||{}),'utf8')});
      record.stage=stage;record.cacheKey=inputHash;record.slideIds=complexity.slideIds;record.schemaVersion='ppt-model-contract-v1';record.routingReason={role,selectedRole:route.role,complexity,previousAttempts:prior.length,previousSemanticAttempts:semanticAttempts,repairKind:formatCorrection?'contract':repairStage(stage)?'semantic':undefined};const ownedSlide=latest.outline?.find(slide=>complexity.slideIds.includes(slide.id));record.contract={sourceRefs:ownedSlide?.sourceUnitIds||[],requiredFacts:ownedSlide?.requiredDetails||[],requiredAssetIds:ownedSlide?.sourceImageIds||[],languageContract:latest.generationPolicy?.language,layoutBudget:{pages:latest.pages,template:latest.template,fonts:latest.templateSpec?.fonts},sourceHash:latest.source?.sha256,outlineHash:latest.confirmedOutline?.hash,generationPolicy:latest.generationPolicy,userLocks:latest.userLocks||null,templateHash:latest.templateFidelity?.sha256||latest.template,baseRevision:latest.revision};
      record.thinkingMode=thinkingModeForRoute(route,complexity,{contractRepair});
      store.save(latest);
    });
    let telemetry;
    const finish=async(status,result,error)=>enqueueProject(p.uid,p.id,()=>{
      const latest=store.get(p.uid,p.id);if(!latest)return;
      const row=latest.executionHistory?.find(item=>item.id===record.id);if(!row)return;
      Object.assign(row,{status,completedAt:new Date().toISOString(),elapsedMs:Date.now()-Date.parse(row.startedAt),...(telemetry||{}),...(error?{errorCode:error.code||'transport'}:{}),...(result?{outputHash:sha256(Buffer.from(JSON.stringify(result)))}:{})});
      store.save(latest);
    });
    try {
      const thinkingMode=record.thinkingMode;
      const result=await modelCallTransport({...p,...route,executionTask:{role:route.role,thinkingMode,maxWireAttempts:record.wireRemaining}},prompt,activity,log,{...options,maxOutputTokens:record.outputReservation,onTelemetry:value=>{telemetry=value;}});
      await finish('completed',result);return result;
    } catch(error) {
      await finish('failed',null,error);
      if (!['rate_limit','network','transport','model_unavailable'].includes(error.code)||transientRetries++>=2)throw error;
      await new Promise(resolve=>setTimeout(resolve,Math.max(telemetry?.retryAfterMs||0,Math.min(4000,500*2**transientRetries))));
    }
  }
}
const defaultDeps = { modelCall, renderPptx: project => project.templateFidelity?.mode === 'preserve' ? renderTemplatePptx(project) : renderPptx(project),
  prepareTemplateFidelity, importTemplateIR, renderPdf, extractFile, analyzeTemplate, readFile: files.readFile, removeContainer: orch.removeContainer };
/** Master/layout text and pictures, listed on the first page that uses them so
 * a user can keep an inherited footer or logo (design-only reuse clears them;
 * report 84f9e527). */
function inheritedObjectRows(imported){
  const slides=imported?.deck?.slides||[];
  // A colour layer is the layout's background, not an object to keep or clear.
  return (imported?.externalPptx?.inherited||[]).filter(item=>item.kind!=='fill').flatMap(item=>{
    const page=slides.findIndex(slide=>slide.nativeLayout&&slide.nativeLayout.masterIndex===item.masterIndex&&(item.scope==='master'||slide.nativeLayout.layoutIndex===item.layoutIndex));
    return page<0?[]:[{id:item.key,page:page+1,kind:item.kind,geometry:{x:item.x,y:item.y,width:item.width,height:item.height},name:item.name||item.placeholder||item.key,text:String(item.text||'').slice(0,240),brand:false,inherited:true,...(item.href?{href:String(item.href).slice(0,300)}:{})}];
  });
}
function sourceBindingProject(project,slide,index){
  return {...project,deck:{...(project.deck||{}),slides:project.outline.map((entry,i)=>i===index?{...slide,layoutId:chooseLayout(slide,i,project.outline.length)}:project.deck?.slides?.[i]||entry)}};
}
/** A built-in template's card page placed by code: its reviewed points, each
 * label a heading (the user, 2026-11-01). Null when the points and the card's
 * figures do not fit one page together: the writer condenses that page
 * (live 2026-11-01, world_models and the CodePilot PDF on Blue). */
function builtinCardPage(project,slide,previousTitles){
  try{
    const content=normalizeSlide(builtinCardDraft(slide),slide,project,previousTitles);
    content.cardPage={mode:'points'};content.programGenerated={role:'card-page',basis:'reviewed card points placed by code on a built-in layout; no writer call'};
    return content;
  }catch(error){if(/^source_media_capacity/u.test(String(error?.message)))return null;throw error;}
}
/** @param {Record<string, any> | null} [project] */
function normalizeSlide(value, outlineSlide, project = null, previousTitles = []) {
  const index = project?.outline?.findIndex(item => item.id === outlineSlide.id) ?? -1;
  // A card deck's cover is written by code (title, label, subtitle lines from the H1).
  const nativeTopicCover=index===0&&!value?.cardPage&&project?.templateFidelity?.mode==='preserve'&&outlineSlide.planningProtocolVersion===2&&project.generationPolicy?.knowledge==='source_only'&&!(outlineSlide.sourceUnitIds||[]).length;
  if(nativeTopicCover){
    const slots=project.templateFidelity.slides[index]?.slots||[],body=slots.filter(slot=>slot.role==='content');
    if(value?.sourceCommentary?.length||value?.sourceArtifacts?.length||value?.sourceEvidenceIds?.length||value?.contentBlocks?.length||body.some(slot=>{const text=value?.slotTexts?.[String(slot.shapeId)];return typeof text==='string'?text.trim():Array.isArray(text)&&text.length;}))throw new Error('writer cover contract: this native topic-only cover owns no source body. Return only title/section slotTexts, empty body/source arrays, and omit the old content slots; preserve the complete facts on their assigned content pages.');
    value={...value,contentBlocks:[],omitTemplateShapes:[...(value?.omitTemplateShapes||[]),...body.map(slot=>({shapeId:slot.shapeId,reason:'Topic-only cover has no body ownership; old template content is retired without duplicating following source pages.'}))]};
  }
  // A planned card page shows its points in the planned slots only: no
  // compatibility copy is derived from them (3143, 1826ec0a page 2: a paired
  // body's text became a heading over 48 characters and the page failed its
  // schema; 1efa0344: explicit blocks filled the body list, which repeated
  // every point and blocked publish as visible_copy_duplicate).
  let cardShortened=null;
  // Option D: a writer-free card page draft (cardPageDraft) is placed as is.
  if(cardsFlow(project)&&index>0&&project.templateFidelity?.mode==='preserve'&&!value?.cardPage){
    const planned={templateSlotTexts:{...(value?.slotTexts||{})},templateOmissions:[]};
    cardShortened=applyCardSlotPlan(project,index,outlineSlide,planned);
    if(cardShortened)value={...value,slotTexts:planned.templateSlotTexts,contentBlocks:[]};
  }
  value = canonicalWriterOutput(value || {}, project?.templateFidelity?.mode === 'preserve' ? project.templateFidelity.slides[index] : null);
  if(project&&value.eyebrow)value={...value,eyebrow:diagramEyebrow(project,outlineSlide,value.eyebrow)};
  // A built-in card deck's cover eyebrow is the H1's label or nothing (2026-11-01: the writer wrote "模块", then "封面").
  if(project&&cardsFlow(project)&&index===0&&project.templateFidelity?.mode!=='preserve')value={...value,eyebrow:coverParts(displayedDocumentTitle(project)?.heading||'').label||''};
  if(outlineSlide.role==='navigation'&&!(outlineSlide.sourceUnitIds||[]).length){
    // The final approved plan owns chapter labels/ranges. A writer's unowned
    // course introduction must not replace that derived navigation object.
    value={...value,sourceCommentary:[],sourceArtifacts:[],sourceEvidenceIds:[],
      ...(project?.templateFidelity?.mode==='preserve'?{slotTexts:navigationWriterHeaders(project,outlineSlide,index)}:{})};
  }
  const frozenTitle=project?.confirmedOutline&&project.confirmedOutline.titlesFrozen!==false&&!project.editOutputLanguage&&!effectiveConstraints(project,outlineSlide.id).some(c=>c.type==='title');
  let writerCorrections=[];
  if(frozenTitle){
    const titleSlots=project.templateFidelity?.mode==='preserve'?(project.templateFidelity.slides[index]?.slots||[]).filter(slot=>slot.role==='title'):[];
    if(value.title!==outlineSlide.title||titleSlots.some(slot=>value.slotTexts?.[String(slot.shapeId)]!==outlineSlide.title)){
      writerCorrections=[{field:'title',before:value.title,after:outlineSlide.title,basis:'user_confirmed_outline; body and frozen source ownership unchanged'}];
      value={...value,title:outlineSlide.title,...(value.slotTexts?{slotTexts:{...value.slotTexts,...Object.fromEntries(titleSlots.map(slot=>[String(slot.shapeId),outlineSlide.title]))}}:{})};
    }
  }
  const visual = outlineSlide?.visualIntent?.type;
  const suggestedLayout = ({ image: 'image-text', comparison: 'comparison', pipeline: 'timeline', process: 'timeline', timeline: 'timeline', table: 'table', chart: 'chart', metric: 'big-number' })[visual];
  const compatible = suggestedLayout && (!['table', 'chart'].includes(suggestedLayout) || value?.blocks?.some(block => block.type === suggestedLayout));
  const preparedValue = { ...value, bullets: Array.isArray(value?.bullets) ? value.bullets : [] };
  const prepared = value?.layoutId || !compatible ? preparedValue : { ...preparedValue, layoutId: suggestedLayout };
  const slide = normalizeDeck({ slides: [prepared] }, [outlineSlide]).slides[0];
  const topicLanguage = pageTopicLanguage(project || {},outlineSlide);
  const compiled = materializeCopy(value || {}, outlineSlide, project?.planning, previousTitles, topicLanguage);
  if(index===0&&project?.templateFidelity?.mode!=='preserve'&&!(outlineSlide.sourceUnitIds||[]).length&&(compiled.copy.blocks.length||value?.sourceCommentary?.length||slide.blocks.length||String(value?.subtitle||'').trim()||String(value?.takeaway||'').trim()))throw new Error('writer cover contract: unowned cover body is forbidden. Return contentBlocks=[], blocks=[], sourceCommentary=[], subtitle="", takeaway=""; preserve title only. All factual source units belong to the content pages.');
  slide.title = keepCardContinuation(cardsFlow(project), outlineSlide.title, compiled.title.title || slide.title);
  slide.titleQuality = compiled.title;
  if(writerCorrections.length)slide.writerCorrections=writerCorrections;
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
  slide.section = typeof writtenSection==='string'&&writtenSection.trim()?writtenSection: outlineSlide.section;
  slide.copy = compiled.copy;
  if (index > 0 && index === project?.outline?.length - 1 && !outlineSlide.titleLocked&&!ownsClosingContent(outlineSlide)&&!slide.bullets?.length&&!slide.blocks?.length) {
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
    // A native card page's own slot sizes (Fable review r16: one type scale).
    slide.templateSlotFonts = Object.fromEntries(Object.entries(value?.slotFonts || {}).filter(([, font]) => Number(font) >= 8 && Number(font) <= 40));
    // A filled card's body slots take the sample's body style (fill-template-first).
    if (Array.isArray(value?.slotPlain) && value.slotPlain.length) slide.templateSlotPlain = value.slotPlain.map(String); else delete slide.templateSlotPlain;
    // A cover title too long for its frame grows the frame into free cover space (Fable option P, 2026-11-01).
    if (value?.coverTitleGeometry?.shapeId !== undefined) slide.templateAdaptations = [...(slide.templateAdaptations || []).filter(item => String(item.shapeId) !== String(value.coverTitleGeometry.shapeId)), { shapeId: value.coverTitleGeometry.shapeId, action: 'cover_title_grown', geometry: value.coverTitleGeometry.geometry }];
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
      (node.type === 'text' && project.templateFidelity.slides[project.outline.findIndex(item => item.id === outlineSlide.id)]?.slots.some(slot => slot.shapeId === node.nativeRef?.shapeId &&
        // A card cover leaves out a section slot that has no label of its own
        // (deterministicCoverDraft; live pdf-gph3 dropped that omission and the
        // slot showed the title again).
        (slot.role === 'content' || slot.role === 'section' && value?.cardPage?.mode === 'cover'))))
      .map(node => String(node.nativeRef.shapeId)));
    slide.templateOmissions = (Array.isArray(value?.omitTemplateShapes) ? value.omitTemplateShapes : [])
      .filter(item => item && omittable.has(String(item.shapeId)) && String(item.reason || '').trim().length >= 8)
      .slice(0, 40).map(item => ({ shapeId: Number(item.shapeId), reason: String(item.reason).trim().slice(0, 180) }));
    slide.templateOmissions.push(...autoTemplateMediaOmissions(project, project.outline.findIndex(item => item.id === outlineSlide.id), slide.templateOmissions));
    // A card page shows its card's points and no padding: a content slot the
    // writer left empty (with its paired heading or description) is omitted.
    // Found on 3143 (1a1631c4, page 8): 4 points on a layout with more slots.
    // Option 1: code places each card point in its slots (cardSlotPlan) and the
    // writer only shortened them; the plan is enforced here. Pages with objects
    // keep the writer's slots with fitted labels and empty slots left out.
    const cardIndex = project.outline.findIndex(item => item.id === outlineSlide.id);
    if (value?.cardPage) applyCardPageOmissions(project, cardIndex, slide, value);
    else if (cardsFlow(project) && cardSlotPlan(project, cardIndex, outlineSlide)) { applyCardSlotPlan(project, cardIndex, outlineSlide, slide); if (cardShortened?.length) slide.cardCodeShortened = cardShortened; }
    else if (cardsFlow(project)) {
      fitCardLabels(project, cardIndex, slide);
      const slots = project.templateFidelity.slides[project.outline.findIndex(item => item.id === outlineSlide.id)]?.slots || [];
      const empty = slot => { const text = slide.templateSlotTexts[String(slot.shapeId)]; return Array.isArray(text) ? !text.some(item => String(item.label || item.body || '').trim()) : !String(text || '').trim(); };
      const omittedIds = new Set(slide.templateOmissions.map(item => String(item.shapeId)));
      for (const slot of slots.filter(slot => slot.role === 'content' && omittable.has(String(slot.shapeId)) && empty(slot))) {
        // A heading and its description stay together: a half-filled pair is left to the slot check.
        const pair = slots.find(other => String(other.shapeId) === String(slot.pairedWith) || String(other.pairedWith) === String(slot.shapeId));
        if (omittedIds.has(String(slot.shapeId)) || pair && !empty(pair)) continue;
        omittedIds.add(String(slot.shapeId));
        slide.templateOmissions.push({ shapeId: Number(slot.shapeId), reason: 'The card has fewer points than this layout has text slots.', automatic: true });
      }
    }
  }
  if (prepared?.layoutId === undefined && !resolvedDistributionLayout) { delete slide.layoutId; delete slide.layoutRef; }
  if (project) {
    const assigned=project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id)?.sourceArtifacts||[];
    // The planner owns required structures. A writer cannot drop them by
    // returning an empty array; unsupported selections still fail validation.
    const selected=value?.sourceArtifacts?.length?value.sourceArtifacts:assigned;
    if(assigned.some(ref=>!selected.some(item=>item.sourceUnitId===ref.sourceUnitId &&
      item.lineStart===ref.lineStart&&item.lineEnd===ref.lineEnd&&(item.rowStart??1)===(ref.rowStart??1) && (item.rowEnd??project.source?.semantic?.inventory?.items?.find(o=>o.id===ref.sourceUnitId)?.rows?.length)===(ref.rowEnd??project.source?.semantic?.inventory?.items?.find(o=>o.id===ref.sourceUnitId)?.rows?.length))))throw new HttpError(400,`writer omitted a required source object or changed its row selection: ${JSON.stringify({expected:assigned,received:selected})}. Copy the frozen source selection exactly; table rows and literal source lines have distinct immutable ranges.`);
    const exactSourceOnly=project.generationPolicy?.content==='full_source'&&project.generationPolicy?.language?.mode==='source'&&project.generationPolicy?.knowledge==='source_only'&&assigned.length&&(outlineSlide.sourceUnitIds||[]).every(id=>assigned.some(ref=>ref.sourceUnitId===id));
    if(exactSourceOnly&&value?.sourceCommentary?.some(entry=>(typeof entry==='string'?entry:entry.text)?.trim()))throw new Error('writer source-only contract: complete frozen source already owns the visible body; sourceCommentary must be []. Do not repeat its statements or add a paraphrase. All original source objects and conditions stay visible.');
    // A card page without objects shows its points in the template's slots: a
    // commentary would turn the body into one source-owned paragraph (3143, 6b823143).
    const cardSlots=cardsFlow(project)&&project.templateFidelity?.mode==='preserve'&&Array.isArray(outlineSlide.cardObjects)&&!outlineSlide.cardObjects.length;
    // A block's heading stays with its body beside a figure (live Blue,
    // 2026-11-02: score rows lost their method names).
    const commentary=exactSourceOnly||cardSlots?[]:value?.sourceCommentary?.length?value.sourceCommentary:assigned.length && !value?.slotTexts
      ? slide.copy.blocks.map(block=>block.heading?`${block.heading}：${block.body}`:block.body):[];
    const requiredEvidence=writerSourceEvidenceIds(project,index,project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id),retrieval);
    if(value?.sourceEvidenceIds?.some(id=>!requiredEvidence.includes(id)))throw new Error('invalid source evidence selection: only frozen required evidence IDs may be bound');
    // Measure the new semantic slide, not the previous placeholder/header.
    const bindingProject=sourceBindingProject(project,slide,index);
    bindSourceArtifacts(bindingProject, slide, selected, index, commentary,requiredEvidence);
    // A card page on a preserve template shows no figure (option A): only a figure page binds media.
    // A figure page using its frame's picture slots places its figures there (applyFillPictures), not beside them.
    if(!(cardsFlow(project)&&project.templateFidelity?.mode==='preserve'&&!outlineSlide.figurePage)&&!figureSlotPlan(project,index,outlineSlide)?.ok)bindSourceMedia(bindingProject,slide,outlineSlide.sourceImageIds||[],index);
    if(project.templateFidelity?.mode==='preserve')normalizeDeckEyebrows({...project,deck:{slides:project.outline.map((o,i)=>i===index?slide:{id:o.id,title:o.title,section:o.section,nodes:[]})}},{onlySlideId:slide.id});
    if(value?.cardPage?.mode==='theme')bindThemeCardPage(project,slide,index,outlineSlide);
    else if(value?.cardPage)slide.cardPage={mode:value.cardPage.mode,templatePage:(project.templateFidelity?.slideMap?.[index]??-1)+1};
    if(cardsFlow(project)){retireUnboundContainers(project,slide,index);applyChromeFallback(project,slide,index);}
    applyLayoutPicture(project,slide,index);applyContentSlotPictures(project,slide,index);applyFillPictures(project,slide,index,outlineSlide);
    if(project.templateFidelity?.mode==='preserve'){fitHeaderPills(project,slide,index);readableWrittenText(project,slide,index);}
    if(cardsFlow(project)&&value?.cardPage?.mode==='theme')numberGuard(project,slide,index,outlineSlide);
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
  // Keep the last card's source takeaway and the localized closing greeting.
  if(index>0&&index===project?.outline?.length-1&&!slide.closingGreeting)appendClosingGreeting(project,slide);
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
  const report = finalQualityReport(repaired.review, repaired.repairs, unchanged?project.quality.modelReview:unevaluated, {}, { judgedAdvisory: outlineFirst(project) });
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
      updated.status = 'quality_blocked'; updated.stage = 'repair'; updated.qualityBlockReason = 'checks'; updated.error = `PPT quality gate blocked publish: ${qualityError(gated)}`;
      saveStructuredProject(updated); return updated;
    }
    updated.status = 'completed'; updated.stage = 'completed'; updated.error = '';
    saveStructuredProject(updated); return updated;
  });
}
// Model-transport timing only: a contract or gate failure has none, and an
// empty object made the failure dialog print "— ms / — ms / —".
const diagnosticField=value=>{const diagnostic=safeModelDiagnostic(value);return Object.keys(diagnostic).length?{diagnostic}:{};};
function fail(uid, id, stage, error, log) {
  const p = store.get(uid, id);
  if (!p || p.deletedAt) return;
  if (p.status === 'cancelled') return;
  // S10: only generation pauses on its budget; an outline run fails and is written again.
  if (error?.code === 'execution_budget' && p.status === 'generating') { runtimeState(p).resumePhase='generating'; p.status='paused'; p.stage=stage; p.error=error.message; runtimeState(p).pauseRequested=true; store.save(p); return; }
  if (p.status === 'paused' && p.runtime?.pauseRequested) return;
  p.status = 'failed'; p.stage = stage;
  p.error = String(error?.message || error).slice(0, 400);
  const message=String(error?.message||error);
  const code=error?.code||error?.causes?.[0]?.error?.code||(/writer_copy_gate|writer.*contract|template_slot|template_text_fragment|source.*(?:coverage|capacity)|writer_math/u.test(message)?'content_invalid':/export verification|PPTX.*(?:integrity|visibility)|render.*(?:overflow|capacity)/iu.test(message)?'render_invalid':/review.*(?:contract|invalid)|claim.*(?:audit|invalid)/iu.test(message)?'review_invalid':stage==='outline'?'schema_invalid':'transport');
  const underlying=error?.causes?.[0]?.error||error;
  const origin=failureOrigin({stage,code,message,error:underlying});
  p.failure={version:2,stage,code,origin,model:p.model,at:new Date().toISOString(),...(underlying?.modelStage?{modelStage:String(underlying.modelStage).slice(0,100)}:{}),...(underlying?.contractStage?{contractStage:String(underlying.contractStage).slice(0,100)}:{}),...diagnosticField(underlying?.diagnostic),trace:failureTrace({stage,error:{...underlying,code:underlying?.code||code,message:underlying?.message||message,afterStep:underlying?.afterStep||error?.afterStep,repairGovernor:underlying?.repairGovernor||error?.repairGovernor,noProgress:underlying?.noProgress||error?.noProgress,repairs:underlying?.repairs||error?.repairs},project:p})};
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
      // A source filename labels the upload; it is not a user-supplied image
      // reference or supplemental prose. Update progress is already merged.
      const supplementalText=latest.update?'':String(latest.userRequirements??(latest.prompt!==latest.source?.name?latest.prompt:''));
      const supplement=supplementalText.trim()? /<svg\b/iu.test(supplementalText)
        ? await deps.extractFile(latest,'supplement.html',Buffer.from(supplementalText))
        : normalizePaste(supplementalText,latest.source?.images||[]):latest.source;
      source=mergeSourceSupplement(source,supplement,supplementalText,!latest.update);
      // An inconsistent product/count in the original is a required source
      // warning (resolved before generation), not a hard ingest failure.
      source=withSourceArithmeticWarnings(source);
      latest.source = withSemanticIndex(source);latest.provenance={...latest.provenance,sourceParsing:sourceParsingReceipt(latest.source)}; syncPresentationPolicy(latest); latest.status = 'outlining'; latest.stage = 'outline'; latest.error = '';
      latest.inputProfile = profilePptInput(latest);
      latest.contentPlan = planSparseInput(latest, latest.inputProfile);
      if (automaticPages(latest)&&latest.generationPolicy?.version!==2) {
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
function assertOutlinePageBudget(project,raw){
 if(project.generationPolicy?.version!==2||!Array.isArray(raw?.slides)||raw.slides.length===project.pages)return;
 throw Object.assign(outlineError('schema_invalid'),{outlineContract:true,origin:'model_contract',message:`ppt_schema_invalid: model returned ${raw.slides.length} outline pages; agreed target is ${project.pages}. Repair only the permitted page allocation; this is not a template capacity verdict.`,details:{pageCountConflict:{requested:project.pages,actual:raw.slides.length}}});
}
/** The template page score of a card: option D's card-page score, else (a
 * card that shows source objects) its measured overflow, and a title that does
 * not fit the page's title slot costs more than any overflow (the confirmation
 * would refuse it while a roomier frame is free). */
const UNFIT_TITLE_COST=1e12;
export function cardScheduleScore(project,index,slide=project.outline?.[index]){
  const titleCost=index>0&&!cardTitleFits(project,index,slide)?UNFIT_TITLE_COST:0;
  const headerCost=index>0&&!slide?.cardFrame&&headerFrameReason(project.templateFidelity?.slides?.[index]||{},project.templateFidelity)?1e10:0;
  // A figure page never takes a photo frame (Fable D2).
  const figure=sourceFigureScore(project,index,slide);if(figure!==null)return figure+(figure<1e11?figurePhotoCost(project,index):0)+titleCost+headerCost;
  // An object page is scored by the measurement it is bound with (Fable R6).
  const object=objectPageScore(project,index,slide);if(object!==null)return object+titleCost+headerCost;
  const score=cardPageScore(project,index);if(score!==null&&score!==undefined)return score+headerCost;
  return candidateFit(slide,project,index).predictedOverflow+titleCost+headerCost;
}
/** The schedule score inside a figure-pairing trial (Fable D, 2026-11-03): a
 * page whose title fit before the trial also scores its title on a plain card
 * frame, so a page the trial shifts takes a frame its title fits. With no
 * such pages it is cardScheduleScore unchanged. */
export function figureTrialScore(keepTitles){
  return (p,index)=>cardScheduleScore(p,index)+(keepTitles?.size&&index>0&&keepTitles.has(p.outline?.[index]?.id)&&!cardTitleFits(p,index,p.outline[index])?UNFIT_TITLE_COST:0);
}
function assessOutlineCandidate(project, raw, {finalRepack=false,placeFigures=false}={}) {
  assertLogicalOwnership(project,raw);
  assertOutlinePageBudget(project,raw);
  raw=planTitleHierarchy(project,raw);
  raw=routeTranslationsToNotes(project,coalesceEquivalentSelections(raw),item=>visibleEquivalentCandidates(project,item));
  // Compile, not reject: correct deterministic contract slips and list them.
  const compiled=project.requestedOutline?{raw,corrections:[]}:compileOutlineCandidate(project,raw);raw=compiled.raw;
  const automatic=automaticPages(project);
  let contentSelection;try{contentSelection=compileContentSelection(project,raw);}catch(error){error.outlineContract=true;error.code='coverage_invalid';throw error;}
  if(contentSelection||project.languageProjection)project={...project,...(contentSelection?{contentSelection}:{}),originalSourceInventory:project.originalSourceInventory||project.source.semantic.inventory,source:selectionSource(project,contentSelection)};
  try{raw=compileSkeleton(project,raw);if(automatic&&!editorialOwnershipContract(project))raw=pruneEmptySelectedPages(project,raw);}catch(error){error.outlineContract=true;throw error;}
  let rawOutline,outline;
  const candidateProject={...project,...(automatic&&project.templateFidelity?{nativeCapacityAssignment:true}:{})};
  try {
    rawOutline=project.requestedOutline||editorialOwnershipContract(project)?raw:packOutline(project,raw,{finalRepack});
    rawOutline=ensureOutlineClosing(project,rawOutline);
    assertOutlinePageBudget(project,rawOutline);
    if(automatic)candidateProject.pages=pages(rawOutline.slides.length);
    rawOutline={...rawOutline,slides:rawOutline.slides.map(slide=>fragmentTitle(slide,project.source,{cleanWholeLocators:!project.confirmedOutline&&!project.requestedOutline,preservePlannedTopic:project.generationPolicy?.version===2}))};
    outline=normalizeOutline(rawOutline,candidateProject.pages,project.source,project.update,project.deckTitle,project.requestedOutline ? null : deckLanguage(project),{keepContinuation:cardsFlow(project)});
    if(editorialOwnershipContract(candidateProject))rawOutline={...rawOutline,slides:rawOutline.slides.map((slide,index)=>({...slide,id:outline[index].id}))};
  } catch(error){error.code||='schema_invalid';error.outlineContract=true;throw error;}
  candidateProject.outline=outline;
  // Explicit N fixes quantity, not a role-only layout reassignment. Preserve
  // an accepted assignment during title review; other plans choose by fit.
  // A card page takes the layout whose point holders fit its points (option 1);
  // other pages, and card pages with objects, the layout with the least overflow.
  rescheduleTemplateFidelity(candidateProject,{scoreSlide:(p,index)=>cardsFlow(p)?cardScheduleScore(p,index,outline[index]):candidateFit(outline[index],p,index).predictedOverflow,allowOverflowCandidate:automatic&&!project.confirmedOutline});
  // Figure placement is the final scheduled outline transformation. It measures
  // the trial's actual frames after object splitting and title adaptation.
  if(placeFigures&&cardsFlow(candidateProject)&&!project.confirmedOutline){
    const placed=placeScheduledCardFigures(candidateProject,rawOutline,(trial,keepTitles)=>rescheduleTemplateFidelity(trial,{scoreSlide:figureTrialScore(keepTitles)}));
    if(placed!==rawOutline){rawOutline=placed;outline=normalizeOutline(rawOutline,candidateProject.pages,project.source,project.update,project.deckTitle,null,deckLanguage(project),{keepContinuation:true});candidateProject.outline=outline;}
    // The final schedule can move a card to a frame with a narrower title slot
    // than the one its title was fitted to (3200, JEPA p20: a 44-character claim
    // on a 34-character slot blocked the deck): such a title takes the source
    // heading or a whole-word cut, as the earlier passes would have.
    const unfit=unfitCardTitles(candidateProject),retitledCards=new Set(unfit.map(({index})=>rawOutline.slides[index]?.logicalCardId).filter(Boolean));
    if(unfit.length){const topics=new Map((project.planningContract?.logicalCards||[]).map(card=>[card.id,card.title]));
      const titles=new Map(unfit.map(({index,slide})=>[index,fallbackCardTitle(candidateProject,index,slide,topics.get(rawOutline.slides[index]?.logicalCardId)||'')]));
      rawOutline={...rawOutline,slides:rawOutline.slides.map((slide,index)=>titles.has(index)?{...slide,title:titles.get(index),focus:titles.get(index)}:slide)};
      outline=outline.map((slide,index)=>titles.has(index)?{...slide,title:titles.get(index),focus:titles.get(index)}:slide);candidateProject.outline=outline;}
    // A figure page that took its card's points is one of the card's parts:
    // the card is numbered again here, after the post-process numbering ran
    // (3222 f3, 2026-11-03: "X · 1/2", "X (cont.)", "X · 2/2").
    // Only those cards, and cards a title fallback just cut: any other card keeps the titles it was given.
    const pairedCards=new Set([...rawOutline.slides.filter(slide=>slide.pairedFigurePage&&slide.logicalCardId).map(slide=>slide.logicalCardId),...retitledCards]);
    if(pairedCards.size){const all=numberCardParts(candidateProject),parts={titles:new Map([...all.titles].filter(([index])=>pairedCards.has(rawOutline.slides[index]?.logicalCardId)))};
      if(parts.titles.size){rawOutline={...rawOutline,slides:rawOutline.slides.map((slide,index)=>parts.titles.has(index)?withPartTitle(candidateProject,slide,parts.titles.get(index)):slide)};
        outline=outline.map((slide,index)=>parts.titles.has(index)?withPartTitle(candidateProject,slide,parts.titles.get(index)):slide);candidateProject.outline=outline;}}
  }
  rawOutline=revalidateOutlineFits(candidateProject,rawOutline,outline);
  outline=outline.map((slide,index)=>({...slide,densityFit:rawOutline.slides[index].densityFit}));
  candidateProject.outline=outline;
  const planning=buildPlanning(candidateProject,rawOutline,outline);
  const issues=[...exactPageConflict(candidateProject,rawOutline),...inspectSkeletonOwnership(candidateProject,rawOutline),...inspectReportOutline(candidateProject,outline,planning.brief),...inspectLongDeckOutline(candidateProject,outline),...inspectDensityOutline(rawOutline,candidateProject)];
  return {project:candidateProject,rawOutline,outline,planning,issues,corrections:compiled.corrections};
}
/** The card outline's post-processing: capacity splits, table fonts, title
 * fits, part numbers and long tables to the appendix. CPU-heavy and
 * synchronous apart from one model call, so it runs in a worker thread (D3,
 * 2026-10-31); the caller answers its model call. */
/** A candidate outline measured on its pages, figures placed and frozen
 * sources checked: synchronous and CPU-heavy, run in the outline worker. */
export function assessCandidateNow(project,raw){
  const result=assessOutlineCandidate(project,raw,{placeFigures:true});
  if(result.project.templateFidelity?.mode==='preserve')inspectFrozenOutlineSources(result.project,result.outline,result.planning,{repairNative:true});
  return result;
}
export async function cardOutlinePostProcess(p,saved,{modelCall,log=()=>{},revision,id}){
  // A one-row source table leaves its page before any page is measured (Fable 2026-10-31).
  {const off=oneRowTablesOff(p,saved.raw);if(off.moved.length)saved={...saved,raw:off.raw,advisories:[...saved.advisories,...off.moved.map(move=>({code:'card_one_row_table',message:move.to==='line'?`A one-row table (${move.tableId}) is shown as one plain line.`:`A one-row table (${move.tableId}) is in the page's speaker notes, not drawn as a table.`}))].slice(0,60)};}
  // A card left with nothing to show leaves the deck, its notes kept on a neighbour (3197 57347ca7).
  {const kept=dropEmptyCardPages(saved.raw);if(kept.moved.length)saved={...saved,raw:kept.raw,advisories:[...saved.advisories,...kept.moved.map(item=>({code:'card_page_empty_dropped',message:`"${String(item.title).slice(0,80)}" had nothing to show${item.notes?`; its ${item.notes} note(s) are on "${String(item.to||'').slice(0,80)}"`:''}.`}))]};}
  p.planningContract.cardOutline=saved;p.pages=saved.raw.slides.length;p.outline=saved.raw.slides.map(slide=>({...slide}));rescheduleTemplateFidelity(p,{scoreSlide:(current,index)=>cardScheduleScore(current,index)});
  // Source objects too tall for their best page split here, one object per
  // page or by measured rows/lines, so the author reviews the continuation
  // cards (Fable R3/R6). A single object taller than every page is refused at confirmation.
  // Table fonts first, so a table's row ranges are planned at its font (Fable review r16).
  if(p.templateFidelity?.mode==='preserve')planTableFonts(p);
  if(p.templateFidelity?.mode==='preserve'){
    const checked=preflightCardCapacity(p,saved.raw,{schedule:current=>rescheduleTemplateFidelity(current,{scoreSlide:(q,i)=>cardScheduleScore(q,i)})});
    saved={...saved,raw:checked.raw,advisories:[...saved.advisories,...checked.changes.map(change=>({code:'card_capacity_split',message:change.reason})),...checked.unresolved.map(item=>({code:'card_capacity_unresolved',message:`Page ${item.page} still needs a capacity adjustment`,pageId:item.pageId}))].slice(0,60)};
    p.planningContract.cardOutline=saved;
  }
  // Every title fits its own page's slot, so the planned outline always
  // confirms (Fable decision r18, fz p22): one batched shortening call,
  // then the topic title or a word-boundary cut, rescheduled until stable.
  if(p.templateFidelity?.mode==='preserve'){
    const retitle=(changes,code,describe)=>{if(!changes.size)return;
      saved={...saved,raw:{...saved.raw,slides:saved.raw.slides.map((slide,index)=>changes.has(index)?{...slide,title:changes.get(index)}:slide)},
        advisories:[...saved.advisories,...[...changes].map(([index,title])=>({code,message:describe(p.outline[index].title,title)}))].slice(0,60)};
      p.planningContract.cardOutline=saved;p.outline=saved.raw.slides.map(slide=>({...slide}));rescheduleTemplateFidelity(p,{scoreSlide:(current,i)=>cardScheduleScore(current,i)});};
    let unfit=unfitCardTitles(p);
    // The title's own lead, the topic title or the source heading first (Fable plan T32).
    if(unfit.length){const topics=new Map((p.planningContract.logicalCards||[]).map(card=>[card.id,card.titleSecondary&&!/\s\|\s/u.test(card.title)?`${card.title} | ${card.titleSecondary}`:card.title]));
      const chosen=new Set();retitle(new Map(unfit.map(({index,slide})=>[index,preferredShortTitle(p,index,slide,topics.get(slide.logicalCardId),chosen)]).filter(([,title])=>title)),'card_title_shortened',(before,after)=>`"${String(before).slice(0,80)}" is shortened to fit its title slot: "${after}".`);unfit=unfitCardTitles(p);}
    if(unfit.length){const task=titleShortenTask(p,unfit);
      try{retitle(acceptShortTitles(p,unfit,parseModelValue(await modelCall(task.prompt,{nodeKey:'outline:cards:'+revision+':titles',jsonSchema:task.schema,maxOutputTokens:4096}))),'card_title_shortened',(before,after)=>`"${String(before).slice(0,80)}" is shortened to fit its title slot: "${after}".`);}
      catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} title shortening call failed: ${String(error?.message||error).slice(0,120)}`);}}
    for(let pass=0;pass<4&&(unfit=unfitCardTitles(p)).length;pass++){
      const topics=new Map((p.planningContract.logicalCards||[]).map(card=>[card.id,card.titleSecondary&&!/\s\|\s/u.test(card.title)?`${card.title} | ${card.titleSecondary}`:card.title]));
      const chosen=new Set();retitle(new Map(unfit.map(({index,slide})=>[index,fallbackCardTitle(p,index,slide,pass?'':topics.get(slide.logicalCardId),chosen)])),'card_title_truncated',(before,after)=>`"${String(before).slice(0,80)}" did not fit its title slot and is shown as "${after}"; edit it in the outline if needed.`);
    }
    // Adjacent pages that still share a title are a card and its continuation (live fz-r33 p3).
    retitle(new Map(repeatedTitlePages(p).map(index=>[index,continuedPageTitle(p,index,p.outline[index])])),'card_title_continued',(before,after)=>`"${String(before).slice(0,80)}" repeats the previous page's title; it is marked "${String(after).slice(0,80)}".`);
    // Split cards are numbered " · k/n" on every part, the base shortened once (Fable 2026-10-27).
    {const parts=numberCardParts(p);if(parts.titles.size){
      saved={...saved,raw:{...saved.raw,slides:saved.raw.slides.map((slide,index)=>parts.titles.has(index)?withPartTitle(p,slide,parts.titles.get(index)):slide)},advisories:[...saved.advisories,...parts.notes].slice(0,60)};
      p.planningContract.cardOutline=saved;p.outline=saved.raw.slides.map(slide=>({...slide}));rescheduleTemplateFidelity(p,{scoreSlide:(current,i)=>cardScheduleScore(current,i)});}}
    if(p.titleMarkerNotes?.length){saved={...saved,advisories:[...saved.advisories,...p.titleMarkerNotes].slice(0,60)};p.planningContract.cardOutline=saved;delete p.titleMarkerNotes;}
  }
  // Title adaptation may choose another frame. Recheck children and
  // number any new parts under the mainline k/n title policy.
  if(p.templateFidelity?.mode==='preserve')for(let pass=0;pass<3;pass++){
    const checked=preflightCardCapacity(p,saved.raw,{schedule:current=>rescheduleTemplateFidelity(current,{scoreSlide:(q,i)=>cardScheduleScore(q,i)})});
    let raw=checked.raw;
    const short=new Map(unfitCardTitles(p).map(({index,slide})=>[index,fallbackCardTitle(p,index,slide,'')]));
    if(short.size){raw={...raw,slides:raw.slides.map((slide,index)=>short.has(index)?{...slide,title:short.get(index),focus:short.get(index)}:slide)};p.outline=raw.slides;}
    const parts=numberCardParts(p);if(parts.titles.size)raw={...raw,slides:raw.slides.map((slide,index)=>parts.titles.has(index)?withPartTitle(p,slide,parts.titles.get(index)):slide)};
    saved={...saved,raw};p.outline=raw.slides;p.planningContract.cardOutline=saved;
    if(!checked.changes.length&&!short.size&&!parts.titles.size)break;
  }
  // Long tables: the first page stays in the body, the whole table moves
  // to the appendix (user decision 2026-10-31, D1).
  {const appendixed=moveLongTablesToAppendix(p,saved.raw);
    if(appendixed.moved.length){
      p.outline=appendixed.raw.slides.map(slide=>({...slide}));
      const parts=numberCardParts(p),slides=appendixed.raw.slides.map((slide,index)=>parts.titles.has(index)&&slide.region!=='appendix'?withPartTitle(p,slide,parts.titles.get(index)):slide);
      saved={...saved,raw:{...appendixed.raw,slides},advisories:[...saved.advisories,...appendixed.moved.map(move=>({code:'card_table_appendix',message:move.reason==='long_table'?`A table that needed ${move.appendixPages} pages shows its first page here; the full table is in Appendix ${move.letter}.`:move.reason==='one_table_per_card'?`A card shows one table at this length; another of its tables is in Appendix ${move.letter}.`:move.reason==='uncited_table'?`A card shows one table at this length; another of its tables, which no point cites, is named in the closing page's notes.`:`A table from the source's own appendix is in Appendix ${move.letter}.`}))].slice(0,60)};
      p.planningContract.cardOutline=saved;p.pages=saved.raw.slides.length;p.outline=saved.raw.slides.map(slide=>({...slide}));
      rescheduleTemplateFidelity(p,{scoreSlide:(current,i)=>cardScheduleScore(current,i)});
      // A table page that took back its card's points is measured again:
      // the points that do not fit beside the table go to its notes.
      const checked=preflightCardCapacity(p,saved.raw,{schedule:current=>rescheduleTemplateFidelity(current,{scoreSlide:(q,i)=>cardScheduleScore(q,i)})});
      if(checked.changes.length){const renumbered=numberCardParts(p),raw={...checked.raw,slides:checked.raw.slides.map((slide,index)=>renumbered.titles.has(index)&&slide.region!=='appendix'?withPartTitle(p,slide,renumbered.titles.get(index)):slide)};
        saved={...saved,raw};p.planningContract.cardOutline=saved;p.pages=raw.slides.length;p.outline=raw.slides.map(slide=>({...slide}));}
    }}
  // The deck's shape variety (Fable M3): with every page in place, no card
  // shape covers more than 40% of the content pages or runs three in a row.
  if(cardsFlow(p)){const slides=planCardIcons(balanceCardShapes(saved.raw.slides),cardShape);if(slides.some((slide,index)=>slide!==saved.raw.slides[index])){saved={...saved,raw:{...saved.raw,slides}};p.outline=slides.map(slide=>({...slide}));p.planningContract.cardOutline=saved;}}
  // Last, with every page in place: each page titled from what it shows (the
  // user, 2026-11-01, B). A title that fails a check, or no longer fits its
  // slot once rescheduled, stays as it was; the call never blocks the outline.
  if(!p.requestedOutline&&!p.update){
    const before=saved.raw.slides.map(slide=>slide.title),changed=new Set();
    // A deck subject at the start of most titles goes first (C), so the call sees the titles without it.
    const dropped=dropSubjectTitles(p,saved.raw);if(dropped.titles.size){saved=applyRetitles(p,saved,dropped,'card_title_subject_dropped');for(const index of dropped.titles.keys())changed.add(index);}
    const items=retitleItems(p,saved.raw),task=retitleTask(p,saved.raw,items);
    if(task)try{
      const retitleReply=parseModelValue(await modelCall(task.prompt,{nodeKey:'outline:retitle:'+revision,jsonSchema:task.schema,maxOutputTokens:4096}));
      const accepted=acceptRetitles(p,saved.raw,items,retitleReply,task.subject);
      // Short figure captions in the deck's language (the hand deck, Fable 2026-11-02).
      if(task.figures?.length){const captions=acceptFigureCaptions(p,saved.raw,retitleReply);p.planningContract.figureCaptions={...(p.planningContract.figureCaptions||{}),...captions};log(`ppt ${id} figure captions: ${Object.keys(captions).length} of ${task.figures.length}`);}
      // A title refused only on length gets one shorter try with its exact limit.
      const retry=retitleRetryTask(p,items,accepted.refused);let second={titles:new Map(),count:0,refused:[]};
      if(retry)try{second=acceptRetitles(p,saved.raw,items,parseModelValue(await modelCall(retry.prompt,{nodeKey:'outline:retitle:'+revision+':retry',jsonSchema:retry.schema,maxOutputTokens:2048})),task.subject);}catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} retitle retry failed: ${String(error?.message||error).slice(0,120)}`);}
      for(const [index,title] of second.titles)if(!accepted.titles.has(index))accepted.titles.set(index,title);accepted.count+=second.count;
      if(accepted.titles.size){saved=applyRetitles(p,saved,accepted);for(const index of accepted.titles.keys())changed.add(index);}
      log(`ppt ${id} retitle: ${items.length} pages, ${accepted.count} rewritten, refused ${JSON.stringify(accepted.refused.map(entry=>entry.reason))}${retry?`, retry refused ${JSON.stringify(second.refused.map(entry=>entry.reason))}`:''}`);
      // The deck title standard (N5): one more call for the titles that miss it; a rewrite stays only when it has fewer problems.
      const issues=deckTitleIssues(p,saved.raw),fixItems=issues.size?retitleItems(p,saved.raw):[],fix=issues.size?titleStandardTask(p,saved.raw,fixItems,issues):null;
      if(fix)try{const reply=acceptStandardTitles(p,saved.raw,fixItems,parseModelValue(await modelCall(fix.prompt,{nodeKey:'outline:retitle:'+revision+':standard',jsonSchema:fix.schema,maxOutputTokens:4096})),task.subject,issues);
        const better=reply;if(better.titles.size){saved=applyRetitles(p,saved,better,'card_titles_standard');for(const index of better.titles.keys())changed.add(index);}
        log(`ppt ${id} title standard: ${issues.size} pages missed it, ${better.count} rewritten, refused ${JSON.stringify(reply.refused.map(entry=>entry.reason))}`);
      }catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} title standard call failed: ${String(error?.message||error).slice(0,120)}`);}
    }catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} retitle call failed: ${String(error?.message||error).slice(0,120)}`);}
    if(changed.size){
      p.planningContract.cardOutline=saved;p.outline=saved.raw.slides.map(slide=>({...slide}));
      if(p.templateFidelity?.mode==='preserve'){rescheduleTemplateFidelity(p,{scoreSlide:(current,i)=>cardScheduleScore(current,i)});
        const unfit=new Set(unfitCardTitles(p).map(({index})=>index).filter(index=>changed.has(index)));
        if(unfit.size){saved={...saved,raw:{...saved.raw,slides:saved.raw.slides.map((slide,index)=>unfit.has(index)?withPartTitle(p,slide,before[index]):slide)}};p.outline=saved.raw.slides.map(slide=>({...slide}));}}
      // A built-in page keeps a new title only when the confirmation's own title check passes it.
      else{const refused=new Set(inspectSystemOutlineTitles(p,p.outline).map(issue=>issue.pageIndex).filter(index=>changed.has(index)));
        if(refused.size){saved={...saved,raw:{...saved.raw,slides:saved.raw.slides.map((slide,index)=>refused.has(index)?withPartTitle(p,slide,before[index]):slide)}};p.outline=saved.raw.slides.map(slide=>({...slide}));}}
      const parts=numberCardParts(p);if(parts.titles.size)saved={...saved,raw:{...saved.raw,slides:saved.raw.slides.map((slide,index)=>parts.titles.has(index)&&slide.region!=='appendix'?withPartTitle(p,slide,parts.titles.get(index)):slide)}};
      p.planningContract.cardOutline=saved;p.outline=saved.raw.slides.map(slide=>({...slide}));
      if(p.templateFidelity?.mode==='preserve')rescheduleTemplateFidelity(p,{scoreSlide:(current,i)=>cardScheduleScore(current,i)});
    }
    // Titles still missing the standard are flagged for the author, never blocked.
    // A title still not in the deck's language would block generation: its first point's clause or its section label (listed).
    {const fallback=foreignTitleFallbacks(p,saved.raw);if(fallback.size){saved=applyRetitles(p,saved,{titles:fallback,count:fallback.size},'card_title_language_fallback');p.planningContract.cardOutline=saved;p.outline=saved.raw.slides.map(slide=>({...slide}));if(p.templateFidelity?.mode==='preserve')rescheduleTemplateFidelity(p,{scoreSlide:(current,i)=>cardScheduleScore(current,i)});}}
    {const flags=titleStandardAdvisories(p,saved.raw);if(flags.length){saved={...saved,advisories:[...saved.advisories.filter(entry=>entry.code!=='card_title_standard'),...flags].slice(0,60)};p.planningContract.cardOutline=saved;}}
  }
  // Last, with every page and title in place: each card that is one repeated
  // structure fills the first free template page that takes it exactly; one
  // call shortens blocks over a page's text boxes; the rest keep their page
  // (fill-template-first MVP, the user 2026-11-03).
  if(p.templateFidelity?.mode==='preserve'&&cardsFlow(p)){
    let matches=matchTemplatePages(p,saved.raw.slides);
    // Cards too short for the page they would fill are lengthened once from their sources, then matched again (the user, 2026-11-03).
    {const extend=fillExtendTask(p,matches,saved.raw.slides);
     if(extend)try{const longer=acceptFillExtend(p,matches,parseModelValue(await modelCall(extend.prompt,{nodeKey:'outline:fill:'+revision+':extend',jsonSchema:extend.schema,maxOutputTokens:8192})),saved.raw.slides);
      if(longer.refused.size)log(`ppt ${id} template fill lengthening refused: ${JSON.stringify(Object.fromEntries(longer.refused))}`);
      if(longer.taken.length){saved={...saved,raw:{...saved.raw,slides:longer.outline}};matches=matchTemplatePages(p,saved.raw.slides);log(`ppt ${id} template fill: ${longer.taken.length} card(s) lengthened from their sources`);}}
     catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} template fill lengthening call failed: ${String(error?.message||error).slice(0,120)}`);}}
    if(matches.length){
      const task=fillShortenTask(p,matches);let shortened=new Map();
      if(task)try{shortened=acceptFillShorten(p,matches,parseModelValue(await modelCall(task.prompt,{nodeKey:'outline:fill:'+revision,jsonSchema:task.schema,maxOutputTokens:4096})));}
      catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} template fill shortening call failed: ${String(error?.message||error).slice(0,120)}`);}
      // One retry for the cards still over a limit, from their shorter attempt with its counts (Fable's fill design: one retry, then fill_fallback).
      {const left=matches.filter(match=>match.profile&&!match.fit.ok&&!shortened.has(match.index));
       const again=left.length?fillShortenTask(p,left.map(match=>{const attempt=shortened.attempts?.get(match.index);return attempt&&attempt.blocks.length===match.blocks.length?{...match,blocks:attempt.blocks,lead:match.lead?attempt.lead:''}:match;}),{retry:true}):null;
       if(shortened.refused?.size)log(`ppt ${id} template fill shortening refused: ${JSON.stringify(Object.fromEntries(shortened.refused))}`);
       if(again)try{const second=acceptFillShorten(p,left,parseModelValue(await modelCall(again.prompt,{nodeKey:'outline:fill:'+revision+':retry',jsonSchema:again.schema,maxOutputTokens:4096})));for(const [index,value] of second)shortened.set(index,value);if(second.refused?.size)log(`ppt ${id} template fill shortening retry refused: ${JSON.stringify(Object.fromEntries(second.refused))}`);}
       catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} template fill shortening retry failed: ${String(error?.message||error).slice(0,120)}`);}}
      const applied=applyTemplateFill(p,saved.raw.slides,matches,shortened);
      saved={...saved,raw:{...saved.raw,slides:applied.outline},advisories:[...saved.advisories,...applied.notes].slice(0,60)};
      // Figure pages a filled page took are gone: the page count follows (live 3197 fbf18187).
      p.planningContract.cardOutline=saved;p.pages=saved.raw.slides.length;p.outline=saved.raw.slides.map(slide=>({...slide}));
      rescheduleTemplateFidelity(p,{scoreSlide:(current,i)=>cardScheduleScore(current,i)});
      log(`ppt ${id} template fill: ${applied.outline.filter(item=>item.templateFill?.status==='filled').length} filled, ${applied.outline.filter(item=>item.templateFill?.status==='fill_fallback').length} fallback, ${task?.cards.length||0} shortened by call`);
    }
  }
  return {project:p,saved};
}
function startOutline(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  let generateAfterOutline = false;
  void (async () => {
    // Every outline is a card outline (S11, 2026-10-23): code reads the source
    // and plans the topics; one call writes the deck's cards and one finishes it
    // (ppt-card-outline.mjs); a user-supplied outline becomes cards without a
    // model call. The outline compiler and fit checks run once, and their
    // findings are listed for the author to review (S7). There is no outline
    // pause (S10): the author rewrites the written outline with an instruction.
    let lastModelStep;
    // D3 (2026-10-31): the assessment runs in the outline worker too.
    const assessCandidate=(project,raw)=>runAssessCandidate(project,raw,{id,log});
    try {
      const p = store.get(uid, id);
      if (!p || p.status !== 'outlining') return;
      {const metered=deps;deps={...metered,modelCall:(project,prompt,activityArg,logArg,options={},...rest)=>{if(options?.nodeKey)lastModelStep=options.nodeKey;return metered.modelCall(project,prompt,activityArg,logArg,options,...rest);}};}
      if(!cardsFlow(p))throw Object.assign(new Error('This presentation was planned with a retired outline flow; open it in the editor to change it.'),{code:'retired_outline_flow',statusCode:409});
      if(p.failure){p.outlineFailureHistory=[...(p.outlineFailureHistory||[]).slice(-49),p.failure];delete p.failure;p.error='';store.save(p);}
      if (p.source?.segments?.length && !p.source.semantic) { p.source = withSemanticIndex(p.source); store.save(p); }
      syncPresentationPolicy(p);p.provenance={...p.provenance,generation:generationReceipt(p)};store.save(p);
      try { transitionNode(p, 'outline', 'running'); } catch {}
      const revision=p.planningContract.requestRevision;
      const live=()=>{const c=store.get(uid,id);if(c?.status!=='outlining'||c.planningContract?.requestRevision!==revision)throw outlineError('cancelled');return c;};
      const saveCandidate=(raw,issues=[])=>{const current=store.get(uid,id);if(current?.status==='outlining'){const previousPages=current.outlineTrace?.at(-1)?.pages;if(previousPages&&raw?.slides?.length&&raw.slides.length!==previousPages)log(`ppt ${id} outline candidate pages ${previousPages}→${raw.slides.length}${issues.length?' ('+[...new Set(issues.map(item=>item.code))].slice(0,4).join(', ')+')':''}`);current.candidateOutline=candidateRecord(current,raw,issues);current.outlineTrace=[...(current.outlineTrace||[]).slice(-99),{at:new Date().toISOString(),candidateHash:current.candidateOutline.hash,pages:raw?.slides?.length,issues:issues.map(item=>item.code),metrics:current.candidateOutline.metrics}];store.save(current);}};
      // Gamma-like forming outline (P1/P2, 2026-10-31): the planned topics show
      // at once, each topic's cards as soon as its deck chunk or topic call
      // returns, and the steps after them are named, so the author never waits
      // on a blank screen (3195 World Models: first card 96 s after the click).
      // Display only: the candidate above replaces the cards, nothing reads it back.
      const forming={titles:[],pages:new Map()};
      const saveForming=phase=>{const current=store.get(uid,id);if(current?.status!=='outlining'||current.planningContract?.requestRevision!==revision)return;
        current.outlineForming={version:1,revision,phase,done:forming.pages.size,total:forming.titles.length,at:new Date().toISOString(),
          syllabus:forming.titles.flatMap((title,t)=>forming.pages.get(t)?.map((page,k)=>({id:`forming_${t}_${k}`,title:String(page.title||title),points:(page.points||[]).slice(0,8).map(point=>String(point?.text||'').slice(0,240)).filter(Boolean)}))||[{id:`forming_${t}`,title:String(title),points:[],pending:true}])};
        store.save(current);};
      {
        // Code understanding (S1-S3, D11): structure, length presets and the default language.
        const latest=live(),key=codeUnderstandingIdentity(latest);
        if(latest.inputUnderstanding?.sourceIdentity!==key||latest.inputUnderstanding?.basis!=='code_statistics')latest.inputUnderstanding=codeInputUnderstanding(latest,key);
        if(!latest.planningContract.languageChoice&&latest.generationPolicy?.language?.mode==='source')latest.generationPolicy={...latest.generationPolicy,language:languagePolicy(defaultLanguageChoice(latest.inputUnderstanding))};
        applyReadingPageBudget(latest,key);store.save(latest);
        for(const field of ['inputUnderstanding','generationPolicy','pageBudget','pages','pageDecision'])p[field]=structuredClone(latest[field]);
      }
      let rawOutline;
      if(p.requestedOutline){
        // The author's own outline is the card outline as written.
        rawOutline=requestedOutlineCards(p);
        const {logicalCards}=rawOutline,current=live();
        p.planningContract={...current.planningContract,phase:'expanding',logicalCards,chapters:[],semanticRevision:digest(logicalCards),sourceReadIdentity:sourceReadIdentity(current),semanticIdentity:semanticIdentity(current),contentMode:current.planningContract.contentMode||'standard'};
        p.planningContract.cardOutline={revision:'author',raw:rawOutline,advisories:[],summary:cardDeckSummary(p,rawOutline,{chapters:[]},[]),reason:"The author's outline, as written."};
        p.pages=rawOutline.slides.length;p.outline=rawOutline.slides.map(slide=>({...slide}));
        rescheduleTemplateFidelity(p,{scoreSlide:(project,index)=>cardScheduleScore(project,index)});
        p.pageDecision={...p.pageDecision,mode:'explicit',source:'author_outline',finalPageCount:p.pages,confirmedAt:null};
        current.pages=p.pages;current.pageDecision=p.pageDecision;current.planningContract=p.planningContract;current.templateFidelity=p.templateFidelity;store.save(current);
      }else{
        if(p.readOnlyInput){
          // The settings form comes next (Gamma): length presets, language, template.
          const current=live(),u=current.inputUnderstanding;
          current.planning={...current.planning,pageRecommendation:{recommended:u.recommended,range:[u.min,u.max],reason:u.reason,basis:'code_statistics'}};
          current.status='input_ready';current.stage='input';current.error='';store.save(current);
          emitRunProgress(current,'input.ready',{recommended:u.recommended,presets:u.presets});
          return;
        }
        if(p.planningContract.phase==='semantic_planning'){
          // With a vision reader, template pictures are read once for drawn text and
          // people before the template's capacity is counted (report 52c7696e).
          {const current=live();try{if(await checkTemplatePictures(current,(project,prompt,options)=>deps.modelCall(project,prompt,activity,log,options)))store.save(current);}
            catch(error){if(error?.code==='cancelled')throw error;log('Template picture check skipped: '+String(error?.message||error).slice(0,160));}}
          // Topics by code (S4, D4-D5): leaf sections, merged or given more cards to
          // meet the chosen length; chapters for longer decks. No model call.
          const current=live(),length=defaultLength(current),plan=isBrief(current)?planBriefDeck(current,current.inputUnderstanding,length):planCardDeck(current,current.inputUnderstanding,length);
          const contract=current.planningContract,contentMode=contract.contentMode||'concise';
          current.planningContract={...contract,phase:'expanding',sourceReadIdentity:sourceReadIdentity(current),semanticIdentity:semanticIdentity(current),semanticRevision:digest(plan.logicalCards),logicalCards:plan.logicalCards,chapters:plan.chapters,semanticAdvisories:misplacedAddenda(current,plan.logicalCards),
            deckPlan:{pages:plan.pages,takeaway:plan.takeaway,length,...(plan.excludedSections?{excludedSections:plan.excludedSections}:{})},contentMode,pagePreference:{mode:'adaptive',max:40,target:plan.pages.total},capacityPlan:undefined,capacityRevision:undefined,actualPageIds:undefined,cardOutline:undefined};
          current.generationPolicy={...current.generationPolicy,detail:contentMode};current.outline=[];
          current.outlineAcceptance={semantic:true,physical:false,confirmable:false,issues:[]};store.save(current);
          emitRunProgress(current,'outline.semantic_ready',{cards:planningView(current).logicalCards,next:'cards',pages:plan.pages});
          p.planningContract=structuredClone(current.planningContract);p.generationPolicy=structuredClone(current.generationPolicy);p.outline=[];
        }
        if(p.planningContract.phase!=='expanding')throw Object.assign(new Error('Choose the outline settings first.'),{code:'planning_contract_invalid',outlineContract:true});
        // Card outline (D5): one call writes every topic's cards (a chunk of
        // whole topics per call above ONE_CALL_CHARS); each topic is checked as
        // before, and a topic that fails is written again on its own (one
        // correction, then sanitized). A small finishing call adds chapter
        // titles, the takeaway and point labels (D1); code assembles the deck.
        // S5: no measured card counts; the length decides, and a card that does
        // not fit its page continues on another during generation (splitCardPage).
        const estimate=null,plan={logicalCards:p.planningContract.logicalCards,chapters:p.planningContract.chapters||[],pages:p.planningContract.deckPlan?.pages};
        const cardRevision=digest({capacity:capacityIdentity(p),length:p.planningContract.deckPlan?.length,language:p.generationPolicy?.language,instruction:p.planningContract.instruction||''});
        let saved=p.planningContract.cardOutline?.revision===cardRevision?p.planningContract.cardOutline:null;
        if(!saved){
          let tasks,results;
          if(isBrief(p)){
            // Brief mode (Fable): one call writes every card from the author's brief.
            const task=briefDeckTask(p,plan);let last;
            emitRunProgress(store.get(uid,id),'outline.cards_writing',{topics:task.n,pages:plan.pages});
            forming.titles=plan.logicalCards.slice(1,1+task.n).map(card=>card.title);saveForming('cards');
            const written=(await callWithContract({prompt:task.prompt,stage:'outline:cards:'+revision+':brief',schema:task.schema,repairs:1,
              call:async(prompt,stage,schema)=>(last=await deps.modelCall(p,prompt,activity,log,{nodeKey:stage,jsonSchema:schema,maxOutputTokens:32768})),
              validate:reply=>acceptBriefDeck(p,task,reply),degrade:()=>{let parsed=null;try{parsed=parseModelValue(last);}catch{}return sanitizeBriefDeck(p,task,parsed);}})).value;
            tasks=plan.logicalCards.slice(1,1+written.replies.length).map(card=>({card}));
            results=written.replies.map((reply,k)=>({reply,advisories:k?[]:written.advisories}));
            written.replies.forEach((reply,k)=>{if(Array.isArray(reply?.pages))forming.pages.set(k,reply.pages);});
            // Its chapters take the titles the cards were written with.
            plan.chapters=plan.chapters.map(chapter=>{const topicIndexes=chapter.topicIndexes.filter(index=>index<tasks.length);return{...chapter,topicIndexes,headings:topicIndexes.map(index=>written.replies[index].pages[0].title)};}).filter(chapter=>chapter.topicIndexes.length);
          }else{
            // The template's own page shapes the writer may aim cards at (fill-template-first, the user 2026-11-03).
            if(p.templateFidelity?.mode==='preserve'){const offer=fillOffer(p);p.planningContract={...p.planningContract,fillOffer:offer.length?offer:undefined};}
            tasks=plan.logicalCards.slice(1).map(card=>cardTopicTask(p,card,card.quota||1,estimate));const accepted=new Array(tasks.length).fill(null);
            emitRunProgress(store.get(uid,id),'outline.cards_writing',{topics:tasks.length,pages:plan.pages});
            forming.titles=tasks.map(task=>task.card.title);saveForming('cards');
            const deckReplies=new Map();
            await boundedAll(deckCardsTasks(p,estimate,cardLineBudget(p,estimate)),PPT_OUTLINE_CONCURRENCY,async task=>{
              let reply=null;
              try{reply=parseModelValue(await deps.modelCall(p,task.prompt,activity,log,{nodeKey:`outline:cards:${revision}:deck:${task.chunk}`,jsonSchema:task.schema,maxOutputTokens:32768}));}
              catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} deck card call ${task.chunk+1} failed (${String(error?.code||error?.message||error).slice(0,80)}); its topics are written one by one`);}
              for(const index of task.indexes){const t=index-1,topic=topicReply(reply,plan.logicalCards[index].id);if(!topic)continue;deckReplies.set(t,topic);
                try{accepted[t]={reply:acceptCardTopic(p,tasks[t],topic,estimate),advisories:[]};forming.pages.set(t,accepted[t].reply.pages);}catch(error){if(error?.code==='cancelled')throw error;}}
              saveForming('cards');
            });
            live();
            const writeTopic=async(task,index)=>{
              // The deck's reply for this topic is the first attempt; a correction is one topic call.
              let last,first=deckReplies.get(index);
              // The newest reply that sanitizes to written cards is kept: an earlier
              // usable reply is never dropped for source excerpts (Fable 2026-11-03);
              // excerpts not in the deck's language get one slim call, else the notes.
              const replies=[];
              const degrade=async failed=>{const parsed=[...replies,last].filter(Boolean).reverse().map(raw=>{try{return parseModelValue(raw);}catch{return null;}}).filter(Boolean);const candidates=(parsed.length?parsed:[null]).map(reply=>sanitizeCardTopic(p,task,reply,estimate));let sanitized=candidates.find(candidate=>!candidate.advisories.some(advisory=>advisory.code==='card_topic_excerpts'))||candidates[0];
                sanitized=await rescueForeignExcerpts(p,task,sanitized,async(prompt,schema)=>parseModelValue(await deps.modelCall(p,prompt,activity,log,{nodeKey:'outline:cards:'+revision+':topic:'+index+':excerpts',jsonSchema:schema,maxOutputTokens:4096})));emitRunProgress(store.get(uid,id),'outline.card_topic_sanitized',{title:task.card.title,problems:(failed?.details?.problems||[]).slice(0,8).map(problem=>problem.message),advisories:sanitized.advisories.map(advisory=>advisory.code)});return sanitized;};
              const write=retry=>callWithContract({prompt:task.prompt,stage:'outline:cards:'+revision+':topic:'+index+(retry?':retry':''),schema:task.schema,repairs:first?1:2,
                call:async(prompt,stage,schema)=>{if(last)replies.push(last);if(first){last=first;first=null;return last;}return(last=await deps.modelCall(p,prompt,activity,log,{nodeKey:stage,jsonSchema:schema,maxOutputTokens:8192}));},
                validate:reply=>({reply:acceptCardTopic(p,task,reply,estimate),advisories:[]}),degrade});
              try{
                try{return(await write(false)).value;}
                catch(error){
                  // A topic with no reply yet gets one more call after a timeout or a lost
                  // connection (live mlq-r6: four topics timed out once on a loaded host).
                  if(error?.code==='cancelled'||deckReplies.has(index)||!['timeout','network','transport'].includes(String(error?.code||'').replace(/^ppt_/u,'')))throw error;
                  log(`ppt ${id} topic ${index+1} call failed (${String(error?.code)}); written once more`);
                  return(await write(true)).value;
                }
              }catch(error){
                // A correction call that times out or loses its connection keeps
                // the topic's deck reply, sanitized and listed (D12, F2: live
                // mlq-r4 failed its 44-card outline on one correction). A topic
                // that never got a reply still fails the outline.
                if(error?.code==='cancelled'||!deckReplies.has(index))throw error;
                log(`ppt ${id} topic ${index+1} correction failed (${String(error?.code||error?.message||error).slice(0,80)}); its deck reply is kept`);
                const kept=await degrade(null);
                return{...kept,advisories:[...kept.advisories,{code:'card_topic_correction_unavailable',message:`"${task.card.title}": its correction call failed (${String(error?.code||'transport')}); the first reply is kept with its problems listed.`}]};
              }
            };
            results=await boundedAll(tasks,PPT_OUTLINE_CONCURRENCY,async(task,index)=>{
              if(accepted[index])return accepted[index];
              const written=await writeTopic(task,index);
              if(Array.isArray(written?.reply?.pages)){forming.pages.set(index,written.reply.pages);saveForming('cards');}
              return written;
            });
          }
          saveForming('finishing');
          const base=assembleCardOutline(p,tasks,results.map(result=>result.reply));
          let finish=null;
          // Missing labels are asked for while the takeaway and cover corrections run:
          // they read the same cards and write other fields (2026-10-31, ~3 s per outline).
          let labelReply=null;
          {const task=deckFinishTask(p,base,plan);
            try{finish=acceptDeckFinish(p,base,plan,task,parseModelValue(await deps.modelCall(p,task.prompt,activity,log,{nodeKey:'outline:finish:'+revision,jsonSchema:task.schema,maxOutputTokens:8192})),{deferLabelGaps:true});}
            catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} outline finishing call failed: ${String(error?.message||error).slice(0,120)}`);finish={chapters:plan.chapters.map(chapter=>chapter.headings[0]),takeaway:null,labels:new Map(),notes:[{code:'outline_finish_unavailable',message:'Chapter titles, the closing takeaway and point labels could not be written; chapters use their first heading.'}]};}
            if(finish.labelGaps?.length){const completion=labelCompletionTask(p,base,finish);
              labelReply=deps.modelCall(p,completion.prompt,activity,log,{nodeKey:'outline:finish:'+revision+':labels',jsonSchema:completion.schema,maxOutputTokens:4096}).then(value=>({value}),error=>({error}));}
            // A refused takeaway is asked for once more, else the deck ends with its last card (Fable review).
            if(!finish.takeaway&&finish.takeawayProblems?.length){
              const correction=takeawayCorrectionTask(p,base,task,finish.takeawayProblems);let problems=finish.takeawayProblems;
              // A transport failure is retried once, like a topic call (live fz-r13: one network error dropped the takeaway).
              const ask=async retry=>{try{return await deps.modelCall(p,correction.prompt,activity,log,{nodeKey:'outline:finish:'+revision+':takeaway'+(retry?':retry':''),jsonSchema:correction.schema,maxOutputTokens:2048});}
                catch(error){if(retry||error?.code==='cancelled'||!['network','timeout','transport'].includes(error?.code))throw error;log(`ppt ${id} takeaway correction ${error.code}; retried once`);return ask(true);}};
              try{const accepted=acceptTakeaway(p,base,task,parseModelValue(await ask(false))?.takeaway);problems=accepted.problems;
                const kept=accepted.takeaway?accepted:accepted.fallback||finish.takeawayFallback;
                if(kept)finish={...finish,takeaway:kept.takeaway,notes:[...finish.notes.filter(note=>note.code!=='takeaway_dropped'),...kept.notes]};}
              catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} takeaway correction failed: ${String(error?.message||error).slice(0,120)}`);
                if(finish.takeawayFallback)finish={...finish,takeaway:finish.takeawayFallback.takeaway,notes:[...finish.notes.filter(note=>note.code!=='takeaway_dropped'),...finish.takeawayFallback.notes]};}
              if(!finish.takeaway)finish={...finish,notes:[...finish.notes.filter(note=>note.code!=='takeaway_dropped'),takeawayDropped(problems)]};
            }
            // A refused cover title is asked for once more with the measured reason (Fable 2026-10-26).
            if(finish.coverProblem){const correction=coverCorrectionTask(p,base,task,finish.coverProblem);
              try{const cover=acceptCover(p,base,task,parseModelValue(await deps.modelCall(p,correction.prompt,activity,log,{nodeKey:'outline:finish:'+revision+':cover',jsonSchema:correction.schema,maxOutputTokens:1024})));
                if(!cover.coverProblem)finish={...finish,coverTitle:cover.coverTitle,coverTranslated:cover.coverTranslated,coverFullTitle:cover.coverFullTitle,coverProblem:'',notes:finish.notes.filter(note=>!['cover_title_untranslated','cover_title_fallback'].includes(note.code))};}
              catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} cover correction failed: ${String(error?.message||error).slice(0,120)}`);}}
          }
          // Partially labelled cards: one follow-up call for the missing labels (Fable plan T22).
          if(labelReply){const reply=await labelReply;
            try{if(reply.error)throw reply.error;finish=settleLabels(p,base,finish,parseModelValue(reply.value));}
            catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} label completion failed: ${String(error?.message||error).slice(0,120)}`);finish=settleLabels(p,base,finish,null);}}
          // Points on small cards that repeat the closing statement are reworded once (Fable plan T19).
          if(finish.takeaway?.text){const echo=echoRewriteTask(p,results.map(result=>result.reply),finish.takeaway.text);
            if(echo){let reply=null;try{reply=parseModelValue(await deps.modelCall(p,echo.prompt,activity,log,{nodeKey:'outline:finish:'+revision+':echo',jsonSchema:echo.schema,maxOutputTokens:4096}));}catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} echo rewrite failed: ${String(error?.message||error).slice(0,120)}`);}
              const applied=applyEchoRewrites(p,results.map(result=>result.reply),echo,reply,finish.takeaway.text);results.forEach((result,k)=>{result.reply=applied.replies[k];});finish={...finish,notes:[...finish.notes,...applied.notes]};}}
          // The closing page is part of the reviewed deck, so the page count includes it.
          const raw=ensureOutlineClosing(p,assembleCardDeck(p,tasks,results.map(result=>result.reply),plan,finish));
          // A point the confirmation check would refuse gets one targeted rewrite,
          // kept only when it clears and changes nothing else factual; the author
          // sees each rewrite (Fable, 2026-10-24; report 013a8282). Others stay for the author.
          const factRepairs=[],repaired=new Set();
          for(const issue of cardFactIssues({...p,outline:raw.slides})){
const key=issue.pageIndex+':'+issue.pointIndex;if(repaired.has(key)||repaired.size>=8)continue;repaired.add(key);
            const task=cardFactRepairTask(p,raw.slides,issue);if(!task)continue;
            let reply=null;try{reply=parseModelValue(await deps.modelCall(p,task.prompt,activity,log,{nodeKey:`outline:card-fact:${cardRevision}:${key}`,jsonSchema:task.schema,maxOutputTokens:1024}));}catch(error){if(error?.code==='cancelled')throw error;log(`ppt ${id} card fact rewrite failed: ${String(error?.message||error).slice(0,120)}`);}
            const before=raw.slides[issue.pageIndex].keyPoints[issue.pointIndex].text,text=acceptCardFactRepair(p,raw.slides,issue,reply,cardFactIssues);
            if(text){raw.slides[issue.pageIndex].keyPoints[issue.pointIndex]={...raw.slides[issue.pageIndex].keyPoints[issue.pointIndex],text};factRepairs.push({pageIndex:issue.pageIndex,pointIndex:issue.pointIndex,code:issue.code,before,after:text});}
          }
          const assemblyNotes=raw.notes||[];delete raw.notes;
          const excludedTopics=(p.planningContract.deckPlan?.excludedSections||[]).map(title=>({code:'card_topic_excluded',message:`"${title}" has only content the presentation policy leaves out (such as code); it has no card.`}));
          const repairNotes=factRepairs.map(repair=>({code:'card_fact_repaired',message:`Page ${repair.pageIndex+1}: a point was rewritten to match its source: "${repair.before.slice(0,120)}" → "${repair.after.slice(0,120)}".`}));
          // Per-card formula notes come last, so the cap never hides another note.
          const advisories=[...excludedTopics,...repairNotes,...results.flatMap(result=>result.advisories),...assemblyNotes,...finish.notes].sort((a,b)=>(a.code==='approximate_formula')-(b.code==='approximate_formula')).slice(0,60);
          saved={revision:cardRevision,raw,...(factRepairs.length?{factRepairs}:{}),advisories,summary:cardDeckSummary(p,raw,plan,finish.notes),reason:`${raw.slides.length} pages for the ${plan.pages?.content??tasks.length} content cards of the chosen length, with the cover${raw.slides.some(slide=>slide.cardFrame==='divider')?', chapter dividers':''}${raw.slides.some(slide=>slide.cardFrame==='takeaway')?' and a closing takeaway':''}.`};
        }
        saveForming('fitting');
        // D3 (2026-10-31): the post-processing runs in a worker thread so the
        // server keeps answering requests (docx: 40-100 s with none answered).
        {const processed=await runCardPostProcess(p,saved,{revision,id,log,modelCall:(prompt,options)=>deps.modelCall(p,prompt,activity,log,options)});
          for(const key of Object.keys(p))if(!(key in processed.project))delete p[key];Object.assign(p,processed.project);saved=processed.saved;}
        p.pageDecision={...p.pageDecision,mode:'explicit',source:'card_outline',finalPageCount:p.pages,confirmedAt:null};
        // The table fonts planned above go with the plan: confirmation would
        // otherwise measure every table again (docx 2026-10-31: 23-26 s, server blocked).
        const current=live();current.pages=p.pages;current.pageDecision=p.pageDecision;current.planningContract=p.planningContract;current.templateFidelity=p.templateFidelity;if(p.tableTypography)current.tableTypography=p.tableTypography;store.save(current);
          rawOutline=structuredClone(saved.raw);
      }
      saveCandidate(rawOutline);saveForming('checking');
      const assessed=await assessCandidate(p,rawOutline);
      const titleIssues=[...inspectNativeOutlineTitles(assessed.project,assessed.rawOutline.slides),...inspectSystemOutlineTitles(assessed.project,assessed.rawOutline.slides),...inspectNativeCoverTitle(assessed.project,assessed.outline)];
      rawOutline=assessed.rawOutline;saveCandidate(rawOutline,assessed.issues);
      const outline=assessed.outline;
      const measuredSourceFits=new Map();
      const frozenSourceIssues=inspectFrozenOutlineSources(assessed.project,assessed.outline,assessed.planning,{onFit:({pageIndex,fit})=>measuredSourceFits.set(pageIndex,fit)});
      // A source object that fits the actual native binding is measured there, not by the generic canvas estimate.
      for(const [pageIndex,fit] of measuredSourceFits){
        if(frozenSourceIssues.some(i=>i.pageIndex===pageIndex))continue;
        const prior=rawOutline.slides[pageIndex]?.densityFit;
        if(!prior||prior.capacity_ok!==false)continue;
        const measured={...prior,capacity_ok:true,predictedOverflow:0,layoutId:fit.layoutId,fontSizePt:fit.fontSizePt,usedHeight:fit.usedHeight,availableHeight:fit.availableHeight,availableContentRect:fit.canvas,measurementBasis:'production_frozen_source_binding',preliminaryEstimate:{capacity_ok:prior.capacity_ok,predictedOverflow:prior.predictedOverflow,layoutId:prior.layoutId,availableContentRect:prior.availableContentRect}};
        rawOutline.slides[pageIndex].densityFit=measured;outline[pageIndex].densityFit=measured;
        (assessed.corrections||=[]).push({code:'capacity_fit_remeasured',pageIndex,basis:'same frozen content fits actual native binding; no page budget or source change'});
      }
      // Every finding is listed for the author, who edits the cards; a page that
      // overflows continues on another during generation.
      const outlineWarnings=[
        ...(p.planningContract.cardOutline?.advisories||[]).map(advisory=>({code:advisory.code,message:advisory.message,...(advisory.sourceUnitIds?{sourceUnitIds:advisory.sourceUnitIds}:{}),resolution:'review_in_outline'})),
        // A card point stating a quantity its sources do not (or untypeset TeX) is listed for the author (report 98981dcf).
        ...cardFactIssues({...p,outline}).map(issue=>({...issue,resolution:'review_in_outline',requiresReview:true})),
        ...frozenSourceIssues.map(issue=>({...issue,resolution:'review_in_outline',requiresReview:true})),
        ...titleIssues.map(issue=>({code:issue.code||'native_title_capacity',pageIndex:issue.pageIndex,message:issue.message,resolution:'review_in_outline',requiresReview:true})),
        ...assessed.issues.filter(issue=>issue.code==='outline_repeated_claim'||issue.code==='outline_ungrounded_page'&&!p.requestedOutline).map(issue=>({code:issue.code,pageIndex:issue.details?.pageIndex,message:issue.message,resolution:'review_in_outline'})),
        ...(assessed.project.nativeCoverageWarnings||[]).map(warning=>({code:'native_coverage_unavailable',message:warning.message,details:{templatePage:warning.templatePage},resolution:'template_layout_skipped'})),
        ...sourceReadinessWarnings(assessed.project),
        // A title or section in the other language than the chosen output language.
        ...(p.generationPolicy?.language?.mode==='output'?rawOutline.slides.flatMap((slide,pageIndex)=>slide.titleLocked||pageIndex===0&&p.deckTitle?.locked?[]:['title','section'].filter(field=>{const value=String(slide[field]||''),han=(value.match(/[\u3400-\u9fff]/gu)||[]).length,latin=(value.match(/[A-Za-z]/gu)||[]).length;return String(p.generationPolicy.language.locale).startsWith('zh')?latin>12&&!han:han>3;}).map(field=>({code:'output_language_mismatch',pageIndex,field,message:`Page ${pageIndex+1}: the ${field} is not in the chosen language; edit it in the outline.`,resolution:'review_in_outline'}))):[]),
      ];
      if(outlineWarnings.length)log(`ppt ${id} outline accepted with ${outlineWarnings.length} listed warning(s): ${[...new Set(outlineWarnings.map(w=>w.code))].join(', ')}`);
      const current=live();
      await prepareNavigationPlan(assessed.project,finalDeckNavigation({...assessed.project,navigationPlan:undefined,deck:null}).entries,(prompt,nodeKey)=>deps.modelCall(p,prompt,activity,log,{nodeKey,maxOutputTokens:8192}),async planned=>{const latest=store.get(uid,id);if(latest?.status!=='outlining')throw outlineError('cancelled');if(planned.navigationDraft)latest.navigationDraft=planned.navigationDraft;else delete latest.navigationDraft;if(planned.navigationPlan)latest.navigationPlan=planned.navigationPlan;store.save(latest);});
      current.navigationPlan=assessed.project.navigationPlan;
      current.pages=assessed.project.pages;
      if(current.planningContract?.cardOutline){const saved=current.planningContract.cardOutline;current.planningContract.cardOutline={...saved,raw:rawOutline,summary:{...cardDeckSummary(assessed.project,rawOutline,{}),warnings:saved.summary?.warnings||[]},reason:`${current.pages} pages, including ${rawOutline.slides.filter(s=>s.figurePage).length} separate figure pages after measured inline figure placement.`};}
      if(assessed.project.contentSelection){current.contentSelection=assessed.project.contentSelection;current.originalSourceInventory=assessed.project.originalSourceInventory;current.source=assessed.project.source;}
      if(assessed.project.templateFidelity)current.templateFidelity=assessed.project.templateFidelity;
      if(assessed.project.tableTypography||p.tableTypography)current.tableTypography={...(p.tableTypography||{}),...(assessed.project.tableTypography||{})};
      const corrections=[...(assessed.corrections||[]),...(assessed.project.navigationPlan?.corrections||[])];
      current.outlineCorrections={version:1,items:corrections.slice(0,200),summary:summarizeOutlineCorrections(corrections),warnings:outlineWarnings.slice(0,100)};
      const proceed=Boolean(current.autoGenerate)&&!outlineWarnings.some(warning=>warning.requiresReview);
      current.pageDecision={...current.pageDecision,finalPageCount:current.pages,densityProfileId:densityProfile().id,estimateVersion:1,fitValidated:rawOutline.slides?.slice(1).every(s=>s.densityFit?.capacity_ok)||false,
        ...(proceed?{confirmedAt:new Date().toISOString()}:{}),concision:outlineConcisionMetrics(current,outline,slide=>pageLoad(current,slide,rawOutline.selection||[]))};
      delete current.pageDecision.growth;
      current.outline=outline;
      restoreOutlineSubjectDrafts(current);
      if(current.pageBudget?.version===2)current.pageBudget={...current.pageBudget,finalPageCount:current.pages,changes:(current.outlineTrace||[]).map(t=>({pages:t.pages,issues:t.issues})),requiresConfirmation:false};
      current.outlineAcceptance={version:1,schema:true,ownership:true,semantic:true,physical:true,confirmable:true,issues:outlineWarnings.filter(w=>w.requiresReview)};
      const contract=current.planningContract;
      contract.phase='page_plan_ready';contract.capacityRevision=capacityIdentity(current);contract.actualPageIds=outline.map(s=>s.id);
      contract.physicalBudgets=Object.fromEntries(outline.map(s=>[s.id,{pageId:s.id,planRevision:contract.capacityRevision,layoutId:s.densityFit?.layoutId,fontSizePt:s.densityFit?.fontSizePt,geometry:s.densityFit?.availableContentRect,sourceUnitIds:s.sourceUnitIds,sourceArtifactRanges:s.sourceArtifactRanges}]));
      contract.changes=[{from:current.inputUnderstanding?.recommended,to:current.pages,reason:contract.cardOutline?.reason},...(contract.changes||[])].slice(0,20);
      current.candidateOutline={...candidateRecord(current,rawOutline,[],true),acceptance:current.outlineAcceptance};
      delete current.pendingEditorialRepair;delete current.outlineRebalance;delete current.failure;
      current.status = proceed ? 'generating' : 'outline_ready'; current.stage = proceed ? 'content' : 'outline'; current.error = '';
      if (current.deckTitle?.source !== 'user') {
        if(current.titleSource==='derived'&&outline[0]?.title){const identity=outline[0]?.coverSummarized?null:displayedDocumentTitle(current);current.title=identity?.variants?.map(v=>v.text).join(' | ').slice(0,160)||outline[0].title;}
        current.deckTitle = { text: outline[0]?.title || current.title, raw: outline[0]?.title || current.title, source: 'agent', locked: false };
      }
      current.planning = buildPlanning(current, rawOutline, outline);
      current.planning.contentDistribution=contentDistribution(current,outline);
      synchronizePlan(current, 'outline-confirmation');
      // An update deck's cards are new pages; there is no keep/rewrite mapping (S11).
      current.diff = current.update ? null : diffSummary(current);
      generateAfterOutline = proceed;
      delete current.autoGenerate;delete current.requestedOutline;delete current.outlineSeed;delete current.nativeTitleRepairSeed;
      store.save(current);
      try { transitionNode(current, 'outline', 'completed', { slideCount: outline.length }); emitRunProgress(current, 'outline.ready', { outline }); } catch {}
    } catch (error) { if(error.code!=='cancelled'){if(lastModelStep&&error&&typeof error==='object'&&!error.afterStep)error.afterStep=lastModelStep;fail(uid, id, 'outline', error, log);} }
    finally { running.delete(id); if (generateAfterOutline) startGeneration(uid, id, activity, log, deps); }
  })();
}
// A card page without source objects never shows the writer's commentary
// (normalizeSlide drops it), so writer checks and repairs skip it (Fable,
// 2026-10-26; 3143 g2u page 4: bare TeX in an unshown commentary exhausted the page).
function writerCommentaryUnused(project,outlineSlide){
  return Boolean(cardsFlow(project)&&project.templateFidelity?.mode==='preserve'&&Array.isArray(outlineSlide?.cardObjects)&&!outlineSlide.cardObjects.length);
}
async function writeWithContractRepair({prompt,call,normalize,nodeKey,maxRepairs=3,allowOptionalOmission=true,discardCommentary=false}) {
  let nextPrompt=prompt,response,localScope=null,localBase=null,localAudit=[];
  const internalReferenceIds=new Set();
  const visitIds=value=>{if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){if(['id','sourceUnitId'].includes(key)&&typeof v==='string'&&/^[bc]_\d{3,}$/u.test(v))internalReferenceIds.add(v);else if(['chunkRefs','sourceRefs'].includes(key)&&Array.isArray(v))for(const id of v)if(typeof id==='string'&&/^[bc]_\d{3,}$/u.test(id))internalReferenceIds.add(id);else{}if(v&&typeof v==='object')visitIds(v);}};
  for(const tag of ['page_owned_source_content','slide_contract','source_packet']){try{visitIds(JSON.parse(prompt.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>','u'))?.[1]||'null'));}catch{}}

  for(let attempt=0;attempt<=maxRepairs;attempt++){
    response=undefined;
    try{
      const reply=await call(nextPrompt,attempt?`${nodeKey}:contract-repair:${attempt}`:nodeKey);
      if(localScope){const applied=applyWriterLocalDelta(localBase,localScope,reply);response=applied.value;localAudit.push(applied.audit);}
      else response=reply;
      if(discardCommentary&&response&&typeof response==='object'&&Array.isArray(response.sourceCommentary)&&response.sourceCommentary.length)response={...response,sourceCommentary:[]};
      let mathScope=writerLocalRepairScope(response,new Error('writer_math_invalid'));
      // Bare TeX is wrapped in $…$ by code before a model repair (Fable, 2026-10-26; 3143 g2u page 4).
      const wrapped=mathScope&&wrapBareMath(response,mathScope);
      if(wrapped){response=wrapped.value;localAudit.push(wrapped.audit);mathScope=null;}
      if(mathScope)throw new Error(`writer_math_invalid: ${JSON.stringify(mathScope.targets.map(({path,start,end})=>({path,start,end})))}`);
      const content=normalize(response);
      if(localAudit.length)content.localSpanRepair={attempts:localAudit.length,audit:localAudit};
      return {content,attempts:attempt};
    }
    catch(error){
      // Invalid deltas never fall back to a broad page rewrite. Reuse the
      // immutable base and the same finite scope within the original bound.
      if(/^writer_local_repair_/u.test(String(error.message))){if(attempt===maxRepairs)throw error;nextPrompt=writerLocalRepairPrompt(writerCorrectionContext(prompt),localBase,localScope,error)+'\n<rejected_delta>'+JSON.stringify({error:error.message,response:response??null})+'</rejected_delta> The previous delta was invalid. Preserve the exact numeric tokens of each allowed string, including numeric identifiers such as p05; shorten the surrounding words instead. The unchanged base and allowed targets remain authoritative.';continue;}
      const contractFailure=Array.isArray(error.writerFieldPath)||error.code==='invalid_json'||/^ppt_invalid_json$/u.test(String(error.message))||/writer changed the confirmed outline title|rendered_title_capacity|writer_math_invalid|模型未返回有效的结构化内容|slide \d+ title must be text|bullet must be text|source_artifact_capacity|writer cover contract|writer source-only contract|invalid visible native copy type|invalid source commentary|invalid source evidence selection|writer omitted|source artifact|row range|range.*table|template slot.*safety|block id|block \d+ invalid|duplicate block|visual blocks per slide|unsupported visual block|table dimensions invalid|chart data invalid|shape invalid/iu.test(String(error.message));
      if(contractFailure&&!error.code)error.code=/source_artifact_capacity/iu.test(error.message)?'capacity_invalid':/writer omitted|source evidence selection|row range|range.*table/iu.test(error.message)?'coverage_invalid':'schema_invalid';
      if(attempt===maxRepairs||!contractFailure)throw error;
      let contract;try{contract=JSON.parse(prompt.match(/<slide_contract>([\s\S]*?)<\/slide_contract>/u)?.[1]||'null');}catch{}
      const boundIds=new Set([...(response?.sourceArtifacts||[]).map(ref=>ref.sourceUnitId),...(response?.sourceEvidenceIds||[])]);
      const allOwnedSourceBound=Boolean(contract?.sourceUnitIds?.length&&contract.sourceUnitIds.every(id=>boundIds.has(id)));
      localScope=writerLocalRepairScope(response,error,{allOwnedSourceBound,allowOptionalOmission,internalReferenceIds:[...internalReferenceIds]});localBase=response;
      if(localScope){
        if(localScope.optionalCommentaryCanOmit&&localScope.targets.every(t=>t.kind==='commentary')){
          const omitted=applyWriterLocalDelta(response,localScope,{edits:localScope.targets.map(t=>({path:t.path,start:t.start,end:t.end,before:t.before,after:''}))});
          try{const content=normalize(omitted.value);content.localSpanRepair={attempts:localAudit.length+1,audit:[...localAudit,{...omitted.audit,basis:'measured overflowing optional commentary; all owned frozen source retained and normal validator passed'}]};return {content,attempts:attempt+1};}catch{ /* The full validator rejected omission; use the same bounded model repair. */ }
        }
        nextPrompt=writerLocalRepairPrompt(writerCorrectionContext(prompt),response,localScope,error);continue;}
      nextPrompt=`${writerCorrectionContext(prompt)}\n<invalid_response>${response===undefined?'No parseable JSON was returned':JSON.stringify(response)}</invalid_response>\n<writer_contract_error>${String(error.message)}</writer_contract_error>\n<repair>Return valid JSON in the same schema. Preserve exact frozen sources, all selected cells and necessary facts. Visual block id must match ^[A-Za-z0-9_-]{1,40}$ and be unique; do not put human labels or step captions in id. blocks is only for image/chart/table/shape with valid IDs; textual headings and paragraphs belong in contentBlocks, never blocks. When <bound_source_body> is present, contentBlocks, blocks and sourceCommentary must ALL be []; the frozen source objects already display every required fact. Correct the precise type/count/height error above; do not repeat a rejected expanded draft. For sourceFits=true, keep all frozen structures and required excerpts. Use the measured source_commentary_budget: if its paragraphCount is one, return no more than one paragraph, targeting 85% of singleParagraphCjkCharacters in total including punctuation/formula text. Never repeat facts already automatically displayed by frozen sourceArtifacts/sourceEvidenceIds. Remove only duplicate explanation, never required facts or locked excerpts. Do not change source row ranges, fonts or page count.</repair>`;
    }
  }
}
function revalidateCompletedCopy(project) {
  const reopened=[];
  const fidelity=project.templateFidelity;
  if(fidelity?.mode==='preserve'&&project.deck?.slides?.length){
    if(fidelity.sourceCatalog?.some(s=>s.nodes?.some(n=>n.type==='image'&&!n.content?.dataUrl))){
      const cached=store.readTemplateIR(project.templateSpec?.kind==='managed'?'managed':project.uid,project.template,fidelity.sha256);
      if(cached?.parserVersion===PPTX_IR_VERSION&&cached.imported?.deck?.slides?.length===fidelity.originalSlideCount){
        fidelity.sourceCatalog=structuredClone(cached.imported.deck.slides);
        project.runtime ||= {};project.runtime.templateCatalogRecovery={templateHash:fidelity.sha256,basis:'complete original parser cache; immutable native media retained'};
      }
    }
    project.sourceFontFloors={...project.sourceFontFloors};
    for(const s of project.deck.slides){const fonts=s.nodes?.filter(isSourceOwnedNode).map(n=>Number(n.style?.fontSizePt)||0)||[];if(fonts.length)project.sourceFontFloors[s.id]=Math.max(project.sourceFontFloors[s.id]||0,...fonts);}
    const beforeMap=[...fidelity.slideMap];confirmNativeOutlineFit(project,{useRenderedLegacyTitles:true,...(project.confirmedOutline?{warnOnly:true,preserveAssignment:true}:{})});
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
    const previousEvidence=contract.requiredEvidenceIds||[];
    const ownedEvidence=previousEvidence.filter(id=>evidenceBelongsToSlide(project.source,outline,(project.source?.semantic?.evidenceAtoms||[]).find(atom=>atom.id===id)));
    if(JSON.stringify(previousEvidence)!==JSON.stringify(ownedEvidence)){
      project.runtime ||= {};
      (project.runtime.sourceEvidenceRevalidation ||= []).push({slideId:outline.id,runId:project.currentRunId,sourceHash:project.source?.sha256,previousEvidence,currentEvidence:ownedEvidence,basis:'exact frozen source-unit/range ownership; retrieval chunks may span neighboring pages'});
      contract.requiredEvidenceIds=ownedEvidence;
    }
    const details=sourceBackedDetails(outline,project.source);
    if(JSON.stringify(contract.requiredDetails||[])!==JSON.stringify(details)){
      project.runtime ||= {};
      (project.runtime.sourceDetailRevalidation ||= []).push({slideId:outline.id,runId:project.currentRunId,previousDetails:contract.requiredDetails||[],currentDetails:details,basis:'current source-owned units; neighboring chapter formulas cannot create obligations'});
      contract.requiredDetails=details;
    }
  }
  for(const [index,slide]of project.outline.entries()){
    const recovered=recoverSourceCheckpoint(project,slide,index);
    if(recovered){
      project.nodes[slide.id]={...project.nodes[slide.id],status:'done',slide:recovered.slide};
      project.runtime.slides[slide.id]=recovered.state;
      (project.runtime.sourceCheckpointRevalidation ||= []).push(recovered.audit);
      project.dagNodes ||= {};project.dagNodes[dagNodeId('content',slide.id)]=nodeRecord('done',project.dagNodes[dagNodeId('content',slide.id)],{reason:recovered.audit.basis});
      invalidateReviews(project);
    }
    const node=project.nodes?.[slide.id];if(node?.status!=='done'||!node.slide||project.runtime?.slides?.[slide.id]?.accepted)continue;
    // Manual editor content is authoritative; quality and native export still
    // inspect it, but retry must not regenerate it from older source caches.
    if((project.editing?.epochs?.[slide.id]||0)>0)continue;
    if((node.slide.nodes||[]).some(item=>item.locked&&['text','list','table','chart'].includes(item.type)))continue;
    const oldEyebrow=node.slide.copy?.eyebrow,newEyebrow=diagramEyebrow(project,slide,oldEyebrow);
    if(oldEyebrow&&oldEyebrow!==newEyebrow){
      node.slide.copy={...node.slide.copy,eyebrow:newEyebrow};
      for(const n of node.slide.nodes||[])if(n.semanticRole==='eyebrow')n.content={...n.content,...richTextContent(newEyebrow)};
      node.slide.diagramNavigationRepair={before:oldEyebrow,after:newEyebrow,basis:'source diagram branch scope; original source and body unchanged'};
      invalidateReviews(project);
    }
    if(project.templateFidelity?.mode!=='preserve'&&slide.sourceImageIds?.length){
      const before=digest(node.slide);bindSourceMedia(project,node.slide,slide.sourceImageIds,index);
      if(before!==digest(node.slide))invalidateReviews(project);
    }
    const coverNeedsRewrite=index===0&&!(slide.sourceUnitIds||[]).length&&!(node.slide.sourceArtifactNodes||[]).some(n=>n.sourceArtifact)&&
      (project.templateFidelity?.mode!=='preserve'||!project.templateFidelity.slides[index]?.slots?.some(slot=>slot.role==='content'&&slot.purpose!=='footnote'))&&
      ((node.slide.copy?.blocks||[]).length||(node.slide.bullets||[]).length||(node.slide.sourceArtifactNodes||[]).some(n=>n.semanticRole==='source-explanation'&&!n.content?.derivedFrom));
    if(coverNeedsRewrite&&(!project.uid||!operationHistory(project.uid,project.id).length)){
      const issues=[{code:'template_cover_body',severity:'error',repair:'recompose',message:'The title-only cover has an old unowned body draft. Regenerate title/navigation only; retain all frozen source units on their existing content pages.'}];node.status='pending';node.retryCopyIssues=issues;
      project.dagNodes ||= {};project.dagNodes[dagNodeId('content',slide.id)]=nodeRecord('pending',project.dagNodes[dagNodeId('content',slide.id)],{reason:'revalidate title-only cover contract'});reopened.push({slideId:slide.id,issues});continue;
    }
    if(cardsFlow(project)&&slide.figurePage){
      const before=digest(node.slide);bindSourceMedia(project,node.slide,slide.sourceImageIds||[],index);
      if(before!==digest(node.slide))invalidateReviews(project);
      continue;
    }
    // Refit generated theme cards through their own point/figure binder.
    // Generic source-artifact rebinding does not own inline figure IDs.
    if(cardsFlow(project)&&node.slide.cardPage?.mode==='theme'){
      const before=digest(node.slide);
      try{bindThemeCardPage(project,node.slide,index,slide);}
      catch(error){if(error.code!=='capacity_invalid')throw error;node.status='pending';node.retryCopyIssues=[{code:'card_page_capacity',severity:'error',repair:'recompose',message:error.message}];reopened.push({slideId:slide.id,issues:node.retryCopyIssues});continue;}
      if(before!==digest(node.slide))invalidateReviews(project);
      continue;
    }
    const staleCodeFit=!project.templateFidelity&&!project.editing?.epochs?.[slide.id]&&node.slide.sourceArtifactFit?.renderContractVersion!==RENDER_CONTRACT_VERSION&&node.slide.sourceArtifactNodes?.some(n=>n.content?.codeBlock);
    if(node.slide.sourceArtifactFit?.canvas&&(project.templateFidelity||staleCodeFit)){
      // Recompute media-aware geometry from the same canonical source selection.
      // A retry must not retire artwork that the accepted fit deliberately kept.
      const before=digest(node.slide),sourceNodes=node.slide.sourceArtifactNodes||[];
      const refs=sourceNodes.filter(item=>item.sourceArtifact).map(item=>{const {sourceUnitId,rowStart,rowEnd,lineStart,lineEnd,tableRepresentation}=item.sourceArtifact;return {sourceUnitId,...(tableRepresentation==='table'?{tableRepresentation}:{}),...(rowStart!==undefined?{rowStart,rowEnd}:{}),...(lineStart!==undefined?{lineStart,lineEnd}:{})};});
      const uniqueRefs=[...new Map(refs.map(ref=>[JSON.stringify(ref),ref])).values()];
      const evidenceIds=[...new Set(sourceNodes.flatMap(item=>item.content?.sourceEvidenceIds||[]))];
      const commentary=sourceNodes.filter(item=>!item.sourceArtifact&&!item.content?.derivedFrom&&!item.content?.sourceEvidenceIds?.length).map(item=>({type:item.content?.pointType||'mechanism',text:item.content?.rawText||item.content?.richText?.source||item.content?.text||''}));
      const original=structuredClone(node.slide);
      try{bindSourceArtifacts(sourceBindingProject(project,node.slide,index),node.slide,uniqueRefs,index,commentary,evidenceIds);}
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
      if(project.templateFidelity&&commentary.length&&project.generationPolicy?.content==='full_source'){
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
/** Two frames are the same layout when they differ only in output position. */
const framePositionFree=frame=>frame&&{...frame,index:undefined,nodes:(frame.nodes||[]).map(node=>node.nativeRef?{...node,nativeRef:{...node.nativeRef,slideIndex:undefined}}:node)};
const sameFrame=(a,b)=>digest(framePositionFree(a))===digest(framePositionFree(b));
/** Puts back the native frame of each finished page that a new schedule moved. */
function pinFinishedFrames(p,nextProject,nextOutline,changed){
 const finished=new Set(['done','accepted']),fidelity=nextProject.templateFidelity;
 if(!p.templateFidelity||!fidelity?.slides)return;
 for(const [i,item]of nextOutline.entries()){
  if(changed.has(item.id)||!finished.has(p.nodes?.[item.id]?.status))continue;
  const oldIndex=p.outline.findIndex(s=>s.id===item.id);
  if(sameFrame(p.templateFidelity.slides[oldIndex],fidelity.slides[i]))continue;
  // The frame moves with its page: its output position is the new one (the
  // native nodes rebuilt from it must own this page; live fz-r5's takeaway
  // kept index 24 at 25 and failed the template asset check).
  const frame=structuredClone(p.templateFidelity.slides[oldIndex]);
  if(Number.isInteger(frame.index))frame.index=i;
  for(const node of frame.nodes||[])if(node.nativeRef&&Number.isInteger(node.nativeRef.slideIndex))node.nativeRef.slideIndex=i;
  fidelity.slides[i]=frame;
  if(Array.isArray(fidelity.slideMap)&&Array.isArray(p.templateFidelity.slideMap))fidelity.slideMap[i]=p.templateFidelity.slideMap[oldIndex];
 }
}
/** A continuation keeps the native frame of every finished page; a page not
 * written yet takes the frame the new schedule gives it (Fable R4: the old
 * rule also froze pending pages, so a 39-page deck never continued). Returns
 * the old index of a finished page whose frame would move, or -1. */
function movedFinishedFrame(p,nextProject,nextOutline,changed){
 const finished=new Set(['done','accepted']);
 if(!p.templateFidelity)return -1;
 for(const [i,item]of nextOutline.entries()){
  if(changed.has(item.id))continue;
  const oldIndex=p.outline.findIndex(s=>s.id===item.id);
  if(finished.has(p.nodes?.[item.id]?.status)&&!sameFrame(p.templateFidelity.slides[oldIndex],nextProject.templateFidelity?.slides?.[i]))return oldIndex;
 }
 return -1;
}
async function tryGenerationContinuation(uid,id,error,activity,log,deps){
 return repairCapacityBatch({getProject:()=>store.get(uid,id),repair:pageId=>tryPageContinuation(uid,id,error,activity,log,deps,pageId),maxRepairs:CARD_CONTINUATIONS});
}
async function tryPageContinuation(uid,id,error,activity,log,deps,targetId){
 const p=store.get(uid,id),causes=error.causes?.map(c=>c.error)||[error];
 // An overfull card page splits by code (no model call), so a deck may continue several.
 if(!cardsFlow(p)||p.status!=='generating'||p.runtime?.pauseRequested||Number(p.planningContract.generationContinuations||0)>=CARD_CONTINUATIONS||!causes.every(e=>/capacity|overflow|template_slot/iu.test(String(e.code||'')+' '+String(e.message||''))))return false;
 const index=p.outline.findIndex(s=>s.id===targetId&&['failed','pending'].includes(p.nodes?.[s.id]?.status)),page=p.outline[index];
 if(index<0)return true;
 // Every declined continuation is logged and kept with its reason (Fable R4).
 const decline=async reason=>{log(`ppt ${id} capacity continuation declined for page ${index+1}: ${reason}`);await enqueueProject(uid,id,()=>{const latest=store.get(uid,id);if(latest){latest.runtime={...latest.runtime,continuationDeclines:[...(latest.runtime?.continuationDeclines||[]),{pageId:page?.id,reason,at:new Date().toISOString()}].slice(-12)};store.save(latest);}});return false;};
 const raw=p.candidateOutline?.executionPlan;if(!raw||raw.slides.length!==p.outline.length)return decline('no execution plan of the current outline');
 // An object card page continues as measured (Fable R2/R3): the points that
 // fit stay, objects too tall go one per page or by rows/lines.
 const objectPage=Array.isArray(page?.cardObjects)&&page.cardObjects.length>0,hint=page?.cardFigureLayout?{figureFallback:true}:objectPage?objectContinuation(p,index):cardCapacityHint(p,index);
 if(objectPage&&!hint)return decline('a single source object is taller than any page at the body font');
 // A points page that another content frame holds whole moves there instead
 // of continuing; finished pages keep their frames (Fable D6, live mlq-r38).
 if(!objectPage&&!page?.cardFigureLayout){
  const priorFidelity=p.templateFidelity,expectedMove=continuationRevision(p);
  const record=moveCardPageFrame(p,index,(q,i)=>cardScheduleScore(q,i),(q,i)=>{const g=contentCanvas(q,i)?.geometry;return g?g.width*g.height:0;});
  if(record&&movedFinishedFrame({...p,templateFidelity:priorFidelity},p,p.outline,new Set([page.id]))<0){
   const moved=p.templateFidelity;p.templateFidelity=priorFidelity;
   return enqueueProject(uid,id,()=>{
    const current=store.get(uid,id),change={from:current.outline.length,to:current.outline.length,reason:'A card too long for its frame moves to a template page that holds it whole; nothing is split.',logicalCardId:page.logicalCardId,replacedPageId:page.id,pageIds:[page.id],beforeSourceIds:page.sourceUnitIds||[],afterSourceIds:page.sourceUnitIds||[],frameMove:record};
    const next=commitContinuation(current,{...current,templateFidelity:moved},change,expectedMove);
    next.templateSlideMap=[...moved.slideMap];clearDraft(id,page.id);
    store.save(next);emitRunProgress(next,'plan.continuation',change);log(`ppt ${id} page ${index+1} moved to template page ${record.toSource+1} instead of continuing`);return true;
   });
  }
  p.templateFidelity=priorFidelity;
 }
 if(!hint||hint.unfit)return decline('no complete point fits the current frame; semantic adjustment required');
 const expected=continuationRevision(p),proposal=splitCardPage(p,raw,index,hint);if(!proposal)return decline('the card cannot be split');
 const staged={...p,pages:proposal.raw.slides.length,confirmedOutline:undefined,deck:null};
 const assessed=assessOutlineCandidate(staged,proposal.raw);
 // Frozen source objects may move to a native layout that holds them. On a
 // card deck the ownership and capacity findings are review notes, as at the
 // outline (a unit may sit on two cards); a new page that still does not fit
 // continues again on the next attempt (live mlq-r3: every continuation of a
 // deck that cites a unit twice was declined here).
 inspectFrozenOutlineSources(assessed.project,assessed.outline,assessed.planning,{repairNative:true});
 // The pages the card continues on carry its continuation marker on their final frame (T34).
 for(const pageId of proposal.change.pageIds.slice(1)){const at=assessed.outline.findIndex(slide=>slide.id===pageId);if(at<0)continue;const item=assessed.outline[at],title=item.figurePage?(cardTitleFits(assessed.project,at,item)?item.title:fallbackCardTitle(assessed.project,at,item,'')):continuedPageTitle(assessed.project,at,item);if(title!==assessed.outline[at].title)assessed.outline[at]={...assessed.outline[at],title,focus:title};}
 // Reuse unaffected contracts exactly; a finished page keeps its frame (R4):
 // the new schedule's choice for it is put back (live fz-r4: the takeaway moved
 // one position and was given another layout, so every continuation stopped).
 const changed=new Set(proposal.change.pageIds);pinFinishedFrames(p,assessed.project,assessed.outline,changed);
 const moved=movedFinishedFrame(p,assessed.project,assessed.outline,changed);
 if(moved>=0)return decline(`the new schedule moves the frame of finished page ${moved+1}`);
 for(const [i,item]of assessed.outline.entries())if(!changed.has(item.id))assessed.outline[i]=p.outline[p.outline.findIndex(s=>s.id===item.id)];
 // The card's parts are numbered again, the earlier ones included (Fable
 // 2026-10-27, option A): a changed page takes its title now; an unchanged one
 // is retitled after the commit, its finished draft patched in place.
 const parts=numberCardParts({...assessed.project,outline:assessed.outline}),retitled=[];
 for(const [i,title]of parts.titles){const item=assessed.outline[i];if(changed.has(item.id))assessed.outline[i]=withPartTitle(assessed.project,item,title);else retitled.push([item.id,title]);}
 const warning=objectPage?{code:'card_object_page_split',message:`Page ${index+1} ("${String(page.title).slice(0,60)}") did not fit with its source objects and continues on ${proposal.change.pageIds.length-1} more page(s); nothing was cut.`,pageId:page.id,kept:hint.kept??null,reason:hint.each?'objects':hint.ranges?'ranges':'points'}:null;
 return enqueueProject(uid,id,()=>{
   // The run keeps its title freeze: a card deck starts unfrozen, and freezing
   // here showed later pages' titles unnormalized (live mlq-r41 p45 "(5/5)" beside "(4 / 5)").
   const current=store.get(uid,id),next=commitContinuation(current,{...assessed.project,outline:assessed.outline,planning:assessed.planning},proposal.change,expected);
   for(const [pageId,title]of retitled){const at=next.outline.findIndex(slide=>slide.id===pageId);if(at<0)continue;
    const from=next.outline[at].title,node=next.nodes?.[pageId];next.outline[at]=withPartTitle(next,next.outline[at],title);
    if(node?.slide){const patched=patchPartCounter(node.slide,from,title);
     // More than the counter changed: that page alone is drafted again.
     if(patched)next.nodes[pageId]={...node,slide:patched};else{next.editing.epochs[pageId]=Number(next.editing.epochs[pageId]||0)+1;next.nodes[pageId]={status:'pending',attempts:0};delete next.runtime.slides[pageId];clearDraft(id,pageId);}}}
   next.editorialCoverageAcceptance=assessed.project.editorialCoverageAcceptance;next.editorialCoverageAudits=assessed.project.editorialCoverageAudits;next.candidateOutline={...next.candidateOutline,executionPlan:assessed.rawOutline};next.pageDecision={...next.pageDecision,finalPageCount:next.pages};
   next.planningContract.capacityRevision=capacityIdentity(next);next.planningContract.physicalBudgets=Object.fromEntries(next.outline.map(s=>[s.id,{pageId:s.id,planRevision:next.planningContract.capacityRevision,layoutId:s.densityFit?.layoutId,fontSizePt:s.densityFit?.fontSizePt,geometry:s.densityFit?.availableContentRect,sourceUnitIds:s.sourceUnitIds,sourceArtifactRanges:s.sourceArtifactRanges}]));recordOutlineConfirmation(next,{titlesFrozen:current.confirmedOutline?.titlesFrozen!==false});synchronizePlan(next,'authorized-capacity-continuation');startRun(next,'authorized-capacity-continuation');
   for(const pageId of proposal.change.pageIds)clearDraft(id,pageId);
   if(warning){next.runtimeWarnings=[...(next.runtimeWarnings||[]).filter(item=>item.pageId!==warning.pageId||item.code!==warning.code),warning];emitRunProgress(next,'generation.runtime_warning',warning);}
   store.save(next);emitRunProgress(next,'plan.continuation',proposal.change);return true;
 });
}
/** Generation call ledger family: the stage words without page, node, claim or
 * hash identifiers (content, content:critic, review:deck, review:deck:claim_confirmation…). */
const generationFamily=nodeKey=>String(nodeKey||'unknown').split(':').filter(part=>part&&!/^(?:page|slide|node)[_-]|^claim-[0-9a-f]|^s\d+$|^\d+$|^[0-9a-f]{12,}$/u.test(part)).map(part=>part.replace(/-\d+$/u,'')).slice(0,3).join(':')||'unknown';
function startGeneration(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  const lease = acquireGenerationLease(store.get(uid, id)); if (!lease) return;
  let restartAfterContinuation=false;
  running.add(id);
  // A record of the run's model calls by family; nothing is budgeted (the critic
  // rewrite loop the budget bounded was removed with option D, T1).
  const generationCalls={version:1,total:0,byFamily:{}};
  {const metered=deps;deps={...metered,modelCall:(project,prompt,activityArg,logArg,options={},...rest)=>{generationCalls.total++;const family=generationFamily(options?.nodeKey||project?.stage);generationCalls.byFamily[family]=(generationCalls.byFamily[family]||0)+1;return metered.modelCall(project,prompt,activityArg,logArg,options,...rest);}};}
  void (async () => {
    try {
      // The caller's reply goes out first: the run's synchronous preparation
      // (scheduling, binding) can take minutes on a long template deck
      // (live mlq-r36: POST /generate answered after 5 min). Fable D3(b).
      await new Promise(resolve => setImmediate(resolve));
      const p = ensureProjectTemplate(store.get(uid, id));
      if (!p || p.status !== 'generating') return;
      // F12: say before writing, not at publication, that this host cannot
      // render the export for verification (a host-run service may lack soffice).
      if(deps.runtimeCapabilities?.soffice&&!deps.runtimeCapabilities.soffice.available){
        const warning={code:'export_verifier_unavailable',message:'LibreOffice (soffice) is not available to this service, so the exported deck cannot be verified for publication. Install LibreOffice or add its folder to PPT_TOOL_DIRS and restart the service; slides are still written.'};
        await enqueueProject(uid,id,()=>{const latest=store.get(uid,id);if(latest){latest.runtimeWarnings=[...(latest.runtimeWarnings||[]).filter(item=>item.code!==warning.code),warning];store.save(latest);emitRunProgress(latest,'generation.runtime_warning',warning);}});
        log(`ppt ${id} ${warning.code}`);
      }
      // Decks confirmed before topic projection existed still need their
      // minority-language section headings in the deck language (B1).
      if(!p.update)try{await prepareTopicTitleProjection(p,(prompt,nodeKey)=>deps.modelCall(p,prompt,activity,log,{nodeKey,maxOutputTokens:8192}),async projected=>{const current=store.get(uid,id);if(current){current.topicTitleProjection=projected.topicTitleProjection;store.save(current);}});}catch(error){log(`ppt ${id} topic projection skipped: ${String(error?.message||error).slice(0,160)}`);}
      if(p.titleSource==='derived'){const identity=displayedDocumentTitle(p);if(identity?.variants?.length)p.title=identity.variants.map(v=>v.text).join(' | ').slice(0,160);}
      // A card page keeps the layout chosen for its points (option 1); a card page
      // with objects, like any other page, may move to a layout that fits its sources.
      for(let index=1;index<p.outline.length-1;index++){if(cardsFlow(p)&&cardPageScore(p,index)!==null)continue;const changed=repairNativePageAssignment(p,index,(q,i)=>candidateFit(q.outline[i],q,i));if(changed){p.runtime||={};(p.runtime.nativePageRepairs||=[]).push(changed);log(`ppt ${id} measured native page reassignment: page ${index+1}`);}await new Promise(resolve=>setImmediate(resolve));}
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
        if (latest?.nodes?.[slide.id]?.status === 'done' && (!latest.runtime?.slides?.[slide.id]?.preview || !latest.runtime.slides[slide.id].canonicalSlide || latest.runtime.slides[slide.id].renderContractVersion !== RENDER_CONTRACT_VERSION || latest.runtime.slides[slide.id].contentHash !== digest(latest.nodes[slide.id].slide) || latest.runtime.slides[slide.id].epoch !== generationEpoch(latest, slide.id))) { updateSlidePreview(latest, slide.id);
          for (const stage of ['layout', 'preview', 'quality']) transitionNode(latest, `${stage}:${slide.id}`, 'completed', { slideId: slide.id, recovered: true, inputHash: latest.runtime.slides[slide.id].contentHash }, { useInput: true });
          store.save(latest); }
        if (latest?.nodes?.[slide.id]?.status === 'done' && !['done', 'completed'].includes(latest.dagNodes?.[nodeId]?.status))
          transitionNode(latest, nodeId, 'completed', { slideId: slide.id, recovered: true }, { useInput: true });
        await new Promise(resolve=>setImmediate(resolve));
      }

      // Source and media checks only read the outline and the source: one read,
      // every check, one save, so the first page starts at once (2026-10-31;
      // 3195 World Models: 24 s before page 1, from 4 reads + 2 saves of the
      // whole project per page check and 3 + 2 per image check).
      const checkAtOnce = checks => {
        const latest = store.get(uid, id);
        if (!latest || latest.deletedAt || latest.status === 'cancelled') return;
        let changed = false;
        for (const { nodeId, detail = {}, inspect } of checks) {
          if (['done', 'completed'].includes(latest.dagNodes?.[nodeId]?.status)) continue;
          const result = inspect(latest);
          try { transitionNode(latest, nodeId, 'running', detail, { useInput: true, persist: false }); transitionNode(latest, nodeId, 'completed', { result }, { useInput: true, persist: false }); }
          catch { latest.dagNodes ||= {}; latest.dagNodes[nodeId] = nodeRecord('done', latest.dagNodes[nodeId], { ...detail, result }); }
          changed = true;
        }
        if (changed) store.save(latest);
      };
      checkAtOnce(p.outline.map(slide => ({ nodeId: dagNodeId('source', slide.id), inspect: latest => {
        const issues = inspectSourceForSlide(latest, slide);
        return { passed: !issues.some(item => item.severity === 'error'), issues };
      } })));
      const checkedSource = store.get(uid, id);
      if (p.outline.some(slide => !['done', 'completed'].includes(checkedSource?.dagNodes?.[dagNodeId('source', slide.id)]?.status)))
        throw new Error('source DAG is incomplete; resume pending page checks before publishing');

      const contentSlides = p.outline.map((slide, index) => ({ slide, index })).filter(({ slide }) => checkedSource?.nodes?.[slide.id]?.status !== 'done');
      const sourceImages = p.source?.images || [];
      // Fable (merge of main's 10-13 progressive generation, 2026-10-26): pages
      // are written PPT_NODE_CONCURRENCY at a time, but a finished page commits
      // its preview only after every earlier page of the live outline (inserted
      // continuations included) has settled: committed, failed or paused. Pages
      // start in reading order, so an earlier page is always in flight.
      let pageGates = new Map();
      const earlierPagesSettled = async slideId => {
        const outline = store.get(uid, id)?.outline || [];
        const at = outline.findIndex(item => item.id === slideId);
        await Promise.all(outline.slice(0, Math.max(0, at)).map(item => pageGates.get(item.id)?.settled));
      };
      const runContentWave = async works => {
        pageGates = new Map(works.map(work => { let release; const settled = new Promise(resolve => { release = resolve; }); return [work.slide.id, { settled, release }]; }));
        await boundedAll(works, PPT_NODE_CONCURRENCY, async work => { try { return await runWork(work); } finally { pageGates.get(work.slide.id)?.release(); } });
      };
      const runWork = async (work) => {
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
          else if(index===snapshot.outline.length-1&&isDedicatedClosing(slide)&&!cardThemeClosing(snapshot,slide)){content=normalizeSlide(deterministicClosingDraft(snapshot,slide,index),slide,snapshot,previousTitles);prepareClosingLayout(snapshot,content);content.programGenerated={role:'closing',basis:'fixed greeting in deck language; no source obligations or invented facts'};}
          // A figure page (Fable F2): its figures and their captions, placed by code.
          else if(cardsFlow(snapshot)&&slide.figurePage){content=normalizeSlide(figureSlotDraft(snapshot,index,slide)||{title:slide.title,contentBlocks:[],sourceArtifacts:[],sourceCommentary:[],sourceEvidenceIds:[]},slide,snapshot,previousTitles);content.programGenerated={role:'figure-page',basis:'figures and their captions placed by code; no writer call'};}
          // Option D: a card page without source objects is its reviewed card
          // points, laid out by code on a native layout (as written) or a theme page.
          else if(cardsFlow(snapshot)&&snapshot.templateFidelity?.mode==='preserve'&&index>0&&(slide.keyPoints?.length||cardThemeClosing(snapshot,slide))&&Array.isArray(slide.cardObjects)&&!slide.cardObjects.length){content=normalizeSlide(cardPageDraft(snapshot,index,slide),slide,snapshot,previousTitles);content.programGenerated={role:'card-page',basis:'option D: reviewed card points placed by code; no writer call'};}
          // Chapter dividers and the takeaway are frame pages of the card outline:
          // on a built-in template code writes them as their points (no writer call).
          else if(cardsFlow(snapshot)&&slide.cardFrame&&snapshot.templateFidelity?.mode!=='preserve'){
            content=normalizeSlide({title:slide.title,contentBlocks:(slide.keyPoints||[]).map(point=>({type:point.navigation?'support':'implication',heading:'',body:point.text,sourceRefs:point.refs||[]})),sourceArtifacts:[],sourceCommentary:[],sourceEvidenceIds:[]},slide,snapshot,previousTitles);
            content.cardPage={mode:'frame',shape:slide.cardFrame};content.programGenerated={role:'card-frame',basis:'chapter divider or takeaway from the card outline; no writer call'};
          }
          // A built-in template's card page is its reviewed points as well (the user, 2026-11-01).
          else if(cardsFlow(snapshot)&&snapshot.templateFidelity?.mode!=='preserve'&&index>0&&slide.keyPoints?.length&&Array.isArray(slide.cardObjects)&&!slide.cardObjects.length&&(content=builtinCardPage(snapshot,slide,previousTitles))){}
          // Fable D10: the cover and a card with source objects are written by code too.
          else if(cardsFlow(snapshot)&&snapshot.templateFidelity?.mode==='preserve'&&index===0){content=normalizeSlide(deterministicCoverDraft(snapshot,slide),slide,snapshot,previousTitles);content.programGenerated={role:'cover',basis:'H1 title, label and subtitle lines; no writer call'};}
          // Object pages are writer-free on every template, so an object taller than a page continues by measured rows or lines (Fable plan T6).
          else if(cardsFlow(snapshot)&&slide.cardObjects?.length&&Array.isArray(slide.cardObjects)){content=normalizeSlide(cardObjectPageDraft(snapshot,index,slide),slide,snapshot,previousTitles);content.programGenerated={role:'card-objects',basis:'frozen source objects and the card points; no writer call'};}
          else {
            const prompt=snapshot.nodes[slide.id]?.retryCopyIssues?.length && prior
              ? contentRepairPrompt(snapshot,slide,index,prior,snapshot.nodes[slide.id].retryCopyIssues)
              : contentPrompt(snapshot,slide,index);
            // F2: on a card deck a writer that fails (transport, timeout, attempt
            // budget or contract) leaves the page to code: the cover as title and
            // label, a card with source objects as its objects and points.
            const fallback=cardsFlow(snapshot)&&snapshot.templateFidelity?.mode==='preserve'?(index===0?()=>deterministicCoverDraft(snapshot,slide):slide.keyPoints?.length?()=>cardObjectPageDraft(snapshot,index,slide):null):cardsFlow(snapshot)&&slide.cardObjects?.length?()=>cardObjectPageDraft(snapshot,index,slide):null;
            try{
              const written=await writeWithContractRepair({prompt,nodeKey:nodeId,maxRepairs:snapshot.executionPolicy?.maxQualityRepairs??3,discardCommentary:writerCommentaryUnused(snapshot,slide),call:(prompt,nodeKey)=>deps.modelCall(snapshot,prompt,activity,log,{nodeKey}),normalize:response=>normalizeSlide(response,slide,snapshot,previousTitles)});
              content=written.content;if(written.attempts)content.localRepair={attempts:written.attempts,reasons:['writer_contract']};
            }catch(error){
              if(!fallback||error?.code==='cancelled')throw error;
              log(`ppt ${id} page ${index+1} writer failed (${String(error?.code||error?.message||error).slice(0,120)}); placed by code`);
              content=normalizeSlide(fallback(),slide,snapshot,previousTitles);
              content.programGenerated={role:index===0?'cover':'card-objects',basis:'writer failed; page placed by code from the reviewed card',writerError:String(error?.message||error).slice(0,300)};
            }
          }
          for (const item of (minimal ? requested : mutations.filter(item => ['layout', 'style'].includes(item.type)))) {
            snapshot.nodes[slide.id].slide = content; content = await transformGeneratedSlide(snapshot, slide.id, item, deps, activity, log);
          }
          const contract = snapshot.planning?.slidePlan?.find(item => item.slideId === slide.id);
          const inspectCopy = (candidate, round = 0) => [
            // A card page shows every card point (shortened to fit). A miss sends the
            // page back once; after that it is a review note, never a failed deck.
            ...(cardsFlow(snapshot) ? missingCardPoints(slide, candidate).map(text => ({ code: 'card_point_missing', severity: round ? 'warning' : 'error', repair: 'expand_support',
              message: `Card point not visible on this page; put it in a free point slot, shortened to fit, same facts: ${text.slice(0, 300)}` })) : []),
            // A number the sources do not state goes back to the writer, round 0 as
            // an error (Fable, 2026-10-25; 3143 g2h: "sigmoid ... between 0 and 1"
            // reached the deck gate, which nothing repairs).
            ...(cardsFlow(snapshot) ? inspectSourceNumbers({ ...snapshot, deck: { ...snapshot.deck, slides: (snapshot.deck?.slides || []).map(item => item?.id === candidate.id ? candidate : item) } }, [candidate]).filter(issue => issue.severity === 'error').map(issue => ({ code: 'source_number_unsupported', severity: round ? 'warning' : 'error', repair: 'remove_or_source',
              message: `Numbers the sources do not state: ${(issue.values || []).join(', ')}. Remove each such number (and the claim it carries) or keep only what a cited source line states; do not add general knowledge.` })) : []),
            ...inspectSlideCopy(candidate, contract, index, snapshot.outline.length,
              { templatePreserved: snapshot.templateFidelity?.mode === 'preserve' }).filter(item => ['rewrite_title', 'expand_support', 'redistribute'].includes(item.repair)),
            ...inspectTemplateSlotDraft(snapshot, index, candidate),
            ...missingRequiredEvidence(snapshot, candidate, contract).map(atom => ({ code: 'required_evidence_missing', severity: 'error',
              message: `锁定证据 ${atom.id} 尚未出现在可见页面：${atom.exactText.slice(0, 180)}`, repair: 'expand_support', missingSupport: [atom.id] })),
          ];
          let copyIssues=inspectCopy(content),repairAttempts=0,rejectedCopy=[];
          // A bounded local rewrite is still the same durable content node: it
          // does not add a DAG stage or restart other completed slides.
          const onlyFrozenLengthAdvice=()=>hasFrozenSourceArtifacts(content)&&content.sourceArtifactFit?.capacity_ok===true&&copyIssues.every(issue=>issue.severity==='warning'&&issue.code==='point_too_long');
          if(copyIssues.length&&onlyFrozenLengthAdvice())content.copyAdvisories=copyIssues;
          // A card page has no writer to send back: its issues stand as found.
          while (copyIssues.length && !minimal && !content.cardPage && !onlyFrozenLengthAdvice() && repairAttempts<(snapshot.executionPolicy?.maxQualityRepairs??3)) {
            const reasons=copyIssues.map(item=>item.code);
            await enqueueProject(uid,id,()=>{const latest=store.get(uid,id);if(latest?.status==='generating'&&latest.currentRunId===runId&&generationEpoch(latest,slide.id)===epoch){latest.nodes[slide.id].copyIssues=structuredClone(copyIssues);latest.nodes[slide.id].rejectedDraft=structuredClone(content);store.save(latest);}});
            const repairPrompt=contentRepairPrompt(snapshot,slide,index,content,[...copyIssues,...rejectedCopy]);
            const nodeKey=repairAttempts?`${nodeId}:repair:${repairAttempts+1}`:`${nodeId}:repair`;repairAttempts++;
            try{
              const written=await writeWithContractRepair({prompt:repairPrompt,nodeKey,maxRepairs:1,discardCommentary:writerCommentaryUnused(snapshot,slide),call:(prompt,nodeKey)=>deps.modelCall(snapshot,prompt,activity,log,{nodeKey}),normalize:response=>normalizeSlide(response,slide,snapshot,previousTitles)});
              const candidateIssues=inspectCopy(written.content,repairAttempts);
              if(candidateIssues.filter(issue=>issue.severity==='error').length>copyIssues.filter(issue=>issue.severity==='error').length){rejectedCopy=candidateIssues.filter(issue=>issue.severity==='error');continue;}
              content=written.content;copyIssues=candidateIssues;rejectedCopy=[];
            }catch(error){
              if(!/模型未返回有效的结构化内容|source_artifact_capacity|writer cover contract|writer source-only contract|invalid visible native copy type|invalid source commentary|writer omitted|source artifact|row range/iu.test(String(error.message)))throw error;
              rejectedCopy=[{code:'writer_rejected_candidate',severity:'error',repair:'expand_support',message:String(error.message)}];
            }
            content.localRepair = { attempts:repairAttempts,reasons,rejectedCandidates:rejectedCopy };
            if(!copyIssues.some(issue=>issue.severity==='error'))break;
          }
          // Points still missing after the writer's repair are placed by code in free
          // point holders (label + the point cut to fit), kept when no error is added.
          if(!minimal&&!content.cardPage&&cardsFlow(snapshot)&&snapshot.templateFidelity?.mode==='preserve'){
            const missing=missingCardPoints(slide,content),placed=missing.length?placeCardPoints(snapshot,index,content,missing):null;
            if(placed){const placedIssues=inspectCopy(placed,1);if(placedIssues.filter(issue=>issue.severity==='error').length<=copyIssues.filter(issue=>issue.severity==='error').length){content=placed;copyIssues=placedIssues;}}
          }
          if(content.figureScaled)copyIssues=[...copyIssues,{code:'figure_scaled',severity:'warning',message:'The figures on this page did not fit at full size; they are shown scaled into the space the text leaves. Review them in the editor.'}];
          if(content.cardCodeShortened?.length)copyIssues=[...copyIssues,{code:'card_point_shortened_by_code',severity:'warning',shapeIds:content.cardCodeShortened,message:'The writer\'s text did not fit; code cut these card points at a word or clause boundary. Review them in the editor.'}];
          const unresolved=copyIssues.filter(issue=>issue.severity==='error');
          // F2: on a card deck one page's remaining copy issues never fail the
          // run; the page keeps its best draft and is marked for review (the
          // publish gate still blocks a physical overflow or an unsupported fact).
          if(unresolved.length&&!minimal&&cardsFlow(snapshot)){copyIssues=copyIssues.map(issue=>issue.severity==='error'?{...issue,severity:'warning',pageReview:true,originalSeverity:'error'}:issue);content.pageReview={codes:[...new Set(unresolved.map(issue=>issue.code))],at:new Date().toISOString()};}
          else if(unresolved.length&&!minimal)throw new Error(`writer_copy_gate: ${JSON.stringify(unresolved.map(({code,shapeId,message})=>({code,shapeId,message})))}`);
          if(repairAttempts)content.localRepair={...content.localRepair,attempts:repairAttempts,rejectedCandidates:rejectedCopy};
          await earlierPagesSettled(slide.id);
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
            // One save for the whole commit (below), not one per transition (2026-10-31:
            // four full-project saves per page were most of the gap between pages).
            transitionNode(latest, nodeId, 'completed', { slideId: slide.id, epoch }, { useInput: true, persist: false });
            updateSlidePreview(latest, slide.id);
            latest.runtime.slides[slide.id].quality.issues.push(...copyIssues);
            latest.runtime.attempts = { ...latest.runtime.attempts, ...snapshot.runtime?.attempts };
            Object.assign(latest.runtime.attempts[`${nodeId}:${epoch}`], { phase: 'render_ready', completedAt: new Date().toISOString(), outputHash: latest.runtime.slides[slide.id].contentHash });
            for (const stage of ['layout', 'preview', 'quality']) transitionNode(latest, `${stage}:${slide.id}`, 'completed', { slideId: slide.id, epoch, inputHash: latest.runtime.slides[slide.id].contentHash, renderHash: latest.runtime.slides[slide.id].renderHash }, { useInput: true, persist: false });
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
      checkAtOnce(sourceImages.map((image, index) => {
        const slideId = p.outline[p.outline.length > 1 ? 1 + Math.floor(index / 2) % (p.outline.length - 1) : 0].id;
        return { nodeId: dagNodeId('media', image.id), detail: { slideId }, inspect: () => {
          const issues = inspectMedia(image, slideId);
          return { slideId, passed: !issues.some(item => item.severity === 'error'), issues };
        } };
      }));
      await runContentWave(contentSlides.map(item => ({ kind: 'content', ...item })));
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
          // A card deck places its figures in the outline (cards and figure pages);
          // the legacy auto-attachment would put a figure the outline left out
          // (an optional appendix figure) on a page whose render does not draw it
          // (world_models.pdf run 9: export_integrity_failed for Figure 27).
          const assembled = { schemaVersion: 2, slides: latest.outline.map((s) => latest.nodes[s.id].slide) };
          latest.deck = applyLayoutRegistry(cardsFlow(latest) ? assembled : applySourceImages(assembled, latest.source));
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
        await runContentWave(wave.pending);
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
        const result=await writeWithContractRepair({prompt,nodeKey:`content:${outline.id}:postwriter`,maxRepairs:candidate.executionPolicy?.maxQualityRepairs??3,discardCommentary:writerCommentaryUnused(candidate,outline),call:(text,nodeKey)=>deps.modelCall(candidate,text,activity,log,{nodeKey}),normalize:raw=>normalizeSlide(raw,outline,candidate,candidate.deck.slides.slice(0,index).map(s=>s.title))});
        return result.content;
      }});
      if(actualPlan.executions.length){
        const latest=store.get(uid,id);
        if(!lease.owns()||!latest||latest.currentRunId!==current.currentRunId||latest.status!=='generating'||semanticReviewKey(latest)!==semanticReviewKey(current))throw Error('postwriter transaction superseded by a user edit');
        const beforeReplan=current;current=actualPlan.project;recordRepairSet(beforeReplan,current,actualPlan.executions.filter(e=>e.status==='committed').map(e=>({code:'postwriter_consolidation',detail:e.proposal.reason})));store.save(current);emitRunProgress(current,'deck.replanned',{executions:actualPlan.executions});
      }
        bindDeckNavigation(current);enrichAssetRefs(current);prepareNativeExportFrames(current);current.postWriterPlan=postWriterPlan(current);store.save(current);
      };
      await consolidateActualPages();
      let initialReview = deterministicReview(current);
      const reviewNodeId = 'review:deck';
      let reviewedInputHash = semanticReviewKey(current);
      let modelReview = reviewIsCurrent(current) ? current.quality.modelReview : null;
      // D3: a card deck is checked by a model only when the author asks (AI check).
      if (!modelReview && cardsFlow(current)) modelReview = { evaluation: 'not_evaluated', basis: 'on_demand', missing: [], repeated: [], conflicts: [], unsupported: [] };
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
        if (cardsFlow(current)) { reviewedInputHash = semanticReviewKey(current); initialReview = deterministicReview(current); break; }
        if (attempt >= 3) throw new Error('review inputs keep changing; retry after edits settle');
        reviewedInputHash = semanticReviewKey(current); initialReview = deterministicReview(current);
        modelReview = await checkpointedDeckReview(current,(prompt,nodeKey)=>deps.modelCall(current,prompt,activity,log,{nodeKey}),{nodeKey:'review:deck:refresh'});
        current = store.get(uid, id); if (!current || current.deletedAt || current.status !== 'generating') return;
        if (current.runtime?.pauseRequested) { await enqueueProject(uid, id, () => finishPause(store.get(uid, id))); return; }
      }
      const repairBaseline = semanticReviewKey(current);
      current.stage = 'repair'; store.save(current);
      try { transitionNode(current, 'quality', 'completed'); transitionNode(current, 'review', 'completed'); transitionNode(current, 'repair', 'running'); } catch {}
      const beforeFinalRepair=structuredClone(current);
      const repaired = repairProject(current, initialReview);
      current = repaired.project;
      prepareNativeExportFrames(current);
      const repairedReview=deterministicReview(current);
      const reviewDuration = current.dagNodes?.[reviewNodeId]?.durationMs || 0;
      // Model-judged findings are listed as advisories (O1); the editor shows them (review advisories).
      current.quality = finalQualityReport(repairedReview, repaired.repairs, modelReview, { reviewMs: reviewDuration }, { judgedAdvisory: outlineFirst(current) });
      current.generationCalls = structuredClone(generationCalls);
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
        current.status = 'quality_blocked'; current.stage = 'repair'; current.qualityBlockReason = 'checks';
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
        // One automatic repair of the page an export failure names (Fable 2026-11-02, G3);
        // the repaired page is stored so the finish below sees the same deck.
        const rendered=await renderWithPageFallback(current,value=>deps.renderPptx(structuredClone({...value,renderOutput:artifactPath})));exportInfo=rendered.info;
        if(rendered.fallbackIndex>=0)await enqueueProject(uid,id,()=>{const latest=store.get(uid,id);if(latest&&latest.status==='generating'){latest.deck=structuredClone(current.deck);latest.quality={...(latest.quality||{}),deterministic:current.quality?.deterministic};store.save(latest);}});
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
      else{try{restartAfterContinuation=await tryGenerationContinuation(uid,id,error,activity,log,deps);}catch(repairError){log('Capacity continuation declined: '+repairError.message);}if(!restartAfterContinuation)fail(uid,id,'generation',error,log);}
    }
    finally { lease.release(); running.delete(id); if(restartAfterContinuation)startGeneration(uid,id,activity,log,deps);else void processGenerationEdits(uid, id, deps, activity, log).catch(error => log(String(error))); }
  })();
}

export function recoverPptJobs(activity, log = () => {}, deps = defaultDeps) {
  recoverGenerationEdits(deps, activity, log);
  for (const p of store.listPending()) {
    if(recoverExecutionHistory(p)){store.save(p);continue;}
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
  const projects = store.listProjected(uid,'task-summary-v1',taskSummary).filter(project => !project.deletedAt&&project.libraryEligible);
  return sortManual(store.listFolders(uid).map(folder => ({ ...folder, count: projects.filter(project => project.folderId === folder.id).length })),
    (a, b) => a.name.localeCompare(b.name));
}
function listProjects(uid, url) {
  // The account task list needs statuses/counts, never hydrated image payloads.
  let projects = store.listProjected(uid,'task-summary-v1',taskSummary);
  const trash = url.searchParams.get('trash') === '1';
  projects = url.searchParams.get('view')==='workspace'&&!trash ? projects.filter(project=>!project.deletedAt&&!project.taskRecordOnly||project.taskEligible) : projects.filter(project => Boolean(project.deletedAt) === trash&&!project.taskRecordOnly);
  const q = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  if (q) projects = projects.filter(project => `${project.title} ${(project.tags || []).join(' ')}`.toLocaleLowerCase().includes(q));
  if (url.searchParams.get('favorite') === '1') projects = projects.filter(project => project.favorite);
  if (url.searchParams.get('status')) projects = projects.filter(project => project.status === url.searchParams.get('status'));
  if (url.searchParams.has('folderId')) projects = projects.filter(project => (project.folderId || '') === url.searchParams.get('folderId'));
  const sort = url.searchParams.get('sort') || 'updated';
  const order = { manual: (a, b) => b.updatedAt.localeCompare(a.updatedAt), updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt), created: (a, b) => b.createdAt.localeCompare(a.createdAt), name: (a, b) => a.title.localeCompare(b.title) }[sort];
  if (!order) throw new HttpError(400, 'invalid sort mode');
  return (sort === 'manual' ? sortManual(projects, order) : projects.sort((a, b) => Number(b.pinned) - Number(a.pinned) || order(a, b)))
    .map(summary=>{const client=pptModelJobs.state(uid,summary.id);return {...summary,displayStatus:['outlining','generating'].includes(summary.status)&&client.pending&&!client.leased&&Date.now()-client.lastSeen>20000?'waiting_client':summary.status};});
}
async function permanentlyRemove(project, deps = defaultDeps) {
  if (running.has(project.id) || editing.has(project.id)) throw new HttpError(409, 'project has an active job');
  await deps.removeContainer(project.id, { keepVolume: false });
  const record=taskEligible(project)?{...taskSummary(project),uid:project.uid,taskRecordOnly:true,presentationDeletedPermanentlyAt:new Date().toISOString(),libraryEligible:false,deck:null,outline:[]}:null;
  store.remove(project.uid, project.id);
  if(record)store.save(record,{touch:false});
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
  if (data.configId !== undefined || data.model !== undefined) {
    // Switching the model keeps the reading and outline; later stages use it.
    const beforeGeneration=['input_ready','outline_ready'].includes(project.status)||project.status==='failed'&&['ingest','input','outline'].includes(project.stage);
    if (!beforeGeneration) throw new HttpError(409, 'the model can only change before generation starts');
    project.configId = bounded(data.configId, 120, 'configId');
    project.model = bounded(data.model, 120, 'model');
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
function readFixedObjectIds(value){if(value===undefined)return [];if(!Array.isArray(value)||value.length>300||value.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/u.test(id)))throw new HttpError(400,'Invalid fixed template objects');return [...new Set(value)];}
function validateTemplateAnalysis(analysis) {
  if (!analysis || !['mapped', 'reference'].includes(analysis.compatibility) || !Number.isInteger(analysis.pages) || analysis.pages < 1 || analysis.pages > 100) throw new HttpError(422, 'template analysis is invalid');
  const palette = analysis.compatibility === 'mapped' ? analysis.palette : null;
  if (palette && ['background', 'accent', 'foreground', 'muted'].some(key => !/^#[a-f0-9]{6}$/i.test(palette[key] || ''))) throw new HttpError(422, 'template colors are invalid');
  const fonts = analysis.compatibility === 'mapped' ? analysis.fonts : null;
  if (fonts && ['title', 'body', 'titleEastAsia', 'bodyEastAsia'].some(key => typeof fonts[key] !== 'string' || !fonts[key].trim() || fonts[key].length > 120)) throw new HttpError(422, 'template fonts are invalid');
  if (analysis.compatibility === 'mapped' && !fonts) throw new HttpError(422, 'mapped template must include extracted fonts');
  return {palette, fonts};
}
async function handleTemplates(req, id, uid, url, send, deps) {
  const customs = store.listTemplates(uid);
  if(id&&req.method==='GET'&&url.searchParams.get('view')==='objects'){
    const template=[...BUILT_INS,...store.listTemplates(uid),...store.listTemplates('managed')].find(item=>item.id===id),owner=template?.kind==='managed'?'managed':uid;
    if(!template)return send(404,{error:'template not found'});
    const cached=BUILT_INS.some(item=>item.id===id)?null:store.readTemplateIR(owner,id,template.sha256);
    return send(200,{templateHash:template.sha256,size:{width:cached?.imported?.externalPptx?.width||12192000,height:cached?.imported?.externalPptx?.height||6858000},objects:[...(cached?.imported?.deck?.slides||[]).flatMap((slide,index)=>(slide.nodes||[]).map(node=>({id:node.id,page:index+1,kind:node.type,geometry:node.geometry,name:node.nativeRef?.name||node.semanticRole||node.id,text:String(node.content?.text||'').slice(0,240),brand:node.content?.mediaRole==='brand'}))),...inheritedObjectRows(cached?.imported)]});
  }
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
    if(duplicate){
      if(duplicate.analysisVersion!==PPT_TEMPLATE_ANALYSIS_VERSION){
        try{const analysis=await deps.analyzeTemplate(uid,duplicate.id,upload.extension,upload.bytes);const {palette,fonts}=validateTemplateAnalysis(analysis);Object.assign(duplicate,{palette,fonts,analysisVersion:PPT_TEMPLATE_ANALYSIS_VERSION,version:(duplicate.version||1)+1});store.saveTemplates(uid,customs);}
        finally{await deps.removeContainer(duplicate.id,{keepVolume:false}).catch(()=>{});}
      }
      return send(200,{template:duplicate,cacheHit:true});
    }
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
    const {palette, fonts} = validateTemplateAnalysis(analysis);
    const item = { id: templateId, name: bounded(data.name || data.fileName.replace(/\.[^.]+$/, ''), 120, 'template name'), category: '我的模板',
      description: String(analysis.reason || '').slice(0, 300), kind: 'uploaded', compatibility: analysis.compatibility, analysisVersion:PPT_TEMPLATE_ANALYSIS_VERSION, version: 1,
      pages: analysis.pages, palette, fonts, sampleTitles: (analysis.sampleTitles || []).slice(0, 3), tags: ['自定义', '上传'], pinned: false,
      fileName: data.fileName, extension: upload.extension, bytes: upload.bytes.length, sha256: upload.sha256, irVersion: imported ? PPTX_IR_VERSION : null, createdAt: new Date().toISOString() };
    store.writeTemplate(uid, templateId, upload.bytes);
    if (imported) store.writeTemplateIR(uid, templateId, { schemaVersion: 1, parserVersion: PPTX_IR_VERSION, sha256: upload.sha256, imported });
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
    if(data.reparse===true){
      const bytes=store.readTemplate(uid,id);
      let analysis, imported;
      try {
        analysis=await deps.analyzeTemplate(uid,id,item.extension,bytes);
        validateTemplateAnalysis(analysis);
        if(['pptx','potx'].includes(item.extension)&&deps.importTemplateIR)imported=await deps.importTemplateIR({uid,id},bytes,item.sha256);
      } catch(error) {
        if(error instanceof HttpError)throw error;
        throw new HttpError(422,String(error?.message||error).slice(0,300));
      } finally { await deps.removeContainer(id,{keepVolume:false}).catch(()=>{}); }
      const {palette,fonts}=validateTemplateAnalysis(analysis);
      if(imported)store.writeTemplateIR(uid,id,{schemaVersion:1,parserVersion:PPTX_IR_VERSION,sha256:item.sha256,imported});
      Object.assign(item,{analysisVersion:PPT_TEMPLATE_ANALYSIS_VERSION,compatibility:analysis.compatibility,description:String(analysis.reason||'').slice(0,300),pages:analysis.pages,palette,fonts,version:(item.version||1)+1});
    }
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
  const count = pages(data.pages ?? Math.max(3, estimatePageRecommendation({ inputKind: 'update', source: estimateSource, prompt: progressText }).recommended));
  const generationPolicy=normalizeGenerationPolicy(data.generationPolicy??baseProject?.generationPolicy)||defaultGenerationPolicy(progressText);
  if(generationPolicy.version!==2&&count<6)throw new HttpError(400,'update pages must be between 6 and 100');
  if (generationPolicy.version!==2&&['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension) && data.templateMode !== 'mapped') {
    const reuseError = templateReuseError(template.pages, count);
    if (reuseError) throw new HttpError(400, reuseError);
  }
  const project = { executionPolicy:readExecutionPolicy(data.executionPolicy??baseProject?.executionPolicy), id, uid, title: updateTitle || `${baseSnapshot.title} · 更新版`.slice(0, 160), prompt: progressText || progressFile.name, pages: count,
    deckTitle: updateTitle ? { text: formattedUpdateTitle.title, raw: updateTitle, source: 'user', locked: true } : { text: '', raw: '', source: 'agent', locked: false },
    template: template.id, templateContentMode: data.templateContentMode==='keep_fixed'?'keep_fixed':'design_only',templateFixedObjectIds:readFixedObjectIds(data.templateFixedObjectIds), templateSpec: snapshotTemplate(template), inputKind: 'update',
    update, updateRequest: requestId ? { id: requestId, hash: requestHash } : null,
    version: { rootId: rootId || id, parentId: baseProject?.id || null, number: nextVersion, baseFileName: baseFile?.name || null }, source,
    sourceRevision: 1, outlineRevision: 0, pageDecision: { finalPageCount: count, source: data.pages === undefined ? 'estimate' : 'user', includesCover: true }, status: mustIngest ? 'ingesting' : 'outlining', stage: mustIngest ? 'ingest' : 'outline',
    model: typeof data.model === 'string' ? data.model.slice(0, 120) : '', configId: bounded(data.configId, 120, 'configId'),
    generationPolicy, promptContractVersion: PPT_PROMPT_CONTRACT_VERSION, readOnlyInput:generationPolicy.version===2&&data.readOnlyInput===true,
    outline: [], deck: null, nodes: {}, revision: 0, favorite: false, pinned: false, folderId: baseProject?.folderId || null,
    tags: ['更新', template.name.slice(0, 40)].slice(0, 10), deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension) && deps.prepareTemplateFidelity) {
    project.templateMode = data.templateMode === 'mapped' ? 'mapped' : 'preserve';
    project.templateFidelity = await deps.prepareTemplateFidelity(project, store.readTemplate(template.kind === 'managed' ? 'managed' : uid, template.id), template.sha256, template);
  }
  if (generationPolicy.version !== 2) throw new HttpError(400, 'Only the current generation policy (version 2) is supported.');
  // S11: an update is a card deck over the base deck and the latest progress.
  project.planningContract = { ...newPlanningContract(project), flow: 'cards' };
  project.readOnlyInput = data.readOnlyInput !== false;
  if (!project.readOnlyInput) project.planningContract = { ...project.planningContract, phase: 'semantic_planning', length: { preset: 'standard' }, contentMode: generationPolicy.detail || 'concise', requestRevision: store.newId() };
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
  const at = new Date().toISOString();
  const succeeded=[],failed=[];
  for (const project of projects) {try {await enqueueProject(uid, project.id, async () => {
    const latest = getStructuredProject(uid, project.id);
    if (!latest) throw new HttpError(404, 'project not found');
    if (data.action === 'move') latest.folderId = data.folderId;
    if (data.action === 'trash') {if(running.has(latest.id)||editing.has(latest.id)||['ingesting','outlining','generating'].includes(latest.status))throw new HttpError(409,'Pause the active task before deleting its presentation');latest.deletedAt = at;}
    if (data.action === 'restore') latest.deletedAt = null;
    if (data.action === 'permanent') {
      if (!latest.deletedAt || running.has(latest.id) || editing.has(latest.id)) throw new HttpError(409, 'project must be in trash and idle');
      await permanentlyRemove(latest, deps);
    } else store.save(latest);
  });
    succeeded.push(project.id);
    }catch(error){failed.push({id:project.id,error:error instanceof HttpError?error.message:'Operation failed; retry this project'});}
  }
  return send(failed.length?207:200, { ok: failed.length===0, count:succeeded.length,succeeded,failed });
}

/** Re-review after the deck exists; on a transport failure the previous review
 * stands except for slides changed since (unverified warnings). */
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
 const reviewed=await reviewWithContractRepair(project,visibleCall,{...options,checkpoint:{
  load:key=>store.get(project.uid,project.id)?.reviewCheckpoints?.[key]?.review,
  save:(key,review)=>enqueueProject(project.uid,project.id,()=>{
   const latest=store.get(project.uid,project.id);if(!latest||latest.deletedAt)return;
   const records=latest.reviewCheckpoints||{};records[key]={review,at:new Date().toISOString(),model:project.model};
   latest.reviewCheckpoints=Object.fromEntries(Object.entries(records).slice(-20));store.save(latest);
  })
 }});
 const confirmedClaims=await confirmNegativeClaimAudits(project,reviewed,visibleCall);
 return confirmReviewFindings(project,confirmedClaims,visibleCall,{checkpoint:{
  load:key=>store.get(project.uid,project.id)?.reviewCheckpoints?.[key]?.review,
  save:(key,review)=>enqueueProject(project.uid,project.id,()=>{const latest=store.get(project.uid,project.id);if(!latest||latest.deletedAt||latest.currentRunId!==project.currentRunId)return;latest.reviewCheckpoints=Object.fromEntries([...Object.entries(latest.reviewCheckpoints||{}),[key,{review,at:new Date().toISOString(),model:project.model}]].slice(-64));store.save(latest);})
 }});
}

export async function handlePpt(req, url, { uid, send:sendRaw, res, readBody, activity, log = () => {}, deps = defaultDeps }) {
  // Mutations use the same lean scene as polling. Returning the full durable
  // project here can ship tens of MB of repeated template image data and
  // freeze the editor just when it should show the next real stage.
  // A full read leaves the template's slides, source catalog and component
  // profile out unless asked (?include=templateFidelity; Fable D5).
  const fullFidelity=(url.searchParams.get('include')||'').split(',').includes('templateFidelity');
  const fullView=project=>({...project,...readingPlanningView(project),editCapabilities:{relayout:editableCapabilities(project).relayout},...(project.templateFidelity&&!fullFidelity?{templateFidelity:templateFidelitySummary(project.templateFidelity)}:{})});
  const send=(status,value)=>sendRaw(status,value?.project?.uid?{...value,project:url.searchParams.get('view')==='live'?liveProjectView(value.project):fullView(value.project)}:value);
  if (uid === 'managed') return send(403, { error: 'reserved template registry namespace' });
  // Readiness from memory (Fable 2026-10-26): a probe on the project list
  // turned a slow list into an outage; this one reads no project.
  if (url.pathname === '/ppt/health') {
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    try { store.storeReady(); return send(200, { ok: true, pid: process.pid, uptimeSeconds: Math.round(process.uptime()) }); }
    catch (error) { return send(503, { ok: false, error: 'store_unavailable' }); }
  }
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
      if((normalizeGenerationPolicy(data.generationPolicy)||defaultGenerationPolicy()).version===2){
        const prior=data.projectId&&store.get(uid,data.projectId);
        if(!prior?.inputUnderstanding||prior.inputUnderstanding.sourceIdentity!==understandingIdentity(prior))return send(409,{error:'input_read_required',message:'Read the actual input with the configured agent before estimating pages.'});
        if(data.capacityReassessment===true){
          if(running.has(prior.id)||editing.has(prior.id)||pageReassessments.has(prior.id))return send(409,{error:'project_busy',message:'Wait for the current project task before reassessing pages.'});
          let task;try{
            const selected=new Set((prior.contentSelection?.entries||[]).filter(e=>['slides','summary'].includes(e.destination)).map(e=>e.sourceUnitId));
            const standaloneObjects=(prior.source?.semantic?.inventory?.items||[]).filter(item=>selected.has(item.id)&&Array.isArray(item.rows)).flatMap(item=>{
              const owners=(prior.outline||[]).flatMap((page,pageIndex)=>(page.sourceUnitIds||[]).includes(item.id)?[{page,pageIndex}]:[]);
              if(!owners.length)return[{sourceUnitId:item.id,measurementUnavailable:true,reason:'Selected object has no validated page owner.'}];
              return owners.flatMap(({page,pageIndex})=>{
                const owned=(page.sourceArtifactRanges||[]).filter(ref=>ref.sourceUnitId===item.id),ranges=owned.length?owned:[{}];
                return ranges.map(ref=>{
                  const basis={sourceUnitId:item.id,pageIndex,projectedRows:item.rows.length-1,projectedColumns:item.rows[0]?.length||0,ownedRange:ref};
                  try{const fit=fitComponents(sourceComponentParts(item,ref),prior,pageIndex);if(!Number.isFinite(fit.usedHeight)||!Number.isFinite(fit.availableHeight))throw Error('No valid measured content frame.');return{...basis,fontSizePt:fit.fontSizePt,usedHeightInches:fit.usedHeight/INCH,availableHeightInches:fit.availableHeight/INCH,capacity_ok:fit.capacity_ok,layoutId:fit.layoutId};}
                  catch(error){return{...basis,measurementUnavailable:true,reason:String(error.message).slice(0,200)};}
                });
              });
            });
            task=pageReassessmentTask(prior,{standaloneObjects});}catch(error){return send(409,{error:error.code,message:error.message});}
          const cached=currentPageReassessment(prior);if(cached)return send(200,{reassessment:cached,cached:true});
          pageReassessments.add(prior.id);
          try{
            let result,last,previousReply;
            for(let correction=0;correction<2;correction++){
              const repair=last?pageReassessmentRepairTask(previousReply,last):null;
              const prompt=repair?.prompt||task.prompt+(last?'\nCorrect this rejected advisory using the exact diagnostics: '+JSON.stringify({previousAdvisory:previousReply,error:last.message,details:last.details}):'');
              const reply=await deps.modelCall(prior,prompt,activity,log,{nodeKey:'input:page-reassess:'+task.identity.slice(0,16)+':'+digest(prompt).slice(0,16)+(correction?':contract':''),jsonSchema:repair?.schema||task.schema,maxOutputTokens:4096});
              const latest=store.get(uid,prior.id);
              if(!latest||latest.deletedAt||running.has(prior.id)||editing.has(prior.id))return send(409,{error:'stale_page_reassessment',message:'Project changed during reassessment; the original reading and selected N were preserved.'});
              try{const candidate=repair?applyPageReassessmentRepair(reply,repair):reply;previousReply=candidate;result=validatePageReassessment(candidate,task,latest);break;}catch(error){if(error.code==='stale_page_reassessment')return send(409,{error:error.code,message:error.message});last=error;}
            }
            if(!result)return send(422,{error:last.code,message:last.message,details:last.details});
            // Serialize the final identity check without holding the project
            // writer while waiting for the desktop model worker.
            await enqueueProject(uid,prior.id,()=>{const current=store.get(uid,prior.id);if(!current||current.deletedAt||task.identity!==pageReassessmentIdentity(current))throw Object.assign(Error('Project changed during reassessment; its original reading and selected N were preserved.'),{code:'stale_page_reassessment'});current.pageReassessment=result;current.pageReassessmentHistory=[...(current.pageReassessmentHistory||[]).slice(-9),result];store.save(current);});
            return send(200,{reassessment:result});
          }catch(error){return send(error.code==='stale_page_reassessment'?409:502,{error:error.code||'page_reassessment_failed',message:String(error.message).slice(0,400)});}
          finally{pageReassessments.delete(prior.id);}
        }
        const r=estimatePageRecommendation(prior);return send(200,{recommendation:{recommended:r.recommended,min:r.range[0],max:r.range[1],reason:r.reason,estimationBasis:r.estimationBasis,provisional:false}});
      }
      if (!['prompt', 'paste', 'file'].includes(data.inputKind)) throw new HttpError(400, 'invalid input kind');
      // A paste over 80,000 characters is read as a Markdown file (full review E2).
      let longPaste; try { longPaste = pasteAsFileInput(data); } catch (error) { throw new HttpError(400, error.message); }
      if (longPaste !== data) Object.assign(data, { inputKind: 'file', fileBytes: longPaste.fileBytes, text: '' });
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
        let data = await body(req);
        let reparseOrigin;
        if(data.reparseFrom){
          if(typeof data.reparseFrom!=='string'||! /^[a-f0-9]{32}$/iu.test(data.reparseFrom))throw new HttpError(400,'invalid source project ID');
          const prior=store.get(uid,String(data.reparseFrom));
          if(!prior||prior.deletedAt)throw new HttpError(404,'source project not found');
          if(data.baseRevision!==prior.revision)throw new HttpError(409,'Source project changed; review the current revision before recreating it.');
          if(!['completed','quality_blocked'].includes(prior.status))throw new HttpError(409,'Finish or pause the current task before recreating its input.');
          data=reparseInput(prior,prior.inputKind==='file'?store.readSource(uid,prior.id):undefined);
          reparseOrigin={projectId:prior.id,revision:prior.revision,sourceHash:prior.source?.sha256||null,inputBasis:prior.inputKind==='file'||prior.inputSnapshot?'original_input':'normalized_source_checkpoint',at:new Date().toISOString()};
        }
        // A paste over 80,000 characters is read as a Markdown file (full review E2).
        try { data = pasteAsFileInput(data); } catch (error) { throw new HttpError(400, error.message); }
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
          source = { kind: 'file', name: data.fileName, extension: ext, bytes: sourceBytes.length, sha256: sha256(sourceBytes), text: '', segments: [], truncated: false, ...(data.pastedAsFile ? { pastedAsFile: true } : {}) };
        }
        const prompt = inputKind === 'prompt' ? bounded(data.prompt || '', MAX_PROMPT, 'prompt', !(Array.isArray(data.images) && data.images.length)) : bounded(data.prompt || '', MAX_PROMPT, 'prompt', false);
        const userTitle = typeof data.title === 'string' && data.title.trim() ? bounded(data.title, 160, 'title') : '';
        const sourceTitle=source?displayedDocumentTitle({source,generationPolicy:data.generationPolicy}):null;
        const derivedTitle=deckLanguageVariant({source,generationPolicy:data.generationPolicy,prompt:data.prompt},sourceTitle?.variants.map(v=>v.main||v.text)||[])||data.pastedTitle||prompt.replace(/^\s*#{1,6}\s+/u,'').split('\n')[0].trim()||source?.name?.replace(/\.[^.]+$/,'')||'Presentation';
        const title = bounded(userTitle || derivedTitle.slice(0,160), 160, 'title');
        const template = resolveTemplate(uid, data.template || 'violet');
        const generationPolicy = normalizeGenerationPolicy(data.generationPolicy)||defaultGenerationPolicy(prompt);
        if (generationPolicy.version !== 2 && data.importMode !== 'editable') throw new HttpError(400, 'Only the current generation policy (version 2) is supported.');
        if (inputKind === 'prompt') {
          // Prompt text, pasted images, Markdown/HTML image references and
          // inline tables/SVG enter the same semantic source as a file.
          const parsed = normalizePaste(prompt, data.images);
          source = estimationSource({ inputKind, prompt, generationPolicy }) || (parsed.images.length || parsed.mediaWarnings.length || /\|.*\||```|<svg\b/iu.test(prompt) ? {...parsed,kind:'prompt'} : null);
          if (source) source = {...source,...mergeSourceMedia({images:[...(source.images||[]),...parsed.images]}),mediaWarnings:[...(source.mediaWarnings||[]),...parsed.mediaWarnings]};
        } else if (inputKind === 'file') source = {...source,...mergeSourceMedia({},data.images)};
        // A brief (a prompt with no source document) is written from the model's knowledge (Fable, brief mode).
        if (!source && inputKind === 'prompt') generationPolicy.knowledge = 'source_plus_explanation';
        // Pasted/prompt sources are parsed here (files are checked again at
        // ingest): an inconsistent original count becomes a required warning.
        if (source?.text) source = withSourceArithmeticWarnings(source);
        const inputProfile = profilePptInput({ inputKind, source, prompt });
        const contentPlan = planSparseInput({ inputKind, source, prompt }, inputProfile);
        // Three is an internal schema seed, never an estimate. V2 first asks
        // the configured agent to read the actual input and publish a budget.
        const estimatedPages = generationPolicy.version===2?3:estimatePageRecommendation({ inputKind, source, prompt, inputProfile, contentPlan, generationPolicy, templateSpec: snapshotTemplate(template) }).recommended;
        // The fallback source name labels a paste/file input; it is not an
        // additional user instruction. Preserve an explicitly supplied prompt.
        const requirements = source?.text?.trim()===prompt.trim()||inputKind!=='prompt'&&!String(data.prompt||'').trim()?'':prompt;
        const promptPages = requestedPageCount(requirements);
        const selectedPages = pages(data.pages ?? promptPages ?? estimatedPages);
        const requestedOutline = data.outline === undefined ? null : data.outline;
        if (requestedOutline !== null && (!Array.isArray(requestedOutline) || requestedOutline.length !== selectedPages)) throw new HttpError(400, 'outline must match the user-confirmed page count');
        const formattedUserTitle = userTitle ? formatUserDeckTitle(userTitle) : null;
        if (generationPolicy.version!==2&&['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension) && data.templateMode !== 'mapped') {
          const reuseError = templateReuseError(template.pages, selectedPages);
          if (reuseError) throw new HttpError(400, reuseError);
        }
        const project = { executionPolicy: readExecutionPolicy(data.executionPolicy), id: store.newId(), uid, title, titleSource:userTitle?'user':'derived', prompt, userRequirements:requirements, generationPolicy, promptContractVersion: PPT_PROMPT_CONTRACT_VERSION, pages: selectedPages, inputProfile, contentPlan, template: template.id, templateContentMode: data.templateContentMode==='keep_fixed'?'keep_fixed':'design_only',templateFixedObjectIds:readFixedObjectIds(data.templateFixedObjectIds),
          templateSpec: snapshotTemplate(template), inputKind, source, sourceRevision: source ? 1 : 0, outlineRevision: 0,
          deckTitle: userTitle ? { text: formattedUserTitle.title, raw: userTitle, source: 'user', locked: true } : { text: '', raw: '', source: 'agent', locked: false },
          pageDecision: { finalPageCount: selectedPages, source: data.pages === undefined && promptPages === undefined ? 'estimate' : 'user',
            mode: data.pages === undefined && promptPages === undefined && !requestedOutline ? 'auto' : 'explicit', initialPageCount: selectedPages,
            densityProfileId: densityProfile().id, estimateVersion: 1, estimatedBeforeParse: generationPolicy.version!==2&&Boolean(sourceBytes), includesCover: true,
            ...(generationPolicy.version===2&&data.pages===undefined&&promptPages===undefined&&!requestedOutline?{awaitingInputRead:true}:{}),
            confirmedAt: data.pages === undefined && promptPages === undefined && !requestedOutline ? null : new Date().toISOString() },
          compressionApproved: data.compressionApproved === true,
          ...(requestedOutline ? { requestedOutline } : {}),
          model: typeof data.model === 'string' ? data.model.slice(0, 120) : '',
          configId: bounded(data.configId || (source?.extension === 'pptx' && data.importMode === 'editable' ? 'pptx-import' : ''), 120, 'configId'),
          readOnlyInput: generationPolicy.version===2&&data.readOnlyInput===true,
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
          // A template that cannot hold the deck (no content page to reuse) is the author's choice to fix: 400, not a server error.
          try { project.templateFidelity = await deps.prepareTemplateFidelity(project, store.readTemplate(template.kind === 'managed' ? 'managed' : uid, template.id), template.sha256, template); }
          catch (error) { if (/template_role_unavailable|TEMPLATE_REUSE_UNAVAILABLE/u.test(String(error?.code||'')+String(error?.message||''))) throw new HttpError(400, 'This template has no content page that cards can use; choose another template.'); throw error; }
        }
        if(project.templateFidelity && !sourceBytes&&project.generationPolicy?.version!==2){
          const calibrated=estimatePageRecommendation(project);
          project.pageDecision.parsedRecommendation=calibrated.recommended;
          project.pageDecision.capacityBasis=calibrated.estimationBasis;
          if(automaticPages(project)){project.pages=calibrated.recommended;rescheduleTemplateFidelity(project);}
        }
        if (sourceBytes) store.writeSource(uid, project.id, sourceBytes);
        // S11: every new presentation is a card deck (an editable PPTX import aside).
        // The app stops at the settings form (readOnlyInput); an API caller that
        // sends readOnlyInput:false gets the standard-length outline in this run.
        if(!(sourceBytes&&source?.extension==='pptx'&&data.importMode==='editable')){
          project.planningContract={...newPlanningContract({...project,requestedOutline:undefined}),flow:'cards'};
          project.readOnlyInput=!requestedOutline&&data.readOnlyInput!==false;
          if(!project.readOnlyInput&&!requestedOutline)project.planningContract={...project.planningContract,phase:'semantic_planning',length:{preset:'standard'},contentMode:generationPolicy.detail||'concise',requestRevision:store.newId()};
        }
        syncPresentationPolicy(project);
        project.inputSnapshot={...(inputKind==='file'?{kind:'file',name:source.name}:{kind:inputKind,text:inputKind==='paste'?data.text||'':prompt}),images:Array.isArray(data.images)?data.images:[]};
        project.provenance={version:1,...(project.source?.text?{sourceParsing:sourceParsingReceipt(project.source)}:{}),...(reparseOrigin?{origin:reparseOrigin}:{})};
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
    if(action==='task-record'&&req.method==='DELETE'){
      const saved=await enqueueProject(uid,id,()=>{
        const latest=store.get(uid,id);if(!latest)throw new HttpError(404,'not found');
        if(running.has(id)||editing.has(id)||['ingesting','outlining','generating'].includes(latest.status))throw new HttpError(409,'Stop the active task before deleting its record');
        // A waiting unpublished task has no file to retain or future work to
        // reserve once its record is deleted. Keep its source checkpoint.
        if(!hasPublishedPresentation(latest)&&['input_ready','outline_ready'].includes(latest.status)){latest.status='cancelled';latest.stage='cancelled';}
        latest.taskDeletedAt=new Date().toISOString();store.save(latest,{touch:false});return taskSummary(latest);
      });
      return send(200,{project:saved});
    }
    // The creation wizard supersedes an unconfirmed draft when its input
    // changes: stop its reading/outline run and retire the record, so it
    // neither keeps calling the model nor holds a library slot.
    if(action==='discard'&&req.method==='POST'){
      const saved=await enqueueProject(uid,id,()=>{
        const latest=store.get(uid,id);if(!latest)throw new HttpError(404,'not found');
        if(hasPublishedPresentation(latest)||!['ingesting','outlining','input_ready','outline_ready','failed','cancelled'].includes(latest.status))throw new HttpError(409,'only an unconfirmed draft can be discarded');
        if(['ingesting','outlining'].includes(latest.status))cancelRun(latest);
        const current=store.get(uid,id);
        current.status='cancelled';current.stage='cancelled';current.taskDeletedAt=new Date().toISOString();current.discardedAt=current.taskDeletedAt;
        store.save(current,{touch:false});return taskSummary(current);
      });
      return send(200,{project:saved});
    }
    if(store.get(uid,id,{hydrate:false})?.taskRecordOnly)return send(404,{error:'presentation permanently deleted; task record retained'});
    if(!action&&req.method==='GET'&&url.searchParams.get('view')==='live'){
      // Recover command journals exactly as a full read does. Cache the small
      // verified read projection, never editable project state. Transient
      // drafts and desktop availability must still be refreshed on every read.
      recoverCommit(uid,id);
      const snapshot=store.getProjected(uid,id,'verified-live-view-v1',()=>{
        const current=getStructuredProject(uid,id,{persistMigration:true});
        return {view:liveProjectView(current),draftContext:{uid:current.uid,currentRunId:current.currentRunId,editing:{epochs:current.editing?.epochs},source:{sha256:current.source?.sha256}}};
      });
      if(!snapshot||snapshot.view.deletedAt||snapshot.view.taskRecordOnly)return sendRaw(404,{error:'not found'});
      const view=snapshot.view,client=pptModelJobs.state(uid,id);
      view.displayStatus=['outlining','generating'].includes(view.status)&&client.pending&&!client.leased&&Date.now()-client.lastSeen>20000?'waiting_client':view.status;
      view.drafts=draftsFor(id,view.outline.filter(s=>view.generationStages.pages[s.id]==='writing'||view.status==='paused'&&s.id===view.outline.find(item=>!['done','completed'].includes(view.nodes?.[item.id]?.status)&&!item.manualBlank)?.id).map(s=>s.id),snapshot.draftContext);
      return sendRaw(200,{project:view});
    }
    const project = getStructuredProject(uid, id, { persistMigration: true });
    if (!project||project.taskRecordOnly) return send(404, { error: 'not found' });
    if (project.deletedAt && !['restore', 'permanent'].includes(action)) return send(404, { error: 'not found' });

    if(action==='requirements'&&req.method==='POST'){
      // A requirement added while paused: the author's instruction (never a fact)
      // for the cards and pages still to be written, or, on request, for all of them.
      const data=await body(req);
      if(project.status!=='paused')throw new HttpError(409,'Pause first, then add a requirement.');
      const text=String(data.text||'').trim();if(!text||text.length>2000)throw new HttpError(400,'A requirement is 1-2000 characters.');
      const scope=data.scope==='all'?'all':'remaining',phase='generating';
      project.requirements=[...(project.requirements||[]),{id:store.newId(),text,scope,phase,at:new Date().toISOString()}].slice(-20);
      if(scope==='all'&&phase==='generating')for(const [slideId,node]of Object.entries(project.nodes||{}))if(node?.status==='done'&&!project.runtime?.slides?.[slideId]?.accepted&&!node.slide?.manualBlank){project.nodes[slideId]={...node,status:'pending'};if(project.runtime?.slides?.[slideId])project.runtime.slides[slideId]={...project.runtime.slides[slideId],phase:'queued'};}
      store.save(project);return send(200,{project:liveProjectView(project)});
    }
    if(action==='planning'&&req.method==='POST'){
      const data=await body(req);
      if(planningRequests.has(id))throw new HttpError(409,'A planning update is already in progress.');
      planningRequests.add(id);
      try{
      if(!outlineFirst(project)||running.has(id)||!['input_ready','outline_ready','failed'].includes(project.status)||project.confirmedOutline||project.deck)throw new HttpError(409,'Planning is not editable in the current state.');
      if(data.semanticRevision!==project.planningContract.semanticRevision)throw new HttpError(409,'The semantic outline changed; reload it first.');
      if(data.template&&data.template!==project.template){
        const beforeTemplate=digest(project);
        if(project.templateContentMode==='keep_fixed')throw new HttpError(409,'Review fixed template objects before changing this template.');
        const selected=resolveTemplate(uid,data.template);project.template=selected.id;project.templateSpec=snapshotTemplate(selected);
        project.templateFidelity=['uploaded','managed'].includes(selected.kind)&&['pptx','potx'].includes(selected.extension)&&deps.prepareTemplateFidelity?await deps.prepareTemplateFidelity(project,store.readTemplate(selected.kind==='managed'?'managed':uid,selected.id),selected.sha256,selected):undefined;
        if(digest(store.get(uid,id))!==beforeTemplate)throw new HttpError(409,'The project changed during template analysis; reload it first.');
      }
      if(data.command==='edit'){
        // The author edits the written cards directly; no model call. Kept points
        // keep their sources; the author's own text is shown exactly as written.
        if(!cardsFlow(project)||project.status!=='outline_ready'||project.planningContract.phase!=='page_plan_ready')throw new HttpError(409,'Edit the cards once the outline is written.');
        let edited;try{edited=applyCardEdits(project,data.cards);}catch(error){throw new HttpError(400,error.message);}
        try{project.outline=normalizeOutline({slides:edited.slides},edited.slides.length,project.source,project.update,project.deckTitle);}catch(error){throw new HttpError(400,error.message);}
        project.pages=project.outline.length;project.pageDecision={...project.pageDecision,finalPageCount:project.pages};
        project.planningContract={...project.planningContract,actualPageIds:project.outline.map(slide=>slide.id),cardEdits:{at:new Date().toISOString(),...edited.summary}};
        rescheduleTemplateFidelity(project,{scoreSlide:(current,index)=>cardScheduleScore(current,index)});store.save(project);
        return send(200,{project:liveProjectView(project)});
      }else if(data.command==='outline'){
        // The whole card outline in one run (Gamma). Settings form: length preset
        // or exact pages (D4), text density, language (D7), notes in the other
        // language, and an instruction for a rewrite (D6).
        if(!cardsFlow(project))throw new HttpError(409,'Only a card outline is written in one step.');
        const contentMode=data.contentMode||project.planningContract.contentMode||'concise';
        if(!['concise','standard','detailed'].includes(contentMode))throw new HttpError(400,'Invalid content mode.');
        let length=defaultLength(project);
        if(data.length!==undefined){
          const value=data.length,keys=value&&typeof value==='object'?Object.keys(value):[];
          if(keys.length===1&&LENGTHS.includes(value.preset))length={preset:value.preset};
          else if(keys.length===1&&Number.isInteger(value.exact)&&value.exact>=6&&value.exact<=40)length={exact:value.exact};
          else throw new HttpError(400,'Choose quick, standard or full, or an exact total of 6-40 pages.');
        }else if(data.pagePreference?.mode==='fixed'&&Number.isInteger(data.pagePreference.exact))length={exact:Math.max(6,Math.min(40,data.pagePreference.exact))};
        if(data.language!==undefined){if(!LANGUAGE_CHOICES.includes(data.language))throw new HttpError(400,'Choose bilingual, English, Simplified or Traditional Chinese.');project.generationPolicy={...project.generationPolicy,language:languagePolicy(data.language)};}
        if(data.instruction!==undefined&&typeof data.instruction!=='string')throw new HttpError(400,'The instruction must be text.');
        const instruction=String(data.instruction??'').trim().slice(0,2000);
        project.generationPolicy={...project.generationPolicy,detail:contentMode};
        project.planningContract={...project.planningContract,phase:'semantic_planning',contentMode,length,...(data.language!==undefined?{languageChoice:data.language}:{}),
          notesOther:data.notesOther===undefined?Boolean(project.planningContract.notesOther):data.notesOther===true,instruction,capacityPlan:undefined,capacityRevision:undefined,cardOutline:undefined};
      }else throw new HttpError(400,'Unknown planning command; use outline or edit.');
      project.planningContract.requestRevision=store.newId();project.readOnlyInput=false;project.autoGenerate=false;
      project.outline=[];project.nodes={};project.planning=null;project.outlineAcceptance={semantic:false,physical:false,confirmable:false,issues:[]};
      for(const key of ['candidateOutline','outlineRepairCheckpoint','retainedOutlineRetry','pendingEditorialRepair','outlineBatches','semanticGrouping','pageBudgetConflict','outlineCorrections','outlineAdvisories','outlineRepairGovernor','outlineLanguageFallbacks','outlineTableFallbacks','outlineProseMediaFallbacks','tableTypography'])delete project[key];
      project.status='outlining';project.stage='outline';project.error='';startRun(project,'outline-first-'+data.command);store.save(project);startOutline(uid,id,activity,log,deps);
      return send(202,{project:liveProjectView(project)});
      }finally{planningRequests.delete(id);}
    }
    if(action==='cover'&&req.method==='GET'){
      if(!libraryEligible(project))return send(409,{error:'No published presentation cover'});
      const scene=project.publishedRenderTree?.slides?.[0]||(project.status==='completed'?project.renderTree?.slides?.[0]:null);
      if(!scene?.elements?.length)return send(409,{error:'Published cover preview is unavailable'});
      return send(200,{slide:scene,publishedRevision:project.publishedRevision,template:project.template});
    }
    if (action === 'trash' && req.method === 'POST') {
      if(running.has(id)||editing.has(id)||['ingesting','outlining','generating'].includes(project.status))return send(409,{error:'Pause the active task before deleting its presentation'});
      return send(200, { project: await enqueueProject(uid, id, () => { const latest = getStructuredProject(uid, id); latest.deletedAt = new Date().toISOString(); return store.save(latest); }) });
    }
    if (action === 'restore' && req.method === 'POST') {
      return send(200, { project: await enqueueProject(uid, id, () => { const latest = getStructuredProject(uid, id); latest.deletedAt = null; return store.save(latest); }) });
    }
    if (action === 'permanent' && req.method === 'DELETE') {
      if (!project.deletedAt) return send(409, { error: 'move project to trash first' });
      await enqueueProject(uid, id, () => permanentlyRemove(getStructuredProject(uid, id), deps));
      return send(200, { ok: true });
    }
    // A table drawn as cards can be shown as the original table again, and back
    // (Fable plan T5). It runs as an undoable command: undo restores the page
    // snapshot and the page's generation epoch moves, so a late writer result
    // for that page is ignored (integration plan step 5).
    if(action==='table-representation'&&req.method==='POST'){
      const data=await body(req);
      if(data.baseRevision!==project.revision)throw new HttpError(409,'Project changed; reload before changing the table form');
      if(!['completed','quality_blocked','paused'].includes(project.status))throw new HttpError(409,'Pause generation or finish the presentation before changing the table form');
      if(!(project.deck?.slides||[]).some(slide=>slide.id===data.slideId))throw new HttpError(404,'slide not found');
      try{
        const {project:next}=await applyCommand(uid,id,{type:'slide.setTableRepresentation',baseRevision:data.baseRevision,payload:{slideId:data.slideId,sourceUnitId:data.sourceUnitId,representation:data.representation==='table'?'table':'diagram'}});
        return send(200,{project:liveProjectView(next)});
      }catch(error){if(error?.statusCode&&error.statusCode<500)throw new HttpError(error.statusCode,error.message);throw error;}
    }
    if(action==='component-copy'&&req.method==='POST'){
      const data=await body(req);
      if(data.baseRevision!==project.revision)throw new HttpError(409,'Project changed; reload before converting a copy');
      if(!['completed','quality_blocked','paused'].includes(project.status)||!project.deck?.slides?.length)throw new HttpError(409,'Pause generation or finish the presentation before converting a copy');
      if(store.list(uid).filter(item=>!item.deletedAt).length>=50)throw new HttpError(409,'Workspace limit is 50 stored projects');
      let deck;try{deck=componentCopyDeck(project);}catch(error){throw new HttpError(409,error.message);}const copy=structuredClone(project);copy.id=store.newId();copy.title=(project.title+' · Component copy').slice(0,160);copy.deck=deck;copy.nodes=Object.fromEntries(deck.slides.map(slide=>[slide.id,{status:'done',attempts:0,slide}]));
      for(const key of ['externalPptx','templateFidelity','publishedArtifactPath','publishedRenderTree','publishedRevision','publishedAt','publishedPageCount','exportManifest','pdfArtifactPath','renderOutput','editing','currentRunId','runId','runtime','modelUsage','executionHistory','quality','update','updateRequest','diff'])delete copy[key];
      copy.template='violet';copy.templateMode='mapped';copy.status='quality_blocked';copy.stage='component_copy_review';delete copy.qualityBlockReason;copy.error='';copy.revision=1;copy.createdAt=new Date().toISOString();copy.favorite=false;copy.pinned=false;copy.version={rootId:copy.id,parentId:project.id,number:1};
      copy.componentConversion={sourceProjectId:project.id,sourceRevision:project.revision,at:copy.createdAt,reviewRequired:true};
      copy.renderTree=buildRenderTree(copy);
      if(copy.source?.kind==='file')store.writeSource(uid,copy.id,store.readSource(uid,project.id));
      store.save(copy);saveRevision(copy,'component-copy-preview');
      return send(201,{project:copy});
    }
    if (action === 'duplicate' && req.method === 'POST') {
      if (project.status !== 'completed') return send(409, { error: 'only completed presentations can be duplicated' });
      const copy = structuredClone(project);
      delete copy.taskDeletedAt;delete copy.presentationDeletedPermanentlyAt;delete copy.taskRecordOnly;
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
      if (!publishedRenderCurrent(project)) return send(409,{code:'export_renderer_stale',error:'导出渲染规则已更新，请保存并重新发布页面以校验填充与排版。旧版本仍保留。'});
      const { stream, size } = await deps.readFile(id, project.publishedArtifactPath || '/workspace/presentation.pptx');
      const safe = project.title.replace(/[\\/\r\n"<>|:*?]/g, '_').slice(0, 120) || 'presentation';
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'cache-control':'private, no-store','x-ppt-revision':String(project.publishedRevision),
        ...(project.quality?.exportVerification?.revision===project.publishedRevision&&project.quality.exportVerification.sha256?{etag:'"sha256:'+project.quality.exportVerification.sha256+'"'}:{}),
        'content-length': size, 'content-disposition': `attachment; filename="presentation.pptx"; filename*=UTF-8''${encodeURIComponent(safe)}.pptx` });
      stream.on('error', () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      res.on('close', () => { try { stream.destroy(); } catch {} });
      return true;
    }
    if (action === 'pdf' && req.method === 'GET') {
      if (!['completed', 'quality_blocked'].includes(project.status) || !project.publishedRevision) return send(409, { error: 'presentation has no published version' });
      if (!publishedRenderCurrent(project)) return send(409,{code:'export_renderer_stale',error:'导出渲染规则已更新，请保存并重新发布页面后导出。'});
      const pdf = await enqueueProject(uid, id, async () => {
        const latest = getStructuredProject(uid, id);
        const revision = latest.publishedRevision;
        const identity=publishedPdfIdentity(latest);
        if (latest.pdfRevision !== revision || latest.pdfSourceIdentity !== identity) {
          const snapshot = readRevision(uid, id, revision);
          if (!snapshot) throw new HttpError(409, 'published revision snapshot is unavailable');
          if (!snapshot.templateSpec && latest.revision !== revision) throw new HttpError(409, 'legacy published template snapshot is unavailable; publish the draft before exporting PDF');
          const pdfArtifactPath = `/workspace/published-${revision}-${identity.slice(0,20)}.pdf`;
          await deps.renderPdf({ ...latest, deck: snapshot.deck, renderTree: latest.publishedRenderTree || snapshot.renderTree, template: snapshot.template ?? latest.template, templateSpec: snapshot.templateSpec ?? latest.templateSpec, pdfArtifactPath });
          latest.pdfRevision = revision; latest.pdfArtifactPath = pdfArtifactPath; latest.pdfSourceIdentity=identity; store.save(latest);
        }
        return deps.readFile(id, latest.pdfArtifactPath || '/workspace/presentation.pdf');
      });
      const { stream, size } = pdf;
      const safe = project.title.replace(/[\\/\r\n"<>|:*?]/g, '_').slice(0, 120) || 'presentation';
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': size,'cache-control':'private, no-store',
        'content-disposition': `attachment; filename="presentation.pdf"; filename*=UTF-8''${encodeURIComponent(safe)}.pdf` });
      stream.on('error', () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      res.on('close', () => { try { stream.destroy(); } catch {} });
      return true;
    }
    if(action==='source-assets'&&req.method==='GET') {
      const assetId=url.searchParams.get('assetId');
      const asset=project.source?.images?.find(image=>image.id===assetId);
      const matched=asset?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u);
      if(!matched)return send(404,{error:'Source image unavailable'});
      res.writeHead(200,{'content-type':matched[1],'cache-control':'private, no-store','x-content-type-options':'nosniff'});res.end(Buffer.from(matched[2],'base64'));return true;
    }
    if(action==='conversation'&&req.method==='GET')return send(200,{initialRequest:project.prompt||project.userRequirements||project.source?.text||'',sourceName:project.source?.name,intents:project.editing?.intents||{}});
    if(action==='execution'&&req.method==='GET')return send(200,{executionPolicy:project.executionPolicy||normalizeExecutionPolicy(),history:(project.executionHistory||[]).slice(-500)});
    if(action==='execution-policy'&&req.method==='PATCH') {
      const data=await body(req);
      if(!['paused','outline_ready','failed','quality_blocked','completed'].includes(project.status))throw new HttpError(409,'Pause generation before changing its execution policy');
      const updated=await enqueueProject(uid,id,()=>{
        const latest=getStructuredProject(uid,id);if(!['paused','outline_ready','failed','quality_blocked','completed'].includes(latest.status))throw new HttpError(409,'Pause generation before changing its execution policy');if(latest.revision!==data.baseRevision)throw new HttpError(409,'Project changed; reload first');
        let policy;try{policy=normalizeExecutionPolicy(data.executionPolicy);}catch(error){throw new HttpError(400,error.message);}
        latest.executionPolicyHistory=[...(latest.executionPolicyHistory||[]),{policy:latest.executionPolicy,at:new Date().toISOString()}];
        latest.executionPolicy=policy;latest.executionPolicyRevision=(latest.executionPolicyRevision||0)+1;
        // No content, outline, source, user locks or published revision is rewritten.
        if(latest.status==='paused'&&latest.error?.includes('budget'))latest.error='';
        store.save(latest);return latest;
      });return send(200,{project:updated});
    }
    if (action === 'versions' && req.method === 'GET') {
      const rootId = project.version?.rootId || project.id;
      const versions = store.listProjected(uid,'task-summary-v1',taskSummary).filter(item => !item.deletedAt && (item.id === rootId || item.version?.rootId === rootId))
        .map(item => ({ id: item.id, title: item.title, status: item.status, parentId: item.version?.parentId || null,
          number: item.version?.number || 1, updatedAt: item.updatedAt, pages: item.pages })).sort((a, b) => a.number - b.number);
      return send(200, { versions });
    }
    if (action === 'rewrite' && req.method === 'POST') {
      // The legacy bullet rewrite has no card contract; a card deck edits through the AI edit proposals (Fable 2026-10-25).
      if (cardsFlow(project)) return send(409, { error: 'This presentation is a card deck; edit its pages with the AI edit in the editor.' });
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
      if (!cardsFlow(project)) return send(409, { error: 'This presentation uses a retired outline flow; edit it in the editor.' });
      const data = await body(req);
      if (data.sourceRevision !== project.sourceRevision) return send(409, { error: 'source changed on another device; reload first' });
      let source;
      try { source = normalizePaste(data.text);source.images=[...source.images,...(project.source?.images||[]).filter(image=>!image.id.startsWith('inline-image-'))]; } catch (error) { throw new HttpError(400, error.message); }
      if (source.sha256 === project.source.sha256) return send(200, { project });
      project.source = source; project.planningContract={...newPlanningContract(project),flow:'cards'};project.readOnlyInput=true;syncPresentationPolicy(project); project.sourceRevision++; project.outlineRevision = 0;
      project.outline = []; project.nodes = {}; project.status = 'outlining'; project.stage = 'outline';
      store.save(project); startOutline(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'outline' && req.method === 'PATCH') {
      assertPlanningReady(project);
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      const priorDrafts={template:project.template,generationPolicy:structuredClone(project.generationPolicy),outline:normalizeOutline({slides:project.outline},project.pages,project.source,project.update,project.deckTitle),nodes:project.nodes};
      const data = await body(req);
      if(outlineFirst(project)&&digest(data.slides)!==digest(project.outline))throw new HttpError(409,'The physical plan changed; edit the logical outline and replan capacity before confirming.');
      if(outlineFirst(project)&&((data.generationPolicy&&JSON.stringify(normalizeGenerationPolicy(data.generationPolicy))!==JSON.stringify(normalizeGenerationPolicy(project.generationPolicy)))||(data.template&&data.template!==project.template)))throw new HttpError(409,'Replan capacity after changing mode or template.');
      if (data.generationPolicy !== undefined) project.generationPolicy = normalizeGenerationPolicy(data.generationPolicy);
      if(data.executionPolicy!==undefined)project.executionPolicy=readExecutionPolicy(data.executionPolicy);
      const nextPages = pages(data.slides?.length);
      const confirmedDecision = confirmedPageDecision(project, { nextPages, pageSource: data.pageSource, template: data.template });
      if (data.finalPageCount !== undefined && nextPages !== pages(data.finalPageCount)) throw new HttpError(400, 'outline must match the user-confirmed page count');
      if(data.template!==undefined&&(data.template!==project.template||resolveTemplate(uid,data.template).version!==project.templateSpec?.version)){
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
      // The user's confirmed outline is compiled, never rejected: remaining
      // findings are listed as warnings and resolved during page writing.
      if(project.outlineCorrections)project.outlineCorrections={...project.outlineCorrections,warnings:[]};
      // A card point stating a quantity its sources do not, or an untypeset
      // formula, would block publishing: the author edits it first (live check, report 98981dcf).
      const factIssues=cardFactIssues(project);
      if(factIssues.length)return send(409,{error:'Edit these points before confirming: '+factIssues.map(issue=>issue.message).join(' '),code:'card_facts_unstated',issues:factIssues});
      // A required source object code could not place blocks until the author places it (Fable 2026-10-26).
      {const unplaced=unplacedSourceObjects(project);if(unplaced.length)return send(409,{error:'Place these source objects on a card before confirming: '+unplaced.join(', '),code:'source_object_unplaced',sourceUnitIds:unplaced});}
      // Only blocking title findings refuse; review notes (a repeated card title) go through (Fable).
      const titleCapacityIssues=[...inspectNativeOutlineTitles(project),...inspectSystemOutlineTitles(project)].filter(issue=>issue.severity!=='warning');
      if(titleCapacityIssues.length)return send(409,{error:'Fix the titles on pages '+[...new Set(titleCapacityIssues.map(issue=>issue.pageIndex+1))].join(', ')+' before confirming: '+[...new Set(titleCapacityIssues.map(issue=>String(issue.message||'').split('. ')[0]))].slice(0,3).join(' '),issues:titleCapacityIssues,code:'title_capacity',titleLimits:titleCapacityIssues.filter(issue=>Number.isFinite(issue.capacityVisualUnits)).map(issue=>({page:issue.pageIndex+1,cover:issue.pageIndex===0,han:Math.floor(issue.capacityVisualUnits),latin:Math.floor(issue.capacityVisualUnits/.55)}))});
      confirmNativeOutlineFit(project,{warnOnly:true});
      // A single source object taller than every page at the body font cannot be
      // split by rows or lines: refused here, never a failed generation (Fable R3).
      if(cardsFlow(project)&&project.templateFidelity?.mode==='preserve'){planTableFonts(project);const tall=project.outline.map((slide,index)=>({slide,index})).filter(({slide,index})=>index>0&&slide.cardObjects?.length&&!objectsFitPage(project,index,slide)&&!objectContinuation(project,index,slide,{planned:false}));
        if(tall.length)return send(409,{error:'A source object on pages '+tall.map(({index})=>index+1).join(', ')+' is taller than any page of this template at the body font. Remove it from its card or choose another template.',code:'planned_frozen_source_capacity'});}
      const finalTitleCapacityIssues=[...inspectNativeOutlineTitles(project),...inspectSystemOutlineTitles(project)].filter(issue=>issue.severity!=='warning');
      if(finalTitleCapacityIssues.length)return send(409,{error:'The chosen layout cannot fit topics on pages '+finalTitleCapacityIssues.map(issue=>issue.pageIndex+1).join(', ')+'. Shorten those topics before confirming.',issues:finalTitleCapacityIssues});
      const missingFixedPages=unmappedFixedTemplatePages(project);
      if(missingFixedPages.length)return send(409,{error:'The selected fixed objects need additional template layouts. Increase the page budget or revise fixed-object selection before confirming.',sourcePages:missingFixedPages});
      project.planning = refreshPlanning(project);
      // A card deck lists source objects left off its cards (R3: a coverage report,
      // not a gate); overflow continues during generation.
      const frozenSourceIssues=cardsFlow(project)?[]:inspectFrozenOutlineSources(project);
      if(frozenSourceIssues.length)return send(409,{error:'The outline still has missing/duplicated source objects or overfull source pages. Repartition the listed original objects or increase the page budget before confirming. '+frozenSourceIssues.map(issue=>issue.pageIndex!==undefined?'Page '+(issue.pageIndex+1):issue.code).join(', '),issues:frozenSourceIssues});
      project.outlineRevision = (project.outlineRevision || 0) + 1;
      project.nodes = retainConfirmedOutlineDrafts(priorDrafts,project);
      project.diff = diffSummary(project);
      recordOutlineConfirmation(project);
      store.save(project);
      return send(200, { project });
    }
    if (action === 'outline' && req.method === 'POST') {
      // S11: the outline is written by the planning command ('outline'); the
      // ledger outline route and its rebalance were retired with the old flow.
      return send(410, { error: 'This route was retired; write the outline with the planning command (outline).' });
    }
    if (action === 'generate' && req.method === 'POST') {
      assertPlanningReady(project);
      if (['ingesting', 'outlining'].includes(project.status)) {
        return send(409,{error:'Read the input and finish the validated outline first; confirm that outline before generating slides.'});
      }
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      if(project.confirmedOutline&&project.confirmedOutline.hash!==outlineConfirmationHash(project))return send(409,{error:'The outline, source or presentation policy changed; confirm the current outline again.'});
      const frozenSourceIssues=cardsFlow(project)?[]:inspectFrozenOutlineSources(project);
      if(frozenSourceIssues.length)return send(409,{error:'The original source selection is incomplete or cannot fit on its frozen pages. Repartition or increase the page budget before generating. '+frozenSourceIssues.map(issue=>issue.pageIndex!==undefined?'Page '+(issue.pageIndex+1):issue.code).join(', '),issues:frozenSourceIssues});
      // A card point stating a quantity its sources do not, or an untypeset
      // formula, would block publishing: the author edits it first (live check, report 98981dcf).
      const factIssues=cardFactIssues(project);
      if(factIssues.length)return send(409,{error:'Edit these points before generating: '+factIssues.map(issue=>issue.message).join(' '),code:'card_facts_unstated',issues:factIssues});
      // A required source object code could not place blocks until the author places it (Fable 2026-10-26).
      {const unplaced=unplacedSourceObjects(project);if(unplaced.length)return send(409,{error:'Place these source objects on a card before generating: '+unplaced.join(', '),code:'source_object_unplaced',sourceUnitIds:unplaced});}
      // Only blocking title findings refuse; review notes (a repeated card title) go through (Fable).
      const titleCapacityIssues=[...inspectNativeOutlineTitles(project),...inspectSystemOutlineTitles(project)].filter(issue=>issue.severity!=='warning');
      if(titleCapacityIssues.length)return send(409,{error:'Fix the titles on pages '+[...new Set(titleCapacityIssues.map(issue=>issue.pageIndex+1))].join(', ')+' before generating: '+[...new Set(titleCapacityIssues.map(issue=>String(issue.message||'').split('. ')[0]))].slice(0,3).join(' '),issues:titleCapacityIssues});
      const unresolvedSource=unresolvedSourceWarnings(project);
      if(unresolvedSource.length)return send(409,{error:'Resolve the required source warnings first: re-upload a corrected input or acknowledge each listed object. '+unresolvedSource.map(w=>(w.location||w.code)).join('; '),code:'source_warnings_unresolved',warnings:unresolvedSource.map(w=>({key:sourceWarningKey(w),code:w.code,location:w.location,message:w.message}))});
      const missingFixedPages=unmappedFixedTemplatePages(project);
      if(missingFixedPages.length)return send(409,{error:'Selected fixed objects are on unused template pages; revise page budget or fixed-object selection before generating.',sourcePages:missingFixedPages});
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
    if (action === 'source-warnings' && req.method === 'POST') {
      // P0-3 readiness: acknowledge required source warnings for this exact
      // source hash before slides are written (never during a running writer).
      const data = await body(req), keys = Array.isArray(data.keys) ? [...new Set(data.keys.map(String))] : [];
      const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : '';
      if (!keys.length || keys.length > 64 || !reason) return send(400, { error: 'keys and a reason are required' });
      if (!project.source?.sha256) return send(409, { error: 'source hash unavailable' });
      if (['ingesting', 'generating'].includes(project.status)) return send(409, { error: 'wait until the input is read and no slides are being written' });
      const saved = await enqueueProject(uid, id, () => { const latest = getStructuredProject(uid, id); acknowledgeSourceWarnings(latest, keys, reason); return store.save(latest); });
      return send(200, { project: getStructuredProject(uid, id) || saved });
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
      const retryRequest=await body(req);
      if (!['failed','quality_blocked'].includes(project.status)) return send(409, { error: 'project is not failed or quality blocked' });
      // S11: an outline of the retired flow is not planned again; the deck opens in the editor.
      if (project.stage==='outline'&&!cardsFlow(project)) return send(409, { error: 'This presentation uses a retired outline flow; edit it in the editor.' });
      if(project.taskDeletedAt){delete project.taskDeletedAt;store.save(project);}
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
      const summaryScope=summaryRecoveryScope(project);
      if(summaryScope&&retryRequest.repairSourceSummaries!==false){
        const beforeRevision=project.revision,beforeRun=project.currentRunId;
        const response=await deps.modelCall(project,summaryScope.prompt,activity,log,{nodeKey:'repair:source-summary',maxOutputTokens:4096});
        const delta=typeof response==='string'?parseModelJson(response):response;
        const latest=store.get(uid,id);
        if(latest.revision!==beforeRevision||latest.currentRunId!==beforeRun||!['failed','quality_blocked'].includes(latest.status))throw new HttpError(409,'Project changed during summary recovery; retained current checkpoint');
        try{Object.assign(project,applySummaryRecovery(project,summaryScope,delta));}
        catch(error){throw new HttpError(409,'Scoped source summary repair rejected; retained prior checkpoint: '+String(error.message).slice(0,240));}
      }
      if(project.stage==='outline'){project.promptContractVersion=PPT_PROMPT_CONTRACT_VERSION;startRun(project,'explicit-outline-retry');}
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
      archiveModelFailure(project); store.save(project);
      if (project.status === 'ingesting') startIngest(uid, id, activity, log, deps);
      else if (project.status === 'outlining') startOutline(uid, id, activity, log, deps);
      else startGeneration(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (!action && req.method === 'GET') return send(200, { project });
    if (!action && req.method === 'PATCH') {
      const data = await body(req);
      if (data.slides === undefined && data.slidePatches === undefined && data.template === undefined) {
        if (!['title', 'favorite', 'pinned', 'folderId', 'tags', 'configId', 'model'].some(key => key in data)) return send(400, { error: 'no metadata changes' });
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
    const status = error instanceof HttpError ? error.status : error?.code === 'TEMPLATE_REUSE_UNAVAILABLE' ? 400 : [400,409].includes(error.statusCode) ? error.statusCode : 500;
    if (status === 500) log(`ppt API error: ${String(error?.message || error).slice(0, 300)}`);
    return send(status, { error: status === 500 ? 'PPT service error' : error.message });
  }
}

// Generated explanation frames are editable prose, even when the renderer puts
// them in sourceArtifactNodes. Only actual bound originals freeze carriers.
function hasFrozenSourceArtifacts(slide) {
  return Boolean(slide.sourceArtifactNodes?.some(node => node.sourceArtifact || node.content?.sourceEvidenceIds?.length));
}
export const _internals = { numberGuard, inheritedObjectRows, startOutline, movedFinishedFrame, pinFinishedFrames, cardScheduleScore, assessOutlineCandidate, writeWithContractRepair, revalidateCompletedCopy, mergeSourceSupplement, hasFrozenSourceArtifacts, normalizeOutline, normalizeDeck, normalizeSlide, parseModelJson, pages, contentPrompt, defaultDeps };

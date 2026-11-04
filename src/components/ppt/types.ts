import type {PptModelCapabilities} from '@/lib/ppt-model-catalog';
export type PptModelRef={configId:string;model:string;thinkingControl?:boolean;vision?:boolean;contextTokens?:number;maxOutputTokens?:number};
export type PptExecutionPolicy = {
  version:1;qualityLevel:'fast'|'balanced'|'rigorous'|'legacy_single_model';catalogVersion?:string;routingPolicyVersion?:string;legacy?:boolean;
  roleRoutes:Record<string,{primary:PptModelRef;complexPrimary?:PptModelRef;selection?:'automatic'|'manual';fallbacks:PptModelRef[]}>;
  budget:{maxAttemptsPerTask:number;maxInputTokens?:number;maxOutputTokens?:number};
};
export type PptExecutionRecord={thinkingMode?:'enabled'|'disabled';id:string;taskKey:string;stage:string;role:string;model:string;configId:string;status:string;attempt:number;startedAt:string;elapsedMs?:number;inputTokens?:number;outputTokens?:number;errorCode?:string;complexity:{level:string;reasons:string[]};costStatus:string};
import type { VisualBlock } from './PptBlocks';

export type PptLayoutId = 'cover' | 'summary' | 'editorial' | 'big-number' | 'comparison' | 'chart' | 'table' | 'image-text' | 'timeline' | 'two-panel' | 'formula-variables' | 'item-icons' | 'conclusion';
export type PptBounds = { x: number; y: number; width: number; height: number };
export type PptSourceArtifactRef={sourceUnitId:string;rowStart?:number;rowEnd?:number;lineStart?:number;lineEnd?:number};
export type PptOutlineChild = { id: string; title: string; description: string };
export type PptSlide = {
  userLocked?:boolean; id: string; title: string; focus?: string; description?: string; section?: string; children?: PptOutlineChild[]; refs?: string[];
  bullets?: string[]; blocks?: VisualBlock[]; layoutId?: PptLayoutId; layout?: 'text-first' | 'visual-first'; sourceRefs?: string[];
  baseSlideId?: string | null; change?: 'keep' | 'rewrite' | 'add'; manualBlank?: boolean;
  titleLocked?: boolean; density?: 'low' | 'medium' | 'high'; distributionType?: string; semanticUnitBudget?: number; pointLengthProfile?: string;
  sourceUnitIds?: string[]; sourceImageIds?:string[]; figurePage?:boolean; sourceArtifactRanges?:PptSourceArtifactRef[]; planningProtocolVersion?:2; groupId?: string;
  chunkRefs?: string[]; role?: string; question?: string; headlineIntent?: string; audienceTakeaway?: string;
  sourceTopics?: string[]; supportingPoints?: string[]; requiredSupport?: string[]; requiredDetails?: string[];
  keyPoints?: { text: string; refs: string[]; chunkRefs: string[]; label?: string; sourceUnitIds?: string[]; navigation?: boolean }[]; numberedPoints?: boolean; titleSecondary?: string;
  cardFrame?: 'divider' | 'takeaway';
  requiredEvidenceIds?: string[]; claimIds?: string[]; narrativeRole?: string; evidenceIntent?: string;
  visualIntent?: { type: string }; transitionFromPrevious?: string; transitionToNext?: string;
  pageContract?: { question?: string; groupingReason?: string; requiredRelations?: string[]; compositionCandidates?: string[] };
};
export type PptTemplate = {
  capabilities?: { relayout: boolean; insertSlide: boolean; minPages: number; maxPages: number; capacityCheck: string };
  id: string; name: string; category: string; description: string; pages: number; kind: string; compatibility: 'mapped' | 'reference';
  extension?: string; version?: number;
  pinned: boolean; tags: string[]; sampleTitles?: string[];
  palette?: { background: string; accent: string; foreground: string; muted: string } | null;
  fonts?: { title: string; body: string; titleEastAsia: string; bodyEastAsia: string; cjkExplicit?: boolean } | null;
};
export type PptModel = { id: string; name: string; configId: string; modelId: string; providerId?: string; capabilities?:PptModelCapabilities };
export type PptSource = { kind: 'prompt' | 'paste' | 'file' | 'update'; name: string; text: string; segments: { id: string; origin?: string; location: string; text: string }[]; images?: Extract<VisualBlock, { type: 'image' }>[]; mediaWarnings?: {code:string;message:string;location?:string}[]; truncated?: boolean; extension?: string; bytes?: number };
export type PptModelFinding = { slideIds: string[]; detail: string; bulletIndexes?: number[]; reason?: 'shallow'; suggestedFix?: string };
/** A judged deck-review finding that did not block publishing (live view). `id`
 * and `targets` come from the server; `review` is absent while it is open. */
export type PptReviewAdvisory = { id?: string; code: string; severity: string; detail?: string; suggestedFix?: string; slideIds?: string[]; nodeId?: string; advisory?: boolean; pageFlag?: boolean;
  targets?: { slideId: string; nodeId: string | null; basis?: string }[]; review?: { status: 'dismissed' | 'applied'; at?: string; operationId?: string } };
type PptRetiredMedia = { objectId: string; page: number; role?: string; status?: string; reason?: string | null; approvalBasis?: string | null };
export type PptMediaLedger = { resolvedAdaptations?:PptRetiredMedia[];conservation?: number | null; effectiveConservation?: number | null; approvedExclusions?: number; retired?: { objectId: string; page: number; role?: string; status?: string; reason?: string | null; approvalBasis?: string | null }[] };
export type PptQualityReport = { reviewState?:string; exportVerification?:{renderContractVersion?:number;revision?:number}; status: 'passed' | 'passed_with_warnings' | 'blocked'; mediaLedger?: PptMediaLedger; publishEligible?: boolean; editorialReady?: boolean; acceptanceAxes?: { nativeExport?: { status?: string; renderedVisibility?: 'passed' | 'unavailable' | 'not_evaluated' } }; reviewAdvisories?: number; reviewedAdvisories?: number; modelIssues?: PptReviewAdvisory[]; deterministic: { issues: { code: string; severity: string; message: string; slideId?: string | null; slideIds?: string[]; nodeIds?: string[]; pageFlag?: boolean }[]; hardErrors: number; flaggedPages?: string[] }; modelReview: null | { evaluation?: 'evaluated' | 'not_evaluated'; missing: PptModelFinding[]; repeated: PptModelFinding[]; conflicts: PptModelFinding[]; unsupported: PptModelFinding[] }; repairs: { code: string; slideId?: string; action: string }[];
  report?: { mode: 'presentation' | 'informational' | 'decision'; status: 'not_applicable' | 'ready' | 'needs_review'; issues: { code: string; message: string; slideId?: string | null }[]; metrics: { pages?: number; mainPages?: number; appendixPages?: number; sourceChars?: number; semanticChunks?: number; repeatedClaims?: number; smallTextPages?: number } } };
export type PptRichText = {version:number;source:string;plainText:string;diagnostics:{code:string;source?:string}[];runs:{kind:'text'|'math';text:string;baseline?:number;bold?:boolean;italic?:boolean;strike?:boolean;code?:boolean;href?:string;source?:string;tex?:string;mathMl?:string;status?:string;fallbackRuns?:{text:string;baseline:number;scale:number}[]}[]};
export type PptRenderElement = {
  shapeLayout?: {preset:string;supported:boolean;svg?:string};
  id: string; nodeId: string | null; sourceNodeId?: string; kind: string; bounds: PptBounds;
  surfaceFill?: {version:number;mode:'none'|'solid'|'preserve_native';color?:string;basis:string}|null;
  nativeRef?: { shapeId: number; slideIndex: number };
  content?: { text?: string; items?: { id: string; text: string; richText?:PptRichText; heading?: string; body?: string; headingRich?:PptRichText;bodyRich?:PptRichText; pointType?: string }[];
    pointLayout?: { boxes: { x: number; y: number; w: number; h: number }[]; fontSizePt: number; lineHeight?: number; overflow: boolean; columns: number; suggestedSplitCount?: number; variant?: 'flow' | 'layer-stack' | 'card-grid' | 'kpi' | 'hierarchy' | 'decision' | 'dependency-graph' | 'swimlane' | 'timeline' | 'overlap-windows' | 'cycle'; headingScale?: number; headingFontSizePt?: number; inlineHeading?: boolean; accent?: string; panelFill?: string; panelText?: string; rail?: { x: number }; markers?: string[]; markerInches?: number; markerFill?: string; markerText?: string; connectors?: { from: number; to: number; sourceEdgeId?: string; points?: { x: number; y: number }[] }[] };
    mathMl?: string; mathText?: string; mathStatus?: string;richText?:PptRichText;cellRich?:PptRichText[][];rawText?:string;
    dataUrl?: string; sourceImageId?:string; crop?: number[]; nativeMaskXml?:string;maskXml?:string; rows?: string[][]; headerRow?: boolean; rowWeights?: number[]; columnWeights?: number[]; labels?: string[]; values?: number[]; chartType?: 'bar' | 'pie' | 'line'; unit?: string; shape?: 'rect' | 'ellipse' };
  style?: { color?: string; fill?: string; fillMode?: 'none'|'solid'; tableHeaderColor?: string; fontFamily?: string; previewFontFamily?: string; previewFontWeight?: number; lineColor?: string; eastAsiaFontFamily?: string; fontSizePt?: number; fontWeight?: number; fontStyle?: string; textDecoration?: 'none' | 'underline'; textAlign?: string; lineHeight?: number; paragraphSpacingEm?: number; letterSpacing?: number; opacity?: number; shape?: string };
  textLayout?: {version:number; units:'pt';margins:number[];wrap:boolean;overflowWrap?:'normal'|'anywhere';autoFit:'none';fontFamily?:string;tabSize:number;code:boolean;paragraphs:{text:string;label?:string;lineHeight:number;spaceAfterPt:number;runs?:{text:string;fontSizePt:number;bold:boolean;fontFamily?:string;kind?:string;italic?:boolean;underline?:boolean;color?:string;href?:string;mathMl?:string}[]}[]};
  textStyleOverrides?: ('fontFamily' | 'eastAsiaFontFamily' | 'fontSizePt' | 'fontWeight' | 'fontStyle' | 'lineHeight')[];
  imageLayout?: {version:number;fit:'contain'|'cover'|'stretch'|'crop';crop:number[];valid:boolean;mask?:{status:'none'|'supported'|'unsupported';kind?:'rect'|'ellipse'|'polygon';css?:string;points?:number[][];reason?:string}};
  chartLayout?: {version:number;minimum:number;maximum:number;valid:boolean;unit:string;svg?:string};
  mathLayout?: {bounds:PptBounds;overflow:boolean;widthPt:number;heightPt:number};
  tableLayout?: {version:number;margins:number[];lineHeight:number;wrap:boolean};
  zIndex: number; rotation?: number; locked?: boolean; pinned?: boolean; groupId?: string | null; semanticRole?: string;
};
export type PptRenderSlide = { id: string; slideId: string; index: number; layoutId: string; size: { width: number; height: number }; background?: string; elements: PptRenderElement[] };
export type PptRenderTree = { schemaVersion: number; renderContractVersion?: number; units: 'emu'; deckId: string; hash: string; size: { width: number; height: number }; slides: PptRenderSlide[] };
export type PptRunNode = { id: string; dependsOn: string[]; status: string; attempts: number; error?: string | null; startedAt?: string | null; completedAt?: string | null; slideId?: string };
export type PptRun = { id: string; status: string; stage: string; lastSeq: number; nodes: Record<string, PptRunNode>; createdAt?: string; startedAt?: string | null; completedAt?: string | null; error?: string | null };

export type PptGenerationPolicy = { version: 1|2; detail: 'balanced' | 'concise' | 'standard' | 'detailed'; selection?:'editorial';archive?:'none'; sourceTypography?:'bounded'; language: { mode: 'source'; body?: 'primary' | 'both' } | {mode:'output';locale:'zh'|'en'|'zh-HK'}; content?: 'overview'|'course'|'full_source';details?:'slides'|'notes'; knowledge: 'source_only' | 'source_plus_explanation'; code?: { presentation: 'keep' | 'omit' } };
/** A disclosed planning decision shown with the estimate (code, diagrams, merges, language, tables). */
export type PptPlanningAssumption = { topic: 'code' | 'diagram' | 'merge' | 'language' | 'table'; decision: string; basis?: string; reversible: boolean; affectedSourceIds: string[]; reason: string };
export type PptLogicalCard={id:string;title:string;titleSecondary?:string;intent:string;points:string[]};
/** Card outline while it is written: each topic's cards once written, else null. */
/** Card deck settings form (Gamma): length presets, language, notes, rewrite instruction. */
export type PptCardLength={preset:'quick'|'standard'|'full'}|{exact:number};
export type PptCardLanguage='bilingual'|'en'|'zh'|'zh-Hant';
export type PptCardSettings={length:PptCardLength;brief?:boolean;presets?:Record<'quick'|'standard'|'full',{content:number;dividers:number;takeaway:boolean;total:number}>;language:PptCardLanguage;languageDefault?:PptCardLanguage;bilingualSource:boolean;notesOther:boolean;instruction:string};
export type PptSourceStructure={sections:number;chars:number;objects:{tables:number;code:number;equations:number;lists:number};images:number;primaryLanguage:string;bilingualRatio:number;warnings:{code:string;message:string}[]};
export type PptCardSummary={version:1;language:PptCardLanguage;notesOther?:boolean;textMode:'concise'|'standard'|'detailed';length:'quick'|'standard'|'full'|'custom';pages:number;steps:string[];objects:string[];images?:string[];statements:string[];chapters:string[];takeaway:boolean;uncoveredSections:string[];labelled:number;basis?:'source'|'brief';warnings:{code:string;message:string;params?:Record<string,string|number>}[]};
/** A source count that does not multiply out ("2×3×3 … 27 portfolios"). */
export type PptArithmeticParams={expression:string;calculated:number;claimed:number};
/** A card that states such a count (Fable, 2026-10-23): edit the point or keep the original. */
export type PptSourceNote={key:string;pageId:string;pointIndex:number|null;code:string;params:PptArithmeticParams;withExpression:boolean;resolved:boolean};
export type PptPlanningContract={version:3;sourceNotes?:PptSourceNote[];settings?:PptCardSettings;structure?:PptSourceStructure;summary?:PptCardSummary;flow?:'outline_first'|'cards';writing?:{pages:number};cardEdits?:{edited:number;added:number;removed:number;omittedSources:number};uncoveredSources?:number;phase:string;semanticRevision?:string;contentMode:'concise'|'standard'|'detailed'|null;logicalCards:PptLogicalCard[];pagePreference?:{mode:'fixed';exact:number}|{mode:'adaptive';target?:number;min?:number;max:number};plannedPageCount?:number;capacityReason?:string;capacityRevision?:string;measurement?:string;minimumPages?:number;readingEstimateBelowTopics?:boolean;loadEstimate?:{availableHeightInches:number;measurement:string;modes:Record<'concise'|'standard'|'detailed',{pages:number}>};loadContinuations?:{logicalCardId:string;title:string;parts:number}[]};
/** F1 failure trace persisted by the server (apps/cowork-server/lib/ppt-failure-trace.mjs). */
export type PptFailureTrace = {
  version: number;
  class: 'true_overflow' | 'unverified_capacity' | 'false_rejection' | 'planning' | 'remediation_no_progress' | 'transport' | string;
  stage?: string; code?: string; message?: string;
  step?: string; afterStep?: string;
  pageIndex?: number; slideId?: string; field?: string; measurement?: string;
  sourceUnitIds?: string[];
  repairs?: { pass?: number; kind?: string; outcome?: string; code?: string }[];
  governor?: { stopped?: string; used?: number; budget?: number; adviseAll?: string; advised?: Record<string, number> };
};

/** A PDF source warning grouped for the document (pages, count) or a margin stamp (text). */
export type PptPdfWarningParams={pages?:string;count?:number;text?:string};
export type PptProject = {
  planningContract?:PptPlanningContract; planningPhase?:string;
  /** Tools missing on this machine (F12), e.g. the export verifier. */
  runtimeWarnings?:{code:string;message:string}[];
  settingsReceipt?:{version:1;hash:string;detail:string;content:string;executionStrategy:string;language?:PptGenerationPolicy["language"];knowledge?:PptGenerationPolicy["knowledge"];template?:string;recommended?:number;confirmedPages:number|null;basis:string};
  libraryEligible?: boolean; taskEligible?:boolean; libraryReserved?:boolean; coverAvailable?:boolean; taskDeletedAt?:string; presentationDeletedPermanentlyAt?:string; taskRecordOnly?:boolean;
  pageCounts?:{estimated:number|null;planned:number;confirmed:number|null;draft:number;published:number|null};
  timeline?:{stage:string;at:string}[];
  versionDetails?: {source:{parser?:string;implementationHash?:string|null;sourceHash?:string|null;at?:string}|null;generation:{implementationHash?:string|null;promptContractVersion?:number;model?:string;at?:string}|null;sourceHash?:string|null;models:{stage:string;model:string}[];origin?:{projectId:string;revision:number;inputBasis?:string}|null};
  generationPolicy?: PptGenerationPolicy; promptContractVersion?: number;
  id: string; title: string; prompt: string; pages: number; template: string;
  deckTitle?: { text: string; raw: string; source: 'user' | 'agent'; locked: boolean };
  pageDecision?: { finalPageCount: number; source: 'user' | 'estimate'; includesCover: boolean; confirmedAt: string | null; mode?: 'auto' | 'explicit' | 'preserve_import'; initialPageCount?: number; densityProfileId?: string; estimateVersion?: number; fitValidated?: boolean; awaitingInputRead?:boolean;
    growth?: { initial: number | null; final: number; limit: number; basis: 'presentation_budget' | 'initial_estimate'; needsConfirmation: boolean; causes?: PptGrowthCauses };
    concision?: { pages: number; contentPages: number; majorSections: number; pagesPerSection: number | null; medianFill: number | null; withinBudget: boolean | null; budget: { target: number; max: number } | null; warnings: ('over_budget' | 'underfilled' | 'page_per_section')[] } };
  planning?: { pageRecommendation?: { recommended: number; range: [number, number]; reason: string; reasonBase?: string; assumptions?: PptPlanningAssumption[] } };
  /** Round 7: deterministic outline corrections and remaining listed warnings. */
  outlineCorrections?: { version: number; items: { code: string; sourceUnitId?: string; pageIndex?: number }[]; summary: { code: string; count: number }[];
    warnings: { code: string; pageIndex?: number; message?: string; details?: { templatePage?: number; key?: string; cause?: string | null; pageIndex?: number; fontSizePt?: number; availableHeightInches?: number; usedHeightInches?: number; predictedOverflowInches?: number; sourceUnitIds?: string[] }; pageIndexes?: number[]; sourceUnitIds?: string[]; resolution: 'writer_fits_title' | 'review_in_outline' | 'confirm_page_count' | 'fit_inside_page' | 'template_layout_skipped' | 'repartition_source_before_confirmation' | 'audit_skipped' | 'editorial_merge_skipped' | 'resolve_source_warning' | 'model_fallback_used'; blocking?: boolean; requiresReview?: boolean }[] };
  displayStatus?: PptProject['status']|'waiting_client';
  /** Live generation view only: real per-page sub-stages and streaming drafts. */
  generationStages?: { deck: string; pages: Record<string, string> };
  generationSkeletons?: Record<string,PptRenderSlide>;
  generationMedia?: Record<string,{id:string;caption:string;width:number;height:number}[]>;
  outlineProgress?:{done:number;total:number};
  /** The card outline as it forms; the candidate outline replaces its cards. */
  outlineForming?:{version:number;revision?:string;phase:'cards'|'finishing'|'fitting'|'checking';done:number;total:number;at:string;syllabus:{id:string;title:string;points:string[];pending?:boolean}[]};
  deckStage?: string; currentPage?: { index: number; title: string; stage?: string };
  drafts?: Record<string, { title?: string; blocks?: { text: string; heading?: string; field?: string; type?:string; sourceUnitId?: string;sourceRef?:PptSourceArtifactRef;richText?:PptRichText }[]; typing?: string; chars?: number;runId?:string;epoch?:number;seq?:number;jobId?:string;updatedAt?:string }>;
  progress?: {contentReady:number;previewReady:number;total:number;phase:string;quality:string;lastUpdated:string};
  sourceAssets?:{id:string;caption:string;width?:number;height?:number;required:boolean;slideIds:string[]}[];sourceMediaWarnings?:{code:string;message:string;location?:string;key?:string;required?:boolean;resolved?:boolean;kept?:boolean;cause?:string;params?:PptArithmeticParams|PptPdfWarningParams}[];
  executionPolicy?:PptExecutionPolicy;executionHistory?:PptExecutionRecord[];
  templateContentMode?:'design_only'|'keep_fixed';templateFixedObjectIds?:string[];
  compressionApproved?: boolean;
  templateSpec?: { id: string; name: string; version: number; palette?: PptTemplate['palette']; fonts?: PptTemplate['fonts'] };
  update?: { baseSnapshot: { title: string; deck?: { slides: PptSlide[] } | null } };
  version?: { rootId: string; parentId: string | null; number: number };
  diff?: { kept: number; rewritten: number; added: number; removed: { id: string; title: string }[] };
  status: 'ingesting' | 'outlining' | 'input_ready' | 'outline_ready' | 'generating' | 'paused' | 'quality_blocked' | 'completed' | 'failed' | 'cancelled';
  /** Why a written deck is quality-blocked: its own checks and findings, or a failed export verification. */
  qualityBlockReason?: 'checks' | 'export';
  userRequirements?: string;
  /** Requirements the author added while paused (instructions, never facts). */
  requirements?: { id: string; text: string; scope: 'remaining' | 'all'; phase: 'outlining' | 'generating'; at: string }[];
  failure?: {version:number;stage:string;code:string;origin?:import('@/lib/ppt-failure-origin').PptFailureOrigin;contractStage?:string;model:string;at:string;modelStage?:string;diagnostic?:{httpStatus?:number;kind?:string;sdkName?:string;networkCode?:string;origin?:string;elapsedMs?:number;firstTokenMs?:number;receivedChars?:number};trace?:PptFailureTrace};
  modelUsage?: {stage:string;model:string;characters:number;utf8Bytes:number;estimatedInputTokens:number;telemetry?:{finishReason?:string;outputMode?:string;inputTokens?:number;outputTokens?:number;reasoningTokens?:number}}[];
  postWriterPlan?: {version:number;revision:number;frozenPageCount:number;application:string;pages:{slideId:string;emptyNodeIds:string[];actualObjects:number;measuredFit:{capacity_ok:boolean;layoutId:string}|null}[];mergeProposals:{slideIds:string[];reason:string;fontSizePt:number;layoutId:string}[]};
  contentSelection?: {hash:string;entries:{sourceUnitId:string;destination:string;reason:string;sourceExcerpt?:string;summaryText?:string;summaryRows?:string[][];rowIndices?:number[]}[]};
  inputUnderstanding?:{sourceIssues?:{sourceUnitId:string;quote:string;kind:string;explanation:string}[];recommended:number;min:number;max:number;reason:string;basis:string;sourceIdentity:string;primaryLanguage:string};
  pageBudget?:{version:2;authority?:'llm_reading';mode:string;recommended:number;range:{min:number;max:number};reason:string;modelEstimate?:{recommended:number;min:number;max:number};measured?:PptMeasuredPages;adjusted?:boolean;measuredExceedsRequest?:boolean};
  pageBudgetConflict?: {message:string;details?:unknown};
  pageReassessment?:{identity:string;basis:'llm_capacity_reassessment';model:string;recommended:number;min:number;max:number;reason:string;selectionChanges:string[];sectionBudgets:{section:string;pages:number;purpose:string}[];originalRecommended:number;selectedPages:number;at:string};
  outlineAcceptance?: {version:number;schema:boolean;ownership:boolean;semantic:boolean;physical:boolean;confirmable:boolean;issues:unknown[]};
  candidateOutline?: {version:number;accepted:boolean;candidatePages:number;hash:string;sourceHash:string;model:string;attempt:number;createdAt:string;syllabus:{id?:string;title:string;message:string;section?:string}[];executionPlan:unknown;issues:{code:string;message:string;slideId?:string;details?:unknown}[]};
  stage: string; error: string; outline: PptSlide[]; deck: { slides: PptSlide[]; deckId?: string; schemaVersion?: number;
    themeTokens?: { titleScale: number; bodyScale: number; spacingScale: number } } | null;
  nodes?: Record<string, { status: string; attempts?: number; slide?: PptSlide;epoch?:number }>; dagNodes?: Record<string, PptRunNode>;
  quality?: PptQualityReport; revision: number; draftRevision?: number; publishedRevision?: number; publishedRenderContractVersion?: number; publishedRenderTree?: {renderContractVersion?: number}; renderUpgradePending?: boolean; currentRunId?: string;
  renderTree?: PptRenderTree; sourceRevision?: number; source?: PptSource | null; inputKind?: string; model?: string; configId?: string;
  runtime?: { lifecycle: string; pauseRequested?: boolean; resumePhase?: 'generating'; slides: Record<string, { phase: string; updatedAt?:string; accepted?: boolean; epoch?: number; renderHash?: string; quality?: {issues?: {severity?: string; code?: string; message?: string}[]}; componentCommit?: {seq:number;renderHash:string;componentHash:string;refs:PptSourceArtifactRef[]}; repairComparison?: {id:string;slideId:string;revision:number;beforeHash:string;afterHash:string;beforeUrl:string;afterUrl:string;at:string;findings:{code?:string;detail?:string}[]}; preview?: PptRenderSlide }> };
  planRevision?: { version: number; hash: string }; constraints?: { version: number };
  editing?: { epochs?:Record<string,number>; conversationVersion?:string; contentOpen: boolean; intents: Record<string, PptEditIntent> };
  creationContext?: { generationPolicy?: PptGenerationPolicy; promptContractVersion?: number; planKey: string; sourceHash: string; pageBudget: { confirmed: number } };
  externalPptx?: unknown;
  /** A read returns a summary unless ?include=templateFidelity: the template's slides, source catalog and component profile become counts. */
  /** A project's local-edit capabilities (relayout: some page can be laid out again by code). */
  editCapabilities?: { relayout: boolean };
  templateFidelity?: { mode: 'preserve'; originalPath?: string; slides?: unknown[]; summary?: boolean; counts?: { slides: number; sourceCatalog: number; componentProfile: number } };
  favorite?: boolean; pinned?: boolean; manualOrder?: number; folderId?: string | null; tags?: string[]; deletedAt?: string | null; createdAt: string; updatedAt: string;
};

export type StructuredProjectView = PptProject;

export type PptAiProposal = {
  structureChange?:{operation:string;targetId:string;removedId:string;before:number;after:number};
  target?: {kind:string;itemId?:string;start?:number;end?:number;expectedText:string};
  candidateHash?:string;replacement?:string; alternatives?:{id:string;layoutId:string;afterSvg:string}[];
  action?: string; parameters?: Record<string, unknown>; metrics?: { beforeLength: number; afterLength: number; ratio: number | null; requestedRatio?: number; unchanged: boolean; approximateTargetMet?: boolean };
  id: string; scope: 'object' | 'slide' | 'deck'; type?: PptMutationType; pageDelta?: number; afterSlides?: { slideId: string; svg: string }[]; slideId: string; nodeId?: string; instruction: string;
  baseRevision: number; targetContentHash: string; planKey: string; beforeSvg: string; afterSvg: string;
  content?: {text?:string;items?:{id:string;text:string}[];[key:string]:unknown}; patches?: { nodeId: string; content: unknown }[]; layoutId?: PptLayoutId;
  quality: { issues: { code: string; severity: string; message: string }[]; hardErrors: number; objectChanges?: {objectId:string;status:string}[]; preservedObjectIds?:string[] };
};
export type PptMutationType = 'auto' | 'title' | 'content' | 'layout' | 'style' | 'asset' | 'data' | 'structure';
export type PptGenerationScope = 'current' | 'remaining' | 'following' | 'section' | 'deck';
export type PptEditScope = { id: string; runId: string; planKey: string; currentSlideId: string; remainingSlideIds: string[]; followingSlideIds?: string[]; sectionSlideIds?: string[]; deckSlideIds?: string[]; openedAt: string };
export type PptEditIntent = { id: string; scope: PptGenerationScope; type?: PptMutationType; scopeSnapshot: PptEditScope; instruction: string; status: string; perSlideResults: Record<string, { status: string; milestone?: string; proposalId?: string; error?: string; operationId?: string; revision?: number }> };
/** Server measurement of complete structures at the template body size (P0-4). */
export type PptMeasuredPages = { version: 1; basis: string; fontSizePt: number; structuralBodyPages: number; structuralPages: number; largeArtifacts: { sourceUnitId: string; type: string; pages: number }[]; codeEstimate: { recommended: number; range: [number, number] } | null };
export type PptGrowthCauses = { splitArtifacts: { sourceUnitId: string; type: string; pages: number; title: string }[]; dedicatedStructuralPages: number; measuredStructuralPages: number | null; modelEstimate: number | null };

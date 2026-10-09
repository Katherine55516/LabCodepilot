import type { VisualBlock } from './PptBlocks';

export type PptLayoutId = 'cover' | 'summary' | 'editorial' | 'big-number' | 'comparison' | 'chart' | 'table' | 'image-text' | 'timeline' | 'two-panel' | 'formula-variables' | 'item-icons' | 'conclusion';
export type PptBounds = { x: number; y: number; width: number; height: number };
export type PptOutlineChild = { id: string; title: string; description: string };
export type PptSlide = {
  id: string; title: string; focus?: string; description?: string; section?: string; children?: PptOutlineChild[]; refs?: string[];
  bullets?: string[]; blocks?: VisualBlock[]; layoutId?: PptLayoutId; layout?: 'text-first' | 'visual-first'; sourceRefs?: string[];
  baseSlideId?: string | null; change?: 'keep' | 'rewrite' | 'add'; manualBlank?: boolean;
  titleLocked?: boolean; density?: 'low' | 'medium' | 'high'; distributionType?: string; semanticUnitBudget?: number; pointLengthProfile?: string;
  sourceUnitIds?: string[]; groupId?: string;
  chunkRefs?: string[]; role?: string; question?: string; headlineIntent?: string; audienceTakeaway?: string;
  sourceTopics?: string[]; supportingPoints?: string[]; requiredSupport?: string[]; requiredDetails?: string[];
  keyPoints?: { text: string; refs: string[]; chunkRefs: string[] }[];
  requiredEvidenceIds?: string[]; claimIds?: string[]; narrativeRole?: string; evidenceIntent?: string;
  visualIntent?: { type: string }; transitionFromPrevious?: string; transitionToNext?: string;
};
export type PptTemplate = {
  capabilities?: { relayout: boolean; insertSlide: boolean; minPages: number; maxPages: number; capacityCheck: string };
  id: string; name: string; category: string; description: string; pages: number; kind: string; compatibility: 'mapped' | 'reference';
  extension?: string; version?: number;
  pinned: boolean; tags: string[]; sampleTitles?: string[];
  palette?: { background: string; accent: string; foreground: string; muted: string } | null;
  fonts?: { title: string; body: string; titleEastAsia: string; bodyEastAsia: string; cjkExplicit?: boolean } | null;
};
export type PptModel = { id: string; name: string; configId: string; modelId: string; providerId?: string };
export type PptSource = { kind: 'prompt' | 'paste' | 'file' | 'update'; name: string; text: string; segments: { id: string; origin?: string; location: string; text: string }[]; images?: Extract<VisualBlock, { type: 'image' }>[]; truncated?: boolean; extension?: string; bytes?: number };
export type PptModelFinding = { slideIds: string[]; detail: string; bulletIndexes?: number[]; reason?: 'shallow'; suggestedFix?: string };
export type PptQualityReport = { status: 'passed' | 'passed_with_warnings' | 'blocked'; publishEligible?: boolean; editorialReady?: boolean; deterministic: { issues: { code: string; severity: string; message: string; slideId?: string | null }[]; hardErrors: number }; modelReview: null | { evaluation?: 'evaluated' | 'not_evaluated'; missing: PptModelFinding[]; repeated: PptModelFinding[]; conflicts: PptModelFinding[]; unsupported: PptModelFinding[] }; repairs: { code: string; slideId?: string; action: string }[];
  report?: { mode: 'presentation' | 'informational' | 'decision'; status: 'not_applicable' | 'ready' | 'needs_review'; issues: { code: string; message: string; slideId?: string | null }[]; metrics: { pages?: number; mainPages?: number; appendixPages?: number; sourceChars?: number; semanticChunks?: number; repeatedClaims?: number; smallTextPages?: number } } };
export type PptRenderElement = {
  id: string; nodeId: string | null; sourceNodeId?: string; kind: string; bounds: PptBounds;
  content?: { text?: string; items?: { id: string; text: string; heading?: string; body?: string; pointType?: string }[];
    pointLayout?: { boxes: { x: number; y: number; w: number; h: number }[]; fontSizePt: number; overflow: boolean; columns: number; suggestedSplitCount?: number };
    mathMl?: string; mathText?: string; mathStatus?: string;
    dataUrl?: string; sourceImageId?:string; crop?: number[]; rows?: string[][]; rowWeights?: number[]; columnWeights?: number[]; labels?: string[]; values?: number[]; chartType?: 'bar' | 'pie' | 'line'; unit?: string; shape?: 'rect' | 'ellipse' };
  style?: { color?: string; fill?: string; tableHeaderColor?: string; fontFamily?: string; eastAsiaFontFamily?: string; fontSizePt?: number; fontWeight?: number; fontStyle?: string; textAlign?: string; lineHeight?: number; paragraphSpacingEm?: number; letterSpacing?: number; opacity?: number; shape?: string };
  textLayout?: {version:number; units:'pt';margins:number[];wrap:boolean;autoFit:'none';fontFamily?:string;tabSize:number;code:boolean;paragraphs:{text:string;label?:string;lineHeight:number;spaceAfterPt:number;runs?:{text:string;fontSizePt:number;bold:boolean}[]}[]};
  imageLayout?: {version:number;fit:'contain'|'cover'|'stretch'|'crop';crop:number[];valid:boolean};
  chartLayout?: {version:number;minimum:number;maximum:number;valid:boolean;unit:string;svg?:string};
  mathLayout?: {bounds:PptBounds;overflow:boolean;widthPt:number;heightPt:number};
  tableLayout?: {version:number;margins:number[];lineHeight:number;wrap:boolean};
  zIndex: number; rotation?: number; locked?: boolean; groupId?: string | null; semanticRole?: string;
};
export type PptRenderSlide = { id: string; slideId: string; index: number; layoutId: string; size: { width: number; height: number }; background?: string; elements: PptRenderElement[] };
export type PptRenderTree = { schemaVersion: number; renderContractVersion?: number; units: 'emu'; deckId: string; hash: string; size: { width: number; height: number }; slides: PptRenderSlide[] };
export type PptRunNode = { id: string; dependsOn: string[]; status: string; attempts: number; error?: string | null; startedAt?: string | null; completedAt?: string | null; slideId?: string };
export type PptRun = { id: string; status: string; stage: string; lastSeq: number; nodes: Record<string, PptRunNode>; createdAt?: string; startedAt?: string | null; completedAt?: string | null; error?: string | null };

export type PptGenerationPolicy = { version: 1; detail: 'balanced' | 'detailed'; language: { mode: 'source' }; knowledge: 'source_only' | 'source_plus_explanation'; code?: { presentation: 'keep' | 'omit' } };
/** A disclosed planning decision shown with the estimate (code, diagrams, merges, language, tables). */
export type PptPlanningAssumption = { topic: 'code' | 'diagram' | 'merge' | 'language' | 'table'; decision: string; basis?: string; reversible: boolean; affectedSourceIds: string[]; reason: string };
export type PptProject = {
  generationPolicy?: PptGenerationPolicy; promptContractVersion?: number;
  id: string; title: string; prompt: string; pages: number; template: string;
  deckTitle?: { text: string; raw: string; source: 'user' | 'agent'; locked: boolean };
  pageDecision?: { finalPageCount: number; source: 'user' | 'estimate'; includesCover: boolean; confirmedAt: string | null; mode?: 'auto' | 'explicit' | 'preserve_import'; initialPageCount?: number; densityProfileId?: string; estimateVersion?: number; fitValidated?: boolean };
  planning?: { pageRecommendation?: { recommended: number; range: [number, number]; reason: string; reasonBase?: string; assumptions?: PptPlanningAssumption[] } };
  compressionApproved?: boolean;
  templateSpec?: { id: string; name: string; version: number; palette?: PptTemplate['palette']; fonts?: PptTemplate['fonts'] };
  update?: { baseSnapshot: { title: string; deck?: { slides: PptSlide[] } | null } };
  version?: { rootId: string; parentId: string | null; number: number };
  diff?: { kept: number; rewritten: number; added: number; removed: { id: string; title: string }[] };
  status: 'ingesting' | 'outlining' | 'outline_ready' | 'generating' | 'paused' | 'quality_blocked' | 'completed' | 'failed' | 'cancelled';
  stage: string; error: string; outline: PptSlide[]; deck: { slides: PptSlide[]; deckId?: string; schemaVersion?: number;
    themeTokens?: { titleScale: number; bodyScale: number; spacingScale: number } } | null;
  nodes?: Record<string, { status: string; attempts?: number; slide?: PptSlide }>; dagNodes?: Record<string, PptRunNode>;
  quality?: PptQualityReport; revision: number; draftRevision?: number; publishedRevision?: number; currentRunId?: string;
  renderTree?: PptRenderTree; sourceRevision?: number; source?: PptSource | null; inputKind?: string; model?: string; configId?: string;
  runtime?: { lifecycle: string; pauseRequested?: boolean; slides: Record<string, { phase: string; accepted?: boolean; epoch?: number; renderHash?: string; preview?: PptRenderSlide }> };
  planRevision?: { version: number; hash: string }; constraints?: { version: number };
  editing?: { contentOpen: boolean; intents: Record<string, PptEditIntent> };
  creationContext?: { generationPolicy?: PptGenerationPolicy; promptContractVersion?: number; planKey: string; sourceHash: string; pageBudget: { confirmed: number } };
  externalPptx?: unknown;
  templateFidelity?: { mode: 'preserve'; originalPath: string; slides: unknown[] };
  favorite?: boolean; pinned?: boolean; manualOrder?: number; folderId?: string | null; tags?: string[]; deletedAt?: string | null; createdAt: string; updatedAt: string;
};

export type StructuredProjectView = PptProject;

export type PptAiProposal = {
  action?: string; parameters?: Record<string, unknown>; metrics?: { beforeLength: number; afterLength: number; ratio: number | null; requestedRatio?: number; unchanged: boolean; approximateTargetMet?: boolean };
  id: string; scope: 'object' | 'slide' | 'deck'; type?: PptMutationType; pageDelta?: number; afterSlides?: { slideId: string; svg: string }[]; slideId: string; nodeId?: string; instruction: string;
  baseRevision: number; targetContentHash: string; planKey: string; beforeSvg: string; afterSvg: string;
  content?: unknown; patches?: { nodeId: string; content: unknown }[]; layoutId?: PptLayoutId;
  quality: { issues: { code: string; severity: string; message: string }[]; hardErrors: number; objectChanges?: {objectId:string;status:string}[]; preservedObjectIds?:string[] };
};
export type PptMutationType = 'auto' | 'title' | 'content' | 'layout' | 'style' | 'asset' | 'data' | 'structure';
export type PptGenerationScope = 'current' | 'remaining' | 'following' | 'section' | 'deck';
export type PptEditScope = { id: string; runId: string; planKey: string; currentSlideId: string; remainingSlideIds: string[]; followingSlideIds?: string[]; sectionSlideIds?: string[]; deckSlideIds?: string[]; openedAt: string };
export type PptEditIntent = { id: string; scope: PptGenerationScope; type?: PptMutationType; scopeSnapshot: PptEditScope; instruction: string; status: string; perSlideResults: Record<string, { status: string; milestone?: string; proposalId?: string; error?: string; operationId?: string; revision?: number }> };

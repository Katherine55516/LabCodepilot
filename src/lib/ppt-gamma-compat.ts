/**
 * Gamma-compatible request contract for the PPT engine.
 *
 * Gamma's public API (developers.gamma.app, v1.0) is create-then-poll: a
 * client POSTs a generation, polls GET /generations/{id} until `completed` or
 * `failed`, and downloads `exportUrl`. This module holds the pure half of the
 * compatibility layer: it validates Gamma-shaped requests, maps them onto the
 * engine's own project request and planning command, decides the next engine
 * step from a project snapshot, and projects a project back into Gamma's
 * status shape. No I/O lives here, so every mapping rule is unit-tested.
 *
 * Mapping decisions (see docs/handover/ppt-gamma-compat.md):
 * - Only what the engine really does is accepted. A Gamma value the engine
 *   cannot honour either fails with 400 (format, export type, language,
 *   multi-page) or is accepted with a warning that names what was ignored
 *   (image sources, card dimensions, header/footer, sharing, folders).
 * - textMode chooses the input kind and the knowledge policy; amount chooses
 *   the engine's text density; numCards becomes an exact length (6-40).
 * - cardSplit=inputTextBreaks becomes the engine's author outline: one card
 *   per `\n---\n` segment, its points kept as written.
 */

export type GammaFlavor = 'classic' | 'agent';
export type PptContentMode = 'concise' | 'standard' | 'detailed';
export type PptLanguageChoice = 'en' | 'zh' | 'zh-Hant';
export type GammaExportType = 'pptx' | 'pdf';

export interface GammaWarning { code: string; message: string }

export class GammaApiError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) { super(message); }
}

/** What the facade must remember between the create call and later polls. */
export interface GammaJobSettings {
  flavor: GammaFlavor;
  /** Exact engine length; absent means the engine's standard preset. */
  exactCards?: number;
  contentMode: PptContentMode;
  language?: PptLanguageChoice;
  exportAs?: GammaExportType;
  /** True when the request carried its own card outline (inputTextBreaks). */
  authorOutline: boolean;
}

/** Body for the engine's POST /ppt/projects. */
export interface PptCreateRequest {
  inputKind: 'prompt' | 'paste';
  prompt: string;
  text?: string;
  title?: string;
  template?: string;
  pages?: number;
  outline?: { title: string; keyPoints: string[] }[];
  readOnlyInput: boolean;
  /** Embedded source images (PNG/JPEG data URLs), fetched from imageUrls. */
  images?: { dataUrl: string; caption: string; required: false }[];
  generationPolicy: {
    version: 2; detail: PptContentMode; selection: 'editorial'; archive: 'none'; sourceTypography: 'bounded';
    content: 'overview' | 'full_source';
    knowledge: 'source_only' | 'source_plus_explanation';
    language: { mode: 'output'; locale: 'en' | 'zh' | 'zh-HK' } | { mode: 'source'; body: 'both'; title: 'primary' };
  };
}

export interface ParsedGammaGeneration {
  create: PptCreateRequest; settings: GammaJobSettings; warnings: GammaWarning[];
  /** Image URLs found in the input (Gamma's rules); the service fetches and embeds them. */
  imageUrls: string[];
}

/** Engine limits this layer must respect (apps/cowork-server/lib/ppt-api.mjs). */
export const PPT_EXACT_LENGTH = { min: 6, max: 40 } as const;
export const PPT_AUTHOR_OUTLINE = { min: 3, max: 100 } as const;
const PPT_MAX_PROMPT = 80_000;
/** Gamma documents ~400,000 characters for inputText and prompt. */
const GAMMA_MAX_INPUT = 400_000;
const TEMPLATE_ID = /^(violet|blue|light|marketing|education|[a-f0-9]{32})$/i;
const CARD_BREAK = /\r?\n---\r?\n/;

const CLASSIC_FIELDS = new Set(['inputText', 'textMode', 'format', 'themeId', 'numCards', 'cardSplit', 'additionalInstructions', 'title',
  'exportAs', 'textOptions', 'imageOptions', 'cardOptions', 'sharingOptions', 'folderId', 'folderIds', 'pages', 'publish']);
const AGENT_FIELDS = new Set(['prompt', 'format', 'numCards', 'quality', 'themeId', 'templateId', 'sourceUrls', 'files',
  'additionalInstructions', 'exportAs', 'sharingOptions', 'folderId', 'disableConnectors']);

const AMOUNT: Record<string, PptContentMode> = { brief: 'concise', medium: 'standard', detailed: 'detailed', extensive: 'detailed' };
/** Gamma language code -> the engine's deck language choice. */
const LANGUAGES: Record<string, PptLanguageChoice> = { en: 'en', 'en-gb': 'en', 'en-in': 'en', 'zh-cn': 'zh', 'zh-tw': 'zh-Hant' };
const LOCALE: Record<PptLanguageChoice, 'en' | 'zh' | 'zh-HK'> = { en: 'en', zh: 'zh', 'zh-Hant': 'zh-HK' };
/** Image sources whose effect the engine already has: template imagery and the input's own images. */
const IMAGE_SOURCES_HONOURED = new Set(['noImages', 'themeAccent', 'placeholder']);
const IMAGE_SOURCES = new Set(['aiGenerated', 'giphy', 'noImages', 'pexels', 'pictographic', 'placeholder', 'themeAccent', 'webAllImages', 'webFreeToUse', 'webFreeToUseCommercially']);

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bad = (message: string, code = 'invalid_request') => new GammaApiError(400, message, code);

function optionalString(body: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw bad(`${key} must be a string`);
  if (value.length > max) throw bad(`${key} must be at most ${max} characters`);
  return value.trim() || undefined;
}

function oneOf<T extends string>(value: unknown, key: string, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw bad(`${key} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function rejectUnknown(body: Record<string, unknown>, allowed: Set<string>) {
  const unknown = Object.keys(body).filter(key => !allowed.has(key));
  if (unknown.length) throw bad(`Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, 'unknown_field');
}

function readFormat(value: unknown) {
  const format = oneOf(value, 'format', ['presentation', 'document', 'social', 'webpage'] as const);
  if (format && format !== 'presentation') throw bad(`format "${format}" is not supported; this engine only builds presentations`, 'unsupported_format');
}

function readExport(value: unknown): GammaExportType | undefined {
  const exportAs = oneOf(value, 'exportAs', ['pdf', 'png', 'pptx'] as const);
  if (exportAs === 'png') throw bad('exportAs "png" is not supported; use "pptx" or "pdf"', 'unsupported_export');
  return exportAs;
}

/** numCards: Gamma allows 1-100; the engine's exact length is 6-40. */
function readNumCards(value: unknown, warnings: GammaWarning[]): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) throw bad('numCards must be an integer from 1 to 100');
  const clamped = Math.max(PPT_EXACT_LENGTH.min, Math.min(PPT_EXACT_LENGTH.max, value));
  if (clamped !== value) warnings.push({ code: 'num_cards_adjusted', message: `numCards ${value} was changed to ${clamped}: this engine builds ${PPT_EXACT_LENGTH.min}-${PPT_EXACT_LENGTH.max} cards for an exact length.` });
  return clamped;
}

function readTemplate(value: unknown, key: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !TEMPLATE_ID.test(value)) throw bad(`${key} is not a known theme id; list themes with GET /v1.0/themes`, 'unknown_theme');
  return value.toLowerCase();
}

function readSharingAndFolder(body: Record<string, unknown>, warnings: GammaWarning[]) {
  if (body.folderId !== undefined || (Array.isArray(body.folderIds) && body.folderIds.length))
    warnings.push({ code: 'ignored_folder_id', message: 'Folder placement is not applied; the presentation appears in the PPT workspace.' });
  if (isObject(body.sharingOptions)) {
    if (body.sharingOptions.workspaceAccess !== undefined) warnings.push({ code: 'ignored_workspace_access', message: 'Workspace sharing is not applied; presentations stay private to this account.' });
    if (body.sharingOptions.externalAccess !== undefined) warnings.push({ code: 'ignored_external_access', message: 'External sharing is not applied; presentations stay private to this account.' });
    if (body.sharingOptions.emailOptions !== undefined) warnings.push({ code: 'ignored_email_options', message: 'Email invitations are not sent.' });
  }
}

function policy(contentMode: PptContentMode, textMode: 'generate' | 'condense' | 'preserve', language?: PptLanguageChoice): PptCreateRequest['generationPolicy'] {
  return {
    version: 2, detail: contentMode, selection: 'editorial', archive: 'none', sourceTypography: 'bounded',
    content: textMode === 'preserve' ? 'full_source' : 'overview',
    knowledge: textMode === 'generate' ? 'source_plus_explanation' : 'source_only',
    language: language ? { mode: 'output', locale: LOCALE[language] } : { mode: 'source', body: 'both', title: 'primary' },
  };
}

/** Split `\n---\n` segments into author cards: the first heading is the title, the other lines are points. */
export function splitAuthorCards(inputText: string): { title: string; keyPoints: string[] }[] {
  return inputText.split(CARD_BREAK).map(segment => segment.trim()).filter(Boolean).map((segment, index) => {
    const lines = segment.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const headingIndex = lines.findIndex(line => /^#{1,6}\s+/.test(line));
    const titleIndex = headingIndex >= 0 ? headingIndex : 0;
    const title = lines[titleIndex].replace(/^#{1,6}\s+/, '').trim().slice(0, 160) || `Card ${index + 1}`;
    const keyPoints = lines.filter((_, i) => i !== titleIndex).map(line => line.replace(/^(?:[-*+•]|\d+[.)])\s+/, '').trim()).filter(Boolean).map(point => point.slice(0, 600));
    return { title, keyPoints };
  });
}

/** Image extensions Gamma recognises in input text; the engine embeds only PNG and JPEG. */
const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|svg|heic|heif|avif)$/i;
export const MAX_INPUT_IMAGES = 20;

function imageUrl(token: string): string | undefined {
  const candidate = token.replace(/[),.;:!?]+$/, '');
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && IMAGE_EXTENSION.test(url.pathname) ? url.href : undefined;
  } catch { return undefined; }
}

/**
 * Gamma's image-URL preprocessor, adapted to the engine. Gamma uses a bare,
 * whitespace-separated https URL ending in an image extension, fetches and
 * re-hosts it, and silently skips one it cannot fetch; it ignores image URLs
 * wrapped in Markdown or <img>. The engine instead treats every image
 * reference it cannot embed as a required source object, which would block
 * generation, so all remote image references leave the text here: bare
 * https URLs are returned for fetching, wrapped ones become their alt text.
 */
export function extractImageUrls(input: string): { text: string; urls: string[] } {
  const urls: string[] = [];
  const remote = (reference: string) => /^(?:https?:)?\/\//i.test(reference.trim());
  let text = input
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (all, alt: string, reference: string) => (remote(reference) ? alt : all))
    .replace(/<img\b[^>]*>/gi, tag => {
      const src = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] || '';
      return remote(src) ? tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '' : tag;
    });
  text = text.replace(/\S+/g, token => {
    const url = imageUrl(token);
    if (url) { if (!urls.includes(url)) urls.push(url); return ''; }
    // An http:// image URL is not used by Gamma either; drop it so it cannot block the deck.
    return /^http:\/\/\S+\.(?:jpe?g|png)(?:\?\S*)?$/i.test(token.replace(/[),.;:!?]+$/, '')) ? '' : token;
  });
  return { text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), urls };
}

function requirementLines(parts: [label: string, value: string | undefined][]) {
  return parts.filter(([, value]) => value).map(([label, value]) => (label ? `${label}: ${value}` : value!)).join('\n');
}

/** POST /v1.0/generations (Classic). */
export function parseClassicGeneration(raw: unknown): ParsedGammaGeneration {
  if (!isObject(raw)) throw bad('Request body must be a JSON object');
  const body = raw;
  rejectUnknown(body, CLASSIC_FIELDS);
  if (body.pages !== undefined) throw bad('Multi-page generation (pages) is not supported; send one inputText', 'unsupported_pages');
  const warnings: GammaWarning[] = [];
  if (body.publish === true) warnings.push({ code: 'ignored_publish', message: 'Publishing as a site is not supported; the presentation is created privately.' });
  const rawInput = optionalString(body, 'inputText', GAMMA_MAX_INPUT);
  if (!rawInput) throw bad('inputText is required');
  const { text: inputText, urls: imageUrls } = extractImageUrls(rawInput);
  if (!inputText) throw bad('inputText needs text besides image URLs');
  const textMode = oneOf(body.textMode, 'textMode', ['generate', 'condense', 'preserve'] as const) || 'generate';
  readFormat(body.format);
  const exportAs = readExport(body.exportAs);
  const title = optionalString(body, 'title', 500)?.slice(0, 160);
  const template = readTemplate(body.themeId, 'themeId');
  const cardSplit = oneOf(body.cardSplit, 'cardSplit', ['auto', 'inputTextBreaks'] as const) || 'auto';
  const additionalInstructions = optionalString(body, 'additionalInstructions', 5000);

  const textOptions = body.textOptions === undefined ? {} : body.textOptions;
  if (!isObject(textOptions)) throw bad('textOptions must be an object');
  const amount = oneOf(textOptions.amount, 'textOptions.amount', ['brief', 'medium', 'detailed', 'extensive'] as const) || 'medium';
  if (amount === 'extensive') warnings.push({ code: 'amount_adjusted', message: 'textOptions.amount "extensive" is built as "detailed", the densest text this engine writes.' });
  const tone = optionalString(textOptions, 'tone', 500);
  const audience = optionalString(textOptions, 'audience', 500);
  const languageCode = optionalString(textOptions, 'language', 16)?.toLowerCase();
  let language: PptLanguageChoice | undefined;
  if (languageCode) {
    language = LANGUAGES[languageCode];
    if (!language) throw bad(`textOptions.language "${languageCode}" is not supported; use one of: ${Object.keys(LANGUAGES).join(', ')}`, 'unsupported_language');
  }

  const imageOptions = body.imageOptions === undefined ? {} : body.imageOptions;
  if (!isObject(imageOptions)) throw bad('imageOptions must be an object');
  if (imageOptions.source !== undefined) {
    if (typeof imageOptions.source !== 'string' || !IMAGE_SOURCES.has(imageOptions.source)) throw bad(`imageOptions.source must be one of: ${[...IMAGE_SOURCES].join(', ')}`);
    if (!IMAGE_SOURCES_HONOURED.has(imageOptions.source)) warnings.push({ code: 'image_source_unsupported', message: `imageOptions.source "${imageOptions.source}" is not available; cards use the input's own images and the theme's images.` });
  }
  if (imageOptions.model !== undefined || imageOptions.style !== undefined)
    warnings.push({ code: 'ignored_image_options', message: 'imageOptions.model and imageOptions.style are not applied; no images are generated.' });

  const cardOptions = body.cardOptions === undefined ? {} : body.cardOptions;
  if (!isObject(cardOptions)) throw bad('cardOptions must be an object');
  if (cardOptions.dimensions !== undefined && cardOptions.dimensions !== '16x9')
    warnings.push({ code: 'dimensions_unsupported', message: `cardOptions.dimensions "${String(cardOptions.dimensions)}" is not available; cards are built at 16x9.` });
  if (cardOptions.headerFooter !== undefined) warnings.push({ code: 'ignored_header_footer', message: 'cardOptions.headerFooter is not applied; the theme decides headers and footers.' });
  readSharingAndFolder(body, warnings);

  const contentMode = AMOUNT[amount];
  // Tone and audience steer generated writing only, as in Gamma.
  const requirements = requirementLines([
    ['Tone', textMode === 'generate' ? tone : undefined],
    ['Audience', textMode === 'generate' ? audience : undefined],
    ['', additionalInstructions],
  ]);
  if (textMode !== 'generate' && (tone || audience)) warnings.push({ code: 'ignored_text_options', message: 'textOptions.tone and textOptions.audience apply only when textMode is "generate".' });

  let numCards = readNumCards(body.numCards, warnings);
  let outline: { title: string; keyPoints: string[] }[] | undefined;
  if (cardSplit === 'inputTextBreaks') {
    const cards = splitAuthorCards(inputText);
    // The engine's first author card is the cover and carries no points:
    // keep a first segment that has body text by adding a cover in front.
    if (cards.length && cards[0].keyPoints.length) cards.unshift({ title: title || cards[0].title, keyPoints: [] });
    if (cards.length >= PPT_AUTHOR_OUTLINE.min && cards.length <= PPT_AUTHOR_OUTLINE.max) {
      outline = cards;
      numCards = undefined;
    } else {
      warnings.push({ code: 'card_split_fallback', message: `inputTextBreaks produced ${cards.length} cards; this engine needs ${PPT_AUTHOR_OUTLINE.min}-${PPT_AUTHOR_OUTLINE.max}, so cards were split automatically.` });
    }
  }
  // Gamma Classic builds 10 cards when numCards is omitted under auto split.
  if (!outline && numCards === undefined) numCards = 10;

  const asPaste = textMode !== 'generate' || inputText.length > PPT_MAX_PROMPT - requirements.length - 2;
  const create: PptCreateRequest = {
    inputKind: asPaste ? 'paste' : 'prompt',
    prompt: asPaste ? requirements : [inputText, requirements].filter(Boolean).join('\n\n'),
    ...(asPaste ? { text: inputText } : {}),
    ...(title ? { title } : {}),
    ...(template ? { template } : {}),
    ...(outline ? { outline, pages: outline.length } : {}),
    readOnlyInput: !outline,
    generationPolicy: policy(contentMode, textMode, language),
  };
  return { create, settings: { flavor: 'classic', exactCards: numCards, contentMode, language, exportAs, authorOutline: Boolean(outline) }, warnings, imageUrls };
}

/** POST /v1.0/agent/generations (Gamma 5). The engine reads the prompt itself: brief or source. */
export function parseAgentGeneration(raw: unknown): ParsedGammaGeneration {
  if (!isObject(raw)) throw bad('Request body must be a JSON object');
  const body = raw;
  rejectUnknown(body, AGENT_FIELDS);
  const rawPrompt = optionalString(body, 'prompt', GAMMA_MAX_INPUT);
  if (!rawPrompt) throw bad('prompt is required');
  const { text: prompt, urls: imageUrls } = extractImageUrls(rawPrompt);
  if (!prompt) throw bad('prompt needs text besides image URLs');
  readFormat(body.format);
  if (body.themeId !== undefined && body.templateId !== undefined) throw bad('themeId cannot be combined with templateId');
  const template = readTemplate(body.themeId, 'themeId') || readTemplate(body.templateId, 'templateId');
  if (Array.isArray(body.sourceUrls) && body.sourceUrls.length) throw bad('sourceUrls are not supported; include the source text in prompt', 'unsupported_source_urls');
  if (Array.isArray(body.files) && body.files.length) throw bad('files are not supported; include the source text in prompt', 'unsupported_files');
  const warnings: GammaWarning[] = [];
  const numCards = readNumCards(body.numCards, warnings);
  oneOf(body.quality, 'quality', ['lite', 'standard', 'max'] as const);
  if (body.quality !== undefined && body.quality !== 'standard') warnings.push({ code: 'ignored_quality', message: `quality "${String(body.quality)}" is not applied; the configured PPT model runs every job.` });
  const exportAs = readExport(body.exportAs);
  const additionalInstructions = optionalString(body, 'additionalInstructions', 5000);
  readSharingAndFolder(body, warnings);
  const asPaste = prompt.length + (additionalInstructions?.length || 0) + 2 > PPT_MAX_PROMPT;
  const create: PptCreateRequest = {
    inputKind: asPaste ? 'paste' : 'prompt',
    prompt: asPaste ? additionalInstructions || '' : [prompt, additionalInstructions].filter(Boolean).join('\n\n'),
    ...(asPaste ? { text: prompt } : {}),
    ...(template ? { template } : {}),
    readOnlyInput: true,
    // The agent decides: knowledge and language follow the engine defaults for the input.
    generationPolicy: { ...policy('standard', 'generate'), knowledge: asPaste ? 'source_only' : 'source_plus_explanation' },
  };
  return { create, settings: { flavor: 'agent', exactCards: numCards, contentMode: 'standard', exportAs, authorOutline: false }, warnings, imageUrls };
}

/** The subset of the engine's project view this layer reads. */
export interface PptProjectSnapshot {
  id: string;
  title?: string;
  status: string;
  stage?: string;
  error?: string;
  pages?: number;
  updatedAt?: string;
  publishedRevision?: number;
  planningContract?: { semanticRevision?: string };
  progress?: { contentReady?: number; previewReady?: number; total?: number };
  generationStages?: { deck?: string; pages?: Record<string, string> };
  outlineForming?: { done?: number; total?: number };
  deck?: { slides?: { id?: string; title?: string }[] } | null;
  outline?: { id?: string; title?: string }[];
}

export type GammaJobPhase = 'created' | 'planning' | 'generating' | 'blocked';

export type PptNextStep =
  | { type: 'plan'; body: Record<string, unknown> }
  | { type: 'generate' }
  | { type: 'none' };

/** One step per poll; idempotent because the phase advances only after the step is accepted. */
export function nextEngineStep(phase: GammaJobPhase, settings: GammaJobSettings, project: PptProjectSnapshot): PptNextStep {
  if (phase === 'created' && project.status === 'input_ready' && !settings.authorOutline) {
    return { type: 'plan', body: {
      command: 'outline',
      ...(project.planningContract?.semanticRevision !== undefined ? { semanticRevision: project.planningContract.semanticRevision } : {}),
      contentMode: settings.contentMode,
      length: settings.exactCards ? { exact: settings.exactCards } : { preset: 'standard' },
      ...(settings.language ? { language: settings.language } : {}),
    } };
  }
  if ((phase === 'created' || phase === 'planning') && project.status === 'outline_ready') return { type: 'generate' };
  return { type: 'none' };
}

const STAGE_BUCKET: Record<string, keyof GammaProgressStages> = {
  waiting: 'queued', retrieving: 'writing', writing: 'writing', binding: 'writing',
  rendering: 'imaging', layout: 'imaging', previewing: 'imaging',
  reviewing: 'checking', validating: 'checking', repairing: 'polishing', ready: 'done', failed: 'failed',
};
export interface GammaProgressStages { queued: number; writing: number; imaging: number; checking: number; polishing: number; done: number; failed: number }
export interface GammaProgress { stages: GammaProgressStages; done: number; total: number; percent: number }

/** Gamma's `progress`: per-card stage counts once cards are being built; percent 0-99. */
export function gammaProgress(project: PptProjectSnapshot): GammaProgress | undefined {
  if (project.status !== 'generating' && project.status !== 'paused') return undefined;
  const stages: GammaProgressStages = { queued: 0, writing: 0, imaging: 0, checking: 0, polishing: 0, done: 0, failed: 0 };
  const pageStages = Object.values(project.generationStages?.pages || {});
  for (const stage of pageStages) stages[STAGE_BUCKET[stage] || 'writing']++;
  const total = Math.max(project.progress?.total || 0, pageStages.length, project.pages || 0);
  const done = Math.min(total, pageStages.length ? stages.done : project.progress?.previewReady || 0);
  if (!pageStages.length) {
    stages.queued = Math.max(0, total - done);
    stages.done = done;
  } else stages.queued += Math.max(0, total - pageStages.length);
  const percent = total ? Math.min(99, Math.floor((done / total) * 100)) : 0;
  return { stages, done, total, percent };
}

export interface GammaStatusContext {
  generationId: string;
  flavor: GammaFlavor;
  phase: GammaJobPhase;
  phaseError?: string;
  /** Absolute URL that opens the project in the app. */
  gammaUrl: string;
  /** Signed download URL, present once there is a published file to export. */
  exportUrl?: string;
  warnings: GammaWarning[];
}

type GammaStatus = 'pending' | 'completed' | 'failed';

function outcome(project: PptProjectSnapshot, phase: GammaJobPhase, phaseError?: string): { status: GammaStatus; message?: string } {
  if (phase === 'blocked') return { status: 'failed', message: phaseError || 'The outline needs review before slides can be built.' };
  if (['completed', 'quality_blocked'].includes(project.status)) {
    return project.publishedRevision ? { status: 'completed' } : { status: 'failed', message: 'Quality checks blocked publishing. Open the presentation to review the findings.' };
  }
  if (project.status === 'failed') return { status: 'failed', message: project.error || 'Generation failed.' };
  if (project.status === 'cancelled') return { status: 'failed', message: 'Generation was cancelled.' };
  return { status: 'pending' };
}

function summary(project: PptProjectSnapshot) {
  const slides = project.deck?.slides || [];
  const titles = slides.map(slide => slide.title).filter(Boolean).slice(0, 8);
  return `${project.title || 'Presentation'}: ${slides.length} card${slides.length === 1 ? '' : 's'}${titles.length ? ` (${titles.join('; ')}${slides.length > titles.length ? '; ...' : ''})` : ''}.`;
}

/** Project a PPT project into Gamma's GET /generations/{id} (Classic) or /agent/generations/{id} response. */
export function toGammaStatus(project: PptProjectSnapshot, context: GammaStatusContext): Record<string, unknown> {
  const { status, message } = outcome(project, context.phase, context.phaseError);
  const updatedTime = project.updatedAt || new Date().toISOString();
  const gamma = { gammaId: project.id, gammaUrl: context.gammaUrl };
  const qualityWarning: GammaWarning[] = status === 'completed' && project.status === 'quality_blocked'
    ? [{ code: 'quality_review', message: 'Published with open quality findings; review them in the app.' }] : [];
  if (context.flavor === 'classic') {
    return {
      generationId: context.generationId, status,
      ...(status === 'completed' ? { gammaId: project.id, gammaUrl: context.gammaUrl, ...(context.exportUrl ? { exportUrl: context.exportUrl } : {}) } : {}),
      ...(status === 'failed' ? { gammaId: project.id, gammaUrl: context.gammaUrl, error: { message, statusCode: 422 } } : {}),
      ...(status !== 'pending' && (context.warnings.length || qualityWarning.length) ? { warnings: [...context.warnings, ...qualityWarning].map(w => w.message).join(' ') } : {}),
    };
  }
  if (status === 'pending') {
    const progress = gammaProgress(project);
    return { generationId: context.generationId, status, gamma, ...(progress ? { progress } : {}), warnings: [], updatedTime };
  }
  if (status === 'failed') {
    return { generationId: context.generationId, status, gamma, error: { reason: 'generation_failed', message, statusCode: 422 }, warnings: [], updatedTime, credits: {} };
  }
  return {
    generationId: context.generationId, status, gamma, result: { summary: summary(project) },
    ...(context.exportUrl ? { exportUrl: context.exportUrl } : {}),
    warnings: [...context.warnings, ...qualityWarning], updatedTime, credits: {},
  };
}

/** GET /v1.0/themes from the engine's template list. */
export function toGammaThemes(templates: unknown): { data: { id: string; name: string; type: 'standard' | 'custom'; colorKeywords: string[]; toneKeywords: string[] }[]; hasMore: false; nextCursor: null } {
  const rows = Array.isArray(templates) ? templates : [];
  const data = rows.filter(isObject).filter(row => typeof row.id === 'string' && TEMPLATE_ID.test(row.id)).map(row => ({
    id: String(row.id), name: String(row.name || row.id),
    type: (row.kind === 'uploaded' ? 'custom' : 'standard') as 'standard' | 'custom',
    colorKeywords: [],
    toneKeywords: [row.category, ...(Array.isArray(row.tags) ? row.tags : [])].filter((tag): tag is string => typeof tag === 'string' && tag.length > 0).slice(0, 8),
  }));
  return { data, hasMore: false, nextCursor: null };
}

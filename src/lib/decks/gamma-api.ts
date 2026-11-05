/**
 * Gamma-compatible public API (v1.0) over Decks.
 *
 * Decks replicates Gamma's document model (file → card → block) and its job
 * workflow (outline → per-card stages queued/writing/imaging/checking/
 * polishing/done), so this layer maps Gamma's contract almost one to one
 * (docs/research/gamma-reverse/08-api-reference.md, reports 02, 06, 07).
 *
 * The file has two halves:
 * - pure mapping: request validation and Gamma → Decks settings
 *   (`parseClassicGeneration`, `parseAgentGeneration`), status projection
 *   (`toGenerationStatus`), metadata and themes shapes. Unit-tested.
 * - `handleDecksGammaRequest`: auth, routing and I/O against the Decks engine
 *   and store, with the few environment-dependent parts injected (API key,
 *   clock, concurrency counter, image fetcher).
 *
 * Ids (see docs/handover/decks-gamma-api.md):
 * - generationId = `gen_` + the deck id's suffix (`deck_abc` ↔ `gen_abc`), so a
 *   poll needs no mapping table and survives restarts. Only decks created
 *   through this API (they carry `gammaApi` metadata) answer as generations.
 * - gammaId = the deck id. editId = the Decks edit job id (`job_*`).
 *   exportId = `exp_<deck suffix>_<random>`.
 * - Every lookup goes through the account-scoped Decks store, so another
 *   account's ids read as 404.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getCurrentUserUid, getDb } from '../db';
import { signExport } from '../ppt-gamma-service';
import { blockText, cardTitle } from './blocks';
import * as engine from './engine';
import { EngineError } from './engine';
import { buildDeckPptx } from './export-pptx';
import { fetchPublicImage, storeImage, type FetchResult } from './media';
import { extractImageUrls, splitByBreaks } from './settings';
import * as store from './store';
import { DECK_THEMES } from './themes';
import type {
  CardDimensions, CreateDeckRequest, Deck, DeckFormat, DeckJob, DeckLanguage, GenerationSettings, HeaderFooter, HeaderFooterSlot, ImageSource,
  TextAmount, TextMode,
} from './types';
import { FORMAT_DIMENSIONS, NUM_CARDS_RANGE } from './types';

// ── Shared types ──────────────────────────────────────────────────────────

export type GammaFlavor = 'classic' | 'agent';
export type GammaExportAs = 'pptx' | 'pdf' | 'png';
export interface GammaWarning { code: string; message: string }

/** Gamma's error body is `{ message, statusCode, code? }`; `extra` adds fields such as the running `editId`. */
export class GammaApiError extends Error {
  constructor(public statusCode: number, message: string, public code?: string, public extra: Record<string, unknown> = {}, public headers: Record<string, string> = {}) { super(message); }
}

/** What a generation remembers; persisted on the deck document as `gammaApi` (an API-only extension field). */
export interface GammaGenerationMeta { flavor: GammaFlavor; exportAs?: GammaExportAs; warnings: GammaWarning[] }
export type ApiDeck = Deck & { gammaApi?: GammaGenerationMeta };

type SlotKey = 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight';
export interface CustomLogo { slot: SlotKey; src: string }

export interface ParsedGeneration {
  flavor: GammaFlavor;
  /** Body for `engine.createDeck`; settings always run in Express mode (Gamma's API has no review stop). */
  request: CreateDeckRequest & { settings: Partial<GenerationSettings> & { inputText: string } };
  headerFooter?: HeaderFooter;
  /** headerFooter images with `source: custom`, fetched and hosted once the deck exists. */
  customLogos: CustomLogo[];
  /** Agent only: a Decks deck id whose look (theme, format, dimensions, image source, header/footer) is copied. */
  templateId?: string;
  /** Whether the request named a format (a template's format applies otherwise). */
  formatGiven: boolean;
  /** Whether the request named numCards (a template's card count applies otherwise). */
  numCardsGiven: boolean;
  exportAs?: GammaExportAs;
  warnings: GammaWarning[];
}

// ── Limits and vocabularies ───────────────────────────────────────────────

const GAMMA_MAX_INPUT = 400_000;
/** Gamma's plan maximum for numCards on paid plans; above it Gamma answers 400. */
const GAMMA_MAX_CARDS = 100;
export const MAX_ACTIVE_GENERATIONS = 3;
const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Gamma export links last about one week.

const CLASSIC_FIELDS = new Set(['inputText', 'textMode', 'format', 'themeId', 'numCards', 'cardSplit', 'additionalInstructions', 'title',
  'exportAs', 'textOptions', 'imageOptions', 'cardOptions', 'sharingOptions', 'folderId', 'folderIds', 'pages', 'publish']);
const AGENT_FIELDS = new Set(['prompt', 'format', 'numCards', 'quality', 'themeId', 'templateId', 'sourceUrls', 'files',
  'additionalInstructions', 'exportAs', 'sharingOptions', 'folderId', 'disableConnectors']);
const EDIT_FIELDS = new Set(['prompt', 'quality', 'disableConnectors']);

/** Gamma language codes → Decks output languages. Regional variants collapse (with a warning); others are 400. */
export const GAMMA_LANGUAGES: Record<string, Exclude<DeckLanguage, 'auto'>> = {
  en: 'en', 'en-gb': 'en', 'en-in': 'en', 'zh-cn': 'zh-cn', 'zh-tw': 'zh-tw', ja: 'ja', 'ja-da': 'ja', ko: 'ko',
  es: 'es', 'es-419': 'es', 'es-es': 'es', 'es-mx': 'es', fr: 'fr', de: 'de', 'pt-br': 'pt-br', it: 'it', ru: 'ru',
  ar: 'ar', 'ar-sa': 'ar', hi: 'hi', id: 'id', vi: 'vi', th: 'th', tr: 'tr', nl: 'nl', pl: 'pl',
};
const DIRECT_IMAGE_SOURCES: readonly ImageSource[] = ['aiGenerated', 'themeAccent', 'placeholder', 'noImages'];
/** Licensed stock/web search sources Decks does not replicate: they become theme artwork. */
const STOCK_IMAGE_SOURCES = ['pictographic', 'pexels', 'giphy', 'webAllImages', 'webFreeToUse', 'webFreeToUseCommercially'];
const ALL_DIMENSIONS: readonly CardDimensions[] = ['16x9', '4x3', 'fluid', 'a4', 'letter', 'pageless', '1x1', '4x5', '9x16'];
const SLOTS: readonly SlotKey[] = ['topLeft', 'topCenter', 'topRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
const LOGO_SIZES = ['sm', 'md', 'lg', 'xl'] as const;

// ── Validation helpers ────────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bad = (message: string, code = 'invalid_request') => new GammaApiError(400, message, code);

function optionalString(body: Record<string, unknown>, key: string, max: number, label = key): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw bad(`${label} must be a string`);
  if (value.length > max) throw bad(`${label} must be at most ${max.toLocaleString('en')} characters`);
  return value.trim() || undefined;
}

function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw bad(`${label} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function optionalObject(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = body[key];
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw bad(`${key} must be an object`);
  return value;
}

function rejectUnknown(body: Record<string, unknown>, allowed: Set<string>, where = '') {
  const unknown = Object.keys(body).filter(key => !allowed.has(key));
  if (unknown.length) throw bad(`Unknown field${unknown.length > 1 ? 's' : ''}${where}: ${unknown.join(', ')}`, 'unknown_field');
}

function readFormat(value: unknown): DeckFormat | undefined {
  const format = oneOf(value, 'format', ['presentation', 'document', 'social', 'webpage'] as const);
  if (format === 'webpage') throw bad('format "webpage" is not supported; Decks builds presentations, documents and social posts', 'unsupported_format');
  return format;
}

/** pptx is served as a signed link; pdf/png are produced in the app, so they become an `export_failed` warning (Gamma: export failure never fails a generation). */
function readExport(value: unknown, warnings: GammaWarning[]): GammaExportAs | undefined {
  const exportAs = oneOf(value, 'exportAs', ['pdf', 'png', 'pptx'] as const);
  if (exportAs === 'pdf' || exportAs === 'png')
    warnings.push({ code: 'export_failed', message: `exportAs "${exportAs}" is produced in the Decks app (${exportAs === 'pdf' ? 'Print to PDF' : 'PNG zip'}); this API exports pptx only, so no exportUrl will be returned.` });
  return exportAs;
}

/** numCards: an integer 1–100 (Gamma's plan cap); Decks builds 1–60, so 61–100 is clamped with a warning. */
function readNumCards(value: unknown, warnings: GammaWarning[]): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw bad('numCards must be a positive integer');
  if (value > GAMMA_MAX_CARDS) throw bad(`numCards must be at most ${GAMMA_MAX_CARDS}`);
  if (value > NUM_CARDS_RANGE.max) {
    warnings.push({ code: 'num_cards_adjusted', message: `numCards ${value} was changed to ${NUM_CARDS_RANGE.max}: Decks builds at most ${NUM_CARDS_RANGE.max} cards.` });
    return NUM_CARDS_RANGE.max;
  }
  return value;
}

function readTheme(value: unknown, label = 'themeId'): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !DECK_THEMES.some(theme => theme.id === value))
    throw bad(`${label} is not an available theme; list themes with GET /v1.0/themes`, 'unknown_theme');
  return value;
}

function readSharingAndFolder(body: Record<string, unknown>, warnings: GammaWarning[]) {
  if (body.folderId !== undefined || (Array.isArray(body.folderIds) && body.folderIds.length))
    warnings.push({ code: 'ignored_folder_id', message: 'Folder placement is not applied; the deck appears in the Decks list.' });
  if (isObject(body.sharingOptions)) {
    if (body.sharingOptions.workspaceAccess !== undefined) warnings.push({ code: 'ignored_workspace_access', message: 'Workspace sharing is not applied; decks stay private to this account.' });
    if (body.sharingOptions.externalAccess !== undefined) warnings.push({ code: 'ignored_external_access', message: 'External sharing is not applied; decks stay private to this account.' });
    if (body.sharingOptions.emailOptions !== undefined) warnings.push({ code: 'ignored_email_options', message: 'Email invitations are not sent.' });
  } else if (body.sharingOptions !== undefined && body.sharingOptions !== null) throw bad('sharingOptions must be an object');
}

/** Gamma: a dimension invalid for the format falls back to the format default, with a warning. */
function readDimensions(value: unknown, format: DeckFormat, warnings: GammaWarning[]): CardDimensions | undefined {
  const dimensions = oneOf(value, 'cardOptions.dimensions', ALL_DIMENSIONS);
  if (!dimensions) return undefined;
  const allowed = FORMAT_DIMENSIONS[format];
  if (allowed.includes(dimensions)) return dimensions;
  warnings.push({ code: 'dimensions_adjusted', message: `cardOptions.dimensions ${dimensions} is not valid for format ${format} (valid: ${allowed.join(', ')}). Using default: ${allowed[0]}.` });
  return allowed[0];
}

/** cardOptions.headerFooter: six slots; text → text slot, cardNumber → card number, image → logo slot. */
export function readHeaderFooter(value: unknown, warnings: GammaWarning[]): { headerFooter?: HeaderFooter; customLogos: CustomLogo[] } {
  if (value === undefined || value === null) return { customLogos: [] };
  if (!isObject(value)) throw bad('cardOptions.headerFooter must be an object');
  rejectUnknown(value, new Set([...SLOTS, 'hideFromFirstCard', 'hideFromLastCard']), ' in cardOptions.headerFooter');
  const headerFooter: HeaderFooter = {};
  const customLogos: CustomLogo[] = [];
  let themeLogo = false;
  for (const slot of SLOTS) {
    const element = value[slot];
    if (element === undefined || element === null) continue;
    const label = `cardOptions.headerFooter.${slot}`;
    if (!isObject(element)) throw bad(`${label} must be an object`);
    const type = oneOf(element.type, `${label}.type`, ['text', 'image', 'cardNumber'] as const);
    if (!type) throw bad(`${label}.type is required`);
    if (type === 'text') {
      const text = optionalString(element, 'value', 500, `${label}.value`);
      if (!text) throw bad(`${label}.value is required when type is "text"`);
      headerFooter[slot] = { type: 'text', value: text };
    } else if (type === 'cardNumber') {
      headerFooter[slot] = { type: 'cardNumber' };
    } else {
      const source = oneOf(element.source, `${label}.source`, ['themeLogo', 'custom'] as const);
      if (!source) throw bad(`${label}.source is required when type is "image"`);
      const size = oneOf(element.size, `${label}.size`, LOGO_SIZES);
      const logo: HeaderFooterSlot = { type: 'logo', ...(size ? { size } : {}) };
      if (source === 'custom') {
        const src = optionalString(element, 'src', 2048, `${label}.src`);
        let url: URL | undefined;
        try { url = src ? new URL(src) : undefined; } catch { /* reported below */ }
        if (!url || url.protocol !== 'https:') throw bad(`${label}.src must be an https image URL when source is "custom"`);
        customLogos.push({ slot, src: url.href });
      } else themeLogo = true;
      headerFooter[slot] = logo;
    }
  }
  for (const key of ['hideFromFirstCard', 'hideFromLastCard'] as const) {
    if (value[key] === undefined || value[key] === null) continue;
    if (typeof value[key] !== 'boolean') throw bad(`cardOptions.headerFooter.${key} must be a boolean`);
    headerFooter[key] = value[key] as boolean;
  }
  if (themeLogo) warnings.push({ code: 'theme_logo_as_text', message: 'Decks themes have no logo image; a themeLogo slot shows the deck title as a wordmark.' });
  return { headerFooter, customLogos };
}

/** One prepared outline card per `\n---\n` segment: the first heading (or first line) is the title, the other lines are points. */
export function outlineFromBreaks(inputText: string): { title: string; points: string[] }[] {
  return splitByBreaks(inputText).map((segment, index) => {
    const lines = segment.split('\n').map(line => line.trim()).filter(Boolean);
    const headingIndex = lines.findIndex(line => /^#{1,6}\s+/.test(line));
    const titleIndex = headingIndex >= 0 ? headingIndex : 0;
    const title = (lines[titleIndex] || '').replace(/^#{1,6}\s+/, '').trim().slice(0, 200) || `Card ${index + 1}`;
    const points = lines.filter((_, i) => i !== titleIndex).map(line => line.replace(/^(?:[-*+•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    return { title, points };
  });
}

function readImageOptions(body: Record<string, unknown>, warnings: GammaWarning[]): { imageSource: ImageSource; imageStyle?: string } {
  const imageOptions = optionalObject(body, 'imageOptions');
  const raw = oneOf(imageOptions.source, 'imageOptions.source', [...DIRECT_IMAGE_SOURCES, ...STOCK_IMAGE_SOURCES] as readonly string[]);
  // Gamma's default source is aiGenerated; without an image provider Decks falls back to theme art with `ai_images_unavailable`.
  let imageSource: ImageSource = 'aiGenerated';
  if (raw && STOCK_IMAGE_SOURCES.includes(raw)) {
    imageSource = 'themeAccent';
    warnings.push({ code: 'image_source_unsupported', message: `imageOptions.source "${raw}" (stock/web images) is not available; theme artwork (themeAccent) is used instead.` });
  } else if (raw) imageSource = raw as ImageSource;
  const imageStyle = optionalString(imageOptions, 'style', 5000, 'imageOptions.style');
  if (imageOptions.model !== undefined) warnings.push({ code: 'ignored_image_model', message: 'imageOptions.model is not applied; Decks uses the image model configured in Settings.' });
  if (imageStyle && imageSource !== 'aiGenerated') warnings.push({ code: 'ignored_image_options', message: 'imageOptions.style applies only when imageOptions.source is "aiGenerated".' });
  return { imageSource, ...(imageStyle && imageSource === 'aiGenerated' ? { imageStyle } : {}) };
}

// ── Request mapping ───────────────────────────────────────────────────────

/** POST /v1.0/generations (Classic). */
export function parseClassicGeneration(raw: unknown): ParsedGeneration {
  if (!isObject(raw)) throw bad('Request body must be a JSON object');
  const body = raw;
  rejectUnknown(body, CLASSIC_FIELDS);
  if (body.pages !== undefined) throw bad('Multi-page generation (pages) is not supported; send one inputText', 'unsupported_pages');
  const warnings: GammaWarning[] = [];
  if (body.publish === true) warnings.push({ code: 'ignored_publish', message: 'Publishing as a site is not supported; the deck is created privately.' });
  const inputText = optionalString(body, 'inputText', GAMMA_MAX_INPUT);
  if (!inputText) throw bad('inputText is required');
  const textMode = oneOf<TextMode>(body.textMode, 'textMode', ['generate', 'condense', 'preserve']);
  const format = readFormat(body.format) || 'presentation';
  const exportAs = readExport(body.exportAs, warnings);
  const title = optionalString(body, 'title', 500);
  const themeId = readTheme(body.themeId);
  const cardSplit = oneOf(body.cardSplit, 'cardSplit', ['auto', 'inputTextBreaks'] as const) || 'auto';
  const additionalInstructions = optionalString(body, 'additionalInstructions', 5000);

  const textOptions = optionalObject(body, 'textOptions');
  const amount = oneOf<TextAmount>(textOptions.amount, 'textOptions.amount', ['brief', 'medium', 'detailed', 'extensive']);
  const tone = optionalString(textOptions, 'tone', 500, 'textOptions.tone');
  const audience = optionalString(textOptions, 'audience', 500, 'textOptions.audience');
  if (textMode === 'preserve' && amount) warnings.push({ code: 'ignored_text_options', message: 'textOptions.amount applies only when textMode is "generate" or "condense".' });
  const languageCode = optionalString(textOptions, 'language', 16, 'textOptions.language')?.toLowerCase();
  let language: DeckLanguage | undefined;
  if (languageCode) {
    language = GAMMA_LANGUAGES[languageCode];
    if (!language) throw bad(`textOptions.language "${languageCode}" is not supported; use one of: ${Object.keys(GAMMA_LANGUAGES).join(', ')}`, 'unsupported_language');
    if (language !== languageCode) warnings.push({ code: 'language_adjusted', message: `textOptions.language "${languageCode}" is written as "${language}".` });
  }

  const image = readImageOptions(body, warnings);
  const cardOptions = optionalObject(body, 'cardOptions');
  const dimensions = readDimensions(cardOptions.dimensions, format, warnings);
  const { headerFooter, customLogos } = readHeaderFooter(cardOptions.headerFooter, warnings);
  readSharingAndFolder(body, warnings);

  const numCardsRaw = readNumCards(body.numCards, warnings);
  let outline: { title: string; points: string[] }[] | undefined;
  if (cardSplit === 'inputTextBreaks') {
    // numCards is ignored (Gamma); image URLs leave the text first so they are hosted, not written on cards.
    outline = outlineFromBreaks(extractImageUrls(inputText).text);
    if (!outline.length) throw bad('inputText has no card content between the --- breaks');
    if (outline.length > NUM_CARDS_RANGE.max) throw bad(`inputTextBreaks produced ${outline.length} cards; Decks builds at most ${NUM_CARDS_RANGE.max}`);
  }
  const settings: ParsedGeneration['request']['settings'] = {
    inputText,
    ...(textMode ? { textMode } : {}),
    ...(amount ? { amount } : {}),
    ...(tone ? { tone } : {}),
    ...(audience ? { audience } : {}),
    ...(language ? { language } : {}),
    // Gamma Classic builds 10 cards when numCards is omitted.
    numCards: outline ? outline.length : numCardsRaw ?? 10,
    cardSplit,
    ...(additionalInstructions ? { additionalInstructions } : {}),
    ...image,
    ...(themeId ? { themeId } : {}),
    format,
    ...(dimensions ? { dimensions } : {}),
    mode: 'express',
  };
  return {
    flavor: 'classic',
    request: { settings, ...(title ? { title } : {}), ...(outline ? { outline } : {}), source: { kind: 'api' } },
    ...(headerFooter ? { headerFooter } : {}),
    customLogos, formatGiven: true, numCardsGiven: true, exportAs, warnings,
  };
}

/** POST /v1.0/agent/generations (Gamma 5): prompt-only; the engine decides text handling. */
export function parseAgentGeneration(raw: unknown): ParsedGeneration {
  if (!isObject(raw)) throw bad('Request body must be a JSON object');
  const body = raw;
  rejectUnknown(body, AGENT_FIELDS);
  const prompt = optionalString(body, 'prompt', GAMMA_MAX_INPUT);
  if (!prompt) throw bad('prompt is required');
  const format = readFormat(body.format);
  if (body.themeId !== undefined && body.templateId !== undefined) throw bad('themeId cannot be combined with templateId');
  const themeId = readTheme(body.themeId);
  const templateId = optionalString(body, 'templateId', 128);
  if (body.templateId !== undefined && !templateId) throw bad('templateId must not be empty');
  if (Array.isArray(body.sourceUrls) && body.sourceUrls.length) throw bad('sourceUrls are not supported; include the source text in prompt', 'unsupported_source_urls');
  if (Array.isArray(body.files) && body.files.length) throw bad('files are not supported; include the source text in prompt, or import the file in the Decks app', 'unsupported_files');
  const warnings: GammaWarning[] = [];
  const numCards = readNumCards(body.numCards, warnings);
  const quality = oneOf(body.quality, 'quality', ['lite', 'standard', 'max'] as const);
  if (quality && quality !== 'standard') warnings.push({ code: 'ignored_quality', message: `quality "${quality}" is not applied; the model configured in Settings runs every job.` });
  if (body.disableConnectors !== undefined && typeof body.disableConnectors !== 'boolean') throw bad('disableConnectors must be a boolean');
  const additionalInstructions = optionalString(body, 'additionalInstructions', 5000);
  const exportAs = readExport(body.exportAs, warnings);
  readSharingAndFolder(body, warnings);
  const settings: ParsedGeneration['request']['settings'] = {
    inputText: prompt,
    ...(numCards ? { numCards } : {}),
    ...(additionalInstructions ? { additionalInstructions } : {}),
    imageSource: 'aiGenerated',
    ...(themeId ? { themeId } : {}),
    format: format || 'presentation',
    mode: 'express',
  };
  return {
    flavor: 'agent', request: { settings, source: { kind: 'api' } }, customLogos: [],
    ...(templateId ? { templateId } : {}), formatGiven: Boolean(format), numCardsGiven: numCards !== undefined, exportAs, warnings,
  };
}

/** templateId: copy an existing deck's look and structure (theme, format, dimensions, image source, amount, language, card count, header/footer). */
export function applyTemplate(parsed: ParsedGeneration, template: Deck): ParsedGeneration {
  const s = { ...parsed.request.settings };
  const t = template.settings;
  s.themeId = t.themeId;
  s.imageSource = t.imageSource;
  if (t.imageStyle) s.imageStyle = t.imageStyle;
  s.amount = t.amount;
  if (t.language !== 'auto') s.language = t.language;
  if (!parsed.formatGiven) s.format = t.format;
  if (FORMAT_DIMENSIONS[s.format || 'presentation'].includes(t.dimensions)) s.dimensions = t.dimensions;
  if (!parsed.numCardsGiven && template.cards.length) s.numCards = Math.min(NUM_CARDS_RANGE.max, template.cards.length);
  const headerFooter = structuredClone(template.headerFooter || {});
  // Logo media belongs to the template deck; the copy shows the logo as a wordmark.
  for (const slot of SLOTS) if (headerFooter[slot]?.mediaId) delete headerFooter[slot]!.mediaId;
  return { ...parsed, request: { ...parsed.request, settings: s }, headerFooter };
}

// ── Ids ───────────────────────────────────────────────────────────────────

const DECK_ID = /^deck_([a-z0-9]+)$/;
const GEN_ID = /^gen_([a-z0-9]+)$/;
const EXPORT_ID = /^exp_([a-z0-9]+)_[a-f0-9]+$/;
const EDIT_ID = /^job_[a-z0-9]+$/;

export const generationIdOf = (deckId: string) => `gen_${deckId.replace(/^deck_/, '')}`;
/** A gamma reference: a deck id, or a generation id (Gamma's MCP also accepts one). */
export function deckIdOf(ref: string): string | null {
  if (DECK_ID.test(ref)) return ref;
  const gen = ref.match(GEN_ID);
  return gen ? `deck_${gen[1]}` : null;
}

// ── Status projection (pure) ──────────────────────────────────────────────

export interface GammaProgress { stages: DeckJob['progress']['stages']; done: number; total: number; percent: number }
export interface GenerationView {
  status: 'pending' | 'completed' | 'failed';
  progress?: GammaProgress;
  /** The document exists with cards (Gamma: `gamma` appears once the document has been created). */
  hasDocument: boolean;
  summary?: string;
  error?: string;
  updatedTime: string;
}

export function summarize(deck: Deck): string {
  const titles = deck.cards.map(card => cardTitle(card)).filter(Boolean);
  const shown = titles.slice(0, 8);
  const kind = deck.settings.format === 'presentation' ? 'presentation' : deck.settings.format === 'document' ? 'document' : 'social post';
  return `Created a ${deck.cards.length}-card ${kind} "${deck.title}"${shown.length ? `: ${shown.join('; ')}${titles.length > shown.length ? '; …' : ''}` : ''}.`;
}

/** Projects a deck and its newest job onto Gamma's generation lifecycle. */
export function generationView(deck: Deck, job: DeckJob | null): GenerationView {
  const updatedTime = [deck.updatedAt, job?.updatedAt].filter(Boolean).sort().pop() || deck.updatedAt;
  if (deck.status === 'ready') return { status: 'completed', hasDocument: true, summary: summarize(deck), updatedTime };
  if (deck.status === 'failed') return { status: 'failed', hasDocument: deck.cards.length > 0, error: deck.error || job?.error || 'Generation failed.', updatedTime };
  const active = job && (job.status === 'pending' || job.status === 'running');
  // No job running for a deck that is still outlining/generating: interrupted (app restart) or the build could not start.
  if (!active) return { status: 'failed', hasDocument: deck.cards.length > 0, error: job?.error || 'Generation stopped before the cards were built.', updatedTime };
  if (deck.status === 'generating' && job.kind === 'build') {
    const { stages, done, total, percent } = job.progress;
    return { status: 'pending', hasDocument: true, progress: { stages, done, total, percent: Math.max(0, Math.min(99, percent)) }, updatedTime };
  }
  return { status: 'pending', hasDocument: false, updatedTime };
}

function mergeWarnings(...lists: GammaWarning[][]): GammaWarning[] {
  const seen = new Set<string>();
  return lists.flat().filter(w => { const key = `${w.code}\n${w.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export interface StatusContext { origin: string; exportUrl?: string }
export const gammaUrlOf = (origin: string, deckId: string) => `${origin}/decks/${deckId}`;

/** GET /generations/{id} (Classic) and GET /agent/generations/{id} bodies. */
export function toGenerationStatus(deck: ApiDeck, job: DeckJob | null, ctx: StatusContext): Record<string, unknown> {
  const meta = deck.gammaApi || { flavor: 'classic' as const, warnings: [] };
  const view = generationView(deck, job);
  const generationId = generationIdOf(deck.id);
  const gamma = { gammaId: deck.id, gammaUrl: gammaUrlOf(ctx.origin, deck.id) };
  const warnings = view.status === 'completed' ? mergeWarnings(meta.warnings, deck.warnings || []) : [];
  const exportUrl = view.status === 'completed' ? ctx.exportUrl : undefined;
  if (meta.flavor === 'classic') {
    return {
      generationId, status: view.status,
      // `progress` is a Decks extension on Classic (Gamma's Classic status has none); Gamma 5 clients read the same shape.
      ...(view.progress ? { progress: view.progress } : {}),
      ...(view.status !== 'pending' ? { gammaId: gamma.gammaId, gammaUrl: gamma.gammaUrl } : {}),
      ...(exportUrl ? { exportUrl } : {}),
      ...(view.status === 'failed' ? { error: { message: view.error, statusCode: 500 } } : {}),
      ...(warnings.length ? { warnings: warnings.map(w => w.message).join(' ') } : {}),
    };
  }
  if (view.status === 'pending') {
    return { generationId, status: 'pending', ...(view.hasDocument ? { gamma } : {}), ...(view.progress ? { progress: view.progress } : {}), warnings: [], updatedTime: view.updatedTime };
  }
  if (view.status === 'failed') {
    return { generationId, status: 'failed', ...(view.hasDocument ? { gamma } : {}), error: { reason: 'generation_failed', message: view.error, statusCode: 500 }, warnings: [], updatedTime: view.updatedTime, credits: {} };
  }
  return { generationId, status: 'completed', gamma, result: { summary: view.summary }, ...(exportUrl ? { exportUrl } : {}), warnings, updatedTime: view.updatedTime, credits: {} };
}

/** GET /gammas/{id}: Gamma's GetGammaResponse. */
export function toGammaMetadata(deck: Deck, origin: string): Record<string, unknown> {
  const first = deck.cards.find(card => !card.hidden) || deck.cards[0];
  let description: string | null = null;
  if (first) {
    const titleHeading = first.blocks.find(block => block.type === 'heading');
    const body = first.blocks.filter(block => block !== titleHeading).map(blockText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const text = body || cardTitle(first);
    description = text ? (text.length > 300 ? `${text.slice(0, 299)}…` : text) : null;
  }
  return {
    id: deck.id, title: deck.title, type: 'regular', url: gammaUrlOf(origin, deck.id), thumbnailUrl: null, description, author: null,
    createdTime: deck.createdAt, updatedTime: deck.updatedAt, themeId: deck.settings.themeId || null, archived: false,
  };
}

/** GET /themes: Gamma's ListThemesResponse over the built-in Decks themes (all `standard`). */
export function toGammaThemes(params: URLSearchParams): { data: { id: string; name: string; type: 'standard'; colorKeywords: string[]; toneKeywords: string[] }[]; hasMore: boolean; nextCursor: string | null } {
  const query = (params.get('query') || '').trim().toLowerCase();
  const type = params.get('type');
  if (type && type !== 'standard' && type !== 'custom') throw bad('type must be one of: custom, standard');
  const limitRaw = params.get('limit');
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw bad('limit must be an integer from 1 to 50');
  let rows = type === 'custom' ? [] : DECK_THEMES.filter(theme => !query || theme.name.toLowerCase().includes(query) || theme.id.includes(query));
  const after = params.get('after');
  if (after) {
    const index = rows.findIndex(theme => theme.id === after);
    if (index < 0) throw bad('after is not a valid cursor');
    rows = rows.slice(index + 1);
  }
  const page = rows.slice(0, limit);
  const hasMore = rows.length > page.length;
  return {
    data: page.map(theme => ({ id: theme.id, name: theme.name, type: 'standard', colorKeywords: [...theme.colorKeywords], toneKeywords: [...theme.toneKeywords] })),
    hasMore, nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// ── Service (I/O) ─────────────────────────────────────────────────────────

export interface DecksGammaDeps {
  /** Configured API key; undefined disables the API (403 api_disabled). */
  apiKey: string | undefined;
  now?: () => number;
  /** Generation jobs (outline/build) running for this account; defaults to the Decks job table ∩ this process's job registry. */
  activeGenerations?: () => number;
  /** Fetches a custom header/footer logo; defaults to the guarded public-HTTPS fetcher. */
  fetchImage?: (url: string) => Promise<FetchResult>;
}

interface EditRecord { deckId: string; proposalId?: string; outcome?: { status: 'completed' | 'failed'; summary?: string; error?: string; at: string } }
interface ApiState { edits: Map<string, EditRecord> }
/** API-created edits (editId = Decks job id). In memory, shared by route modules; lookups also derive from the job + proposal tables. */
const state: ApiState = ((globalThis as unknown as { __decksGammaApi?: ApiState }).__decksGammaApi ??= { edits: new Map() });

/** The engine's in-process job registry (src/lib/decks/engine.ts): only jobs in it are really running in this process. */
const runningJobs = () => (globalThis as unknown as { __decksRegistry?: { running: Map<string, Promise<void>> } }).__decksRegistry?.running;

function defaultActiveGenerations(): number {
  const rows = getDb().prepare(`SELECT j.id FROM deck_jobs j JOIN decks d ON d.id = j.deck_id
    WHERE d.uid = ? AND d.deleted_at IS NULL AND j.kind IN ('outline', 'build') AND j.status IN ('pending', 'running')`).all(getCurrentUserUid() || '') as { id: string }[];
  const running = runningJobs();
  // Rows left 'running' by a previous process are not counted (the engine marks them failed on its next boot).
  return running ? rows.filter(row => running.has(row.id)).length : rows.length;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function presentedKey(request: Request) {
  const header = request.headers.get('x-api-key');
  if (header) return header.trim();
  const auth = request.headers.get('authorization');
  return auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

async function readBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw bad('Request body must be valid JSON'); }
}

/** Domain-separated so a link signed here can never be replayed against the /ppt facade, and vice versa. */
const signFile = (apiKey: string, deckId: string, expires: number) => signExport(apiKey, `decks:${deckId}`, 'pptx', expires);
function signedFileUrl(origin: string, apiKey: string, deckId: string, now: number) {
  const expires = now + EXPORT_TTL_MS;
  return `${origin}/api/decks/gamma/v1.0/files/${deckId}.pptx?expires=${expires}&signature=${signFile(apiKey, deckId, expires)}`;
}

function requireDeck(ref: string): Deck {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ref)) throw bad('Invalid gamma ID');
  const id = deckIdOf(ref);
  const deck = id ? store.getDeck(id) : null;
  if (!deck) throw new GammaApiError(404, 'Gamma not found');
  return deck;
}

async function hostLogos(deckId: string, logos: CustomLogo[], headerFooter: HeaderFooter, fetchImage: (url: string) => Promise<FetchResult>): Promise<GammaWarning[]> {
  const skipped: string[] = [];
  await Promise.all(logos.map(async ({ slot, src }) => {
    try {
      const result = await fetchImage(src);
      if (!result.ok) { skipped.push(`${src} (${result.reason})`); return; }
      headerFooter[slot] = { ...headerFooter[slot]!, mediaId: storeImage(deckId, result.data, 'url', { sourceUrl: src }).id };
    } catch (error) { skipped.push(`${src} (${error instanceof Error ? error.message : String(error)})`); }
  }));
  return skipped.length ? [{ code: 'header_footer_image_skipped', message: `Header/footer image${skipped.length > 1 ? 's' : ''} not used; the deck title is shown instead: ${skipped.join('; ')}` }] : [];
}

async function createGeneration(flavor: GammaFlavor, request: Request, deps: DecksGammaDeps) {
  const raw = await readBody(request);
  let parsed = flavor === 'agent' ? parseAgentGeneration(raw) : parseClassicGeneration(raw);
  if (parsed.templateId) {
    const id = deckIdOf(parsed.templateId);
    const template = id ? store.getDeck(id) : null;
    // Gamma: unknown or inaccessible templates are 400, and no substitute is used.
    if (!template) throw bad('templateId is not an accessible deck (use a gammaId from this account)', 'unknown_template');
    parsed = applyTemplate(parsed, template);
  }
  const active = (deps.activeGenerations || defaultActiveGenerations)();
  if (active >= MAX_ACTIVE_GENERATIONS)
    throw new GammaApiError(429, `${active} generations are already running for this account (limit ${MAX_ACTIVE_GENERATIONS}); retry when one finishes.`, 'workspace_concurrency_limit_exceeded', {}, { 'retry-after': '10' });

  let created: Deck;
  try { created = (await engine.createDeck(parsed.request)).deck; }
  catch (error) { if (error instanceof EngineError) throw new GammaApiError(error.status, error.message, error.code || 'invalid_request'); throw error; }

  const headerFooter = parsed.headerFooter ? structuredClone(parsed.headerFooter) : undefined;
  const logoWarnings = headerFooter && parsed.customLogos.length ? await hostLogos(created.id, parsed.customLogos, headerFooter, deps.fetchImage || fetchPublicImage) : [];
  const warnings = mergeWarnings(parsed.warnings, created.warnings || [], logoWarnings);
  const meta: GammaGenerationMeta = { flavor, ...(parsed.exportAs ? { exportAs: parsed.exportAs } : {}), warnings };
  store.updateDeck(created.id, deck => {
    (deck as ApiDeck).gammaApi = meta;
    if (headerFooter) deck.headerFooter = headerFooter;
  });
  const generationId = generationIdOf(created.id);
  return flavor === 'agent'
    // Gamma: agent create answers 202 Accepted with structured warnings; Classic answers 200 with one warning string.
    ? json(202, { generationId, status: 'pending', warnings })
    : json(200, { generationId, ...(warnings.length ? { warnings: warnings.map(w => w.message).join(' ') } : {}) });
}

function pollGeneration(flavor: GammaFlavor, id: string, origin: string, deps: DecksGammaDeps, now: number) {
  const deckId = GEN_ID.test(id) ? deckIdOf(id) : null;
  const deck = deckId ? store.getDeck(deckId) as ApiDeck | null : null;
  // Decks not created through this API, another account's ids, and the other flavor's ids read as not found.
  if (!deck?.gammaApi || deck.gammaApi.flavor !== flavor) throw new GammaApiError(404, 'Generation not found');
  const job = store.latestJob(deck.id);
  const wantsFile = deck.gammaApi.exportAs === 'pptx' && deck.status === 'ready' && deck.cards.length > 0;
  return json(200, toGenerationStatus(deck, job, { origin, ...(wantsFile && deps.apiKey ? { exportUrl: signedFileUrl(origin, deps.apiKey, deck.id, now) } : {}) }));
}

// ── Edits ─────────────────────────────────────────────────────────────────

type EditView = { status: 'pending' | 'completed' | 'failed'; summary?: string; error?: string; updatedTime: string };

/**
 * Resolves an edit and, once its proposal is ready, applies it in place
 * (Gamma's edits apply directly; Decks' proposal review is skipped). Safe to
 * call repeatedly: the outcome is recorded once. Returns null for an edit
 * this API did not start and cannot attribute (an app proposal awaiting review).
 */
function settleEdit(editId: string): EditView | null {
  const job = store.getJob(editId);
  if (!job || job.kind !== 'edit' || !store.getDeck(job.deckId)) return null;
  const record = state.edits.get(editId);
  if (record?.outcome) return { status: record.outcome.status, summary: record.outcome.summary, error: record.outcome.error, updatedTime: record.outcome.at };
  if (job.status === 'pending' || job.status === 'running') return { status: 'pending', updatedTime: job.updatedAt };
  const finish = (outcome: Omit<NonNullable<EditRecord['outcome']>, 'at'>): EditView => {
    const at = new Date().toISOString();
    if (record) record.outcome = { ...outcome, at };
    return { ...outcome, updatedTime: at };
  };
  if (job.status === 'failed') return finish({ status: 'failed', error: job.error || 'The edit failed.' });
  const instruction = typeof job.payload.instruction === 'string' ? job.payload.instruction : '';
  const proposal = record?.proposalId ? store.getProposal(record.proposalId)
    : store.listProposals(job.deckId, false).find(p => p.instruction === instruction && p.createdAt >= job.createdAt) || null;
  if (!proposal) return finish({ status: 'failed', error: 'The edit produced no change.' });
  if (record) record.proposalId = proposal.id;
  if (proposal.status === 'applied') return finish({ status: 'completed', summary: proposal.summary });
  if (proposal.status === 'discarded') return finish({ status: 'failed', error: 'The edit was discarded before it was applied.' });
  if (!record) return null;
  try {
    engine.applyProposal(job.deckId, proposal.id, `API edit: ${instruction.slice(0, 80)}`);
    return finish({ status: 'completed', summary: proposal.summary });
  } catch (error) {
    return finish({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

/** Applies every finished API edit of a deck, so a new edit starts from the edited cards. */
function settleDeckEdits(deckId: string) {
  for (const [editId, record] of state.edits) if (record.deckId === deckId && !record.outcome) settleEdit(editId);
}

async function createEdit(ref: string, request: Request, origin: string) {
  const raw = await readBody(request);
  if (!isObject(raw)) throw bad('Request body must be a JSON object');
  rejectUnknown(raw, EDIT_FIELDS);
  const prompt = optionalString(raw, 'prompt', 10_000);
  if (!prompt) throw bad('prompt is required');
  oneOf(raw.quality, 'quality', ['lite', 'standard', 'max'] as const);
  if (raw.disableConnectors !== undefined && typeof raw.disableConnectors !== 'boolean') throw bad('disableConnectors must be a boolean');
  const deck = requireDeck(ref);
  settleDeckEdits(deck.id);
  const running = store.latestJob(deck.id, true);
  if (running?.kind === 'edit') throw new GammaApiError(409, 'An edit is already in progress for this gamma.', 'edit_in_progress', state.edits.has(running.id) ? { editId: running.id } : {});
  if (running || !['ready', 'failed'].includes(deck.status)) throw new GammaApiError(409, 'This gamma is still being generated; edit it once the generation completes.', 'generation_in_progress');
  if (!deck.cards.length) throw bad('This gamma has no cards to edit.');
  let job: DeckJob;
  try { job = engine.startEdit(deck.id, { kind: 'deck' }, prompt); }
  catch (error) { if (error instanceof EngineError) throw new GammaApiError(error.status, error.message, error.code); throw error; }
  state.edits.set(job.id, { deckId: deck.id });
  // Apply as soon as the proposal is ready, even if nobody polls (polls also settle it).
  const settle = () => { try { settleEdit(job.id); } catch (error) { console.error('[decks-gamma] edit apply failed', error); } };
  runningJobs()?.get(job.id)?.then(settle, settle);
  return json(201, { editId: job.id, gammaUrl: gammaUrlOf(origin, deck.id) });
}

function editStatus(editId: string, origin: string) {
  const job = EDIT_ID.test(editId) ? store.getJob(editId) : null;
  const view = job ? settleEdit(editId) : null;
  if (!job || !view) throw new GammaApiError(404, 'Edit not found');
  // Decks has no pages: the deck is the one page, so pageId is the deck id.
  const base = { status: view.status, editId, gammaId: job.deckId, gammaUrl: gammaUrlOf(origin, job.deckId), pageId: job.deckId, updatedTime: view.updatedTime };
  if (view.status === 'pending') return json(200, base);
  if (view.status === 'failed') return json(200, { ...base, error: { reason: 'edit_failed', message: view.error, statusCode: 500 }, credits: {} });
  return json(200, { ...base, result: { summary: view.summary }, credits: {} });
}

// ── Exports ───────────────────────────────────────────────────────────────

async function createExport(ref: string, request: Request) {
  const raw = await readBody(request);
  if (!isObject(raw)) throw bad('Request body must be a JSON object');
  rejectUnknown(raw, new Set(['exportAs']));
  const exportAs = oneOf(raw.exportAs, 'exportAs', ['pdf', 'png', 'pptx'] as const);
  if (!exportAs) throw bad('exportAs is required');
  if (exportAs !== 'pptx') throw bad(`exportAs "${exportAs}" is produced in the Decks app (${exportAs === 'pdf' ? 'Print to PDF' : 'PNG zip'}); this API exports pptx`, 'unsupported_export');
  const deck = requireDeck(ref);
  // The export id names its deck, so it resolves without a table (and after a restart).
  return json(200, { exportId: `exp_${deck.id.replace(/^deck_/, '')}_${randomBytes(6).toString('hex')}` });
}

function exportStatus(exportId: string, origin: string, deps: DecksGammaDeps, now: number) {
  const match = exportId.match(EXPORT_ID);
  const deck = match ? store.getDeck(`deck_${match[1]}`) : null;
  if (!deck) throw new GammaApiError(404, 'Export not found');
  const base = { exportAs: 'pptx', exportId, gammaId: deck.id };
  if (deck.status === 'outlining' || deck.status === 'outline_ready' || deck.status === 'generating') {
    // Waits for the generation; a deck whose job died reads as failed.
    if (store.latestJob(deck.id, true)) return json(200, { ...base, status: 'pending' });
  }
  if (deck.status !== 'ready' && deck.status !== 'failed') return json(200, { ...base, status: 'failed', error: { reason: 'no_content', message: 'The generation stopped before the cards were built.', statusCode: 422 } });
  if (!deck.cards.length) return json(200, { ...base, status: 'failed', error: { reason: 'no_content', message: 'This gamma has no cards to export.', statusCode: 422 } });
  if (!deps.apiKey) throw new GammaApiError(403, 'The API is disabled', 'api_disabled');
  return json(200, { ...base, status: 'completed', exportUrl: signedFileUrl(origin, deps.apiKey, deck.id, now) });
}

/** GET /files/{deckId}.pptx?expires&signature: a bearer link like Gamma's exportUrl (no API key; ~7 days). */
async function downloadFile(name: string, request: Request, deps: DecksGammaDeps, now: number) {
  const match = name.match(/^(deck_[a-z0-9]+)\.pptx$/);
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature') || '';
  if (!match || !deps.apiKey || !Number.isSafeInteger(expires) || expires < now || !safeEqual(signature, signFile(deps.apiKey, match[1], expires)))
    throw new GammaApiError(403, 'This download link is invalid or has expired');
  const deck = store.getDeck(match[1]);
  if (!deck) throw new GammaApiError(404, 'Gamma not found');
  if (!deck.cards.length) throw new GammaApiError(422, 'This gamma has no cards to export.', 'no_content');
  const file = await buildDeckPptx(deck, { readMedia: mediaId => { const m = store.readMedia(mediaId); return m ? { data: m.data, mime: m.item.mime } : null; } });
  const title = (deck.title || 'deck').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) || 'deck';
  return new Response(new Uint8Array(file), { status: 200, headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'content-disposition': `attachment; filename="deck.pptx"; filename*=UTF-8''${encodeURIComponent(title)}.pptx`,
    'cache-control': 'private, no-store',
  } });
}

// ── Router ────────────────────────────────────────────────────────────────

/**
 * Entry point for src/app/api/decks/gamma/v1.0/[...path]/route.ts; `path` is the part after /v1.0/.
 *
 *   POST /generations                 Classic create → 200 { generationId, warnings? }
 *   GET  /generations/{id}            Classic poll
 *   POST /agent/generations           Gamma 5 create → 202 { generationId, status, warnings }
 *   GET  /agent/generations/{id}      Gamma 5 poll
 *   POST /agent/gammas/{id}/edits     edit (applied in place) → 201 { editId, gammaUrl }
 *   GET  /agent/edits/{editId}        edit poll
 *   GET  /gammas/{id}                 metadata
 *   POST /gammas/{id}/export          → 200 { exportId } (pptx)
 *   GET  /exports/{id}                export poll → signed exportUrl
 *   GET  /themes                      Decks themes
 *   GET  /files/{deckId}.pptx         signed download (no key)
 */
export async function handleDecksGammaRequest(request: Request, path: string[], deps: DecksGammaDeps): Promise<Response> {
  const now = deps.now ? deps.now() : Date.now();
  try {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const origin = url.origin;
    if (method === 'GET' && path.length === 2 && path[0] === 'files') return await downloadFile(path[1], request, deps, now);
    if (!deps.apiKey) throw new GammaApiError(403, 'The Gamma-compatible API is disabled. Set the ppt_gamma_api_key setting (or PPT_GAMMA_API_KEY) to enable it.', 'api_disabled');
    const key = presentedKey(request);
    if (!key || !safeEqual(key, deps.apiKey)) throw new GammaApiError(401, 'Invalid API key', 'unauthorized');
    const route = path.join('/');
    const [a, b, c, d] = path;
    if (method === 'POST' && route === 'generations') return await createGeneration('classic', request, deps);
    if (method === 'POST' && route === 'agent/generations') return await createGeneration('agent', request, deps);
    if (method === 'GET' && path.length === 2 && a === 'generations') return pollGeneration('classic', b, origin, deps, now);
    if (method === 'GET' && path.length === 3 && a === 'agent' && b === 'generations') return pollGeneration('agent', c, origin, deps, now);
    if (method === 'POST' && path.length === 4 && a === 'agent' && b === 'gammas' && d === 'edits') return await createEdit(c, request, origin);
    if (method === 'GET' && path.length === 3 && a === 'agent' && b === 'edits') return editStatus(c, origin);
    if (method === 'GET' && path.length === 2 && a === 'gammas') return json(200, toGammaMetadata(requireDeck(b), origin));
    if (method === 'POST' && path.length === 3 && a === 'gammas' && c === 'export') return await createExport(b, request);
    if (method === 'GET' && path.length === 2 && a === 'exports') return exportStatus(b, origin, deps, now);
    if (method === 'GET' && route === 'themes') return json(200, toGammaThemes(url.searchParams));
    throw new GammaApiError(404, `No route for ${method} /v1.0/${route}`);
  } catch (error) {
    if (error instanceof GammaApiError) return json(error.statusCode, { ...error.extra, message: error.message, statusCode: error.statusCode, ...(error.code ? { code: error.code } : {}) }, error.headers);
    console.error('[decks-gamma]', error);
    return json(500, { message: 'An error occurred while handling the request.', statusCode: 500 });
  }
}

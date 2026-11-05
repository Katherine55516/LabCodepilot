/**
 * Decks: card-based AI presentations, modelled on the Gamma reverse-engineering
 * reports (docs/research/gamma-reverse/). This file is the shared contract for
 * the engine (src/lib/decks/*), the API (src/app/api/decks/**), the exporters
 * and the UI (src/components/decks/*).
 *
 * Document model (report 01 §2): Deck (a "file") → Card (a "slide") → Block.
 * Cards carry a layout with an accent-image slot (report 04 §2: none / left /
 * right / top / background). Generation runs as jobs with per-card stages
 * (report 02: queued → writing → imaging → checking → polishing → done).
 */

// ── Formats and geometry (report 01 §2.2) ───────────────────────────────

export type DeckFormat = 'presentation' | 'document' | 'social';
export type CardDimensions = '16x9' | '4x3' | 'fluid' | 'a4' | 'letter' | 'pageless' | '1x1' | '4x5' | '9x16';
export const FORMAT_DIMENSIONS: Record<DeckFormat, CardDimensions[]> = {
  presentation: ['16x9', '4x3', 'fluid'],
  document: ['pageless', 'letter', 'a4', 'fluid'],
  social: ['1x1', '4x5', '9x16'],
};
/** Width / height for fixed dimensions; fluid/pageless cards grow with content. */
export const DIMENSION_RATIO: Record<CardDimensions, number | null> = {
  '16x9': 16 / 9, '4x3': 4 / 3, fluid: null, a4: 210 / 297, letter: 8.5 / 11, pageless: null, '1x1': 1, '4x5': 4 / 5, '9x16': 9 / 16,
};

// ── Content settings (report 03) ─────────────────────────────────────────

export type TextMode = 'generate' | 'condense' | 'preserve';
export type TextAmount = 'brief' | 'medium' | 'detailed' | 'extensive';
export type CardSplit = 'auto' | 'inputTextBreaks';

/** Output language: 'auto' follows the input; otherwise a BCP-47-ish code. */
export const DECK_LANGUAGES = [
  'auto', 'en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'es', 'fr', 'de', 'pt-br', 'it', 'ru', 'ar', 'hi', 'id', 'vi', 'th', 'tr', 'nl', 'pl',
] as const;
export type DeckLanguage = typeof DECK_LANGUAGES[number];

// ── Media settings (report 04) ───────────────────────────────────────────

/**
 * Where card images come from. Gamma's stock/web sources need licensed
 * third-party APIs and are not replicated; `themeAccent` uses original SVG
 * artwork generated from the theme (src/lib/decks/accent-art.ts).
 */
export type ImageSource = 'aiGenerated' | 'themeAccent' | 'placeholder' | 'inputOnly' | 'noImages';
export type AccentPosition = 'none' | 'left' | 'right' | 'top' | 'background';

export interface GenerationSettings {
  inputText: string;
  textMode: TextMode;
  amount: TextAmount;
  tone?: string;
  audience?: string;
  language: DeckLanguage;
  /** Soft target (report 02 §1): the planner may deviate by one or two cards. */
  numCards: number;
  cardSplit: CardSplit;
  additionalInstructions?: string;
  imageSource: ImageSource;
  /** Deck-wide style string for AI images, for visual consistency (report 04 §1). */
  imageStyle?: string;
  themeId: string;
  format: DeckFormat;
  dimensions: CardDimensions;
  /** Gamma 5 offers Plan (review the outline first) and Express (build straight away) (report 02 §3). */
  mode?: 'plan' | 'express';
}

export const NUM_CARDS_RANGE = { min: 1, max: 60 } as const;

// ── Blocks ────────────────────────────────────────────────────────────────

/** Inline text uses a Markdown subset: **bold**, *italic*, `code`, [text](https://url). */
export type InlineText = string;

export type Block =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: InlineText }
  | { id: string; type: 'paragraph'; text: InlineText }
  | { id: string; type: 'bullets'; items: InlineText[] }
  | { id: string; type: 'numbered'; items: InlineText[] }
  | { id: string; type: 'image'; mediaId?: string; alt: string; caption?: string; fit: 'cover' | 'contain'; placeholder?: boolean }
  | { id: string; type: 'table'; header: string[]; rows: string[][] }
  | { id: string; type: 'chart'; chartType: 'bar' | 'line' | 'pie'; labels: string[]; series: { name: string; values: number[] }[]; unit?: string }
  | { id: string; type: 'callout'; tone: 'info' | 'warning' | 'success' | 'note'; title?: string; text: InlineText }
  | { id: string; type: 'quote'; text: InlineText; attribution?: string }
  | { id: string; type: 'code'; language: string; code: string }
  /** Smart layouts (report 03 §5 / editor "Diagrams"): native, editable components. */
  | { id: string; type: 'timeline'; items: { label: string; title: string; text?: InlineText }[] }
  | { id: string; type: 'steps'; items: { title: string; text?: InlineText }[] }
  | { id: string; type: 'metrics'; items: { value: string; label: string; detail?: string }[] }
  | { id: string; type: 'grid'; items: { title: string; text?: InlineText; icon?: string }[] }
  | { id: string; type: 'columns'; columns: Block[][] }
  | { id: string; type: 'divider' };

export type BlockType = Block['type'];

// ── Cards and decks ───────────────────────────────────────────────────────

export type CardStage = 'queued' | 'writing' | 'imaging' | 'checking' | 'polishing' | 'done' | 'failed';

export interface CardLayout {
  accent: AccentPosition;
  /** Media shown in the accent slot. */
  accentMediaId?: string;
  /** Seed for the generated theme art when there is no media (defaults to the card id); "new image" changes it. */
  accentSeed?: string;
  align: 'left' | 'center';
}

export interface Card {
  id: string;
  blocks: Block[];
  layout: CardLayout;
  hidden: boolean;
  notes: string;
  stage: CardStage;
  /** Findings from the checking pass that polishing could not resolve. */
  issues?: CardIssue[];
}

export interface CardIssue { code: 'overflow' | 'empty' | 'duplicate_image' | 'missing_image' | 'model_fallback'; message: string }

/** Outline = content (report 03 §3): each card already carries its final points. */
export interface OutlineCard {
  id: string;
  title: string;
  points: string[];
  /** Per-card instruction from the review step (Gamma: "Instruction" per card). */
  instruction?: string;
}

export type DeckStatus = 'outlining' | 'outline_ready' | 'generating' | 'ready' | 'failed';

/** Header/footer slot (report 05 §6): text, card number, or a logo image (an uploaded mediaId, else text). */
export interface HeaderFooterSlot { type: 'text' | 'cardNumber' | 'logo'; value?: string; mediaId?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }
export interface HeaderFooter {
  topLeft?: HeaderFooterSlot; topCenter?: HeaderFooterSlot; topRight?: HeaderFooterSlot;
  bottomLeft?: HeaderFooterSlot; bottomCenter?: HeaderFooterSlot; bottomRight?: HeaderFooterSlot;
  hideFromFirstCard?: boolean; hideFromLastCard?: boolean;
}

export interface Deck {
  id: string;
  title: string;
  status: DeckStatus;
  settings: GenerationSettings;
  outline: OutlineCard[];
  cards: Card[];
  headerFooter: HeaderFooter;
  /** Increments on every saved change; edits carry the version they were based on. */
  version: number;
  /** Request-level warnings, Gamma style: { code, message }. */
  warnings: DeckWarning[];
  /** Images found in the input (https URLs, Gamma rules), fetched and hosted locally; used first. */
  inputMediaIds?: string[];
  /** Which model wrote the deck: 'provider' or the offline 'mock' demo model. */
  model?: 'provider' | 'mock';
  /** Where the content came from (report 06 §4 import intents). */
  source?: DeckSource;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeckWarning { code: string; message: string }

export interface DeckSource { kind: 'prompt' | 'paste' | 'import' | 'api'; fileName?: string; intent?: ImportIntent }
/** What to do with an imported deck (report 06 §4): keep it as-is, restyle it, or condense it into a new deck. */
export type ImportIntent = 'asIs' | 'restyle' | 'condense';

export interface DeckSummary {
  id: string; title: string; status: DeckStatus; themeId: string; dimensions: CardDimensions; cardCount: number;
  firstCard?: Card; createdAt: string; updatedAt: string;
}

// ── Jobs (report 02 §2) ───────────────────────────────────────────────────

export type JobKind = 'outline' | 'build' | 'edit';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobProgress {
  stages: Record<CardStage, number>;
  done: number;
  total: number;
  /** 0–99 while running; only a completed job is 100. Never decreases within one job. */
  percent: number;
}

export interface DeckJob {
  id: string;
  deckId: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress;
  error?: string;
  /** Instructions queued while the job runs (report 02: queued, run after the build). */
  queuedInstructions: QueuedInstruction[];
  createdAt: string;
  updatedAt: string;
}

export interface QueuedInstruction { id: string; text: string; status: 'queued' | 'applying' | 'applied' | 'failed' }

// ── AI edits (report 06 §1–2) ─────────────────────────────────────────────

export type EditScope =
  | { kind: 'deck' }
  | { kind: 'card'; cardId: string }
  | { kind: 'block'; cardId: string; blockId: string };

export interface EditProposal {
  id: string;
  deckId: string;
  scope: EditScope;
  instruction: string;
  baseVersion: number;
  /** Cards before and after, for the Original / Modified compare. */
  before: Card[];
  after: Card[];
  summary: string;
  status: 'proposed' | 'applied' | 'discarded';
  createdAt: string;
}

export interface DeckVersion { version: number; reason: string; createdAt: string }

// ── Media (report 04 §3) ──────────────────────────────────────────────────

export type MediaOrigin = 'upload' | 'url' | 'ai' | 'accent';
export interface MediaItem {
  id: string;
  deckId: string;
  mime: string;
  origin: MediaOrigin;
  width?: number;
  height?: number;
  sourceUrl?: string;
  prompt?: string;
  createdAt: string;
}

// ── Themes ────────────────────────────────────────────────────────────────

export interface DeckTheme {
  id: string;
  name: string;
  /** Like Gamma's ThemeItem keywords: used for theme search and AI image style. */
  colorKeywords: string[];
  toneKeywords: string[];
  dark: boolean;
  colors: { background: string; surface: string; text: string; muted: string; accent: string; accent2: string; border: string };
  fonts: { heading: string; body: string };
  radius: number;
  /** Original SVG accent artwork style (src/lib/decks/accent-art.ts). */
  accentStyle: 'aurora' | 'grid' | 'waves' | 'orbs' | 'stripes' | 'paper';
}

// ── API shapes (src/app/api/decks/**) ─────────────────────────────────────

/** POST /api/decks → 201 { deck, job } */
export interface CreateDeckRequest {
  settings: Partial<GenerationSettings> & { inputText: string };
  title?: string;
  /** A prepared outline (imports, API inputTextBreaks): skips the planner; each card keeps its points as written. */
  outline?: { title: string; points: string[] }[];
  source?: DeckSource;
}
/** GET /api/decks → { decks: DeckSummary[] } ; GET /api/decks/:id → { deck, job?, proposals } */
export interface DeckResponse { deck: Deck; job?: DeckJob; proposals: EditProposal[]; media: MediaItem[] }
/** PUT /api/decks/:id/outline { outline, settings? } → { deck } (only while outline_ready) */
export interface SaveOutlineRequest { outline: OutlineCard[]; settings?: Partial<GenerationSettings> }
/** POST /api/decks/:id/generate → 202 { job } */
/** PUT /api/decks/:id { baseVersion, title?, cards?, headerFooter?, settings? } → { deck } (409 on version conflict) */
export interface SaveDeckRequest { baseVersion: number; title?: string; cards?: Card[]; headerFooter?: HeaderFooter; settings?: Partial<GenerationSettings> }
/** POST /api/decks/:id/edits { scope, instruction } → 202 { job } ; proposal appears in GET */
export interface AiEditRequest { scope: EditScope; instruction: string }
/** POST /api/decks/:id/proposals/:pid/apply | /discard → { deck } */
/** POST /api/decks/:id/instructions { text } → { job } (queue while building) ; DELETE /api/decks/:id/instructions/:qid → { job } (remove a queued one) */
/** POST /api/decks/:id/stop → { job } (stop a build: finished cards stay, unbuilt cards are dropped) */
/** GET /api/decks/:id/versions → { versions } ; POST /api/decks/:id/versions/:v/restore → { deck } */
/** POST /api/decks/:id/media { url } | raw image body → { media } ; GET /api/decks/media/:mediaId → bytes */
/** POST /api/decks/:id/cards/:cardId/accent { action: 'regenerate' | 'clear', position? } → { deck } */
/** GET /api/decks/:id/export?format=pptx → file */
/** GET /api/decks/:id/events → text/event-stream of { deck, job } snapshots */
/** GET /api/decks/themes → { themes: DeckTheme[] } */
/** DELETE /api/decks/:id → { ok } */

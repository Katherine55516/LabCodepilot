import type {
  CardDimensions, DeckFormat, DeckLanguage, GenerationSettings, ImageSource, ImportIntent, OutlineCard, TextAmount, TextMode,
} from '@/lib/decks/types';
import { FORMAT_DIMENSIONS, NUM_CARDS_RANGE } from '@/lib/decks/types';
import { DEFAULT_THEME_ID } from '@/lib/decks/themes';
import type { Locale } from '@/i18n';

/** Option lists shared by the create flow and the outline review. */
export const DECK_FORMATS: DeckFormat[] = ['presentation', 'document', 'social'];
export const TEXT_AMOUNTS: TextAmount[] = ['brief', 'medium', 'detailed', 'extensive'];
export const IMAGE_SOURCES: ImageSource[] = ['aiGenerated', 'themeAccent', 'placeholder', 'inputOnly', 'noImages'];
/** Modes offered for pasted text, in the order of report 03 §1.2's UI (condense / keep / expand). */
export const PASTE_MODES: TextMode[] = ['condense', 'preserve', 'generate'];

/** Everything the create form edits except the input text itself. */
export interface SettingsDraft {
  numCards: number;
  amount: TextAmount;
  tone: string;
  audience: string;
  language: DeckLanguage;
  imageSource: ImageSource;
  imageStyle: string;
  additionalInstructions: string;
  themeId: string;
  format: DeckFormat;
  dimensions: CardDimensions;
}

export const DEFAULT_DRAFT: SettingsDraft = {
  numCards: 10,
  amount: 'medium',
  tone: '',
  audience: '',
  language: 'auto',
  imageSource: 'themeAccent',
  imageStyle: '',
  additionalInstructions: '',
  themeId: DEFAULT_THEME_ID,
  format: 'presentation',
  dimensions: FORMAT_DIMENSIONS.presentation[0],
};

export const clampCards = (n: number) =>
  Math.min(NUM_CARDS_RANGE.max, Math.max(NUM_CARDS_RANGE.min, Math.round(Number.isFinite(n) ? n : NUM_CARDS_RANGE.min)));

/** A line holding only `---` splits cards (report 03 §2.1, `\n---\n`). */
const BREAK = /\n[ \t]*---[ \t]*(?:\n|$)/;
export const countSections = (text: string) => text.trim() ? text.split(BREAK).filter(part => part.trim()).length : 0;

/**
 * Builds the create request settings. Options the chosen mode ignores are
 * left out (report 03 §1.3: tone/audience only apply to generate, amount not
 * to preserve), so the server does not have to warn about them.
 */
export function buildSettings(draft: SettingsDraft, input: { inputText: string; textMode: TextMode; splitByBreaks: boolean }): Partial<GenerationSettings> & { inputText: string } {
  const trimmed = (value: string) => value.trim() || undefined;
  return {
    inputText: input.inputText,
    textMode: input.textMode,
    cardSplit: input.splitByBreaks ? 'inputTextBreaks' : 'auto',
    numCards: clampCards(draft.numCards),
    amount: input.textMode === 'preserve' ? undefined : draft.amount,
    tone: input.textMode === 'generate' ? trimmed(draft.tone) : undefined,
    audience: input.textMode === 'generate' ? trimmed(draft.audience) : undefined,
    language: draft.language,
    imageSource: draft.imageSource,
    imageStyle: draft.imageSource === 'aiGenerated' ? trimmed(draft.imageStyle) : undefined,
    additionalInstructions: trimmed(draft.additionalInstructions),
    themeId: draft.themeId,
    format: draft.format,
    dimensions: draft.dimensions,
  };
}

// ── Locale helpers ─────────────────────────────────────────────────────────

export const intlLocale = (locale: Locale) => (locale === 'en' ? 'en' : locale === 'zh-HK' ? 'zh-HK' : 'zh-CN');

/** Language name in the UI language via Intl (falls back to the code). */
export function languageName(code: Exclude<DeckLanguage, 'auto'>, locale: Locale): string {
  try {
    return new Intl.DisplayNames([intlLocale(locale)], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

export function relativeTime(iso: string, locale: Locale, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((then - now) / 1000);
  const format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7]];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(unit === 'second' ? 0 : value, unit);
    value = Math.round(value / size);
  }
  return new Date(iso).toLocaleDateString(intlLocale(locale), { dateStyle: 'medium' });
}

// ── Outline editing (pure) ─────────────────────────────────────────────────

/** Removes empty points and blank instructions before saving. */
export const cleanOutline = (outline: OutlineCard[]): OutlineCard[] =>
  outline.map(card => {
    const instruction = card.instruction?.trim();
    return { id: card.id, title: card.title.trim(), points: card.points.map(p => p.trim()).filter(Boolean), ...(instruction ? { instruction } : {}) };
  });

/** Message for a failed API call (`DecksApiError.message` carries the server's text). */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ── Import (mirrors src/lib/decks/import.ts, which is server-only) ────────

export const IMPORT_ACCEPT = ['.pptx', '.potx', '.md', '.txt'] as const;
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const IMPORT_INTENT_OPTIONS: ImportIntent[] = ['asIs', 'restyle', 'condense'];

/** Client-side check before upload; the server repeats it. */
export function importFileProblem(file: { name: string; size: number }): 'badType' | 'tooLarge' | null {
  const name = file.name.toLowerCase();
  if (!IMPORT_ACCEPT.some(ext => name.endsWith(ext))) return 'badType';
  if (file.size > IMPORT_MAX_BYTES) return 'tooLarge';
  return null;
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

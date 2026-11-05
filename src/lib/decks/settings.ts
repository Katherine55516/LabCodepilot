import { getTheme } from './themes';
import type { CardDimensions, DeckFormat, DeckWarning, GenerationSettings, ImageSource, TextAmount, TextMode } from './types';
import { DECK_LANGUAGES, FORMAT_DIMENSIONS, NUM_CARDS_RANGE } from './types';

/**
 * Input interpretation, following Gamma's documented semantics (report 03 §1–2):
 * - textMode: generate expands a brief; condense summarises long input;
 *   preserve keeps the input text, only adding structure.
 * - tone and audience steer generated writing only (ignored for preserve).
 * - cardSplit=inputTextBreaks: one card per `\n---\n` segment, numCards ignored.
 * - numCards is a soft target.
 */

export const MAX_INPUT_CHARS = 400_000;

export class SettingsError extends Error {}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function normalizeSettings(input: Partial<GenerationSettings>, warnings: DeckWarning[] = []): GenerationSettings {
  const inputText = typeof input.inputText === 'string' ? input.inputText.replace(/\r\n/g, '\n') : '';
  if (!inputText.trim()) throw new SettingsError('Enter a topic or paste some text.');
  if (inputText.length > MAX_INPUT_CHARS) throw new SettingsError(`The input is longer than ${MAX_INPUT_CHARS.toLocaleString('en')} characters.`);
  const format = oneOf<DeckFormat>(input.format, ['presentation', 'document', 'social'], 'presentation');
  const allowedDims = FORMAT_DIMENSIONS[format];
  let dimensions = oneOf<CardDimensions>(input.dimensions, allowedDims, allowedDims[0]);
  if (input.dimensions && !allowedDims.includes(input.dimensions)) {
    warnings.push({ code: 'dimensions_adjusted', message: `Dimensions ${input.dimensions} do not apply to ${format}; using ${allowedDims[0]}.` });
    dimensions = allowedDims[0];
  }
  const textMode = oneOf<TextMode>(input.textMode, ['generate', 'condense', 'preserve'], inputText.length > 1500 ? 'condense' : 'generate');
  const numRaw = Number(input.numCards);
  const numCards = Number.isFinite(numRaw) ? Math.round(Math.min(NUM_CARDS_RANGE.max, Math.max(NUM_CARDS_RANGE.min, numRaw))) : 8;
  if (Number.isFinite(numRaw) && numCards !== numRaw) warnings.push({ code: 'num_cards_adjusted', message: `Card count ${numRaw} was changed to ${numCards} (${NUM_CARDS_RANGE.min}–${NUM_CARDS_RANGE.max}).` });
  const tone = text(input.tone, 500);
  const audience = text(input.audience, 500);
  if (textMode === 'preserve' && (tone || audience)) warnings.push({ code: 'ignored_text_options', message: 'Tone and audience apply only when text is generated or condensed.' });
  return {
    inputText,
    textMode,
    amount: oneOf<TextAmount>(input.amount, ['brief', 'medium', 'detailed', 'extensive'], 'medium'),
    ...(tone ? { tone } : {}),
    ...(audience ? { audience } : {}),
    language: oneOf(input.language, DECK_LANGUAGES, 'auto'),
    numCards,
    cardSplit: input.cardSplit === 'inputTextBreaks' ? 'inputTextBreaks' : 'auto',
    ...(text(input.additionalInstructions, 5000) ? { additionalInstructions: text(input.additionalInstructions, 5000) } : {}),
    imageSource: oneOf<ImageSource>(input.imageSource, ['aiGenerated', 'themeAccent', 'placeholder', 'inputOnly', 'noImages'], 'themeAccent'),
    ...(text(input.imageStyle, 1000) ? { imageStyle: text(input.imageStyle, 1000) } : {}),
    themeId: getTheme(input.themeId).id,
    format,
    dimensions,
  };
}

export const CARD_BREAK = /\n[ \t]*---[ \t]*\n/;

/** One segment per `\n---\n` break: n breaks → n+1 cards (report 03 §2). */
export function splitByBreaks(inputText: string): string[] {
  return `\n${inputText}\n`.split(CARD_BREAK).map(part => part.trim()).filter(Boolean);
}

/** Words of body text per card for each amount (guidance for the writer). */
export const AMOUNT_WORDS: Record<TextAmount, [number, number]> = { brief: [15, 40], medium: [40, 80], detailed: [80, 140], extensive: [140, 220] };

export function languageInstruction(language: GenerationSettings['language']): string {
  if (language === 'auto') return 'Write in the same language as the input.';
  const names: Record<string, string> = {
    en: 'English', 'zh-cn': 'Simplified Chinese', 'zh-tw': 'Traditional Chinese', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German',
    'pt-br': 'Brazilian Portuguese', it: 'Italian', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', tr: 'Turkish', nl: 'Dutch', pl: 'Polish',
  };
  return `Write every card in ${names[language] || language}, regardless of the input language.`;
}

/** Gamma's image-URL rule (report 04 §3): bare https URLs ending in an image extension. */
export function extractImageUrls(input: string): { text: string; urls: string[] } {
  const urls: string[] = [];
  const out = input.replace(/\S+/g, token => {
    const candidate = token.replace(/[),.;:!?]+$/, '');
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && /\.(?:jpe?g|png|gif|webp|svg|avif)$/i.test(url.pathname)) {
        if (!urls.includes(url.href)) urls.push(url.href);
        return '';
      }
    } catch { /* not a URL */ }
    return token;
  });
  return { text: out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), urls: urls.slice(0, 20) };
}

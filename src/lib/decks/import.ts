import { ImportError, parsePptx, type ImportedCard, type ImportLimits } from './import-pptx';
import { MAX_INPUT_CHARS } from './settings';
import type { CreateDeckRequest, GenerationSettings, ImportIntent } from './types';
import { NUM_CARDS_RANGE } from './types';

/**
 * Presentation import (report 06 §5): a file's text becomes a deck. What
 * happens next follows the chosen intent (report 06 §5.4, Gamma's
 * prompt-directed import): keep it as-is, restyle it, or condense it into a
 * new, shorter deck. Files are parsed as data only (see import-pptx.ts).
 */

export { ImportError } from './import-pptx';
export type { ImportedCard } from './import-pptx';

export interface ParsedPresentation { title: string; cards: ImportedCard[]; warnings: string[] }

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const IMPORT_EXTENSIONS = ['.pptx', '.potx', '.md', '.txt'] as const;
export const IMPORT_INTENTS: readonly ImportIntent[] = ['asIs', 'restyle', 'condense'];
const LIMITS: ImportLimits = { maxSlides: 100, maxPoints: 12, maxPointChars: 800 };

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
};
const baseName = (fileName: string) => fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export async function parsePresentation(bytes: Buffer, fileName: string): Promise<ParsedPresentation> {
  const ext = extensionOf(fileName);
  if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
    const hint = ext === '.ppt' || ext === '.key' || ext === '.odp' ? ` Save it as .pptx first.` : '';
    throw new ImportError(415, `${ext ? `${ext} files` : 'Files without an extension'} cannot be imported. Use .pptx, .potx, .md or .txt.${hint}`, 'import_unsupported_type');
  }
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError(413, 'The file is larger than 50 MB.', 'import_too_large');
  if (!bytes.length) throw new ImportError(400, 'The file is empty.', 'import_empty');

  let parsed: { title?: string; cards: ImportedCard[]; warnings: string[] };
  if (ext === '.pptx' || ext === '.potx') {
    if (bytes.readUInt32BE(0) !== 0x504b0304) throw new ImportError(400, 'This file is not a valid PowerPoint package.', 'import_unreadable');
    parsed = await parsePptx(bytes, LIMITS);
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      throw new ImportError(400, 'The text file is not valid UTF-8.', 'import_unreadable');
    }
    parsed = parseText(text);
  }
  if (!parsed.cards.length) {
    throw new ImportError(422, ext === '.potx' ? 'This template has no slides with text to import.' : 'No text was found in this file.', 'import_no_content');
  }
  return { title: cap(parsed.title || parsed.cards[0].title || baseName(fileName) || 'Imported deck', 200), cards: parsed.cards, warnings: parsed.warnings };
}

// ── Markdown / plain text ───────────────────────────────────────────────────

const BREAK_LINE = /\n[ \t]*---[ \t]*(?=\n|$)/;
const SPLIT_HEADING = /^#{1,2}[ \t]+\S/;

/** Strips list markers and heading hashes from one line. */
const cleanLine = (line: string) => line.replace(/^\s*(?:#{1,6}[ \t]+|[-*+•][ \t]+|\d{1,3}[.)][ \t]+|>[ \t]?)/, '').trim();

/**
 * Cards from text: one per `---` section if the text has such breaks, else
 * one per `#` / `##` heading. Each section's first line is its title; every
 * other non-empty line is a point. Long sections continue on a second card.
 */
export function parseText(raw: string): { title?: string; cards: ImportedCard[]; warnings: string[] } {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const warnings: string[] = [];
  let sections: string[][];
  if (BREAK_LINE.test(`\n${text}`)) {
    sections = `\n${text}\n`.split(BREAK_LINE).map(part => part.split('\n'));
  } else {
    sections = [];
    let current: string[] = [];
    for (const line of text.split('\n')) {
      if (SPLIT_HEADING.test(line) && current.some(l => l.trim())) { sections.push(current); current = []; }
      current.push(line);
    }
    sections.push(current);
  }
  const deckTitle = cleanLine(text.split('\n').find(line => /^#[ \t]+\S/.test(line)) || '') || undefined;
  const cards: ImportedCard[] = [];
  let truncated = false;
  for (const section of sections) {
    const lines = section.map(cleanLine).filter(line => line && !/^```/.test(line));
    if (!lines.length) continue;
    const [title, ...points] = lines;
    const chunks = points.length ? [] as string[][] : [[]];
    for (let i = 0; i < points.length; i += LIMITS.maxPoints) chunks.push(points.slice(i, i + LIMITS.maxPoints));
    chunks.forEach((chunk, i) => {
      if (cards.length >= LIMITS.maxSlides) { truncated = true; return; }
      cards.push({ title: cap(i ? `${title} (${i + 1})` : title, 200), points: chunk.map(point => cap(point, LIMITS.maxPointChars)) });
    });
  }
  if (truncated) warnings.push(`Only the first ${LIMITS.maxSlides} cards were imported.`);
  return { title: deckTitle, cards, warnings };
}

// ── Intent → create request (report 06 §5.4) ───────────────────────────────

/** The imported text as one input, one `---` section per card. */
export function joinCards(cards: ImportedCard[]): string {
  const joined = cards.map(card => [card.title, ...card.points.map(point => `- ${point}`)].join('\n')).join('\n---\n');
  return joined.length > MAX_INPUT_CHARS ? joined.slice(0, MAX_INPUT_CHARS) : joined;
}

export function condensedCardCount(slides: number): number {
  return Math.min(NUM_CARDS_RANGE.max, Math.max(1, Math.min(slides, Math.max(3, Math.round(slides / 2)))));
}

/**
 * - asIs: the cards verbatim as a prepared outline, no added artwork.
 * - restyle: the same content with the chosen theme and its accent artwork.
 * - condense: the planner writes a shorter new deck from the text.
 */
export function importRequest(
  parsed: ParsedPresentation,
  opts: { fileName: string; intent: ImportIntent; themeId?: string; mode?: GenerationSettings['mode'] },
): CreateDeckRequest {
  const base = { inputText: joinCards(parsed.cards), ...(opts.themeId ? { themeId: opts.themeId } : {}), mode: opts.mode === 'express' ? 'express' as const : 'plan' as const };
  const source = { kind: 'import' as const, fileName: opts.fileName, intent: opts.intent };
  const outline = parsed.cards.map(card => ({ title: card.title, points: card.points }));
  const numCards = Math.min(NUM_CARDS_RANGE.max, Math.max(NUM_CARDS_RANGE.min, parsed.cards.length));
  if (opts.intent === 'condense') {
    return { settings: { ...base, textMode: 'condense', numCards: condensedCardCount(parsed.cards.length) }, source };
  }
  return {
    settings: { ...base, textMode: 'preserve', numCards, imageSource: opts.intent === 'restyle' ? 'themeAccent' : 'noImages' },
    title: parsed.title,
    outline,
    source,
  };
}

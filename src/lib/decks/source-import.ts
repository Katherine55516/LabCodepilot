import { chunkSource } from './chunking';
import { parsePdf, PdfImportError, type ParsedPdf, type PdfFigureImage } from './import-pdf';
import { profileFigures } from './media-relations';
import { MAX_INPUT_CHARS } from './settings';
import { blocksFromMarkdown, type DeckSourceDoc, type SourceBlock, type SourceFigure } from './source';
import type { CreateDeckRequest, GenerationSettings } from './types';
import { NUM_CARDS_RANGE } from './types';

/**
 * Long sources (PDF, long Markdown/text) → a structured deck request:
 * parse → semantic chunks for a card target → figure profiles (kind, series)
 * → CreateDeckRequest with `sourceDoc`, plus the figure images to host.
 */

export interface ParsedSource {
  kind: 'pdf' | 'markdown';
  fileName: string;
  title: string;
  authors?: string;
  pages?: number;
  blocks: SourceBlock[];
  figures: SourceFigure[];
  images: PdfFigureImage[];
  dropped: { label: string; chars: number }[];
  droppedSamples: ParsedPdf['droppedSamples'];
  warnings: string[];
}

export class SourceImportError extends Error {
  constructor(public status: number, message: string, public code = 'source_failed') { super(message); }
}

export async function parseSourceFile(bytes: Buffer, fileName: string): Promise<ParsedSource> {
  const ext = (/\.[^.]+$/.exec(fileName)?.[0] || '').toLowerCase();
  if (ext === '.pdf') {
    try {
      const pdf = await parsePdf(bytes);
      return { kind: 'pdf', fileName, ...pdf };
    } catch (error) {
      if (error instanceof PdfImportError) throw new SourceImportError(error.status, error.message, error.code);
      throw error;
    }
  }
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new SourceImportError(400, 'The text file is not valid UTF-8.', 'source_unreadable'); }
    const blocks = blocksFromMarkdown(text);
    if (!blocks.length) throw new SourceImportError(422, 'No text was found in this file.', 'source_no_content');
    const first = blocks.find(b => b.kind === 'heading');
    return {
      kind: 'markdown', fileName, title: first && first.kind === 'heading' ? first.text : fileName.replace(/\.[^.]+$/, ''),
      blocks, figures: [], images: [], dropped: [], droppedSamples: [], warnings: [],
    };
  }
  throw new SourceImportError(415, 'Use a .pdf, .md or .txt file as the source.', 'source_unsupported_type');
}

/** A sensible card target from the source size: about one card per 2,500 characters of body text, 6–20. */
export function defaultCardTarget(parsed: ParsedSource): number {
  const chars = parsed.blocks.reduce((n, b) => n + (b.kind === 'paragraph' ? b.text.length : 0), 0);
  return Math.max(6, Math.min(20, Math.round(chars / 2500) + 1));
}

export function buildSourceDoc(parsed: ParsedSource, targetCards: number): DeckSourceDoc {
  const target = Math.max(2, Math.min(NUM_CARDS_RANGE.max, Math.round(targetCards)));
  const { chunks, figures, dropped } = chunkSource(parsed.blocks, parsed.figures, { targetCards: target });
  const profiled = profileFigures(figures, new Map(parsed.images.map(i => [i.figureId, i.data])));
  return {
    kind: parsed.kind, fileName: parsed.fileName, title: parsed.title,
    ...(parsed.authors ? { authors: parsed.authors } : {}), ...(parsed.pages ? { pages: parsed.pages } : {}),
    chunks, figures: profiled, dropped: [...dropped, ...parsed.dropped], warnings: parsed.warnings,
  };
}

/** The source as readable text (kept as the deck's input; the planner uses the chunks). */
export function sourceText(doc: DeckSourceDoc): string {
  const text = [`# ${doc.title}`, ...doc.chunks.map(c => `## ${c.path.join(' › ') || c.title}\n\n${c.text}`)].join('\n\n');
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
}

export function sourceDeckRequest(parsed: ParsedSource, opts: { targetCards?: number; settings?: Partial<GenerationSettings>; source?: CreateDeckRequest['source'] } = {}): { request: CreateDeckRequest; figures: PdfFigureImage[] } {
  const numCards = opts.targetCards ?? opts.settings?.numCards ?? defaultCardTarget(parsed);
  const doc = buildSourceDoc(parsed, numCards);
  return {
    request: {
      settings: { textMode: 'condense', ...opts.settings, numCards, inputText: sourceText(doc) },
      title: doc.title,
      sourceDoc: doc,
      source: opts.source || { kind: 'import', fileName: parsed.fileName, intent: 'condense' },
    },
    figures: parsed.images,
  };
}

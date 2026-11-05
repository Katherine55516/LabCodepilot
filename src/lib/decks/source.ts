/**
 * Structured source documents for long inputs (PDF papers, reports, long
 * Markdown). Parsers turn a file into reading-order `SourceBlock`s; the
 * chunker (chunking.ts) groups them into semantic chunks the planner cites
 * and the writer is grounded on. Figures travel with their captions so media
 * placement can follow the text that discusses them.
 */

export type SourceBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; page?: number }
  | { kind: 'paragraph'; text: string; page?: number }
  | { kind: 'figure'; figureId: string; page?: number }
  | { kind: 'table'; label: string; caption: string; rows: string[][]; page?: number };

/** A figure found in the source: its caption, and the hosted image once the deck exists. */
export interface SourceFigure {
  id: string;
  /** "Figure 4" as printed. */
  label: string;
  number: number;
  caption: string;
  page?: number;
  width?: number;
  height?: number;
  mediaId?: string;
  /** The chunk whose text discusses this figure most (its semantic home). */
  chunkId?: string;
  /** What the picture is (media-relations.ts): decides how it may be cropped and how large it must be. */
  kind?: FigureKind;
  /** Figures that belong together (same series) may share a card as a gallery. */
  series?: string;
}

export type FigureKind = 'chart' | 'diagram' | 'screenshot' | 'photo' | 'illustration';

export type ChunkKind = 'front' | 'body' | 'appendix';

export interface SourceChunk {
  id: string;
  /** Heading path, outermost first ("3. Car Racing Experiment" › "3.2. Procedure"). */
  path: string[];
  title: string;
  kind: ChunkKind;
  text: string;
  chars: number;
  /** Figures whose semantic home is this chunk. */
  figureIds: string[];
  /** Figures this chunk mentions that live elsewhere. */
  refFigureIds: string[];
  /** Suggested number of cards for this chunk (the planner's soft guide). */
  cardBudget: number;
  pages?: [number, number];
}

/** What a deck keeps about its structured source (persisted on the deck). */
export interface DeckSourceDoc {
  kind: 'pdf' | 'markdown';
  fileName?: string;
  title: string;
  authors?: string;
  pages?: number;
  chunks: SourceChunk[];
  figures: SourceFigure[];
  /** Material left out on purpose, e.g. references, with its size. */
  dropped: { label: string; chars: number }[];
  warnings: string[];
}

/** Markdown / plain text → blocks: `#` headings (levels 1–3), blank-line paragraphs, `|` tables. */
export function blocksFromMarkdown(text: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let table: string[][] = [];
  const flushPara = () => { if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ').replace(/\s+/g, ' ').trim() }); para = []; };
  const flushTable = () => {
    const rows = table.filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
    if (rows.length) blocks.push({ kind: 'table', label: '', caption: '', rows });
    table = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara(); flushTable();
      blocks.push({ kind: 'heading', level: Math.min(3, heading[1].length) as 1 | 2 | 3, text: heading[2].trim() });
    } else if (/^\|.*\|$/.test(line)) {
      flushPara();
      table.push(line.slice(1, -1).split('|').map(c => c.trim()));
    } else if (!line || /^-{3,}$/.test(line)) {
      flushPara(); flushTable();
    } else {
      flushTable();
      if (/^([-*+•]|\d{1,3}[.)])\s+/.test(line)) flushPara();
      para.push(line);
    }
  }
  flushPara(); flushTable();
  return blocks;
}

/** Renders a table as compact pipe rows for prompts (keeps every number). */
export function tableText(label: string, caption: string, rows: string[][]): string {
  const head = [label, caption].filter(Boolean).join(': ');
  return [head, ...rows.map(r => `| ${r.join(' | ')} |`)].filter(Boolean).join('\n');
}

import JSZip from 'jszip';
import path from 'node:path';

/**
 * Text extraction from .pptx / .potx packages (server only). The package is
 * read as data: only parts inside the zip are opened, relationships with
 * TargetMode="External" are ignored, and every part is read with a size cap
 * so a zip bomb cannot exhaust memory.
 */

export interface ImportedCard { title: string; points: string[]; notes?: string }
export interface ImportLimits { maxSlides: number; maxPoints: number; maxPointChars: number }

export class ImportError extends Error {
  constructor(public status: number, message: string, public code = 'import_failed') { super(message); }
}

/** Decompressed size caps: one XML part, and everything read from one file. */
const MAX_PART_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 160 * 1024 * 1024;
/** Placeholders that hold slide furniture, not content. */
const SKIPPED_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body] ?? whole;
  });
}

const attr = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return match ? decodeXml(match[2] ?? match[3] ?? '') : undefined;
};

/** Reads one part as UTF-8, stopping (with an error) once it passes the caps. */
class PartReader {
  private total = 0;
  constructor(private zip: JSZip) {}
  has(name: string) { return Boolean(this.zip.file(name)); }
  async read(name: string): Promise<string | null> {
    const file = this.zip.file(name);
    if (!file || file.dir) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = file.nodeStream('nodebuffer');
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        this.total += chunk.length;
        if (size > MAX_PART_BYTES || this.total > MAX_TOTAL_BYTES) {
          stream.pause();
          stream.removeAllListeners('data');
          reject(new ImportError(413, 'The presentation expands to more data than can be imported.', 'import_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (error: Error) => reject(new ImportError(400, `The presentation could not be read (${error.message}).`, 'import_unreadable')));
      stream.on('end', () => resolve());
    });
    return Buffer.concat(chunks).toString('utf8');
  }
}

/** `{ Id → Target }` for internal relationships, with targets resolved to zip paths. */
function relationships(xml: string, baseDir: string): { id: string; type: string; target: string }[] {
  const out: { id: string; type: string; target: string }[] = [];
  for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    if ((attr(tag, 'TargetMode') || '').toLowerCase() === 'external') continue;
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (!id || !target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const resolved = target.startsWith('/') ? path.posix.normalize(target.slice(1)) : path.posix.normalize(path.posix.join(baseDir, target));
    if (resolved.startsWith('..')) continue;
    out.push({ id, type: attr(tag, 'Type') || '', target: resolved });
  }
  return out;
}

const relsPathFor = (part: string) => path.posix.join(path.posix.dirname(part), '_rels', `${path.posix.basename(part)}.rels`);

/** Concatenated `a:t` runs of each `a:p`; `a:br` becomes a space. */
function paragraphs(xml: string): string[] {
  const out: string[] = [];
  for (const [p] of xml.matchAll(/<a:p\b[^>]*?(?:\/>|>[\s\S]*?<\/a:p>)/g)) {
    let text = '';
    for (const run of p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/g)) text += run[1] !== undefined ? decodeXml(run[1]) : ' ';
    const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
    if (clean) out.push(clean);
  }
  return out;
}

interface Shape { placeholder?: string; isPlaceholder: boolean; paragraphs: string[] }

/** Text shapes in document order (group members included), plus tables as one point per row. */
function shapes(slideXml: string): Shape[] {
  const out: Shape[] = [];
  for (const [shape] of slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
    if (shape.startsWith('<p:graphicFrame')) {
      const rows = [...shape.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map(([row]) =>
        [...row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map(([cell]) => paragraphs(cell).join(' ')).join(' | ').trim(),
      ).filter(row => row.replace(/[\s|]/g, ''));
      if (rows.length) out.push({ isPlaceholder: false, paragraphs: rows });
      continue;
    }
    const ph = /<p:ph\b[^>]*>/.exec(shape)?.[0];
    const body = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(shape)?.[0] || '';
    out.push({ isPlaceholder: Boolean(ph), placeholder: ph ? attr(ph, 'type') || 'body' : undefined, paragraphs: paragraphs(body) });
  }
  return out;
}

function notesText(notesXml: string): string {
  return shapes(notesXml)
    .filter(shape => shape.isPlaceholder && !SKIPPED_PLACEHOLDERS.has(shape.placeholder || ''))
    .flatMap(shape => shape.paragraphs).join('\n').trim();
}

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export async function parsePptx(bytes: Buffer, limits: ImportLimits): Promise<{ title?: string; cards: ImportedCard[]; warnings: string[] }> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false }); } catch {
    throw new ImportError(400, 'This file is not a valid PowerPoint package.', 'import_unreadable');
  }
  const reader = new PartReader(zip);
  const presentation = await reader.read('ppt/presentation.xml');
  if (!presentation) throw new ImportError(400, 'This file is not a PowerPoint presentation (ppt/presentation.xml is missing).', 'import_unreadable');
  const rels = relationships(await reader.read('ppt/_rels/presentation.xml.rels') || '', 'ppt');
  const byId = new Map(rels.map(rel => [rel.id, rel.target]));
  const ids = [...(/<p:sldIdLst\b[\s\S]*?<\/p:sldIdLst>/.exec(presentation)?.[0] || '').matchAll(/<p:sldId\b[^>]*>/g)]
    .map(([tag]) => attr(tag, 'r:id')).filter((id): id is string => Boolean(id));
  const slidePaths = ids.map(id => byId.get(id)).filter((p): p is string => Boolean(p && reader.has(p)));

  const warnings: string[] = [];
  if (slidePaths.length > limits.maxSlides) warnings.push(`Only the first ${limits.maxSlides} of ${slidePaths.length} slides were imported.`);
  let empty = 0;
  let trimmedPoints = 0;
  const cards: ImportedCard[] = [];
  for (const slidePath of slidePaths.slice(0, limits.maxSlides)) {
    const xml = await reader.read(slidePath);
    if (!xml) continue;
    const content = shapes(xml).filter(shape => !SKIPPED_PLACEHOLDERS.has(shape.placeholder || '') && shape.paragraphs.length);
    const titleShape = content.find(shape => TITLE_PLACEHOLDERS.has(shape.placeholder || '')) || content[0];
    const title = titleShape ? cap(titleShape.paragraphs.join(' '), 200) : '';
    const allPoints = content.filter(shape => shape !== titleShape).flatMap(shape => shape.paragraphs);
    if (allPoints.length > limits.maxPoints) trimmedPoints++;
    const points = mergeValueLabels(allPoints).slice(0, limits.maxPoints).map(point => cap(point, limits.maxPointChars));
    const notesRel = relationships(await reader.read(relsPathFor(slidePath)) || '', path.posix.dirname(slidePath)).find(rel => rel.type.endsWith('/notesSlide'));
    const notesXml = notesRel ? await reader.read(notesRel.target) : null;
    const notes = notesXml ? notesText(notesXml) : '';
    if (!title && !points.length) { empty++; continue; }
    cards.push({ title: title || `Slide ${cards.length + empty + 1}`, points, ...(notes ? { notes: cap(notes, 5000) } : {}) });
  }
  if (empty) warnings.push(`${empty} slide${empty > 1 ? 's had' : ' had'} no text and ${empty > 1 ? 'were' : 'was'} skipped.`);
  if (trimmedPoints) warnings.push(`${trimmedPoints} slide${trimmedPoints > 1 ? 's had' : ' had'} more than ${limits.maxPoints} paragraphs; the rest were left out.`);
  const core = await reader.read('docProps/core.xml');
  const docTitle = core ? decodeXml(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1] || '').trim() : '';
  return { title: docTitle || undefined, cards, warnings };
}

/**
 * Key-number shapes export a value ("32%") and its label as separate
 * paragraphs. Join a bare value with the label that follows it, or drop it
 * when the label already contains the value.
 */
export function mergeValueLabels(points: string[]): string[] {
  const bare = /^[\s\d.,:%$€£¥+\-−x×~≈<>倍万亿千百kKmMbB/]{1,12}$/u;
  const out: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const value = points[i].trim();
    const next = points[i + 1]?.trim();
    if (bare.test(value) && /\d/.test(value) && next && !bare.test(next)) {
      out.push(next.includes(value) ? next : `${value} — ${next}`);
      i++;
    } else out.push(points[i]);
  }
  return out;
}

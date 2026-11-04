/** Template pictures read by the server's own OCR when the system has no
 * tesseract (Fable + user, 2026-11-02; plan
 * docs/exec-plans/active/ppt-template-media-slots-20261102.md, phase 2).
 * tesseract.js (WASM, eng + chi_sim best_int, bundled; never the CDN) reads the
 * downscaled copy the import attached. Each picture is read once by image hash
 * and cached on disk, so a template uploaded again costs no reads.
 *
 * Outcome (Fable): a letter word is ≥3 Latin letters at ≥85, or ≥2 CJK
 * characters at ≥75. A picture is uncertain, never certified, when words of
 * two or more letters in any script at ≥70 are 15% or more of its confident
 * words (≥60), or one word of four or more letters reads at ≥80 ("HP",
 * Arabic, "Revenue" at 84; the user's review, 2026-11-02): OCR not reading
 * text is no proof there is none. A busy painting's 70–110 noise words carry
 * a few chance two-letter strings ("of" at 75), which stay below the share.
 *  - text: a letter word and a second one, or a letter word in a picture of ≤10 words;
 *  - uncertain: one letter word among more than 10 words (brushstroke noise
 *    sits at 60–82, real text at 87+; the gap fails closed);
 *  - numbers_only: only 1–2 digit numbers (numbered artwork);
 *  - no_text: none of these.
 * The result keeps the fields the design view already reads (words, digitRun). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TIMEOUT_MS = 10000;
const STATE = path.join(process.env.COWORK_STATE_DIR || '/data/cowork-state', 'ppt', 'picture-reads');
const LATIN = /[A-Za-z]/gu, HAN = /\p{Script=Han}/gu;

/** L1 certificate (Fable, 2026-11-02): a text reader found no text (the
 * system tesseract or tesseract.js) and the pixels are continuous tone (a photo
 * or a painting, not a chart, UI or diagram). Pixels alone never certify. */
export function pictureCertificate(content) {
  const ocr = content?.ocr, pixels = content?.pixels;
  if (content?.href || !pixels?.continuousTone || ocr?.status !== 'ok') return null;
  // A lone digit in brushstrokes is noise: numbered artwork is flat, never continuous tone.
  const noText = ocr.outcome ? ['no_text', 'numbers_only'].includes(ocr.outcome) : !ocr.words && !ocr.digitRun && !ocr.lettered;
  return noText ? { level: 'L1', by: [ocr.engine || 'tesseract', 'pil'] } : null;
}
/** The outcome of one OCR result's words ([{text, confidence}]). */
export function pictureTextOutcome(words) {
  const clean = words.map(word => ({ text: String(word.text || '').trim(), confidence: Number(word.confidence) || 0 })).filter(word => word.text);
  const letterWord = word => (word.text.match(LATIN) || []).length >= 3 && word.confidence >= 85 || (word.text.match(HAN) || []).length >= 2 && word.confidence >= 75;
  const letters = clean.filter(letterWord), lettered = clean.filter(word => (word.text.match(/\p{L}/gu) || []).length >= 2 && word.confidence >= 70);
  const confident = clean.filter(word => word.confidence >= 60).length, strong = lettered.some(word => (word.text.match(/\p{L}/gu) || []).length >= 4 && word.confidence >= 80);
  const suspicious = strong || lettered.length > 0 && lettered.length >= Math.max(1, confident) * .15;
  const numbers = clean.filter(word => /^\d{1,2}$/u.test(word.text) && word.confidence >= 60);
  const outcome = letters.length >= 2 || letters.length === 1 && clean.length <= 10 ? 'text'
    : letters.length === 1 || suspicious ? 'uncertain' : numbers.length && !letters.length && clean.every(word => /^\d{1,2}$/u.test(word.text) || word.confidence < 60) ? 'numbers_only' : 'no_text';
  const top = [...clean].sort((a, b) => b.confidence - a.confidence).slice(0, 3).map(word => [word.text, Math.round(word.confidence)]);
  // Fields the design view reads: three words or a digit run mark old content.
  return { status: 'ok', engine: 'tesseract.js', outcome, wordCount: clean.length, top,
    words: outcome === 'text' || outcome === 'uncertain' ? Math.max(3, letters.length) : 0, digitRun: false, ...(outcome === 'numbers_only' ? { numbersOnly: true } : {}) };
}

let workerPromise = null;
function languageDir() {
  // tesseract.js wants every language file in one directory.
  const dir = path.join(STATE, 'lang');
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of ['eng', 'chi_sim']) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int', `${lang}.traineddata.gz`), target);
  }
  return dir;
}
async function worker() {
  if (!workerPromise) workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    return createWorker(['eng', 'chi_sim'], 1, { langPath: languageDir(), cachePath: path.join(STATE, 'cache'), gzip: true, workerBlobURL: false });
  })();
  return workerPromise;
}
export async function closePictureReader() {
  const pending = workerPromise; workerPromise = null;
  // A worker that never started (no state directory, a missing language file)
  // leaves nothing to stop; the reads already failed closed.
  if (pending) await pending.then(worker => worker.terminate(), () => {}).catch(() => {});
}
// The reading rule's version is part of the cache key: a cached outcome
// from an older rule is read again.
const READ_RULE = 3;
const cached = hash => { try { return JSON.parse(fs.readFileSync(path.join(STATE, `${hash}.r${READ_RULE}.json`), 'utf8')); } catch { return null; } };
const remember = (hash, value) => { try { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(path.join(STATE, `${hash}.r${READ_RULE}.json`), JSON.stringify(value)); } catch {} };

/** Read one picture (a data URL of the downscaled copy); cached by hash. */
export async function readPictureText(dataUrl, hash = crypto.createHash('sha256').update(String(dataUrl)).digest('hex'), { read = null } = {}) {
  const prior = cached(hash);
  if (prior) return { ...prior, cached: true };
  try {
    const recognise = read || (async image => {
      const result = await (await worker()).recognize(image, {}, { blocks: true });
      return (result.data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)));
    });
    const words = await Promise.race([recognise(Buffer.from(String(dataUrl).split(',')[1] || '', 'base64')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))]);
    const value = pictureTextOutcome(words);
    remember(hash, value);
    return value;
  } catch (error) {
    return { status: 'failed', engine: 'tesseract.js', reason: String(error?.message || error).slice(0, 80) };
  }
}

/** Fill in OCR for every imported picture the system tesseract could not read,
 * then drop the downscaled copies (they are not part of the template). Returns
 * how many pictures were read and how many came from the cache. */
export async function readTemplatePictures(project, options = {}) {
  const targets = [
    ...(project.deck?.slides || []).flatMap(slide => (slide.nodes || []).filter(node => node.type === 'image').map(node => ({ holder: node.content || {}, set: value => { node.content = { ...node.content, ...value }; } }))),
    ...(project.externalPptx?.inherited || []).filter(item => item.kind === 'image').map(item => ({ holder: item, set: value => Object.assign(item, value) })),
  ];
  let read = 0, fromCache = 0;
  try {
    for (const { holder, set } of targets) {
      const copy = holder.pixels?.ocrImage;
      if (!copy) continue;
      const pixels = { ...holder.pixels }; delete pixels.ocrImage;
      if (holder.ocr?.status === 'ok') { set({ pixels }); continue; }
      const ocr = await readPictureText(copy, holder.imageSha256 || undefined, options);
      if (ocr.cached) fromCache++; else if (ocr.status === 'ok') read++;
      const { cached: _, ...stored } = ocr;
      set({ ocr: stored, pixels });
    }
  } finally {
    if (!options.read) await closePictureReader();
  }
  return { read, fromCache };
}

/** The text size of source diagrams (the legibility floor beside points,
 * Fable 2026-11-02). Ingest attaches an OCR-only copy (a vector figure without
 * glyphs at 4×, or a raster diagram grown to ~2000 px); this reads it once by
 * figure hash and records the 10th-percentile word box height as a share of
 * the figure width (uncorrected: the low percentile is already the
 * conservative end). Fewer than 3 words read leaves no share, and the floor
 * falls back (scale ≥1.75 for a vector figure, 40% width for a raster). The
 * copies are dropped either way. */
const pngWidth = dataUrl => { try { const bytes = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'); return bytes.subarray(1, 4).toString() === 'PNG' ? bytes.readUInt32BE(16) : 0; } catch { return 0; } };
export function figureTextShare(words, width) {
  const heights = words.filter(word => Number(word.confidence) >= 70 && /[\p{L}\p{N}]{2,}/u.test(String(word.text || '')) && word.bbox)
    .map(word => word.bbox.y1 - word.bbox.y0).filter(height => height > 0).sort((a, b) => a - b);
  return { status: 'ok', words: heights.length, share: heights.length >= 3 && width > 0 ? Math.round(heights[Math.floor(heights.length / 10)] / width * 1e5) / 1e5 : null };
}
/** Hash prefixes of figures already read (ingest renders no OCR copy for them). */
export function knownFigureHashes(limit = 4000) {
  try { return fs.readdirSync(STATE).filter(name => /^figure-[0-9a-f]{16}.*\.r\d+\.json$/u.test(name) && name.endsWith(`.r${READ_RULE}.json`)).slice(-limit).map(name => name.slice(7, 23)); } catch { return []; }
}
export async function measureFigureText(images = [], { read = null } = {}) {
  const targets = images.filter(image => image.figureText?.source === 'pending');
  try {
    for (const image of targets) {
      const copy = image.ocrImage; delete image.ocrImage;
      const key = 'figure-' + (image.imageSha256 || crypto.createHash('sha256').update(String(copy)).digest('hex'));
      let value = cached(key);
      if (!value && copy) {
        try {
          const recognise = read || (async bytes => {
            const result = await (await worker()).recognize(bytes, {}, { blocks: true });
            return (result.data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)));
          });
          const words = await Promise.race([recognise(Buffer.from(String(copy).split(',')[1] || '', 'base64')), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))]);
          value = figureTextShare(words, pngWidth(copy));
          remember(key, value);
        } catch (error) { value = { status: 'failed', reason: String(error?.message || error).slice(0, 80) }; }
      }
      image.figureText = { ...image.figureText, ...(value?.status === 'ok' ? { source: value.share ? 'ocr' : 'ocr_unread', words: value.words, ...(value.share ? { share: value.share } : {}) } : { source: 'ocr_failed' }) };
    }
  } finally {
    if (!read && targets.length) await closePictureReader();
  }
  for (const image of images) delete image.ocrImage;
  return images;
}

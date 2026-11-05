import { createDeck, EngineError } from '@/lib/decks/engine';
import { respond } from '@/lib/decks/http';
import { IMPORT_INTENTS, ImportError, MAX_IMPORT_BYTES, importRequest, parsePresentation } from '@/lib/decks/import';
import { updateDeck } from '@/lib/decks/store';
import type { ImportIntent } from '@/lib/decks/types';
import { parseSourceFile, SourceImportError, sourceDeckRequest } from '@/lib/decks/source-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOO_LARGE = 'The file is larger than 50 MB.';

/** Reads the raw body, stopping as soon as it passes the size cap. */
async function readBody(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES) throw new EngineError(413, TOO_LARGE, 'import_too_large');
  if (!request.body) throw new EngineError(400, 'Send the file as the request body.', 'import_empty');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMPORT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new EngineError(413, TOO_LARGE, 'import_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * POST /api/decks/import?fileName=…&intent=asIs|restyle|condense&themeId=…&mode=plan|express
 * Body: the raw file bytes (.pptx, .potx, .md, .txt, .pdf; ≤ 50 MB) → 201 { deck, job }. A PDF is read as a long source (chunked, figures kept).
 */
export async function POST(request: Request) {
  return respond(async () => {
    const params = new URL(request.url).searchParams;
    const fileName = (params.get('fileName') || '').replace(/^.*[\\/]/, '').trim().slice(0, 255);
    if (!fileName) throw new EngineError(400, 'The fileName query parameter is required.', 'import_no_name');
    const intentParam = params.get('intent') || 'asIs';
    if (!(IMPORT_INTENTS as readonly string[]).includes(intentParam)) throw new EngineError(400, 'intent must be asIs, restyle or condense.', 'import_bad_intent');
    const intent = intentParam as ImportIntent;
    const mode = params.get('mode') === 'express' ? 'express' : 'plan';
    const themeId = params.get('themeId') || undefined;

    const bytes = await readBody(request);
    // Long sources (PDF, report 06 §5): chunked, grounded, figures placed by the media planner.
    if (/\.pdf$/i.test(fileName)) {
      let source;
      try { source = await parseSourceFile(bytes, fileName); } catch (error) {
        if (error instanceof SourceImportError) throw new EngineError(error.status, error.message, error.code);
        throw error;
      }
      const { request: create, figures } = sourceDeckRequest(source, { settings: { mode, ...(themeId ? { themeId } : {}) } });
      return createDeck(create, { attachments: { figures } });
    }
    let parsed;
    try { parsed = await parsePresentation(bytes, fileName); } catch (error) {
      if (error instanceof ImportError) throw new EngineError(error.status, error.message, error.code);
      throw error;
    }
    const result = await createDeck(importRequest(parsed, { fileName, intent, themeId, mode }));
    if (!parsed.warnings.length) return result;
    // Keep what the parser left out visible on the deck (updates merge onto the latest state).
    const deck = updateDeck(result.deck.id, d => { d.warnings.push(...parsed.warnings.map(message => ({ code: 'import_notice', message }))); });
    return { deck, job: result.job };
  }, 201);
}

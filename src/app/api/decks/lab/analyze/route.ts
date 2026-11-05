import { readBody } from '@/lib/decks/body';
import { EngineError } from '@/lib/decks/engine';
import { respond } from '@/lib/decks/http';
import { analyzeSource, analyzeTemplate } from '@/lib/decks/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/decks/lab/analyze?kind=source|template&fileName=…&targetCards=…
 * Body: raw file bytes (source: .pdf/.md/.txt; template: .pptx/.potx; ≤ 50 MB) → the parse, chunking and media analysis.
 */
export async function POST(request: Request) {
  return respond(async () => {
    const params = new URL(request.url).searchParams;
    const fileName = (params.get('fileName') || '').replace(/^.*[\\/]/, '').trim().slice(0, 255);
    if (!fileName) throw new EngineError(400, 'The fileName query parameter is required.');
    const bytes = await readBody(request, 50 * 1024 * 1024, 'The file is larger than 50 MB.');
    if (params.get('kind') === 'template') return analyzeTemplate(bytes, fileName);
    const target = Number(params.get('targetCards'));
    return analyzeSource(bytes, fileName, Number.isFinite(target) && target > 0 ? target : undefined);
  });
}

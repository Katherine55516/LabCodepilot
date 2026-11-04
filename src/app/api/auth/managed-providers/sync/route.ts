import { NextRequest, NextResponse } from 'next/server';
import { setManagedProviders, type ManagedProviderRow } from '@/lib/db';

/**
 * POST /api/auth/managed-providers/sync
 *
 * Called by the Electron main process AFTER it has fetched the latest
 * ModelConfig[] from the managed-account backend and converted it via
 * electron/auth/managed-providers.ts:modelConfigToManagedProviderRow.
 *
 * Body:
 *   { rows: ManagedProviderRow[] }
 *
 * Response:
 *   { ok: true, upserted: number, pruned: number }
 *
 * Idempotent: re-calling with the same rows is a no-op. Local (BYOK)
 * providers are never touched.
 *
 * Auth: the Next.js server only binds 127.0.0.1, so only the main process
 * and the renderer can hit this. No additional check needed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { rows?: ManagedProviderRow[] };
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!rows) {
      return NextResponse.json({ error: 'Body must include rows: ManagedProviderRow[]' }, { status: 400 });
    }
    // Light validation — ensure each row has the lookup keys we rely on
    for (const r of rows) {
      if (!r.id || !r.managed_config_id) {
        return NextResponse.json(
          { error: 'Each row must have id and managed_config_id' },
          { status: 400 },
        );
      }
    }
    const result = setManagedProviders(rows);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sync failed' },
      { status: 500 },
    );
  }
}

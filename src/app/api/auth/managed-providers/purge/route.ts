import { NextResponse } from 'next/server';
import { purgeManagedProviders } from '@/lib/db';

/**
 * POST /api/auth/managed-providers/purge
 *
 * Called by the Electron main process during logout to delete every row
 * with source='managed'. Local BYOK rows are preserved.
 *
 * Response: { ok: true, removed: number }
 */
export async function POST(): Promise<NextResponse> {
  try {
    const removed = purgeManagedProviders();
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'purge failed' },
      { status: 500 },
    );
  }
}

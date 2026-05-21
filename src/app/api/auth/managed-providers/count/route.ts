import { NextResponse } from 'next/server';
import { getProvidersBySource } from '@/lib/db';

/**
 * GET /api/auth/managed-providers/count
 *
 * Cheap way for the main process to surface managedConfigCount in the
 * AuthSnapshot it pushes to the renderer, without main holding its own
 * mirror of the DB.
 */
export function GET(): NextResponse {
  try {
    const rows = getProvidersBySource('managed');
    return NextResponse.json({ count: rows.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'count failed' },
      { status: 500 },
    );
  }
}

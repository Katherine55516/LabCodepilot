import { NextResponse } from 'next/server';

/**
 * POST /api/claude-status/invalidate
 *
 * Since v0.55, Claude Code ships bundled with the installer — there is no
 * binary-path cache to invalidate. This endpoint is kept as a no-op for
 * backwards compatibility with existing UI flows (install wizard, upgrade
 * action) that still call it. It can be removed once those flows are
 * rewritten to drop the call.
 */
export async function POST() {
  return NextResponse.json({ ok: true, deprecated: true });
}

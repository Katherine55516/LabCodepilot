import { NextResponse } from 'next/server';

/**
 * POST /api/claude-upgrade
 *
 * Since v0.55, Claude Code is bundled inside the application installer via
 * the @anthropic-ai/claude-agent-sdk-<platform>-<arch> subpackage. There is
 * no "upgrade the user's local CLI" action anymore — the only way to get a
 * newer Claude Code is to upgrade AI Native Lab itself (which pulls a newer SDK).
 *
 * This endpoint is kept as a no-op stub for backwards compatibility with the
 * existing UI; it returns success=false with a clear message so the UI can
 * fall back to a friendly "use App updater" hint. Remove once all callers
 * (ConnectionStatus, CliSettingsSection) drop the call.
 */
export async function POST() {
  return NextResponse.json({
    success: false,
    deprecated: true,
    message:
      'Claude Code is now bundled inside the application. To get a newer ' +
      'version, update AI Native Lab itself via the in-app updater.',
  });
}

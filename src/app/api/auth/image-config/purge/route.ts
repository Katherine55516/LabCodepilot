import { NextResponse } from 'next/server';
import { clearBailianImageConfig } from '@/lib/bailian-image-config';

/**
 * POST /api/auth/image-config/purge
 *
 * Called by the Electron main process during logout / 401 to clear the
 * delivered Bailian image config. After purge the apiKey is empty → the image
 * studio surfaces the "请登录" degraded state.
 *
 * Response: { ok: true }
 */
export async function POST(): Promise<NextResponse> {
  try {
    clearBailianImageConfig();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'image-config purge failed' },
      { status: 500 },
    );
  }
}

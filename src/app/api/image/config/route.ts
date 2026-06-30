import { NextResponse } from 'next/server';
import { getBailianImageConfig } from '@/lib/bailian-image-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/image/config
 *
 * Read-only config for the Image Studio model switcher. Returns the selectable
 * model list + default model + a `configured` flag.
 *
 * SECURITY: deliberately omits apiKey / workspaceId / region — the credential
 * never reaches the renderer. Only model metadata is exposed.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getBailianImageConfig();
    const models =
      Array.isArray(cfg.models) && cfg.models.length > 0
        ? cfg.models
        : cfg.model
          ? [{ id: cfg.model, label: cfg.model, default: true }]
          : [];
    return NextResponse.json({
      model: cfg.model || (models[0]?.id ?? ''),
      models,
      // 是否已下发可用凭证；前端据此显示「请登录」降级态。
      configured: !!cfg.apiKey,
    });
  } catch (err) {
    return NextResponse.json(
      { model: '', models: [], configured: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

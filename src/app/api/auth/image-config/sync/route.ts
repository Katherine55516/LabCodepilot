import { NextRequest, NextResponse } from 'next/server';
import { setBailianImageConfig, type BailianImageConfig } from '@/lib/bailian-image-config';

/**
 * POST /api/auth/image-config/sync
 *
 * Called by the Electron main process AFTER it has fetched the global Bailian
 * image config from the managed-account backend (electron/auth/client.ts:
 * fetchImageConfig) and decrypted the apiKey.
 *
 * Body:
 *   { config: BailianImageConfig }   // { apiKey, workspaceId, model, region, models }
 *
 * Writes the `bailian_image_config` settings row (SENSITIVE → AES-256-GCM
 * sealed at rest). The image model lives ONLY here — it is never written to the
 * api_providers table, so it cannot leak into the chat model dropdown.
 *
 * Auth: the Next.js server only binds 127.0.0.1, so only the main process and
 * the renderer can hit this. No additional check needed (same as
 * /api/auth/managed-providers/sync).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { config?: Partial<BailianImageConfig> };
    const config = body?.config;
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'Body must include config: BailianImageConfig' }, { status: 400 });
    }
    setBailianImageConfig({
      apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
      workspaceId: typeof config.workspaceId === 'string' ? config.workspaceId : '',
      model: typeof config.model === 'string' ? config.model : '',
      region: typeof config.region === 'string' ? config.region : '',
      models: Array.isArray(config.models) ? config.models : [],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'image-config sync failed' },
      { status: 500 },
    );
  }
}

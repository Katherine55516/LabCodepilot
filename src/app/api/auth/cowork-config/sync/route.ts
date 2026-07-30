import { NextRequest, NextResponse } from 'next/server';
import { setCoworkRemoteConfig } from '@/lib/cowork-remote-config';

/**
 * POST /api/auth/cowork-config/sync(R5-5 账号下发)
 *
 * Electron 主进程从账号后端拉到当前用户的 cowork 配置并解密 token 后
 * (electron/auth/client.ts fetchCoworkConfig)推到这里落库:
 * cowork_remote_url + cowork_remote_token(SENSITIVE → 密封)+ cowork_backend='remote'。
 *
 * Body: { config: { serverUrl: string, token: string } }
 *
 * Auth: Next 服务只绑 127.0.0.1,同 /api/auth/image-config/sync 的信任模型。
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { config?: { serverUrl?: string; token?: string } };
    const config = body?.config;
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'Body must include config: { serverUrl, token }' }, { status: 400 });
    }
    try {
      setCoworkRemoteConfig({ serverUrl: config.serverUrl ?? '', token: config.token ?? '' });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid config' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'cowork-config sync failed' },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';
import { clearCoworkRemoteConfig } from '@/lib/cowork-remote-config';

/**
 * POST /api/auth/cowork-config/purge(R5-5)
 *
 * Electron 主进程在登出 / 401 时调用,三键置空 → cowork_backend '' 回落默认,
 * 办公模式按 cowork_status gate 诚实降级(RD5)。
 * 注意:404「未开通/后端未上线」不会走到这里(主进程侧跳过),dev 手写三键的
 * 联调后门不受登录轮询打扰。
 */
export async function POST(): Promise<NextResponse> {
  try {
    clearCoworkRemoteConfig();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'cowork-config purge failed' },
      { status: 500 },
    );
  }
}

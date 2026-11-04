import { NextRequest, NextResponse } from 'next/server';
import { setSetting } from '@/lib/db';

/**
 * POST /api/auth/current-user/sync —— 主进程把当前登录账号的 uid 推给嵌入式服务。
 *
 * 办公会话的账号隔离依赖它:落库到 settings.current_user_uid 后,
 * db.ts 的 getVisibleSessions / isSessionVisibleToCurrentUser / searchMessages
 * 都按这个值过滤(见那里的注释)。
 *
 * 登出、401 purge 时传空串清除。**清空后办公会话对任何人都不可见** —— 这是有意的:
 * 未登录状态下不该看到任何账号维度的数据。研发会话不受影响(不参与账号隔离)。
 *
 * Body: { uid: string }
 * Auth: 嵌入式 Next 服务只绑 127.0.0.1,信任模型同 /api/auth/cowork-config/sync。
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { uid?: unknown };
    // 非字符串一律当"清空"处理,避免把 undefined/null 写成字面量污染过滤条件
    const uid = typeof body?.uid === 'string' ? body.uid.trim() : '';
    setSetting('current_user_uid', uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'current-user sync failed' },
      { status: 500 },
    );
  }
}

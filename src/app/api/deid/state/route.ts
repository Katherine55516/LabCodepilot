import { NextRequest } from 'next/server';
import { getSession, getSessionDeidState, isSessionVisibleToCurrentUser, updateSessionDeidEnabled } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 会话级脱敏状态。GET 供 ChatView 载入(开关态 + 渲染层还原用的 mapping);
 * PUT 持久化开关翻转。mapping/denyValues 的写入只发生在 /api/deid/text
 * 成功之后(契约 §2 原子覆盖),本路由不提供字典写入口。
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('session_id') || '';
    const session = getSession(sessionId);
    // 账号隔离:与 sessions 路由同语义,别人的会话按不存在处理(防枚举)
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    const state = getSessionDeidState(sessionId);
    return Response.json({
      enabled: !!(session.sandbox_enabled && session.deid_enabled),
      mapping: state.mapping,
      denyValues: state.denyValues,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get deid state';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { session_id?: string; enabled?: boolean };
    const sessionId = body.session_id || '';
    const session = getSession(sessionId);
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    // 脱敏是办公(沙箱)会话专属能力 — 研发会话无入口,直接拒绝防蹊跷调用
    if (!session.sandbox_enabled) {
      return Response.json({ error: 'deid is only available for office (sandbox) sessions', code: 'DEID_OFFICE_ONLY' }, { status: 400 });
    }
    if (typeof body.enabled !== 'boolean') {
      return Response.json({ error: 'enabled (boolean) is required' }, { status: 400 });
    }
    updateSessionDeidEnabled(sessionId, body.enabled);
    return Response.json({ success: true, enabled: body.enabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update deid state';
    return Response.json({ error: message }, { status: 500 });
  }
}

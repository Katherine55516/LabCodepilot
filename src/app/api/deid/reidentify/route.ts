import { NextRequest } from 'next/server';
import { getSession, getSessionDeidState, isSessionVisibleToCurrentUser } from '@/lib/db';
import { DeidServiceError, reidentifyText } from '@/lib/deid-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 占位符还原代理。展示层还原走客户端本地替换(决策 D5),本路由的主要
 * 用途是回合完成后的 unknownPlaceholders 检测(模型自造/改写占位符告警)。
 * mapping 为空时短路返回 —— 否则上游会把文本里所有 <...> 形状全部报 unknown。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { session_id?: string; text?: string };
    const sessionId = body.session_id || '';
    const text = typeof body.text === 'string' ? body.text : '';

    const session = getSession(sessionId);
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    if (!text) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    const { mapping } = getSessionDeidState(sessionId);
    if (Object.keys(mapping).length === 0) {
      return Response.json({ restored: text, replaced: [], unknownPlaceholders: [] });
    }

    const result = await reidentifyText(text, mapping);
    return Response.json(result);
  } catch (error) {
    if (error instanceof DeidServiceError) {
      return Response.json({ error: error.message, code: 'DEID_UPSTREAM' }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'reidentify failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

import { NextRequest } from 'next/server';
import { getLatestAssistantContextUsage, getSession, isSessionVisibleToCurrentUser } from '@/lib/db';

/**
 * FIX(权威分子·交付链): 回合结束后前端轮询本端点，把探针后补进 DB 的
 * context_used_tokens 接进当前页面的内存消息（context-usage-accuracy-overhaul
 * Phase 1B）。纯 DB 读、无副作用；`context: null` 表示该会话还没有任何
 * assistant usage 记录。字段是否"命中"（context_used_tokens 出现且 match
 * 本回合 input/output）由前端判断。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    // 账号隔离:与消息列表同一把锁(token_usage 虽非正文,也不越权可见)。
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ context: getLatestAssistantContextUsage(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch context usage';
    return Response.json({ error: message }, { status: 500 });
  }
}

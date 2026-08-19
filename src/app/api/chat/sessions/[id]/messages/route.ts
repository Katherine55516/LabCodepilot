import { NextRequest } from 'next/server';
import { getMessages, getSession, isSessionVisibleToCurrentUser } from '@/lib/db';
import type { MessagesResponse } from '@/types';

/** Strip base64 `data` fields from <!--files:...--> HTML comments in message content */
function stripFileData(content: string): string {
  const match = content.match(/^<!--files:(.*?)-->/);
  if (!match) return content;
  try {
    const files = JSON.parse(match[1]);
    const cleaned = files.map((f: Record<string, unknown>) => {
      const { data, ...rest } = f;
      return rest;
    });
    return `<!--files:${JSON.stringify(cleaned)}-->${content.slice(match[0].length)}`;
  } catch {
    return content;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    // 账号隔离:消息是泄漏面最大的入口(对话正文全在这儿),必须与列表同一把锁。
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get('limit');
    const beforeParam = searchParams.get('before');
    const afterParam = searchParams.get('after');
    const aroundParam = searchParams.get('around');

    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 30, 1), 500) : 30;
    const beforeRowId = beforeParam ? parseInt(beforeParam, 10) || undefined : undefined;
    const afterRowId = afterParam ? parseInt(afterParam, 10) || undefined : undefined;

    const { messages, hasMore, hasMoreAfter } = getMessages(id, {
      limit,
      beforeRowId,
      afterRowId,
      aroundMessageId: aroundParam || undefined,
      excludeHeartbeatAck: true,
    });
    // Sanitize: strip base64 data from file attachments in old messages
    const sanitizedMessages = messages.map(m => ({
      ...m,
      content: stripFileData(m.content),
    }));
    const response: MessagesResponse = { messages: sanitizedMessages, hasMore, hasMoreAfter };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch messages';
    return Response.json({ error: message }, { status: 500 });
  }
}

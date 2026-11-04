import { NextRequest } from 'next/server';
import { getSession, getSessionDeidState, isSessionVisibleToCurrentUser, setSessionDeidState } from '@/lib/db';
import { DeidServiceError, deidentifyText } from '@/lib/deid-client';
import type { DeidDenyValue } from '@/types/deid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 契约 maxTextChars(超限直接 400,不打上游)
const MAX_TEXT_CHARS = 100_000;

function sanitizeDenyValues(input: unknown): DeidDenyValue[] | null {
  if (input === undefined) return null; // 未携带 = 沿用会话已存词表
  if (!Array.isArray(input)) return [];
  return input
    .filter((d): d is DeidDenyValue => !!d && typeof d === 'object' && typeof (d as DeidDenyValue).text === 'string' && !!(d as DeidDenyValue).text.trim())
    .map((d) => {
      const entityType = typeof d.entity_type === 'string' ? d.entity_type.trim().toUpperCase() : '';
      return {
        text: d.text,
        ...(entityType && /^[A-Z0-9_]+$/.test(entityType) ? { entity_type: entityType } : {}),
      };
    });
}

/**
 * 文本脱敏预览代理。服务端读会话字典 → 调 deid-service → 成功后原子覆盖
 * mapping(+denyValues)(契约 §2/§9)→ 返回完整响应给预览弹窗。
 * 串行性由预览弹窗(一次一条)保证;失败不落任何状态(fail-closed,D8)。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { session_id?: string; text?: string; denyValues?: unknown };
    const sessionId = body.session_id || '';
    const text = typeof body.text === 'string' ? body.text : '';

    const session = getSession(sessionId);
    // 账号隔离:与 sessions 路由同语义(防枚举)
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    // 双 gate:办公会话 + 开关已开。防绕过 UI 的散调用产生意外外发字典污染。
    if (!session.sandbox_enabled || !session.deid_enabled) {
      return Response.json({ error: 'deid is not enabled for this session', code: 'DEID_NOT_ENABLED' }, { status: 400 });
    }
    if (!text) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }
    if (text.length > MAX_TEXT_CHARS) {
      return Response.json({ error: `text exceeds ${MAX_TEXT_CHARS} chars` }, { status: 400 });
    }

    const state = getSessionDeidState(sessionId);
    const incomingDeny = sanitizeDenyValues(body.denyValues);
    const denyValues = incomingDeny ?? state.denyValues;

    const result = await deidentifyText(text, state.mapping, denyValues);

    // 成功才落状态:新 mapping 原子覆盖 + 本次生效的词表一并持久(后续每轮携带)
    setSessionDeidState(sessionId, { mapping: result.mapping || {}, denyValues });

    return Response.json(result);
  } catch (error) {
    if (error instanceof DeidServiceError) {
      // 400=字段错误 / 401=凭据 / 502=服务不可用(含网络失败),renderer 按契约 §11 提示
      return Response.json({ error: error.message, code: 'DEID_UPSTREAM' }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'deidentify failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

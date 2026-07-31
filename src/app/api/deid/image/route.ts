import { NextRequest } from 'next/server';
import { getSession, getSessionDeidState, isSessionVisibleToCurrentUser, setSessionDeidState } from '@/lib/db';
import { DeidServiceError, deidentifyImage } from '@/lib/deid-client';
import type { DeidDenyValue } from '@/types/deid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 裸 base64 上限 ~14MB(≈10.5MB 原图)。超限直接 400,不打上游 —— 上游
// 网关对 body 也有限制,本地拦截能给出可行动的提示而非一个 502。
const MAX_IMAGE_BASE64 = 14 * 1024 * 1024;

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
 * 图片脱敏预览代理(契约 §7)。与 /api/deid/text 同构:读会话字典 →
 * 调 deid-service → 成功后原子覆盖 mapping(+denyValues)。
 *
 * 串行性:图文混合时由 gate 先文本后图片、逐张 await 保证(契约 §8),
 * 服务端这里每次都重新读取会话字典,故串行调用天然拿到上一步的新 mapping。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      session_id?: string;
      imageBase64?: string;
      mode?: string;
      denyValues?: unknown;
    };
    const sessionId = body.session_id || '';
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
    const mode = body.mode === 'fill' ? 'fill' : 'placeholder';

    const session = getSession(sessionId);
    // 账号隔离:与 sessions 路由同语义(防枚举)
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    // 双 gate:办公会话 + 开关已开
    if (!session.sandbox_enabled || !session.deid_enabled) {
      return Response.json({ error: 'deid is not enabled for this session', code: 'DEID_NOT_ENABLED' }, { status: 400 });
    }
    if (!imageBase64) {
      return Response.json({ error: 'imageBase64 is required' }, { status: 400 });
    }
    if (imageBase64.length > MAX_IMAGE_BASE64) {
      return Response.json({ error: 'image too large', code: 'DEID_IMAGE_TOO_LARGE' }, { status: 400 });
    }

    const state = getSessionDeidState(sessionId);
    const incomingDeny = sanitizeDenyValues(body.denyValues);
    const denyValues = incomingDeny ?? state.denyValues;

    const result = await deidentifyImage(imageBase64, state.mapping, denyValues, mode);

    // 成功才落状态:新 mapping 原子覆盖(含图片新分配的占位符,下一轮文本可复用)
    setSessionDeidState(sessionId, { mapping: result.mapping || {}, denyValues });

    return Response.json(result);
  } catch (error) {
    if (error instanceof DeidServiceError) {
      return Response.json({ error: error.message, code: 'DEID_UPSTREAM' }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'deidentify image failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

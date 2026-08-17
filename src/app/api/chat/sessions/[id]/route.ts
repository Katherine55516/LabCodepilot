import { NextRequest } from 'next/server';
import { deleteSession, getSession, isSessionVisibleToCurrentUser, updateSessionWorkingDirectory, updateSessionTitle, updateSessionMode, updateSessionModel, updateSessionProviderId, clearSessionMessages, updateSdkSessionId, updateSessionPermissionProfile, updateSessionEffort } from '@/lib/db';
import { autoApprovePendingForSession } from '@/lib/bridge/permission-broker';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    // 账号隔离:别人的办公会话一律按"不存在"处理(而非 403),与 cowork-server
    // 跨 uid 访问返回 404 的防枚举语义保持一致 —— 知道 id 也问不出这个会话存在。
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    // 账号隔离:别人的办公会话一律按"不存在"处理(而非 403),与 cowork-server
    // 跨 uid 访问返回 404 的防枚举语义保持一致 —— 知道 id 也问不出这个会话存在。
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const body = await request.json();

    if (body.working_directory) {
      updateSessionWorkingDirectory(id, body.working_directory);
    }
    if (body.title) {
      updateSessionTitle(id, body.title);
    }
    if (body.mode) {
      updateSessionMode(id, body.mode);
    }
    // Track whether provider or model actually changed — if so, the old
    // sdk_session_id is stale and must be cleared to prevent resume failures
    // against a different provider/model (fixes #343, #346).
    const modelChanged = body.model !== undefined && body.model !== session.model;
    const providerChanged = body.provider_id !== undefined && body.provider_id !== session.provider_id;

    if (body.model !== undefined) {
      updateSessionModel(id, body.model);
    }
    if (body.provider_id !== undefined) {
      updateSessionProviderId(id, body.provider_id);
    }
    if (body.sdk_session_id !== undefined) {
      updateSdkSessionId(id, body.sdk_session_id);
    }

    // Server-side guard: when provider or model changed and the caller didn't
    // explicitly set sdk_session_id in the same request, force-clear it so the
    // next chat message starts a fresh SDK session instead of trying to resume
    // the old one (which would fail with a different provider/model).
    if ((modelChanged || providerChanged) && body.sdk_session_id === undefined) {
      if (session.sdk_session_id) {
        // 记录新旧模型串:2026-08-17 排查"上下文用量骤降"时,这里只有
        // modelChanged=true 没有具体值,取证只能靠反推。误清会话的根因是
        // MessageInput 在模型列表竞态窗口的误纠偏(已修,见
        // useProviderModels.modelListAuthoritative);若此日志再现且
        // oldModel/newModel 看起来"没换过模型",优先怀疑同类竞态。
        console.log(
          `[session-api] Provider/model changed for session ${id}, clearing stale sdk_session_id`,
          {
            modelChanged, providerChanged,
            oldModel: session.model, newModel: body.model,
            oldProviderId: session.provider_id, newProviderId: body.provider_id,
            oldSdkSessionId: session.sdk_session_id.slice(0, 8) + '...',
          }
        );
      }
      updateSdkSessionId(id, '');
    }
    if (body.effort !== undefined) {
      // Effort is a per-request reasoning hint, independent of provider/model —
      // persist it without touching sdk_session_id.
      updateSessionEffort(id, body.effort);
    }
    if (body.permission_profile !== undefined) {
      if (body.permission_profile !== 'default' && body.permission_profile !== 'full_access') {
        return Response.json({ error: 'permission_profile must be "default" or "full_access"' }, { status: 400 });
      }
      // When switching to full_access, auto-approve any pending bridge permissions
      const previousProfile = session.permission_profile || 'default';
      updateSessionPermissionProfile(id, body.permission_profile);
      if (previousProfile !== 'full_access' && body.permission_profile === 'full_access') {
        try {
          autoApprovePendingForSession(id);
        } catch (err) {
          console.warn('[session-api] Failed to auto-approve pending permissions:', err);
        }
      }
    }
    if (body.sandbox_enabled !== undefined) {
      // E5 (cowork): 模式在创建期定死 —— 侧边栏「办公/研发」双栏是唯一入口,
      // 旧 SandboxToggle 已移除。已建会话翻转 sandbox_enabled 会造成列表归类、
      // 宿主暂存目录与 VM 工作区三方错位,一律拒绝。
      return Response.json(
        { error: 'sandbox_enabled is immutable after creation — set it when creating the session', code: 'SANDBOX_MODE_IMMUTABLE' },
        { status: 400 },
      );
    }
    if (body.clear_messages) {
      clearSessionMessages(id);
    }

    const updated = getSession(id);
    return Response.json({ session: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    // 账号隔离:别人的办公会话一律按"不存在"处理(而非 403),与 cowork-server
    // 跨 uid 访问返回 404 的防枚举语义保持一致 —— 知道 id 也问不出这个会话存在。
    if (!isSessionVisibleToCurrentUser(session)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Cowork: best-effort clean the VM session directory before dropping the
    // row. Only for sandbox sessions and never blocks/deny the delete.
    if (session.sandbox_enabled) {
      try {
        const { removeSessionDir } = await import('@/lib/cowork-transfer');
        await removeSessionDir(id);
      } catch (err) {
        console.warn('[session-api] cowork removeSessionDir failed (non-fatal):', err);
      }
      // E2: also drop the host staging dir (~/.codepilot/cowork/<id>). The
      // path is derived ONLY from the session id — never from
      // working_directory — so legacy sandbox sessions bound to a real
      // project folder are untouched (their staging path doesn't exist →
      // rmSync force is a no-op).
      try {
        const { removeOfficeStagingDir } = await import('@/lib/cowork-staging');
        removeOfficeStagingDir(id);
      } catch (err) {
        console.warn('[session-api] cowork removeOfficeStagingDir failed (non-fatal):', err);
      }
      // P3-B/R3: 废止会话的一次性凭证 token(沙箱若曾被攻陷拿到 token,从此失效)。
      // 走当前 backend:vfkit=宿主代理 revokeSession;remote=通知 cowork-server 废止
      // (服务端在 DELETE session 时也会联动废止,这里是显式双保险)。
      try {
        const { getCoworkBackend } = await import('@/lib/cowork-backend');
        (await getCoworkBackend()).revokeCredentials(id);
      } catch (err) {
        console.warn('[session-api] cowork revokeCredentials failed (non-fatal):', err);
      }
    }

    deleteSession(id);
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete session';
    return Response.json({ error: message }, { status: 500 });
  }
}

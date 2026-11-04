import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getVisibleSessions, createSession, getSession, updateSessionWorkingDirectory } from '@/lib/db';
import type { CreateSessionRequest, SessionsResponse, SessionResponse } from '@/types';

export async function GET() {
  try {
    // 账号隔离:办公会话只返回属于当前登录账号的(研发会话不受影响)。
    // 用 getVisibleSessions 而非 getAllSessions —— 后者保留给导入去重等内部逻辑。
    const sessions = getVisibleSessions();
    const response: SessionsResponse = { sessions };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSessionRequest = await request.json();
    const wantsSandbox = !!body.sandbox_enabled;

    // E2 (cowork office): a sandbox session created WITHOUT a working
    // directory gets a synthetic host staging dir ~/.codepilot/cowork/<id>
    // instead of a user project folder. Plenty of code assumes a valid host
    // cwd (attachment staging under <wd>/.codepilot-uploads/, resume
    // pre-checks, resolveWorkingDirectory) — a real app-data dir keeps those
    // invariants intact. The dir is bound after createSession because the
    // session id is generated inside it. Sandbox sessions default to
    // full_access: the VM is the permission story (plan D2/D3).
    if (wantsSandbox && !body.working_directory) {
      const created = createSession(
        body.title,
        body.model,
        body.system_prompt,
        '', // bound to the staging dir right below
        body.mode,
        body.provider_id,
        body.permission_profile || 'full_access',
        body.effort,
        true,
      );
      const { ensureOfficeStagingDir } = await import('@/lib/cowork-staging');
      const staging = ensureOfficeStagingDir(created.id);
      // Syncs working_directory + sdk_cwd + project_name (sdk_session_id
      // clear inside is a no-op on a fresh session).
      updateSessionWorkingDirectory(created.id, staging);
      const response: SessionResponse = { session: getSession(created.id)! };
      return Response.json(response, { status: 201 });
    }

    // Validate working_directory is provided
    if (!body.working_directory) {
      return Response.json(
        { error: 'Working directory is required', code: 'MISSING_DIRECTORY' },
        { status: 400 },
      );
    }

    // Validate directory actually exists on disk
    try {
      await fs.access(body.working_directory);
    } catch {
      return Response.json(
        { error: 'Directory does not exist', code: 'INVALID_DIRECTORY' },
        { status: 400 },
      );
    }

    const session = createSession(
      body.title,
      body.model,
      body.system_prompt,
      body.working_directory,
      body.mode,
      body.provider_id,
      body.permission_profile,
      body.effort,
      // Explicit-directory sandbox creation stays possible (legacy POC style:
      // a sandbox session bound to a real project folder).
      wantsSandbox,
    );
    const response: SessionResponse = { session };
    return Response.json(response, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

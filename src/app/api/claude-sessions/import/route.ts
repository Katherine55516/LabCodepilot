import { NextRequest } from 'next/server';
import { getAllSessions } from '@/lib/db';
import { importOneSession, ImportSessionError } from '@/lib/session-import';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return Response.json(
        { error: 'sessionId is required' },
        { status: 400 },
      );
    }

    // Duplicate check: reject if a session with this sdk_session_id exists.
    const existingSessions = getAllSessions();
    const alreadyImported = existingSessions.find(s => s.sdk_session_id === sessionId);
    if (alreadyImported) {
      return Response.json(
        {
          error: 'This session has already been imported',
          existingSessionId: alreadyImported.id,
        },
        { status: 409 },
      );
    }

    const imported = importOneSession(sessionId);

    return Response.json({
      session: {
        id: imported.id,
        title: imported.title,
        messageCount: imported.messageCount,
        projectPath: imported.projectPath,
        sdkSessionId: imported.sdkSessionId,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ImportSessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/claude-sessions/import] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

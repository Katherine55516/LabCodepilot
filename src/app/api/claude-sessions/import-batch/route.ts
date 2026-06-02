import { NextRequest } from 'next/server';
import { getAllSessions } from '@/lib/db';
import { importOneSession } from '@/lib/session-import';

/**
 * POST /api/claude-sessions/import-batch
 *
 * Body: { sessionIds: string[] }
 *
 * Imports many Claude Code sessions in one request. Builds the
 * sdk_session_id → id duplicate map ONCE (vs the single-import route's
 * per-call getAllSessions()), then imports each id with its own
 * try/catch so a single bad session never aborts the rest.
 *
 * Always responds 200 with an aggregate summary (even when every item
 * failed) so the client can render a "N imported, M skipped, K failed"
 * result instead of treating partial failure as a 5xx. Only a malformed
 * body (400) or a process-level crash (500) is a non-200.
 */

type BatchResult =
  | { sessionId: string; status: 'imported'; newSessionId: string; title: string }
  | { sessionId: string; status: 'skipped'; existingSessionId: string }
  | { sessionId: string; status: 'failed'; error: string };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionIds } = body as { sessionIds?: unknown };

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return Response.json(
        { error: 'sessionIds must be a non-empty array' },
        { status: 400 },
      );
    }

    // One-time duplicate map: sdk_session_id → existing CodePilot session id.
    const dedupeMap = new Map<string, string>();
    for (const s of getAllSessions()) {
      if (s.sdk_session_id) dedupeMap.set(s.sdk_session_id, s.id);
    }

    const results: BatchResult[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const raw of sessionIds) {
      const sessionId = String(raw);
      try {
        const existing = dedupeMap.get(sessionId);
        if (existing) {
          results.push({ sessionId, status: 'skipped', existingSessionId: existing });
          skipped++;
          continue;
        }

        const result = importOneSession(sessionId);
        // Record so a duplicate id later in the same batch is also skipped.
        dedupeMap.set(sessionId, result.id);
        results.push({
          sessionId,
          status: 'imported',
          newSessionId: result.id,
          title: result.title,
        });
        imported++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[import-batch] failed for ${sessionId}:`, message);
        results.push({ sessionId, status: 'failed', error: message });
        failed++;
      }
    }

    return Response.json({
      results,
      summary: { imported, skipped, failed },
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/claude-sessions/import-batch] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

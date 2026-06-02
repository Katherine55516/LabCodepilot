/**
 * Shared Claude Code → CodePilot session import logic.
 *
 * Extracted so both the single-import route
 * (`/api/claude-sessions/import`) and the batch route
 * (`/api/claude-sessions/import-batch`) run identical parse + persist
 * behaviour. Duplicate detection stays in the route layer (single route
 * does a one-off lookup; batch builds a Map once) — this helper only
 * parses and writes.
 */

import { parseClaudeSession } from './claude-session-parser';
import { createSession, addMessage, updateSdkSessionId } from './db';

/** Error carrying the HTTP status the single-import route should surface. */
export class ImportSessionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ImportSessionError';
    this.status = status;
  }
}

export interface ImportedSession {
  id: string;
  title: string;
  messageCount: number;
  projectPath: string;
  sdkSessionId: string;
}

/**
 * Parse one Claude Code session JSONL and persist it as a new CodePilot
 * session. Does NOT check for duplicates — callers handle that.
 *
 * Throws ImportSessionError(404) when the session can't be found/parsed,
 * and ImportSessionError(400) when it has no importable messages.
 */
export function importOneSession(sessionId: string): ImportedSession {
  const parsed = parseClaudeSession(sessionId);
  if (!parsed) {
    throw new ImportSessionError(
      `Session "${sessionId}" not found or could not be parsed`,
      404,
    );
  }

  const { info, messages } = parsed;
  if (messages.length === 0) {
    throw new ImportSessionError('Session has no messages to import', 400);
  }

  // Title from the first user message (same convention as before).
  const firstUserMsg = messages.find((m) => m.role === 'user');
  const title = firstUserMsg
    ? firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '')
    : `Imported: ${info.projectName}`;

  const session = createSession(
    title,
    undefined, // model — default
    undefined, // system prompt
    info.cwd || info.projectPath,
    'code',
  );

  // Preserve the SDK session id so the conversation can be resumed.
  updateSdkSessionId(session.id, sessionId);

  for (const msg of messages) {
    // Assistant messages with tool blocks are stored as structured JSON;
    // text-only messages as plain text (CodePilot convention).
    const content = msg.hasToolBlocks
      ? JSON.stringify(msg.contentBlocks)
      : msg.content;
    if (content.trim()) {
      addMessage(session.id, msg.role, content);
    }
  }

  return {
    id: session.id,
    title,
    messageCount: messages.length,
    projectPath: info.projectPath,
    sdkSessionId: sessionId,
  };
}

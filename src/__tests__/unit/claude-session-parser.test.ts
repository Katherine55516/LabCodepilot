/**
 * Unit tests for claude-session-parser.ts
 *
 * Tests the JSONL parsing logic for Claude Code CLI session files.
 * Uses Node's built-in test runner (zero dependencies).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

// We test the parser functions by creating temporary JSONL files
// that mimic Claude Code's session storage format.

const TEST_DIR = path.join(os.tmpdir(), `codepilot-test-sessions-${Date.now()}`);
const PROJECTS_DIR = path.join(TEST_DIR, '.claude', 'projects');

// bsApp shadow home — emulates %APPDATA%\claude-bs-agent\claude-home on Windows
// (or the equivalent userData layout on macOS/Linux). The parser builds this
// path from different env/home sources depending on platform:
//   - win32 : process.env.APPDATA + claude-bs-agent\claude-home
//   - darwin: os.homedir() + Library/Application Support/claude-bs-agent/claude-home
//   - linux : process.env.XDG_CONFIG_HOME (or ~/.config) + claude-bs-agent/claude-home
// So the expected on-disk projects path depends on the platform we're running on.
const BSAPP_DIR = path.join(TEST_DIR, 'AppData', 'Roaming');
function getExpectedBsAppProjectsDir(): string {
  if (process.platform === 'darwin') {
    return path.join(
      TEST_DIR,
      'Library',
      'Application Support',
      'claude-bs-agent',
      'claude-home',
      '.claude',
      'projects',
    );
  }
  // win32 uses APPDATA mock; linux uses XDG_CONFIG_HOME mock — both point at BSAPP_DIR.
  return path.join(
    BSAPP_DIR,
    'claude-bs-agent',
    'claude-home',
    '.claude',
    'projects',
  );
}
const BSAPP_PROJECTS_DIR = getExpectedBsAppProjectsDir();

// Helper to create a JSONL session file in a chosen projects root
function createSessionFile(
  projectDirName: string,
  sessionId: string,
  lines: object[],
  root: string = PROJECTS_DIR,
): string {
  const dir = path.join(root, projectDirName);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ==========================================
// Test data factories
// ==========================================

function makeQueueEntry(sessionId: string, operation: string = 'dequeue') {
  return {
    type: 'queue-operation',
    operation,
    timestamp: '2026-01-15T10:00:00.000Z',
    sessionId,
  };
}

function makeUserEntry(opts: {
  sessionId: string;
  content: string;
  parentUuid?: string | null;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  timestamp?: string;
}) {
  return {
    parentUuid: opts.parentUuid ?? null,
    isSidechain: false,
    userType: 'external',
    cwd: opts.cwd || '/home/user/myproject',
    sessionId: opts.sessionId,
    version: opts.version || '2.1.34',
    gitBranch: opts.gitBranch || 'main',
    type: 'user',
    message: {
      role: 'user',
      content: opts.content,
    },
    uuid: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: opts.timestamp || '2026-01-15T10:00:01.000Z',
    permissionMode: 'default',
  };
}

function makeAssistantEntry(opts: {
  sessionId: string;
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string; is_error?: boolean }>;
  parentUuid: string;
  timestamp?: string;
  model?: string;
}) {
  return {
    parentUuid: opts.parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: '/home/user/myproject',
    sessionId: opts.sessionId,
    version: '2.1.34',
    gitBranch: 'main',
    message: {
      content: opts.content,
      id: `req-${Date.now()}`,
      model: opts.model || 'claude-sonnet-4-20250514',
      role: 'assistant',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    },
    type: 'assistant',
    uuid: `asst-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: opts.timestamp || '2026-01-15T10:00:02.000Z',
  };
}

// ==========================================
// Tests
// ==========================================

// We need to dynamically import the parser because it uses @/lib path aliases.
// Instead, we'll test the core logic by requiring the compiled output or
// using tsx to run these tests.

// Since the project uses path aliases (@/), we import via a relative path
// that tsx can resolve with the project's tsconfig.
const parserPath = path.resolve(__dirname, '../../lib/claude-session-parser.ts');

describe('claude-session-parser', () => {
  // We'll dynamically import the parser module
  let parser: typeof import('../../lib/claude-session-parser');
  // Save real env so we can restore in `after`
  const realHome = process.env.HOME;
  const realUserProfile = process.env.USERPROFILE;
  const realAppData = process.env.APPDATA;
  const realXdg = process.env.XDG_CONFIG_HOME;

  before(async () => {
    // Redirect every path source the parser inspects so it can't see the
    // host's real ~/.claude or %APPDATA%\claude-bs-agent during tests.
    // - HOME / USERPROFILE feed os.homedir() (USERPROFILE wins on Windows)
    // - APPDATA is the bsApp discovery seed on win32
    // - XDG_CONFIG_HOME is the bsApp discovery seed on linux
    process.env.HOME = TEST_DIR;
    process.env.USERPROFILE = TEST_DIR;
    process.env.APPDATA = BSAPP_DIR;
    process.env.XDG_CONFIG_HOME = BSAPP_DIR;

    // Dynamic import - tsx handles the TypeScript + path alias resolution.
    // Wrap in file:// URL so Windows absolute paths (e.g. D:\...) work too;
    // Node's ESM loader rejects raw drive-letter paths.
    parser = await import(pathToFileURL(parserPath).href);
  });

  after(() => {
    // Clean up test directory
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    // Restore env (delete the keys we created so we don't leak fake paths)
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    if (realUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realUserProfile;
    if (realAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = realAppData;
    if (realXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = realXdg;
  });

  describe('decodeProjectPath', () => {
    it('should decode a simple project path', () => {
      assert.equal(parser.decodeProjectPath('-root-myproject'), '/root/myproject');
    });

    it('should decode a deeper project path', () => {
      assert.equal(
        parser.decodeProjectPath('-Users-john-projects-myapp'),
        '/Users/john/projects/myapp',
      );
    });

    it('should return as-is if no leading dash', () => {
      assert.equal(parser.decodeProjectPath('some-dir'), 'some-dir');
    });
  });

  describe('getClaudeProjectsDir', () => {
    it('should return path under HOME/.claude/projects', () => {
      const dir = parser.getClaudeProjectsDir();
      assert.ok(dir.endsWith(path.join('.claude', 'projects')));
    });
  });

  describe('listClaudeSessions', () => {
    it('should return empty array when no sessions exist', () => {
      // Projects dir exists but is empty
      fs.mkdirSync(PROJECTS_DIR, { recursive: true });
      const sessions = parser.listClaudeSessions();
      assert.equal(sessions.length, 0);
    });

    it('should skip sessions with only queue-operation entries', () => {
      const sessionId = 'empty-session-001';
      createSessionFile('-home-user-emptyproject', sessionId, [
        makeQueueEntry(sessionId),
      ]);

      const sessions = parser.listClaudeSessions();
      const found = sessions.find(s => s.sessionId === sessionId);
      assert.equal(found, undefined, 'Should skip session with no messages');
    });

    it('should list a session with user and assistant messages', () => {
      const sessionId = 'test-session-001';
      const userEntry = makeUserEntry({
        sessionId,
        content: 'Hello, can you help me?',
        cwd: '/home/user/myproject',
        gitBranch: 'feature-branch',
        version: '2.1.34',
      });

      createSessionFile('-home-user-myproject', sessionId, [
        makeQueueEntry(sessionId),
        userEntry,
        makeAssistantEntry({
          sessionId,
          content: [{ type: 'text', text: 'Of course! How can I help you?' }],
          parentUuid: userEntry.uuid,
        }),
      ]);

      const sessions = parser.listClaudeSessions();
      const found = sessions.find(s => s.sessionId === sessionId);
      assert.ok(found, 'Session should be listed');
      assert.equal(found!.projectName, 'myproject');
      assert.equal(found!.cwd, '/home/user/myproject');
      assert.equal(found!.gitBranch, 'feature-branch');
      assert.equal(found!.version, '2.1.34');
      assert.equal(found!.preview, 'Hello, can you help me?');
      assert.equal(found!.userMessageCount, 1);
      assert.equal(found!.assistantMessageCount, 1);
    });

    it('should sort sessions by most recent first', () => {
      const oldSessionId = 'old-session-001';
      const newSessionId = 'new-session-001';

      createSessionFile('-home-user-oldproject', oldSessionId, [
        makeQueueEntry(oldSessionId),
        makeUserEntry({
          sessionId: oldSessionId,
          content: 'Old message',
          timestamp: '2025-01-01T00:00:00.000Z',
        }),
      ]);

      createSessionFile('-home-user-newproject', newSessionId, [
        makeQueueEntry(newSessionId),
        makeUserEntry({
          sessionId: newSessionId,
          content: 'New message',
          timestamp: '2026-06-01T00:00:00.000Z',
        }),
      ]);

      const sessions = parser.listClaudeSessions();
      const oldIdx = sessions.findIndex(s => s.sessionId === oldSessionId);
      const newIdx = sessions.findIndex(s => s.sessionId === newSessionId);
      assert.ok(newIdx < oldIdx, 'Newer session should come first');
    });
  });

  describe('parseClaudeSession', () => {
    it('should return null for non-existent session', () => {
      const result = parser.parseClaudeSession('non-existent-session-id');
      assert.equal(result, null);
    });

    it('should parse a simple text conversation', () => {
      const sessionId = 'parse-text-001';
      const userEntry = makeUserEntry({
        sessionId,
        content: 'What is TypeScript?',
        cwd: '/home/user/tsproject',
      });

      createSessionFile('-home-user-tsproject', sessionId, [
        makeQueueEntry(sessionId),
        userEntry,
        makeAssistantEntry({
          sessionId,
          content: [{ type: 'text', text: 'TypeScript is a typed superset of JavaScript.' }],
          parentUuid: userEntry.uuid,
        }),
      ]);

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result, 'Should return parsed session');
      assert.equal(result!.messages.length, 2);

      // Check user message
      const userMsg = result!.messages[0];
      assert.equal(userMsg.role, 'user');
      assert.equal(userMsg.content, 'What is TypeScript?');
      assert.equal(userMsg.hasToolBlocks, false);

      // Check assistant message
      const assistantMsg = result!.messages[1];
      assert.equal(assistantMsg.role, 'assistant');
      assert.equal(assistantMsg.content, 'TypeScript is a typed superset of JavaScript.');
      assert.equal(assistantMsg.hasToolBlocks, false);
    });

    it('should parse assistant messages with tool_use blocks', () => {
      const sessionId = 'parse-tools-001';
      const userEntry = makeUserEntry({
        sessionId,
        content: 'Read the package.json file',
        cwd: '/home/user/toolproject',
      });

      createSessionFile('-home-user-toolproject', sessionId, [
        makeQueueEntry(sessionId),
        userEntry,
        makeAssistantEntry({
          sessionId,
          content: [
            { type: 'text', text: "I'll read the file for you." },
            {
              type: 'tool_use',
              id: 'tool-001',
              name: 'Read',
              input: { file_path: '/home/user/toolproject/package.json' },
            },
          ],
          parentUuid: userEntry.uuid,
        }),
      ]);

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result);
      assert.equal(result!.messages.length, 2);

      const assistantMsg = result!.messages[1];
      assert.equal(assistantMsg.role, 'assistant');
      assert.equal(assistantMsg.hasToolBlocks, true);
      assert.equal(assistantMsg.contentBlocks.length, 2);
      assert.equal(assistantMsg.contentBlocks[0].type, 'text');
      assert.equal(assistantMsg.contentBlocks[1].type, 'tool_use');
      if (assistantMsg.contentBlocks[1].type === 'tool_use') {
        assert.equal(assistantMsg.contentBlocks[1].name, 'Read');
        assert.equal(assistantMsg.contentBlocks[1].id, 'tool-001');
      }
    });

    it('should parse assistant messages with tool_result blocks', () => {
      const sessionId = 'parse-results-001';
      const userEntry = makeUserEntry({
        sessionId,
        content: 'Show me the file',
        cwd: '/home/user/resultproject',
      });

      createSessionFile('-home-user-resultproject', sessionId, [
        makeQueueEntry(sessionId),
        userEntry,
        makeAssistantEntry({
          sessionId,
          content: [
            { type: 'text', text: 'Here is the content.' },
            {
              type: 'tool_use',
              id: 'tool-002',
              name: 'Read',
              input: { file_path: 'test.txt' },
            },
            {
              type: 'tool_result',
              tool_use_id: 'tool-002',
              content: 'file content here',
              is_error: false,
            },
          ],
          parentUuid: userEntry.uuid,
        }),
      ]);

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result);

      const assistantMsg = result!.messages[1];
      assert.equal(assistantMsg.hasToolBlocks, true);
      assert.equal(assistantMsg.contentBlocks.length, 3);
      assert.equal(assistantMsg.contentBlocks[2].type, 'tool_result');
      if (assistantMsg.contentBlocks[2].type === 'tool_result') {
        assert.equal(assistantMsg.contentBlocks[2].tool_use_id, 'tool-002');
        assert.equal(assistantMsg.contentBlocks[2].content, 'file content here');
        assert.equal(assistantMsg.contentBlocks[2].is_error, false);
      }
    });

    it('should parse multi-turn conversations', () => {
      const sessionId = 'parse-multi-001';
      const user1 = makeUserEntry({
        sessionId,
        content: 'First question',
        timestamp: '2026-01-15T10:00:01.000Z',
        cwd: '/home/user/multiproject',
      });
      const asst1 = makeAssistantEntry({
        sessionId,
        content: [{ type: 'text', text: 'First answer' }],
        parentUuid: user1.uuid,
        timestamp: '2026-01-15T10:00:02.000Z',
      });
      const user2 = makeUserEntry({
        sessionId,
        content: 'Follow-up question',
        parentUuid: asst1.uuid,
        timestamp: '2026-01-15T10:00:03.000Z',
        cwd: '/home/user/multiproject',
      });
      const asst2 = makeAssistantEntry({
        sessionId,
        content: [{ type: 'text', text: 'Follow-up answer' }],
        parentUuid: user2.uuid,
        timestamp: '2026-01-15T10:00:04.000Z',
      });

      createSessionFile('-home-user-multiproject', sessionId, [
        makeQueueEntry(sessionId),
        user1,
        asst1,
        user2,
        asst2,
      ]);

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result);
      assert.equal(result!.messages.length, 4);
      assert.equal(result!.messages[0].role, 'user');
      assert.equal(result!.messages[0].content, 'First question');
      assert.equal(result!.messages[1].role, 'assistant');
      assert.equal(result!.messages[1].content, 'First answer');
      assert.equal(result!.messages[2].role, 'user');
      assert.equal(result!.messages[2].content, 'Follow-up question');
      assert.equal(result!.messages[3].role, 'assistant');
      assert.equal(result!.messages[3].content, 'Follow-up answer');
    });

    it('should handle empty assistant content gracefully', () => {
      const sessionId = 'parse-empty-asst-001';
      const userEntry = makeUserEntry({
        sessionId,
        content: 'Test message',
        cwd: '/home/user/emptyasstproject',
      });

      createSessionFile('-home-user-emptyasstproject', sessionId, [
        makeQueueEntry(sessionId),
        userEntry,
        makeAssistantEntry({
          sessionId,
          content: [], // Empty content
          parentUuid: userEntry.uuid,
        }),
      ]);

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result);
      // Empty assistant message should be skipped
      assert.equal(result!.messages.length, 1);
      assert.equal(result!.messages[0].role, 'user');
    });

    it('should truncate preview to 120 characters', () => {
      const sessionId = 'parse-long-preview-001';
      const longMessage = 'A'.repeat(200);
      createSessionFile('-home-user-longproject', sessionId, [
        makeQueueEntry(sessionId),
        makeUserEntry({
          sessionId,
          content: longMessage,
          cwd: '/home/user/longproject',
        }),
      ]);

      const sessions = parser.listClaudeSessions();
      const found = sessions.find(s => s.sessionId === sessionId);
      assert.ok(found);
      assert.equal(found!.preview.length, 120);
    });

    it('should extract session info correctly', () => {
      const sessionId = 'parse-info-001';
      createSessionFile('-home-user-infoproject', sessionId, [
        makeQueueEntry(sessionId),
        makeUserEntry({
          sessionId,
          content: 'Test',
          cwd: '/home/user/infoproject',
          gitBranch: 'develop',
          version: '3.0.0',
          timestamp: '2026-03-15T14:30:00.000Z',
        }),
        makeAssistantEntry({
          sessionId,
          content: [{ type: 'text', text: 'Reply' }],
          parentUuid: 'some-uuid',
          timestamp: '2026-03-15T14:30:05.000Z',
        }),
      ]);

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result);
      assert.equal(result!.info.sessionId, sessionId);
      assert.equal(result!.info.cwd, '/home/user/infoproject');
      assert.equal(result!.info.gitBranch, 'develop');
      assert.equal(result!.info.version, '3.0.0');
      assert.equal(result!.info.userMessageCount, 1);
      assert.equal(result!.info.assistantMessageCount, 1);
      assert.equal(result!.info.createdAt, '2026-01-15T10:00:00.000Z'); // queue-operation timestamp
      assert.equal(result!.info.updatedAt, '2026-03-15T14:30:05.000Z');
    });

    it('should handle malformed JSONL lines gracefully', () => {
      const sessionId = 'parse-malformed-001';
      const dir = path.join(PROJECTS_DIR, '-home-user-malformedproject');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${sessionId}.jsonl`);

      const lines = [
        JSON.stringify(makeQueueEntry(sessionId)),
        'this is not valid json',
        JSON.stringify(makeUserEntry({
          sessionId,
          content: 'Valid message after bad line',
          cwd: '/home/user/malformedproject',
        })),
        '{"incomplete": true',
      ];
      fs.writeFileSync(filePath, lines.join('\n') + '\n');

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result, 'Should handle malformed lines gracefully');
      assert.equal(result!.messages.length, 1);
      assert.equal(result!.messages[0].content, 'Valid message after bad line');
    });
  });

  describe('bsApp shadow home', () => {
    it('should list sessions written under the bsApp shadow home', () => {
      const sessionId = 'bsapp-session-001';
      const userEntry = makeUserEntry({
        sessionId,
        content: 'Hello from bsApp',
        cwd: '/Users/me/bsapp-project',
        gitBranch: 'main',
        version: '2.1.34',
      });

      // Write directly into the bsApp shadow projects dir, not the main one.
      createSessionFile(
        '-Users-me-bsapp-project',
        sessionId,
        [
          makeQueueEntry(sessionId),
          userEntry,
          makeAssistantEntry({
            sessionId,
            content: [{ type: 'text', text: 'Hi from inside bsApp.' }],
            parentUuid: userEntry.uuid,
          }),
        ],
        BSAPP_PROJECTS_DIR,
      );

      const sessions = parser.listClaudeSessions();
      const found = sessions.find(s => s.sessionId === sessionId);
      assert.ok(found, 'bsApp session should appear in the unified list');
      assert.equal(found!.preview, 'Hello from bsApp');
      assert.equal(found!.cwd, '/Users/me/bsapp-project');
    });

    it('should parse a session from the bsApp shadow home', () => {
      const sessionId = 'bsapp-parse-001';
      const userEntry = makeUserEntry({
        sessionId,
        content: 'Parse me from bsApp',
        cwd: '/Users/me/bsapp-parse',
      });

      createSessionFile(
        '-Users-me-bsapp-parse',
        sessionId,
        [
          makeQueueEntry(sessionId),
          userEntry,
          makeAssistantEntry({
            sessionId,
            content: [{ type: 'text', text: 'Parsed reply' }],
            parentUuid: userEntry.uuid,
          }),
        ],
        BSAPP_PROJECTS_DIR,
      );

      const result = parser.parseClaudeSession(sessionId);
      assert.ok(result, 'parseClaudeSession should find sessions in bsApp shadow home');
      assert.equal(result!.messages.length, 2);
      assert.equal(result!.messages[0].content, 'Parse me from bsApp');
      assert.equal(result!.messages[1].content, 'Parsed reply');
    });

    it('should prefer the main projects root when a session id collides', () => {
      // Same sessionId written to both roots with different contents — the
      // canonical ~/.claude/projects/ copy must win so existing CLI workflows
      // remain authoritative.
      const sessionId = 'collide-session-001';

      createSessionFile(
        '-home-user-mainproject',
        sessionId,
        [
          makeQueueEntry(sessionId),
          makeUserEntry({ sessionId, content: 'From main root', cwd: '/home/user/mainproject' }),
        ],
        PROJECTS_DIR,
      );

      createSessionFile(
        '-home-user-bsappproject',
        sessionId,
        [
          makeQueueEntry(sessionId),
          makeUserEntry({ sessionId, content: 'From bsApp root', cwd: '/home/user/bsappproject' }),
        ],
        BSAPP_PROJECTS_DIR,
      );

      const sessions = parser.listClaudeSessions();
      const matches = sessions.filter(s => s.sessionId === sessionId);
      assert.equal(matches.length, 1, 'Colliding sessionId should appear exactly once');
      assert.equal(matches[0].preview, 'From main root');
      assert.equal(matches[0].cwd, '/home/user/mainproject');

      const parsed = parser.parseClaudeSession(sessionId);
      assert.ok(parsed);
      assert.equal(parsed!.messages[0].content, 'From main root');
    });
  });

  describe('getClaudeProjectsRoots', () => {
    it('should always include the main root first', () => {
      const roots = parser.getClaudeProjectsRoots();
      assert.ok(roots.length >= 1);
      assert.equal(roots[0].source, 'main');
      assert.ok(roots[0].path.endsWith(path.join('.claude', 'projects')));
    });

    it('should include the bsApp shadow root on win32/darwin/linux', () => {
      const roots = parser.getClaudeProjectsRoots();
      // win32 needs APPDATA set (we mock it); darwin/linux derive from homedir/XDG.
      const bsApp = roots.find(r => r.source === 'bsApp');
      assert.ok(bsApp, 'bsApp root should be discovered');
      assert.ok(bsApp!.path.includes('claude-bs-agent'));
      assert.ok(bsApp!.path.endsWith(path.join('.claude', 'projects')));
    });
  });
});

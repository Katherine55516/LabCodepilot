/**
 * Parser for Claude Code CLI session files (.jsonl).
 *
 * Claude Code stores conversation history as JSONL files in:
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
 *
 * Each line is a JSON object with a `type` field:
 *   - "queue-operation": session lifecycle events (dequeue/enqueue)
 *   - "user": user messages with metadata (cwd, git branch, etc.)
 *   - "assistant": assistant responses with structured content blocks
 *
 * Messages are threaded via parentUuid → uuid chains.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MessageContentBlock } from '@/types';

// ==========================================
// Constants
// ==========================================

/** Maximum file size (50 MB) to prevent memory issues with very large sessions */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ==========================================
// Types for Claude Code JSONL entries
// ==========================================

export interface ClaudeSessionInfo {
  /** Session UUID (filename without .jsonl) */
  sessionId: string;
  /** Decoded project directory path (best-effort from folder name) */
  projectPath: string;
  /** Project folder name */
  projectName: string;
  /** Working directory from the first user message (authoritative) */
  cwd: string;
  /** Git branch from the first user message */
  gitBranch: string;
  /** Claude Code version used */
  version: string;
  /** First user message preview (truncated) */
  preview: string;
  /** Number of user messages */
  userMessageCount: number;
  /** Number of assistant messages */
  assistantMessageCount: number;
  /** Session start timestamp */
  createdAt: string;
  /** Last message timestamp */
  updatedAt: string;
  /** File size in bytes */
  fileSize: number;
}

export interface ParsedMessage {
  role: 'user' | 'assistant';
  /** Plain text content for display */
  content: string;
  /** Structured content blocks (for assistant messages with tool usage) */
  contentBlocks: MessageContentBlock[];
  /** Whether this message contains tool calls */
  hasToolBlocks: boolean;
  /** Original timestamp from the JSONL entry */
  timestamp: string;
}

export interface ParsedSession {
  info: ClaudeSessionInfo;
  messages: ParsedMessage[];
}

// Raw JSONL entry types
interface JournalEntry {
  type: string;
  timestamp?: string;
  sessionId?: string;
  [key: string]: unknown;
}

interface UserEntry extends JournalEntry {
  type: 'user';
  parentUuid: string | null;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  uuid: string;
  timestamp: string;
}

interface AssistantEntry extends JournalEntry {
  type: 'assistant';
  parentUuid: string;
  cwd: string;
  sessionId: string;
  message: {
    content: ContentBlock[];
    id?: string;
    model?: string;
    role: 'assistant';
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  uuid: string;
  timestamp: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

// ==========================================
// Session Discovery
// ==========================================

/** Where a discovered projects root comes from — used internally for ordering. */
export type ClaudeProjectsSource = 'main' | 'bsApp';

export interface ClaudeProjectsRoot {
  source: ClaudeProjectsSource;
  /** Absolute path to `<home>/.claude/projects` (may not exist on disk yet) */
  path: string;
}

/**
 * Resolve the "shadow HOME" that bsApp (claude-bs-agent) uses for its bundled
 * Claude CLI. bsApp's Electron main process spawns the server child with
 * `HOME`/`USERPROFILE` rewritten to `<userData>/claude-home` so the embedded
 * CLI cannot read the user's global `~/.claude/settings.json`. This isolation
 * also moves every session JSONL out of `~/.claude/projects/`, which is why
 * AI Native Lab can't see those sessions by default.
 *
 * `userData` is Electron's standard per-app data directory:
 *   - Windows: %APPDATA%\<productName>
 *   - macOS:   ~/Library/Application Support/<productName>
 *   - Linux:   ~/.config/<productName>   (or $XDG_CONFIG_HOME/<productName>)
 *
 * productName = "claude-bs-agent" (bsApp/package.json).
 *
 * Returns null on any unrecognised platform.
 */
function getBsAppShadowHome(): string | null {
  const productName = 'claude-bs-agent';

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return path.join(appData, productName, 'claude-home');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', productName, 'claude-home');
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, productName, 'claude-home');
}

/**
 * Return every Claude Code `projects/` directory AI Native Lab knows how to read.
 * Order matters: when the same session UUID appears in multiple roots, the
 * earlier root wins (so the user's real `~/.claude/projects/` is canonical).
 *
 * Non-existent roots are kept in the list so callers can short-circuit with
 * `fs.existsSync`; we don't filter here to keep the function pure.
 */
export function getClaudeProjectsRoots(): ClaudeProjectsRoot[] {
  const roots: ClaudeProjectsRoot[] = [
    { source: 'main', path: path.join(os.homedir(), '.claude', 'projects') },
  ];

  const bsAppHome = getBsAppShadowHome();
  if (bsAppHome) {
    roots.push({ source: 'bsApp', path: path.join(bsAppHome, '.claude', 'projects') });
  }

  return roots;
}

/**
 * Legacy single-root accessor. Returns the primary (main) root.
 * Kept so callers that don't care about multi-root behaviour (and the
 * existing unit tests that mock `process.env.HOME`) keep working.
 */
export function getClaudeProjectsDir(): string {
  return getClaudeProjectsRoots()[0].path;
}

/**
 * Decode a Claude Code project directory name back to a filesystem path.
 *
 * Claude Code encodes absolute paths by replacing each '/' with '-'.
 * e.g., "/root/clawd" → "-root-clawd"
 *
 * NOTE: This is lossy — directory names containing hyphens are ambiguous.
 * e.g., "-root-my-project" could be "/root/my-project" or "/root/my/project".
 * The `cwd` field inside JSONL entries is the authoritative working directory;
 * this function is only used as a fallback for display purposes.
 */
export function decodeProjectPath(encodedName: string): string {
  if (!encodedName.startsWith('-')) {
    return encodedName;
  }
  return encodedName.replace(/^-/, '/').replace(/-/g, '/');
}

/**
 * List all available Claude Code CLI sessions.
 *
 * Scans every root returned by `getClaudeProjectsRoots()` — i.e. the user's
 * real `~/.claude/projects/` plus the bsApp shadow HOME if present — for
 * `.jsonl` files and extracts metadata.
 *
 * Cross-root dedup: a sessionId observed in an earlier root suppresses the
 * same id in later roots. This makes the primary `~/.claude/projects/` the
 * canonical source when the user (theoretically) has the same UUID in both
 * places. UUID collisions across roots are vanishingly rare in practice.
 */
export function listClaudeSessions(): ClaudeSessionInfo[] {
  const sessions: ClaudeSessionInfo[] = [];
  const seenIds = new Set<string>();

  for (const root of getClaudeProjectsRoots()) {
    if (!fs.existsSync(root.path)) continue;

    try {
      const projectDirs = fs.readdirSync(root.path, { withFileTypes: true });

      for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) continue;

        const projectFolderPath = path.join(root.path, projectDir.name);
        const decodedPath = decodeProjectPath(projectDir.name);

        try {
          const files = fs.readdirSync(projectFolderPath);
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

          for (const jsonlFile of jsonlFiles) {
            const sessionId = jsonlFile.replace('.jsonl', '');
            if (seenIds.has(sessionId)) continue;

            const filePath = path.join(projectFolderPath, jsonlFile);

            try {
              const info = extractSessionInfo(filePath, sessionId, decodedPath);
              if (info) {
                sessions.push(info);
                seenIds.add(sessionId);
              }
            } catch {
              // Skip files that can't be parsed
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      }
    } catch {
      // Projects directory can't be read
    }
  }

  // Sort by most recent first
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return sessions;
}

/**
 * Read and split a JSONL file into lines, with size guard.
 * Returns null if the file exceeds MAX_FILE_SIZE.
 */
function readJsonlLines(filePath: string): { lines: string[]; stat: fs.Stats } | null {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(`[claude-session-parser] Skipping ${filePath}: file too large (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  return { lines, stat };
}

/**
 * Extract metadata from a session JSONL file without fully parsing all messages.
 */
function extractSessionInfo(
  filePath: string,
  sessionId: string,
  projectPath: string,
): ClaudeSessionInfo | null {
  const result = readJsonlLines(filePath);
  if (!result) return null;
  const { lines, stat } = result;

  if (lines.length === 0) return null;

  let cwd = '';
  let gitBranch = '';
  let version = '';
  let preview = '';
  let createdAt = '';
  let updatedAt = '';
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as JournalEntry;

      if (entry.timestamp) {
        if (!createdAt) createdAt = entry.timestamp as string;
        updatedAt = entry.timestamp as string;
      }

      if (entry.type === 'user') {
        const userEntry = entry as UserEntry;
        userMessageCount++;

        if (!cwd && userEntry.cwd) cwd = userEntry.cwd;
        if (!gitBranch && userEntry.gitBranch) gitBranch = userEntry.gitBranch;
        if (!version && userEntry.version) version = userEntry.version;

        if (!preview && userEntry.message?.content) {
          const msgContent = userEntry.message.content;
          if (typeof msgContent === 'string') {
            preview = msgContent.slice(0, 120);
          } else if (Array.isArray(msgContent)) {
            const textBlock = msgContent.find(b => b.type === 'text');
            if (textBlock?.text) {
              preview = textBlock.text.slice(0, 120);
            }
          }
        }
      } else if (entry.type === 'assistant') {
        assistantMessageCount++;
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Skip empty sessions (only queue-operation entries, no actual messages)
  if (userMessageCount === 0 && assistantMessageCount === 0) {
    return null;
  }

  // Use cwd from JSONL (authoritative) for projectName; fall back to decoded folder name
  const effectivePath = cwd || projectPath;

  return {
    sessionId,
    projectPath: effectivePath,
    projectName: path.basename(effectivePath),
    cwd: effectivePath,
    gitBranch: gitBranch || '',
    version: version || '',
    preview: preview || '(no preview)',
    userMessageCount,
    assistantMessageCount,
    createdAt: createdAt || stat.birthtime.toISOString(),
    updatedAt: updatedAt || stat.mtime.toISOString(),
    fileSize: stat.size,
  };
}

// ==========================================
// Session Parsing
// ==========================================

/**
 * Fully parse a Claude Code session JSONL file into messages.
 * Reads the file once and extracts both metadata and messages in a single pass.
 *
 * Searches every root from `getClaudeProjectsRoots()` so sessions written by
 * sibling apps with a redirected HOME (e.g. bsApp) are also importable. The
 * first root containing the sessionId wins — matches the dedup order in
 * `listClaudeSessions()`.
 */
export function parseClaudeSession(sessionId: string): ParsedSession | null {
  let filePath: string | null = null;
  let projectPath = '';

  for (const root of getClaudeProjectsRoots()) {
    if (!fs.existsSync(root.path)) continue;

    try {
      const projectDirs = fs.readdirSync(root.path, { withFileTypes: true });

      for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) continue;

        const candidate = path.join(root.path, projectDir.name, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          projectPath = decodeProjectPath(projectDir.name);
          break;
        }
      }
    } catch {
      // Skip unreadable root
    }

    if (filePath) break;
  }

  if (!filePath) return null;

  const result = readJsonlLines(filePath);
  if (!result) return null;
  const { lines, stat } = result;

  if (lines.length === 0) return null;

  // Single pass: extract both metadata and messages.
  //
  // Turn merging: a Claude Code transcript splits one logical assistant turn
  // across many JSONL lines (separate lines for thinking / text / each
  // tool_use, plus the tool_result fed back as a "user" line). To render the
  // interleaved flow we MERGE all those lines between two real user prompts
  // into ONE assistant message whose contentBlocks preserve chronological
  // order — including thinking and tool_results paired to their tool_use.
  const messages: ParsedMessage[] = [];
  let cwd = '';
  let gitBranch = '';
  let version = '';
  let preview = '';
  let createdAt = '';
  let updatedAt = '';
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  // Accumulator for the current assistant turn.
  let pendingBlocks: MessageContentBlock[] | null = null;
  let pendingTs = '';

  const flushAssistant = () => {
    if (pendingBlocks && pendingBlocks.length > 0) {
      const textParts = pendingBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text);
      const hasToolBlocks = pendingBlocks.some(b => b.type === 'tool_use' || b.type === 'tool_result');
      messages.push({
        role: 'assistant',
        content: textParts.join('\n'),
        contentBlocks: pendingBlocks,
        hasToolBlocks,
        timestamp: pendingTs,
      });
    }
    pendingBlocks = null;
    pendingTs = '';
  };

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as JournalEntry;

      if (entry.timestamp) {
        if (!createdAt) createdAt = entry.timestamp as string;
        updatedAt = entry.timestamp as string;
      }

      if (entry.type === 'user') {
        const userEntry = entry as UserEntry;

        if (!cwd && userEntry.cwd) cwd = userEntry.cwd;
        if (!gitBranch && userEntry.gitBranch) gitBranch = userEntry.gitBranch;
        if (!version && userEntry.version) version = userEntry.version;

        const { prompt, toolResults } = analyzeUserEntry(userEntry);

        // tool_result lines belong to the in-flight assistant turn.
        if (toolResults.length > 0 && pendingBlocks) {
          pendingBlocks.push(...toolResults);
        }

        // A real user prompt is a turn boundary.
        if (prompt) {
          userMessageCount++;
          if (!preview) preview = prompt.slice(0, 120);
          flushAssistant();
          messages.push({
            role: 'user',
            content: prompt,
            contentBlocks: [{ type: 'text', text: prompt }],
            hasToolBlocks: false,
            timestamp: userEntry.timestamp || new Date().toISOString(),
          });
        }
      } else if (entry.type === 'assistant') {
        assistantMessageCount++;
        const assistantEntry = entry as AssistantEntry;
        const blocks = parseAssistantBlocks(assistantEntry);
        if (blocks.length > 0) {
          if (!pendingBlocks) {
            pendingBlocks = [];
            pendingTs = assistantEntry.timestamp || new Date().toISOString();
          }
          pendingBlocks.push(...blocks);
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Flush the trailing assistant turn (no user prompt closes it).
  flushAssistant();

  // Skip empty sessions
  if (userMessageCount === 0 && assistantMessageCount === 0) {
    return null;
  }

  const effectivePath = cwd || projectPath;

  const info: ClaudeSessionInfo = {
    sessionId,
    projectPath: effectivePath,
    projectName: path.basename(effectivePath),
    cwd: effectivePath,
    gitBranch: gitBranch || '',
    version: version || '',
    preview: preview || '(no preview)',
    userMessageCount,
    assistantMessageCount,
    createdAt: createdAt || stat.birthtime.toISOString(),
    updatedAt: updatedAt || stat.mtime.toISOString(),
    fileSize: stat.size,
  };

  return { info, messages };
}

/** Normalize a tool_result block's content (string or text-block array) to string. */
function toolResultContentToString(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text || '').join('\n');
  }
  return '';
}

/**
 * Extract ordered content blocks from an assistant JSONL entry. Preserves the
 * block array order (= chronological order) and includes thinking blocks.
 * Returns [] for entries with no renderable blocks.
 */
function parseAssistantBlocks(entry: AssistantEntry): MessageContentBlock[] {
  const msgContent = entry.message?.content;
  if (!msgContent || !Array.isArray(msgContent)) return [];

  const blocks: MessageContentBlock[] = [];
  for (const block of msgContent) {
    switch (block.type) {
      case 'thinking': {
        if (block.thinking) blocks.push({ type: 'thinking', thinking: block.thinking });
        break;
      }
      case 'text': {
        if (block.text) blocks.push({ type: 'text', text: block.text });
        break;
      }
      case 'tool_use': {
        blocks.push({ type: 'tool_use', id: block.id || '', name: block.name || '', input: block.input });
        break;
      }
      case 'tool_result': {
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id || '',
          content: toolResultContentToString(block.content),
          is_error: block.is_error || false,
        });
        break;
      }
    }
  }
  return blocks;
}

/**
 * Analyze a user JSONL entry. In Claude Code's transcript, a "user" line is
 * EITHER a real user prompt (string / text content) OR the tool_result(s) fed
 * back to the model after a tool_use (array of tool_result blocks). We split
 * these so the importer can group tool_results into the assistant turn and
 * only treat real prompts as turn boundaries.
 */
function analyzeUserEntry(entry: UserEntry): { prompt: string | null; toolResults: MessageContentBlock[] } {
  const content = entry.message?.content;
  if (typeof content === 'string') {
    return { prompt: content.trim() ? content : null, toolResults: [] };
  }
  if (Array.isArray(content)) {
    const text = content.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
    const toolResults: MessageContentBlock[] = content
      .filter(b => b.type === 'tool_result')
      .map(b => ({
        type: 'tool_result' as const,
        tool_use_id: b.tool_use_id || '',
        content: toolResultContentToString(b.content),
        is_error: b.is_error || false,
      }));
    return { prompt: text.trim() ? text : null, toolResults };
  }
  return { prompt: null, toolResults: [] };
}

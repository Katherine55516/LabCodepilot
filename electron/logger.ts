/**
 * File logger for the Electron main process.
 *
 * Why this exists: the app previously wrote NO logs to disk. The Next.js
 * server runs as a `utilityProcess.fork` child whose stdout/stderr are piped
 * to main and merely `console.log`'d (lost in a packaged build, where main has
 * no attached terminal). So when the bundled Claude Code subprocess crashed,
 * the real exit code / stderr — the only thing that actually explains the
 * failure — was unrecoverable. This module persists it.
 *
 * Design:
 *  - Main is the single convergence point: it already re-`console.log`s the
 *    forked server's piped output, so wrapping `console.*` in main captures
 *    BOTH main's own logs AND the entire Next-server process output (API
 *    routes, claude-client stderr, the `[server:err]` lines) — without
 *    touching the server code at all. Renderer console is captured via a
 *    `webContents.on('console-message')` listener wired in main.ts.
 *  - Every line is run through `scrubSecrets()` before hitting disk so the log
 *    file is safe to share. Original console output is left untouched (dev
 *    terminal still sees raw text).
 *  - Crash-safe: writes use `fs.appendFileSync` (flushed immediately) so the
 *    lines leading up to — and including — a crash are on disk. Size-based
 *    rotation keeps the footprint bounded.
 *  - Logging must NEVER throw or crash the app: every path is guarded.
 */

import { app, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { scrubSecrets } from './log-scrub';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILES = 5; // main.log + main.1.log … main.4.log → ~25 MB ceiling
const MAX_LINE_CHARS = 16384; // cap a single line so one huge blob can't churn rotation
const LOG_BASENAME = 'main.log';

// Env var names whose VALUES must never reach the log file (redacted verbatim).
// The explicit list (matched at length >= 8) plus a name-shape sweep (length
// >= 12) so any *_API_KEY / *_TOKEN / *_SECRET in the env injected into the
// forked server is auto-registered — including the user's BYOK provider keys,
// which arrive via loadUserShellEnv and never touch the main process.env.
const SECRET_ENV_VARS = [
  'CLAUDE_GUI_SECRET_KEY', // 64-hex credential master key — highest sensitivity
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
];
const SECRET_NAME_RE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

let logDir = '';
let logFile = '';
let currentBytes = 0;
let installed = false;
const knownSecrets: string[] = [];

function addSecret(value: string | undefined, minLen = 8): void {
  if (value && value.length >= minLen && !knownSecrets.includes(value)) {
    knownSecrets.push(value);
  }
}

function collectFromEnv(env: Record<string, string | undefined>): void {
  for (const name of SECRET_ENV_VARS) addSecret(env[name], 8);
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_NAME_RE.test(name)) addSecret(value, 12);
  }
}

/**
 * Register additional exact secret values for verbatim redaction. Call after a
 * step introduces a credential the logger can't otherwise see — notably the
 * merged env injected into the forked server, which carries the master key and
 * the user's BYOK provider keys that never touch the main process.env.
 */
export function registerKnownSecretsFromEnv(env: Record<string, string | undefined>): void {
  collectFromEnv(env);
}

/** Best-effort size-based rotation. Shifts main.log → main.1.log → … → drops oldest. */
function rotateIfNeeded(incomingBytes: number): void {
  if (currentBytes + incomingBytes <= MAX_FILE_BYTES) return;
  try {
    const oldest = path.join(logDir, `main.${MAX_FILES - 1}.log`);
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
    for (let i = MAX_FILES - 2; i >= 1; i--) {
      const from = path.join(logDir, `main.${i}.log`);
      const to = path.join(logDir, `main.${i + 1}.log`);
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    if (fs.existsSync(logFile)) fs.renameSync(logFile, path.join(logDir, 'main.1.log'));
    currentBytes = 0; // only reset after a successful rotation
  } catch {
    // Rotation is best-effort. Leave currentBytes as-is so the next write
    // retries rotation rather than silently overshooting the size cap.
  }
}

function writeRaw(line: string): void {
  if (!logFile) return;
  try {
    const bytes = Buffer.byteLength(line, 'utf-8');
    rotateIfNeeded(bytes);
    fs.appendFileSync(logFile, line);
    currentBytes += bytes;
  } catch {
    /* logging must never throw */
  }
}

/** Write a structured, secret-scrubbed line to the log file. */
export function logLine(level: string, ...args: unknown[]): void {
  if (!installed) return;
  let msg: string;
  try {
    msg = util.format(...args);
  } catch {
    msg = args.map((a) => String(a)).join(' ');
  }
  let scrubbed = scrubSecrets(msg, knownSecrets);
  if (scrubbed.length > MAX_LINE_CHARS) {
    scrubbed = scrubbed.slice(0, MAX_LINE_CHARS) + `…[+${scrubbed.length - MAX_LINE_CHARS} chars truncated]`;
  }
  writeRaw(`${new Date().toISOString()} [${level}] ${scrubbed}\n`);
}

/** Tee console.* to the log file while preserving original output. */
function installConsoleTee(): void {
  const map: Array<['log' | 'info' | 'warn' | 'error' | 'debug', string]> = [
    ['log', 'INFO'],
    ['info', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERROR'],
    ['debug', 'DEBUG'],
  ];
  const c = console as unknown as Record<string, (...a: unknown[]) => void>;
  for (const [method, level] of map) {
    const original = c[method].bind(console);
    c[method] = (...args: unknown[]) => {
      try {
        original(...args); // keep original behaviour (dev terminal / pipe)
      } catch {
        // The original console may throw (e.g. EPIPE on a closed stdout in a
        // packaged build). Swallow so the file tee below still runs — it is
        // the durable sink and must survive a dead stdout.
      }
      logLine(level, ...args); // tee to file (scrubbed); logLine never throws
    };
  }
}

/** Persist otherwise-silent crashes in the main process. */
function installCrashHandlers(): void {
  // Use 'uncaughtExceptionMonitor' (NOT 'uncaughtException'): it lets us log
  // synchronously without becoming a *handler* — it does not change Node's exit
  // behaviour AND does not count toward process.listenerCount('uncaughtException').
  // That matters because Sentry's OnUncaughtException integration only shows its
  // native crash dialog while that count is <= 2; registering a real handler
  // here would silently suppress the dialog and leave the app alive in a corrupt
  // state. The monitor variant avoids that entirely.
  process.on('uncaughtExceptionMonitor', (err) => {
    logLine('FATAL', 'uncaughtException:', err?.stack || err);
  });
  // Unhandled rejections are not terminated here (Sentry runs in warn mode), so
  // record them as WARN rather than FATAL.
  process.on('unhandledRejection', (reason) => {
    logLine('WARN', 'unhandledRejection:', reason instanceof Error ? reason.stack : reason);
  });
}

/**
 * Initialise the file logger. Idempotent. Call as early as possible inside
 * app.whenReady() (app must be ready for app.getPath('logs')).
 */
export function initFileLogger(): void {
  if (installed) return;
  try {
    logDir = app.getPath('logs');
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, LOG_BASENAME);
    currentBytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    collectFromEnv(process.env); // baseline; server-injected secrets added later
    installed = true;

    writeRaw(`\n${'='.repeat(78)}\n`);
    logLine(
      'INFO',
      `=== ${app.getName()} v${app.getVersion()} started — pid ${process.pid} — ` +
        `${process.platform}/${process.arch} — electron ${process.versions.electron} / node ${process.versions.node} ===`,
    );
    installConsoleTee();
    installCrashHandlers();
  } catch (err) {
    // If logging can't be set up the app must still run. Report once via the
    // (still-original) console; do not rethrow.
    console.error('[logger] file logger init failed:', err);
  }
}

/** Absolute path of the log directory (empty until initFileLogger runs). */
export function getLogDir(): string {
  return logDir || (() => {
    try {
      return app.getPath('logs');
    } catch {
      return '';
    }
  })();
}

/** Open the log directory in the OS file manager. Returns '' on success. */
export async function openLogsFolder(): Promise<string> {
  try {
    const dir = getLogDir();
    if (!dir) return 'log directory unavailable';
    fs.mkdirSync(dir, { recursive: true });
    return await shell.openPath(dir);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Record a renderer-process console message. Call from a
 * `webContents.on('console-message', …)` listener in main.
 */
export function logRendererConsole(message: string, line?: number, sourceId?: string): void {
  const where = sourceId ? ` (${sourceId}:${line ?? 0})` : '';
  logLine('RENDERER', `${message}${where}`);
}

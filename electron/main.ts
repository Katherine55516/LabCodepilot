import { app, BrowserWindow, Notification, nativeImage, dialog, session, utilityProcess, ipcMain, shell, Tray, Menu, systemPreferences } from 'electron';
import path from 'path';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import { TerminalManager } from './terminal-manager';

// ── Managed-account login system (deliberately isolated from openai-oauth*) ──
import {
  tryUseCachedToken,
  loginViaBrowser,
  fetchMe,
  registerDevice,
  getConfigs,
  fetchUsage,
  anlLogout,
} from './auth/client';
import {
  openLoginWindow,
  notifyLoginSuccess,
  notifyLoginSkip,
  cancelLoginWindow,
  isLoginWindowOpen,
  focusLoginWindow,
} from './auth/login-window';
import { startBackgroundPolling, stopBackgroundPolling } from './auth/poller';
import {
  modelConfigToManagedProviderRow,
} from './auth/managed-providers';
import {
  setBrokerServerPort,
  syncManagedProvidersToServer,
  purgeManagedProvidersOnServer,
} from './auth/broker';
import { clearAuthState } from './auth/storage';
import { initMasterKey, getMasterKeyHex, logSafeStorageStatus } from './auth/secret-key';
import { logInfo, logWarn, logError } from './auth/log';
import { HttpError, AuthExpiredError, NetworkError, type MeInfo, type ModelConfig } from './auth/types';

// ── Voice input (Bailian realtime ASR) ──
import { RealtimeAsrSession } from './asr/realtime-session';
import { getAsrConfig, invalidateAsrToken, type AsrConfig } from './asr/token-cache';

// File logger — persists main-process logs, the forked Next-server's piped
// stdout/stderr (re-console.log'd below), and renderer console output to
// app.getPath('logs'). Secrets are scrubbed before writing. See electron/logger.ts.
import { initFileLogger, openLogsFolder, getLogDir, logRendererConsole, registerKnownSecretsFromEnv } from './logger';

// Native auto-updater (research-platform V2). Reuses the managed-account auth
// infra (apiRequest Bearer + getBackendBase) for the authenticated check.
import { initUpdater, registerUpdaterIpc, stopUpdater } from './updater';

// Vendor-bundled GSD plugin — synced to ~/.claude/plugins/external_plugins/
// on first launch and version drift. See electron/gsd-installer.ts.
import {
  install as installGsdBundle,
  registerGsdIpc,
} from './gsd-installer';

// Auto-inject `skipWebFetchPreflight: true` into ~/.claude/settings.json on
// startup so users behind enterprise networks / GFW don't hit the
// "Unable to verify if domain X is safe to fetch" error from Claude Code's
// preflight call to api.anthropic.com. Respects user's explicit value if set.
import { ensureSkipWebFetchPreflight } from '../src/lib/claude-settings';

/**
 * Return a copy of process.env without __NEXT_PRIVATE_* variables.
 *
 * The bundled Next.js standalone server sets these at runtime
 * (e.g. __NEXT_PRIVATE_STANDALONE_CONFIG, __NEXT_PRIVATE_ORIGIN).
 * If they leak into child-process environments they cause every
 * other Next.js project on the machine to skip its own config
 * loading, breaking builds and dev servers.
 */
function sanitizedProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('__NEXT_PRIVATE_') && value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: Electron.UtilityProcess | null = null;
let serverPort: number | null = null;
let serverErrors: string[] = [];
let serverExited = false;
let serverExitCode: number | null = null;
let userShellEnv: Record<string, string> = {};
let resolvedProxyEnv: Record<string, string> = {};
let isQuitting = false;
let tray: Tray | null = null;
let bgNotifyTimer: ReturnType<typeof setInterval> | null = null;

// ── Managed-account auth state (held in-memory; tokens stay on disk) ──
let currentMe: MeInfo | null = null;
let isOfflineMode = false;
let managedConfigCount = 0;

// --- Install orchestrator ---
interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  error?: string;
}

interface InstallState {
  status: 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  currentStep: string | null;
  steps: InstallStep[];
  logs: string[];
}

let installState: InstallState = {
  status: 'idle',
  currentStep: null,
  steps: [],
  logs: [],
};

let installProcess: ChildProcess | null = null;

const terminalManager = new TerminalManager();

const isDev = !app.isPackaged;

/**
 * Gracefully shut down the server process.
 * Sends kill() (SIGTERM) first, waits up to 3s for exit,
 * then force-kills via process.kill(pid, SIGKILL) as fallback.
 */
function killServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    const pid = serverProcess.pid;

    const timeout = setTimeout(() => {
      // Force kill — on Windows use taskkill to kill the entire process tree
      if (pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
          } else {
            process.kill(pid, 'SIGKILL');
          }
        } catch { /* already dead */ }
      }
      serverProcess = null;
      resolve();
    }, 3000);

    serverProcess.on('exit', () => {
      clearTimeout(timeout);
      serverProcess = null;
      resolve();
    });

    // On Windows, SIGTERM is not supported — use taskkill to kill the tree
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      serverProcess.kill();
    }
  });
}

/**
 * Check if the remote bridge is currently active by querying the local API.
 */
async function isBridgeActive(): Promise<boolean> {
  if (!serverPort) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http');
    return await new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${serverPort}/api/bridge`, (res: { statusCode?: number; on: (event: string, cb: (data: Buffer) => void) => void }) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.running === true);
          } catch {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

/**
 * Stop the remote bridge by posting to the local API.
 */
async function stopBridge(): Promise<void> {
  if (!serverPort) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http');
    await new Promise<void>((resolve) => {
      const postData = JSON.stringify({ action: 'stop' });
      const req = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/bridge',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, () => { resolve(); });
      req.on('error', () => resolve());
      req.setTimeout(3000, () => { req.destroy(); resolve(); });
      req.write(postData);
      req.end();
    });
  } catch {
    // ignore — bridge may already be stopped
  }
}

/**
 * Create a system tray icon for background bridge mode.
 * Called when all windows are closed but the bridge is still active.
 */
function createTray(): void {
  if (tray) return;

  const iconPath = getIconPath();
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('AI Native Lab - 研发平台 — Bridge Active');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open AI Native Lab - 研发平台',
      click: () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow(`http://127.0.0.1:${serverPort || 3000}`);
        } else {
          mainWindow?.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Bridge Status: Active',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Stop Bridge & Quit',
      click: async () => {
        await stopBridge();
        destroyTray();
        await killServer();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click on tray icon opens the window (macOS/Windows)
  tray.on('double-click', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(`http://127.0.0.1:${serverPort || 3000}`);
    } else {
      mainWindow?.focus();
    }
  });
}

function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  stopBgNotifyPoll();
}

/**
 * Parse notification API response. Canonical version: src/lib/bg-notify-parser.ts
 */
function parseBgNotifications(json: string): Array<{ title: string; body: string; priority: string }> {
  try {
    const parsed = JSON.parse(json);
    const notifications: Array<{ title: string; body: string; priority: string }> = parsed.notifications || [];
    return notifications.filter((n: { title: string }) => n.title);
  } catch {
    return [];
  }
}

/**
 * Background notification poller — runs in main process when no renderer window
 * is open (tray-only mode). Drains the server-side notification queue and shows
 * native Notification directly, bypassing the renderer's useNotificationPoll.
 */
function startBgNotifyPoll(): void {
  if (bgNotifyTimer) return;
  const port = serverPort || 3000;

  bgNotifyTimer = setInterval(async () => {
    // Stop polling if a renderer window exists (frontend will handle it)
    if (BrowserWindow.getAllWindows().length > 0) {
      stopBgNotifyPoll();
      return;
    }

    try {
      const http = await import('http');
      const data = await new Promise<string>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/tasks/notify`, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
      });

      const notifications = parseBgNotifications(data);
      for (const notif of notifications) {
        try {
          const notification = new Notification({
            title: notif.title,
            body: notif.body || '',
          });
          notification.on('click', () => {
            // Re-open the main window when user clicks the notification
            if (BrowserWindow.getAllWindows().length === 0) {
              createWindow(`http://127.0.0.1:${port}`);
            }
            mainWindow?.show();
            mainWindow?.focus();
          });
          notification.show();
        } catch { /* best effort */ }
      }
    } catch {
      // Server may not be reachable — ignore
    }
  }, 5000);
}

function stopBgNotifyPoll(): void {
  if (bgNotifyTimer) {
    clearInterval(bgNotifyTimer);
    bgNotifyTimer = null;
  }
}

/**
 * Verify that better_sqlite3.node in standalone resources is compatible
 * with this Electron runtime's ABI. If it was built for a different
 * Node.js ABI (e.g. system Node v22 ABI 127 vs Electron's ABI 143),
 * show a clear error instead of a cryptic MODULE_NOT_FOUND crash.
 */
function checkNativeModuleABI(): void {
  if (isDev) return; // Skip in dev mode

  const standaloneDir = path.join(process.resourcesPath, 'standalone');

  // Find better_sqlite3.node recursively
  function findNodeFile(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findNodeFile(fullPath);
        if (found) return found;
      } else if (entry.name === 'better_sqlite3.node') {
        return fullPath;
      }
    }
    return null;
  }

  const nodeFile = findNodeFile(path.join(standaloneDir, 'node_modules'));
  if (!nodeFile) {
    console.warn('[ABI check] better_sqlite3.node not found in standalone resources');
    return;
  }

  try {
    // Attempt to load the native module to verify ABI compatibility
    process.dlopen({ exports: {} } as NodeModule, nodeFile);
    console.log(`[ABI check] better_sqlite3.node ABI is compatible (${nodeFile})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NODE_MODULE_VERSION')) {
      console.error(`[ABI check] ABI mismatch detected: ${msg}`);
      dialog.showErrorBox(
        'AI Native Lab - 研发平台 - Native Module ABI Mismatch',
        `The bundled better-sqlite3 native module was compiled for a different Node.js version.\n\n` +
        `${msg}\n\n` +
        `This usually means the build process did not correctly recompile native modules for Electron.\n` +
        `Please rebuild the application or report this issue.`
      );
      app.quit();
    } else {
      // Other load errors (missing dependencies, etc.) -- log but don't block
      console.warn(`[ABI check] Could not verify better_sqlite3.node: ${msg}`);
    }
  }
}

/**
 * Read the user's full shell environment by running a login shell.
 * When Electron is launched from Dock/Finder (macOS) or desktop launcher
 * (Linux), process.env is very limited and won't include vars from
 * .zshrc/.bashrc (e.g. API keys, nvm PATH).
 */
function loadUserShellEnv(): Record<string, string> {
  // Windows GUI apps inherit the full user environment
  if (process.platform === 'win32') {
    return {};
  }
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const result = execFileSync(shell, ['-ilc', 'env'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const env: Record<string, string> = {};
    for (const line of result.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx);
        const value = line.slice(idx + 1);
        env[key] = value;
      }
    }
    console.log(`Loaded ${Object.keys(env).length} env vars from user shell`);
    return env;
  } catch (err) {
    console.warn('Failed to load user shell env:', err);
    return {};
  }
}

/**
 * Resolve system proxy via Chromium's proxy resolution.
 * Chinese users often use VPN tools (Clash, Surge, etc.) that set macOS system
 * proxy but don't export HTTP_PROXY to shell env. This detects the system proxy
 * and returns env vars to inject into child processes.
 */
async function resolveSystemProxy(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  try {
    const proxyList = await session.defaultSession.resolveProxy('https://registry.npmjs.org');
    if (!proxyList || proxyList === 'DIRECT') return env;

    // Chromium returns an ordered list: "PROXY host:port; SOCKS5 host:port; DIRECT"
    // Split on ';' and use the first non-DIRECT entry.
    for (const entry of proxyList.split(';')) {
      const trimmed = entry.trim();
      if (!trimmed || trimmed === 'DIRECT') continue;

      const httpMatch = trimmed.match(/^(?:PROXY|HTTPS)\s+([\w.-]+:\d+)$/i);
      if (httpMatch) {
        env.HTTP_PROXY = `http://${httpMatch[1]}`;
        env.HTTPS_PROXY = `http://${httpMatch[1]}`;
        console.log('[proxy] System proxy detected:', env.HTTPS_PROXY);
        return env;
      }

      const socksMatch = trimmed.match(/^SOCKS5?\s+([\w.-]+:\d+)$/i);
      if (socksMatch) {
        env.HTTP_PROXY = `socks5://${socksMatch[1]}`;
        env.HTTPS_PROXY = `socks5://${socksMatch[1]}`;
        console.log('[proxy] System SOCKS proxy detected:', env.HTTPS_PROXY);
        return env;
      }
    }
  } catch (err) {
    console.warn('[proxy] Failed to resolve system proxy:', err);
  }
  return env;
}

/**
 * Check if Git Bash (bash.exe) is available on Windows.
 * Mirrors the detection logic in platform.ts:findGitBash().
 */
function findGitBashSync(): boolean {
  if (process.platform !== 'win32') return true;
  // 1. User-specified env var
  const envBash = process.env.CLAUDE_CODE_GIT_BASH_PATH || userShellEnv.CLAUDE_CODE_GIT_BASH_PATH;
  if (envBash && fs.existsSync(envBash)) return true;
  // 2. Common paths
  if (fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')) return true;
  if (fs.existsSync('C:\\Program Files (x86)\\Git\\bin\\bash.exe')) return true;
  // 3. Derive from `where git`
  try {
    const result = execFileSync('where', ['git'], {
      timeout: 3000, encoding: 'utf-8', shell: true, stdio: 'pipe',
    });
    for (const line of result.trim().split(/\r?\n/)) {
      const gitExe = line.trim();
      if (!gitExe) continue;
      const bashPath = path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe');
      if (fs.existsSync(bashPath)) return true;
    }
  } catch { /* where git failed */ }
  return false;
}

/**
 * Build an expanded PATH that includes common locations for node, npm globals,
 * claude, nvm, homebrew, etc. Shared by the server launcher and install orchestrator.
 */
function getExpandedShellPath(): string {
  const home = os.homedir();
  const shellPath = userShellEnv.PATH || process.env.PATH || '';
  const sep = path.delimiter;

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const winExtra = [
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'bin'),
    ];
    const allParts = [shellPath, ...winExtra].join(sep).split(sep).filter(Boolean);
    return [...new Set(allParts)].join(sep);
  } else {
    const basePath = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`;
    const raw = `${basePath}:${home}/.npm-global/bin:${home}/.local/bin:${home}/.claude/bin:${shellPath}`;
    const allParts = raw.split(':').filter(Boolean);
    return [...new Set(allParts)].join(':');
  }
}

/**
 * Try to bind a specific port. Resolves true if free, false if taken.
 * Both EADDRINUSE and other errors count as "not free" (we'll try the next).
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Stable port range for the embedded Next.js server.
 *
 * IMPORTANT: localStorage in the renderer is keyed by origin (scheme+host+port).
 * If we pick a random OS-assigned port (`listen(0)`) every launch, localStorage
 * is effectively wiped on every restart — which silently breaks the theme,
 * default model badge, last-selected provider, working-directory memory, and
 * any other UI state that uses localStorage. (See B-004 in issue tracker.)
 *
 * We try this range in order so the origin stays consistent across restarts.
 * Range chosen: 47823–47830 (8 ports). These are unassigned by IANA and
 * uncommon in practice. 8 candidates handles up to 8 concurrent AI Native Lab
 * instances before falling back to OS-assigned, which is plenty for normal use.
 */
const STABLE_PORTS = [47823, 47824, 47825, 47826, 47827, 47828, 47829, 47830];

/** Allocate an OS-assigned port (last-resort fallback when all stable ports fail). */
async function getDynamicPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });
  });
}

/**
 * Start the embedded server, choosing an available stable port.
 *
 * The previous implementation just probed `isPortFree` then returned the
 * port — a classic TOCTOU race when two packaged instances launch close
 * together (both observe 47823 free, the second one then loses with
 * EADDRINUSE and the app crashes). This function actually attempts to bind
 * each candidate via the real subprocess and advances to the next one if
 * the server fails to come up due to a port conflict.
 *
 * Returns the bound port. Sets the global `serverProcess` as a side effect.
 * Throws only if every candidate AND the OS-assigned fallback fail.
 */
async function startServerOnStablePort(): Promise<number> {
  for (const candidate of STABLE_PORTS) {
    // Quick pre-check skips obviously-occupied ports without spawning.
    // Not a guarantee — but cheap, and avoids a process spawn for the common
    // case where another app already owns 47823.
    if (!(await isPortFree(candidate))) {
      console.log(`[port] ${candidate} is in use, trying next stable port`);
      continue;
    }

    console.log(`[port] Attempting stable port ${candidate}...`);
    serverProcess = startServer(candidate);
    try {
      await waitForServer(candidate);
      console.log(`[port] Bound stable port ${candidate} — localStorage origin will be consistent across restarts`);
      return candidate;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isPortConflict = /EADDRINUSE|address.+(?:already )?in use|listen EACCES/i.test(msg);
      console.warn(
        `[port] Port ${candidate} failed${isPortConflict ? ' (collided with another process)' : ''}: ${msg.slice(0, 200)}` +
        (isPortConflict ? ' — trying next stable port' : ''),
      );
      // Make sure the failed subprocess is dead before trying again — otherwise
      // we'd leak processes on each retry.
      try { serverProcess?.kill(); } catch { /* already gone */ }
      serverProcess = null;

      // Non-port errors (Next.js boot crash, missing file, etc.) won't be
      // fixed by switching ports, but we still try the rest because the cost
      // is small and a transient error on the first port shouldn't be fatal.
    }
  }

  // Every stable port failed — last resort: OS-assigned dynamic port.
  // localStorage will be lost on next restart, but at least the app boots.
  console.warn(
    `[port] All stable ports (${STABLE_PORTS[0]}-${STABLE_PORTS[STABLE_PORTS.length - 1]}) failed; ` +
    `falling back to OS-assigned port. UI settings stored in localStorage (theme, last model, etc.) ` +
    `may not persist across this restart.`,
  );
  const dynamicPort = await getDynamicPort();
  serverProcess = startServer(dynamicPort);
  await waitForServer(dynamicPort);
  return dynamicPort;
}

async function waitForServer(port: number, timeout = 30000): Promise<void> {
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < timeout) {
    // If the server process already exited, fail fast
    if (serverExited) {
      throw new Error(
        `Server process exited with code ${serverExitCode}.\n\n${serverErrors.join('\n')}`
      );
    }
    try {
      await new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const http = require('http');
        // Use options object with family:4 to force IPv4 — avoids Windows
        // IPv6 resolution issues where 127.0.0.1 may fail to connect.
        const req = http.get({
          hostname: '127.0.0.1',
          port,
          path: '/api/health',
          family: 4,
          timeout: 2000,
        }, (res: { statusCode?: number }) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', (err: Error) => reject(err));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('request timeout'));
        });
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error(
    `Server startup timeout after ${timeout / 1000}s.\n\nLast health-check error: ${lastError}\n\n${serverErrors.length > 0 ? 'Server output:\n' + serverErrors.slice(-10).join('\n') : 'No server output captured.'}`
  );
}

function startServer(port: number): Electron.UtilityProcess {
  const standaloneDir = path.join(process.resourcesPath, 'standalone');
  const serverPath = path.join(standaloneDir, 'server.js');

  console.log(`Server path: ${serverPath}`);
  console.log(`Standalone dir: ${standaloneDir}`);

  serverErrors = [];
  serverExited = false;
  serverExitCode = null;

  const home = os.homedir();
  const constructedPath = getExpandedShellPath();

  const env: Record<string, string> = {
    ...userShellEnv,
    ...sanitizedProcessEnv(),
    // Ensure user shell env vars override (especially API keys)
    ...userShellEnv,
    // Inject system proxy (only if not already set in shell env)
    ...(!userShellEnv.HTTP_PROXY && !userShellEnv.HTTPS_PROXY ? resolvedProxyEnv : {}),
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    CLAUDE_GUI_DATA_DIR: path.join(home, '.codepilot'),
    HOME: home,
    USERPROFILE: home,
    PATH: constructedPath,
    // Credential-encryption master key (hex). Placed AFTER the userShellEnv
    // spreads so a stray shell var can't shadow it. Empty when safeStorage is
    // unavailable → server-side crypto-seal falls back to plaintext passthrough.
    CLAUDE_GUI_SECRET_KEY: getMasterKeyHex(),
  };

  // Register every credential the forked server will hold (master key + the
  // user's BYOK provider keys from userShellEnv, which never reach the main
  // process.env) so the file logger redacts those exact values verbatim if they
  // ever surface in the server's piped output.
  registerKnownSecretsFromEnv(env);

  // Use Electron's utilityProcess to run the server in a child process
  // without spawning a separate Dock icon on macOS.
  const child = utilityProcess.fork(serverPath, [], {
    env,
    cwd: standaloneDir,
    stdio: 'pipe',
    serviceName: 'codepilot-server',
  });

  // Buffer piped output and emit COMPLETE lines. Logging per logical line (not
  // per arbitrary pipe chunk) keeps the file log readable AND lets the logger's
  // secret scrubber see whole tokens — a value split across two 'data' events
  // would otherwise evade redaction. A 64 KB guard bounds a runaway partial line.
  const makeLineHandler = (tag: string, isErr: boolean) => {
    let buf = '';
    const emit = (line: string) => {
      const msg = line.replace(/\r$/, '');
      if (!msg) return;
      (isErr ? console.error : console.log)(`${tag} ${msg}`);
      serverErrors.push(msg);
    };
    return (data: Buffer) => {
      buf += data.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        emit(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      if (buf.length > 64 * 1024) {
        emit(buf);
        buf = '';
      }
    };
  };
  child.stdout?.on('data', makeLineHandler('[server]', false));
  child.stderr?.on('data', makeLineHandler('[server:err]', true));

  child.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`);
    serverExited = true;
    serverExitCode = code;
    serverProcess = null;
  });

  return child;
}

// ──────────────────────────────────────────────────────────────────────────
// Managed-account login helpers (electron/auth/* glue)
//
// These build on electron/auth/client.ts (which knows about the backend API)
// and electron/auth/broker.ts (which knows about the local Next.js server)
// to drive the boot sequence and produce the AuthSnapshot the renderer cares
// about. Token never leaves main.
// ──────────────────────────────────────────────────────────────────────────

interface AuthSnapshot {
  authenticated: boolean;
  offline: boolean;
  me: { username: string; display_name: string; email?: string; plan?: string } | null;
  managedConfigCount: number;
}

function buildAuthSnapshot(): AuthSnapshot {
  return {
    authenticated: !!currentMe || isOfflineMode,
    offline: isOfflineMode,
    me: currentMe
      ? {
          username: currentMe.username,
          display_name: currentMe.display_name,
          email: currentMe.email,
          plan: currentMe.plan,
        }
      : null,
    managedConfigCount,
  };
}

/** Push the latest snapshot to the renderer. Safe to call before main window exists. */
function broadcastAuthChange(): void {
  const snapshot = buildAuthSnapshot();
  try {
    mainWindow?.webContents.send('auth:changed', snapshot);
  } catch {
    // window may have been torn down — ignore
  }
}

/** Push ModelConfig[] to the embedded server so api_providers reflects reality. */
async function syncManagedFromConfigs(configs: ModelConfig[]): Promise<void> {
  const rows = configs.map((c) => modelConfigToManagedProviderRow(c));
  try {
    const result = await syncManagedProvidersToServer(rows);
    managedConfigCount = configs.length;
    logInfo('managed providers synced: upserted=', result.upserted, 'pruned=', result.pruned);
  } catch (err) {
    logError('failed to sync managed providers to server:', (err as Error).message);
  }
}

/**
 * Initial boot pass — runs once after the embedded server is ready.
 *
 * Behaviour matrix (also documented in docs/exec-plans/active/login-system.md):
 *
 *   token absent           → unauthenticated (no UI prompt)
 *   probe 200              → fetchMe → registerDevice → getConfigs → sync → poller start
 *   probe 401              → clear token + purge managed + push 'auth:changed'
 *   probe network error    → load cached configs.json + me_json, offline mode
 *
 * Errors are caught and logged — boot failure must not crash the app.
 */
/**
 * Boot pass with **mandatory** login enforcement.
 *
 * Resolves only after one of:
 *   - cached token still works (online or offline) → fetch /me, register
 *     device, sync configs, start poller
 *   - user completes a fresh browser OAuth → post-login sequence ran inside
 *     the auth:run-login-flow IPC handler, so this function just broadcasts
 *     the resulting snapshot
 *   - user dismisses the login window without authenticating → app.quit()
 *     fires and the returned promise never resolves (the renderer will be
 *     torn down anyway).
 *
 * Callers MUST await this before loading the main window URL so the
 * user can't bypass the gate by interacting with a half-loaded UI.
 */
async function bootAccountState(): Promise<void> {
  try {
    const cached = await tryUseCachedToken();
    if (!cached.alive) {
      // STRICT LOGIN: no usable token → force the login window. allowSkip is
      // false so the renderer-side "skip" button stays hidden, but we still
      // treat 'skipped' as a quit signal defensively.
      const outcome = await openLoginWindow({ allowSkip: false });
      if (outcome !== 'success') {
        logInfo('login window dismissed without success — quitting');
        app.quit();
        return;
      }
      // Login succeeded — the auth:run-login-flow IPC handler already kicked
      // off postLoginSequence (fetchMe / registerDevice / getConfigs / start
      // poller) in the background. Push whatever snapshot we have now;
      // postLoginSequence will broadcast again when it finishes.
      broadcastAuthChange();
      return;
    }

    isOfflineMode = cached.offline;

    if (!isOfflineMode) {
      try {
        currentMe = await fetchMe();
        logInfo('fetched me:', currentMe.username);
      } catch (e) {
        logWarn('fetchMe failed at boot:', (e as Error).message);
      }
      try {
        await registerDevice();
      } catch (e) {
        logWarn('registerDevice failed at boot:', (e as Error).message);
      }
    }

    try {
      const configs = await getConfigs({ force: true });
      await syncManagedFromConfigs(configs);
    } catch (e) {
      logWarn('getConfigs failed at boot:', (e as Error).message);
    }

    if (!isOfflineMode) {
      startBackgroundPolling({
        onConfigsChanged: (configs) => {
          void syncManagedFromConfigs(configs);
          broadcastAuthChange();
        },
      });
    }
  } catch (e) {
    logError('bootAccountState fatal error:', (e as Error).message);
  } finally {
    broadcastAuthChange();
  }
}

/** Full post-login pass — invoked after a successful interactive login. */
async function postLoginSequence(): Promise<void> {
  isOfflineMode = false;
  try {
    currentMe = await fetchMe();
  } catch (e) {
    logWarn('postLogin fetchMe failed:', (e as Error).message);
  }
  try {
    await registerDevice();
  } catch (e) {
    logWarn('postLogin registerDevice failed:', (e as Error).message);
  }
  try {
    const configs = await getConfigs({ force: true });
    await syncManagedFromConfigs(configs);
  } catch (e) {
    logWarn('postLogin getConfigs failed:', (e as Error).message);
  }
  startBackgroundPolling({
    onConfigsChanged: (configs) => {
      void syncManagedFromConfigs(configs);
      broadcastAuthChange();
    },
  });
  broadcastAuthChange();
}

/** Full post-logout pass — invoked after the user explicitly logs out. */
async function postLogoutSequence(): Promise<void> {
  stopBackgroundPolling();
  try {
    await purgeManagedProvidersOnServer();
  } catch (e) {
    logWarn('postLogout purge failed:', (e as Error).message);
  }
  currentMe = null;
  isOfflineMode = false;
  managedConfigCount = 0;
  broadcastAuthChange();
}

/**
 * Re-gate the app after an explicit logout, matching the strict-login
 * promise: the main window can never be visible while the user is
 * unauthenticated.
 *
 * Flow:
 *   1. Replace mainWindow's content with LOADING_HTML so the chat /
 *      settings UI is hidden (the React tree is torn down — this is
 *      desirable because Account/Provider sections no longer have
 *      meaningful state anyway).
 *   2. Open the login window with allowSkip=false. Anything other than
 *      'success' triggers app.quit() — same gate as startup.
 *   3. On success, reload the server URL so the user lands back in the
 *      app with their freshly-issued token.
 *
 * Runs fire-and-forget from the auth:logout IPC handler so the IPC reply
 * lands before we navigate the main window away.
 */
async function rePromptLoginAfterLogout(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(LOADING_HTML);
  }
  const outcome = await openLoginWindow({ allowSkip: false });
  if (outcome !== 'success') {
    logInfo('post-logout login dismissed — quitting');
    app.quit();
    return;
  }
  // Login succeeded → auth:run-login-flow handler already ran
  // postLoginSequence in the background. Bring the user back to the
  // main app.
  if (mainWindow && !mainWindow.isDestroyed() && serverPort !== null) {
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  }
}

function getIconPath(): string {
  if (isDev) {
    return path.join(process.cwd(), 'build', 'icon.png');
  }
  if (process.platform === 'win32') {
    return path.join(process.resourcesPath, 'icon.ico');
  }
  if (process.platform === 'linux') {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(process.resourcesPath, 'icon.icns');
}

/** Inline loading HTML shown while the server starts up */
const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0a0a0a; color: #a0a0a0;
    -webkit-app-region: drag;
  }
  .container { text-align: center; }
  .spinner {
    width: 28px; height: 28px; margin: 0 auto 14px;
    border: 2.5px solid rgba(255,255,255,0.1);
    border-top-color: rgba(255,255,255,0.5);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { font-size: 13px; opacity: 0.7; }
</style>
</head>
<body>
<div class="container">
  <div class="spinner"></div>
  <p>Starting AI Native Lab - 研发平台...</p>
</div>
</body>
</html>`)}`;

function createWindow(url?: string) {
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 600,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.vibrancy = 'sidebar';
  } else if (process.platform === 'win32') {
    windowOptions.titleBarStyle = 'hidden';
    windowOptions.titleBarOverlay = {
      color: '#00000000',
      symbolColor: '#888888',
      height: 44,
    };
  }

  mainWindow = new BrowserWindow(windowOptions);

  // 麦克风：renderer getUserMedia 需 session 放行 'media'。本应用只加载第一方可信内容
  // （本地 Next server），故全放行 —— 无 handler 时本就等于全放行，显式设置不引入回归。
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);

  // External links: open in system default browser instead of Electron
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      shell.openExternal(targetUrl);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    // Allow navigating within the app (localhost dev server)
    const appOrigin = new URL(mainWindow!.webContents.getURL()).origin;
    if (new URL(targetUrl).origin !== appOrigin) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  // Capture renderer-process console warnings/errors into the file log so
  // UI-side failures (React error boundary, uncaught renderer exceptions
  // surfaced as console errors) are diagnosable too.
  mainWindow.webContents.on('console-message', (details: unknown, levelArg: unknown, messageArg: unknown, lineArg: unknown, sourceIdArg: unknown) => {
    try {
      // Electron 40 emits a single details object ({ message, level, lineNumber,
      // sourceId }); older majors used positional args (still emitted but
      // @deprecated). Read from whichever is present so renderer capture
      // survives the eventual removal of the positional form.
      const d = details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined;
      const message = d && 'message' in d ? d.message : messageArg;
      const level = d && 'level' in d ? d.level : levelArg;
      const lineNo = d && 'lineNumber' in d ? d.lineNumber : lineArg;
      const sourceId = d && 'sourceId' in d ? d.sourceId : sourceIdArg;
      // Keep only warnings/errors — drop verbose/info noise. Level is a string
      // ('warning'|'error') in the new form, a number (2|3) in the old.
      if (level === 'error' || level === 'warning' || level === 2 || level === 3) {
        logRendererConsole(
          String(message ?? ''),
          typeof lineNo === 'number' ? lineNo : undefined,
          typeof sourceId === 'string' ? sourceId : undefined,
        );
      }
    } catch {
      /* never let logging break the window */
    }
  });

  // Terminal shells are owned by the renderer session that opened them. When
  // that session goes away — renderer crash, or a full document reload/cross-doc
  // navigation — the renderer drops its terminal UI but the backing shell
  // processes keep running and keep piping output to a dead webContents. Reap
  // them on every such transition so they don't accumulate. (Window-close is
  // handled in the 'closed' handler below; on macOS that path matters most
  // because closing the window does not quit the app.)
  mainWindow.webContents.on('render-process-gone', () => {
    terminalManager.killAll();
  });
  mainWindow.webContents.on('did-start-navigation', (details) => {
    // Only a real document swap in the main frame orphans the terminals;
    // in-page same-document SPA navigation (Next.js client routing) does not.
    if (details.isMainFrame && !details.isSameDocument) {
      terminalManager.killAll();
    }
  });

  mainWindow.loadURL(url || LOADING_HTML);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    // Renderer session ended — reap any shells it left running so they don't
    // linger in the background (notably on macOS, where the app stays alive).
    terminalManager.killAll();
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Initialise file logging FIRST so every subsequent console.* in main — and
  // the forked server's piped output we re-log below — is persisted to disk,
  // and uncaught crashes are captured. Must run before the server fork.
  initFileLogger();

  // Load user's full shell environment (API keys, PATH, etc.)
  userShellEnv = loadUserShellEnv();

  // Detect system proxy for Chinese users behind VPN (Clash, Surge, etc.)
  resolvedProxyEnv = await resolveSystemProxy();

  // Verify native module ABI compatibility before starting the server
  checkNativeModuleABI();

  // Initialise the credential-encryption master key BEFORE any server fork so
  // its hex can be injected into the server env (startServer below). safeStorage
  // is available now (app is ready). See electron/auth/secret-key.ts.
  initMasterKey();
  logSafeStorageStatus();

  // Clear cache on version upgrade
  const currentVersion = app.getVersion();
  const versionFilePath = path.join(app.getPath('userData'), 'last-version.txt');
  try {
    const lastVersion = fs.existsSync(versionFilePath)
      ? fs.readFileSync(versionFilePath, 'utf-8').trim()
      : '';
    if (lastVersion && lastVersion !== currentVersion) {
      console.log(`Version changed from ${lastVersion} to ${currentVersion}, clearing cache...`);
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({
        storages: ['cachestorage', 'serviceworkers'],
      });
      console.log('Cache cleared successfully');
    }
    fs.writeFileSync(versionFilePath, currentVersion, 'utf-8');
  } catch (err) {
    console.warn('Failed to check/clear version cache:', err);
  }

  // Set macOS Dock icon
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = getIconPath();
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  // --- Vendor-bundled GSD: sync (fire-and-forget, never blocks startup) ---
  registerGsdIpc(ipcMain);
  Promise.resolve()
    .then(() => {
      const status = installGsdBundle({
        log: (msg) => console.log(msg),
      });
      if (status.lastError) {
        console.warn('[gsd-installer] startup sync had error:', status.lastError);
      } else if (status.conflicts.length > 0) {
        console.warn(
          `[gsd-installer] startup sync OK with ${status.conflicts.length} agent mirror conflicts (user-modified files skipped)`,
        );
      }
    })
    .catch((err) => {
      console.error('[gsd-installer] startup sync threw:', err);
    });

  // --- Auto-inject skipWebFetchPreflight into ~/.claude/settings.json ---
  // Pre-empts the common "Unable to verify if domain X is safe to fetch"
  // error users behind enterprise networks / GFW see when Claude Code's
  // WebFetch preflight call to api.anthropic.com is blocked. The function
  // is synchronous, never throws, and respects user's explicit value (true
  // OR false) if they've already set it. Wrapped in Promise.resolve() to
  // match GSD's fire-and-forget pattern.
  Promise.resolve()
    .then(() => {
      const result = ensureSkipWebFetchPreflight();
      if (result.error) {
        console.warn('[claude-settings] skipWebFetchPreflight ensure had error:', result.error);
      } else if (result.updated) {
        console.log(`[claude-settings] injected skipWebFetchPreflight: true into ${result.path}`);
      } else if (result.skipped) {
        // User already set it (true or false) — log nothing, this is the steady state
      }
    })
    .catch((err) => {
      console.error('[claude-settings] skipWebFetchPreflight ensure threw:', err);
    });

  // --- Install wizard IPC handlers ---

  ipcMain.handle('install:check-prerequisites', async () => {
    const expandedPath = getExpandedShellPath();
    const execEnv = { ...sanitizedProcessEnv(), ...userShellEnv, PATH: expandedPath };

    // Candidate paths — native first, then bun, then homebrew, then npm
    const home = os.homedir();
    const candidatePaths = process.platform === 'win32'
      ? [
          path.join(home, '.local', 'bin', 'claude.exe'),
          path.join(home, '.local', 'bin', 'claude.cmd'),
          path.join(home, '.claude', 'bin', 'claude.exe'),
          path.join(home, '.claude', 'bin', 'claude.cmd'),
          path.join(home, '.bun', 'bin', 'claude.exe'),
          path.join(home, '.bun', 'bin', 'claude.cmd'),
          path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
          path.join(process.env.LOCALAPPDATA || '', 'npm', 'claude.cmd'),
        ].filter(p => p && !p.startsWith(path.sep))
      : [
          path.join(home, '.local', 'bin', 'claude'),
          path.join(home, '.claude', 'bin', 'claude'),
          path.join(home, '.bun', 'bin', 'claude'),
          '/opt/homebrew/bin/claude',
          '/usr/local/bin/claude',
          path.join(home, '.npm-global', 'bin', 'claude'),
        ];

    function classifyPath(p: string): 'native' | 'homebrew' | 'npm' | 'bun' | 'unknown' {
      const n = p.replace(/\\/g, '/');
      if (n.includes('/.local/bin/') || n.includes('/.claude/bin/')) return 'native';
      if (n.includes('/.bun/bin/') || n.includes('/.bun/install/')) return 'bun';
      if (n.includes('/homebrew/') || n.includes('/Cellar/')) return 'homebrew';
      if (n.includes('/npm')) return 'npm';
      if (n === '/usr/local/bin/claude') {
        try {
          const real = fs.realpathSync(p);
          if (real.includes('node_modules')) return 'npm';
          if (real.includes('homebrew') || real.includes('Cellar')) return 'homebrew';
          if (real.includes('.bun')) return 'bun';
        } catch { /* ignore */ }
        return 'unknown';
      }
      return 'unknown';
    }

    interface Detection { path: string; version: string | null; type: string }
    const allInstalls: Detection[] = [];
    const seenReal = new Set<string>();

    for (const p of candidatePaths) {
      try {
        let realPath: string;
        try { realPath = fs.realpathSync(p); } catch { realPath = p; }
        if (seenReal.has(realPath)) continue;

        const isWin = process.platform === 'win32';
        const shell = isWin && /\.(cmd|bat)$/i.test(p);
        const result = execFileSync(p, ['--version'], {
          timeout: 5000, encoding: 'utf-8', env: execEnv, shell, stdio: 'pipe',
        });
        seenReal.add(realPath);
        allInstalls.push({ path: p, version: result.trim() || null, type: classifyPath(p) });
      } catch {
        // not at this path
      }
    }

    // Also scan PATH via which/where to catch bun, custom, or other non-standard installs
    try {
      const isWinPlatform = process.platform === 'win32';
      const cmd = isWinPlatform ? 'where' : '/usr/bin/which';
      const args = isWinPlatform ? ['claude'] : ['-a', 'claude']; // -a = show ALL matches
      const whichResult = execFileSync(cmd, args, {
        timeout: 3000, encoding: 'utf-8', env: execEnv,
        shell: isWinPlatform, stdio: 'pipe',
      });
      for (const line of whichResult.trim().split(/\r?\n/)) {
        const candidate = line.trim();
        if (!candidate) continue;
        try {
          let realPath: string;
          try { realPath = fs.realpathSync(candidate); } catch { realPath = candidate; }
          if (seenReal.has(realPath)) continue;

          const shell = isWinPlatform && /\.(cmd|bat)$/i.test(candidate);
          const result = execFileSync(candidate, ['--version'], {
            timeout: 5000, encoding: 'utf-8', env: execEnv, shell, stdio: 'pipe',
          });
          seenReal.add(realPath);
          allInstalls.push({ path: candidate, version: result.trim() || null, type: classifyPath(candidate) });
        } catch {
          // invalid binary at this path
        }
      }
    } catch {
      // which/where failed
    }

    const primary = allInstalls[0];
    const hasClaude = !!primary;

    // On Windows, check for Git Bash (bash.exe) — this is what the SDK actually uses at runtime.
    // Must match the detection strategy in platform.ts:findGitBash() to avoid false negatives.
    let hasGit = true; // default true for non-Windows
    if (process.platform === 'win32') {
      hasGit = false;
      // 1. User-specified env var
      const envBash = process.env.CLAUDE_CODE_GIT_BASH_PATH || userShellEnv.CLAUDE_CODE_GIT_BASH_PATH;
      if (envBash && fs.existsSync(envBash)) {
        hasGit = true;
      }
      // 2. Common installation paths
      if (!hasGit) {
        const commonPaths = [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        ];
        if (commonPaths.some(p => fs.existsSync(p))) {
          hasGit = true;
        }
      }
      // 3. Derive from `where git`
      if (!hasGit) {
        try {
          const whereResult = execFileSync('where', ['git'], {
            timeout: 3000, encoding: 'utf-8', shell: true, stdio: 'pipe',
          });
          for (const line of whereResult.trim().split(/\r?\n/)) {
            const gitExe = line.trim();
            if (!gitExe) continue;
            const gitDir = path.dirname(path.dirname(gitExe));
            const bashPath = path.join(gitDir, 'bin', 'bash.exe');
            if (fs.existsSync(bashPath)) {
              hasGit = true;
              break;
            }
          }
        } catch {
          // where git failed
        }
      }
    }

    return {
      hasClaude,
      claudeVersion: primary?.version,
      claudePath: primary?.path,
      claudeInstallType: primary?.type,
      otherInstalls: allInstalls.slice(1),
      hasGit,
      platform: process.platform,
    };
  });

  ipcMain.handle('install:start', () => {
    if (installState.status === 'running') {
      throw new Error('Installation is already running');
    }

    // On Windows, check if Git Bash is missing and prepend an install step
    const isWin = process.platform === 'win32';
    const needsGit = isWin && !findGitBashSync();

    const steps: InstallStep[] = [
      ...(needsGit ? [{ id: 'install-git', label: 'Installing Git for Windows', status: 'pending' as const }] : []),
      { id: 'install-claude', label: 'Installing Claude Code (native)', status: 'pending' },
      { id: 'verify', label: 'Verifying installation', status: 'pending' },
    ];

    installState = {
      status: 'running',
      currentStep: null,
      steps,
      logs: [],
    };

    const expandedPath = getExpandedShellPath();
    const home = os.homedir();
    const execEnv: Record<string, string> = {
      ...userShellEnv,
      ...sanitizedProcessEnv(),
      ...userShellEnv,
      PATH: expandedPath,
    };

    function sendProgress() {
      mainWindow?.webContents.send('install:progress', installState);
    }

    function setStep(id: string, status: InstallStep['status'], error?: string) {
      const step = installState.steps.find(s => s.id === id);
      if (step) {
        step.status = status;
        step.error = error;
      }
      installState.currentStep = id;
      sendProgress();
    }

    function addLog(line: string) {
      installState.logs.push(line);
      sendProgress();
    }

    // Run the installation sequence asynchronously
    (async () => {
      try {
        // Step 0 (Windows only): Install Git for Windows if missing
        if (needsGit) {
          setStep('install-git', 'running');
          addLog('Installing Git for Windows via winget...');

          const gitSuccess = await new Promise<boolean>((resolve) => {
            const child = spawn('winget', [
              'install', 'Git.Git',
              '--silent',
              '--accept-package-agreements',
              '--accept-source-agreements',
            ], {
              env: execEnv,
              shell: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            installProcess = child;

            child.stdout?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n').filter(Boolean)) addLog(line);
            });
            child.stderr?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n').filter(Boolean)) addLog(line);
            });
            child.on('error', (err) => { addLog(`Error: ${err.message}`); resolve(false); });
            child.on('close', (code) => {
              installProcess = null;
              resolve(code === 0);
            });
          });

          if (installState.status === 'cancelled') {
            setStep('install-git', 'failed', 'Cancelled');
            return;
          }
          if (!gitSuccess) {
            // Non-fatal: skip Git install and continue with Claude.
            // The user can install Git manually later.
            addLog('winget not available or install failed. Skipping — please install Git for Windows manually from https://git-scm.com/downloads/win');
            setStep('install-git', 'skipped', 'Auto-install skipped. Please install Git manually.');
          } else {
            addLog('Git for Windows installed successfully.');
            setStep('install-git', 'success');
          }
        }

        // Step 1: Install Claude Code via native installer
        setStep('install-claude', 'running');

        if (isWin) {
          // Windows: download and run install.cmd
          addLog('Downloading native installer for Windows...');

          const installSuccess = await new Promise<boolean>((resolve) => {
            // Download install.cmd to temp, then execute it
            const tmpDir = os.tmpdir();
            const installCmd = path.join(tmpDir, 'claude-install.cmd');

            const downloadChild = spawn('curl', ['-fsSL', 'https://claude.ai/install.cmd', '-o', installCmd], {
              env: execEnv,
              shell: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            installProcess = downloadChild;

            downloadChild.stderr?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n').filter(Boolean)) addLog(line);
            });

            downloadChild.on('close', (dlCode) => {
              if (dlCode !== 0) {
                addLog('Failed to download installer.');
                resolve(false);
                return;
              }

              addLog('Running installer...');
              const child = spawn(installCmd, [], {
                env: execEnv,
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
              });
              installProcess = child;

              child.stdout?.on('data', (data: Buffer) => {
                for (const line of data.toString().split('\n').filter(Boolean)) addLog(line);
              });
              child.stderr?.on('data', (data: Buffer) => {
                for (const line of data.toString().split('\n').filter(Boolean)) addLog(line);
              });
              child.on('error', (err) => { addLog(`Error: ${err.message}`); resolve(false); });
              child.on('close', (code) => {
                installProcess = null;
                // Clean up temp file
                try { fs.unlinkSync(installCmd); } catch { /* ignore */ }
                resolve(code === 0);
              });
            });

            downloadChild.on('error', (err) => {
              addLog(`Download error: ${err.message}`);
              resolve(false);
            });
          });

          if (installState.status === 'cancelled') {
            setStep('install-claude', 'failed', 'Cancelled');
            return;
          }
          if (!installSuccess) {
            setStep('install-claude', 'failed', 'Native installer failed. Check logs for details.');
            installState.status = 'failed';
            sendProgress();
            return;
          }
        } else {
          // macOS / Linux: curl | bash
          addLog('Running: curl -fsSL https://claude.ai/install.sh | bash');

          const installSuccess = await new Promise<boolean>((resolve) => {
            const userShell = process.env.SHELL || '/bin/bash';
            const child = spawn(userShell, ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], {
              env: execEnv,
              stdio: ['ignore', 'pipe', 'pipe'],
            });

            installProcess = child;

            child.stdout?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n').filter(Boolean)) addLog(line);
            });
            child.stderr?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n').filter(Boolean)) addLog(line);
            });
            child.on('error', (err) => { addLog(`Error: ${err.message}`); resolve(false); });
            child.on('close', (code) => {
              installProcess = null;
              if (code === 0) {
                addLog('Native installer completed successfully.');
                resolve(true);
              } else if (installState.status === 'cancelled') {
                addLog('Installation was cancelled.');
                resolve(false);
              } else {
                addLog(`Installer exited with code ${code}`);
                resolve(false);
              }
            });
          });

          if (installState.status === 'cancelled') {
            setStep('install-claude', 'failed', 'Cancelled');
            return;
          }
          if (!installSuccess) {
            setStep('install-claude', 'failed', 'Native installer failed. Check logs for details.');
            installState.status = 'failed';
            sendProgress();
            return;
          }
        }

        setStep('install-claude', 'success');

        // Step 2: Verify claude is available
        setStep('verify', 'running');

        // Native installer puts binary in ~/.local/bin/claude — add to PATH for verification
        const verifyPath = `${path.join(home, '.local', 'bin')}${path.delimiter}${expandedPath}`;
        const verifyEnv = { ...execEnv, PATH: verifyPath };

        try {
          const verifyOpts = isWin
            ? { timeout: 5000, encoding: 'utf-8' as const, env: verifyEnv, shell: true, stdio: 'pipe' as const }
            : { timeout: 5000, encoding: 'utf-8' as const, env: verifyEnv, stdio: 'pipe' as const };
          const claudeResult = execFileSync('claude', ['--version'], verifyOpts);
          addLog(`Claude Code installed: ${claudeResult.trim()}`);
          setStep('verify', 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog(`Verification failed: ${msg}`);
          setStep('verify', 'failed', 'Claude Code was installed but could not be verified.');
          installState.status = 'failed';
          sendProgress();
          return;
        }

        installState.status = 'success';
        installState.currentStep = null;
        sendProgress();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`Unexpected error: ${msg}`);
        installState.status = 'failed';
        sendProgress();
      }
    })();
  });

  ipcMain.handle('install:cancel', () => {
    if (installState.status !== 'running') {
      return;
    }

    installState.status = 'cancelled';
    installState.logs.push('Cancelling installation...');

    if (installProcess) {
      const pid = installProcess.pid;
      try {
        if (process.platform === 'win32' && pid) {
          // Windows: kill entire process tree (shell: true spawns cmd.exe which
          // spawns npm/winget — child.kill() only kills the shell, not the tree)
          spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
        } else {
          installProcess.kill();
        }
      } catch {
        // already dead
      }
      installProcess = null;
      installState.logs.push('Installation process terminated.');
    }

    mainWindow?.webContents.send('install:progress', installState);
  });

  ipcMain.handle('install:get-logs', () => {
    return installState.logs;
  });

  // Install Git for Windows via winget (called from ConnectionStatus dialog)
  ipcMain.handle('install:git', async () => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Git installation is only needed on Windows' };
    }
    try {
      const expandedPath = getExpandedShellPath();
      const execEnv = { ...sanitizedProcessEnv(), ...userShellEnv, PATH: expandedPath };

      const result = await new Promise<{ success: boolean; output: string }>((resolve) => {
        let output = '';
        const child = spawn('winget', [
          'install', 'Git.Git',
          '--silent',
          '--accept-package-agreements',
          '--accept-source-agreements',
        ], {
          env: execEnv,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
        child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
        child.on('error', (err) => { resolve({ success: false, output: err.message }); });
        child.on('close', (code) => { resolve({ success: code === 0, output: output.trim() }); });
      });

      return result;
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- End install wizard IPC handlers ---

  // Open a folder in the system file manager (Finder / Explorer)
  ipcMain.handle('shell:open-path', async (_event: Electron.IpcMainInvokeEvent, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  // Open the application log directory (so users can find & share logs when
  // reporting a problem). Returns '' on success, else an error string.
  ipcMain.handle('logs:open-folder', async () => openLogsFolder());
  ipcMain.handle('logs:get-path', async () => getLogDir());

  // Bridge status IPC
  ipcMain.handle('bridge:is-active', async () => {
    return isBridgeActive();
  });

  // Native folder picker dialog
  ipcMain.handle('dialog:open-folder', async (_event, options?: { defaultPath?: string; title?: string }) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Select a project folder',
      defaultPath: options?.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  // --- Widget export IPC handler ---
  // Uses an isolated BrowserWindow for secure, high-fidelity widget screenshot.
  // The window is hidden, has its own session partition, no preload, no IPC access.
  ipcMain.handle('widget:export-png', async (_event, { html, width }: { html: string; width: number }) => {
    const exportWindow = new BrowserWindow({
      show: false,
      width,
      height: 2000,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: `export-${Date.now()}`, // isolated session, destroyed with window
        // No preload — no IPC access from this window
      },
    });

    // Block all navigation and window.open — prevents data exfiltration via top-level nav
    exportWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    exportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    try {
      // Load the widget HTML directly
      await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      // Wait for widget scripts to finish (scriptsReady signal or timeout)
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        // Listen for console message from widget:scriptsReady
        exportWindow.webContents.on('console-message', (_e, _level, message) => {
          if (message === '__scriptsReady__') done();
        });
        // Fallback timeout for widgets without CDN/scripts
        setTimeout(done, 6000);
      });

      // Extra delay for final paint
      await new Promise(r => setTimeout(r, 300));

      // Get actual content height and resize
      const contentHeight = await exportWindow.webContents.executeJavaScript('document.body.scrollHeight');
      exportWindow.setSize(width, Math.min(contentHeight + 20, 4000));
      await new Promise(r => setTimeout(r, 100));

      // Capture using Chromium's native screenshot
      const image = await exportWindow.webContents.capturePage();
      return image.toPNG().toString('base64');
    } finally {
      exportWindow.destroy();
    }
  });

  // --- Artifact long-shot export (Phase 3) ---
  // Captures an arbitrary HTML source as a single full-page PNG, using
  // Chromium's CDP captureBeyondViewport so we can exceed the viewport
  // height without manual stitching. Runs in an isolated hidden
  // BrowserWindow with its own session partition (mirrors
  // widget:export-png's security envelope).
  //
  // Module-level export lock serializes concurrent calls; capturePage +
  // debugger.attach don't play nicely with a second export starting on
  // the same machine before the first finishes.
  let exportLongShotBusy = false;

  ipcMain.handle('artifact:export-long-shot', async (_event, params: {
    html: string;
    width: number;
    pixelRatio?: number;
    outPath?: string;
    maxHeightPx?: number;
    timeoutMs?: number;
  }) => {
    if (exportLongShotBusy) {
      return { error: 'busy' as const };
    }
    exportLongShotBusy = true;

    const {
      html,
      width,
      pixelRatio = 2,
      outPath,
      maxHeightPx = 50000,
      timeoutMs = 30000,
    } = params;

    const exportWindow = new BrowserWindow({
      show: false,
      width,
      height: 2000,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: `artifact-export-${Date.now()}`,
      },
    });
    exportWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    exportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    let timeoutHandle: NodeJS.Timeout | null = null;
    const deadline = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    try {
      await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      // Give the document a chance to finish layout + image loading. We
      // race a scriptsReady console signal against a fixed ceiling.
      const readyRace = Promise.race([
        new Promise<'ready'>((resolve) => {
          exportWindow.webContents.on('console-message', (_e, _level, message) => {
            if (message === '__scriptsReady__') resolve('ready');
          });
          // Unconditional floor — even if the page never emits scriptsReady,
          // we still resolve after 3s so simple HTML artifacts render.
          setTimeout(() => resolve('ready'), 3000);
        }),
        deadline,
      ]);
      const readyResult = await readyRace;
      if (readyResult === 'timeout') {
        return { error: 'timeout' as const };
      }
      // Small extra delay so image repaints settle before we measure height.
      await new Promise((r) => setTimeout(r, 200));

      const contentHeight: number = await exportWindow.webContents.executeJavaScript(
        'document.body.scrollHeight',
      );
      if (contentHeight > maxHeightPx) {
        return {
          error: 'canvas_limit' as const,
          meta: { contentHeight, maxHeightPx },
        };
      }

      // Use CDP Page.captureScreenshot with captureBeyondViewport so we
      // don't need to size the window up to the content or stitch segments.
      // debugger.attach is independent of DevTools; the export window
      // itself is hidden so DevTools never attach to it.
      try {
        exportWindow.webContents.debugger.attach('1.3');
      } catch (err) {
        return {
          error: 'debugger_busy' as const,
          meta: { detail: String(err) },
        };
      }

      let pngBase64: string;
      try {
        const result = await exportWindow.webContents.debugger.sendCommand(
          'Page.captureScreenshot',
          {
            format: 'png',
            captureBeyondViewport: true,
            // Force device-pixel ratio so the produced image matches the
            // user's monitor scale — without this, retina users get a
            // half-resolution PNG.
            // Note: CDP doesn't take pixelRatio directly; we size via
            // clip + deviceScaleFactor below if needed.
          },
        );
        pngBase64 = (result as { data: string }).data;
      } finally {
        try {
          exportWindow.webContents.debugger.detach();
        } catch {
          // Detach failures are harmless — the window destroy below
          // tears everything down regardless.
        }
      }

      if (outPath) {
        const fs = await import('fs/promises');
        const buf = Buffer.from(pngBase64, 'base64');
        await fs.writeFile(outPath, buf);
        return { path: outPath, bytes: buf.length };
      }
      return { base64: pngBase64, bytes: Buffer.from(pngBase64, 'base64').length };
    } catch (err) {
      return {
        error: 'oom' as const,
        meta: { detail: err instanceof Error ? err.message : String(err) },
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      exportWindow.destroy();
      exportLongShotBusy = false;
      // Unused here but kept to signal we didn't forget the pixelRatio
      // param — Phase 3 follow-up may wire it via deviceScaleFactor emu.
      void pixelRatio;
    }
  });

  // --- Terminal IPC handlers ---
  terminalManager.setOnData((id, data) => {
    mainWindow?.webContents.send('terminal:data', { id, data });
  });

  terminalManager.setOnExit((id, code) => {
    mainWindow?.webContents.send('terminal:exit', { id, code });
  });

  ipcMain.handle('terminal:create', async (_event, opts: { id: string; cwd: string; cols: number; rows: number }) => {
    terminalManager.create(opts.id, {
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: userShellEnv,
    });
  });

  ipcMain.on('terminal:write', (_event, data: { id: string; data: string }) => {
    terminalManager.write(data.id, data.data);
  });

  ipcMain.handle('terminal:resize', async (_event, data: { id: string; cols: number; rows: number }) => {
    terminalManager.resize(data.id, data.cols, data.rows);
  });

  ipcMain.handle('terminal:kill', async (_event, id: string) => {
    terminalManager.kill(id);
  });

  // --- End terminal IPC handlers ---

  // ===== 语音转文字（百炼实时 ASR）IPC =====
  let asrSession: RealtimeAsrSession | null = null;

  // macOS 需要系统级麦克风授权（TCC）；Win/Linux 直接放行。
  const ensureMicPermission = async (): Promise<boolean> => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  };

  ipcMain.handle('asr:request-mic-permission', async () => {
    try {
      return { granted: await ensureMicPermission() };
    } catch (e) {
      return { granted: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('asr:start', async () => {
    if (asrSession) { asrSession.stop(); asrSession = null; }

    const sendTranscript = (p: unknown) => mainWindow?.webContents.send('asr:transcript', p);
    const sendState = (state: string) => mainWindow?.webContents.send('asr:state', { state });
    const sendError = (code: string, message: string) => mainWindow?.webContents.send('asr:error', { code, message });

    // 开一个会话，并把「是否成功进入 listening」变成可 await 的结果（用于 401 重试）。
    const attempt = (cfg: AsrConfig) =>
      new Promise<{ ok: true } | { ok: false; status?: number; error: string }>((resolve) => {
        let settled = false;
        const session = new RealtimeAsrSession(cfg, {
          onPartial: (text, stash) => sendTranscript({ kind: 'partial', text, stash }),
          onFinal: (transcript) => sendTranscript({ kind: 'final', transcript }),
          onState: (s) => {
            sendState(s);
            if (s === 'listening' && !settled) { settled = true; resolve({ ok: true }); }
            if (s === 'closed' && !settled) { settled = true; resolve({ ok: false, error: 'closed before ready' }); }
          },
          onError: (code, message, httpStatus) => {
            if (!settled) { settled = true; resolve({ ok: false, status: httpStatus, error: `${code}: ${message}` }); }
            else sendError(code, message);
          },
        }, 'zh');
        asrSession = session;
        session.start();
      });

    try {
      let cfg = await getAsrConfig();
      let r = await attempt(cfg);
      if (!r.ok && r.status === 401) { // 临时 token 失效 → 清缓存换新、重试一次
        invalidateAsrToken();
        cfg = await getAsrConfig();
        r = await attempt(cfg);
      }
      if (!r.ok) { asrSession?.stop(); asrSession = null; return { ok: false as const, status: r.status, error: r.error }; }
      return { ok: true as const };
    } catch (e) {
      asrSession?.stop(); asrSession = null;
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // 高频音频帧：fire-and-forget，仿 terminal:write
  ipcMain.on('asr:audio', (_event, chunk: ArrayBuffer) => {
    if (!asrSession) return;
    asrSession.appendAudio(Buffer.from(chunk));
  });

  ipcMain.handle('asr:stop', async () => {
    asrSession?.stop();
    asrSession = null;
    return { ok: true };
  });

  // --- Notification IPC handler ---
  ipcMain.handle('notification:show', async (_event, options: {
    title: string;
    body: string;
    onClick?: { type: string; payload: string };
  }) => {
    try {
      const notification = new Notification({
        title: options.title,
        body: options.body || '',
      });
      if (options.onClick) {
        notification.on('click', () => {
          mainWindow?.show();
          mainWindow?.focus();
          mainWindow?.webContents.send('notification:click', options.onClick);
        });
      }
      notification.show();
      return true;
    } catch (err) {
      console.error('[notification] Failed to show:', err);
      return false;
    }
  });

  // Proxy resolution IPC — allows renderer/API routes to query system proxy
  ipcMain.handle('proxy:resolve', async (_event, url: string) => {
    try {
      return await session.defaultSession.resolveProxy(url);
    } catch {
      return 'DIRECT';
    }
  });

  // ── Managed-account login IPC handlers ─────────────────────────────────
  // Two audiences:
  //   1. The dedicated login BrowserWindow (handlers prefixed run-/skip-)
  //   2. The main renderer (get-state / trigger-login / logout / etc.)

  // Login window: "Login in browser" button. Drives the full OAuth dance,
  // saves the token, then runs the post-login sequence.
  ipcMain.handle('auth:run-login-flow', async () => {
    try {
      await loginViaBrowser();
      // Token already on disk; run me/devices/configs in the background so
      // the login window can close right away.
      void postLoginSequence();
      notifyLoginSuccess();
      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logWarn('auth:run-login-flow failed:', msg);
      return { ok: false as const, error: msg };
    }
  });

  // Login window: "Skip" link. Only meaningful when the window was opened
  // with allowSkip=true (first-run flow). Closes the login window and lets
  // the user fall back to BYOK.
  ipcMain.handle('auth:skip-login', () => {
    notifyLoginSkip();
    return { ok: true as const };
  });

  ipcMain.handle('auth:get-state', () => buildAuthSnapshot());

  // Main window: user clicked "Login account" anywhere. Open the login
  // window (without the skip link — they chose to log in explicitly).
  ipcMain.handle('auth:trigger-login', async () => {
    try {
      if (isLoginWindowOpen()) {
        focusLoginWindow();
        return { ok: true as const, outcome: 'success' as const };
      }
      const outcome = await openLoginWindow({ allowSkip: false });
      return { ok: outcome === 'success' || outcome === 'skipped' || outcome === 'cancelled', outcome };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      await anlLogout();
    } catch (e) {
      logWarn('anlLogout threw (continuing):', (e as Error).message);
    }
    await postLogoutSequence();
    // Re-gate the app: hide the main UI and force a fresh login (or quit
    // if the user dismisses). Fire-and-forget so the IPC reply lands
    // before the main window navigates away.
    void rePromptLoginAfterLogout();
    return { ok: true as const };
  });

  ipcMain.handle('auth:refresh-configs', async () => {
    try {
      const configs = await getConfigs({ force: true });
      await syncManagedFromConfigs(configs);
      broadcastAuthChange();
      return { ok: true as const, count: configs.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: msg };
    }
  });

  ipcMain.handle('auth:probe', async () => {
    const result = await tryUseCachedToken();
    if (!result.alive) {
      // Token gone or rejected — clear local state to match.
      clearAuthState();
      currentMe = null;
      isOfflineMode = false;
      try {
        await purgeManagedProvidersOnServer();
      } catch { /* ignore */ }
      managedConfigCount = 0;
      broadcastAuthChange();
    } else {
      isOfflineMode = result.offline;
      broadcastAuthChange();
    }
    return result;
  });

  // Usage quota — fetched on demand when the user opens the account menu.
  // Errors carry status so the renderer can show 409 (not provisioned) /
  // 503 (gateway down) / 401 / network distinctly. Token never leaves main.
  ipcMain.handle('auth:get-usage', async () => {
    try {
      const usage = await fetchUsage();
      return { ok: true as const, usage };
    } catch (e) {
      if (e instanceof HttpError) return { ok: false as const, status: e.status, error: e.message };
      if (e instanceof AuthExpiredError) return { ok: false as const, status: 401, error: e.message };
      if (e instanceof NetworkError) return { ok: false as const, kind: 'network' as const, error: e.message };
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Native auto-updater (research-platform V2): register renderer IPC and wire
  // to the main window. The first check is renderer-triggered (useUpdateChecker
  // on mount, so the onStatus listener is registered before any result is
  // pushed); a periodic background re-check runs every 8h. Check-only — the
  // actual download is user-initiated from the update dialog.
  registerUpdaterIpc();
  initUpdater(() => mainWindow);

  // Renderer-initiated app quit — used by the forced-upgrade ("必须升级") dialog's
  // "退出应用" button, the only escape when must_upgrade blocks the UI.
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  try {
    let port: number;

    if (isDev) {
      const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
      port = Number.isNaN(envPort) ? 3000 : envPort;
      console.log(`Dev mode: connecting to http://127.0.0.1:${port}`);
      serverPort = port;
      // Strict-login flow: open the main window with LOADING_HTML only.
      // The real server URL is loaded AFTER bootAccountState succeeds so
      // the user can never interact with the app while unauthenticated.
      createWindow();
    } else {
      // Show window immediately with loading screen so user sees progress
      // even if port acquisition takes a moment.
      createWindow();

      // startServerOnStablePort actually binds the subprocess on each
      // candidate port and advances on EADDRINUSE — closing the TOCTOU
      // race window from the previous "probe-then-release" approach.
      port = await startServerOnStablePort();
      serverPort = port;
      console.log('Server is ready');
      // NOTE: do NOT load the server URL into mainWindow yet. We must gate
      // the main UI behind a successful login (see below).
    }

    // Managed-account login: wire the broker, then BLOCK until the user has
    // a valid session. If they dismiss the login window we quit before any
    // chat UI is ever shown. Renderer subscribes to 'auth:changed' for the
    // snapshot after we load the main URL below.
    if (serverPort !== null) {
      setBrokerServerPort(serverPort);
      await bootAccountState();
      // If bootAccountState chose to quit (login dismissed), the app is
      // already shutting down — bail out before loading the main window.
      if (!app.isReady() || !mainWindow) {
        return;
      }
    }

    // Auth gate passed (or the broker wasn't wired for some reason).
    // Now load the real server URL into the main window.
    if (mainWindow && serverPort !== null) {
      mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
    }

    // Bridge auto-start lives behind the same gate so an unauthenticated
    // start can't pre-arm remote channels. Only relevant in packaged mode
    // (dev mode delegates bridge boot to the user-run server).
    if (!isDev && serverPort !== null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const http = require('http');
      const autoStartData = JSON.stringify({ action: 'auto-start' });
      const autoStartReq = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/bridge',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(autoStartData),
        },
      }, () => {});
      autoStartReq.on('error', () => {});
      autoStartReq.write(autoStartData);
      autoStartReq.end();
    }

  } catch (err) {
    console.error('Failed to start:', err);
    dialog.showErrorBox(
      'AI Native Lab - 研发平台 - Failed to Start',
      `The internal server could not start.\n\n${err instanceof Error ? err.message : String(err)}\n\nPlease try restarting the application.`
    );
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  // If bridge is active, keep the server running and show a tray icon
  const bridgeActive = await isBridgeActive();
  if (bridgeActive) {
    console.log('Bridge is active — keeping server alive in background with tray icon');
    createTray();
    // Start background notification polling since no renderer will be available
    startBgNotifyPoll();
    return;
  }

  destroyTray();
  await killServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  // If tray is active (bridge background mode), destroy it when user re-opens
  destroyTray();

  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      if (!isDev && !serverProcess) {
        // Show loading window immediately so user sees progress
        createWindow();
        const port = await startServerOnStablePort();
        serverPort = port;
        if (mainWindow) {
          mainWindow.loadURL(`http://127.0.0.1:${port}`);
        }
      } else {
        createWindow(`http://127.0.0.1:${serverPort || 3000}`);
      }

    } catch (err) {
      console.error('Failed to restart server:', err);
    }
  }
});

app.on('before-quit', async (e) => {
  // Stop the managed-account background poller so its timer doesn't keep
  // the event loop alive past app.quit().
  stopBackgroundPolling();
  // Stop the auto-updater periodic check timer (also unref'd, belt-and-braces).
  stopUpdater();
  if (isLoginWindowOpen()) cancelLoginWindow('before-quit');

  // Kill all terminal processes
  terminalManager.killAll();

  // Kill any running install process (tree-kill on Windows)
  if (installProcess) {
    const pid = installProcess.pid;
    try {
      if (process.platform === 'win32' && pid) {
        spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
      } else {
        installProcess.kill();
      }
    } catch { /* already dead */ }
    installProcess = null;
  }

  destroyTray();

  if (serverProcess && !isQuitting) {
    isQuitting = true;
    e.preventDefault();
    // Stop bridge gracefully before killing the server
    await stopBridge();
    await killServer();
    app.quit();
  }
});

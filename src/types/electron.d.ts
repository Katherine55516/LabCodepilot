/**
 * Global type declarations for the Electron preload API.
 * Exposed via contextBridge.exposeInMainWorld('electronAPI', ...) in electron/preload.ts.
 */

interface ClaudeInstallDetection {
  path: string;
  version: string | null;
  type: 'native' | 'homebrew' | 'npm' | 'bun' | 'unknown';
}

interface ElectronInstallAPI {
  checkPrerequisites: () => Promise<{
    hasClaude: boolean;
    claudeVersion?: string;
    claudePath?: string;
    claudeInstallType?: 'native' | 'homebrew' | 'npm' | 'bun' | 'unknown';
    otherInstalls?: ClaudeInstallDetection[];
    hasGit?: boolean;
    platform?: string;
  }>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  getLogs: () => Promise<string[]>;
  installGit: () => Promise<{ success: boolean; output?: string; error?: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onProgress: (callback: (data: any) => void) => () => void;
}

interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version: string;
    releaseNotes?: string | { version: string; note: string }[] | null;
    releaseName?: string | null;
    releaseDate?: string;
    /** V2: 强制升级标记。true 时旧版应被阻断（must_upgrade）。 */
    mustUpgrade?: boolean;
  };
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

interface ElectronUpdaterAPI {
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => Promise<void>;
  onStatus: (callback: (data: UpdateStatusEvent) => void) => () => void;
}

interface ElectronTerminalAPI {
  create: (opts: { id: string; cwd: string; cols: number; rows: number }) => Promise<void>;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (callback: (data: { id: string; data: string }) => void) => () => void;
  onExit: (callback: (data: { id: string; code: number }) => void) => () => void;
}

/**
 * Snapshot of the managed-account auth state. Renderer-safe — no tokens.
 */
interface AuthSnapshot {
  authenticated: boolean;
  offline: boolean;
  me: {
    username: string;
    display_name: string;
    email?: string;
    plan?: string;
  } | null;
  managedConfigCount: number;
}

/** One quota bucket from /api/v1/usage (mirrors electron/auth/types.ts). */
interface UsageQuota {
  renewal: number;
  remaining: number;
  used: number;
}

/** /api/v1/usage response — renderer-safe (no token). */
interface UsageInfo {
  username: string;
  quota: UsageQuota;
  quota_cn: UsageQuota;
  quota_intl: UsageQuota;
  quota_per_unit: number;
}

interface ElectronAuthAPI {
  // Login-window-only entry points (called from electron/login/login.js)
  runLoginFlow: () => Promise<{ ok: true } | { ok: false; error: string }>;
  skipLogin: () => Promise<{ ok: true }>;
  // Main-window entry points
  getState: () => Promise<AuthSnapshot>;
  triggerLogin: () => Promise<{ ok: boolean; outcome?: 'success' | 'skipped' | 'cancelled'; error?: string }>;
  logout: () => Promise<{ ok: true }>;
  refreshConfigs: () => Promise<{ ok: boolean; count?: number; error?: string }>;
  probe: () => Promise<{ alive: boolean; offline: boolean }>;
  /** Fetch current quota usage on demand. status: 401/409/503; kind:'network'. */
  getUsage: () => Promise<
    | { ok: true; usage: UsageInfo }
    | { ok: false; status?: number; kind?: 'network'; error: string }
  >;
  onChange: (callback: (state: AuthSnapshot) => void) => () => void;
}

/**
 * Vendor-bundled GSD plugin (gsd-build/get-shit-done, MIT) installer API.
 * See electron/gsd-installer.ts for the underlying implementation.
 */
export interface GsdPluginManifest {
  name: string;
  displayName: string;
  description: string;
  source: string;
  sourceUrl?: string;
  sourceCommit: string;
  transformVersion: number;
  license: string;
  licenseFile?: string;
  commandCount: number;
  agentCount: number;
  commandPrefix: string;
  bundledAt?: string;
}

export interface GsdConflict {
  /** Bare name (no `.md` suffix, no `kind:` prefix). e.g. "gsd-debugger".
   *  For `asset` kind, the relative path within ~/.claude/get-shit-done/. */
  agentName: string;
  /** Which mirror produced this conflict. */
  kind?: 'agent' | 'command' | 'asset';
  reason: 'hash-mismatch';
  targetPath: string;
}

export interface GsdInstallStatus {
  enabled: boolean;
  installed: boolean;
  bundledVersion: string | null;
  installedVersion: string | null;
  needsSync: boolean;
  manifest: GsdPluginManifest | null;
  installPath: string;
  agentsMirrorPath: string;
  conflicts: GsdConflict[];
  lastError?: string;
}

interface ElectronGsdAPI {
  getStatus: () => Promise<GsdInstallStatus>;
  install: () => Promise<GsdInstallStatus>;
  resync: () => Promise<GsdInstallStatus>;
  enable: () => Promise<GsdInstallStatus>;
  disable: () => Promise<GsdInstallStatus>;
  uninstall: () => Promise<GsdInstallStatus>;
}

interface ElectronAPI {
  versions: {
    electron: string;
    node: string;
    chrome: string;
    platform: string;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
  };
  fs: {
    /** Resolve a File's absolute filesystem path (via Electron webUtils). Empty string if unavailable. */
    getPathForFile: (file: File) => string;
  };
  dialog: {
    openFolder: (options?: {
      defaultPath?: string;
      title?: string;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  install: ElectronInstallAPI;
  updater?: ElectronUpdaterAPI;
  bridge?: {
    isActive: () => Promise<boolean>;
  };
  proxy?: {
    resolve: (url: string) => Promise<string>;
  };
  terminal?: ElectronTerminalAPI;
  notification?: {
    show: (options: { title: string; body?: string; onClick?: string }) => Promise<void>;
    onClick: (listener: (action: string) => void) => () => void;
  };
  /** Managed-account login. Isolated from any OpenAI OAuth flow. */
  auth?: ElectronAuthAPI;
  /** Vendor-bundled GSD plugin (gsd-build/get-shit-done, MIT). */
  gsd?: ElectronGsdAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

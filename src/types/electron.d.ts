/**
 * Global type declarations for the Electron preload API.
 * Exposed via contextBridge.exposeInMainWorld('electronAPI', ...) in electron/preload.ts.
 */

interface ClaudeInstallDetection {
  path: string;
  version: string | null;
  type: 'native' | 'homebrew' | 'npm' | 'bun' | 'unknown';
}

// ── 技能市场（内部）────────────────────────────────────────────────────────────

/** IPC 统一失败信封（electron/skills-store-core.ts 的 SkillsStoreFailure 镜像）。 */
export interface SkillsStoreFailureEnvelope {
  ok: false;
  /** 'not-logged-in' | 'network' | Hub 稳定错误码（未知码原样透传，走通用分支）。 */
  error: string;
  status?: number;
  /** RATE_LIMITED 时的退避秒数。 */
  retryAfter?: number;
  message?: string;
}

/**
 * Hub 技能条目 + 主进程合并的安装状态。服务端契约承诺可能新增字段 —
 * 只声明客户端用到的，未知字段经索引签名透传，勿建全量模型。
 */
export interface InternalStoreSkill {
  id: string;
  slug: string;
  displayName: string;
  description?: string;
  /** LISTED = 上架；DEPRECATED = 已下架（本地保留、停止更新）。 */
  state?: string;
  /** SANDBOX | INLINE — 安装统一走 download，INLINE 详情另有 inlineContent 预览。 */
  deliveryMode?: string;
  isOwn?: boolean;
  contentHash?: string;
  downloadVersion?: number;
  updatedAt?: string;
  /** 详情页字段（列表不含） */
  guide?: string;
  authorNote?: string;
  fileManifest?: unknown;
  dependencies?: unknown;
  inlineContent?: string;
  // 主进程合并的安装状态（台账比对，见 electron/skills-store-core.ts mergeInstallState）
  isInstalled: boolean;
  hasUpdate: boolean;
  installedAt?: string;
  [key: string]: unknown;
}

export interface InternalStorePagination {
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  [key: string]: unknown;
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
  /** 打开测试模块时触发后台用量上报；fire-and-forget，主进程异步处理。 */
  uploadTestUsage: () => Promise<{ ok: boolean }>;
  onChange: (callback: (state: AuthSnapshot) => void) => () => void;
}

/**
 * Vendor-bundled AI_LabTest plugin (qitianersheng/ai-lab-test-agent, MIT)
 * installer API. See electron/ailab-installer.ts for the implementation.
 */
export interface AilabPluginManifest {
  name: string;
  displayName: string;
  description: string;
  source: string;
  sourceUrl?: string;
  sourceCommit: string;
  sourcePluginVersion?: string;
  transformVersion: number;
  license: string;
  licenseFile?: string;
  commandCount: number;
  skillCount: number;
  ruleCount?: number;
  commandPrefix: string;
  requiresMcp?: string[];
  bundledAt?: string;
}

export interface AilabInstallStatus {
  enabled: boolean;
  installed: boolean;
  bundledVersion: string | null;
  installedVersion: string | null;
  needsSync: boolean;
  manifest: AilabPluginManifest | null;
  installPath: string;
  commandsMirrorPath: string;
  skillsMirrorPath: string;
  lastError?: string;
}

interface ElectronAilabAPI {
  getStatus: () => Promise<AilabInstallStatus>;
  install: () => Promise<AilabInstallStatus>;
  resync: () => Promise<AilabInstallStatus>;
  enable: () => Promise<AilabInstallStatus>;
  disable: () => Promise<AilabInstallStatus>;
  uninstall: () => Promise<AilabInstallStatus>;
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
    /** Reveal + select a file/folder in Finder/Explorer (shell.showItemInFolder). */
    showItemInFolder: (path: string) => Promise<void>;
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
  /** App-level controls. quit() backs the forced-upgrade "退出应用" button. */
  app?: {
    quit: () => Promise<void>;
  };
  /** Application file logs — open the log folder / get its path for diagnostics. */
  logs?: {
    /** Open the log directory in the OS file manager. Resolves to '' on success. */
    openFolder: () => Promise<string>;
    /** Absolute path of the log directory. */
    getPath: () => Promise<string>;
  };
  /**
   * 问题反馈上报（设置页「问题反馈」）。主进程读 main.log + 登录 token 组
   * multipart 上报账号后端；身份以服务端 JWT claims 为准，客户端不上送。
   */
  feedback?: {
    submit: (payload: {
      message: string;
      includeLog: boolean;
      /** 截图（最多 5 张、单张 ≤1MB）；data 为 ArrayBuffer 以便结构化克隆过 IPC。 */
      images?: { name: string; type: string; data: ArrayBuffer }[];
    }) => Promise<
      | { ok: true; id?: string }
      | {
          ok: false;
          error:
            | 'invalid-message'
            | 'not-logged-in'
            | 'network'
            /** 服务端 429：已达每日反馈次数上限 */
            | 'rate-limited'
            | 'too-large'
            | 'invalid-image'
            | 'server';
          status?: number;
        }
    >;
  };
  /**
   * 技能市场（内部）— codeagent-server Skills 商店（主进程持登录 token 代理）。
   * 失败信封：error 为 'not-logged-in' | 'network' | Hub 稳定错误码
   * （SKILLS_NOT_CONFIGURED/HUB_UNAVAILABLE/RATE_LIMITED/…），分支只认 code。
   * Phase 0 仅 probe/list/detail；install/update/uninstall 随 Phase 2 加入。
   */
  skillsStore?: {
    /** Skills 页 mount 时探测：SKILLS_NOT_CONFIGURED → 隐藏 tab；not-logged-in → 登录空态。 */
    probe: () => Promise<{ ok: true } | SkillsStoreFailureEnvelope>;
    list: (params?: { keyword?: string; page?: number; pageSize?: number }) => Promise<
      | { ok: true; items: InternalStoreSkill[]; pagination: InternalStorePagination }
      | SkillsStoreFailureEnvelope
    >;
    detail: (skillId: string, opts?: { withContent?: boolean }) => Promise<
      { ok: true; skill: InternalStoreSkill } | SkillsStoreFailureEnvelope
    >;
    // ── 安装事务（Phase 2 已接入;保持可选供 UI feature-detect 旧 preload）──
    install?: (skillId: string) => Promise<
      { ok: true; dirName: string } | SkillsStoreFailureEnvelope
    >;
    /** 304（内容未变）→ updated:false，仅刷新台账。 */
    update?: (skillId: string) => Promise<
      { ok: true; updated: boolean } | SkillsStoreFailureEnvelope
    >;
    uninstall?: (skillId: string) => Promise<{ ok: true } | SkillsStoreFailureEnvelope>;
  };
  bridge?: {
    isActive: () => Promise<boolean>;
  };
  proxy?: {
    resolve: (url: string) => Promise<string>;
  };
  terminal?: ElectronTerminalAPI;
  notification?: {
    show: (options: { title: string; body?: string; tag?: string; onClick?: { type: string; payload: string } }) => Promise<boolean>;
    /** Close a tagged notification (see `tag` on show). */
    close: (tag: string) => Promise<boolean>;
    onClick: (listener: (action: { type: string; payload: string }) => void) => () => void;
  };
  /** Managed-account login. Isolated from any OpenAI OAuth flow. */
  auth?: ElectronAuthAPI;
  /** Vendor-bundled AI_LabTest plugin (qitianersheng/ai-lab-test-agent, MIT). */
  ailab?: ElectronAilabAPI;
  /** Voice-to-text input (Bailian realtime ASR). Electron-only (renderer falls back to hidden button). */
  asr?: {
    requestMicPermission: () => Promise<{ granted: boolean; error?: string }>;
    start: () => Promise<{ ok: boolean; status?: number; error?: string }>;
    sendAudio: (chunk: ArrayBuffer) => void;
    stop: () => Promise<{ ok: boolean }>;
    onTranscript: (
      cb: (data: { kind: 'partial'; text: string; stash: string } | { kind: 'final'; transcript: string }) => void,
    ) => () => void;
    onState: (cb: (data: { state: string }) => void) => () => void;
    onError: (cb: (data: { code: string; message: string }) => void) => () => void;
  };
  /**
   * 获取登录态（测试账号设置）。打开一个隔离的 BrowserWindow 让用户登录一次，
   * 抓取 cookie + localStorage 组装成 Playwright storageState，写入
   * {projectRoot}/AI_LabTest/.auth/{env}.{key}.storageState.json 供 AI_LabTest 重放。
   * Electron-only（纯 npm run dev 下为 undefined）。契约见
   * docs/handover/test-account-settings.md。
   */
  testAuthCapture?: {
    /**
     * 打开抓取窗口（BaseWindow + 顶部工具条 + 下方第三方站点），导航到 frontendBaseUrl，
     * best-effort 预填用户名/密码（不自动提交）。projectRoot/env/accountKey/systemLabel
     * 在此固化，供工具条「登录完成」就地写盘 + 工具条显示。
     */
    start: (params: {
      frontendBaseUrl: string;
      username?: string;
      password?: string;
      projectRoot: string;
      env: string;
      accountKey: string;
      systemLabel?: string;
    }) => Promise<{ ok: boolean; prefilled?: boolean; error?: string }>;
    /** 程序化取消并关闭抓取窗口（静默，不触发 onCancelled）。 */
    cancel: () => Promise<{ ok: boolean }>;
    /** 查询某账号是否已捕获（storageState 文件是否存在）。 */
    status: (params: {
      projectRoot: string;
      env: string;
      accountKey: string;
    }) => Promise<{ ok: boolean; captured: boolean; capturedAt?: string }>;
    /** 删除某账号的 storageState 文件。 */
    clear: (params: {
      projectRoot: string;
      env: string;
      accountKey: string;
    }) => Promise<{ ok: boolean; error?: string }>;
    /** 工具条内部用：就地抓取写盘（用 start 时固化的目标）。抓到空返回 ok:false 且不关窗。 */
    toolbarFinish: () => Promise<{ ok: boolean; path?: string; origins?: number; cookies?: number; env?: string; accountKey?: string; capturedAt?: string; error?: string }>;
    /** 工具条内部用：用户取消并关窗（触发 onCancelled）。 */
    toolbarCancel: () => Promise<{ ok: boolean }>;
    /** 工具条内部用：接收主进程下发的抓取目标（系统 · 环境 · 账号），返回取消订阅函数。 */
    onToolbarInit: (cb: (data: { systemLabel: string; env: string; accountKey: string }) => void) => () => void;
    /** 设置页订阅：抓取写盘完成（徽章变绿）。返回取消订阅函数。 */
    onDone: (cb: (data: { env: string; accountKey: string; path: string; cookies: number; origins: number; capturedAt: string }) => void) => () => void;
    /** 设置页订阅：用户取消或关窗。返回取消订阅函数。 */
    onCancelled: (cb: (data: { env: string; accountKey: string }) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

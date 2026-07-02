// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
  },
  // Resolve a dropped/selected File's real filesystem path. Electron 32+ removed
  // the renderer-side `File.path`, so consumers must ask via webUtils.
  fs: {
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file) || '';
      } catch {
        return '';
      }
    },
  },
  shell: {
    openPath: (folderPath: string) => ipcRenderer.invoke('shell:open-path', folderPath),
  },
  dialog: {
    openFolder: (options?: { defaultPath?: string; title?: string }) =>
      ipcRenderer.invoke('dialog:open-folder', options),
  },
  logs: {
    openFolder: () => ipcRenderer.invoke('logs:open-folder'),
    getPath: () => ipcRenderer.invoke('logs:get-path'),
  },
  install: {
    checkPrerequisites: () => ipcRenderer.invoke('install:check-prerequisites'),
    start: () => ipcRenderer.invoke('install:start'),
    cancel: () => ipcRenderer.invoke('install:cancel'),
    getLogs: () => ipcRenderer.invoke('install:get-logs'),
    installGit: () => ipcRenderer.invoke('install:git'),
    onProgress: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('install:progress', listener);
      return () => { ipcRenderer.removeListener('install:progress', listener); };
    },
  },
  bridge: {
    isActive: () => ipcRenderer.invoke('bridge:is-active'),
  },
  proxy: {
    resolve: (url: string) => ipcRenderer.invoke('proxy:resolve', url),
  },
  widget: {
    exportPng: (html: string, width: number, isDark: boolean) =>
      ipcRenderer.invoke('widget:export-png', { html, width, isDark }),
  },
  artifact: {
    // Phase 3 long-shot export: render HTML in a hidden BrowserWindow and
    // capture a full-page PNG via CDP captureBeyondViewport. Returns a
    // discriminated result — callers pattern-match on `.error` vs `.base64`.
    exportLongShot: (params: {
      html: string;
      width: number;
      pixelRatio?: number;
      outPath?: string;
      maxHeightPx?: number;
      timeoutMs?: number;
    }) => ipcRenderer.invoke('artifact:export-long-shot', params),
  },
  terminal: {
    create: (opts: { id: string; cwd: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('terminal:create', opts),
    write: (id: string, data: string) =>
      ipcRenderer.send('terminal:write', { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
    kill: (id: string) =>
      ipcRenderer.invoke('terminal:kill', id),
    onData: (callback: (data: { id: string; data: string }) => void) => {
      const listener = (_event: unknown, data: { id: string; data: string }) => callback(data);
      ipcRenderer.on('terminal:data', listener);
      return () => { ipcRenderer.removeListener('terminal:data', listener); };
    },
    onExit: (callback: (data: { id: string; code: number }) => void) => {
      const listener = (_event: unknown, data: { id: string; code: number }) => callback(data);
      ipcRenderer.on('terminal:exit', listener);
      return () => { ipcRenderer.removeListener('terminal:exit', listener); };
    },
  },
  // 语音转文字（百炼实时 ASR）。仿 terminal 的 invoke + send + on 三种。
  asr: {
    requestMicPermission: (): Promise<{ granted: boolean; error?: string }> =>
      ipcRenderer.invoke('asr:request-mic-permission'),
    start: (): Promise<{ ok: boolean; status?: number; error?: string }> =>
      ipcRenderer.invoke('asr:start'),
    sendAudio: (chunk: ArrayBuffer): void => ipcRenderer.send('asr:audio', chunk),
    stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('asr:stop'),
    onTranscript: (
      cb: (data: { kind: 'partial'; text: string; stash: string } | { kind: 'final'; transcript: string }) => void,
    ) => {
      const listener = (_e: unknown, data: unknown) => cb(data as never);
      ipcRenderer.on('asr:transcript', listener);
      return () => { ipcRenderer.removeListener('asr:transcript', listener); };
    },
    onState: (cb: (data: { state: string }) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data as { state: string });
      ipcRenderer.on('asr:state', listener);
      return () => { ipcRenderer.removeListener('asr:state', listener); };
    },
    onError: (cb: (data: { code: string; message: string }) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data as { code: string; message: string });
      ipcRenderer.on('asr:error', listener);
      return () => { ipcRenderer.removeListener('asr:error', listener); };
    },
  },
  notification: {
    show: (options: { title: string; body: string; onClick?: unknown }) =>
      ipcRenderer.invoke('notification:show', options),
    onClick: (callback: (action: { type: string; payload: string }) => void) => {
      const listener = (_event: unknown, action: { type: string; payload: string }) => callback(action);
      ipcRenderer.on('notification:click', listener);
      return () => { ipcRenderer.removeListener('notification:click', listener); };
    },
  },
  // Vendor-bundled GSD plugin (gsd-build/get-shit-done, MIT). Installer
  // lives in electron/gsd-installer.ts; sync runs at app start and on demand
  // here. See docs/handover/gsd-bundle.md.
  gsd: {
    getStatus: () => ipcRenderer.invoke('gsd:status'),
    install: () => ipcRenderer.invoke('gsd:install'),
    resync: () => ipcRenderer.invoke('gsd:resync'),
    enable: () => ipcRenderer.invoke('gsd:enable'),
    disable: () => ipcRenderer.invoke('gsd:disable'),
    uninstall: () => ipcRenderer.invoke('gsd:uninstall'),
  },
  // Vendor-bundled AI_LabTest plugin (qitianersheng/ai-lab-test-agent, MIT).
  // Installer in electron/ailab-installer.ts. Default-disabled on first launch;
  // enabling mirrors ai-lab-test:* commands + the test-workflow skill. The
  // Playwright MCP is registered separately by the renderer card via the
  // /api/plugins/mcp HTTP API. See docs/handover/ailab-plugin.md.
  ailab: {
    getStatus: () => ipcRenderer.invoke('ailab:status'),
    install: () => ipcRenderer.invoke('ailab:install'),
    resync: () => ipcRenderer.invoke('ailab:resync'),
    enable: () => ipcRenderer.invoke('ailab:enable'),
    disable: () => ipcRenderer.invoke('ailab:disable'),
    uninstall: () => ipcRenderer.invoke('ailab:uninstall'),
  },
  // Managed-account login system. Strictly isolated from the OpenAI OAuth
  // module — different IPC channels, different storage, different callback
  // port. Never read or surface a session token to the renderer.
  auth: {
    // Login-window-only entry points (consumed by electron/login/login.js)
    runLoginFlow: () => ipcRenderer.invoke('auth:run-login-flow'),
    skipLogin: () => ipcRenderer.invoke('auth:skip-login'),
    // Main-window entry points
    getState: () => ipcRenderer.invoke('auth:get-state'),
    triggerLogin: () => ipcRenderer.invoke('auth:trigger-login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    refreshConfigs: () => ipcRenderer.invoke('auth:refresh-configs'),
    probe: () => ipcRenderer.invoke('auth:probe'),
    getUsage: () => ipcRenderer.invoke('auth:get-usage'),
    onChange: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on('auth:changed', listener);
      return () => { ipcRenderer.removeListener('auth:changed', listener); };
    },
  },
  // Native auto-updater (research-platform V2). The check runs in main (Bearer
  // token never crosses IPC); status is pushed via 'updater:status'.
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    quitAndInstall: () => ipcRenderer.invoke('updater:install'),
    onStatus: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('updater:status', listener);
      return () => { ipcRenderer.removeListener('updater:status', listener); };
    },
  },
  // App-level controls. quit() backs the forced-upgrade "退出应用" button.
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  // Test Accounts — 获取登录态 capture. Opens an isolated window (BaseWindow +
  // toolbar/site WebContentsView) and harvests cookies + localStorage into a
  // Playwright storageState file. The in-window toolbar finishes/cancels via the
  // toolbar* methods; the settings page listens for onDone/onCancelled. Electron-only.
  testAuthCapture: {
    start: (params: {
      frontendBaseUrl: string;
      username?: string;
      password?: string;
      projectRoot: string;
      env: string;
      accountKey: string;
      systemLabel?: string;
    }) => ipcRenderer.invoke('test-auth-capture:start', params),
    cancel: () => ipcRenderer.invoke('test-auth-capture:cancel'),
    status: (params: { projectRoot: string; env: string; accountKey: string }) =>
      ipcRenderer.invoke('test-auth-capture:status', params),
    clear: (params: { projectRoot: string; env: string; accountKey: string }) =>
      ipcRenderer.invoke('test-auth-capture:clear', params),
    // 工具条内部用（toolbar.js）：就地完成 / 取消当前抓取会话。
    toolbarFinish: () => ipcRenderer.invoke('test-auth-capture:toolbar-finish'),
    toolbarCancel: () => ipcRenderer.invoke('test-auth-capture:toolbar-cancel'),
    onToolbarInit: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('test-auth-capture:toolbar-init', listener);
      return () => { ipcRenderer.removeListener('test-auth-capture:toolbar-init', listener); };
    },
    // 设置页订阅：抓取写盘完成 / 用户取消（含关窗）。
    onDone: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('test-auth-capture:done', listener);
      return () => { ipcRenderer.removeListener('test-auth-capture:done', listener); };
    },
    onCancelled: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('test-auth-capture:cancelled', listener);
      return () => { ipcRenderer.removeListener('test-auth-capture:cancelled', listener); };
    },
  },
});

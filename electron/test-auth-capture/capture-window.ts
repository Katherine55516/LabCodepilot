/**
 * 获取登录态（测试账号设置）—— Electron 抓取登录态。
 *
 * 打开一个隔离的窗口，导航到测试站点的 frontendBaseUrl，让用户手动登录一次
 * （支持验证码 / 2FA，不自动提交），然后把 cookie + 各 origin 的 localStorage 组装成
 * Playwright 标准 storageState，写入
 *   {projectRoot}/AI_LabTest/.auth/{env}.{sanitize(key)}.storageState.json
 * 供 AI_LabTest 用 `--storage-state` 重放（SPA 免源码）。CodePilot 只负责抓取 + 写文件，
 * 重放在 AI_LabTest 侧。契约见 docs/handover/test-account-settings.md。
 *
 * 窗口结构（BaseWindow + 两个 WebContentsView）：
 *   ┌──────────────────────────────────────────────┐
 *   │ toolbarView —— CodePilot 注入的可信工具条       │  ← 自带 preload，登录完成/取消
 *   ├──────────────────────────────────────────────┤
 *   │ siteView    —— 第三方登录页                     │  ← 无 preload / sandbox / 独立 partition
 *   └──────────────────────────────────────────────┘
 * 用户在窗口内登录后，直接点工具条「登录完成」即就地抓取写盘，无需切回设置页。
 *
 * 安全：siteView 跑第三方站点 —— 无 preload（页面拿不到 electronAPI）、sandbox、独立内存
 * partition（cookie/localStorage 不污染主会话、随会话销毁）、拒绝所有权限请求、阻止
 * window.open（但放行就地导航，登录/SSO 需要）。toolbarView 是本地可信 HTML，复用主
 * preload（与登录窗口一致）。同一时刻只允许一个抓取会话。
 */

import { app, BaseWindow, WebContentsView, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { logInfo, logWarn } from '../auth/log';

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

interface StorageStateOrigin {
  origin: string;
  localStorage: { name: string; value: string }[];
}

interface StorageState {
  cookies: PlaywrightCookie[];
  origins: StorageStateOrigin[];
}

/** finish/cancel 抓取目标（在 start 时确定，供工具条「登录完成」就地写盘）。 */
interface CaptureTarget {
  projectRoot: string;
  env: string;
  accountKey: string;
  systemLabel: string;
}

/** 工具条高度（px）—— siteView 占其余高度。 */
const TOOLBAR_HEIGHT = 48;

// 同一时刻只允许一个抓取会话（与 AI_LabTest 一致）。
let captureWindow: BaseWindow | null = null;
let toolbarView: WebContentsView | null = null;
let siteView: WebContentsView | null = null;
let capturePartition: string | null = null;
let captureTarget: CaptureTarget | null = null;
// cleanup() 主动关窗时置位，避免 'closed' 再触发一次「取消」通知。
let closingProgrammatically = false;
const originLocalStorage = new Map<string, Record<string, string>>();

/**
 * 主进程 → 设置页渲染端的事件通道。main.ts 在启动时注入
 * `(channel, payload) => mainWindow?.webContents.send(...)`，避免 capture-window
 * 反向 import main.ts 造成循环依赖。
 */
type CaptureNotifier = (channel: string, payload: unknown) => void;
let notify: CaptureNotifier = () => {};
export function registerCaptureNotifier(fn: CaptureNotifier): void {
  notify = fn;
}

/** 与 AI_LabTest runner 完全一致的 account key sanitize（否则 runner 找不到文件）。 */
function sanitizeAccountKey(key: string): string {
  return String(key).replace(/[^A-Za-z0-9_-]/g, '_');
}

function storageStatePath(projectRoot: string, env: string, accountKey: string): string {
  const e = env || 'local';
  return path.join(projectRoot, 'AI_LabTest', '.auth', `${e}.${sanitizeAccountKey(accountKey)}.storageState.json`);
}

/**
 * 解析工具条 HTML 路径（dev / 打包两种形态），与登录窗口同一约定：
 *   dev：     <repo>/electron/test-auth-capture/toolbar.html（process.cwd()）
 *   packaged：electron-builder 把 electron/test-auth-capture/ 的静态资源拷到 Resources/test-auth-capture/
 */
function getToolbarHtmlPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'test-auth-capture', 'toolbar.html');
  }
  return path.join(process.cwd(), 'electron', 'test-auth-capture', 'toolbar.html');
}

// 读取当前页 localStorage（在页面上下文执行；取不到时返回 '{}'）。
const HARVEST_JS = `(() => { try { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k != null) o[k] = localStorage.getItem(k) ?? ''; } return JSON.stringify(o); } catch (e) { return '{}'; } })()`;

function buildPrefillJs(username?: string, password?: string): string {
  const u = JSON.stringify(username || '');
  const p = JSON.stringify(password || '');
  return `(() => { try {
    const setVal = (el, val) => { if (!el || !val) return false; const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); if (d && d.set) d.set.call(el, val); else el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    const sels = ['input[type=email]', 'input[autocomplete=username]', 'input[name*=user i]', 'input[name*=account i]', 'input[id*=user i]', 'input[placeholder*=\\u8d26\\u53f7]', 'input[placeholder*=\\u7528\\u6237]', 'input[placeholder*=\\u90ae\\u7bb1]'];
    let uEl = null; for (const s of sels) { try { uEl = document.querySelector(s); } catch (e) {} if (uEl) break; }
    const pEl = document.querySelector('input[type=password]');
    let ok = false;
    if (uEl && ${u}) ok = setVal(uEl, ${u}) || ok;
    if (pEl && ${p}) ok = setVal(pEl, ${p}) || ok;
    return ok;
  } catch (e) { return false; } })()`;
}

async function snapshotCurrentOrigin(wc: Electron.WebContents): Promise<void> {
  try {
    const url = wc.getURL();
    if (!/^https?:/i.test(url)) return;
    const origin = new URL(url).origin;
    const json = (await wc.executeJavaScript(HARVEST_JS, true)) as string;
    const data = JSON.parse(json || '{}') as Record<string, string>;
    if (Object.keys(data).length > 0) {
      originLocalStorage.set(origin, { ...(originLocalStorage.get(origin) || {}), ...data });
    }
  } catch (e) {
    logWarn('[test-auth-capture] localStorage snapshot failed:', e);
  }
}

/** 按窗口内容尺寸布局两个视图：工具条占顶部固定高，站点视图占其余。 */
function layoutViews(): void {
  if (!captureWindow || captureWindow.isDestroyed()) return;
  const { width, height } = captureWindow.getContentBounds();
  toolbarView?.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  siteView?.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
}

function cleanup(): void {
  const win = captureWindow;
  closingProgrammatically = true;
  captureWindow = null;
  toolbarView = null;
  siteView = null;
  capturePartition = null;
  captureTarget = null;
  originLocalStorage.clear();
  if (win && !win.isDestroyed()) win.destroy();
}

export async function startCapture(params: {
  frontendBaseUrl: string;
  username?: string;
  password?: string;
  projectRoot: string;
  env: string;
  accountKey: string;
  systemLabel?: string;
}): Promise<{ ok: boolean; prefilled?: boolean; error?: string }> {
  // 重入保护：先关掉上一个会话。
  await cancelCapture();

  const url = (params.frontendBaseUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Invalid frontend URL (must start with http:// or https://)' };
  }
  if (!(params.projectRoot || '').trim()) return { ok: false, error: 'Project folder is required' };
  if (!params.accountKey) return { ok: false, error: 'Account key is required' };

  originLocalStorage.clear();
  const partition = `codepilot-capture-${Date.now()}`; // 内存会话，随窗口销毁
  capturePartition = partition;
  captureTarget = {
    projectRoot: params.projectRoot,
    env: params.env,
    accountKey: params.accountKey,
    systemLabel: params.systemLabel || '',
  };
  closingProgrammatically = false;

  const win = new BaseWindow({
    width: 1280,
    height: 860,
    title: '获取登录态 — 登录后点「登录完成」',
    autoHideMenuBar: true,
  });
  captureWindow = win;
  win.setMenuBarVisibility(false);

  // 顶部工具条：本地可信 HTML，复用主 preload（与登录窗口一致 —— esbuild 把主进程
  // 全部 bundle 进 dist-electron/main.js，故 __dirname 指向 dist-electron/）。
  const toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  toolbarView = toolbar;
  win.contentView.addChildView(toolbar);

  // 站点视图：第三方页面 —— 无 preload、sandbox、独立 partition。
  const site = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
    },
  });
  siteView = site;
  win.contentView.addChildView(site);

  layoutViews();
  win.on('resize', layoutViews);

  // 放行就地导航（登录 / SSO 跳转），但阻止开新窗口。
  site.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 拒绝第三方页面的所有权限请求（摄像头 / 麦克风 / 定位 / 通知…）。
  session.fromPartition(partition).setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // 每次加载完成抓一次当前 origin 的 localStorage（覆盖 SSO 多 origin 场景）。
  site.webContents.on('did-finish-load', () => { void snapshotCurrentOrigin(site.webContents); });

  // 工具条加载完，把抓取目标下发给它显示（系统 · 环境 · 账号）。
  toolbar.webContents.on('did-finish-load', () => {
    if (!captureTarget) return;
    toolbar.webContents.send('test-auth-capture:toolbar-init', {
      systemLabel: captureTarget.systemLabel,
      env: captureTarget.env,
      accountKey: captureTarget.accountKey,
    });
  });

  // 用户关窗（点 X）== 取消：通知设置页清理「抓取中」态。
  win.on('closed', () => {
    if (captureWindow === win) {
      const target = captureTarget;
      const wasProgrammatic = closingProgrammatically;
      captureWindow = null;
      toolbarView = null;
      siteView = null;
      capturePartition = null;
      captureTarget = null;
      originLocalStorage.clear();
      if (!wasProgrammatic && target) {
        notify('test-auth-capture:cancelled', { env: target.env, accountKey: target.accountKey });
      }
    }
  });

  try {
    await toolbar.webContents.loadFile(getToolbarHtmlPath());
  } catch (e) {
    logWarn('[test-auth-capture] toolbar loadFile failed:', e);
  }

  try {
    await site.webContents.loadURL(url);
  } catch (e) {
    logWarn('[test-auth-capture] loadURL failed:', e);
  }

  // best-effort 预填用户名/密码（不自动提交，让用户处理验证码 / 2FA）。
  let prefilled = false;
  try {
    await new Promise((r) => setTimeout(r, 1200));
    if (siteView && !siteView.webContents.isDestroyed()) {
      prefilled = (await siteView.webContents.executeJavaScript(buildPrefillJs(params.username, params.password), true)) as boolean;
    }
  } catch {
    /* 预填失败不影响手动登录 */
  }

  logInfo('[test-auth-capture] capture window opened for', url);
  return { ok: true, prefilled: !!prefilled };
}

function mapSameSite(s?: string): 'Strict' | 'Lax' | 'None' {
  switch ((s || '').toLowerCase()) {
    case 'no_restriction': return 'None';
    case 'strict': return 'Strict';
    case 'lax': return 'Lax';
    default: return 'Lax';
  }
}

function mapCookie(c: Electron.Cookie): PlaywrightCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain || '',
    path: c.path || '/',
    expires: c.session || c.expirationDate == null ? -1 : Math.round(c.expirationDate),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: mapSameSite(c.sameSite),
  };
}

/**
 * 工具条「登录完成」就地抓取并写盘（用 start 时存的 captureTarget）。
 * 成功：写文件 → 通知设置页 done → 关窗。
 * 抓到空：返回失败、**不关窗**，让工具条红字提示用户先登录。
 */
export async function finishCaptureSelf(): Promise<{
  ok: boolean;
  path?: string;
  origins?: number;
  cookies?: number;
  env?: string;
  accountKey?: string;
  capturedAt?: string;
  error?: string;
}> {
  const target = captureTarget;
  const partition = capturePartition;
  const view = siteView;
  if (!captureWindow || captureWindow.isDestroyed() || !target || !partition || !view) {
    return { ok: false, error: 'No active capture session' };
  }

  try {
    // 收尾：再抓一次当前页 origin。
    await snapshotCurrentOrigin(view.webContents);

    const electronCookies = await session.fromPartition(partition).cookies.get({});
    const cookies = electronCookies.map(mapCookie);
    const origins: StorageStateOrigin[] = Array.from(originLocalStorage.entries())
      .filter(([, kv]) => Object.keys(kv).length > 0)
      .map(([origin, kv]) => ({
        origin,
        localStorage: Object.entries(kv).map(([name, value]) => ({ name, value })),
      }));

    // 空抓取（cookie 与 origin 都空）视为失败 —— 与 AI_LabTest 的 sanity gate 一致。
    // 不关窗：让用户先在下方完成登录。
    if (cookies.length === 0 && origins.length === 0) {
      return { ok: false, error: 'empty' };
    }

    const ssPath = storageStatePath(target.projectRoot, target.env, target.accountKey);
    fs.mkdirSync(path.dirname(ssPath), { recursive: true });
    const state: StorageState = { cookies, origins };
    fs.writeFileSync(ssPath, JSON.stringify(state, null, 2), 'utf-8');

    const result = {
      ok: true as const,
      path: ssPath,
      origins: origins.length,
      cookies: cookies.length,
      env: target.env,
      accountKey: target.accountKey,
      capturedAt: fs.statSync(ssPath).mtime.toISOString(),
    };

    logInfo('[test-auth-capture] wrote storageState', ssPath, `(cookies=${cookies.length}, origins=${origins.length})`);
    // 先通知设置页刷新徽章，再关窗（顺序无强依赖，但语义清晰）。
    notify('test-auth-capture:done', {
      env: result.env,
      accountKey: result.accountKey,
      path: result.path,
      cookies: result.cookies,
      origins: result.origins,
      capturedAt: result.capturedAt,
    });
    cleanup();
    return result;
  } catch (e) {
    logWarn('[test-auth-capture] finish failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'capture failed' };
  }
}

/** 静默取消（re-entry 守卫 / 程序化关闭）—— 不通知设置页。 */
export async function cancelCapture(): Promise<{ ok: true }> {
  cleanup();
  return { ok: true };
}

/**
 * 用户主动取消（工具条「取消」按钮）—— 关窗后由 'closed' 处理器通知设置页 cancelled
 * 并清理状态。不走 cleanup()（那会置 closingProgrammatically 而吞掉通知）。
 */
export async function cancelCaptureByUser(): Promise<{ ok: true }> {
  const win = captureWindow;
  if (win && !win.isDestroyed()) win.destroy();
  return { ok: true };
}

export function getCaptureStatus(params: {
  projectRoot: string;
  env: string;
  accountKey: string;
}): { ok: boolean; captured: boolean; capturedAt?: string } {
  try {
    const p = storageStatePath((params.projectRoot || '').trim(), params.env, params.accountKey);
    if (params.projectRoot && fs.existsSync(p)) {
      return { ok: true, captured: true, capturedAt: fs.statSync(p).mtime.toISOString() };
    }
    return { ok: true, captured: false };
  } catch {
    return { ok: true, captured: false };
  }
}

export function clearCaptured(params: {
  projectRoot: string;
  env: string;
  accountKey: string;
}): { ok: boolean; error?: string } {
  try {
    const p = storageStatePath((params.projectRoot || '').trim(), params.env, params.accountKey);
    if (params.projectRoot && fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'clear failed' };
  }
}

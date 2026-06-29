/**
 * 获取登录态（测试账号设置）—— Electron BrowserWindow 抓取登录态。
 *
 * 打开一个隔离的 BrowserWindow，导航到测试站点的 frontendBaseUrl，让用户手动登录一次
 * （支持验证码 / 2FA，不自动提交），然后把 cookie + 各 origin 的 localStorage 组装成
 * Playwright 标准 storageState，写入
 *   {projectRoot}/AI_LabTest/.auth/{env}.{sanitize(key)}.storageState.json
 * 供 AI_LabTest 用 `--storage-state` 重放（SPA 免源码）。CodePilot 只负责抓取 + 写文件，
 * 重放在 AI_LabTest 侧。契约见 docs/handover/test-account-settings.md。
 *
 * 安全：第三方站点页面 —— 无 preload（页面拿不到 electronAPI）、sandbox、独立内存
 * partition（cookie/localStorage 不污染主会话、随会话销毁）、拒绝所有权限请求、阻止
 * window.open（但放行就地导航，登录/SSO 需要）。同一时刻只允许一个抓取会话。
 */

import { BrowserWindow, session } from 'electron';
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

// 同一时刻只允许一个抓取会话（与 AI_LabTest 一致）。
let captureWindow: BrowserWindow | null = null;
let capturePartition: string | null = null;
const originLocalStorage = new Map<string, Record<string, string>>();

/** 与 AI_LabTest runner 完全一致的 account key sanitize（否则 runner 找不到文件）。 */
function sanitizeAccountKey(key: string): string {
  return String(key).replace(/[^A-Za-z0-9_-]/g, '_');
}

function storageStatePath(projectRoot: string, env: string, accountKey: string): string {
  const e = env || 'local';
  return path.join(projectRoot, 'AI_LabTest', '.auth', `${e}.${sanitizeAccountKey(accountKey)}.storageState.json`);
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

async function snapshotCurrentOrigin(win: BrowserWindow): Promise<void> {
  try {
    const url = win.webContents.getURL();
    if (!/^https?:/i.test(url)) return;
    const origin = new URL(url).origin;
    const json = (await win.webContents.executeJavaScript(HARVEST_JS, true)) as string;
    const data = JSON.parse(json || '{}') as Record<string, string>;
    if (Object.keys(data).length > 0) {
      originLocalStorage.set(origin, { ...(originLocalStorage.get(origin) || {}), ...data });
    }
  } catch (e) {
    logWarn('[test-auth-capture] localStorage snapshot failed:', e);
  }
}

function cleanup(): void {
  const win = captureWindow;
  captureWindow = null;
  capturePartition = null;
  originLocalStorage.clear();
  if (win && !win.isDestroyed()) win.close();
}

export async function startCapture(params: {
  frontendBaseUrl: string;
  username?: string;
  password?: string;
}): Promise<{ ok: boolean; prefilled?: boolean; error?: string }> {
  // 重入保护：先关掉上一个会话。
  await cancelCapture();

  const url = (params.frontendBaseUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Invalid frontend URL (must start with http:// or https://)' };
  }

  originLocalStorage.clear();
  const partition = `codepilot-capture-${Date.now()}`; // 内存会话，随窗口销毁
  capturePartition = partition;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: '获取登录态 — 登录后回到 CodePilot 点「完成」',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
      // 无 preload —— 第三方页面无法访问 electronAPI / IPC
    },
  });
  captureWindow = win;
  win.setMenuBarVisibility(false);

  // 放行就地导航（登录 / SSO 跳转），但阻止开新窗口。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 拒绝第三方页面的所有权限请求（摄像头 / 麦克风 / 定位 / 通知…）。
  session.fromPartition(partition).setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // 每次加载完成抓一次当前 origin 的 localStorage（覆盖 SSO 多 origin 场景）。
  win.webContents.on('did-finish-load', () => { void snapshotCurrentOrigin(win); });
  win.on('closed', () => {
    if (captureWindow === win) {
      captureWindow = null;
      capturePartition = null;
    }
  });

  try {
    await win.loadURL(url);
  } catch (e) {
    logWarn('[test-auth-capture] loadURL failed:', e);
  }

  // best-effort 预填用户名/密码（不自动提交，让用户处理验证码 / 2FA）。
  let prefilled = false;
  try {
    await new Promise((r) => setTimeout(r, 1200));
    if (win && !win.isDestroyed()) {
      prefilled = (await win.webContents.executeJavaScript(buildPrefillJs(params.username, params.password), true)) as boolean;
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

export async function finishCapture(params: {
  projectRoot: string;
  env: string;
  accountKey: string;
}): Promise<{ ok: boolean; path?: string; origins?: number; cookies?: number; error?: string }> {
  const win = captureWindow;
  const partition = capturePartition;
  if (!win || win.isDestroyed() || !partition) {
    return { ok: false, error: 'No active capture session' };
  }
  const projectRoot = (params.projectRoot || '').trim();
  if (!projectRoot) return { ok: false, error: 'Project folder is required' };
  if (!params.accountKey) return { ok: false, error: 'Account key is required' };

  try {
    // 收尾：再抓一次当前页 origin。
    await snapshotCurrentOrigin(win);

    const electronCookies = await session.fromPartition(partition).cookies.get({});
    const cookies = electronCookies.map(mapCookie);
    const origins: StorageStateOrigin[] = Array.from(originLocalStorage.entries())
      .filter(([, kv]) => Object.keys(kv).length > 0)
      .map(([origin, kv]) => ({
        origin,
        localStorage: Object.entries(kv).map(([name, value]) => ({ name, value })),
      }));

    // 空抓取（cookie 与 origin 都空）视为失败 —— 与 AI_LabTest 的 sanity gate 一致。
    if (cookies.length === 0 && origins.length === 0) {
      return { ok: false, error: 'Captured nothing — please log in first, then click Finish' };
    }

    const ssPath = storageStatePath(projectRoot, params.env, params.accountKey);
    fs.mkdirSync(path.dirname(ssPath), { recursive: true });
    const state: StorageState = { cookies, origins };
    fs.writeFileSync(ssPath, JSON.stringify(state, null, 2), 'utf-8');

    logInfo('[test-auth-capture] wrote storageState', ssPath, `(cookies=${cookies.length}, origins=${origins.length})`);
    cleanup();
    return { ok: true, path: ssPath, origins: origins.length, cookies: cookies.length };
  } catch (e) {
    logWarn('[test-auth-capture] finish failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'capture failed' };
  }
}

export async function cancelCapture(): Promise<{ ok: true }> {
  cleanup();
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

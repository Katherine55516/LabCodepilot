/**
 * 技能市场（内部）— Electron 主进程胶水层。
 *
 * 走主进程的原因（方案 D1）：登录 token 只在主进程（绝不下发 renderer，
 * 与 feedback 同边界）；zip 落盘/解压也归主进程。renderer 经
 * window.electronAPI.skillsStore.* 拿结构化结果，错误分支只认 code。
 *
 * Phase 0 暴露 probe/list/detail；install/update/uninstall 在 Phase 2 接入
 * （下载/台账的底层能力已在本文件与 skills-store-core 备好）。
 *
 * 方案：docs/exec-plans/active/skills-store-internal.md
 * 服务端契约：codeagent-server docs/skills-store-api.md
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';

import { getBackendBase } from './auth/config';
import { loadToken } from './auth/storage';
import { logInfo, logWarn } from './auth/log';
import {
  LEDGER_BASENAME,
  MAX_ZIP_BYTES,
  parseHubFailure,
  parseLedger,
  serializeLedger,
  healLedger,
  mergeInstallState,
  type Ledger,
  type SkillsStoreFailure,
} from './skills-store-core';

/** 列表/详情超时，对齐服务端 APP_SKILLS_HUB_LIST_TIMEOUT_SECONDS 的量级。 */
const API_TIMEOUT_MS = 12_000;
/** 下载超时，对齐服务端下载超时 60s。 */
export const DOWNLOAD_TIMEOUT_MS = 65_000;

const NETWORK_FAILURE: SkillsStoreFailure = { ok: false, error: 'network' };

// ── 台账（fs 侧；纯逻辑在 core）──────────────────────────────────────────────

export function skillsRootDir(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

function ledgerPath(): string {
  return path.join(skillsRootDir(), LEDGER_BASENAME);
}

function hasSkillDir(dirName: string): boolean {
  return fs.existsSync(path.join(skillsRootDir(), dirName, 'SKILL.md'));
}

/** 读台账并就地自愈（目录被「我的技能」侧删除后清掉死条目，见方案 §7）。 */
export function loadLedger(): Ledger {
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(ledgerPath(), 'utf-8');
  } catch {
    raw = null;
  }
  const parsed = parseLedger(raw);
  const { ledger, removed } = healLedger(parsed, hasSkillDir);
  if (removed.length > 0) {
    logInfo('[skills-store] ledger self-heal, removed stale entries:', removed.join(','));
    try {
      saveLedger(ledger);
    } catch {
      // 写失败不阻断读路径 — 下次再愈
    }
  }
  return ledger;
}

export function saveLedger(ledger: Ledger): void {
  const dir = skillsRootDir();
  fs.mkdirSync(dir, { recursive: true });
  // 临时文件 + rename，避免半写台账
  const tmp = path.join(dir, `${LEDGER_BASENAME}.tmp`);
  fs.writeFileSync(tmp, serializeLedger(ledger), 'utf-8');
  fs.renameSync(tmp, ledgerPath());
}

// ── Hub 请求 ─────────────────────────────────────────────────────────────────

type HubResult<T> = { ok: true; data: T } | SkillsStoreFailure;

/**
 * 认证 GET。未登录直接短路（不发请求）；非 2xx 解析错误 body 归一为失败信封；
 * 网络/超时 → 'network'。
 */
async function hubGet(
  pathname: string,
  opts?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<{ ok: true; res: Response } | SkillsStoreFailure> {
  const token = loadToken();
  if (!token) return { ok: false, error: 'not-logged-in' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${getBackendBase()}${pathname}`, {
      headers: { Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
      signal: controller.signal,
    });
  } catch {
    return NETWORK_FAILURE;
  } finally {
    clearTimeout(timeout);
  }

  // 304 是下载缓存协商的合法结果，交给调用方分支
  if (res.ok || res.status === 304) return { ok: true, res };

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const failure = parseHubFailure(res.status, body, res.headers.get('retry-after'));
  if (failure.error === 'HUB_UNAVAILABLE') {
    // 服务端契约:凭证类已在服务端收敛为 502 并报警;客户端只需可观测
    logWarn('[skills-store] hub unavailable:', failure.status ?? '', failure.message ?? '');
  }
  return failure;
}

async function hubGetJson(pathname: string): Promise<HubResult<Record<string, unknown>>> {
  const r = await hubGet(pathname);
  if (!r.ok) return r;
  try {
    return { ok: true, data: (await r.res.json()) as Record<string, unknown> };
  } catch {
    return NETWORK_FAILURE;
  }
}

// ── 客户端 API（list / detail / download）───────────────────────────────────

export interface ListParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** 列表：view=all（D6：一期不暴露 view 切换），主进程合并 isInstalled/hasUpdate。 */
export async function listSkills(params: ListParams): Promise<
  | { ok: true; items: Record<string, unknown>[]; pagination: Record<string, unknown> }
  | SkillsStoreFailure
> {
  const q = new URLSearchParams({ view: 'all' });
  if (params.keyword) q.set('keyword', params.keyword.slice(0, 100));
  q.set('page', String(Math.max(1, Math.trunc(params.page ?? 1))));
  q.set('pageSize', String(Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? 20)))));

  const r = await hubGetJson(`/api/v1/skills?${q}`);
  if (!r.ok) return r;

  const ledger = loadLedger();
  const rawItems = Array.isArray(r.data.items) ? (r.data.items as Record<string, unknown>[]) : [];
  const items = rawItems.map((item) => mergeInstallState(item, ledger));
  const pagination =
    r.data.pagination && typeof r.data.pagination === 'object'
      ? (r.data.pagination as Record<string, unknown>)
      : { total: items.length, page: 1, pageSize: items.length, totalPages: 1 };
  return { ok: true, items, pagination };
}

/** 详情：withContent 仅 INLINE 型有意义（服务端对 SANDBOX 忽略该参数）。 */
export async function getSkillDetail(
  skillId: string,
  opts?: { withContent?: boolean },
): Promise<{ ok: true; skill: Record<string, unknown> } | SkillsStoreFailure> {
  const q = opts?.withContent ? '?withContent=1' : '';
  const r = await hubGetJson(`/api/v1/skills/${encodeURIComponent(skillId)}${q}`);
  if (!r.ok) return r;
  const ledger = loadLedger();
  return { ok: true, skill: mergeInstallState(r.data, ledger) };
}

export interface DownloadOutcome {
  /** 304 → notModified:true，未写文件。 */
  notModified: boolean;
  /** 200 时的落盘路径（临时文件，调用方负责清理）。 */
  filePath?: string;
  /** 下载响应 ETag 头原文（含引号）— 台账原样存，If-None-Match 原样回传。 */
  etag?: string;
  bytes?: number;
}

/**
 * 下载 zip 到临时文件（流式，边收边计数）。Phase 2 的安装事务在此之上做
 * 解压/校验/落位。大小超限中止并清理，不留半成品。
 */
export async function downloadSkillZip(
  skillId: string,
  opts?: { ifNoneMatch?: string },
): Promise<{ ok: true; outcome: DownloadOutcome } | SkillsStoreFailure> {
  const headers: Record<string, string> = {};
  if (opts?.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;

  const r = await hubGet(`/api/v1/skills/${encodeURIComponent(skillId)}/download`, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    headers,
  });
  if (!r.ok) return r;
  const res = r.res;

  if (res.status === 304) {
    return { ok: true, outcome: { notModified: true } };
  }

  // Content-Length 预检（若有）+ 实收字节复核双闸
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ZIP_BYTES) {
    return { ok: false, error: 'HUB_UNAVAILABLE', message: 'zip exceeds size limit' };
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `anl-skill-${skillId.replace(/[^a-zA-Z0-9]/g, '')}-${process.pid}-${Date.now()}.zip`,
  );
  let received = 0;
  try {
    if (!res.body) return NETWORK_FAILURE;
    const out = fs.createWriteStream(tmpFile, { flags: 'wx' });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_ZIP_BYTES) {
          throw new Error('zip exceeds size limit');
        }
        await new Promise<void>((resolve, reject) => {
          out.write(value, (err) => (err ? reject(err) : resolve()));
        });
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }
  } catch (e) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // 清理尽力而为
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('size limit')) {
      return { ok: false, error: 'HUB_UNAVAILABLE', message: 'zip exceeds size limit' };
    }
    return NETWORK_FAILURE;
  }

  return {
    ok: true,
    outcome: {
      notModified: false,
      filePath: tmpFile,
      etag: res.headers.get('etag') ?? undefined,
      bytes: received,
    },
  };
}

// ── IPC 注册 ─────────────────────────────────────────────────────────────────

/**
 * probe：renderer 在 Skills 页 mount 时调一次决定 tab 可见性（方案 D5）。
 * SKILLS_NOT_CONFIGURED → 隐藏；not-logged-in → 显示登录空态。
 * 结果不在主进程缓存 — renderer 会话级缓存即可，登录态变化时重新 probe。
 */
export function registerSkillsStoreIpc(ipcMain: IpcMain): void {
  ipcMain.handle('skills-store:probe', async () => {
    const r = await listSkills({ page: 1, pageSize: 1 });
    if (r.ok) return { ok: true as const };
    return r;
  });

  ipcMain.handle('skills-store:list', async (_event, params: unknown) => {
    // IPC 是可绕过的边界:入参在主进程重新收口,不信任 renderer
    const p = (params ?? {}) as Record<string, unknown>;
    return listSkills({
      keyword: typeof p.keyword === 'string' ? p.keyword : undefined,
      page: typeof p.page === 'number' ? p.page : undefined,
      pageSize: typeof p.pageSize === 'number' ? p.pageSize : undefined,
    });
  });

  ipcMain.handle('skills-store:detail', async (_event, skillId: unknown, opts: unknown) => {
    if (typeof skillId !== 'string' || !skillId) {
      return { ok: false, error: 'VALIDATION_FAILED' } satisfies SkillsStoreFailure;
    }
    const o = (opts ?? {}) as Record<string, unknown>;
    return getSkillDetail(skillId, { withContent: o.withContent === true });
  });
}

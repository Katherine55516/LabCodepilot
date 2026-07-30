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
  extractZip,
  replaceDirAtomic,
  skillsRootDir,
  loadLedgerHealed,
  saveLedger,
} from './skills-store-fs';
import {
  MAX_ZIP_BYTES,
  findSkillContentRoot,
  resolveDirName,
  parseHubFailure,
  mergeInstallState,
  type Ledger,
  type SkillsStoreFailure,
} from './skills-store-core';

/** 列表/详情超时，对齐服务端 APP_SKILLS_HUB_LIST_TIMEOUT_SECONDS 的量级。 */
const API_TIMEOUT_MS = 12_000;
/** 下载超时，对齐服务端下载超时 60s。 */
export const DOWNLOAD_TIMEOUT_MS = 65_000;

const NETWORK_FAILURE: SkillsStoreFailure = { ok: false, error: 'network' };

// ── 台账（fs 层在 skills-store-fs.ts,此处只补日志）──────────────────────────

/** 读台账并就地自愈（目录被「我的技能」侧删除后清掉死条目，见方案 §7）。 */
function loadLedger(): Ledger {
  const { ledger, removed } = loadLedgerHealed();
  if (removed.length > 0) {
    logInfo('[skills-store] ledger self-heal, removed stale entries:', removed.join(','));
  }
  return ledger;
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
  // CODEPILOT_SKILLS_TOKEN_OVERRIDE:真实链路集成测试的注入口(配合 BACKEND_BASE
  // 指本地 codeagent-server + 假 JWKS 签发的 JWT),生产不设;不提权 — 与用户
  // 自改 BACKEND_BASE 同级,只影响本机自己的进程。
  const token = process.env.CODEPILOT_SKILLS_TOKEN_OVERRIDE?.trim() || loadToken();
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

// ── 安装事务（Phase 2）──────────────────────────────────────────────────────

/** 安装类失败的客户端自有码（非 Hub 码）：包不合法 / 落位冲突 / 解压失败。 */
const INVALID_PACKAGE: SkillsStoreFailure = {
  ok: false,
  error: 'INVALID_PACKAGE',
  message: 'skill package is missing SKILL.md',
};

interface DeployMeta {
  skillId: string;
  slug: string;
  displayName: string;
  contentHash: string;
  downloadVersion: number;
  etag: string;
}

/** 已下载 zip → 解压校验 → 落位 → 写台账。install 与 update(200 分支)共用。 */
async function deployZip(
  zipPath: string,
  meta: DeployMeta,
): Promise<{ ok: true; dirName: string } | SkillsStoreFailure> {
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-skill-extract-'));
  try {
    try {
      await extractZip(zipPath, extractDir);
    } catch (e) {
      logWarn('[skills-store] extract failed:', (e as Error).message);
      return { ok: false, error: 'INVALID_PACKAGE', message: (e as Error).message };
    }

    // 内容根:SKILL.md 在 zip 根,或唯一外壳目录内(契约未约定,两种都接)
    const listing = fs.readdirSync(extractDir, { withFileTypes: true });
    const root = findSkillContentRoot({
      files: listing.filter((e) => e.isFile()).map((e) => e.name),
      dirs: listing.filter((e) => e.isDirectory()).map((e) => e.name),
      hasSkillMdInDir: (dir) => fs.existsSync(path.join(extractDir, dir, 'SKILL.md')),
    });
    if (!root) return INVALID_PACKAGE;
    const contentDir = root === '.' ? extractDir : path.join(extractDir, root);

    const ledger = loadLedger();
    const rootDir = skillsRootDir();
    fs.mkdirSync(rootDir, { recursive: true });
    const taken = new Set(
      fs
        .readdirSync(rootDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );
    const dirName = resolveDirName(meta.slug, meta.skillId, ledger, taken);
    if (!dirName) {
      return { ok: false, error: 'DIR_CONFLICT', message: `dir name exhausted for ${meta.slug}` };
    }

    replaceDirAtomic(contentDir, path.join(rootDir, dirName));

    ledger.skills[meta.skillId] = {
      slug: meta.slug,
      dirName,
      displayName: meta.displayName,
      contentHash: meta.contentHash,
      etag: meta.etag,
      downloadVersion: meta.downloadVersion,
      installedAt: new Date().toISOString(),
    };
    saveLedger(ledger);
    return { ok: true, dirName };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

/** 详情 → 元数据快照（下载响应本身没有名称/版本,与服务端审计同款预取姿势）。 */
function metaFromDetail(skillId: string, skill: Record<string, unknown>, etag: string): DeployMeta {
  const slug = typeof skill.slug === 'string' && skill.slug ? skill.slug : skillId;
  return {
    skillId,
    slug,
    displayName:
      typeof skill.displayName === 'string' && skill.displayName ? skill.displayName : slug,
    contentHash: typeof skill.contentHash === 'string' ? skill.contentHash : '',
    downloadVersion: typeof skill.downloadVersion === 'number' ? skill.downloadVersion : 0,
    etag,
  };
}

export async function installSkill(
  skillId: string,
): Promise<{ ok: true; dirName: string } | SkillsStoreFailure> {
  const d = await getSkillDetail(skillId);
  if (!d.ok) return d;

  const dl = await downloadSkillZip(skillId);
  if (!dl.ok) return dl;
  if (dl.outcome.notModified || !dl.outcome.filePath) {
    // 未带 If-None-Match,304 不应出现 — 防御性兜底
    return { ok: false, error: 'HUB_UNAVAILABLE', message: 'unexpected 304 on install' };
  }
  try {
    const r = await deployZip(
      dl.outcome.filePath,
      metaFromDetail(skillId, d.skill, dl.outcome.etag ?? ''),
    );
    if (r.ok) {
      logInfo('[skills-store] installed', skillId, '→', r.dirName, `${dl.outcome.bytes ?? 0}B`);
    } else {
      logWarn('[skills-store] install failed:', skillId, r.error, r.message ?? '');
    }
    return r;
  } finally {
    fs.rmSync(dl.outcome.filePath, { force: true });
  }
}

export async function updateSkill(
  skillId: string,
): Promise<{ ok: true; updated: boolean } | SkillsStoreFailure> {
  const ledger = loadLedger();
  const entry = ledger.skills[skillId];
  if (!entry) {
    // 台账无此项(如「我的技能」侧删过) → 视作全新安装
    const r = await installSkill(skillId);
    return r.ok ? { ok: true, updated: true } : r;
  }

  const d = await getSkillDetail(skillId);
  if (!d.ok) return d;
  const hubHash = typeof d.skill.contentHash === 'string' ? d.skill.contentHash : '';
  if (hubHash && entry.contentHash && hubHash === entry.contentHash) {
    return { ok: true, updated: false };
  }

  const dl = await downloadSkillZip(skillId, { ifNoneMatch: entry.etag || undefined });
  if (!dl.ok) return dl;

  if (dl.outcome.notModified) {
    // ETag 权威说内容没变 — 只把台账对齐 Hub 元数据(「不变不传」)
    entry.contentHash = hubHash || entry.contentHash;
    entry.downloadVersion =
      typeof d.skill.downloadVersion === 'number' ? d.skill.downloadVersion : entry.downloadVersion;
    saveLedger(ledger);
    logInfo('[skills-store] update 304 (not modified):', skillId);
    return { ok: true, updated: false };
  }
  if (!dl.outcome.filePath) return { ok: false, error: 'HUB_UNAVAILABLE', message: 'empty download' };

  try {
    const r = await deployZip(
      dl.outcome.filePath,
      metaFromDetail(skillId, d.skill, dl.outcome.etag ?? ''),
    );
    if (r.ok) {
      logInfo('[skills-store] updated', skillId, '→', r.dirName);
      return { ok: true, updated: true };
    }
    logWarn('[skills-store] update failed:', skillId, r.error, r.message ?? '');
    return r;
  } finally {
    fs.rmSync(dl.outcome.filePath, { force: true });
  }
}

export function uninstallSkill(skillId: string): { ok: true } | SkillsStoreFailure {
  const ledger = loadLedger();
  const entry = ledger.skills[skillId];
  if (entry) {
    const root = path.resolve(skillsRootDir());
    const dir = path.resolve(root, entry.dirName);
    // 目录围栏:台账被手改的极端情形下也绝不删到 skills 根之外
    if (dir.startsWith(root + path.sep) && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    delete ledger.skills[skillId];
    saveLedger(ledger);
    logInfo('[skills-store] uninstalled', skillId, entry.dirName);
  }
  return { ok: true };
}

// ── IPC 注册 ─────────────────────────────────────────────────────────────────

/**
 * 变更类操作串行化:台账是读-改-写文件,并发安装/卸载会互相丢写。
 * 简单 promise 链即可(操作秒级,无需真队列)。
 */
let mutationChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = mutationChain.then(fn, fn);
  mutationChain = next.catch(() => undefined);
  return next;
}

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

  const badId: SkillsStoreFailure = { ok: false, error: 'VALIDATION_FAILED' };

  ipcMain.handle('skills-store:install', (_event, skillId: unknown) => {
    if (typeof skillId !== 'string' || !skillId) return badId;
    return serialized(() => installSkill(skillId));
  });

  ipcMain.handle('skills-store:update', (_event, skillId: unknown) => {
    if (typeof skillId !== 'string' || !skillId) return badId;
    return serialized(() => updateSkill(skillId));
  });

  ipcMain.handle('skills-store:uninstall', (_event, skillId: unknown) => {
    if (typeof skillId !== 'string' || !skillId) return badId;
    return serialized(() => uninstallSkill(skillId));
  });
}

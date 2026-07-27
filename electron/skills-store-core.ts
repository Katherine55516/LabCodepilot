/**
 * 技能市场（内部）的纯逻辑核心 — 无 electron / fs 依赖，可被单测直接 import。
 *
 * 职责：Hub 错误 body 解析与归一、安装台账（.internal-store.json）的
 * 解析/序列化/自愈/状态合并、安装目录名冲突解决、zip 条目安全守卫。
 * Electron 侧的胶水（fetch/token/落盘/解压循环）在 skills-store.ts。
 *
 * 方案见 docs/exec-plans/active/skills-store-internal.md（决策 D2/D3 与 §8 安全清单）。
 * 服务端契约见 codeagent-server docs/skills-store-api.md：错误分支只认 code，
 * 列表/详情字段可能新增 — 本模块对 item 只读不重建，未知字段原样透传。
 */

import path from 'node:path';

// ── 错误归一 ─────────────────────────────────────────────────────────────────

/**
 * 服务端契约中承诺稳定的错误码（含服务端自有的两个兜底码）。
 * 未知 code 原样保留 — renderer 对不认识的码走通用错误分支。
 */
export const KNOWN_HUB_CODES = [
  'VALIDATION_FAILED',
  'USER_NOT_ACTIVE',
  'SKILL_NOT_VISIBLE',
  'SKILL_NOT_DOWNLOADABLE',
  'SKILL_NOT_FOUND',
  'USER_NOT_FOUND',
  'RATE_LIMITED',
  'HUB_UNAVAILABLE',
  'SKILLS_NOT_CONFIGURED',
] as const;

export type HubCode = (typeof KNOWN_HUB_CODES)[number];

/** IPC 统一失败信封（成功分支各接口自定）。 */
export interface SkillsStoreFailure {
  ok: false;
  /** 'not-logged-in' | 'network' | Hub 错误码（含未知码原样透传） */
  error: 'not-logged-in' | 'network' | string;
  status?: number;
  /** RATE_LIMITED 时的退避秒数（来自 Retry-After 头） */
  retryAfter?: number;
  message?: string;
}

/**
 * 把 Hub 的非 2xx 响应归一为失败信封。
 * body 形状契约为 {"detail": {"code", "message"}}；解析不出 code 时按状态码
 * 兜底（503→SKILLS_NOT_CONFIGURED / 429→RATE_LIMITED / 其余→HUB_UNAVAILABLE），
 * 与服务端错误表对齐。401 是本服务登录态无效（不是 Hub 码）→ not-logged-in。
 */
export function parseHubFailure(
  status: number,
  body: unknown,
  retryAfterHeader?: string | null,
): SkillsStoreFailure {
  if (status === 401) {
    return { ok: false, error: 'not-logged-in', status };
  }
  let code: string | undefined;
  let message: string | undefined;
  if (body && typeof body === 'object') {
    const detail = (body as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object') {
      const d = detail as { code?: unknown; message?: unknown };
      if (typeof d.code === 'string' && d.code) code = d.code;
      if (typeof d.message === 'string') message = d.message;
    }
  }
  if (!code) {
    code =
      status === 503 ? 'SKILLS_NOT_CONFIGURED'
      : status === 429 ? 'RATE_LIMITED'
      : 'HUB_UNAVAILABLE';
  }
  const failure: SkillsStoreFailure = { ok: false, error: code, status, message };
  if (code === 'RATE_LIMITED') {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs > 0) failure.retryAfter = Math.ceil(secs);
  }
  return failure;
}

// ── 安装台账 ─────────────────────────────────────────────────────────────────

export const LEDGER_VERSION = 1;

/** 台账文件名（落 ~/.claude/skills/ 根下，与安装产物同根）。 */
export const LEDGER_BASENAME = '.internal-store.json';

export interface LedgerEntry {
  slug: string;
  /** 实际安装目录名 — 常态 = slug，撞名时 = `${slug}--${id前8位}`（D2）。 */
  dirName: string;
  displayName: string;
  contentHash: string;
  /** 下载响应 ETag 头原文（含引号）— If-None-Match 必须原样回传，勿拿 contentHash 拼。 */
  etag: string;
  downloadVersion: number;
  installedAt: string;
}

export interface Ledger {
  version: number;
  /** key = Hub 的 skillId（cuid）— 目录名可变，id 不变。 */
  skills: Record<string, LedgerEntry>;
}

/** 容错解析：任何损坏形状都归零成空台账（丢台账只影响徽章，不影响已装文件）。 */
export function parseLedger(raw: string | null | undefined): Ledger {
  if (!raw) return { version: LEDGER_VERSION, skills: {} };
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; skills?: unknown };
    const skills: Record<string, LedgerEntry> = {};
    if (parsed.skills && typeof parsed.skills === 'object') {
      for (const [id, v] of Object.entries(parsed.skills as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue;
        const e = v as Partial<LedgerEntry>;
        // dirName/slug 是安装与卸载定位的最低要求，缺了视为死条目
        if (typeof e.dirName !== 'string' || !e.dirName) continue;
        if (typeof e.slug !== 'string' || !e.slug) continue;
        skills[id] = {
          slug: e.slug,
          dirName: e.dirName,
          displayName: typeof e.displayName === 'string' ? e.displayName : e.slug,
          contentHash: typeof e.contentHash === 'string' ? e.contentHash : '',
          etag: typeof e.etag === 'string' ? e.etag : '',
          downloadVersion: typeof e.downloadVersion === 'number' ? e.downloadVersion : 0,
          installedAt: typeof e.installedAt === 'string' ? e.installedAt : '',
        };
      }
    }
    return { version: LEDGER_VERSION, skills };
  } catch {
    return { version: LEDGER_VERSION, skills: {} };
  }
}

export function serializeLedger(ledger: Ledger): string {
  return JSON.stringify(ledger, null, 2) + '\n';
}

/**
 * 台账自愈：目录（或其 SKILL.md）已不存在的条目移除 — 用户从「我的技能」
 * 删除只删目录不动台账，靠这里兜底避免幽灵「已安装」。
 * hasSkillDir 由胶水层注入（core 不碰 fs）。
 */
export function healLedger(
  ledger: Ledger,
  hasSkillDir: (dirName: string) => boolean,
): { ledger: Ledger; removed: string[] } {
  const removed: string[] = [];
  const skills: Record<string, LedgerEntry> = {};
  for (const [id, entry] of Object.entries(ledger.skills)) {
    if (hasSkillDir(entry.dirName)) {
      skills[id] = entry;
    } else {
      removed.push(id);
    }
  }
  return { ledger: { version: LEDGER_VERSION, skills }, removed };
}

// ── 列表/详情的安装状态合并 ──────────────────────────────────────────────────

/** Hub item 中本模块读取的字段（服务端可能新增字段 — 只声明用到的，其余透传）。 */
export interface HubSkillItem {
  id?: unknown;
  contentHash?: unknown;
  state?: unknown;
  [key: string]: unknown;
}

export interface InstallStateFlags {
  isInstalled: boolean;
  /** 台账 contentHash ≠ Hub 当前值；DEPRECATED（已下架）恒 false（保留本地、停止更新）。 */
  hasUpdate: boolean;
  installedAt?: string;
}

/** 给单个 Hub item 附加安装状态（原样保留未知字段）。 */
export function mergeInstallState<T extends HubSkillItem>(
  item: T,
  ledger: Ledger,
): T & InstallStateFlags {
  const id = typeof item.id === 'string' ? item.id : '';
  const entry = id ? ledger.skills[id] : undefined;
  if (!entry) {
    return { ...item, isInstalled: false, hasUpdate: false };
  }
  const hubHash = typeof item.contentHash === 'string' ? item.contentHash : '';
  const deprecated = item.state === 'DEPRECATED';
  return {
    ...item,
    isInstalled: true,
    hasUpdate: !deprecated && !!hubHash && !!entry.contentHash && hubHash !== entry.contentHash,
    installedAt: entry.installedAt || undefined,
  };
}

// ── 安装目录名（D2）────────────────────────────────────────────────────────────

/**
 * slug 清洗成安全目录名：只留 [a-zA-Z0-9._-]，去掉开头的点（隐藏目录/台账
 * 文件名前缀），空结果回退 'skill'。Hub 的 slug 契约上就是 kebab-case，
 * 这里只是不信任输入的防御。
 */
export function sanitizeSlugForDir(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '');
  return cleaned || 'skill';
}

/**
 * 解析安装目录名：
 *  1. 台账里已有该 skillId → 沿用原目录名（更新/重装路径，目录不漂移）；
 *  2. slug 目录未被占用 → slug；
 *  3. slug 被别的 skillId（或非我方目录）占用 → `${slug}--${id前8位}`；
 *  4. 连后缀名也被占 → null（调用方报错，实际不可达）。
 * takenDirs = ~/.claude/skills 下现存目录名全集（含非本市场安装的）。
 */
export function resolveDirName(
  slug: string,
  skillId: string,
  ledger: Ledger,
  takenDirs: ReadonlySet<string>,
): string | null {
  const existing = ledger.skills[skillId];
  if (existing) return existing.dirName;

  const base = sanitizeSlugForDir(slug);
  const claimedByOther = (dir: string): boolean => {
    if (!takenDirs.has(dir)) {
      // 目录不存在，但可能被台账里另一条目预定（目录被手删后台账未自愈的窗口期）
      return Object.entries(ledger.skills).some(([id, e]) => id !== skillId && e.dirName === dir);
    }
    // 目录存在：属于本市场其他技能或来路不明（用户自建/外部 CLI）→ 都算占用
    return true;
  };

  if (!claimedByOther(base)) return base;
  const suffixed = `${base}--${skillId.slice(0, 8)}`;
  if (!claimedByOther(suffixed)) return suffixed;
  return null;
}

// ── zip 安全守卫（§8）────────────────────────────────────────────────────────

/** zip 本体上限，对齐服务端契约（≤50MB）。 */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
/** 条目数上限 — 技能包是文档+脚本的量级，2000 已远超正常需要。 */
export const MAX_ZIP_ENTRIES = 2000;
/** 解压后总字节上限（zip 本体限制之外的第二道闸，防高压缩比 zip bomb）。 */
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/** unix 外部属性高 16 位是 mode；S_IFLNK=0o120000。symlink 条目一律拒绝。 */
export function isSymlinkEntry(externalFileAttributes: number): boolean {
  const mode = externalFileAttributes >>> 16;
  return (mode & 0o170000) === 0o120000;
}

/**
 * 条目路径围栏：resolve 后必须落在 destDir 内。yauzl 在 decodeStrings（默认）
 * 下已拒绝 `..`/绝对路径/反斜杠（POC 已验证），这里是双保险。
 */
export function entryPathIsContained(destDir: string, entryFileName: string): boolean {
  const resolvedDest = path.resolve(destDir);
  const target = path.resolve(resolvedDest, entryFileName);
  return target === resolvedDest || target.startsWith(resolvedDest + path.sep);
}

/**
 * 判定解压产物的内容根：SKILL.md 在根 → '.'；根下唯一一个目录且其中有
 * SKILL.md → 该目录（Hub 打包可能带一层外壳目录，契约未约定，两种都接）。
 * 都不是 → null（不是合法技能包）。
 * entries 传解压产物根下的一层列表（由胶水层读盘注入）。
 */
export function findSkillContentRoot(entries: {
  files: string[];
  dirs: string[];
  hasSkillMdInDir: (dir: string) => boolean;
}): string | null {
  if (entries.files.includes('SKILL.md')) return '.';
  if (entries.dirs.length === 1 && entries.files.length === 0) {
    const only = entries.dirs[0];
    if (entries.hasSkillMdInDir(only)) return only;
  }
  return null;
}

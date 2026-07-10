import fs from 'fs';
import path from 'path';
import { REGRESSION_TAG, REGRESSION_LIBRARY_TASK } from './library-constants';
import { sha256Hex, stableStringify } from './script-artifacts';

// 常量在 library-constants.ts(纯字符串、客户端安全);此处再导出,保持既有服务端导入路径不变。
export { REGRESSION_TAG, REGRESSION_LIBRARY_TASK };

/**
 * 测试工作台 · 回归用例库(需求:每个任务在「用例设计完成后」自动把打了「回归测试」标签的
 * 用例沉淀进一个项目级库;库可查看/管理,并能作为跨任务回归套件一键重跑)。
 *
 * 设计要点(详见 docs/exec-plans/active/regression-library.md):
 *   - 作用域:项目级,单文件 `<projectPath>/AI_LabTest/testCase/回归用例库.json`(每项目独立,
 *     与 AI_LabTest 其余产物一致;一个项目=一个被测系统,重跑时共享 environments.json)。
 *   - 入库范围:仅 `tags` 含「回归测试」的用例(=回归集);不看执行结果(pass/fail 都入)。
 *   - 更新语义:upsert by 来源任务——某任务再次入库,先删它上次的全部贡献,再插当前回归集。
 *     故重复跑/改用例不产生重复;任务回归集缩小(某用例掉了标签)库同步移除。
 *   - 溯源:每条库用例记 `_source:{ task, originalId, depositedAt }`,支持按任务分组/移除、
 *     重跑报告按来源任务归组。
 *   - 重跑:`buildRunnableCases` 把库聚合成标准 `{cases:[...]}`,跨任务 id 冲突用命名空间保证
 *     唯一(执行/归约按 id 索引,跨任务 TC-001 会撞),idMap 供报告把 runId 反解回「来源任务·原ID」。
 *
 * 与任务 cases.json 的区别:库顶层用 `entries`(非 `cases`),避免被别处当普通用例文件消费。
 */

/** 一条测试用例的宽松形状(cases.json 里字段较多且随规范演进,这里只强约束用到的两个)。 */
export type TestCase = Record<string, unknown> & { id?: unknown; tags?: unknown };

/** 库条目的来源溯源。 */
export interface LibrarySource {
  /** 来源任务名(upsert 主键维度)。 */
  task: string;
  /** 该用例在来源任务里的原始 id(展示 + 重跑 idMap 反解用)。 */
  originalId: string;
  /** 入库时间(ISO)。 */
  depositedAt: string;
}

/** 评审态(二期)。approved=已确认入回归池;pending=待人工确认。**不参与发版红线**,只影响
 * 「仅执行已确认用例」开关与库内曝光(决策日志 2026-07-10)。 */
export type ReviewState = 'approved' | 'pending';

/** 一条 rev 变更记录(最新在前)。 */
export interface LibHistoryEntry {
  rev: number;
  /** 变更时间(ISO)。 */
  at: string;
  note: string;
}

/**
 * 库治理元数据(二/三期),与 `_source` 并列的 `_lib` 命名空间——不污染用例业务字段,
 * 也不会随 `buildRunnableCases` 泄漏进 AI 执行 prompt。
 *
 * 缺失即安全默认(存量零迁移):`reviewState='approved'`(v2 计划 §9 的存量回填建议)、
 * `rev=1`、未隔离。**新入库**的用例默认 `pending`(见 depositTask)。
 */
export interface LibMeta {
  reviewState: ReviewState;
  rev: number;
  /** 用例体语义指纹(rev 递增判据);存量条目缺失 → 首次写入时惰性回填,不 bump rev。 */
  fingerprint?: string;
  /** rev 变更时间线(最新在前,上限 HISTORY_MAX 条)。 */
  history: LibHistoryEntry[];
  /** 隔离:聚合执行排除、不计发版红线;但报告横幅强制曝光条数(护栏)。 */
  quarantined: boolean;
  quarantinedAt?: string;
  quarantineReason?: string;
}

/** 库条目 = 原用例全字段 + `_source` 溯源 + `_lib` 治理元数据(可缺失)。 */
export type LibraryEntry = TestCase & { _source: LibrarySource; _lib?: LibMeta };

/** 条目身份(批量评审/隔离/套件引用的单位;与 suites.SuiteKey 结构等价)。 */
export interface EntryKey {
  task: string;
  originalId: string;
}

/** rev 时间线保留上限(超出丢弃最旧的)。 */
const HISTORY_MAX = 20;

function isHistoryEntry(h: unknown): h is LibHistoryEntry {
  return !!h && typeof h === 'object'
    && typeof (h as LibHistoryEntry).rev === 'number'
    && typeof (h as LibHistoryEntry).at === 'string'
    && typeof (h as LibHistoryEntry).note === 'string';
}

/**
 * 读一条条目的治理元数据,宽松归一(缺 `_lib` / 字段类型不对 → 安全默认)。
 * 兼容 v2 一期 `suites.isQuarantined` 读的顶层 `quarantined` 布尔。
 */
export function readLibMeta(e: LibraryEntry): LibMeta {
  const raw = (e as { _lib?: unknown })._lib;
  const m: Partial<LibMeta> = raw && typeof raw === 'object' ? (raw as Partial<LibMeta>) : {};
  const legacyQuar = (e as { quarantined?: unknown }).quarantined === true;
  return {
    reviewState: m.reviewState === 'pending' ? 'pending' : 'approved',
    rev: typeof m.rev === 'number' && m.rev > 0 ? Math.floor(m.rev) : 1,
    fingerprint: typeof m.fingerprint === 'string' && m.fingerprint ? m.fingerprint : undefined,
    history: Array.isArray(m.history) ? m.history.filter(isHistoryEntry) : [],
    quarantined: m.quarantined === true || legacyQuar,
    quarantinedAt: typeof m.quarantinedAt === 'string' ? m.quarantinedAt : undefined,
    quarantineReason: typeof m.quarantineReason === 'string' ? m.quarantineReason : undefined,
  };
}

/**
 * 用例体语义指纹:除 `id`/`tags`/`_source`/`_lib` 外的全部字段(稳定序列化)。
 * `id` 排除是因为身份由 `_source.originalId` 承担;`tags` 排除是因为打标/摘标属于
 * 「是否入库」的决策,不是「用例内容变了」。指纹变化 → rev+1 并记一条 history。
 */
export function caseFingerprint(c: TestCase): string {
  const body = { ...(c as Record<string, unknown>) };
  delete body.id;
  delete body.tags;
  delete body._source;
  delete body._lib;
  return sha256Hex(stableStringify(body));
}

/** 回归用例库文件结构。 */
export interface RegressionLibrary {
  version: number;
  updatedAt: string;
  /**
   * 写入序号(每次落盘 +1)。`updatedAt` 是毫秒粒度,同一毫秒内的两次写入无法区分——
   * 读侧缓存(case-history)需要一个严格单调的变更令牌。与 rounds.ts / suites.ts 同款。
   */
  seq?: number;
  entries: LibraryEntry[];
}

const LIBRARY_VERSION = 1;

/** 库文件绝对路径。 */
export function libraryFile(projectPath: string): string {
  return path.join(projectPath, 'AI_LabTest', 'testCase', `${REGRESSION_LIBRARY_TASK}.json`);
}

/** Exact runId → source snapshot used by the latest aggregate library execution. */
export function libraryRunMapFile(projectPath: string): string {
  return path.join(projectPath, 'AI_LabTest', 'testCase', '.data', `${REGRESSION_LIBRARY_TASK}.id-map.json`);
}

/** 空库。 */
function emptyLibrary(): RegressionLibrary {
  return { version: LIBRARY_VERSION, updatedAt: '', seq: 0, entries: [] };
}

/**
 * 读库。文件缺失 → 空库;内容损坏/结构不符 → 空库(不抛,库是增强特性不该拖垮主流程)。
 * 容错解析:顶层 `entries` 必须是数组,逐条要求是对象且带 `_source.task`,坏条跳过。
 */
export function readLibrary(projectPath: string): RegressionLibrary {
  let raw: string;
  try {
    raw = fs.readFileSync(libraryFile(projectPath), 'utf-8');
  } catch {
    return emptyLibrary(); // 文件不存在 = 尚无库
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entriesRaw = (parsed as { entries?: unknown })?.entries;
    if (!Array.isArray(entriesRaw)) return emptyLibrary();
    const entries: LibraryEntry[] = [];
    for (const e of entriesRaw) {
      if (!e || typeof e !== 'object') continue;
      const src = (e as { _source?: unknown })._source as LibrarySource | undefined;
      if (!src || typeof src.task !== 'string' || !src.task) continue;
      entries.push(e as LibraryEntry);
    }
    const version = typeof (parsed as { version?: unknown }).version === 'number'
      ? (parsed as { version: number }).version
      : LIBRARY_VERSION;
    const updatedAt = typeof (parsed as { updatedAt?: unknown }).updatedAt === 'string'
      ? (parsed as { updatedAt: string }).updatedAt
      : '';
    const seq = typeof (parsed as { seq?: unknown }).seq === 'number' ? (parsed as { seq: number }).seq : 0;
    return { version, updatedAt, seq, entries };
  } catch {
    console.warn('[regression-library] 库文件解析失败,按空库处理');
    return emptyLibrary();
  }
}

/** 原子写库(.tmp + rename;刷新 updatedAt,bump seq)。 */
export function writeLibrary(projectPath: string, lib: RegressionLibrary): void {
  const file = libraryFile(projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: RegressionLibrary = {
    version: LIBRARY_VERSION,
    updatedAt: new Date().toISOString(),
    seq: (lib.seq ?? 0) + 1,
    entries: lib.entries,
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/** 从一个用例上取 `tags` 数组(健壮:非数组/含非字符串项 → 过滤)。 */
export function caseTags(c: TestCase): string[] {
  return Array.isArray(c?.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
}

/** 是否回归集用例(`tags` 含「回归测试」)。 */
export function isRegressionCase(c: TestCase): boolean {
  return caseTags(c).includes(REGRESSION_TAG);
}

/**
 * 从一个任务的用例列表里筛出回归集用例。入参是【已解析的数组】(调用方负责把
 * `{cases:[...]}` 或顶层数组归一成数组,见 readTaskCases)。
 */
export function filterRegressionCases(cases: TestCase[]): TestCase[] {
  return cases.filter(isRegressionCase);
}

/**
 * 读任务 cases.json → 用例数组(健壮:`{cases:[...]}` 或顶层数组;缺文件/坏内容 → [])。
 * 与 recommend route 的解析口径一致。
 */
export function readTaskCases(casesAbs: string): TestCase[] {
  try {
    const raw = JSON.parse(fs.readFileSync(casesAbs, 'utf-8')) as unknown;
    if (Array.isArray(raw)) return raw as TestCase[];
    const inner = (raw as { cases?: unknown })?.cases;
    if (Array.isArray(inner)) return inner as TestCase[];
    return [];
  } catch {
    return [];
  }
}

export interface DepositResult {
  /** 本次为该任务新增(替换后)的库条目数。 */
  added: number;
  /** 本次删除的该任务旧条目数。 */
  removed: number;
  /** upsert 后库总条目数。 */
  total: number;
}

/**
 * 把某任务的回归集用例 upsert 进库(核心)。
 *   1. 从 cases 里筛出 `tags` 含「回归测试」的用例;
 *   2. 删掉库里所有 `_source.task === taskName` 的旧条目;
 *   3. 把当前回归集加进去(带 `_source` + 继承来的 `_lib`);
 *   4. 原子写回。
 * 幂等:同一任务同一用例集反复调用,库最终态一致、不重复。回归集为空时相当于「清空该任务贡献」。
 *
 * **治理元数据按 originalId 继承**(设计默认 #1):upsert 的语义是「刷新用例体」,而
 * reviewState / 隔离 / rev 时间线是人工资产,不能被一次重新入库抹掉。指纹变化 → rev+1 并
 * 记一条 history;首次入库 → `pending` + r1(与原型一致,新沉淀的用例显示「待确认」);
 * 存量条目(无指纹基线)→ 惰性回填指纹,**不** bump rev。
 */
export function depositTask(projectPath: string, taskName: string, cases: TestCase[]): DepositResult {
  const lib = readLibrary(projectPath);
  const removed = lib.entries.filter((e) => e._source.task === taskName).length;
  const kept = lib.entries.filter((e) => e._source.task !== taskName);

  // 该任务旧条目的治理元数据(按原 id 索引),供下面继承。
  const prevMeta = new Map<string, LibMeta>();
  for (const e of lib.entries) {
    if (e._source.task === taskName) prevMeta.set(e._source.originalId, readLibMeta(e));
  }

  const depositedAt = new Date().toISOString();
  const fresh: LibraryEntry[] = filterRegressionCases(cases).map((c) => {
    const originalId = typeof c.id === 'string' ? c.id : String(c.id ?? '');
    // 去掉可能已存在的 _source/_lib(避免从库导来的用例带旧溯源),按当前任务重打。
    const { _source: _dropSrc, _lib: _dropLib, ...body } = c as LibraryEntry;
    void _dropSrc;
    void _dropLib;

    const fingerprint = caseFingerprint(body);
    const prev = prevMeta.get(originalId);
    let meta: LibMeta;
    if (!prev) {
      meta = {
        reviewState: 'pending',
        rev: 1,
        fingerprint,
        history: [{ rev: 1, at: depositedAt, note: `首次入库（来源任务：${taskName}）` }],
        quarantined: false,
      };
    } else if (!prev.fingerprint) {
      meta = { ...prev, fingerprint }; // 存量回填基线,不算一次变更
    } else if (prev.fingerprint !== fingerprint) {
      const rev = prev.rev + 1;
      meta = {
        ...prev,
        rev,
        fingerprint,
        history: [{ rev, at: depositedAt, note: '用例内容更新（来源任务重新入库）' }, ...prev.history].slice(0, HISTORY_MAX),
      };
    } else {
      meta = prev;
    }
    return { ...body, _source: { task: taskName, originalId, depositedAt }, _lib: meta };
  });

  lib.entries = [...kept, ...fresh];
  writeLibrary(projectPath, lib);
  return { added: fresh.length, removed, total: lib.entries.length };
}

/** 批量改条目的 `_lib`(评审/隔离共用)。返回实际改动条数与库总数。 */
function mutateMeta(
  projectPath: string,
  keys: EntryKey[],
  patch: (m: LibMeta) => LibMeta,
): { updated: number; total: number } {
  const lib = readLibrary(projectPath);
  const want = new Set(keys.map((k) => `${k.task}\u0000${k.originalId}`));
  let updated = 0;
  lib.entries = lib.entries.map((e) => {
    if (!want.has(`${e._source.task}\u0000${e._source.originalId}`)) return e;
    const before = readLibMeta(e);
    const after = patch(before);
    if (stableStringify(before) === stableStringify(after) && e._lib) return e;
    updated++;
    return { ...e, _lib: after };
  });
  if (updated > 0) writeLibrary(projectPath, lib);
  return { updated, total: lib.entries.length };
}

/** 批量设置评审态(库总览「批量确认」/ 抽屉「确认入回归池」)。 */
export function setReviewState(
  projectPath: string,
  keys: EntryKey[],
  reviewState: ReviewState,
): { updated: number; total: number } {
  return mutateMeta(projectPath, keys, (m) => ({ ...m, reviewState }));
}

/**
 * 批量隔离 / 恢复。隔离条目:聚合执行排除、不计发版红线;恢复时清掉隔离时间与理由。
 * 隔离不是删除——报告横幅仍强制曝光「隔离中 N 条未计入」(护栏,设计默认 #8)。
 */
export function setQuarantine(
  projectPath: string,
  keys: EntryKey[],
  quarantined: boolean,
  reason?: string,
): { updated: number; total: number } {
  const at = new Date().toISOString();
  return mutateMeta(projectPath, keys, (m) => ({
    ...m,
    quarantined,
    quarantinedAt: quarantined ? at : undefined,
    quarantineReason: quarantined ? (reason?.trim() || '手动隔离') : undefined,
  }));
}

/**
 * 按谓词移除库条目(库管理 UI:移除单条 / 移除某任务全部贡献)。返回删除数与剩余总数。
 * 谓词返回 true 的条目【被删除】。
 */
export function removeEntries(
  projectPath: string,
  pred: (e: LibraryEntry) => boolean,
): { removed: number; total: number } {
  const lib = readLibrary(projectPath);
  const before = lib.entries.length;
  lib.entries = lib.entries.filter((e) => !pred(e));
  const removed = before - lib.entries.length;
  if (removed > 0) writeLibrary(projectPath, lib);
  return { removed, total: lib.entries.length };
}

/** 按来源任务分组(库查看 UI 用)。保持任务首次出现顺序。 */
export function listByTask(lib: RegressionLibrary): Array<{ task: string; entries: LibraryEntry[] }> {
  const order: string[] = [];
  const map = new Map<string, LibraryEntry[]>();
  for (const e of lib.entries) {
    const t = e._source.task;
    if (!map.has(t)) {
      map.set(t, []);
      order.push(t);
    }
    map.get(t)!.push(e);
  }
  return order.map((task) => ({ task, entries: map.get(task)! }));
}

export interface RunnableCases {
  /** 标准 `{cases:[...]}` 里的用例数组(已去 `_source`、id 唯一),可直接写进保留任务 cases.json。 */
  cases: TestCase[];
  /** runId → 来源{task, originalId},供重跑报告把结果反解回「来源任务·原ID」。 */
  idMap: Record<string, { task: string; originalId: string }>;
}

/**
 * 把库聚合成【可执行】用例集。跨任务 originalId 冲突时用命名空间保证 runId 唯一
 * (执行/归约按 id 索引 @@RESULT,跨任务 TC-001 撞号会串结果)。
 *   - runId 首选原 id;已占用 → `{task}::{originalId}`;仍占用 → 追加 `#n`。
 *   - 用例体去掉 `_source` 与 `_lib`(执行 prompt 只需标准用例字段,治理元数据不该进 AI 上下文);
 *     id 换成 runId。
 *   - `include`(v2):圈选集——只聚合命中 {task, originalId} 的条目(套件求值结果 /
 *     二期失败复测集都走这个口)。缺省 = 全库(v1 行为)。
 */
export function buildRunnableCases(
  lib: RegressionLibrary,
  include?: Array<{ task: string; originalId: string }>,
): RunnableCases {
  let entries = lib.entries;
  if (include) {
    const want = new Set(include.map((k) => `${k.task}\u0000${k.originalId}`));
    entries = entries.filter((e) => want.has(`${e._source.task}\u0000${e._source.originalId}`));
  }
  const used = new Set<string>();
  const cases: TestCase[] = [];
  const idMap: Record<string, { task: string; originalId: string }> = {};
  for (const e of entries) {
    const { task, originalId } = e._source;
    let rid = originalId || 'TC';
    if (used.has(rid)) rid = `${task}::${originalId}`;
    let n = 2;
    while (used.has(rid)) rid = `${task}::${originalId}#${n++}`;
    used.add(rid);
    idMap[rid] = { task, originalId };
    const { _source: _dropSrc, _lib: _dropLib, ...body } = e;
    void _dropSrc;
    void _dropLib;
    cases.push({ ...body, id: rid });
  }
  return { cases, idMap };
}

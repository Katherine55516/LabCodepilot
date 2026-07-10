import fs from 'fs';
import path from 'path';
import { REGRESSION_TAG, REGRESSION_LIBRARY_TASK } from './library-constants';

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

/** 库条目 = 原用例全字段 + `_source` 溯源。 */
export type LibraryEntry = TestCase & { _source: LibrarySource };

/** 回归用例库文件结构。 */
export interface RegressionLibrary {
  version: number;
  updatedAt: string;
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
  return { version: LIBRARY_VERSION, updatedAt: '', entries: [] };
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
    return { version, updatedAt, entries };
  } catch {
    console.warn('[regression-library] 库文件解析失败,按空库处理');
    return emptyLibrary();
  }
}

/** 原子写库(.tmp + rename;刷新 updatedAt)。 */
export function writeLibrary(projectPath: string, lib: RegressionLibrary): void {
  const file = libraryFile(projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: RegressionLibrary = {
    version: LIBRARY_VERSION,
    updatedAt: new Date().toISOString(),
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
 *   3. 把当前回归集加进去(带 `_source`);
 *   4. 原子写回。
 * 幂等:同一任务同一用例集反复调用,库最终态一致、不重复。回归集为空时相当于「清空该任务贡献」。
 */
export function depositTask(projectPath: string, taskName: string, cases: TestCase[]): DepositResult {
  const lib = readLibrary(projectPath);
  const before = lib.entries.length;
  const removed = lib.entries.filter((e) => e._source.task === taskName).length;
  const kept = lib.entries.filter((e) => e._source.task !== taskName);

  const depositedAt = new Date().toISOString();
  const fresh: LibraryEntry[] = filterRegressionCases(cases).map((c) => {
    const originalId = typeof c.id === 'string' ? c.id : String(c.id ?? '');
    // 去掉可能已存在的 _source(避免从库导来的用例带旧溯源),按当前任务重打。
    const { _source: _drop, ...body } = c as LibraryEntry;
    void _drop;
    return { ...body, _source: { task: taskName, originalId, depositedAt } };
  });

  lib.entries = [...kept, ...fresh];
  writeLibrary(projectPath, lib);
  void before;
  return { added: fresh.length, removed, total: lib.entries.length };
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
 *   - 用例体去掉 `_source`(执行 prompt 只需标准用例字段);id 换成 runId。
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
    const { _source: _drop, ...body } = e;
    void _drop;
    cases.push({ ...body, id: rid });
  }
  return { cases, idMap };
}

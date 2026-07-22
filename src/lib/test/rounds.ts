import fs from 'fs';
import path from 'path';
import { REGRESSION_LIBRARY_TASK } from './library-constants';
import type { SuiteKey, LastResult } from './suites';

/**
 * 测试工作台 · 回归轮次(v2 批 A)。
 *
 * 「轮次」= 库的一次回归执行实例(一轮 = 一套件 × 一环境 × 一模式,原子;决策见
 * docs/exec-plans/active/regression-library-v2.md §0)。v1 的重跑产物固定落
 * `report/回归用例库/`,同环境再跑直接覆盖上一轮;v2 起每轮产物落
 * `report/回归用例库/{roundId}/` 子目录,轮次索引落本文件维护的 `回归轮次.json`。
 *
 * 设计要点:
 *   - 状态机:running → done | aborted | partial。收口有三层,按可信度递进(真机事故:
 *     执行中途页面刷新 → 前端 settle 永远不会到达 → 轮次卡「执行中」近 2 小时):
 *       ① **服务端收口**(根治,createRoundKeeper):执行流的事实所有者是服务端,
 *          流收口/中断/报错时由 wrapExecutionStream 直接 finishRound,不押前端活到最后;
 *       ② **心跳活性**(管进程死亡):执行期间守护定时器每 ROUND_HEARTBEAT_INTERVAL_MS
 *          touch {roundDir}/.alive;读侧(rounds GET → reapOrphanRounds)对 running 轮
 *          判活——心跳陈旧/缺失(且过了启动宽限)→ 孤儿,**回写** aborted(高置信度、
 *          一次性、有界,与旧「只归一视图」不同);
 *       ③ **惰性视图归一**(最后兜底,normalizeStaleRounds):running 超过
 *          STALE_RUNNING_MS → 视图按 aborted 呈现(不回写)——覆盖心跳文件写不进去等
 *          极端情况。
 *   - 并发写(设计默认 #7):.tmp+rename 只防半写不防丢更新(双窗口/主目录+worktree 双
 *     dev server 同项目)。mutateRounds 在 rename 前重读一次:文件 updatedAt 变了 →
 *     在新内容上重放变更(重试一次),仍冲突则以后写为准并告警。
 *   - 解析容错与 library.ts 同款:缺文件/坏 JSON/坏条目 → 空/跳过,不抛。
 */

/** 轮次状态。running=执行中;done=正常收口;aborted=中断(手动停止/进程退出/惰性判定);partial=部分完成(预留)。 */
export type RoundStatus = 'running' | 'done' | 'aborted' | 'partial';

/** 轮次执行模式。full=按套件全量;failed-only=只复测某轮失败集(二期,结构一期预留)。 */
export type RoundMode = 'full' | 'failed-only';

export interface RegressionRound {
  /** 轮次号,`RND-YYYYMMDD-HHmm`(同分钟冲突追加 `-2`/`-3`…)。也是产物子目录名。 */
  roundId: string;
  startedAt: string;
  finishedAt?: string;
  /** 执行环境键(environments.json 里的 env 名)。 */
  env: string;
  /** 圈选套件名(内置「全量」或用户套件;failed-only 轮为源轮的引用语义,存 '—')。 */
  suiteName: string;
  mode: RoundMode;
  /** 复测轮指向源轮(二期);全量轮无。 */
  parentRoundId?: string;
  status: RoundStatus;
  /** 本轮圈选的用例总数(发起时确定)。 */
  total: number;
  /** 收口时从 run.json 摘录的口径(与 reduce.ts 输出同名字段,只存摘要不复制全量)。 */
  counts?: Record<string, number>;
  suitePassStr?: string;
}

export interface RoundsFile {
  version: number;
  updatedAt: string;
  /** 写入序号(每次落盘 +1)。丢更新保护的版本令牌——updatedAt 毫秒粒度同刻写入无法区分。 */
  seq?: number;
  rounds: RegressionRound[];
}

const ROUNDS_VERSION = 1;

/** running 轮超过该时长仍未收口 → 读侧视图归一为 aborted(惰性收口,最后兜底)。 */
export const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

/** 心跳周期:执行流运行期间守护定时器 touch .alive 的间隔。 */
export const ROUND_HEARTBEAT_INTERVAL_MS = 30_000;
/** 心跳判活阈值:.alive mtime 距今超过该值 → 执行流已死(3 个心跳周期的容忍)。 */
export const ROUND_HEARTBEAT_STALE_MS = 90_000;
/**
 * 启动宽限:发起(library/run 建轮次)与执行(test/run 起流、写第一拍心跳)是前端串联的
 * **两次请求**,之间天然没有心跳。无心跳的 running 轮在此窗口内不判孤儿——否则发起后
 * 立刻切到轮次页就会把刚建的轮次误杀。
 */
export const ROUND_START_GRACE_MS = 120_000;

/** 轮次索引文件绝对路径。 */
export function roundsFile(projectPath: string): string {
  return path.join(projectPath, 'AI_LabTest', 'testCase', '.data', '回归轮次.json');
}

/** 某轮产物目录(相对项目根,与 artifactPaths 同风格)。 */
export function roundDirRel(roundId: string): string {
  return `AI_LabTest/report/${REGRESSION_LIBRARY_TASK}/${roundId}`;
}

/** 某轮各产物相对路径(执行/报告/快照落点;runJson/report 命名沿用 {task}-{env} 惯例)。 */
export function roundArtifactPaths(roundId: string, env: string = 'local') {
  const dir = roundDirRel(roundId);
  return {
    dir,
    runJson: `${dir}/${REGRESSION_LIBRARY_TASK}-${env}.run.json`,
    report: `${dir}/${REGRESSION_LIBRARY_TASK}-${env}.md`,
    snapshot: `${dir}/cases.snapshot.json`,
  };
}

function emptyRounds(): RoundsFile {
  return { version: ROUNDS_VERSION, updatedAt: '', rounds: [] };
}

const VALID_STATUS: ReadonlySet<string> = new Set(['running', 'done', 'aborted', 'partial']);

/** 读轮次索引。缺文件/坏 JSON → 空;逐条要求 roundId 非空字符串 + 合法 status,坏条跳过。 */
export function readRounds(projectPath: string): RoundsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(roundsFile(projectPath), 'utf-8');
  } catch {
    return emptyRounds();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const roundsRaw = (parsed as { rounds?: unknown })?.rounds;
    if (!Array.isArray(roundsRaw)) return emptyRounds();
    const rounds: RegressionRound[] = [];
    for (const r of roundsRaw) {
      if (!r || typeof r !== 'object') continue;
      const { roundId, status } = r as { roundId?: unknown; status?: unknown };
      if (typeof roundId !== 'string' || !roundId) continue;
      if (typeof status !== 'string' || !VALID_STATUS.has(status)) continue;
      rounds.push(r as RegressionRound);
    }
    const updatedAt = typeof (parsed as { updatedAt?: unknown }).updatedAt === 'string'
      ? (parsed as { updatedAt: string }).updatedAt
      : '';
    const seq = typeof (parsed as { seq?: unknown }).seq === 'number' ? (parsed as { seq: number }).seq : 0;
    return { version: ROUNDS_VERSION, updatedAt, seq, rounds };
  } catch {
    console.warn('[regression-rounds] 轮次索引解析失败,按空处理');
    return emptyRounds();
  }
}

function writeRounds(projectPath: string, data: RoundsFile): void {
  const file = roundsFile(projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: RoundsFile = {
    version: ROUNDS_VERSION,
    updatedAt: new Date().toISOString(),
    seq: (data.seq ?? 0) + 1,
    rounds: data.rounds,
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * 读-改-写轮次索引,带丢更新保护(设计默认 #7):
 * rename 前重读文件 seq(写入序号),与读取时不一致(说明期间有并发写入)→ 在最新内容上
 * 重放 mutator 再写(重试一次)。`_beforeWrite` 仅测试注入用(在首次写盘前制造竞争)。
 */
export function mutateRounds(
  projectPath: string,
  mutator: (data: RoundsFile) => void,
  _beforeWrite?: () => void,
): RoundsFile {
  let data = readRounds(projectPath);
  const seenSeq = data.seq ?? 0;
  mutator(data);
  _beforeWrite?.();
  const latest = readRounds(projectPath);
  if ((latest.seq ?? 0) !== seenSeq) {
    // 并发写入:在最新内容上重放,后写不覆盖先写。
    data = latest;
    mutator(data);
  }
  writeRounds(projectPath, data);
  return data;
}

/** 生成轮次号:RND-YYYYMMDD-HHmm;同分钟冲突追加 -2/-3…(以 existing 判重)。 */
export function generateRoundId(existing: ReadonlySet<string>, now: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const base = `RND-${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** 追加一条新轮次(status 通常为 running)。返回写入后的完整索引。 */
export function appendRound(projectPath: string, round: RegressionRound): RoundsFile {
  return mutateRounds(projectPath, (data) => {
    data.rounds = [...data.rounds.filter((r) => r.roundId !== round.roundId), round];
  });
}

/**
 * 收口轮次:置终态 + finishedAt + 结果摘要。轮次不存在 → no-op(库/索引可能被手动清理,
 * 收口是 best-effort,不抛不阻塞主流程)。收口顺带清掉 .alive 心跳文件(终态轮不该再有
 * 活性信号残留)。
 *
 * `ifRunning: true` = 仅 running → 终态的迁移才生效(aborted 类收口用):防止流末端竞态
 * 把服务端刚写的 done 降级回 aborted(客户端 settle / cancel 回调 / 孤儿回收都可能晚到)。
 */
export function finishRound(
  projectPath: string,
  roundId: string,
  patch: { status: Exclude<RoundStatus, 'running'>; counts?: Record<string, number>; suitePassStr?: string; total?: number; ifRunning?: boolean },
): RoundsFile {
  const out = mutateRounds(projectPath, (data) => {
    const r = data.rounds.find((x) => x.roundId === roundId);
    if (!r) return;
    if (patch.ifRunning && r.status !== 'running') return;
    r.status = patch.status;
    r.finishedAt = new Date().toISOString();
    if (patch.counts) r.counts = patch.counts;
    if (typeof patch.suitePassStr === 'string') r.suitePassStr = patch.suitePassStr;
    if (typeof patch.total === 'number') r.total = patch.total;
  });
  try { fs.unlinkSync(roundAliveFile(projectPath, roundId)); } catch { /* 无心跳文件则忽略 */ }
  return out;
}

/** 心跳文件路径:{roundDir}/.alive。mtime 即活性信号(内容只为人工排查存 ISO 时间)。 */
export function roundAliveFile(projectPath: string, roundId: string): string {
  return path.join(projectPath, roundDirRel(roundId), '.alive');
}

/** touch 心跳。失败静默——心跳写不进去时还有 startedAt 宽限与 2h 惰性兜底,不得影响执行流。 */
export function touchRoundAlive(projectPath: string, roundId: string): void {
  try {
    const file = roundAliveFile(projectPath, roundId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, new Date().toISOString());
  } catch { /* best-effort */ }
}

export interface RoundKeeper {
  /** 执行流正常收口:置 done + 结果摘要。 */
  settleDone(patch: { counts?: Record<string, number>; suitePassStr?: string }): void;
  /** 执行流中断/报错:置 aborted(仅当轮次仍 running,不降级已收口的终态)。 */
  settleAborted(): void;
}

/**
 * 执行流侧的轮次守护:发起心跳(层②)并把收口所有权收进服务端(层①)。
 * settle* 幂等(先到先得);服务端进程被杀时谁都不会跑 → 读侧靠心跳陈旧判孤儿。
 * 定时器 unref:不阻止进程退出,单测忘清也不挂住 runner。
 */
export function createRoundKeeper(projectPath: string, roundId: string): RoundKeeper {
  touchRoundAlive(projectPath, roundId);
  const timer = setInterval(() => touchRoundAlive(projectPath, roundId), ROUND_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  let settled = false;
  const once = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearInterval(timer);
    try { fn(); } catch { /* 收口失败 → 读侧心跳/惰性兜底,不得拖垮执行流 */ }
  };
  return {
    settleDone(patch) {
      once(() => finishRound(projectPath, roundId, { status: 'done', ...patch }));
    },
    settleAborted() {
      once(() => finishRound(projectPath, roundId, { status: 'aborted', ifRunning: true }));
    },
  };
}

/**
 * 孤儿轮判定 + 回写(层②读侧):对 running 轮以 .alive mtime 判活。
 *   - 心跳新鲜(< ROUND_HEARTBEAT_STALE_MS)→ 真在跑,不动;
 *   - 无心跳且轮次年龄 < ROUND_START_GRACE_MS → 启动窗口(发起与执行是两次请求),不动;
 *   - 其余(心跳陈旧,或无心跳且过宽限)→ 孤儿,回写 aborted(ifRunning 保护,幂等)。
 * 返回回写后的最新轮次列表。IO 失败退回原样——读侧不得因回写失败而崩。
 */
export function reapOrphanRounds(projectPath: string, now: Date = new Date()): RegressionRound[] {
  const data = readRounds(projectPath);
  const orphans: string[] = [];
  for (const r of data.rounds) {
    if (r.status !== 'running') continue;
    let aliveAtMs = Number.NaN;
    try { aliveAtMs = fs.statSync(roundAliveFile(projectPath, r.roundId)).mtimeMs; } catch { /* 无心跳文件 */ }
    if (!Number.isNaN(aliveAtMs) && now.getTime() - aliveAtMs < ROUND_HEARTBEAT_STALE_MS) continue;
    if (Number.isNaN(aliveAtMs)) {
      const started = Date.parse(r.startedAt);
      if (!Number.isNaN(started) && now.getTime() - started < ROUND_START_GRACE_MS) continue;
    }
    orphans.push(r.roundId);
  }
  if (!orphans.length) return data.rounds;
  for (const roundId of orphans) {
    try { finishRound(projectPath, roundId, { status: 'aborted', ifRunning: true }); } catch { /* 兜底:惰性视图归一 */ }
  }
  return readRounds(projectPath).rounds;
}

/**
 * 惰性收口视图(不回写):running 且 startedAt 距 now 超过 STALE_RUNNING_MS → 按 aborted
 * 呈现。startedAt 非法的 running 轮同样按 aborted(无法证明还活着)。
 */
export function normalizeStaleRounds(rounds: RegressionRound[], now: Date = new Date()): RegressionRound[] {
  return rounds.map((r) => {
    if (r.status !== 'running') return r;
    const started = Date.parse(r.startedAt);
    const stale = Number.isNaN(started) || now.getTime() - started > STALE_RUNNING_MS;
    return stale ? { ...r, status: 'aborted' as const } : r;
  });
}

/** 当轮用例快照文件结构(cases.snapshot.json;idMap 随快照持久化,报告分组/复测/上次结果反查都靠它)。 */
export interface RoundSnapshot {
  version: number;
  roundId: string;
  suiteName: string;
  env: string;
  mode: RoundMode;
  generatedAt: string;
  total: number;
  idMap: Record<string, { task: string; originalId: string }>;
  cases: unknown[];
}

/** 读某轮快照(缺失/损坏 → null)。 */
export function readRoundSnapshot(projectPath: string, roundId: string): RoundSnapshot | null {
  try {
    const abs = path.join(projectPath, roundDirRel(roundId), 'cases.snapshot.json');
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8')) as RoundSnapshot;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.roundId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 复测轮(failed-only)的基准轮:显式指定 → 按 roundId 取;缺省 → 最近一个**已收口的全量轮**
 * (按 startedAt 倒序)。复测轮不能拿另一个复测轮当基准——否则「上轮失败集」会逐轮收缩,
 * 最终把真正没修好的用例漏出回归范围。
 */
export function pickBaseRound(projectPath: string, parentRoundId?: string): RegressionRound | null {
  const rounds = normalizeStaleRounds(readRounds(projectPath).rounds)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  if (parentRoundId) return rounds.find((r) => r.roundId === parentRoundId) ?? null;
  return rounds.find((r) => r.mode !== 'failed-only' && (r.status === 'done' || r.status === 'partial')) ?? null;
}

/**
 * 某轮的失败集 → 条目身份数组。**非 pass 的任何终态都算失败**(fail / partial / blocked):
 * 复测的目的是「把没过的重跑一遍」,partial 也没过。
 * 快照或 run.json 缺损 → [](拿不到就不硬拼,调用方按空集处理)。
 */
export function failedKeysOfRound(projectPath: string, round: RegressionRound): SuiteKey[] {
  try {
    const snap = readRoundSnapshot(projectPath, round.roundId);
    if (!snap?.idMap) return [];
    const runAbs = path.join(projectPath, roundArtifactPaths(round.roundId, round.env).runJson);
    const raw = JSON.parse(fs.readFileSync(runAbs, 'utf-8')) as { tests?: Array<{ id?: unknown; status?: unknown }> };
    const out: SuiteKey[] = [];
    for (const t of raw.tests ?? []) {
      if (!t || typeof t.id !== 'string' || t.status === 'pass') continue;
      const src = snap.idMap[t.id];
      if (src) out.push({ task: src.task, originalId: src.originalId });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 「上次结果」反查(套件 last 条件的数据源,批 A 的 evalSuite 以注入方式消费):
 * 取最近一个已收口轮(done/partial,按 startedAt 倒序),读其 run.json tests[] + 快照 idMap,
 * 把 runId 反解回 (task, originalId) → pass/fail;未出现的条目 → 'none'。
 * 任何缺失/损坏 → 一律 'none'(条件退化为「只命中从未执行」,不误伤)。
 */
export function buildLastResultLookup(projectPath: string): (k: SuiteKey) => LastResult {
  try {
    const finished = normalizeStaleRounds(readRounds(projectPath).rounds)
      .filter((r) => r.status === 'done' || r.status === 'partial')
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    const latest = finished[0];
    if (!latest) return () => 'none';
    const snap = readRoundSnapshot(projectPath, latest.roundId);
    if (!snap?.idMap) return () => 'none';
    const runAbs = path.join(projectPath, roundArtifactPaths(latest.roundId, latest.env).runJson);
    const runRaw = JSON.parse(fs.readFileSync(runAbs, 'utf-8')) as { tests?: Array<{ id?: unknown; status?: unknown }> };
    const map = new Map<string, LastResult>();
    for (const t of runRaw.tests ?? []) {
      if (!t || typeof t.id !== 'string') continue;
      const src = snap.idMap[t.id];
      if (!src) continue;
      map.set(`${src.task}\u0000${src.originalId}`, t.status === 'pass' ? 'pass' : 'fail');
    }
    return (k) => map.get(`${k.task}\u0000${k.originalId}`) ?? 'none';
  } catch {
    return () => 'none';
  }
}

import fs from 'fs';
import path from 'path';
import { REGRESSION_LIBRARY_TASK } from './library-constants';

/**
 * 测试工作台 · 回归轮次(v2 批 A)。
 *
 * 「轮次」= 库的一次回归执行实例(一轮 = 一套件 × 一环境 × 一模式,原子;决策见
 * docs/exec-plans/active/regression-library-v2.md §0)。v1 的重跑产物固定落
 * `report/回归用例库/`,同环境再跑直接覆盖上一轮;v2 起每轮产物落
 * `report/回归用例库/{roundId}/` 子目录,轮次索引落本文件维护的 `回归轮次.json`。
 *
 * 设计要点:
 *   - 状态机:running → done | aborted | partial。中断采用**惰性收口**(设计默认 #4):
 *     不依赖进程退出钩子,读侧发现 running 超过 STALE_RUNNING_MS 无收口 → 视图归一为
 *     aborted(normalizeStaleRounds,不回写,避免读放大)。
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

/** running 轮超过该时长仍未收口 → 读侧视图归一为 aborted(惰性收口)。 */
export const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

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
 * 收口是 best-effort,不抛不阻塞主流程)。
 */
export function finishRound(
  projectPath: string,
  roundId: string,
  patch: { status: Exclude<RoundStatus, 'running'>; counts?: Record<string, number>; suitePassStr?: string; total?: number },
): RoundsFile {
  return mutateRounds(projectPath, (data) => {
    const r = data.rounds.find((x) => x.roundId === roundId);
    if (!r) return;
    r.status = patch.status;
    r.finishedAt = new Date().toISOString();
    if (patch.counts) r.counts = patch.counts;
    if (typeof patch.suitePassStr === 'string') r.suitePassStr = patch.suitePassStr;
    if (typeof patch.total === 'number') r.total = patch.total;
  });
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

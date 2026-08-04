/**
 * 定时任务的文件型存储(P3)。
 *
 * 为什么是文件而不是数据库:cowork-server 至今**运行时只依赖 ws 一个包**,控制面本身
 * 无状态(docker labels 作事实源)。定时任务是第一个真正需要持久状态的功能,但它的量级
 * (每人 ≤50 个 routine)完全不值得引入 sqlite/pg —— 那会给部署、备份、迁移各加一层。
 *
 *   $COWORK_STATE_DIR/                       默认 /data/cowork-state(数据盘,1TB)
 *   ├── routines/<uid>/<id>.json             定义 + 调度状态(.tmp + rename 原子写)
 *   ├── routines/<uid>/<id>.runs.jsonl       运行历史(append-only,永久保留 D12)
 *   └── runs/<runId>.jsonl                   transcript 原文
 *
 * routineId **就是 sid**(容器 cowork-<id>、卷 cowork-ws-<id>),所以它必须满足
 * orchestrator 的 HEX 约束。这样 routine 天然拥有独立容器 + 独立持久卷,
 * ensureContainer / 文件通道 / 归属校验 / removeContainer 全部零改动可用(决策 D2)。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STATE_DIR = process.env.COWORK_STATE_DIR || '/data/cowork-state';
const ROUTINES_DIR = path.join(STATE_DIR, 'routines');
const RUNS_DIR = path.join(STATE_DIR, 'runs');

/** 每用户 routine 上限(D13)。 */
export const MAX_ROUTINES_PER_UID = parseInt(process.env.COWORK_ROUTINE_MAX_PER_UID || '50', 10);
/** 每用户每日运行上限(D8)。P8 的配额闸用它。 */
export const DAILY_RUN_CAP = parseInt(process.env.COWORK_ROUTINE_DAILY_CAP || '20', 10);
/** 最小调度间隔(D6)。 */
export const MIN_INTERVAL_MS = parseInt(process.env.COWORK_ROUTINE_MIN_INTERVAL_MS || String(15 * 60_000), 10);

const ID_RE = /^[a-f0-9]{32}$/;
// uid 与 orchestrator/authz 同字符集。⚠️ 该字符集含 `.`,所以 `..` 能通过正则 ——
// 而 uid 要当目录名用,必须额外挡住路径穿越。少这一行就是任意目录读写。
const UID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
function safeUid(uid) {
  const u = String(uid || '');
  if (!UID_RE.test(u) || u.includes('..')) throw new Error('invalid uid');
  return u;
}
function safeId(id) {
  const i = String(id || '');
  if (!ID_RE.test(i)) throw new Error('invalid routine id');
  return i;
}

export function newRoutineId() {
  return crypto.randomBytes(16).toString('hex');  // 32 hex,满足 orchestrator 的 sid 约束
}
export function newRunId() {
  return 'run_' + crypto.randomBytes(12).toString('hex');
}

function uidDir(uid) { return path.join(ROUTINES_DIR, safeUid(uid)); }
function routineFile(uid, id) { return path.join(uidDir(uid), `${safeId(id)}.json`); }
function runsFile(uid, id) { return path.join(uidDir(uid), `${safeId(id)}.runs.jsonl`); }
export function transcriptFile(runId) {
  if (!/^run_[a-f0-9]{24}$/.test(String(runId))) throw new Error('invalid run id');
  return path.join(RUNS_DIR, `${runId}.jsonl`);
}

/** 原子写:先写 .tmp 再 rename —— 断电/并发时不会读到半个 JSON。 */
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function ensureStateDir() {
  fs.mkdirSync(ROUTINES_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

// ── routine CRUD ────────────────────────────────────────────────

export function getRoutine(uid, id) {
  // ⚠️ 校验放在 try **外面**:非法 uid/id 是编程错误(或攻击),必须抛出来被看见。
  // 放进 try 的话 `../../etc` 这类输入会被静默当成「不存在」——路径穿越确实没发生,
  // 但守卫是否生效变得不可观测,自检也测不出来。自检时踩过。
  const file = routineFile(uid, id);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;  // 不存在 / 半坏文件 —— 调用方一律当 404,不区分(防探测)
  }
}

export function listRoutines(uid) {
  let names;
  try { names = fs.readdirSync(uidDir(uid)); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json') || n.endsWith('.tmp')) continue;
    const r = getRoutine(uid, n.slice(0, -5));
    if (r) out.push(r);
  }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** 扫全部用户的 routine(调度器 tick 用)。 */
export function listAllRoutines() {
  let uids;
  try { uids = fs.readdirSync(ROUTINES_DIR); } catch { return []; }
  return uids.flatMap((u) => {
    try { return listRoutines(u); } catch { return []; }  // 目录名不合法 → 跳过,别让一个坏目录卡死整个 tick
  });
}

export function saveRoutine(r) {
  safeUid(r.uid); safeId(r.id);
  r.updatedAt = new Date().toISOString();
  writeAtomic(routineFile(r.uid, r.id), JSON.stringify(r, null, 2));
  return r;
}

/** 删 routine 的元数据与历史。容器/卷由调用方经 orchestrator 清(职责分开)。 */
export function deleteRoutine(uid, id) {
  for (const f of [routineFile(uid, id), runsFile(uid, id)]) {
    try { fs.unlinkSync(f); } catch { /* 不存在即已达成 */ }
  }
}

export function countRoutines(uid) {
  return listRoutines(uid).length;
}

// ── 运行历史 ────────────────────────────────────────────────────

export function appendRun(uid, id, run) {
  const f = runsFile(uid, id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(run) + '\n');
  return run;
}

/**
 * 读运行历史。since 给了就只返回 startedAt > since 的(客户端增量拉取用)。
 * 倒序返回(最新在前),limit 截断。
 */
export function listRuns(uid, id, { since = '', limit = 200 } = {}) {
  let raw;
  try { raw = fs.readFileSync(runsFile(uid, id), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (since && !(String(r.startedAt) > since)) continue;
      out.push(r);
    } catch { /* 跳过坏行,不让一行毁掉整个历史 */ }
  }
  out.reverse();
  return out.slice(0, Math.max(1, Math.min(limit, 1000)));
}

/**
 * 某用户从 sinceIso 起的运行次数(日配额用,D8)。
 * **只数真正消耗了额度的** —— skipped 不算,否则配额一旦打满就再也降不下来:
 * 满额 → 后续全 skipped → skipped 又计入 → 永远满额,自锁死。
 */
export function countRunsSince(uid, sinceIso) {
  let n = 0;
  for (const r of listRoutines(uid)) {
    for (const run of listRuns(uid, r.id, { limit: 1000 })) {
      if (String(run.startedAt) >= sinceIso && run.status !== 'skipped') n++;
    }
  }
  return n;
}

export const _internals = { STATE_DIR, ROUTINES_DIR, RUNS_DIR, safeUid, safeId, writeAtomic };

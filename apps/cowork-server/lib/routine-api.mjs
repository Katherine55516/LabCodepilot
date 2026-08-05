/**
 * 定时任务 REST(P3)—— index.mjs 把 /routines* 与 /runs/* 转到这里。
 *
 * 鉴权**完全复用现有 HMAC**:uid 由 index.mjs 从签名里取好传进来,本模块只按 uid
 * scope。跨用户访问一律 404(不是 403)—— 与会话侧同一防枚举姿态。
 *
 * 校验集中在创建/更新:数量上限(D13)、最小间隔(D6)、时区合法性、一次性时刻必须在未来。
 * 放在这里而不是客户端,是因为客户端可以绕过 —— 服务端才是配额与规则的执行点。
 */
import * as store from './routine-store.mjs';
import * as sched from './routine-scheduler.mjs';
import * as orch from './orchestrator.mjs';
import * as cred from './cred-proxy.mjs';
import { isValidTimezone, parseCron, violatesMinInterval } from './routine-cron.mjs';
import { audit } from './audit.mjs';
import fs from 'node:fs';

const MAX_NAME = 200;
const MAX_DESC = 1000;
const MAX_PROMPT = 100_000;

export const ROUTINES_RE = /^\/routines(?:\/([a-f0-9]{32}))?(?:\/(run|runs))?$/i;
export const TRANSCRIPT_RE = /^\/runs\/(run_[a-f0-9]{24})\/transcript$/i;

class BadRequest extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

/**
 * index.mjs 的 readBody 返回的是**原始字符串**(既有调用方都是自己 JSON.parse 的)。
 * 把它当成已解析对象用会让每个字段都读成 undefined —— 表现是所有创建都报
 * 「name is required」,而请求体明明带了 name。自检时踩过。
 */
async function jsonBody(req, readBody) {
  const raw = await readBody(req);
  if (!raw || !String(raw).trim()) return {};
  try { return JSON.parse(raw); }
  catch { throw new BadRequest('请求体不是合法 JSON'); }
}

function str(v, max, field, { required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new BadRequest(`${field} is required`);
    return '';
  }
  const s = String(v);
  if (required && !s.trim()) throw new BadRequest(`${field} is required`);
  if (s.length > max) throw new BadRequest(`${field} too long (max ${max})`);
  return s;
}

/** 校验并归一 schedule。抛 BadRequest 时消息面向用户,会原样透出去。 */
function normalizeSchedule(raw) {
  const kind = String(raw?.kind || '');
  if (kind === 'manual') return { kind: 'manual' };

  if (kind === 'once') {
    const t = Date.parse(raw?.fireAt || '');
    if (!Number.isFinite(t)) throw new BadRequest('schedule.fireAt 不是合法的 ISO 时间');
    if (t <= Date.now()) throw new BadRequest('schedule.fireAt 必须是将来的时刻');
    return { kind: 'once', fireAt: new Date(t).toISOString() };
  }

  if (kind === 'cron') {
    const expr = str(raw?.expr, 200, 'schedule.expr', { required: true }).trim();
    const tz = str(raw?.tz, 64, 'schedule.tz').trim() || 'UTC';
    if (!parseCron(expr)) throw new BadRequest('schedule.expr 必须是 5 字段 cron 表达式');
    if (!isValidTimezone(tz)) throw new BadRequest(`schedule.tz 不是合法时区:${tz}`);
    const v = violatesMinInterval(expr, tz, store.MIN_INTERVAL_MS);
    if (v.violates) {
      throw new BadRequest(
        `触发间隔 ${Math.round(v.gapMs / 60000)} 分钟,低于最小间隔 ` +
        `${Math.round(store.MIN_INTERVAL_MS / 60000)} 分钟`,
      );
    }
    return { kind: 'cron', expr, tz };
  }
  throw new BadRequest('schedule.kind 必须是 cron / once / manual 之一');
}

/** 对外视图:不回传任何内部路径,prompt 全量回(客户端编辑要用)。 */
function view(r) {
  return {
    id: r.id, name: r.name, description: r.description || '',
    prompt: r.prompt, model: r.model || '', configId: r.configId || '',
    schedule: r.schedule, enabled: !!r.enabled,
    nextRunAt: r.nextRunAt || null, lastRunAt: r.lastRunAt || null,
    lastStatus: r.lastStatus || null, ranAt: r.ranAt || null,
    consecutiveErrors: r.consecutiveErrors || 0,
    disabledReason: r.disabledReason || '',
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/**
 * 处理一个 /routines* 请求。返回 true = 已处理。
 * ctx: { uid, send, readBody, log, activity, res }
 */
export async function handleRoutines(req, url, ctx) {
  const m = url.pathname.match(ROUTINES_RE);
  if (!m) return false;
  const [, id, sub] = m;
  const { uid, send } = ctx;

  try {
    // —— 集合 ——
    if (!id) {
      if (req.method === 'GET') {
        // 配额一并回:界面右上角要常驻「今日已用 n / 20」。客户端把这两个字段当**可选**处理,
        // 所以服务端没升级时界面只是不显示这块,不会坏。
        return send(200, {
          routines: store.listRoutines(uid).map(view),
          max: store.MAX_ROUTINES_PER_UID,
          dailyCap: store.DAILY_RUN_CAP,
          usedToday: store.countRunsSince(uid, store.todayStartIso()),
        });
      }
      if (req.method === 'POST') return send(201, await create(uid, await jsonBody(req, ctx.readBody)));
      return send(404, { error: 'not found' });
    }

    const r = store.getRoutine(uid, id);
    if (!r) return send(404, { error: 'not found' });   // 含「属于别人」——不区分,防枚举

    // —— 单个 ——
    if (!sub) {
      if (req.method === 'GET') return send(200, view(r));
      if (req.method === 'PATCH') return send(200, await update(r, await jsonBody(req, ctx.readBody)));
      if (req.method === 'DELETE') {
        // 元数据与历史归 store,容器与卷归 orchestrator —— 两边都要清干净
        store.deleteRoutine(uid, id);
        await orch.removeContainer(id, { keepVolume: false });
        await cred.revokeCredentials(id);
        audit('routine_delete', { sessionId: id, detail: uid });
        return send(200, { ok: true });
      }
      return send(404, { error: 'not found' });
    }

    if (sub.toLowerCase() === 'runs' && req.method === 'GET') {
      const since = url.searchParams.get('since') || '';
      const limit = parseInt(url.searchParams.get('limit') || '200', 10) || 200;
      return send(200, { runs: store.listRuns(uid, id, { since, limit }) });
    }

    if (sub.toLowerCase() === 'run' && req.method === 'POST') {
      const out = await sched.runNow(r, { log: ctx.log, activity: ctx.activity });
      // 429 而不是 200 —— 让客户端能明确区分「已发起」与「被限了」
      return out.started ? send(202, { started: true }) : send(429, { started: false, reason: out.reason });
    }

    return send(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof BadRequest) return send(400, { error: e.message });
    throw e;
  }
}

async function create(uid, body) {
  if (store.countRoutines(uid) >= store.MAX_ROUTINES_PER_UID) {
    throw new BadRequest(`已达上限 ${store.MAX_ROUTINES_PER_UID} 个定时任务,请先删除不用的`);
  }
  const now = new Date().toISOString();
  const r = {
    id: store.newRoutineId(),
    uid,
    name: str(body?.name, MAX_NAME, 'name', { required: true }).trim(),
    description: str(body?.description, MAX_DESC, 'description').trim(),
    prompt: str(body?.prompt, MAX_PROMPT, 'prompt', { required: true }),
    model: str(body?.model, 200, 'model').trim(),
    configId: str(body?.configId, 64, 'configId').trim(),
    schedule: normalizeSchedule(body?.schedule),
    enabled: body?.enabled !== false,
    consecutiveErrors: 0,
    createdAt: now, updatedAt: now,
  };
  r.nextRunAt = r.enabled ? sched.computeNextRun(r) : null;
  store.saveRoutine(r);
  audit('routine_create', { sessionId: r.id, detail: `${uid} ${r.schedule.kind}` });
  return view(r);
}

async function update(r, body) {
  if (body?.name !== undefined) r.name = str(body.name, MAX_NAME, 'name', { required: true }).trim();
  if (body?.description !== undefined) r.description = str(body.description, MAX_DESC, 'description').trim();
  if (body?.prompt !== undefined) r.prompt = str(body.prompt, MAX_PROMPT, 'prompt', { required: true });
  if (body?.model !== undefined) r.model = str(body.model, 200, 'model').trim();
  if (body?.configId !== undefined) r.configId = str(body.configId, 64, 'configId').trim();
  if (body?.schedule !== undefined) r.schedule = normalizeSchedule(body.schedule);

  if (body?.enabled !== undefined) {
    const next = !!body.enabled;
    // 从停用恢复时清掉失败计数与停用原因,否则一恢复就又踩到自动停用阈值
    if (next && !r.enabled) { r.consecutiveErrors = 0; r.disabledReason = ''; }
    r.enabled = next;
  }
  // 任何可能改变触发时刻的编辑都重算(schedule 变了、或从停用恢复)
  r.nextRunAt = r.enabled ? sched.computeNextRun(r) : null;
  store.saveRoutine(r);
  return view(r);
}

/** GET /runs/:runId/transcript —— 流式回 stream-json 原文。 */
export async function handleTranscript(req, url, ctx) {
  const m = url.pathname.match(TRANSCRIPT_RE);
  if (!m || req.method !== 'GET') return false;
  const { uid, send, res } = ctx;
  const runId = m[1];

  // 归属校验:runId 本身不含 uid,必须反查「这条 run 属于本用户的某个 routine」。
  // 少了这一步,任何人猜到 runId 就能读别人任务的完整输出。
  const owned = store.listRoutines(uid).some((r) =>
    store.listRuns(uid, r.id, { limit: 1000 }).some((run) => run.runId === runId));
  if (!owned) return send(404, { error: 'not found' });

  let stat;
  try { stat = fs.statSync(store.transcriptFile(runId)); } catch { return send(404, { error: 'not found' }); }
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-length': stat.size });
  const stream = fs.createReadStream(store.transcriptFile(runId));
  stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
  res.on('error', () => { /* 客户端断开 */ });
  stream.pipe(res);
  res.on('close', () => { try { stream.destroy(); } catch { /* ignore */ } });
  return true;
}

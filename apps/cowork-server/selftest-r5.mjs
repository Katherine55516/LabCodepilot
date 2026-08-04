#!/usr/bin/env node
/**
 * P3 自检 —— 定时任务的存储 / cron / REST / 两条「不做就是线上事故」的护栏。
 *
 * ⚠️ **与 selftest-r1..r4 的关键区别:本脚本绝不清场。**
 * 那几个会 reconcile 掉全部受管容器与网络,所以有活跃用户时不能跑;本脚本只在
 * 独立端口 + 临时 state 目录 + 专用 probe uid 下操作,reconcile 也只 scope 到自己的 uid。
 * 因此**可以在生产上跑**(仍建议低峰)。
 *
 * 用法:
 *   cd /opt/cowork-server && node selftest-r5.mjs
 *   PORT=8796 node selftest-r5.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const PORT = parseInt(process.env.PORT || '8796', 10);
const SECRET = 'r5-test-secret';
const UID = 'r5probe';
const BASE = `http://127.0.0.1:${PORT}`;
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-r5-'));

// ⚠️ 必须在**任何 lib 被 import 之前**改掉,audit.mjs 是在模块加载时读这个变量的。
// 不改的话自检的 routine_end 事件会写进生产审计日志 —— 而那份日志会被账号后端
// 增量拉进用量库,等于把自检数据混进真实统计。首次在生产跑时踩过(污染了 2 行)。
process.env.COWORK_AUDIT_FILE = path.join(STATE_DIR, 'audit.log');
process.env.COWORK_STATE_DIR = STATE_DIR;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signToken(uid) {
  const payload = b64url(JSON.stringify({ uid }));
  return `${payload}.${b64url(crypto.createHmac('sha256', SECRET).update(payload).digest())}`;
}
const TOKEN = signToken(UID);
const OTHER = signToken('r5other');

async function api(method, p, body, token = TOKEN) {
  const res = await fetch(BASE + p, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 流式端点 */ }
  return { status: res.status, body: json };
}

// ── 1. 纯函数层(不需要 server)──────────────────────────────────
async function testPureLayers() {
  console.log('\n[1] 存储与 cron 纯函数');
  const store = await import('./lib/routine-store.mjs');
  const cron = await import('./lib/routine-cron.mjs');

  // 路径穿越:uid 字符集含 `.`,`..` 能过正则,必须被显式挡住
  let threw = false;
  try { store.getRoutine('../../etc', 'a'.repeat(32)); } catch { threw = true; }
  ok('uid 路径穿越被拒(../..)', threw);

  const id = store.newRoutineId();
  ok('routineId 满足 orchestrator 的 sid 约束(32 hex)', /^[a-f0-9]{32}$/.test(id));

  store.ensureStateDir();
  const now = new Date().toISOString();
  store.saveRoutine({ id, uid: UID, name: 'x', prompt: 'p', schedule: { kind: 'manual' }, enabled: true, createdAt: now });
  ok('保存后可读回', store.getRoutine(UID, id)?.name === 'x');
  ok('listRoutines 能列到', store.listRoutines(UID).length === 1);
  ok('别的 uid 读不到', store.getRoutine('r5other', id) === null);

  store.appendRun(UID, id, { runId: store.newRunId(), startedAt: now, status: 'success' });
  store.appendRun(UID, id, { runId: store.newRunId(), startedAt: now, status: 'skipped' });
  ok('运行历史可读(2 条)', store.listRuns(UID, id).length === 2);
  ok('skipped 不计入配额', store.countRunsSince(UID, '1970-01-01T00:00:00Z') === 1);

  // cron 时区正确性:9:00 上海 = 01:00Z
  const next = cron.getNextCronTime('0 9 * * *', 'Asia/Shanghai', new Date('2026-08-04T02:00:00Z'));
  ok('cron 按 routine 时区求值(9:00 上海 → 01:00Z)', next?.toISOString() === '2026-08-05T01:00:00.000Z',
    String(next));
  ok('非法时区 → null', cron.getNextCronTime('0 9 * * *', 'Not/AZone') === null);
  ok('最小间隔:每 5 分钟被判违规', cron.violatesMinInterval('*/5 * * * *', 'UTC', 900000).violates);
  ok('最小间隔:每 20 分钟通过', !cron.violatesMinInterval('*/20 * * * *', 'UTC', 900000).violates);
  const j = cron.getJitterMs(id);
  ok('抖动确定性且有界(0..5min)', j === cron.getJitterMs(id) && j >= 0 && j <= 300000);

  store.deleteRoutine(UID, id);
  ok('删除后读不到', store.getRoutine(UID, id) === null);
}

// ── 2. runner 的保活钩子(🔴 TTL 事故点)────────────────────────
async function testActivityHook() {
  console.log('\n[2] 🔴 保活钩子 — 不接就会被 TTL 中途回收');
  const { runRoutine } = await import('./lib/routine-runner.mjs');
  const calls = [];
  // 让取凭证直接失败:不需要真容器就能验「钩子有没有被调用」的时序契约
  const r = await runRoutine({
    sid: 'a'.repeat(32), uid: UID, prompt: 'x',
    activity: { start: (s) => calls.push('start:' + s), end: (s) => calls.push('end:' + s) },
    fetchCredentials: async () => { throw new Error('boom'); },
  });
  ok('取凭证失败 → credential_error 且不误报成功', r.status === 'credential_error' && r.ok === false);
  ok('凭证阶段就失败时不应触碰容器(钩子未调用)', calls.length === 0);

  // index.mjs 是否真把 execOpened/execClosed 接上了 —— 只验源码接线,不起服务
  const src = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  ok('index.mjs 已把 execOpened/execClosed 接进 ROUTINE_ACTIVITY',
    /ROUTINE_ACTIVITY\s*=\s*\{\s*start:\s*execOpened,\s*end:\s*execClosed\s*\}/.test(src));
  ok('调度器启动时传入了 activity',
    /routineSched\.start\(\{[^}]*activity:\s*ROUTINE_ACTIVITY/.test(src));
}

// ── 3. 🔴 reconcile 不误删 routine 工作区 ──────────────────────
async function testReconcileExclusion() {
  console.log('\n[3] 🔴 reconcile 不误删 routine 工作区');
  const orch = await import('./lib/orchestrator.mjs');
  const rid = crypto.randomBytes(16).toString('hex');
  const sid = crypto.randomBytes(16).toString('hex');
  try {
    await orch.ensureVolume(rid, UID, orch.KIND_ROUTINE);
    await orch.ensureVolume(sid, UID, orch.KIND_SESSION);
    ok('两个卷都建起来了', await orch.volumeExists(rid) && await orch.volumeExists(sid));

    // 模拟客户端 reconcile:keep 是空的(客户端不知道 routine 的 sid,也没有该会话)
    const removed = await orch.reconcile([], UID);
    ok('普通会话被回收', removed.includes(sid));
    ok('**routine 工作区被保住**(不做就是「打开 app 清空所有定时任务」)',
      !removed.includes(rid) && await orch.volumeExists(rid));

    const kinds = await orch.listSessionsOfKind(orch.KIND_ROUTINE, UID);
    ok('listSessionsOfKind 能正查到 routine', kinds.includes(rid));
  } finally {
    for (const s of [rid, sid]) { try { await orch.removeContainer(s, { keepVolume: false }); } catch { /* ignore */ } }
  }
}

// ── 4. REST(起独立实例)────────────────────────────────────────
function startServer() {
  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: {
      ...process.env,
      COWORK_SERVER_PORT: String(PORT),
      COWORK_SERVER_HOST: '127.0.0.1',
      COWORK_AUTH_SECRET: SECRET,
      COWORK_STATE_DIR: STATE_DIR,
      COWORK_ROUTINE_TICK_MS: '3600000',   // 自检期间别让 tick 真去跑任务
      COWORK_AUDIT_FILE: path.join(STATE_DIR, 'audit.log'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => { if (process.env.R5_VERBOSE) process.stderr.write(d); });
  return child;
}

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function testRest() {
  console.log('\n[4] REST 端点与校验');
  let created;

  const bad = await api('POST', '/routines', { name: 'x', prompt: 'p', schedule: { kind: 'cron', expr: '*/5 * * * *', tz: 'UTC' } });
  ok('最小间隔 15 分钟被拒(400 且给出可读原因)', bad.status === 400 && /最小间隔/.test(bad.body?.error || ''), JSON.stringify(bad.body));

  const badTz = await api('POST', '/routines', { name: 'x', prompt: 'p', schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Not/AZone' } });
  ok('非法时区被拒', badTz.status === 400);

  const badOnce = await api('POST', '/routines', { name: 'x', prompt: 'p', schedule: { kind: 'once', fireAt: '2000-01-01T00:00:00Z' } });
  ok('一次性时刻在过去 → 拒', badOnce.status === 400);

  const noName = await api('POST', '/routines', { prompt: 'p', schedule: { kind: 'manual' } });
  ok('缺 name → 400', noName.status === 400);

  const c = await api('POST', '/routines', {
    name: '每日日报', description: 'd', prompt: '汇总昨天数据',
    schedule: { kind: 'cron', expr: '0 9 * * 1-5', tz: 'Asia/Shanghai' },
  });
  ok('创建成功(201)', c.status === 201, JSON.stringify(c.body));
  created = c.body;
  ok('返回了 nextRunAt', !!created?.nextRunAt);
  ok('nextRunAt 在未来', Date.parse(created?.nextRunAt) > Date.now());
  ok('响应不含内部字段(uid/文件路径)', !!created?.id && !('uid' in created));

  const list = await api('GET', '/routines');
  ok('列表能看到', list.body?.routines?.length === 1 && list.body.max === 50);

  const other = await api('GET', `/routines/${created.id}`, null, OTHER);
  ok('跨用户访问 → 404(不是 403,防枚举)', other.status === 404);

  const patch = await api('PATCH', `/routines/${created.id}`, { enabled: false });
  ok('停用后 nextRunAt 置空', patch.status === 200 && patch.body.enabled === false && patch.body.nextRunAt === null);

  const resume = await api('PATCH', `/routines/${created.id}`, { enabled: true });
  ok('恢复后重算 nextRunAt', resume.body.enabled === true && !!resume.body.nextRunAt);

  const runs = await api('GET', `/routines/${created.id}/runs`);
  ok('运行历史端点可用(空)', runs.status === 200 && Array.isArray(runs.body.runs));

  const ghost = await api('GET', '/runs/run_' + 'a'.repeat(24) + '/transcript');
  ok('不属于本人的 transcript → 404', ghost.status === 404);

  const del = await api('DELETE', `/routines/${created.id}`);
  ok('删除成功', del.status === 200);
  ok('删除后查不到', (await api('GET', `/routines/${created.id}`)).status === 404);
}

// ── main ────────────────────────────────────────────────────────
console.log(`P3 自检 — state=${STATE_DIR} port=${PORT}`);
await testPureLayers();
await testActivityHook();

let child = null;
try {
  await testReconcileExclusion();
} catch (e) {
  console.log(`  ⚠️  跳过 reconcile 用例(docker 不可用?): ${e.message}`);
}

try {
  child = startServer();
  if (!(await waitReady())) {
    console.log('  ❌ server 未就绪,跳过 REST 用例(用 R5_VERBOSE=1 看 stderr)');
    fail++;
  } else {
    await testRest();
  }
} finally {
  if (child) child.kill('SIGTERM');
  try { fs.rmSync(STATE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

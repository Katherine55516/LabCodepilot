/**
 * 定时任务会话与办公对话列表的隔离(P4)。
 *
 * 背景:定时任务产生的会话是**服务端每天自动产出**的。初版设计把它们直接放进办公对话
 * 列表(还加了个「定时」分组),用户看过原型后明确否掉 ——「很乱很疑惑」:自动产生的
 * 会话每天都在增加,会把用户自己的对话越推越远,而且「我没建过这个对话」本身就令人困惑。
 *
 * 改后的做法是拆开**存储复用**与**导航归属**:仍然物化成 chat_sessions(渲染、产物卡片、
 * 下载整套零成本复用),但办公列表查询加 `routine_id = ''` 把它们排掉,只能从「定时任务」
 * 页经三层导航进入。
 *
 * 关键不变量(改 db.ts 可见性逻辑时必须仍成立):
 *   1. routine 会话**不出现在办公对话列表**;
 *   2. 但能按 routine_id 查到(第二层页面的取数口);
 *   3. **搜索也要排除** —— 搜到一条列表里根本看不到的会话,点过去是条死路;
 *   4. 普通办公会话不受影响(别把过滤写成一刀切);
 *   5. routine 缓存按 owner_uid 隔离,换账号读不到上一个账号的。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-routine-isolation-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  addMessage,
  getVisibleSessions,
  getSessionsByRoutine,
  getSessionByRoutineRun,
  markSessionAsRoutineRun,
  searchMessages,
  upsertCoworkRoutine,
  listCoworkRoutines,
  getCoworkRoutine,
  replaceCoworkRoutines,
  purgeCoworkRoutines,
  setSetting,
  closeDb,
} = require('../../lib/db') as typeof import('../../lib/db');

const UID_A = '92c34452-1d5a-459b-8f01-64720d3fee9a';
const UID_B = '5e75b845-48a9-417c-b3bd-9f22922c5790';
const ROUTINE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const RUN_ID = 'run_0123456789abcdef01234567';

const loginAs = (uid: string) => setSetting('current_user_uid', uid);

const mkRoutine = (id: string, uid: string, name = 'r') => ({
  id, owner_uid: uid, name, description: '', prompt: 'p', model: '', config_id: '',
  schedule_kind: 'cron' as const, schedule_expr: '0 9 * * *', schedule_tz: 'Asia/Shanghai',
  schedule_fire_at: '', enabled: 1, next_run_at: '', last_run_at: '', last_status: '',
  ran_at: '', consecutive_errors: 0, disabled_reason: '',
  created_at: '2026-08-05T00:00:00Z', updated_at: '2026-08-05T00:00:00Z', synced_at: '',
});

let manualId = '';
let routineSessionId = '';

describe('定时任务会话不混进办公对话列表', () => {
  before(() => {
    loginAs(UID_A);
    manualId = createSession('我自己建的办公会话', 'sonnet', '', tmpDir, undefined, undefined, undefined, undefined, true).id;
    addMessage(manualId, 'user', 'MANUALNEEDLE 手动会话内容');

    routineSessionId = createSession('每日销售日报 · 08-05', 'sonnet', '', tmpDir, undefined, undefined, undefined, undefined, true).id;
    addMessage(routineSessionId, 'assistant', 'ROUTINENEEDLE 定时任务产出内容');
    markSessionAsRoutineRun(routineSessionId, ROUTINE_ID, RUN_ID);
  });

  after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('① routine 会话不出现在办公对话列表', () => {
    const ids = getVisibleSessions().map((s) => s.id);
    assert.ok(!ids.includes(routineSessionId), 'routine 会话漏进了对话列表 —— 正是用户否掉的那个体验');
  });

  it('④ 普通办公会话不受影响', () => {
    const ids = getVisibleSessions().map((s) => s.id);
    assert.ok(ids.includes(manualId), '过滤写成一刀切了,把用户自己的会话也挡了');
  });

  it('② 能按 routine_id 查到(第二层页面的取数口)', () => {
    const rows = getSessionsByRoutine(ROUTINE_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, routineSessionId);
  });

  it('② 能按 runId 查到(物化的幂等键)', () => {
    assert.equal(getSessionByRoutineRun(RUN_ID)?.id, routineSessionId);
    assert.equal(getSessionByRoutineRun('run_ffffffffffffffffffffffff'), undefined);
  });

  it('③ 搜索也排除 routine 会话', () => {
    const hits = searchMessages('ROUTINENEEDLE');
    assert.equal(hits.length, 0, '搜索命中了列表里看不到的会话 —— 点过去是死路');
  });

  it('③ 搜索仍能命中普通办公会话', () => {
    const hits = searchMessages('MANUALNEEDLE');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sessionId, manualId);
  });
});

describe('routine 缓存的账号隔离', () => {
  after(() => purgeCoworkRoutines());

  it('⑤ 只能读到本账号的 routine', () => {
    loginAs(UID_A);
    upsertCoworkRoutine(mkRoutine('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', UID_A, 'A 的任务'));
    loginAs(UID_B);
    upsertCoworkRoutine(mkRoutine('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', UID_B, 'B 的任务'));

    loginAs(UID_A);
    const a = listCoworkRoutines();
    assert.equal(a.length, 1);
    assert.equal(a[0].name, 'A 的任务');
    assert.equal(getCoworkRoutine('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), undefined, 'A 读到了 B 的 routine');
  });

  it('⑤ 未登录时读不到任何 routine', () => {
    loginAs('');
    assert.equal(listCoworkRoutines().length, 0);
  });

  it('replaceCoworkRoutines 会删掉服务端已不存在的(否则别处删的会永远留在本地)', () => {
    loginAs(UID_A);
    upsertCoworkRoutine(mkRoutine('cccccccccccccccccccccccccccccccc', UID_A, '将被删'));
    assert.equal(listCoworkRoutines().length, 2);
    replaceCoworkRoutines([mkRoutine('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', UID_A, 'A 的任务')]);
    const left = listCoworkRoutines();
    assert.equal(left.length, 1);
    assert.equal(left[0].id, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('replaceCoworkRoutines 不误删别的账号的', () => {
    loginAs(UID_B);
    assert.equal(listCoworkRoutines().length, 1, 'A 的覆盖式同步把 B 的 routine 也删了');
  });
});

/**
 * 定时任务的拉取与物化(P5)。
 *
 * 这一层真正要锁住的是**幂等**:定时任务的同步会在 app 启动、打开页面、定时轮询三处触发,
 * 断网重试也会重来。少一道幂等闸,用户就会看到同一次运行出现好几遍 —— 那会直接让人不
 * 信任这个功能(「它到底跑了几次?」)。
 *
 * 其次是**失败照样要物化**。拿不到原文(credential_error 在容器起来之前就失败了,服务端
 * 压根没写 transcript)不能成为"跳过"的理由,否则最该被看见的那类运行反而消失了。
 *
 * 网络层走依赖注入,所以这里测的是**整条链路**(拉取 → 排序 → 幂等 → 物化 → 汇总),
 * 而不是几个边角纯函数。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { RoutineRun } from '../../types';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-routine-sync-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  getVisibleSessions,
  getSessionsByRoutine,
  getSessionByRoutineRun,
  getMessages,
  getRoutineWatermark,
  listCoworkRoutines,
  setSetting,
  closeDb,
} = require('../../lib/db') as typeof import('../../lib/db');

const { syncRoutines } = require('../../lib/routine-sync') as typeof import('../../lib/routine-sync');
const { RoutinesHttpError, RoutinesUnavailableError } =
  require('../../lib/routines-client') as typeof import('../../lib/routines-client');
type RemoteRoutine = import('../../lib/routines-client').RemoteRoutine;
type Deps = import('../../lib/routine-sync').RoutineSyncDeps;

const UID = '92c34452-1d5a-459b-8f01-64720d3fee9a';
const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const FIXTURES = path.join(__dirname, '../fixtures/routine-transcripts');
const TRANSCRIPT = fs.readFileSync(path.join(FIXTURES, 'success-with-tools.jsonl'), 'utf-8');

const remoteRoutine = (over: Partial<RemoteRoutine> = {}): RemoteRoutine => ({
  id: RID,
  name: '每日销售日报',
  description: '',
  prompt: '汇总昨天的销售数据,生成日报',
  model: '',
  configId: 'cfg-1',
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
  enabled: true,
  nextRunAt: '2026-08-06T01:00:00.000Z',
  lastRunAt: '2026-08-05T01:00:00.000Z',
  lastStatus: 'success',
  ranAt: null,
  consecutiveErrors: 0,
  disabledReason: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-05T01:00:00.000Z',
  ...over,
});

const run = (n: number, over: Partial<RoutineRun> = {}): RoutineRun => ({
  runId: `run_${String(n).padStart(24, '0')}`,
  startedAt: `2026-08-0${n}T01:00:00.000Z`,
  finishedAt: `2026-08-0${n}T01:00:20.000Z`,
  status: 'success',
  ok: true,
  ...over,
});

/** 服务端返回新→旧,这里照它的口径来(排序错了就测不出真问题)。 */
function mkDeps(runs: RoutineRun[], over: Partial<Deps> = {}): Deps {
  return {
    listRoutines: async () => [remoteRoutine()],
    listRuns: async (_id, opts) => {
      const since = opts?.since || '';
      return runs.filter((r) => !since || r.startedAt > since).slice().reverse();
    },
    fetchTranscript: async () => TRANSCRIPT,
    ...over,
  };
}

describe('定时任务同步与物化', () => {
  after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  before(() => setSetting('current_user_uid', UID));

  it('① 首次同步:三次运行物化成三个会话', async () => {
    const r = await syncRoutines(mkDeps([run(1), run(2), run(3)]));

    assert.equal(r.ok, true);
    assert.equal(r.offline, false);
    assert.equal(r.routines, 1);
    assert.equal(r.materialized, 3);
    assert.equal(r.succeeded, 3);
    assert.equal(r.failed, 0);
    assert.equal(getSessionsByRoutine(RID).length, 3);
    assert.equal(listCoworkRoutines().length, 1, 'routine 定义也该落进缓存');
  });

  it('② 物化的会话不出现在办公对话列表里', () => {
    const visible = getVisibleSessions().map((s) => s.id);
    const routineSessions = getSessionsByRoutine(RID).map((s) => s.id);
    for (const id of routineSessions) {
      assert.ok(!visible.includes(id), '定时任务会话混进办公列表了 —— 正是用户否掉的体验');
    }
  });

  it('③ 消息重放到位:一条指令 + 一条带工具的回复', () => {
    const session = getSessionByRoutineRun(run(1).runId)!;
    const { messages: msgs } = getMessages(session.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[0].content, '汇总昨天的销售数据,生成日报');
    assert.equal(msgs[1].role, 'assistant');
    const blocks = JSON.parse(msgs[1].content) as Array<{ type: string }>;
    assert.ok(blocks.some((b) => b.type === 'tool_use'), '工具调用没重放出来');
  });

  it('④ 会话归属当前账号,且标了 routine 两列', () => {
    const s = getSessionByRoutineRun(run(1).runId)!;
    assert.equal(s.owner_uid, UID);
    assert.equal(s.sandbox_enabled, 1);
    assert.equal(s.routine_id, RID);
    assert.equal(s.routine_run_id, run(1).runId);
  });

  it('⑤ 顺序:列表最新的在最前(物化是从旧到新做的)', () => {
    const rows = getSessionsByRoutine(RID);
    assert.deepEqual(
      rows.map((s) => s.routine_run_id),
      [run(3).runId, run(2).runId, run(1).runId],
      '本地顺序与真实运行顺序反了',
    );
  });

  it('⑥ 水位线推进到最新一次运行', () => {
    assert.equal(getRoutineWatermark(RID), run(3).startedAt);
  });

  it('🔴 ⑦ 幂等:同样的数据再同步一遍,不产生重复会话', async () => {
    const before = getSessionsByRoutine(RID).length;
    const r = await syncRoutines(mkDeps([run(1), run(2), run(3)]));
    assert.equal(r.materialized, 0, '重复拉取又物化了一遍');
    assert.equal(getSessionsByRoutine(RID).length, before);
    assert.equal(r.summary, null, '没有新运行就不该弹汇总');
  });

  it('🔴 ⑧ 水位线倒退也不会重复(幂等闸是最后一道防线)', async () => {
    // 模拟水位线丢失(换机器、清配置):since 回到空,服务端会把历史全量返回。
    const all = [run(1), run(2), run(3)];
    const r = await syncRoutines({
      ...mkDeps(all),
      listRuns: async () => all.slice().reverse(),  // 无视 since,全量返回
    });
    assert.equal(r.materialized, 0);
    assert.equal(getSessionsByRoutine(RID).length, 3);
  });

  it('⑨ 只物化新增的那一次', async () => {
    const r = await syncRoutines(mkDeps([run(1), run(2), run(3), run(4)]));
    assert.equal(r.materialized, 1);
    assert.equal(getSessionsByRoutine(RID).length, 4);
    assert.equal(getRoutineWatermark(RID), run(4).startedAt);
  });
});

describe('失败与跳过', () => {
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-routine-sync-fail-'));

  before(() => setSetting('current_user_uid', UID));
  after(() => fs.rmSync(tmpDir2, { recursive: true, force: true }));

  it('🔴 ⑩ 拿不到原文(404)的失败照样物化', async () => {
    const failed = run(5, {
      status: 'credential_error',
      ok: false,
      error: '模型凭证被上游拒绝(401),已立即中止而不等它退避重试',
    });
    const r = await syncRoutines(
      mkDeps([failed], {
        // credential_error 在容器起来之前就失败了,服务端根本没写 transcript
        fetchTranscript: async () => { throw new RoutinesHttpError(404, 'not found'); },
      }),
    );

    assert.equal(r.materialized, 1, '没有原文就跳过的话,最该被看见的失败反而消失了');
    assert.equal(r.failed, 1);

    const s = getSessionByRoutineRun(failed.runId)!;
    const { messages: msgs } = getMessages(s.id);
    const blocks = JSON.parse(msgs[1].content) as Array<{ type: string; text?: string }>;
    assert.match(blocks[0].text!, /模型凭证错误/);
  });

  it('⑪ 汇总文案合并成一条,带上第一条失败的原因(D14)', async () => {
    const r = await syncRoutines(
      mkDeps([run(6, { status: 'error', ok: false, error: '找不到 台账.xlsx' })], {
        fetchTranscript: async () => { throw new RoutinesHttpError(404, 'not found'); },
      }),
    );
    assert.ok(r.summary, '有新运行却没有汇总');
    assert.match(r.summary!, /跑了 1 次/);
    assert.match(r.summary!, /1 失败/);
    assert.match(r.summary!, /找不到 台账\.xlsx/);
  });

  it('⑫ skipped 不物化成会话(它没有任何产出)', async () => {
    const skipped = run(7, { status: 'skipped', ok: false, skipReason: 'daily_quota_exceeded' });
    const before = getSessionsByRoutine(RID).length;
    const r = await syncRoutines(mkDeps([skipped]));

    assert.equal(r.skipped, 1);
    assert.equal(r.materialized, 0);
    assert.equal(getSessionsByRoutine(RID).length, before, '空会话堆进列表了');
    assert.equal(getRoutineWatermark(RID), skipped.startedAt, 'skipped 也要推进水位线,否则每次都重拉');
  });
});

describe('降级:沙箱不可达 / 未开通', () => {
  before(() => setSetting('current_user_uid', UID));

  it('⑬ 沙箱不可达:标 offline 而不抛异常', async () => {
    const r = await syncRoutines(
      mkDeps([], { listRoutines: async () => { throw new Error('fetch failed'); } }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.offline, true);
    assert.match(r.error!, /fetch failed/);
  });

  it('⑭ 未开通:标 notProvisioned(UI 该隐藏整个入口而不是置灰)', async () => {
    const r = await syncRoutines(
      mkDeps([], { listRoutines: async () => { throw new RoutinesUnavailableError(); } }),
    );
    assert.equal(r.notProvisioned, true);
    assert.equal(r.offline, false, '「没开通」和「连不上」是两回事,UI 处理也不同');
  });

  it('⑮ 服务端删掉 routine 后,已物化的历史仍在', async () => {
    const r = await syncRoutines(mkDeps([], { listRoutines: async () => [] }));
    assert.equal(r.routines, 0);
    assert.equal(listCoworkRoutines().length, 0, '缓存该跟着服务端删掉');
    assert.ok(getSessionsByRoutine(RID).length > 0, '任务删了,跑过的历史不该跟着消失');
  });
});

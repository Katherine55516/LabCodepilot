/**
 * 定时任务界面的纯逻辑(P6)。
 *
 * 重点是**预设 ↔ cron 的往返**:错了不会报错,只会静默把用户的调度改掉。
 * 最坏的一种是「点开编辑、什么都没动、一保存调度就变了」—— 用户根本不会想到去看,
 * 等发现时已经错跑了好几天。所以往返必须逐个预设锁住,认不出的表达式必须原样保留。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CoworkRoutine, RoutineRun } from '../../types';
import {
  draftToSchedule, emptyScheduleDraft, routineToDraft,
  describeSchedule, routineBadge, runTone, runResultText,
  formatCost, formatDuration, formatDateTime, isoToLocalInput,
} from '../../lib/routine-ui';

const mkRoutine = (over: Partial<CoworkRoutine> = {}): CoworkRoutine => ({
  id: 'a'.repeat(32), owner_uid: 'u', name: 'r', description: '', prompt: 'p',
  model: '', config_id: '', schedule_kind: 'cron', schedule_expr: '0 9 * * *',
  schedule_tz: 'Asia/Shanghai', schedule_fire_at: '', enabled: 1,
  next_run_at: '', last_run_at: '', last_status: '', ran_at: '',
  consecutive_errors: 0, disabled_reason: '',
  created_at: '', updated_at: '', synced_at: '',
  ...over,
});

/** 假的翻译:把 key 和参数原样拼出来,断言才看得见到底用了哪个 key。 */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

describe('预设 ↔ cron 往返', () => {
  const cases: Array<[string, Partial<ReturnType<typeof emptyScheduleDraft>>, string]> = [
    ['每天', { preset: 'daily', time: '09:00' }, '0 9 * * *'],
    ['工作日', { preset: 'weekday', time: '18:30' }, '30 18 * * 1-5'],
    ['每周三', { preset: 'weekly', time: '08:05', weekday: 3 }, '5 8 * * 3'],
    ['每小时', { preset: 'hourly', minute: 17 }, '17 * * * *'],
  ];

  for (const [name, patch, expr] of cases) {
    it(`${name} → ${expr} → 认得回来`, () => {
      const draft = { ...emptyScheduleDraft(), ...patch };
      const s = draftToSchedule(draft);
      assert.equal(s.kind, 'cron');
      assert.equal(s.expr, expr);

      const back = routineToDraft(mkRoutine({ schedule_kind: 'cron', schedule_expr: expr }));
      assert.equal(back.preset, patch.preset, '认不出自己刚生成的表达式');
      if (patch.time) assert.equal(back.time, patch.time);
      if (patch.weekday != null) assert.equal(back.weekday, patch.weekday);
      if (patch.minute != null) assert.equal(back.minute, patch.minute);
    });
  }

  it('仅手动', () => {
    assert.deepEqual(draftToSchedule({ ...emptyScheduleDraft(), preset: 'manual' }), { kind: 'manual' });
    assert.equal(routineToDraft(mkRoutine({ schedule_kind: 'manual' })).preset, 'manual');
  });

  it('指定时间跑一次:本地时间 → ISO → 回填', () => {
    const draft = { ...emptyScheduleDraft(), preset: 'once' as const, fireAtLocal: '2026-08-09T14:30' };
    const s = draftToSchedule(draft);
    assert.equal(s.kind, 'once');
    // 本地时间进、UTC 出,回填时再转回同一个本地串
    assert.equal(isoToLocalInput(s.fireAt!), '2026-08-09T14:30');
  });

  it('🔴 认不出的 cron 原样保留,绝不猜', () => {
    // 每 6 小时 —— 六个预设里没有对应项
    const back = routineToDraft(mkRoutine({ schedule_expr: '0 */6 * * *' }));
    assert.equal(back.preset, 'cron', '被硬塞进某个预设了 —— 保存时会静默改掉用户的调度');
    assert.equal(back.expr, '0 */6 * * *', '原表达式丢了');
    assert.equal(draftToSchedule(back).expr, '0 */6 * * *', '往返之后表达式变了');
  });

  it('字段数不对的表达式也原样保留', () => {
    const back = routineToDraft(mkRoutine({ schedule_expr: '0 9 * *' }));
    assert.equal(back.preset, 'cron');
    assert.equal(back.expr, '0 9 * *');
  });

  it('时区跟着 routine 走,不被本机覆盖', () => {
    const back = routineToDraft(mkRoutine({ schedule_tz: 'America/New_York' }));
    assert.equal(back.tz, 'America/New_York');
    assert.equal(draftToSchedule(back).tz, 'America/New_York');
  });

  it('越界的时分被夹住而不是生成非法 cron', () => {
    const s = draftToSchedule({ ...emptyScheduleDraft(), preset: 'daily', time: '99:99' });
    assert.equal(s.expr, '59 23 * * *');
  });
});

describe('调度的人话描述', () => {
  it('各预设走各自的 key', () => {
    assert.equal(describeSchedule(mkRoutine({ schedule_kind: 'manual' }), t), 'routines.schedule.manualOnly');
    assert.equal(describeSchedule(mkRoutine({ schedule_expr: '0 9 * * *' }), t), 'routines.schedule.daily(time=09:00)');
    assert.equal(describeSchedule(mkRoutine({ schedule_expr: '30 18 * * 1-5' }), t), 'routines.schedule.weekday(time=18:30)');
    assert.match(describeSchedule(mkRoutine({ schedule_expr: '0 8 * * 1' }), t), /^routines\.schedule\.weekly/);
  });

  it('认不出的 cron 把表达式原样显示出来', () => {
    assert.equal(
      describeSchedule(mkRoutine({ schedule_expr: '0 */6 * * *' }), t),
      'routines.schedule.cron(expr=0 */6 * * *)',
    );
  });

  it('一次性任务跑过之后说法不同', () => {
    const base = { schedule_kind: 'once' as const, schedule_fire_at: '2026-08-09T06:30:00.000Z' };
    assert.match(describeSchedule(mkRoutine(base), t), /^routines\.schedule\.onceAt/);
    assert.match(describeSchedule(mkRoutine({ ...base, ran_at: '2026-08-09T06:30:00.000Z' }), t), /^routines\.schedule\.onceRan/);
  });
});

describe('状态徽标', () => {
  it('四种形态各归各位', () => {
    assert.deepEqual(routineBadge(mkRoutine()), { key: 'routines.badge.enabled', tone: 'ok' });
    assert.equal(routineBadge(mkRoutine({ enabled: 0 })).key, 'routines.badge.paused');
    assert.equal(routineBadge(mkRoutine({ consecutive_errors: 3 })).key, 'routines.badge.failing');
    assert.equal(routineBadge(mkRoutine({ consecutive_errors: 3 })).params?.n, 3);
  });

  it('自动停用与手动暂停要能分辨', () => {
    const auto = routineBadge(mkRoutine({ enabled: 0, disabled_reason: '连续失败 10 次' }));
    assert.equal(auto.key, 'routines.badge.autoDisabled');
    assert.equal(auto.tone, 'err', '自动停用是出事了,不该跟手动暂停一个颜色');
  });

  it('跳过是「没跑」不是「跑失败」,颜色要区分', () => {
    assert.equal(runTone('success'), 'ok');
    assert.equal(runTone('skipped'), 'warn');
    assert.equal(runTone('error'), 'err');
    assert.equal(runTone('credential_error'), 'err');
  });
});

describe('运行结果列', () => {
  const run = (o: Partial<RoutineRun>): RoutineRun =>
    ({ runId: 'r', startedAt: '', status: 'success', ...o });

  it('成功取结果首行并截断', () => {
    assert.equal(runResultText(run({ resultText: '生成了日报\n第二行' }), t), '生成了日报');
    assert.ok(runResultText(run({ resultText: 'x'.repeat(200) }), t).endsWith('…'));
  });

  it('失败给服务端的原因', () => {
    assert.equal(runResultText(run({ status: 'error', error: '找不到 台账.xlsx' }), t), '找不到 台账.xlsx');
  });

  it('跳过给跳过理由 —— 没有这行用户只会看到「今天怎么没跑」', () => {
    assert.equal(
      runResultText(run({ status: 'skipped', skipReason: 'daily_quota_exceeded' }), t),
      'routines.skip.quota',
    );
  });

  it('未知的跳过原因原样回显,不吞掉', () => {
    assert.equal(runResultText(run({ status: 'skipped', skipReason: 'brand_new' }), t), 'brand_new');
  });
});

describe('格式化', () => {
  it('耗时:一分钟内给秒,超过给分秒', () => {
    assert.equal(formatDuration(18_000), '18s');
    assert.equal(formatDuration(94_000), '1m34s');
    assert.equal(formatDuration(122_000), '2m02s');
    assert.equal(formatDuration(null), '—');
  });

  it('成本:很小的数不要显示成 $0.00', () => {
    assert.equal(formatCost(0.13), '$0.13');
    assert.equal(formatCost(0.0042), '$0.0042');
    assert.equal(formatCost(null), '—');
  });

  it('时间坏了不显示 NaN', () => {
    assert.equal(formatDateTime('not-a-date'), '—');
    assert.equal(formatDateTime(''), '—');
    assert.equal(isoToLocalInput('nope'), '');
  });
});

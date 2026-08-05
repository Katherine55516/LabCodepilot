/**
 * routine-ui.ts —— 定时任务界面的纯逻辑(P6)。
 *
 * 抽出来不是为了复用,是为了**能单测**:预设↔cron 的互转、状态到色调的映射、
 * 时长/成本的格式化 —— 这些错了界面会显示错误信息但不会报错,靠肉眼看很难发现。
 * 组件里只留渲染。
 *
 * 文案不在这里。需要出文字的函数收一个 `t`,由组件把 i18n 传进来。
 */
import type { CoworkRoutine, RoutineRun, RoutineSchedule } from '@/types';

/** 调度预设。刻意只有六个,cron 收进「高级」—— 见 D6 与原型第 3 屏。 */
export type SchedulePreset = 'manual' | 'hourly' | 'daily' | 'weekday' | 'weekly' | 'once' | 'cron';

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  'manual', 'hourly', 'daily', 'weekday', 'weekly', 'once',
];

/** 预设 → i18n key,组件用它出按钮文案。 */
export const PRESET_LABEL_KEY: Record<SchedulePreset, string> = {
  manual: 'routines.preset.manual',
  hourly: 'routines.preset.hourly',
  daily: 'routines.preset.daily',
  weekday: 'routines.preset.weekday',
  weekly: 'routines.preset.weekly',
  once: 'routines.preset.once',
  cron: 'routines.preset.cron',
};

/** 表单里调度那一栏的完整状态。 */
export interface ScheduleDraft {
  preset: SchedulePreset;
  /** HH:mm,daily/weekday/weekly 用 */
  time: string;
  /** 0=周日…6=周六,weekly 用 */
  weekday: number;
  /** hourly 用:每小时的第几分钟 */
  minute: number;
  /** once 用:datetime-local 的值(本地时间,无时区后缀) */
  fireAtLocal: string;
  /** cron 用:5 字段表达式 */
  expr: string;
  tz: string;
}

/** 本机时区。取不到就退回 Asia/Shanghai(用户群体在国内)。 */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

export function emptyScheduleDraft(): ScheduleDraft {
  return {
    preset: 'daily',
    time: '09:00',
    weekday: 1,
    minute: 0,
    fireAtLocal: '',
    expr: '0 9 * * *',
    tz: localTimezone(),
  };
}

function clampHM(time: string): { h: number; m: number } {
  const [hs, ms] = String(time || '').split(':');
  const h = Math.min(23, Math.max(0, parseInt(hs, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(ms, 10) || 0));
  return { h, m };
}

/** 草稿 → 发给服务端的 schedule。服务端还会再校验一遍(最小间隔/时区/cron 合法性)。 */
export function draftToSchedule(d: ScheduleDraft): RoutineSchedule {
  const { h, m } = clampHM(d.time);
  switch (d.preset) {
    case 'manual':
      return { kind: 'manual' };
    case 'once':
      // datetime-local 是**本地时间且不带时区**,new Date() 按本地解析正好对
      return { kind: 'once', fireAt: new Date(d.fireAtLocal).toISOString() };
    case 'hourly':
      return { kind: 'cron', expr: `${Math.min(59, Math.max(0, d.minute))} * * * *`, tz: d.tz };
    case 'daily':
      return { kind: 'cron', expr: `${m} ${h} * * *`, tz: d.tz };
    case 'weekday':
      return { kind: 'cron', expr: `${m} ${h} * * 1-5`, tz: d.tz };
    case 'weekly':
      return { kind: 'cron', expr: `${m} ${h} * * ${d.weekday}`, tz: d.tz };
    case 'cron':
      return { kind: 'cron', expr: d.expr.trim(), tz: d.tz };
  }
}

/**
 * 已有 routine → 草稿(编辑时回填)。
 *
 * 认不出的 cron 一律落到 `cron` 预设并把原表达式原样带上 —— **绝不猜**。
 * 猜错会让用户点开编辑、什么都没动、一保存就把调度改了,这种静默篡改比报错难查得多。
 */
export function routineToDraft(r: CoworkRoutine): ScheduleDraft {
  const base = emptyScheduleDraft();
  base.tz = r.schedule_tz || base.tz;

  if (r.schedule_kind === 'manual') return { ...base, preset: 'manual' };

  if (r.schedule_kind === 'once') {
    return { ...base, preset: 'once', fireAtLocal: isoToLocalInput(r.schedule_fire_at) };
  }

  const expr = (r.schedule_expr || '').trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { ...base, preset: 'cron', expr };

  const [min, hour, dom, mon, dow] = parts;
  const isNum = (s: string) => /^\d+$/.test(s);

  // 每小时:<m> * * * *
  if (isNum(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { ...base, preset: 'hourly', minute: parseInt(min, 10), expr };
  }
  if (!isNum(min) || !isNum(hour) || dom !== '*' || mon !== '*') {
    return { ...base, preset: 'cron', expr };
  }
  const time = `${String(parseInt(hour, 10)).padStart(2, '0')}:${String(parseInt(min, 10)).padStart(2, '0')}`;
  if (dow === '*') return { ...base, preset: 'daily', time, expr };
  if (dow === '1-5') return { ...base, preset: 'weekday', time, expr };
  if (isNum(dow)) return { ...base, preset: 'weekly', time, weekday: parseInt(dow, 10), expr };
  return { ...base, preset: 'cron', expr };
}

/** ISO → `<input type="datetime-local">` 要的本地时间串(YYYY-MM-DDTHH:mm)。 */
export function isoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** 人话的调度说明,列表卡片与详情页共用。 */
export function describeSchedule(r: CoworkRoutine, t: T): string {
  if (r.schedule_kind === 'manual') return t('routines.schedule.manualOnly');
  if (r.schedule_kind === 'once') {
    return r.ran_at
      ? t('routines.schedule.onceRan', { time: formatDateTime(r.schedule_fire_at) })
      : t('routines.schedule.onceAt', { time: formatDateTime(r.schedule_fire_at) });
  }

  const d = routineToDraft(r);
  switch (d.preset) {
    case 'hourly': return t('routines.schedule.hourly', { minute: d.minute });
    case 'daily': return t('routines.schedule.daily', { time: d.time });
    case 'weekday': return t('routines.schedule.weekday', { time: d.time });
    case 'weekly': return t('routines.schedule.weekly', { day: t(WEEKDAY_KEY[d.weekday] || WEEKDAY_KEY[0]), time: d.time });
    default: return t('routines.schedule.cron', { expr: r.schedule_expr });
  }
}

export const WEEKDAY_KEY: Record<number, string> = {
  0: 'routines.weekday.sun', 1: 'routines.weekday.mon', 2: 'routines.weekday.tue',
  3: 'routines.weekday.wed', 4: 'routines.weekday.thu', 5: 'routines.weekday.fri',
  6: 'routines.weekday.sat',
};

// ── 状态 ──────────────────────────────────────────────────────

/** 卡片徽标只有四种形态(原型第 2 屏)。`tone` 决定配色,由组件映到 token。 */
export type RoutineBadge = { key: string; params?: Record<string, string | number>; tone: 'ok' | 'warn' | 'err' | 'muted' };

export function routineBadge(r: CoworkRoutine): RoutineBadge {
  if (!r.enabled) {
    return r.disabled_reason
      ? { key: 'routines.badge.autoDisabled', tone: 'err' }
      : { key: 'routines.badge.paused', tone: 'muted' };
  }
  if (r.consecutive_errors > 0) {
    return { key: 'routines.badge.failing', params: { n: r.consecutive_errors }, tone: 'err' };
  }
  return { key: 'routines.badge.enabled', tone: 'ok' };
}

/** 单次运行的状态色调。skipped 是「没跑」而不是「跑失败」,单独给 warn。 */
export function runTone(status: string): 'ok' | 'warn' | 'err' {
  if (status === 'success') return 'ok';
  if (status === 'skipped') return 'warn';
  return 'err';
}

export const RUN_STATUS_KEY: Record<string, string> = {
  success: 'routines.run.success',
  error: 'routines.run.error',
  credential_error: 'routines.run.credentialError',
  timeout: 'routines.run.timeout',
  output_overflow: 'routines.run.overflow',
  skipped: 'routines.run.skipped',
};

export const SKIP_REASON_KEY: Record<string, string> = {
  concurrency_limit: 'routines.skip.concurrency',
  daily_quota_exceeded: 'routines.skip.quota',
  previous_run_in_progress: 'routines.skip.inProgress',
  missed_too_long: 'routines.skip.tooLate',
};

/** 运行状态的显示文字。未知状态原样回显,不吞掉 —— 服务端加了新状态要看得见。 */
export function runStatusText(run: RoutineRun, t: T): string {
  const key = RUN_STATUS_KEY[run.status];
  return key ? t(key) : run.status;
}

/** 「结果」列的文字:成功给摘要,失败给原因,跳过给跳过理由。 */
export function runResultText(run: RoutineRun, t: T): string {
  if (run.status === 'skipped') {
    const key = run.skipReason ? SKIP_REASON_KEY[run.skipReason] : '';
    return key ? t(key) : (run.skipReason || '');
  }
  if (run.status !== 'success') return (run.error || '').trim() || runStatusText(run, t);
  return firstLine(run.resultText || '');
}

function firstLine(s: string): string {
  const line = s.split('\n').map((x) => x.trim()).find(Boolean) || '';
  return line.length > 80 ? line.slice(0, 80) + '…' : line;
}

// ── 格式化 ────────────────────────────────────────────────────

/** 耗时。1 分钟内给秒,超过给「N分M秒」—— 定时任务动辄几分钟,纯秒数读起来费劲。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** 成本。服务端回传的 total_cost_usd,不用另算。 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** `MM-DD HH:mm`(本地时区)。服务端记的是 UTC,用户要看的是自己的钟。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

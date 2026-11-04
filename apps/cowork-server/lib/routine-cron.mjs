/**
 * 时区感知的 cron 求值 + 确定性抖动(P3)。
 *
 * 与客户端 src/lib/task-scheduler.ts 的同名函数是**同源不同实现**:那边跑在用户机器上,
 * "本地时区"就是用户时区,直接用 new Date() 即可;这边跑在香港的服务器上,而用户可能
 * 在任何时区 —— **必须按 routine 自带的 tz 求值**,否则「每天 9 点」会变成服务器的 9 点。
 * 这是服务端调度相对客户端调度唯一必须新写的一块逻辑。
 *
 * 纯函数、零依赖(cowork-server 只依赖 ws,不为这个引 cron 库):
 * 时区换算靠 Intl.DateTimeFormat,Node 22 自带完整 ICU。
 */

/** 支持的 cron 字段语法:`*` / `n` / `a,b,c` / `a-b` / `*|a/step`(与客户端一致)。 */
function matchField(value, field) {
  if (field === '*') return true;
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const stepNum = parseInt(step, 10);
    if (!Number.isFinite(stepNum) || stepNum <= 0) return false;
    if (base === '*') return value % stepNum === 0;
    const b = parseInt(base, 10);
    return value >= b && (value - b) % stepNum === 0;
  }
  if (field.includes(',')) return field.split(',').map(Number).includes(value);
  if (field.includes('-')) {
    const [a, b] = field.split('-').map(Number);
    return value >= a && value <= b;
  }
  return parseInt(field, 10) === value;
}

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const _fmtCache = new Map();
function formatterFor(tz) {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

/** 某个 UTC 瞬间在 tz 里的墙上时间。tz 非法会抛,调用方应先 isValidTimezone。 */
export function tzParts(date, tz) {
  const p = {};
  for (const { type, value } of formatterFor(tz).formatToParts(date)) p[type] = value;
  // hour 在 hour12:false 下午夜可能是 "24",归一到 0
  const hour = parseInt(p.hour, 10) % 24;
  return {
    year: parseInt(p.year, 10),
    month: parseInt(p.month, 10),
    day: parseInt(p.day, 10),
    hour,
    minute: parseInt(p.minute, 10),
    dow: DOW[p.weekday] ?? 0,
  };
}

export function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

export function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return parts;
}

const MINUTE = 60_000;
/** 扫描上限:4 年。覆盖到「2 月 29 日且是某个星期几」这类最稀疏的合法表达式。 */
const MAX_DAYS = 1461;

/**
 * 下一个匹配时刻(UTC Date),按 tz 的墙上时间求值;4 年内无匹配返回 null。
 *
 * 实现要点:**先按天粗筛,再扫这一天的分钟**。逐分钟从头扫 4 年是 210 万次 Intl 调用,
 * 会把 tick 卡住;按天筛之后最多 1461 次 + 命中那天的 1440 次。
 *
 * DST:不做特殊处理 —— 直接问 tz「这一刻的墙上时间是几点」,答案天然正确。
 * 代价是春季跳过的那一小时里的任务当天不触发(墙上时间根本不存在),
 * 秋季重复的那一小时可能匹配到两次 —— 但 nextRunAt 只取第一个,不会重复触发。
 */
export function getNextCronTime(expr, tz, from = new Date()) {
  const parts = parseCron(expr);
  if (!parts || !isValidTimezone(tz)) return null;
  const [min, hour, dom, mon, dow] = parts;

  // 从下一分钟开始(对齐到整分),避免把「此刻」算成下一次
  let cur = new Date(Math.floor(from.getTime() / MINUTE) * MINUTE + MINUTE);

  for (let day = 0; day <= MAX_DAYS; day++) {
    const p = tzParts(cur, tz);
    if (!matchField(p.day, dom) || !matchField(p.month, mon) || !matchField(p.dow, dow)) {
      // 这一天整天都不可能匹配 → 跳到该 tz 下的次日 00:00
      cur = new Date(cur.getTime() + (1440 - (p.hour * 60 + p.minute)) * MINUTE);
      continue;
    }
    // 日期匹配,扫这一天剩余的分钟
    let probe = cur;
    for (let i = p.hour * 60 + p.minute; i < 1440; i++) {
      const q = tzParts(probe, tz);
      // 跨过午夜说明这一天扫完了(DST 会让分钟数与偏移不完全对齐,以实际墙上时间为准)
      if (q.day !== p.day) break;
      if (matchField(q.minute, min) && matchField(q.hour, hour)) return probe;
      probe = new Date(probe.getTime() + MINUTE);
    }
    cur = probe;  // 从跨天的那一刻继续
  }
  return null;
}

/**
 * 确定性抖动(stagger):同一个 routine 每次偏移固定,不同 routine 互相错开。
 * 目的是削掉「整点一起触发」的尖峰 —— 与 Claude Routines 的 stagger 同思路。
 * 上限 5 分钟:再大用户会觉得「说好 9 点怎么 9 点半才跑」。
 */
export function getJitterMs(routineId, maxMs = 5 * MINUTE) {
  const hex = String(routineId || '').slice(0, 8).padEnd(8, '0');
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return 0;
  return Math.floor((n / 0xffffffff) * maxMs);
}

/**
 * 校验最小间隔(D6:30 分钟)。取未来连续触发算真实间隔 —— 比解析表达式语义可靠得多,
 * 也自动覆盖「每 5 分钟」那种 step 写法。只有一次触发(如每年一次)视为通过。
 * 扫连续 6 个间隔而不是只看第一个:像 `0,45 * * * *` 这种不规则列表,45 分钟与
 * 15 分钟的间隔交替出现,只看第一个会因创建时刻不同而漏判。
 */
export function violatesMinInterval(expr, tz, minMs, from = new Date()) {
  let a = getNextCronTime(expr, tz, from);
  if (!a) return { violates: false, reason: 'no_match' };
  let minGap = Infinity;
  for (let i = 0; i < 6; i++) {
    const b = getNextCronTime(expr, tz, a);
    if (!b) break;
    const gap = b.getTime() - a.getTime();
    if (gap < minGap) minGap = gap;
    if (minGap < minMs) return { violates: true, gapMs: minGap };
    a = b;
  }
  if (minGap === Infinity) return { violates: false, reason: 'single' };
  return { violates: false, gapMs: minGap };
}

export const _internals = { matchField, MAX_DAYS, MINUTE };

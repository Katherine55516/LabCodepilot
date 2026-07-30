/**
 * 测试用量上报编排（全部在主进程）。
 *
 * 触发源（4 类，均汇入去抖入口 scheduleTestUsageUpload）：
 *   1. 登录成功 / App 启动        —— main 的 bootAccountState / postLoginSequence
 *   2. 每日 10:00 / 16:00 / 20:00 —— 本模块的定时器（北京时间）
 *   3. 打开测试模块              —— renderer → IPC 'auth:upload-test-usage'
 *
 * 一次上报：判定登录 → 选天数区间 [min(watermark, 昨天) .. 今天] → loopback 让
 * 内嵌 Next 按北京自然日重算 → 附 device_id/app_version/tz 后 POST →
 * 2xx 推进水位，失败保留水位下次重试。全程 fire-and-forget，绝不阻塞。
 *
 * 幂等由服务端 GREATEST upsert 保证：重复触发/回补/重试都不会重复计数，
 * 也压不低已上报的历史高水位（客户端删本地也不丢服务端数据）。
 */

import * as os from 'os';
import { app } from 'electron';

import { uploadTestUsage } from './client';
import { fetchDailyRollupFromServer } from './broker';
import { loadToken, getOrCreateDeviceId, loadTestUsageWatermark, saveTestUsageWatermark } from './storage';
import { AuthExpiredError, HttpError, NetworkError } from './types';
import { logInfo, logWarn } from './log';

const TZ = 'Asia/Shanghai';
const TZ_OFFSET_MIN = 480; // 北京 UTC+8

const DAILY_HOURS = [10, 16, 20]; // 北京时间的定时上报点

const DEBOUNCE_MS = 60_000; // 60s 内多次触发合并为一次
const MIN_INTERVAL_MS = 5 * 60_000; // 两次成功上报间的最小间隔（省流量；GREATEST 让漏掉也无害）
const BACKFILL_MIN_DAYS = 2; // 每次至少回补到「昨天」，补齐上一日 20:00 之后的活动
const MAX_BACKFILL_DAYS = 90; // 长期离线后的回补上限（避免超大 payload）

let debounceTimer: NodeJS.Timeout | null = null;
let dailyTimers: NodeJS.Timeout[] = [];
let lastSuccessAt = 0;
let inFlight = false;

/** 给定 epoch 毫秒的北京自然日 'YYYY-MM-DD'。 */
function beijingDate(ms: number): string {
  return new Date(ms + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 加减天数。 */
function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 距下一个北京 10/16/20 点的毫秒数（中国无 DST，固定 +8）。 */
function msUntilNextDaily(nowMs: number): number {
  const b = new Date(nowMs + TZ_OFFSET_MIN * 60_000);
  const bY = b.getUTCFullYear();
  const bM = b.getUTCMonth();
  const bD = b.getUTCDate();
  let best = Infinity;
  for (const h of DAILY_HOURS) {
    for (const dayOffset of [0, 1]) {
      // 北京墙钟 (bY,bM,bD+offset,h:00) 对应的真实 epoch = 该墙钟按 UTC 计 - 8h
      const targetReal = Date.UTC(bY, bM, bD + dayOffset, h, 0, 0) - TZ_OFFSET_MIN * 60_000;
      const delay = targetReal - nowMs;
      if (delay > 1_000 && delay < best) best = delay;
    }
  }
  return best === Infinity ? 24 * 3_600_000 : best;
}

async function runUpload(reason: string): Promise<void> {
  if (inFlight) return;
  // 仅登录（managed）态上报；本地 dev / BYOK 无 token → 静默跳过。
  if (!loadToken()) return;

  inFlight = true;
  try {
    const nowMs = Date.now();
    const today = beijingDate(nowMs);
    const watermark = loadTestUsageWatermark();

    // 区间：从水位（无则近 BACKFILL_MIN_DAYS 天）到今天，且至少回补到昨天，最多回补 MAX_BACKFILL_DAYS 天。
    const minFrom = addDays(today, -(BACKFILL_MIN_DAYS - 1));
    const capFrom = addDays(today, -(MAX_BACKFILL_DAYS - 1));
    let from = watermark ?? minFrom;
    if (from > minFrom) from = minFrom;
    if (from < capFrom) {
      logWarn(`test-usage: backfill capped at ${MAX_BACKFILL_DAYS}d (watermark=${watermark})`);
      from = capFrom;
    }

    const rollup = await fetchDailyRollupFromServer(from, today);
    const days = rollup.days ?? [];

    if (days.length > 0) {
      await uploadTestUsage({
        device_id: getOrCreateDeviceId(),
        device_name: `${os.hostname()} (CMWork)`,
        app_version: app.getVersion(),
        tz: TZ,
        days,
      });
    }
    // 无论有无数据都推进水位到今天（无数据说明这些天确无用量，无需再扫）。
    saveTestUsageWatermark(today);
    lastSuccessAt = Date.now();
    logInfo(`test-usage uploaded (${reason}): ${days.length} day(s), ${from}..${today}`);
  } catch (e) {
    // 失败不推进水位 → 下次任一触发自动重试。
    if (e instanceof AuthExpiredError) logInfo('test-usage upload skipped: auth expired');
    else if (e instanceof NetworkError) logInfo('test-usage upload deferred: offline');
    else if (e instanceof HttpError) logWarn('test-usage upload failed:', e.message);
    else logWarn('test-usage upload error:', (e as Error).message);
  } finally {
    inFlight = false;
  }
}

/**
 * 去抖 + 最小间隔的上报入口。任何触发源都调它，可安全重复调用。
 * 60s 内的多次触发合并为一次；距上次成功不足 MIN_INTERVAL 则跳过本次。
 */
export function scheduleTestUsageUpload(reason: string): void {
  if (debounceTimer) return; // 已有一次待执行，合并
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (lastSuccessAt && Date.now() - lastSuccessAt < MIN_INTERVAL_MS) return;
    void runUpload(reason);
  }, DEBOUNCE_MS);
}

function scheduleNextDaily(): void {
  const t = setTimeout(() => {
    scheduleTestUsageUpload('daily');
    scheduleNextDaily();
  }, msUntilNextDaily(Date.now()));
  dailyTimers.push(t);
}

/** 启动每日 10/16/20（北京）定时上报。幂等，重复调用无副作用。 */
export function startTestUsageScheduler(): void {
  if (dailyTimers.length > 0) return;
  scheduleNextDaily();
  logInfo('test-usage daily scheduler started (10/16/20 Asia/Shanghai)');
}

/** 停止定时器（登出时调用）。 */
export function stopTestUsageScheduler(): void {
  for (const t of dailyTimers) clearTimeout(t);
  dailyTimers = [];
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

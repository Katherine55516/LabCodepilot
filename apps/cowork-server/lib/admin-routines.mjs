/**
 * 定时任务管理面（cowork-routines-admin P0）—— 仅 `__admin__` token 可达，
 * 接线在 index.mjs 的 /admin/ 分支。
 *
 * 能力边界 = 看 + 停 + 删（AD1）：不代建、不代改内容、不代跑 —— 改 prompt 等于
 * admin 替用户说话，立即运行花的是用户的日配额与真实模型费用，都需要用户本人意志。
 *
 * admin 动作写 admin_routine_* 审计，detail 以目标 uid 开头（🔴 G15：账号后端按
 * 「detail 以 uid 开头」解析归属，这些事件因此进入该用户的审计轨迹 —— UD3 透明制衡；
 * 写成别的开头不报错，只是归属静默丢失）。
 *
 * 数据源 = store 文件直读（AD2）：量级 ≤50/用户、毫秒级，不需要 stats 那样的快照层。
 */
import fs from 'node:fs';
import * as store from './routine-store.mjs';
import * as sched from './routine-scheduler.mjs';
import * as orch from './orchestrator.mjs';
import * as cred from './cred-proxy.mjs';
import { CONCURRENCY } from './routine-runner.mjs';
import { view } from './routine-api.mjs';
import { audit } from './audit.mjs';

const MAX_REASON = 200;

/**
 * getRoutine 对非法 uid/id 会 throw（store 的立场：内部调用传坏参数=编程错误）。
 * 管理面的 uid 来自请求参数，坏参数是输入不是 bug —— 统一折叠成「不存在」，
 * 与用户面同一防枚举姿态（404，不区分「没有」和「参数不合法」）。
 */
function find(uid, id) {
  try { return store.getRoutine(uid, id); } catch { return null; }
}

/** 全量列表 + 全局元信息。今日运行/花费现算：量级 = 用户数 × 当日运行数，文件读毫秒级。 */
export function adminListRoutines() {
  const routines = store.listAllRoutines();
  const today = store.todayStartIso();
  const runsToday = { success: 0, failure: 0, skipped: 0 };
  let costTodayUsd = 0;
  for (const r of routines) {
    for (const run of store.listRuns(r.uid, r.id, { since: today, limit: 1000 })) {
      runsToday[run.status] = (runsToday[run.status] || 0) + 1;
      if (typeof run.costUsd === 'number') costTodayUsd += run.costUsd;
    }
  }
  return {
    routines: routines.map((r) => ({ ...view(r), uid: r.uid })),
    meta: {
      dailyCap: store.DAILY_RUN_CAP,
      maxPerUid: store.MAX_ROUTINES_PER_UID,
      minIntervalMs: store.MIN_INTERVAL_MS,
      concurrency: CONCURRENCY,
      runsToday,
      // 已删除 routine 的历史随定义一起删（用户侧 DELETE 语义），不在此数内 —— 管理页脚注说明
      costTodayUsd: Math.round(costTodayUsd * 1e4) / 1e4,
    },
  };
}

/** 运行历史（透传 store 语义：since 增量、倒序、limit 截断）。null = 打不中（调用方 404）。 */
export function adminListRuns(uid, id, { since = '', limit = 200 } = {}) {
  if (!find(uid, id)) return null;
  return store.listRuns(uid, id, { since, limit });
}

/**
 * 停用 / 恢复（AD3/AD4：停用写 disabledReason 用户侧可见；不做硬锁，用户可自行恢复）。
 * 🔴 恢复时必须清失败计数与原因（routine-api update 同款）—— 不清的话一恢复就再撞
 * D11 的连续失败自动停用阈值，表现为「怎么启用都立刻变回停用」。
 * 恢复的 nextRunAt 走 computeNextRun：过期一次性/manual 得 null，不会补跑，无花钱风险。
 */
export function adminSetEnabled(uid, id, enabled, reason = '') {
  const r = find(uid, id);
  if (!r) return null;
  const clipped = String(reason || '').trim().slice(0, MAX_REASON);
  if (enabled) {
    r.enabled = true;
    r.consecutiveErrors = 0;
    r.disabledReason = '';
  } else {
    r.enabled = false;
    // 客户端详情页原样展示这个字段 —— 用户看到的就是这句，没填原因也要标明是管理员动作
    r.disabledReason = clipped ? `管理员停用：${clipped}` : '管理员停用';
  }
  r.nextRunAt = r.enabled ? sched.computeNextRun(r) : null;
  r.updatedAt = new Date().toISOString();
  store.saveRoutine(r);
  // enable 复用同一事件名，detail 第二段区分（AD5）；detail 必须以 uid 开头（G15）
  audit('admin_routine_disable', {
    sessionId: id,
    detail: `${uid} ${enabled ? 'enable' : 'disable'}${clipped ? ` ${clipped}` : ''}`,
  });
  return { ...view(r), uid: r.uid };
}

/**
 * 删除（AD8 三方联动，与用户侧 DELETE 同一条清理链）：定义与历史（store）+
 * 容器与卷（orchestrator，routine 卷是持久卷，漏了就是泄漏）+ 凭证（cred-proxy）。
 * 未跑过的 routine 没有容器/卷，removeContainer 对不存在的目标本就容忍（用户侧同路径）。
 */
export async function adminDeleteRoutine(uid, id) {
  if (!find(uid, id)) return false;
  store.deleteRoutine(uid, id);
  await orch.removeContainer(id, { keepVolume: false });
  await cred.revokeCredentials(id);
  audit('admin_routine_delete', { sessionId: id, detail: uid });
  return true;
}

/**
 * transcript 原文（AD6：只下载不回放）。runId 全局唯一、文件不分 uid，管理侧
 * 无需 owner 反查（用户面那步是防跨用户枚举，admin 跨用户是本职）。
 * null = 无此文件（credential_error 等在容器起来前就失败的运行本来就没有 transcript）。
 */
export function adminTranscript(runId) {
  const file = store.transcriptFile(runId);
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  return { size: stat.size, stream: fs.createReadStream(file) };
}

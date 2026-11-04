/**
 * 额度用量纯函数 —— 把服务器下发的 renewal/remaining/used 算成已用百分比。
 *
 * 接口语义见 文档/usage-api.md：quota=总额度(=国内+国外)、quota_cn 国内、
 * quota_intl 国外；每项 used = renewal - remaining。quota_per_unit(500000=$1)
 * 本期不用于展示(只显示百分比)。
 *
 * 类型与 electron/auth/types.ts / src/types/electron.d.ts 的 Usage* 结构镜像
 * (结构类型兼容,不跨 electron/<->src 边界互引)。
 */

export interface UsageQuota {
  /** 本期总额度(周期重置时填充) */
  renewal: number;
  /** 当前剩余 */
  remaining: number;
  /** 本期已用 = renewal - remaining */
  used: number;
}

export interface UsageInfo {
  username: string;
  /** 总额度(= 国内 + 国外) */
  quota: UsageQuota;
  /** 国内分项 */
  quota_cn: UsageQuota;
  /** 国外分项 */
  quota_intl: UsageQuota;
  /** 额度→货币换算单位,500000 = $1(本期不展示货币) */
  quota_per_unit: number;
}

export type UsageLevel = 'normal' | 'warning' | 'danger';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 已用百分比(0-100 整数)。renewal<=0 / 无效(无额度)→ 0。
 * 优先用服务器 used;缺失/非数时用 renewal-remaining 兜底。
 */
export function usedPercent(q: UsageQuota | null | undefined): number {
  if (!q || !Number.isFinite(q.renewal) || q.renewal <= 0) return 0;
  const used = Number.isFinite(q.used) ? q.used : q.renewal - q.remaining;
  return clamp(Math.round((used / q.renewal) * 100), 0, 100);
}

/** 已用比例分档,用于进度条配色(normal/warning/danger)。 */
export function levelOf(percent: number): UsageLevel {
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warning';
  return 'normal';
}

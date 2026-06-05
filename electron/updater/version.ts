/**
 * Lightweight dotted-version comparison (pure, unit-tested).
 *
 * V2 的"是否有更新"由服务端 has_update（字符串精确比较）决定；这里只用于客户端
 * 的两处防御：① pending 跨会话复用时要求"记录版本 > 当前版本"（防降级/防重装旧
 * 版）；② 网络异常离线兜底时判断缓存包是否仍比当前版本新。
 *
 * 不是完整 semver（不处理 prerelease/build 元数据），仅做点分数字段比较，够用。
 */

/** Parse "v1.5.10" → [1,5,10]; non-numeric segments become 0. */
export function parseVersion(v: string): number[] {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((s) => {
      const n = parseInt(s, 10);
      return Number.isNaN(n) ? 0 : n;
    });
}

/** Compare two versions: 1 if a>b, -1 if a<b, 0 if equal (segment-wise numeric). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** True when `candidate` is strictly newer than `base`. */
export function isNewerVersion(candidate: string, base: string): boolean {
  return compareVersions(candidate, base) > 0;
}

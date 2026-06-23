/**
 * mcp-denylist.ts — 已知恶意 / 漏洞 MCP 黑名单（纵深防御第①层，唯一高置信「不安全」判定）。
 *
 * 这一版内置静态种子（随应用版本更新），架构预留远程合并——后续可由登录后端下发可更新
 * 列表（呼应「自托管、不向美国站点发数据」，并弥补官方 Registry 只做人工下架、止血慢）。
 *
 * 匹配维度：registryType(可选) + identifier(精确) + versionRange(可选)。
 * 版本比较自带极简实现，不依赖 semver（它只是间接依赖，直接 import 不稳妥）。
 *
 * 文档：docs/exec-plans/active/mcp-marketplace.md
 */

import type { McpDenylistEntry } from '@/types';
import type { McpPackage } from '@/lib/server-json-mapper';

// 只用 package 的这几个字段。
type Pkg = Pick<McpPackage, 'registryType' | 'identifier' | 'version'>;

// ── 种子黑名单 ───────────────────────────────────────────────────────
// 仅收录有公开披露的真实事件 / CVE。新增需附 ref。

export const SEED_DENYLIST: McpDenylistEntry[] = [
  {
    registryType: 'npm',
    identifier: 'postmark-mcp',
    versionRange: '>=1.0.16',
    reason: 'v1.0.16 起植入后门，BCC 外带全部邮件（供应链 rug-pull）。',
    ref: 'https://www.koi.ai/blog/postmark-mcp-npm-malicious-backdoor-email-theft',
  },
  {
    registryType: 'npm',
    identifier: 'mcp-remote',
    versionRange: '<0.1.16',
    reason: 'CVE-2025-6514：远程 MCP 连接触发 RCE（CVSS 9.6）。如使用请升级到已修复版本。',
    ref: 'https://nvd.nist.gov/vuln/detail/CVE-2025-6514',
  },
];

// ── 极简版本比较 ─────────────────────────────────────────────────────

function parseVersion(v: string): number[] {
  // 去掉前缀 v、预发布后缀；非法段记 0
  const core = v.replace(/^[vV]/, '').split(/[-+]/)[0];
  return core.split('.').map((n) => {
    const x = parseInt(n, 10);
    return Number.isFinite(x) ? x : 0;
  });
}

/** 比较 a 与 b：a<b → -1，a==b → 0，a>b → 1。 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/**
 * version 是否落在 range 内。range 支持 `>=x` `<=x` `>x` `<x` `=x` 或裸 `x`（精确）。
 * range 省略（undefined）→ 任意版本都算命中。version 缺失/latest → 保守视为命中（无法排除）。
 */
export function versionInRange(version: string | undefined, range?: string): boolean {
  if (!range) return true;
  if (!version || version === 'latest') return true; // 无法确证不在区间 → 保守命中
  const m = range.trim().match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!m) return false;
  const op = m[1] || '=';
  const cmp = compareVersions(version, m[2].trim());
  switch (op) {
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>': return cmp > 0;
    case '<': return cmp < 0;
    default: return cmp === 0;
  }
}

/** 该 package 是否命中黑名单；命中返回条目，否则 null。 */
export function matchDenylist(pkg: Pkg, denylist: McpDenylistEntry[] = SEED_DENYLIST): McpDenylistEntry | null {
  const id = (pkg.identifier || '').toLowerCase();
  if (!id) return null;
  // OCI identifier 含 registry/repo:tag，取 repo 部分比对（去掉 tag）
  const bareId = id.split('@')[0].split(':')[0];
  for (const entry of denylist) {
    if (entry.registryType && pkg.registryType && entry.registryType !== pkg.registryType) continue;
    const target = entry.identifier.toLowerCase();
    if (bareId !== target && id !== target) continue;
    if (versionInRange(pkg.version, entry.versionRange)) return entry;
  }
  return null;
}

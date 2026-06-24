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
  // ── 恶意包（攻击者创建 / 植入后门，全/区间封禁）─────────────────────
  {
    registryType: 'npm',
    identifier: 'postmark-mcp',
    versionRange: '>=1.0.16',
    reason: 'CVSS N/A：冒充 Postmark 的恶意包，v1.0.16 起后门 BCC 外带全部邮件（业界公认首个在野恶意 MCP server）。',
    ref: 'https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/',
  },

  // ── 高危漏洞·无修复版本（latest 本身仍受影响，价值最高）────────────
  {
    registryType: 'npm',
    identifier: 'adb-mcp',
    versionRange: '<=0.1.0',
    reason: 'CVE-2025-59834（CVSS 9.8，暂无修复）：inspect_ui 工具 exec 命令注入 → RCE。',
    ref: 'https://github.com/advisories/GHSA-54j7-grvr-9xwg',
  },
  {
    registryType: 'npm',
    identifier: '@sunwood-ai-labs/github-kanban-mcp-server',
    versionRange: '<=0.3.0',
    reason: 'CVE-2025-53818（CVSS 8.9，暂无修复）：add_comment 工具 exec 命令注入。',
    ref: 'https://github.com/advisories/GHSA-6jx8-rcjx-vmwf',
  },

  // ── 高危漏洞·已修复（市场装 latest 已安全；此处防手动钉旧版）────────
  {
    registryType: 'npm',
    identifier: 'mcp-remote',
    versionRange: '<0.1.16',
    reason: 'CVE-2025-6514（CVSS 9.6）：连接不受信远程 server 时命令注入 → RCE。升级到 0.1.16+。',
    ref: 'https://github.com/advisories/GHSA-6xpm-ggf7-wc3p',
  },
  {
    registryType: 'npm',
    identifier: 'flowise',
    versionRange: '<3.1.0',
    reason: 'CVE-2026-40933（CVSS 9.9）：MCP adapter stdio 命令反序列化不安全 → 认证后 RCE。升级到 3.1.0+。',
    ref: 'https://nvd.nist.gov/vuln/detail/CVE-2026-40933',
  },
  {
    registryType: 'npm',
    identifier: 'flowise-components',
    versionRange: '<3.1.0',
    reason: 'CVE-2026-40933（CVSS 9.9）：随 flowise 同修复。升级到 3.1.0+。',
    ref: 'https://nvd.nist.gov/vuln/detail/CVE-2026-40933',
  },
  {
    registryType: 'npm',
    identifier: '@akoskm/create-mcp-server-stdio',
    versionRange: '<0.0.13',
    reason: 'CVE-2025-54994（CVSS 9.3）：which-app-on-port 工具 exec 命令注入。升级到 0.0.13+。',
    ref: 'https://github.com/advisories/GHSA-3ch2-jxxc-v4xf',
  },
  {
    registryType: 'pypi',
    identifier: 'mcp-server-git',
    versionRange: '<2025.12.18',
    reason: 'CVE-2025-68143/68144/68145（最高 CVSS 8.8）：git_init 路径穿越 + git_diff/checkout 参数注入。升级到 2025.12.18+。',
    ref: 'https://github.com/advisories/GHSA-j22h-9j4x-23w5',
  },
  {
    registryType: 'npm',
    identifier: 'figma-developer-mcp',
    versionRange: '<0.6.3',
    reason: 'CVE-2025-53967（CVSS 7.5）：get_figma_data 工具 exec 命令注入 → RCE。升级到 0.6.3+。注意：非 Figma 官方 @figma/mcp。',
    ref: 'https://github.com/advisories/GHSA-gxw4-4fc5-9gr5',
  },
  {
    registryType: 'npm',
    identifier: 'mcp-server-kubernetes',
    versionRange: '<2.5.0',
    reason: 'CVE-2025-53355（CVSS 7.5）：kubectl_scale/patch 等 execSync 命令注入 → RCE。升级到 2.5.0+。',
    ref: 'https://github.com/advisories/GHSA-gjv4-ghm7-q58q',
  },
  {
    registryType: 'npm',
    identifier: '@cyanheads/git-mcp-server',
    versionRange: '<2.1.5',
    reason: 'CVE-2025-53107（CVSS 7.5）：多个 git 工具 exec 命令注入 → RCE。升级到 2.1.5+。',
    ref: 'https://github.com/advisories/GHSA-3q26-f695-pp76',
  },
  {
    registryType: 'npm',
    identifier: 'node-code-sandbox-mcp',
    versionRange: '<1.3.0',
    reason: 'CVE-2025-53372（CVSS 7.5）：execSync 命令注入逃逸 Docker 沙箱 → 宿主 RCE。升级到 1.3.0+。',
    ref: 'https://github.com/advisories/GHSA-5w57-2ccq-8w95',
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
  // 去掉可能的 @version 后缀（按最后一个 @，避免截断 @scope/name 的作用域前缀）
  // 与 OCI 的 registry/repo:tag（去 tag）。server.json 的 identifier 一般不带版本，
  // 但带了也要稳。
  const atIdx = id.lastIndexOf('@');
  const noVersion = atIdx > 0 ? id.slice(0, atIdx) : id;
  const bareId = noVersion.split(':')[0];
  for (const entry of denylist) {
    if (entry.registryType && pkg.registryType && entry.registryType !== pkg.registryType) continue;
    const target = entry.identifier.toLowerCase();
    if (bareId !== target && id !== target) continue;
    if (versionInRange(pkg.version, entry.versionRange)) return entry;
  }
  return null;
}

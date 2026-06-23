/**
 * mcp-trust.ts — MCP 纵深信任评估（Phase 2 安全加固）。
 *
 * 核心立场：**不产出 isSafe 布尔**。stdio MCP = 任意代码执行，无可靠静态分析能证明无害。
 * 这里产出的是「可验证来源事实(tier+signals) + 启发式风险提示(risks) + 已知恶意硬拦(blocked)
 * + 摩擦力建议(friction)」，最终由人在确认屏障上拍板。
 *
 * 纯函数、无副作用、可单测。被 search/detail 路由调用，结果灌进 DTO 给 UI 渲染。
 *
 * 局限（务必如实呈现）：命令扫描只挡显眼/懒的坏，挡不住有心人（包一旦运行想干啥干啥）；
 * verified ≠ safe（合法已验证发布者也可能后来变坏）；唯一真隔离是沙箱。
 *
 * 文档：docs/exec-plans/active/mcp-marketplace.md
 */

import type { ServerJson, McpPackage } from '@/lib/server-json-mapper';
import { mapServer } from '@/lib/server-json-mapper';
import { matchDenylist, SEED_DENYLIST } from '@/lib/mcp-denylist';
import type { McpTrustAssessment, McpRiskFlag, McpTrustTier, McpDenylistEntry, MCPServerConfig } from '@/types';

/**
 * 官方目录已审白名单（Anthropic Connectors 目录无 API → 手维护，随版本更新）。
 * 留空亦可：默认所有官方 Registry 条目落 namespace-verified。
 */
const OFFICIAL_ALLOWLIST = new Set<string>([]);

const SHELL_BINS = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);

function isGithubNamespace(name: string): boolean {
  return /^io\.github\./i.test(name);
}

/** 扫描已映射的 command/args/env，产出风险提示。纯启发式。 */
export function scanConfigRisks(config: MCPServerConfig | null): McpRiskFlag[] {
  if (!config) return [];
  const risks: McpRiskFlag[] = [];
  const command = (config.command || '').trim();
  const args = config.args || [];
  const joined = [command, ...args].join(' ');
  const lower = joined.toLowerCase();

  // shell-exec：直接跑 shell（而非 npx/uvx/docker 等包运行器）
  const base = command.split('/').pop() || command;
  if (SHELL_BINS.has(base)) {
    risks.push({ code: 'shell-exec', detail: `直接执行 shell：${command}`, severity: 'high' });
  }

  // dangerous-command
  if (/\bsudo\b/.test(lower)) risks.push({ code: 'dangerous-command', detail: 'sudo 提权', severity: 'high' });
  if (/\brm\s+-[a-z]*r/.test(lower)) risks.push({ code: 'dangerous-command', detail: 'rm 递归删除', severity: 'high' });
  if (/chmod\s+\+x/.test(lower)) risks.push({ code: 'dangerous-command', detail: 'chmod +x', severity: 'high' });
  if (/\bmkfs\b|\bdd\s+if=/.test(lower)) risks.push({ code: 'dangerous-command', detail: '磁盘级操作 (mkfs/dd)', severity: 'high' });

  // network-fetch-exec：下载后管道入 shell
  if (/(curl|wget)\b/.test(lower) && /\|\s*(sh|bash|zsh)\b/.test(lower)) {
    risks.push({ code: 'network-fetch-exec', detail: '下载脚本并直接执行 (curl|wget … | sh)', severity: 'high' });
  }

  // sensitive-path
  const sensitive = ['.ssh', '.aws', 'id_rsa', '/etc/'];
  for (const s of sensitive) {
    if (lower.includes(s)) { risks.push({ code: 'sensitive-path', detail: `引用敏感路径：${s}`, severity: 'warn' }); break; }
  }

  // secret-injected：把密钥交给第三方代码（信息性）
  const env = config.env || {};
  const headers = config.headers || {};
  const hasSecret = Object.values(env).some((v) => typeof v === 'string' && v.startsWith('${mcp_secret_'))
    || Object.values(headers).some((v) => typeof v === 'string' && v.startsWith('${mcp_secret_'));
  if (hasSecret) risks.push({ code: 'secret-injected', detail: '需向该服务器提供密钥/令牌', severity: 'warn' });

  return risks;
}

/** 结构性风险（来自 server.json 元数据，而非命令）。 */
function scanStructuralRisks(server: ServerJson): McpRiskFlag[] {
  const risks: McpRiskFlag[] = [];
  const pkg: McpPackage | undefined = (server.packages || [])[0];
  if (pkg) {
    const v = pkg.version;
    if (!v || v === 'latest') {
      risks.push({ code: 'unpinned-version', detail: '未钉版本（latest/缺失），可静默变更', severity: 'warn' });
    }
  }
  if (!server.repository?.url) {
    risks.push({ code: 'no-repository', detail: '无公开源码仓库', severity: 'warn' });
  }
  return risks;
}

/**
 * 评估一个 MCP。返回 tier + signals + risks + blocked + friction（无 isSafe）。
 * @param server  完整 server.json
 * @param denylist 黑名单（默认种子，预留远程合并）
 */
export function assessMcp(server: ServerJson, denylist: McpDenylistEntry[] = SEED_DENYLIST): McpTrustAssessment {
  const packages = server.packages || [];

  // ① 黑名单硬拦
  let blocked = false;
  let blockReason: string | undefined;
  for (const pkg of packages) {
    const hit = matchDenylist(pkg, denylist);
    if (hit) { blocked = true; blockReason = hit.reason; break; }
  }

  // ② tier
  let tier: McpTrustTier;
  if (OFFICIAL_ALLOWLIST.has(server.name)) tier = 'official-reviewed';
  else if (server.name.includes('/')) tier = 'namespace-verified'; // 官方 Registry 默认满足
  else tier = 'community';

  // signals
  const signals: string[] = [];
  signals.push(isGithubNamespace(server.name) ? 'github-verified' : 'domain-verified');
  if (server.repository?.url) signals.push('has-repo');
  const firstPkg = packages[0];
  if (firstPkg && firstPkg.version && firstPkg.version !== 'latest') signals.push('version-pinned');
  if (packages.some((p) => p.registryType === 'oci')) signals.push('oci-container');

  // ③ 风险扫描（命令 + 结构）
  const config = mapServer(server).config;
  const risks = [...scanConfigRisks(config), ...scanStructuralRisks(server)];

  // ④ friction
  const friction: McpTrustAssessment['friction'] = blocked
    ? 'blocked'
    : risks.some((r) => r.severity === 'high')
      ? 'extra-confirm'
      : 'normal';

  return { tier, signals, risks, blocked, blockReason, friction };
}

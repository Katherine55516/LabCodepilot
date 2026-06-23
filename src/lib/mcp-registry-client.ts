/**
 * mcp-registry-client.ts — 官方 MCP Registry 读取客户端。
 *
 * 数据源：`https://registry.modelcontextprotocol.io`（公开、免登录、返回标准 server.json）。
 * 该接口无 CORS 头，故只能在服务端（Next.js /api 路由）调用，不能在渲染进程直连。
 *
 * 职责：拉取/搜索/分页 → `isLatest` 去重 → 归一化成 MarketplaceMcpServer DTO；
 * 以及拉单个 server 的完整 server.json（详情/安装表单用）。
 *
 * 文档：docs/exec-plans/active/mcp-marketplace.md
 */

import type { MarketplaceMcpServer } from '@/types';
import type { ServerJson } from '@/lib/server-json-mapper';
import { assessMcp } from '@/lib/mcp-trust';

const OFFICIAL_BASE = 'https://registry.modelcontextprotocol.io';
const OFFICIAL_META_KEY = 'io.modelcontextprotocol.registry/official';
// 调大超时：HK 网络下官方 registry 偶发慢响应（叠加 dev 首次路由编译），
// 10s 会误报失败。生产侧 registry 更快，20s 留足容差。
const FETCH_TIMEOUT_MS = 20_000;

interface RawListItem {
  server: ServerJson;
  _meta?: Record<string, { status?: string; isLatest?: boolean; publishedAt?: string; updatedAt?: string }>;
}

interface RawListResponse {
  servers?: RawListItem[];
  metadata?: { nextCursor?: string; count?: number };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AINativeLab-MCP-Marketplace/0.1', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Registry API ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** name 的命名空间 + 验证类型。`io.github.*` = GitHub 验证；其余 = 反向域名验证。 */
function namespaceOf(name: string): { namespace: string; namespaceKind: 'github' | 'domain' } {
  const namespace = name.includes('/') ? name.slice(0, name.indexOf('/')) : name;
  const namespaceKind = /^io\.github\./i.test(name) ? 'github' : 'domain';
  return { namespace, namespaceKind };
}

/** 单条 registry 条目 → DTO。 */
export function toMarketplaceDto(item: RawListItem): MarketplaceMcpServer {
  const s = item.server;
  const meta = item._meta?.[OFFICIAL_META_KEY] || {};
  const { namespace, namespaceKind } = namespaceOf(s.name);
  const packages = s.packages || [];
  const remotes = s.remotes || [];
  return {
    name: s.name,
    title: s.title,
    description: s.description,
    version: s.version,
    namespace,
    namespaceKind,
    hasPackages: packages.length > 0,
    hasRemotes: remotes.length > 0,
    registryTypes: [...new Set(packages.map((p) => p.registryType).filter(Boolean) as string[])],
    remoteTypes: [...new Set(remotes.map((r) => r.type).filter(Boolean) as string[])],
    repositoryUrl: s.repository?.url,
    status: meta.status,
    source: 'official',
    trust: assessMcp(s),
  };
}

/**
 * 按 name 去重，保留 isLatest（无 isLatest 标记时保留首个出现）。
 * registry 的 list 把每个版本作为独立行返回，必须折叠。
 */
export function dedupeLatest(items: RawListItem[]): RawListItem[] {
  const byName = new Map<string, RawListItem>();
  for (const item of items) {
    const name = item.server?.name;
    if (!name) continue;
    const isLatest = item._meta?.[OFFICIAL_META_KEY]?.isLatest;
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, item);
    } else if (isLatest) {
      byName.set(name, item); // latest 覆盖
    }
  }
  return [...byName.values()];
}

export interface SearchResult {
  servers: MarketplaceMcpServer[];
  nextCursor?: string;
}

/**
 * 搜索官方 Registry。
 * @param q       名称子串过滤（registry 仅支持 name 子串）。
 * @param cursor  分页游标。
 * @param limit   每页条数（registry 上限 100）。
 */
export async function searchOfficialRegistry(opts: { q?: string; cursor?: string; limit?: number } = {}): Promise<SearchResult> {
  const url = new URL(`${OFFICIAL_BASE}/v0.1/servers`);
  if (opts.q) url.searchParams.set('search', opts.q);
  if (opts.cursor) url.searchParams.set('cursor', opts.cursor);
  url.searchParams.set('limit', String(Math.min(Math.max(opts.limit || 30, 1), 100)));

  const data = await fetchJson<RawListResponse>(url.toString());
  const items = dedupeLatest(data.servers || [])
    // 过滤已删除项；deprecated 仍展示（标灰由 UI 处理）
    .filter((it) => it._meta?.[OFFICIAL_META_KEY]?.status !== 'deleted');
  return {
    servers: items.map(toMarketplaceDto),
    nextCursor: data.metadata?.nextCursor,
  };
}

/**
 * 拉单个 server 的完整 server.json（最新版）。
 * serverName 需 URL 编码（含 `/`）。返回 null 表示未找到。
 */
export async function getOfficialServer(serverName: string): Promise<ServerJson | null> {
  const encoded = encodeURIComponent(serverName);
  try {
    const data = await fetchJson<RawListItem | { server: ServerJson }>(
      `${OFFICIAL_BASE}/v0.1/servers/${encoded}/versions/latest`,
    );
    // 单条接口返回 { server, _meta } 包裹
    const server = (data as RawListItem).server || (data as { server: ServerJson }).server;
    return server || null;
  } catch {
    return null;
  }
}

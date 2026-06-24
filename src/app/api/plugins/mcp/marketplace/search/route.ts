import { NextRequest, NextResponse } from 'next/server';
import { searchOfficialRegistry } from '@/lib/mcp-registry-client';
import { getInstalledInfo } from '@/lib/mcp-market-ledger';
import { compareVersions } from '@/lib/mcp-denylist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/plugins/mcp/marketplace/search?q=&cursor=&limit=
 *
 * 服务端代理官方 MCP Registry（解决其无 CORS 头），归一化为 MarketplaceMcpServer，
 * 并按安装台账 ∩ ~/.claude.json 现存标记 isInstalled。与 skills/marketplace/search 同构。
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q') || undefined;
    const cursor = request.nextUrl.searchParams.get('cursor') || undefined;
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 30;

    const { servers, nextCursor } = await searchOfficialRegistry({ q, cursor, limit });

    // 标记已安装（自愈：手动删除过的会从台账剔除）+ 版本变更复查
    const installed = getInstalledInfo();
    for (const s of servers) {
      const info = installed[s.name];
      if (info) {
        s.isInstalled = true;
        s.installedKey = info.key;
        s.installedVersion = info.version;
        // 注册中心 latest 比装时版本更新 → 提示更新前复查（rug-pull 防线）
        if (info.version && s.version && compareVersions(s.version, info.version) > 0) {
          s.updateAvailable = true;
        }
      }
    }

    return NextResponse.json({ servers, nextCursor });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Registry 请求超时' }, { status: 504 });
    }
    console.error('[mcp/marketplace/search] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '搜索失败' },
      { status: 502 },
    );
  }
}

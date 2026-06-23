import { NextRequest, NextResponse } from 'next/server';
import { getOfficialServer } from '@/lib/mcp-registry-client';
import { mapServer } from '@/lib/server-json-mapper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/plugins/mcp/marketplace/detail?name=<serverName>
 *
 * 用 query 参数传 serverName（而非路径段）——反向 DNS 名含 `/`，放路径段里
 * 编码后的 `%2F` 会被 Next.js 解码成真斜杠、拆成两段导致路由匹配失败(404)。
 * 返回完整 server.json（最新版）+ 默认映射预览配置 + 安装表单 spec。
 */
export async function GET(request: NextRequest) {
  try {
    const name = request.nextUrl.searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const server = await getOfficialServer(name);
    if (!server) {
      return NextResponse.json({ error: `未找到 server "${name}"` }, { status: 404 });
    }

    const mapped = mapServer(server);
    return NextResponse.json({
      server,
      mapped: {
        suggestedKey: mapped.suggestedKey,
        kind: mapped.kind,
        config: mapped.config,
        requiredInputs: mapped.requiredInputs,
        notes: mapped.notes,
      },
    });
  } catch (error) {
    console.error('[mcp/marketplace/detail] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取详情失败' },
      { status: 502 },
    );
  }
}

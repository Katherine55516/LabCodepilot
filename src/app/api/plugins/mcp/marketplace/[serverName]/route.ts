import { NextRequest, NextResponse } from 'next/server';
import { getOfficialServer } from '@/lib/mcp-registry-client';
import { mapServer } from '@/lib/server-json-mapper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/plugins/mcp/marketplace/[serverName]
 *
 * 拉单个 server 的完整 server.json（最新版），并返回默认映射的预览配置 +
 * 安装表单 spec（requiredInputs）。serverName 在 path 中需 URL 编码。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serverName: string }> },
) {
  try {
    const { serverName } = await params;
    const name = decodeURIComponent(serverName);

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

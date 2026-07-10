import { NextRequest } from 'next/server';
import { Readable } from 'stream';
import { getSession } from '@/lib/db';
import {
  assertPathInWorkspace,
  readFileStream,
  archiveStream,
  listNewFiles,
  vmChannelReady,
} from '@/lib/cowork-transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cowork 沙箱产物通道。
 *
 * GET ?sessionId=..&list=1           — 列出会话 workspace 全部文件(刷新后恢复产物卡片)
 * GET ?sessionId=..&path=<vmPath>    — 下载单个文件(流式)
 * GET ?sessionId=..&archive=1        — 打包下载整个 workspace(tar.gz 流式)
 *
 * 安全:会话必须存在且开着沙箱;vmPath 经 VM 内 realpath 校验必须落在该会话
 * workspace 内(cowork-transfer.assertPathInWorkspace,防 ../ 与符号链接逃逸)。
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId') || '';
  const vmPath = request.nextUrl.searchParams.get('path');
  const wantList = request.nextUrl.searchParams.get('list') === '1';
  const wantArchive = request.nextUrl.searchParams.get('archive') === '1';

  const session = getSession(sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.sandbox_enabled) {
    return Response.json({ error: 'Session is not a sandbox session' }, { status: 400 });
  }
  if (!(await vmChannelReady())) {
    return Response.json({ error: 'Sandbox VM is not running' }, { status: 503 });
  }

  try {
    if (wantList) {
      const files = await listNewFiles(sessionId, 0);
      return Response.json({ files });
    }

    if (wantArchive) {
      const { stream } = archiveStream(sessionId);
      return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="sandbox-${sessionId.slice(0, 8)}.tar.gz"`,
        },
      });
    }

    if (vmPath) {
      const real = await assertPathInWorkspace(sessionId, vmPath);
      const name = real.split('/').pop() || 'download';
      const { stream } = readFileStream(real);
      return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          // RFC 5987 filename* 承载非 ASCII 文件名(中文等)
          'Content-Disposition': `attachment; filename="${encodeURIComponent(name).replace(/%/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    }

    return Response.json({ error: 'path, list=1 or archive=1 is required' }, { status: 400 });
  } catch (error) {
    // Never echo raw errors to the client — SSH command lines embed the VM IP
    // and key path. Details go to the server log only.
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[cowork-artifacts] denied/failed:', message.slice(0, 300));
    if (/escapes|invalid/.test(message)) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }
    if (/No such file|realpath/.test(message)) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    return Response.json({ error: 'Artifact access failed' }, { status: 500 });
  }
}

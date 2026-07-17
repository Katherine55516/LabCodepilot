import { NextRequest } from 'next/server';
import { Readable } from 'stream';
import { getSession } from '@/lib/db';
import {
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

  try {
    if (wantList) {
      // List reads from the DB first — always available, even while the VM is
      // asleep (the VM is only needed to download file contents). Sessions
      // predating persistence (empty DB list) migrate lazily; and when the VM
      // IS online, reconcile deletions (E4.2): drop entries whose files no
      // longer exist in the workspace (agent rm'd them mid-turn, or they were
      // cleaned while the list was stale) and persist the pruned list.
      const { getSessionVmArtifacts, setSessionVmArtifacts } = await import('@/lib/db');
      let files = getSessionVmArtifacts(sessionId);
      const vmOnline = await vmChannelReady();
      if (vmOnline) {
        try {
          const live = await listNewFiles(sessionId, 0);
          if (files.length === 0) {
            files = live;
            if (live.length > 0) setSessionVmArtifacts(sessionId, live);
          } else {
            const livePaths = new Set(live.map((f) => f.path));
            const pruned = files.filter((f) => livePaths.has(f.path));
            if (pruned.length !== files.length) {
              setSessionVmArtifacts(sessionId, pruned);
              files = pruned;
            }
          }
        } catch { /* live reconcile is best-effort */ }
      }
      return Response.json({ files, vmOnline });
    }

    // Download paths need the backend channel — wake it on demand (user
    // explicitly asked for a file, so a few seconds of cold start is expected).
    // vfkit: boots the VM; remote: the server reads the session volume directly
    // (no container wake), so ready simply means the server is reachable.
    if (!(await vmChannelReady())) {
      const { getCoworkBackend } = await import('@/lib/cowork-backend');
      const st = await (await getCoworkBackend()).ensureReady(sessionId);
      if (!st.ready) {
        return Response.json({ error: 'Sandbox backend is not available' }, { status: 503 });
      }
    }

    if (wantArchive) {
      const { stream } = await archiveStream(sessionId);
      return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="sandbox-${sessionId.slice(0, 8)}.tar.gz"`,
        },
      });
    }

    if (vmPath) {
      const name = vmPath.split('/').pop() || 'download';
      const { stream } = await readFileStream(sessionId, vmPath);
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

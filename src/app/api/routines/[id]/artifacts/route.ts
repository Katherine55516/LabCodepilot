import { NextRequest } from 'next/server';
import { Readable } from 'stream';
import { getCoworkRoutine, getCurrentUserUid } from '@/lib/db';
import { readFileStream, listNewFiles, archiveStream } from '@/lib/cowork-transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 定时任务的产物通道。
 *
 * GET ?list=1            — 列出该任务工作区里的全部文件
 * GET ?path=<vmPath>     — 下载单个文件(流式)
 * GET ?archive=1         — 打包下载整个工作区(tar.gz 流式)
 *
 * **为什么不复用 `/api/cowork/artifacts`**:那条路由用 `getSession(sessionId)` 做归属
 * 校验,而定时任务的工作区挂在 **routineId** 名下 —— routineId 就是沙箱的 sid(独立
 * 容器 `cowork-<id>` + 持久卷 `cowork-ws-<id>`),但它**不在本地 chat_sessions 表里**
 * (本地物化出来的会话是另一个 id)。拿 routineId 去调那条路由必然 404。
 * 与其放宽那道守卫(它是办公会话的账号隔离边界,改它风险高),不如另开一条按
 * `cowork_routines.owner_uid` 校验的专用口。
 *
 * 产物**不走本地 vm_artifacts 缓存**:那张表是按 chat_sessions 存的,定时任务没有对应
 * 行。这里每次实读工作区 —— 定时任务的产物本来就随每次运行累积(D2),实读才是准的。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vmPath = request.nextUrl.searchParams.get('path');
  const wantList = request.nextUrl.searchParams.get('list') === '1';
  const wantArchive = request.nextUrl.searchParams.get('archive') === '1';

  // 归属校验(纵深防御的本地这一层)。服务端按 HMAC token 里的 uid 也会拦跨用户访问,
  // 但那要等请求打过去才知道;本地先拦一道,顺便避免把别人的 routineId 探到服务端。
  const routine = getCoworkRoutine(id);
  const uid = getCurrentUserUid();
  if (!routine || !uid || routine.owner_uid !== uid) {
    return Response.json({ error: 'Routine not found' }, { status: 404 });
  }

  try {
    if (wantList) {
      // 沙箱不可达时回空列表而不是报错:界面据此显示「暂无产物」,比一个红色错误条
      // 更贴近事实 —— 用户此刻要看的是运行过程,产物拿不到只是少一块。
      const files = await listNewFiles(id, 0).catch(() => []);
      return Response.json({ files });
    }

    if (wantArchive) {
      const { stream } = await archiveStream(id);
      return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="routine-${id.slice(0, 8)}.tar.gz"`,
        },
      });
    }

    if (vmPath) {
      const name = vmPath.split('/').pop() || 'download';
      const { stream } = await readFileStream(id, vmPath);
      return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          // RFC 5987 filename* 承载非 ASCII 文件名(定时任务产出中文名很常见,
          // 实测「环境配置.txt」)
          'Content-Disposition': `attachment; filename="${encodeURIComponent(name).replace(/%/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    }

    return Response.json({ error: 'path, list=1 or archive=1 is required' }, { status: 400 });
  } catch (error) {
    // 不回显原始错误:后端错误信息里可能带服务器地址与路径。
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[routine-artifacts] denied/failed:', message.slice(0, 300));
    if (/escapes|invalid/.test(message)) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }
    if (/No such file|realpath/.test(message)) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    return Response.json({ error: 'Failed to read artifact' }, { status: 502 });
  }
}

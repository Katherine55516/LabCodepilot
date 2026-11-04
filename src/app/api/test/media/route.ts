import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 测试证据媒体服务（报告查看器的证据图片灯箱 + 录像内联回放）。
 *
 * GET ?projectPath&taskName&env&file=TC-001.png[&roundId=RND-…] → 流式返回该证据文件。
 * 移植 ai-lab-test-framework 的 `ailab-media://` 协议思路，Next 改用 API route：
 *  - **严格白名单**到项目的 `AI_LabTest/report/_evidence/{task}-{env}/`，只取 basename
 *    平铺查找，杜绝 `../` 路径穿越。
 *  - 视频支持 HTTP Range（206 partial），让 <video> 可拖动 seek，不必整段下载。
 * 证据文件名来自 run.json 的 tests[].evidence（执行阶段 browser_take_screenshot 落盘）。
 */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  const taskName = url.searchParams.get('taskName');
  const env = url.searchParams.get('env') || 'local';
  const file = url.searchParams.get('file');
  // 回归轮次的证据落 _evidence/{task}-{env}-{roundId}/（v2 起产物按轮隔离）。缺省 = 旧的
  // 平铺目录，普通任务与 v1 产物零影响。
  const roundId = url.searchParams.get('roundId') || undefined;
  if (!projectPath || !taskName || !file) {
    return new Response('projectPath, taskName, file are required', { status: 400 });
  }
  // taskName / env / roundId are NOT basename-stripped like `file` — they flow straight
  // into the evidence root, so a traversal value (../) would let the root escape the
  // project. Reject non-segment values up front.
  if (isUnsafeSegment(taskName) || isUnsafeSegment(env) || (roundId && isUnsafeSegment(roundId))) {
    return new Response('invalid taskName, env or roundId', { status: 400 });
  }

  // 白名单根 = 项目的证据目录；只取 basename（证据在该目录平铺），杜绝路径穿越。
  const evidenceRoot = path.resolve(projectPath, artifactPaths(taskName, env, roundId).evidenceDir);
  const target = path.join(evidenceRoot, path.basename(file));
  if (target !== evidenceRoot && !target.startsWith(evidenceRoot + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return new Response('not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('not found', { status: 404 });

  const ext = path.extname(target).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const isVideo = mime.startsWith('video/');
  const range = req.headers.get('range');

  // 视频 + Range → 206 partial。读片段为 buffer 直接返回（不用 Readable.toWeb 流式——它在
  // Next standalone + Electron 打包环境对 <video> 的 Range 请求不兼容，是录像走 Range 分支
  // 黑屏的根因；截图走整文件分支故正常。证据文件不大，整片段入内存可接受）。
  if (isVideo && range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    // Three forms: bytes=START-END, bytes=START- (open-ended), bytes=-N (suffix =
    // the LAST N bytes). The suffix form must anchor to EOF, not to byte 0.
    let start: number;
    let end: number;
    if (m && m[1] === '' && m[2]) {
      start = Math.max(0, stat.size - parseInt(m[2], 10));
      end = stat.size - 1;
    } else {
      start = m && m[1] ? parseInt(m[1], 10) : 0;
      end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    }
    if (start >= stat.size || end >= stat.size || start > end) {
      return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    const len = end - start + 1;
    const fd = fs.openSync(target, 'r');
    const chunk = Buffer.alloc(len);
    try { fs.readSync(fd, chunk, 0, len, start); } finally { fs.closeSync(fd); }
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(len),
      },
    });
  }

  // 整文件（图片，或无 Range 的视频首请求）。
  const buf = fs.readFileSync(target);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=3600',
      ...(isVideo ? { 'Accept-Ranges': 'bytes' } : {}),
    },
  });
}

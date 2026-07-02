import fs from 'fs';
import path from 'path';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 删除某个测试任务的磁盘报告产物（问题6：删任务后「报告」tab 不应再扫到该任务）。
 * 报告列表（reports/route.ts）是直接扫 AI_LabTest/report/{taskName}/ 目录的，前端删任务
 * 只清内存/持久化状态、不删磁盘 → 报告残留。本路由删：
 *   - AI_LabTest/report/{taskName}/             （run.json / 报告 md / 缺陷报告 / history）
 *   - AI_LabTest/report/_evidence/{taskName}-*  （各 env 的截图/录像证据，兄弟目录）
 * taskName 进路径 → 必须 isUnsafeSegment 校验防穿越。best-effort：失败返回 500，前端不阻断。
 */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string | undefined = body.taskName;

    if (!projectPath || !taskName) {
      return new Response(JSON.stringify({ error: 'projectPath and taskName required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (isUnsafeSegment(taskName)) {
      return new Response(JSON.stringify({ error: 'invalid taskName' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const reportDir = path.join(projectPath, 'AI_LabTest', 'report', taskName);
    // [排障·临时] 面包屑:报告 tab 打开时会自动清理孤儿报告(ReportBrowser),该 rmSync 也在
    // Windows native 崩溃的嫌疑路径上。stderr 进 crash-tail 指认。定位后移除。
    console.error(`[test:diag] reports delete ${reportDir}`);
    if (fs.existsSync(reportDir)) fs.rmSync(reportDir, { recursive: true, force: true });

    // 证据目录命名为 {taskName}-{env}，是 report/_evidence 下的兄弟目录 → 按前缀清理本任务全部 env。
    const evidenceRoot = path.join(projectPath, 'AI_LabTest', 'report', '_evidence');
    try {
      if (fs.existsSync(evidenceRoot)) {
        for (const name of fs.readdirSync(evidenceRoot)) {
          if (name === taskName || name.startsWith(`${taskName}-`)) {
            fs.rmSync(path.join(evidenceRoot, name), { recursive: true, force: true });
          }
        }
      }
    } catch { /* 证据清理 best-effort，不影响报告目录已删的结果 */ }

    return Response.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: msg }, { status: 500 });
  }
}

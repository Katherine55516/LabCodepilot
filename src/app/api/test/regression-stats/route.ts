import { buildRegressionStats } from '@/lib/test/regression-stats';

export const runtime = 'nodejs';

/**
 * 回归测试使用统计 · 只读聚合路由（单项目口径，与功能测试 /api/test/stats 的跨项目事件口径分离）。
 *
 * GET ?projectPath → { data: RegressionStats }
 *   直接读当前项目 AI_LabTest/ 文件态（回归轮次.json + 近 N 轮 run.json + 回归套件.json + 回归用例库.json）
 *   聚合出：周维度套件执行/用例执行量、近轮脚本重放 vs AI、套件明细。计算与口径见
 *   src/lib/test/regression-stats.ts；缺文件/坏数据由各读取函数容错（空/跳过），不抛。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  if (!projectPath) {
    return Response.json({ error: 'projectPath is required' }, { status: 400 });
  }
  try {
    return Response.json({ data: buildRegressionStats(projectPath) });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}

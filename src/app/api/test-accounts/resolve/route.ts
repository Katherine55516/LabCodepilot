import { getAllTestAccountSystems } from '@/lib/db';
import { normalizeProjectPath } from '@/lib/projectDedupe';

// Test Accounts · 就地环境配置：按项目路径把工作台「项目」定位到设置·测试账号「系统」。
// 归一化后比较 project_root（与 src/lib/test/env-resolve.ts 的 DB 兜底、工作台「添加项目」
// 判重用同一把尺子），保证抽屉定位到的系统 == 工作台读到的目标 == 框架跑的目标。
// 未命中 **不隐式建库**（只读浏览也留脏行）—— 建库延后到抽屉首存（见 TestEnvDrawer）。
// 契约见 docs/exec-plans/active/test-env-inline-config.md。

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  if (!projectPath || !projectPath.trim()) {
    return Response.json({ error: 'Missing required query param: projectPath' }, { status: 400 });
  }
  try {
    const target = normalizeProjectPath(projectPath);
    const system = getAllTestAccountSystems().find(
      (s) => s.project_root.trim() !== '' && normalizeProjectPath(s.project_root) === target,
    );
    // 命中回该系统；未命中回 system:null（前端据此以「未绑定」空壳进入抽屉，保存时才建库）。
    return Response.json({ system: system ?? null, projectPath });
  } catch (error) {
    console.error('[test-accounts:resolve]', error instanceof Error ? error.message : String(error));
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve test account system' },
      { status: 500 },
    );
  }
}

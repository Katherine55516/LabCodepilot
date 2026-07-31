import { getAllTestAccountSystems } from '@/lib/db';
import type { TestAccountProjectSummary } from '@/types';

/**
 * 测试工作台项目名称展示使用的脱敏摘要。
 *
 * 不复用 /api/test-accounts 的完整响应，避免项目列表为了一个系统名称加载账号、
 * 密码、Token、登录态与环境地址。未绑定 project_root 的系统无法对应工作台项目，
 * 因此不返回。
 */
export async function GET(): Promise<Response> {
  try {
    const systems: TestAccountProjectSummary[] = getAllTestAccountSystems()
      .filter((system) => system.project_root.trim() !== '')
      .map((system) => ({
        id: system.id,
        name: system.name,
        project_root: system.project_root,
      }));
    return Response.json({ systems });
  } catch (error) {
    console.error(
      '[test-accounts:project-summaries]',
      error instanceof Error ? error.message : String(error),
    );
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to list project system summaries' },
      { status: 500 },
    );
  }
}

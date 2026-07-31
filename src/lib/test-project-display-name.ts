import { normalizeProjectPath } from '@/lib/projectDedupe';
import type { TestAccountProjectSummary } from '@/types';

/**
 * 构造工作台项目路径 → 环境配置系统名称映射。
 *
 * getAllTestAccountSystems() 已按 sort_order / created_at 排序；同一路径出现多条时
 * 保留首条，与 resolve / env-resolve 现有 find() 语义一致。空路径与空名称不进入
 * 映射，让 UI 自然回退到工作台持久化的文件夹名。
 */
export function buildProjectSystemNameMap(
  systems: readonly TestAccountProjectSummary[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const system of systems) {
    const path = normalizeProjectPath(system.project_root);
    const name = system.name.trim();
    if (!path || !name || names.has(path)) continue;
    names.set(path, name);
  }
  return names;
}

/** 按工作台同一套路径归一化规则查系统名；未命中返回 null。 */
export function getProjectSystemName(
  names: ReadonlyMap<string, string>,
  projectPath: string,
): string | null {
  return names.get(normalizeProjectPath(projectPath)) ?? null;
}

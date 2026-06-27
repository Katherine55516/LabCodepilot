/**
 * 测试工作台 · 项目去重工具（纯函数，无 React 依赖，便于单测）。
 *
 * 项目以文件系统 path 作为唯一键 —— 项目名是从 path 末段推导的，path 相同则名称必然相同。
 * 供 InlineTestingPanel 在两处复用：
 *  1. 「添加项目」防重：选中路径已在列表中则阻止新增（弹警告 Toast）。
 *  2. 「加载时去重」：清理早期无防重逻辑遗留的同路径重复项目。
 */

/** 去重所需的最小项目结构（只关心 path 与 tasks 数量）。 */
export interface DedupableProject {
  path: string;
  tasks: { id: string; name: string }[];
}

/**
 * 归一化项目路径用于判重：去掉末尾的 / 或 \（根路径除外），并裁掉首尾空白，
 * 其余按原样精确比较（不做大小写折叠，避免在大小写敏感文件系统上误合并不同项目）。
 */
export function normalizeProjectPath(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/, "");
  return trimmed || path.trim();
}

/**
 * 按归一化路径去重：同一路径只保留 tasks 最多的那个（并列保留先出现的）。
 * 返回数组保持各路径「首次出现」的顺序。
 */
export function dedupeProjectsByPath<T extends DedupableProject>(projects: T[]): T[] {
  const byPath = new Map<string, T>();
  for (const p of projects) {
    const key = normalizeProjectPath(p.path);
    const existing = byPath.get(key);
    // Map.set 对已存在的 key 仅更新值、保留原插入位置 → 顺序按各路径首次出现。
    // 仅当新项 tasks 严格更多时替换 → 并列时保留先出现的那个。
    if (!existing || (p.tasks?.length ?? 0) > (existing.tasks?.length ?? 0)) byPath.set(key, p);
  }
  return Array.from(byPath.values());
}

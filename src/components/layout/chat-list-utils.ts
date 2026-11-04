import { parseDBDate } from "@/lib/utils";
import type { ChatSession } from "@/types";
import type { TranslationKey } from "@/i18n";

const COLLAPSED_PROJECTS_KEY = "codepilot:collapsed-projects";
export const COLLAPSED_INITIALIZED_KEY = "codepilot:collapsed-initialized";

// ── E3 (cowork):「办公 / 研发」双栏 ────────────────────────────────
// 办公 = 沙箱会话(sandbox_enabled,单一事实源,见 cowork-office-mode.md D1),
// 平铺不按项目分组;研发 = 其余,走既有 groupSessionsByProject。

export type WorkspaceTab = "dev" | "office";

const WORKSPACE_TAB_KEY = "codepilot:workspace-tab";

export function loadWorkspaceTab(): WorkspaceTab {
  if (typeof window === "undefined") return "dev";
  try {
    const raw = localStorage.getItem(WORKSPACE_TAB_KEY);
    if (raw === "office" || raw === "dev") return raw;
  } catch {
    // ignore
  }
  return "dev";
}

export function saveWorkspaceTab(tab: WorkspaceTab) {
  try {
    localStorage.setItem(WORKSPACE_TAB_KEY, tab);
  } catch {
    // ignore
  }
}

/**
 * 按双栏语义切分会话:office = sandbox_enabled(按 updated_at 倒序平铺),
 * dev = 其余(顺序保持,调用方再做项目分组)。纯函数,单测覆盖。
 */
export function splitSessionsByWorkspaceTab(sessions: ChatSession[]): {
  office: ChatSession[];
  dev: ChatSession[];
} {
  const office: ChatSession[] = [];
  const dev: ChatSession[] = [];
  for (const s of sessions) {
    (s.sandbox_enabled ? office : dev).push(s);
  }
  office.sort(
    (a, b) => parseDBDate(b.updated_at).getTime() - parseDBDate(a.updated_at).getTime()
  );
  return { office, dev };
}

export function loadCollapsedProjects(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

export function saveCollapsedProjects(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...collapsed]));
}

export interface ProjectGroup {
  workingDirectory: string;
  displayName: string;
  sessions: ChatSession[];
  latestUpdatedAt: number;
}

export function groupSessionsByProject(sessions: ChatSession[]): ProjectGroup[] {
  const map = new Map<string, ChatSession[]>();
  for (const session of sessions) {
    const key = session.working_directory || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(session);
  }

  const groups: ProjectGroup[] = [];
  for (const [wd, groupSessions] of map) {
    // Sort sessions within group by updated_at DESC
    groupSessions.sort(
      (a, b) =>
        parseDBDate(b.updated_at).getTime() - parseDBDate(a.updated_at).getTime()
    );
    const displayName =
      wd === ""
        ? "No Project"
        : groupSessions[0]?.project_name || wd.split("/").pop() || wd;
    const latestUpdatedAt = parseDBDate(groupSessions[0].updated_at).getTime();
    groups.push({
      workingDirectory: wd,
      displayName,
      sessions: groupSessions,
      latestUpdatedAt,
    });
  }

  // Sort groups by most recently active first
  groups.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
  return groups;
}

export function formatRelativeTime(dateStr: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const date = parseDBDate(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return t('chatList.justNow');
  if (diffMin < 60) return t('chatList.minutesAgo', { n: diffMin });
  if (diffHr < 24) return t('chatList.hoursAgo', { n: diffHr });
  if (diffDay < 7) return t('chatList.daysAgo', { n: diffDay });
  return date.toLocaleDateString();
}

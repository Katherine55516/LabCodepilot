"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  MagnifyingGlass,
  FileArrowDown,
  Plus,
  FolderPlus,
  Lightning,
  Plug,
  Terminal,
  Image,
  WifiHigh,
  Gear,
  MagnifyingGlassCheck,
  Sparkle,
  Briefcase,
  Code,
  SidebarSimple,
  type Icon,
} from "@/components/ui/icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePanel } from "@/hooks/usePanel";
import { useSplit } from "@/hooks/useSplit";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { showToast } from '@/hooks/useToast';
// ConnectionStatus removed from header — CLI status now lives in Settings > Claude CLI
// ImportSessionDialog moved to Settings page
import { SessionListItem, SplitGroupSection } from "./SessionListItem";
import { ProjectGroupHeader } from "./ProjectGroupHeader";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { useAssistantWorkspace } from "@/hooks/useAssistantWorkspace";
import { AssistantPromoCard } from "@/components/chat/ChatEmptyState";
import { UserMenu } from "@/components/account/UserMenu";
import {
  formatRelativeTime,
  groupSessionsByProject,
  loadCollapsedProjects,
  saveCollapsedProjects,
  loadWorkspaceTab,
  saveWorkspaceTab,
  splitSessionsByWorkspaceTab,
  type WorkspaceTab,
  COLLAPSED_INITIALIZED_KEY,
} from "./chat-list-utils";
import { OfficeEmptyCard } from "./OfficeEmptyCard";
import type { ChatSession } from "@/types";

interface ChatListPanelProps {
  open: boolean;
  /** 折叠/展开侧边栏(顶行折叠按钮 + 折叠细栏的展开按钮共用) */
  onToggle?: () => void;
  width?: number;
  hasUpdate?: boolean;
  readyToInstall?: boolean;
}


export function ChatListPanel({ open, onToggle, width, hasUpdate, readyToInstall }: ChatListPanelProps) {
  const pathname = usePathname();
  const router = useRouter();

  const { streamingSessionId, pendingApprovalSessionId, activeStreamingSessions, pendingApprovalSessionIds, workingDirectory, testPanelOpen, setTestPanelOpen } = usePanel();

  // 工作台只在 chat 路由的覆盖层显示（见 AppShell：testPanelOpen && isChatRoute）。测试按钮的
  // active 高亮应与「工作台是否真的可见」一致——否则点文生图/设置导航到非 chat 路由后，工作台
  // 已隐藏、按钮却还亮着（用户报「点测试再点其他模块，测试按钮 active 没取消」）。testPanelOpen
  // 保持不变（保活：切回 chat 工作台仍在），只是按钮高亮跟随实际可见性。
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";

  // "测试" entry (Routines-style sidebar button). Toggles the inline testing
  // panel via app-level PanelContext state (no transient event → no mount-timing
  // race). Toggle (not just open) because the panel no longer has its own 收起
  // button — clicking 测试 again is the explicit way out. Navigates to /chat
  // first when opening from a non-chat route. Additive.
  const handleOpenTesting = useCallback(() => {
    // 工作台「可见」= testPanelOpen 且在 chat 路由（工作台是 /chat 覆盖层）——与测试按钮 active
    // 的判断保持一致。toggle 必须按【可见性】而非纯 testPanelOpen：否则在文生图/设置等非 chat
    // 路由时 testPanelOpen 可能仍为 true（保活、只是隐藏），此刻点测试会被 toggle 成 false（先
    // 关一次、用户看「没反应」），得点第二次才开。改为：可见→关；不可见(没开 / 在非 chat 路由)
    // →开 + 导航回 /chat 让它显示。
    const visible = testPanelOpen && pathname.startsWith("/chat");
    if (visible) {
      setTestPanelOpen(false);
    } else {
      setTestPanelOpen(true);
      if (!pathname.startsWith("/chat")) router.push("/chat");
    }
  }, [pathname, router, testPanelOpen, setTestPanelOpen]);
  const { splitSessions, isSplitActive, activeColumnId, addToSplit, removeFromSplit, setActiveColumn, isInSplit } = useSplit();
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<Set<string>>(new Set());
  const SESSION_TRUNCATE_LIMIT = 10;
  // importDialogOpen removed — Import CLI moved to Settings
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => loadCollapsedProjects()
  );
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);

  // E3 (cowork): 「办公 / 研发」双栏。办公 = 沙箱会话平铺(不按项目分组);
  // 仅当全局 cowork_enabled 开启时分段控件才渲染 —— 关闭时回到现状外观,
  // 遗留沙箱会话继续留在研发项目分组里。tab 选择记忆在 localStorage。
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(() => loadWorkspaceTab());
  const [coworkAvailable, setCoworkAvailable] = useState(false);
  const [coworkImageProvisioned, setCoworkImageProvisioned] = useState(true);

  useEffect(() => {
    // 只读探测(不触发 VM 启动);失败按不可用处理(fail-closed,tab 隐藏)。
    // 设置页切换 cowork_enabled 后广播 cowork-status-changed(E5),这里重拉
    // 让双栏即时显隐,无需重启。
    const fetchCoworkStatus = () => {
      fetch('/api/cowork/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setCoworkAvailable(!!d.enabled);
          setCoworkImageProvisioned(!!d.imageProvisioned);
        })
        .catch(() => {});
    };
    fetchCoworkStatus();
    window.addEventListener('cowork-status-changed', fetchCoworkStatus);
    return () => window.removeEventListener('cowork-status-changed', fetchCoworkStatus);
  }, []);

  const activeTab: WorkspaceTab = coworkAvailable ? workspaceTab : 'dev';

  // E4.1: 也监听外部发出的 tab 切换(如 /chat 页在预填跳转时强制切研发),
  // 保持侧边栏与主区一致。监听方只 setState 不再广播,不会成环。
  useEffect(() => {
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (tab === 'office' || tab === 'dev') setWorkspaceTab(tab);
    };
    window.addEventListener('workspace-tab-changed', onTab);
    return () => window.removeEventListener('workspace-tab-changed', onTab);
  }, []);

  const handleTabChange = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    saveWorkspaceTab(tab);
    // 测试工作台是研发专属入口(2026-07 改版后办公 tab 不渲染测试按钮),切到办公时
    // 顺手关闭,避免覆盖层留在 /chat 上却没有任何按钮能关它。
    if (tab === 'office') setTestPanelOpen(false);
    // /chat 落地页据此实时切换 办公/研发 空态(E4);同 localStorage 值一起构成
    // 「当前 tab」的唯一广播口。
    window.dispatchEvent(new CustomEvent('workspace-tab-changed', { detail: tab }));
    // E4.1 (用户反馈问题3): 主区跟随 —— 当前打开的会话不属于目标模式时,
    // 切到目标模式的最近会话;目标模式没有会话则回 /chat(按 tab 显示对应空态)。
    const m = pathname.match(/^\/chat\/([^/]+)$/);
    if (!m) return;
    const cur = sessions.find((s) => s.id === m[1]);
    if (!cur) return;
    const curIsOffice = !!cur.sandbox_enabled;
    const targetIsOffice = tab === 'office';
    if (curIsOffice === targetIsOffice) return;
    // sessions 来自 getAllSessions(updated_at DESC),首个匹配即最近会话
    const next = sessions.find((s) => (targetIsOffice ? !!s.sandbox_enabled : !s.sandbox_enabled));
    router.push(next ? `/chat/${next.id}` : '/chat');
  }, [pathname, sessions, router, setTestPanelOpen]);
  const { workspacePath } = useAssistantWorkspace();
  const [assistantSummary, setAssistantSummary] = useState<{
    name: string;
    memoryCount: number;
    lastHeartbeatDate: string;
    configured: boolean;
    buddy?: { emoji: string; buddyName?: string; species?: string };
  } | null>(null);
  const [promoDismissed, setPromoDismissed] = useState(false);

  // Reload assistant summary when sessions change (e.g. after onboarding/rename)
  useEffect(() => {
    fetch('/api/workspace/summary')
      .then(r => r.ok ? r.json() : null)
      .then(data => setAssistantSummary(data))
      .catch(() => {});
  }, [sessions.length]);

  /** Read current model + provider_id from localStorage for new session creation */
  const getCurrentModelAndProvider = useCallback(() => {
    const model = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') || '' : '';
    const provider_id = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') || '' : '';
    return { model, provider_id };
  }, []);

  const handleFolderSelect = useCallback(async (path: string) => {
    try {
      const { model, provider_id } = getCurrentModelAndProvider();
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: path, model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`/chat/${data.session.id}`);
      }
    } catch {
      // Silently fail
    }
  }, [router, getCurrentModelAndProvider]);

  const openFolderPicker = useCallback(async (defaultPath?: string) => {
    if (isElectron) {
      const path = await openNativePicker({ defaultPath, title: t('folderPicker.title') });
      if (path) handleFolderSelect(path);
    } else {
      setFolderPickerOpen(true);
    }
  }, [isElectron, openNativePicker, t, handleFolderSelect]);

  const handleNewChat = useCallback(async () => {
    let lastDir = workingDirectory
      || (typeof window !== 'undefined' ? localStorage.getItem("codepilot:last-working-directory") : null);

    // Fall back to setup default project if no recent directory
    if (!lastDir) {
      try {
        const setupRes = await fetch('/api/setup');
        if (setupRes.ok) {
          const setupData = await setupRes.json();
          if (setupData.defaultProject) {
            lastDir = setupData.defaultProject;
            localStorage.setItem('codepilot:last-working-directory', lastDir!);
          }
        }
      } catch { /* ignore */ }
    }

    if (!lastDir) {
      // No saved directory — let user pick one
      openFolderPicker();
      return;
    }

    // Validate the saved directory still exists
    setCreatingChat(true);
    try {
      const checkRes = await fetch(
        `/api/files/browse?dir=${encodeURIComponent(lastDir)}`
      );
      if (!checkRes.ok) {
        // Directory is gone — clear stale value, try setup default before prompting
        localStorage.removeItem("codepilot:last-working-directory");
        let recovered = false;
        try {
          const setupRes = await fetch('/api/setup');
          if (setupRes.ok) {
            const setupData = await setupRes.json();
            if (setupData.defaultProject && setupData.defaultProject !== lastDir) {
              const defaultCheck = await fetch(`/api/files/browse?dir=${encodeURIComponent(setupData.defaultProject)}`);
              if (defaultCheck.ok) {
                lastDir = setupData.defaultProject;
                localStorage.setItem('codepilot:last-working-directory', lastDir!);
                recovered = true;
              }
            }
          }
        } catch { /* ignore */ }
        if (!recovered) {
          showToast({
            type: 'warning',
            message: t('error.directoryInvalid'),
            action: { label: t('error.selectDirectory'), onClick: () => openFolderPicker() },
          });
          openFolderPicker();
          return;
        }
      }

      const { model, provider_id } = getCurrentModelAndProvider();
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: lastDir, model, provider_id }),
      });
      if (!res.ok) {
        // Backend rejected it (e.g. INVALID_DIRECTORY) — prompt user
        localStorage.removeItem("codepilot:last-working-directory");
        openFolderPicker();
        return;
      }
      const data = await res.json();
      router.push(`/chat/${data.session.id}`);
      window.dispatchEvent(new CustomEvent("session-created"));
    } catch {
      openFolderPicker();
    } finally {
      setCreatingChat(false);
    }
  }, [router, workingDirectory, openFolderPicker, getCurrentModelAndProvider, t]);

  // E3: 办公 tab 的「新对话」— 不选文件夹,POST sandbox_enabled:1;服务端
  // 生成宿主暂存目录(E2)并默认 full_access。
  const handleNewOfficeChat = useCallback(async () => {
    setCreatingChat(true);
    try {
      const { model, provider_id } = getCurrentModelAndProvider();
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandbox_enabled: 1, model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`/chat/${data.session.id}`);
      }
    } catch {
      // Silently fail (same convention as handleNewChat)
    } finally {
      setCreatingChat(false);
    }
  }, [router, getCurrentModelAndProvider]);

  const toggleProject = useCallback((wd: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(wd)) next.delete(wd);
      else next.add(wd);
      saveCollapsedProjects(next);
      return next;
    });
  }, []);

  // AbortController ref for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSessions = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat/sessions", { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (e) {
      // Ignore abort errors; log others
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }, []);

  const debouncedFetchSessions = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSessions();
    }, 300);
  }, [fetchSessions]);

  // Fetch on mount
  useEffect(() => {
    fetchSessions();
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchSessions]);

  // Refresh session list when a session is created or updated (debounced)
  useEffect(() => {
    const handler = () => debouncedFetchSessions();
    window.addEventListener("session-created", handler);
    window.addEventListener("session-updated", handler);
    return () => {
      window.removeEventListener("session-created", handler);
      window.removeEventListener("session-updated", handler);
    };
  }, [debouncedFetchSessions]);

  // Periodic poll to catch sessions created server-side (e.g. bridge)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSessions();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    setDeletingSession(sessionId);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        // Remove from split if it's there
        if (isInSplit(sessionId)) {
          removeFromSplit(sessionId);
        }
        if (pathname === `/chat/${sessionId}`) {
          router.push("/chat");
        }
      }
    } catch {
      // Silently fail
    } finally {
      setDeletingSession(null);
    }
  };

  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
        );
        window.dispatchEvent(new CustomEvent("session-updated"));
      }
    } catch {
      // Silently fail
    }
  };

  const handleRemoveProject = async (workingDirectory: string) => {
    if (!confirm(`Remove project "${workingDirectory.split('/').pop()}" and all its conversations?`)) return;
    const projectSessions = sessions.filter((s) => s.working_directory === workingDirectory);
    const deletedIds = new Set<string>();
    for (const session of projectSessions) {
      try {
        const res = await fetch(`/api/chat/sessions/${session.id}`, { method: "DELETE" });
        if (res.ok) {
          deletedIds.add(session.id);
          if (isInSplit(session.id)) {
            removeFromSplit(session.id);
          }
        }
      } catch {
        // Continue with remaining
      }
    }
    // Only remove sessions that were successfully deleted from backend
    if (deletedIds.size > 0) {
      setSessions((prev) => prev.filter((s) => !deletedIds.has(s.id)));
      if (pathname?.startsWith('/chat/')) {
        const currentSessionId = pathname.split('/chat/')[1];
        if (deletedIds.has(currentSessionId)) {
          router.push("/chat");
        }
      }
    }
  };

  const handleCreateSessionInProject = async (
    e: React.MouseEvent,
    workingDirectory: string
  ) => {
    e.stopPropagation();
    try {
      const { model, provider_id } = getCurrentModelAndProvider();
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: workingDirectory, model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`/chat/${data.session.id}`);
      }
    } catch {
      // Silently fail
    }
  };

  const splitSessionIds = useMemo(
    () => new Set(splitSessions.map((s) => s.sessionId)),
    [splitSessions]
  );

  const filteredSessions = useMemo(() => {
    // Exclude sessions in split group (they are shown in the split section)
    if (isSplitActive) {
      return sessions.filter((s) => !splitSessionIds.has(s.id));
    }
    return sessions;
  }, [sessions, isSplitActive, splitSessionIds]);

  // E3: 双栏切分 —— office = 沙箱会话(updated_at 倒序平铺),dev = 其余。
  // cowork 全局关闭时不切分(遗留沙箱会话留在研发分组,现状外观零变化)。
  const { office: officeSessions, dev: devSessions } = useMemo(
    () =>
      coworkAvailable
        ? splitSessionsByWorkspaceTab(filteredSessions)
        : { office: [] as ChatSession[], dev: filteredSessions },
    [filteredSessions, coworkAvailable]
  );

  const projectGroups = useMemo(() => {
    const groups = groupSessionsByProject(devSessions);
    // Pin assistant workspace project to top
    if (workspacePath) {
      const wsIdx = groups.findIndex(g => g.workingDirectory === workspacePath);
      if (wsIdx > 0) {
        const [wsGroup] = groups.splice(wsIdx, 1);
        groups.unshift(wsGroup);
      }
    }
    return groups;
  }, [devSessions, workspacePath]);

  // Auto-collapse: only expand the project with the most recent session activity.
  // Runs on first use AND whenever the project list changes (new projects added).
  useEffect(() => {
    if (projectGroups.length <= 1) return;
    // Find the project with the latest session (highest latestUpdatedAt), ignoring pin order
    const sorted = [...projectGroups].sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
    const mostRecentWd = sorted[0]?.workingDirectory;
    const toCollapse = new Set(
      projectGroups
        .filter(g => g.workingDirectory !== mostRecentWd)
        .map(g => g.workingDirectory)
    );
    // Only update if collapsed set actually changed (avoid infinite loop)
    const currentKeys = [...collapsedProjects].sort().join(',');
    const newKeys = [...toCollapse].sort().join(',');
    // v2: re-initialize with improved logic (pin-aware)
    const initKey = COLLAPSED_INITIALIZED_KEY + '-v2';
    if (currentKeys !== newKeys && !localStorage.getItem(initKey)) {
      setCollapsedProjects(toCollapse);
      saveCollapsedProjects(toCollapse);
      localStorage.setItem(initKey, "1");
    }
  }, [projectGroups, collapsedProjects]);

  // 折叠态:整个面板收成一条细栏,只留 展开 + 搜索 两个图标(不用悬浮按钮,
  // 避免与 macOS 红绿灯 / 各路由自己的顶部内容重叠)。
  if (!open) {
    return (
      <aside className="hidden h-full w-[52px] shrink-0 flex-col items-center overflow-hidden bg-sidebar/80 backdrop-blur-xl lg:flex">
        {/* macOS traffic lights spacing */}
        <div className="h-5 shrink-0 mt-3" />
        <div className="flex flex-col items-center gap-1 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onToggle}
              >
                <SidebarSimple size={15} />
                <span className="sr-only">{t('chatList.expandSidebar')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('chatList.expandSidebar')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => window.dispatchEvent(new CustomEvent('open-global-search'))}
              >
                <MagnifyingGlass size={15} />
                <span className="sr-only">{t('chatList.searchSessions')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('chatList.searchSessions')}</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    );
  }

  // Type annotation needed because the array is currently empty (every entry
  // commented out). When restoring any entry, drop the annotation if you like.
  const navItems: Array<{ href: string; label: string; icon: Icon }> = [
    // Testing moved into the chat composer's "测试" mode (inline testing panel),
    // so there's no top-level /test route anymore.
    // Skills / MCP / CLI Tools moved into Settings sub-sections — routes
    // still resolve, just no top-level entries here. Restore by uncommenting.
    // { href: "/skills", label: t('nav.skills' as TranslationKey), icon: Lightning },
    // { href: "/mcp", label: t('nav.mcp' as TranslationKey), icon: Plug },
    // { href: "/cli-tools", label: t('nav.cliTools' as TranslationKey), icon: Terminal },
    // Hidden from sidebar — route + gallery subsystem still active. Restore by uncommenting.
    // { href: "/gallery", label: t('nav.gallery' as TranslationKey), icon: Image },
    // Bridge moved into Settings → "远程桥接" sub-section. The /bridge route
    // still works for bookmarked URLs. Restore here by uncommenting.
    // { href: "/bridge", label: t('nav.bridge' as TranslationKey), icon: WifiHigh },
  ];

  return (
    <aside
      className="hidden h-full shrink-0 flex-col overflow-hidden bg-sidebar/80 backdrop-blur-xl lg:flex"
      style={{ width: width ?? 240 }}
    >
      {/* macOS traffic lights spacing */}
      <div className="h-5 shrink-0 mt-3" />

      {/* Top action bar: 折叠 + 搜索(左对齐,参考 Claude 桌面版)— 新对话
          移到 办公/研发 切换栏下方(2026-07 侧边栏改版) */}
      <div className="flex items-center gap-1 px-3 pb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onToggle}
            >
              <SidebarSimple size={15} />
              <span className="sr-only">{t('chatList.collapseSidebar')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('chatList.collapseSidebar')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => window.dispatchEvent(new CustomEvent('open-global-search'))}
            >
              <MagnifyingGlass size={15} />
              <span className="sr-only">{t('chatList.searchSessions')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('chatList.searchSessions')}</TooltipContent>
        </Tooltip>
      </div>

      {/* E3 (cowork): 办公/研发 分段切换 — 仅 cowork_enabled 时渲染;办公=
          沙箱会话平铺,研发=现有项目分组。切 tab 只换列表,不影响已打开会话。 */}
      {coworkAvailable && (
        <div className="px-3 pb-2">
          {/* activationMode="manual":焦点掠过不切换(默认 automatic 下 Tab 键
              路过/a11y 遍历 focus 到 trigger 就会切视图并写 localStorage,
              CDP 验证时实测误触)。点击 / Enter / Space 才激活。 */}
          <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as WorkspaceTab)} activationMode="manual">
            <TabsList className="w-full !h-8 p-0.5 text-xs rounded-md">
              <TabsTrigger value="office" className="flex-1 !h-6 rounded-sm px-1.5 py-0 text-xs gap-1.5">
                <Briefcase size={13} />
                {t('workspace.tab.office')}
              </TabsTrigger>
              <TabsTrigger value="dev" className="flex-1 !h-6 rounded-sm px-1.5 py-0 text-xs gap-1.5">
                <Code size={13} />
                {t('workspace.tab.dev')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* 新对话(弱化为 ghost 行 + 圈形加号,参考 Claude 桌面版)+ 按 tab 绑定的功能
          入口:办公 → 文生图,研发 → 测试。cowork 关闭时没有 tab 概念,两个入口都
          显示,保证文生图不从侧边栏消失。 */}
      <div className="flex flex-col gap-0.5 px-3 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 h-8 text-xs"
          disabled={creatingChat || (activeTab === 'office' && !coworkImageProvisioned)}
          onClick={activeTab === 'office' ? handleNewOfficeChat : handleNewChat}
        >
          <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-foreground/30">
            <Plus size={11} className="size-[11px]" />
          </span>
          {t('chatList.newConversation')}
        </Button>
        {/* 测试 — 研发专属:toggle 内联测试工作台;办公 tab 不渲染(切办公时
            handleTabChange 会顺手关闭工作台,避免覆盖层留在屏上无处可关)。 */}
        {activeTab === 'dev' && (
          <Button
            variant="ghost"
            size="sm"
            className={`w-full justify-start gap-2 h-8 text-xs ${
              testPanelOpen && isChatRoute
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={handleOpenTesting}
          >
            <MagnifyingGlassCheck size={14} weight={testPanelOpen && isChatRoute ? "fill" : "regular"} />
            {t('nav.test')}
          </Button>
        )}
        {/* 文生图 — 办公专属(cowork 关闭时也显示,保证入口不丢) */}
        {(activeTab === 'office' || !coworkAvailable) && (
          <Link href="/image">
            <Button
              variant="ghost"
              size="sm"
              className={`w-full justify-start gap-2 h-8 text-xs ${
                pathname.startsWith("/image")
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkle size={14} weight={pathname.startsWith("/image") ? "fill" : "regular"} />
              {t('imageStudio.sidebarButton' as TranslationKey)}
            </Button>
          </Link>
        )}
      </div>

      {/* Feature nav items — navItems is empty today (entries live in Settings);
          render the block only when some are restored so it leaves no empty gap. */}
      {navItems.length > 0 && (
        <div className="px-3 pb-2">
          <div className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`w-full justify-start gap-2 h-8 text-xs ${
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <item.icon size={14} weight={isActive ? "fill" : "regular"} />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Separator */}
      <div className="mx-3 border-t border-border/40" />

      {/* Section title + add folder button (fixed, not scrolling) */}
      <div className="flex items-center justify-between px-5 pt-2 pb-1.5 shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t('chatList.threads')}
        </span>
        {/* 「新建项目」是研发专属(办公不绑项目文件夹,E3) */}
        {activeTab === 'dev' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground/60 hover:text-foreground"
            onClick={() => openFolderPicker()}
          >
            <FolderPlus size={12} />
            {t('chatList.addProjectFolder')}
          </Button>
        )}
      </div>

      {/* Session list grouped by project */}
      <ScrollArea className="flex-1 min-h-0 px-3 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col pb-3">

          {/* Split group section — 分屏是研发工作流,办公 tab 不显示 */}
          {activeTab === 'dev' && isSplitActive && (
            <SplitGroupSection
              splitSessions={splitSessions}
              activeColumnId={activeColumnId}
              streamingSessionId={streamingSessionId}
              pendingApprovalSessionId={pendingApprovalSessionId}
              activeStreamingSessions={activeStreamingSessions}
              pendingApprovalSessionIds={pendingApprovalSessionIds}
              t={t}
              setActiveColumn={setActiveColumn}
              removeFromSplit={removeFromSplit}
            />
          )}

          {/* E3: 办公 tab — 沙箱会话平铺(不分组);空态显示介绍卡 */}
          {activeTab === 'office' && (
            officeSessions.length === 0 ? (
              <OfficeEmptyCard
                imageProvisioned={coworkImageProvisioned}
                creating={creatingChat}
                onStart={handleNewOfficeChat}
              />
            ) : (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {officeSessions.map((session) => {
                  const isActive = !testPanelOpen && pathname === `/chat/${session.id}`;
                  return (
                    <SessionListItem
                      key={session.id}
                      session={session}
                      isActive={isActive}
                      isHovered={hoveredSession === session.id}
                      isDeleting={deletingSession === session.id}
                      isSessionStreaming={activeStreamingSessions.has(session.id) || streamingSessionId === session.id}
                      needsApproval={pendingApprovalSessionIds.has(session.id) || pendingApprovalSessionId === session.id}
                      canSplit={false}
                      isWorkspace={false}
                      formatRelativeTime={formatRelativeTime}
                      t={t}
                      onMouseEnter={() => setHoveredSession(session.id)}
                      onMouseLeave={() => setHoveredSession(null)}
                      onDelete={handleDeleteSession}
                      onRename={handleRenameSession}
                      onAddToSplit={(s) => addToSplit({
                        sessionId: s.id,
                        title: s.title,
                        workingDirectory: s.working_directory || "",
                        projectName: s.project_name || "",
                        mode: s.mode,
                      })}
                      onNavigate={() => setTestPanelOpen(false)}
                    />
                  );
                })}
              </div>
            )
          )}

          {/* Assistant promo card for unconfigured users — hidden per user
              request (2026-06). Render commented out only; the AssistantPromoCard
              import, assistantSummary + promoDismissed/setPromoDismissed state,
              and i18n keys are all kept intact.
              Restore by uncommenting the block below.
          {assistantSummary && !assistantSummary.configured && !promoDismissed && (
            <AssistantPromoCard
              onSetup={() => router.push('/settings#assistant')}
              onDismiss={() => setPromoDismissed(true)}
            />
          )}
          */}

          {activeTab === 'dev' && (devSessions.length === 0 && (!isSplitActive || splitSessions.length === 0) ? (
            <p className="px-2.5 py-3 text-[11px] text-muted-foreground/60">
              {t('chatList.noSessions')}
            </p>
          ) : (
            projectGroups.map((group) => {
              const isCollapsed =
                collapsedProjects.has(group.workingDirectory);
              const isFolderHovered =
                hoveredFolder === group.workingDirectory;

              const isSessionsExpanded = expandedSessionGroups.has(group.workingDirectory);
              const shouldTruncate = group.sessions.length > SESSION_TRUNCATE_LIMIT;
              let visibleSessions = group.sessions;
              if (shouldTruncate && !isSessionsExpanded) {
                const truncated = group.sessions.slice(0, SESSION_TRUNCATE_LIMIT);
                // Ensure the active session is always visible even when truncated
                const activeSession = group.sessions.find(s => pathname === `/chat/${s.id}`);
                if (activeSession && !truncated.includes(activeSession)) {
                  truncated.push(activeSession);
                }
                visibleSessions = truncated;
              }
              const hiddenCount = group.sessions.length - visibleSessions.length;

              const groupIsWorkspace = !!(workspacePath && group.workingDirectory === workspacePath);

              return (
                <div key={group.workingDirectory || "__no_project"} className="mt-1 first:mt-0">
                  {/* Folder header */}
                  <ProjectGroupHeader
                    workingDirectory={group.workingDirectory}
                    displayName={group.displayName}
                    isCollapsed={isCollapsed}
                    isFolderHovered={isFolderHovered}
                    isWorkspace={groupIsWorkspace}
                    onToggle={() => toggleProject(group.workingDirectory)}
                    onMouseEnter={() => setHoveredFolder(group.workingDirectory)}
                    onMouseLeave={() => setHoveredFolder(null)}
                    onCreateSession={(e) => handleCreateSessionInProject(e, group.workingDirectory)}
                    onRemoveProject={handleRemoveProject}
                    assistantName={assistantSummary?.name}
                    assistantMemoryCount={assistantSummary?.memoryCount}
                    lastHeartbeatDate={assistantSummary?.lastHeartbeatDate}
                    buddyEmoji={assistantSummary?.buddy?.emoji}
                    buddyName={assistantSummary?.buddy?.buddyName}
                    buddySpecies={assistantSummary?.buddy?.species}
                  />

                  {/* Session items with animated collapse */}
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {visibleSessions.map((session) => {
                            // Route-derived active state, but suppressed while the
                            // 测试 workbench overlay is open: in that view we're not
                            // "in" any conversation (the chat is hidden behind the
                            // test panel), so no row should keep the active highlight.
                            // Toggling 测试 back off restores the pathname match; and
                            // conversation→conversation switching already closes the
                            // panel (ChatView resets testPanelOpen on sessionId change).
                            const isActive = !testPanelOpen && pathname === `/chat/${session.id}`;
                            const canSplit = !isActive && !isInSplit(session.id);

                            return (
                              <SessionListItem
                                key={session.id}
                                session={session}
                                isActive={isActive}
                                isHovered={hoveredSession === session.id}
                                isDeleting={deletingSession === session.id}
                                isSessionStreaming={activeStreamingSessions.has(session.id) || streamingSessionId === session.id}
                                needsApproval={pendingApprovalSessionIds.has(session.id) || pendingApprovalSessionId === session.id}
                                canSplit={canSplit}
                                isWorkspace={groupIsWorkspace}
                                formatRelativeTime={formatRelativeTime}
                                t={t}
                                onMouseEnter={() => setHoveredSession(session.id)}
                                onMouseLeave={() => setHoveredSession(null)}
                                onDelete={handleDeleteSession}
                                onRename={handleRenameSession}
                                onAddToSplit={(s) => addToSplit({
                                  sessionId: s.id,
                                  title: s.title,
                                  workingDirectory: s.working_directory || "",
                                  projectName: s.project_name || "",
                                  mode: s.mode,
                                })}
                                onNavigate={() => setTestPanelOpen(false)}
                              />
                            );
                          })}

                          {/* Show more / Show less toggle */}
                          {shouldTruncate && (
                            <button
                              onClick={() => setExpandedSessionGroups(prev => {
                                const next = new Set(prev);
                                if (next.has(group.workingDirectory)) {
                                  next.delete(group.workingDirectory);
                                } else {
                                  next.add(group.workingDirectory);
                                }
                                return next;
                              })}
                              className="w-full py-1.5 text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                            >
                              {isSessionsExpanded
                                ? t('chatList.showLess' as TranslationKey)
                                : t('chatList.showMore' as TranslationKey, { count: String(hiddenCount) })
                              }
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          ))}
        </div>
      </ScrollArea>

      {/* Bottom: account chip + settings gear (horizontal row)
          (测试/文生图 已上移到切换栏下方,按 tab 绑定 — 2026-07 侧边栏改版) */}
      <div className="shrink-0 px-3 py-2 flex items-center gap-1">
        <UserMenu />
        <Link href="/settings" className="shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={`relative h-9 w-9 ${
              pathname.startsWith("/settings")
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={t('nav.settings' as TranslationKey)}
            aria-label={t('nav.settings' as TranslationKey)}
          >
            <Gear size={16} weight={pathname.startsWith("/settings") ? "fill" : "regular"} />
            {(hasUpdate || readyToInstall) && (
              <span
                className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${
                  readyToInstall ? "bg-primary" : "bg-primary animate-pulse"
                }`}
              />
            )}
          </Button>
        </Link>
      </div>

      {/* Folder Picker Dialog */}
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderSelect}
      />

    </aside>
  );
}

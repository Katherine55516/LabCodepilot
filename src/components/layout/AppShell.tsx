"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
// NavRail removed — navigation merged into ChatListPanel
import { ChatListPanel } from "./ChatListPanel";
import { ResizeHandle } from "./ResizeHandle";
import { UpdateDialog } from "./UpdateDialog";
import { FeatureAnnouncementDialog } from "./FeatureAnnouncementDialog";
import { UpdateBanner } from "./UpdateBanner";
import { UnifiedTopBar } from "./UnifiedTopBar";
import { PanelZone } from "./PanelZone";
import { PanelContext, type PreviewViewMode, type PreviewSource } from "@/hooks/usePanel";
import { UpdateContext } from "@/hooks/useUpdate";
import { useUpdateChecker } from "@/hooks/useUpdateChecker";
import { ImageGenContext, useImageGenState } from "@/hooks/useImageGen";
import { BatchImageGenContext, useBatchImageGenState } from "@/hooks/useBatchImageGen";
import { SplitContext, type SplitSession } from "@/hooks/useSplit";
import { SplitChatContainer } from "./SplitChatContainer";
import { ErrorBoundary } from "./ErrorBoundary";
import { getActiveSessionIds, getSnapshot } from "@/lib/stream-session-manager";
import { isAskTool } from "@/lib/tool-ask";
import { useGitStatus } from "@/hooks/useGitStatus";
import { SetupCenter } from '@/components/setup/SetupCenter';
import { Toaster } from '@/components/ui/toast';
import { useNotificationPoll } from '@/hooks/useNotificationPoll';
import { initTurnNotifications } from '@/lib/turn-notifications';
import { useGlobalSearchShortcut } from '@/hooks/useGlobalSearchShortcut';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import { InlineTestingPanel } from '@/components/test/InlineTestingPanel';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { LAST_NON_SETTINGS_PATH_KEY } from '@/lib/settings-route';

const SPLIT_SESSIONS_KEY = "codepilot:split-sessions";
const SPLIT_ACTIVE_COLUMN_KEY = "codepilot:split-active-column";

function loadSplitSessions(): SplitSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SPLIT_SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveSplitSessions(sessions: SplitSession[]) {
  if (sessions.length >= 2) {
    localStorage.setItem(SPLIT_SESSIONS_KEY, JSON.stringify(sessions));
  } else {
    localStorage.removeItem(SPLIT_SESSIONS_KEY);
    localStorage.removeItem(SPLIT_ACTIVE_COLUMN_KEY);
  }
}

function loadActiveColumn(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(SPLIT_ACTIVE_COLUMN_KEY) || "";
}

const EMPTY_SET = new Set<string>();
const CHATLIST_MIN = 180;
const CHATLIST_MAX = 300;

/**
 * Default view mode when a file is opened via setPreviewSource / setPreviewFile.
 *
 * Per user preference: every file lands in edit mode. PreviewPanel's render
 * branch combines edit + source for editable files (both route to CodeMirror,
 * which is editable), so this gives a consistent "click → editor" experience
 * regardless of extension. The ViewModeToggle still lets users flip to
 * "preview" (rendered) for .md / .html / .jsx / .tsx / .csv when needed —
 * we just no longer pick rendered as the default.
 *
 * For files whose extension isn't editable (binary-ish, or content past
 * EXTENSION_LINE_CAPS truncation), PreviewPanel's `canEdit` flag falls
 * through to SourceView automatically — no inconsistent state.
 *
 * The legacy RENDERED_EXTENSIONS allowlist (kept commented as a reference
 * for the previous behavior — restore by reverting this function and the
 * import) used to default .md/.html/.jsx/.tsx/.csv to "rendered".
 */
function defaultViewMode(_filePath: string): PreviewViewMode {
  return "edit";
}

const LG_BREAKPOINT = 1024;

// 侧边栏折叠偏好(手动点折叠按钮时写入;"1"=展开,"0"=收起)
const CHATLIST_OPEN_KEY = "codepilot_chatlist_open";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [chatListOpenRaw, setChatListOpenRaw] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialCard, setSetupInitialCard] = useState<'claude' | 'provider' | 'project' | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);

  useGlobalSearchShortcut(() => setSearchOpen(true));

  // Poll server-side notification queue and display as toasts
  useNotificationPoll();

  // Check if setup is needed — DISABLED.
  //
  // Claude Code is now bundled into the installer (v0.55+) and API providers
  // are pushed by the managed-account login system, so the three-card setup
  // wizard no longer matches the boot reality. Auto-popup is hidden; manual
  // entry points (open-setup-center custom event, /settings#providers hash
  // bridge below) still work for users who want the wizard.
  //
  // Restore by uncommenting the block below.
  // useEffect(() => {
  //   fetch('/api/setup')
  //     .then(r => r.ok ? r.json() : null)
  //     .then(data => {
  //       if (data && !data.completed) {
  //         setSetupOpen(true);
  //       }
  //     })
  //     .catch(() => {});
  // }, []);

  // 记录用户当前待着的页面,供 /settings 兼容层关掉后跳回(见 lib/settings-route.ts)。
  useEffect(() => {
    if (!pathname || pathname.startsWith('/settings')) return;
    try {
      sessionStorage.setItem(LAST_NON_SETTINGS_PATH_KEY, pathname + window.location.search);
    } catch {
      // sessionStorage 不可用 —— 兼容层会回落到 /chat
    }
  }, [pathname]);

  // Listen for open-setup-center events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSetupInitialCard(detail?.initialCard);
      setSetupOpen(true);
    };
    window.addEventListener('open-setup-center', handler);
    return () => window.removeEventListener('open-setup-center', handler);
  }, []);

  // Hash bridge: error messages render `[Open Settings](/settings#providers)`
  // markdown links as fallback when the frontend cannot directly dispatch the
  // open-setup-center event (e.g. rendering inside the SSE text stream). When
  // such a link is clicked the hash changes to `#providers`, and we surface
  // the SetupCenter Provider card here — EXCEPT on /settings itself, where
  // SettingsLayout owns the #providers hash for its own section routing
  // (see SettingsLayout.tsx `getSectionFromHash`). If we swallowed the hash
  // there, clicking "Add Provider" inside SetupCenter would ping-pong the
  // user back into SetupCenter instead of reaching the providers tab.
  useEffect(() => {
    const maybeOpenFromHash = () => {
      if (typeof window === 'undefined') return;
      if (window.location.pathname === '/settings') return;
      if (window.location.hash === '#providers') {
        setSetupInitialCard('provider');
        setSetupOpen(true);
        // Clear the hash so a second navigation to /#providers fires again.
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    maybeOpenFromHash();
    window.addEventListener('hashchange', maybeOpenFromHash);
    return () => window.removeEventListener('hashchange', maybeOpenFromHash);
  }, []);

  // Bridge managed-account changes → provider consumers.
  //
  // The Electron main process owns auth/managed-provider state and pushes
  // 'auth:changed' over IPC after login / logout / config sync. But the
  // renderer's provider consumers (model selector via useManagedMultimodal,
  // the new-chat model-init + hasProvider check in chat/page.tsx, the bridge
  // model selector, RuntimeBadge…) only refresh on the 'provider-changed'
  // window event. On a fresh re-login the managed providers get synced to the
  // DB but no 'provider-changed' ever fires, so an already-mounted model
  // selector keeps its stale pre-login result ("Claude Code" / "暂无托管配置")
  // until something remounts it. Re-broadcast managed-state transitions as
  // 'provider-changed' so every consumer re-fetches. No local state here → no
  // re-render of the shell. Outside Electron window.electronAPI is undefined
  // (browser dev) → the effect is a harmless no-op.
  useEffect(() => {
    const api = window.electronAPI?.auth;
    if (!api?.onChange) return;
    let prevCount: number | null = null;
    let prevAuth: boolean | null = null;
    const unsubscribe = api.onChange((s) => {
      const changed =
        prevCount === null ||
        s.managedConfigCount !== prevCount ||
        s.authenticated !== prevAuth;
      prevCount = s.managedConfigCount;
      prevAuth = s.authenticated;
      if (changed) {
        window.dispatchEvent(new Event('provider-changed'));
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen for open-global-search events from ChatListPanel
  useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener('open-global-search', handler);
    return () => window.removeEventListener('open-global-search', handler);
  }, []);

  // Sync with viewport after hydration to avoid SSR mismatch.
  // 用户通过侧边栏折叠按钮显式收起/展开过时(codepilot_chatlist_open),
  // 优先恢复该偏好;否则按视口断点。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = localStorage.getItem(CHATLIST_OPEN_KEY);
    setChatListOpenRaw(
      saved !== null ? saved === "1" : window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches
    );
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(240);

  // Restore persisted width after hydration
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = localStorage.getItem("codepilot_chatlist_width");
    if (saved) setChatListWidth(parseInt(saved));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((w) => Math.min(CHATLIST_MAX, Math.max(CHATLIST_MIN, w + delta)));
  }, []);
  const handleChatListResizeEnd = useCallback(() => {
    setChatListWidth((w) => {
      localStorage.setItem("codepilot_chatlist_width", String(w));
      return w;
    });
  }, []);

  // Panel state — chatListOpen is no longer gated by route (sidebar always visible)
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";
  const chatListOpen = chatListOpenRaw;

  const setChatListOpen = useCallback((open: boolean) => {
    setChatListOpenRaw(open);
  }, []);

  // 侧边栏折叠按钮(ChatListPanel 顶行/折叠细栏)— 翻转并记住显式偏好
  const toggleChatList = useCallback(() => {
    setChatListOpenRaw((prev) => {
      const next = !prev;
      localStorage.setItem(CHATLIST_OPEN_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  // --- New independent panel states ---
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [taskListOpen, setTaskListOpen] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [dashboardPanelOpen, setDashboardPanelOpen] = useState(false);
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);
  const [isAssistantWorkspace, setIsAssistantWorkspace] = useState(false);
  // E4 (cowork): 当前会话是否办公(沙箱)会话 — 压制 PanelZone 与顶栏研发按钮
  const [isOfficeSession, setIsOfficeSession] = useState(false);
  const [testPanelOpen, setTestPanelOpenRaw] = useState(false);
  // 打开测试工作台时锚定「当前对话」。修复用户单栏「点报告过几秒自动跳回同一对话」：底下
  // /chat/[id] page 在 loading→加载完才【首次挂载】ChatView，其 setTestPanelOpen(false)
  // effect 挂载即无条件关掉了几秒前打开的工作台。有了 baseSession，ChatView 只在【导航到别的
  // 对话】(sessionId≠base) 时才关工作台，同一对话的异步首次挂载不再误关。
  const [testPanelBaseSession, setTestPanelBaseSession] = useState("");
  const setTestPanelOpen = useCallback((v: boolean) => {
    if (v) {
      const m = window.location.pathname.match(/^\/chat\/([^/]+)/);
      setTestPanelBaseSession(m ? decodeURIComponent(m[1]) : "");
    }
    setTestPanelOpenRaw(v);
  }, []);
  // 测试工作台「保活」：一旦打开过就保持挂载（不随路由切换卸载），避免执行进行中切到
  // 设置页再切回时，InlineTestingPanel 卸载导致 SSE 中断 + 重挂载时把持久化的 running
  // 僵尸态规整成 error（显示「失败」）。可见性由下方 testPanelOpen && isChatRoute 用 CSS
  // 控制（display:contents ↔ hidden），组件实例与内部 state、in-flight fetch 全程保留。
  const [testEverOpened, setTestEverOpened] = useState(false);

  // --- Git summary (derived from polling hook, no setState needed) ---
  const [currentWorktreeLabel, setCurrentWorktreeLabel] = useState("");

  const [workingDirectory, setWorkingDirectory] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  const { status: gitStatusFromHook } = useGitStatus(workingDirectory);
  const currentBranch = gitStatusFromHook?.branch ?? "";
  const gitDirtyCount = gitStatusFromHook?.changedFiles.filter(f => f.status !== 'untracked').length ?? 0;

  // --- Multi-session stream tracking (driven by stream-session-manager) ---
  const [activeStreamingSessions, setActiveStreamingSessions] = useState<Set<string>>(EMPTY_SET);
  const [pendingApprovalSessionIds, setPendingApprovalSessionIds] = useState<Set<string>>(EMPTY_SET);
  const [pendingQuestionSessionIds, setPendingQuestionSessionIds] = useState<Set<string>>(EMPTY_SET);

  // Listen for global stream events from stream-session-manager
  useEffect(() => {
    const handler = () => {
      const activeIds = getActiveSessionIds();
      setActiveStreamingSessions(activeIds.length > 0 ? new Set(activeIds) : EMPTY_SET);

      const approvals = new Set<string>();
      // AskUserQuestion waits split out from generic permission approvals —
      // the sidebar shows a raised-hand icon for "Claude is asking you a
      // question" (Claude-Desktop parity), distinct from the approval bell.
      const questions = new Set<string>();
      for (const sid of activeIds) {
        const snap = getSnapshot(sid);
        if (snap?.pendingPermission && !snap.permissionResolved) {
          if (isAskTool(snap.pendingPermission.toolName)) {
            questions.add(sid);
          } else {
            approvals.add(sid);
          }
        }
      }
      setPendingApprovalSessionIds(approvals.size > 0 ? approvals : EMPTY_SET);
      setPendingQuestionSessionIds(questions.size > 0 ? questions : EMPTY_SET);
    };
    window.addEventListener('stream-session-event', handler);
    return () => window.removeEventListener('stream-session-event', handler);
  }, []);

  // --- Split-screen state ---
  const [splitSessions, setSplitSessions] = useState<SplitSession[]>(() => loadSplitSessions());
  const [activeColumnId, setActiveColumnIdRaw] = useState<string>(() => loadActiveColumn());
  const isSplitActive = splitSessions.length >= 2;
  const isChatDetailRoute = pathname.startsWith("/chat/") || isSplitActive;

  // Persist split sessions to localStorage
  useEffect(() => {
    saveSplitSessions(splitSessions);
    if (activeColumnId) {
      localStorage.setItem(SPLIT_ACTIVE_COLUMN_KEY, activeColumnId);
    }
  }, [splitSessions, activeColumnId]);

  // URL sync: when activeColumn changes, update router
  useEffect(() => {
    // 分屏激活时把 URL 纠偏到 activeColumn 那一列。但测试工作台常驻在全屏覆盖层（同样挂在
    // /chat 路由下、不改 pathname），这个纠偏会把用户从「测试报告」等页面自动弹回对话
    // （用户报的「点报告过几秒自动跳走」）。
    //
    // 第一道守卫（软）：工作台开着就不同步。它依赖 testPanelOpen 的【瞬时值】——有几条路径
    // 能在它恰为 false 的一拍让本 effect 重跑并绕过它：①用户点主会话列表某条 → onNavigate
    // 同步 setTestPanelOpen(false)；②应用启动/刷新时从 localStorage 恢复出 isSplitActive=true
    // 但 pathname 还没对上、而 testPanelOpen 初值就是 false。用户重打新包后仍复现，正是这道
    // 软守卫挡不住这些时序。
    if (testPanelOpen) return;
    if (isSplitActive && activeColumnId) {
      // 第二道守卫（强、对 testPanelOpen 时序免疫）：只有当【当前 pathname 已经是分屏里某一
      // 成员的对话页】时，才把 URL 纠偏到 activeColumn —— 这是分屏内切换聚焦列的正常同步。
      // 若当前不在任何分屏成员页上（例如停在 /chat 根：测试工作台覆盖层就挂在这里；或用户刚
      // 导航到分屏之外的新对话），一律尊重现状、绝不 replace。这样无论 testPanelOpen 瞬时是
      // true 还是 false，只要人不在分屏成员页上就不会被弹走，从根上堵住「点报告过几秒跳回对话」。
      const onSplitMemberPage = splitSessions.some((s) => pathname === `/chat/${s.sessionId}`);
      if (!onSplitMemberPage) return;
      const target = `/chat/${activeColumnId}`;
      if (pathname !== target) {
        router.replace(target);
      }
    }
  }, [isSplitActive, activeColumnId, pathname, router, testPanelOpen, splitSessions]);

  const setActiveColumn = useCallback((sessionId: string) => {
    setActiveColumnIdRaw(sessionId);
  }, []);

  const addToSplit = useCallback((session: SplitSession) => {
    setSplitSessions((prev) => {
      if (prev.some((s) => s.sessionId === session.sessionId)) return prev;

      if (prev.length < 2) {
        const currentSessionId = sessionId;
        if (currentSessionId && currentSessionId !== session.sessionId) {
          const currentSession: SplitSession = {
            sessionId: currentSessionId,
            title: sessionTitle || "New Conversation",
            workingDirectory: workingDirectory || "",
            projectName: "",
            mode: "code",
          };
          const hasCurrentAlready = prev.some((s) => s.sessionId === currentSessionId);
          const next = hasCurrentAlready ? [...prev, session] : [...prev, currentSession, session];
          setActiveColumnIdRaw(session.sessionId);
          return next;
        }
      }

      const next = [...prev, session];
      setActiveColumnIdRaw(session.sessionId);
      return next;
    });
  }, [sessionId, sessionTitle, workingDirectory]);

  const pendingNavigateRef = useRef<string | null>(null);

  const removeFromSplit = useCallback((removeId: string) => {
    setSplitSessions((prev) => {
      const next = prev.filter((s) => s.sessionId !== removeId);
      if (next.length <= 1) {
        if (next.length === 1) {
          pendingNavigateRef.current = next[0].sessionId;
        }
        return [];
      }
      setActiveColumnIdRaw((currentActive) =>
        currentActive === removeId ? next[0].sessionId : currentActive
      );
      return next;
    });
  }, []);

  useEffect(() => {
    if (pendingNavigateRef.current) {
      const target = pendingNavigateRef.current;
      pendingNavigateRef.current = null;
      router.replace(`/chat/${target}`);
    }
  }, [splitSessions, router]);

  const exitSplit = useCallback(() => {
    const firstSession = splitSessions[0];
    setSplitSessions([]);
    setActiveColumnIdRaw("");
    if (firstSession) {
      router.replace(`/chat/${firstSession.sessionId}`);
    }
  }, [splitSessions, router]);

  const isInSplit = useCallback((sid: string) => {
    return splitSessions.some((s) => s.sessionId === sid);
  }, [splitSessions]);

  useEffect(() => {
    const handler = () => {
      setSplitSessions((prev) => prev);
    };
    window.addEventListener("session-deleted", handler);
    return () => window.removeEventListener("session-deleted", handler);
  }, []);

  useEffect(() => {
    if (isSplitActive && !pathname.startsWith("/chat")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSplitSessions([]);
      setActiveColumnIdRaw("");
    }
  }, [pathname, isSplitActive]);

  // Turn-completion / ask-question system notifications (Claude-Desktop-style).
  // Click-to-navigate must be SPLIT-AWARE: with split mode active, a plain
  // router.push to a split-member session gets bounced back by the URL-sync
  // corrective effect above (and the split container ignores the URL anyway),
  // which read as "clicking the notification does nothing". So: member
  // session → switch the active column (the split UX for "jump to it");
  // non-member → exit split and navigate (the click is an explicit
  // take-me-there intent). initTurnNotifications always adopts the latest
  // callback, so stale closures over split state are not a concern.
  useEffect(() => {
    initTurnNotifications((sessionId) => {
      if (splitSessions.some((s) => s.sessionId === sessionId)) {
        setActiveColumn(sessionId);
      } else {
        if (isSplitActive) exitSplit();
        router.push(`/chat/${sessionId}`);
      }
    });
  }, [router, splitSessions, isSplitActive, setActiveColumn, exitSplit]);

  const splitContextValue = useMemo(
    () => ({
      splitSessions,
      activeColumnId,
      isSplitActive,
      addToSplit,
      removeFromSplit,
      setActiveColumn,
      exitSplit,
      isInSplit,
    }),
    [splitSessions, activeColumnId, isSplitActive, addToSplit, removeFromSplit, setActiveColumn, exitSplit, isInSplit]
  );

  // Warn before closing window/tab while any session is streaming
  useEffect(() => {
    if (activeStreamingSessions.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeStreamingSessions]);

  // --- Doc Preview state ---
  // Primary state is `previewSource` (Phase 1.5). `previewFile` is a derived
  // view for legacy consumers (FileTreePanel toggle logic etc.). The adapter
  // is one-way: setPreviewFile always produces kind:'file' sources, but
  // callers can observe that an inline-* source makes previewFile appear null.
  const [previewSource, setPreviewSourceRaw] = useState<PreviewSource | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");

  const previewFile: string | null =
    previewSource?.kind === "file" ? previewSource.filePath : null;

  const setPreviewSource = useCallback((source: PreviewSource | null) => {
    setPreviewSourceRaw(source);
    if (source) {
      // File sources respect the extension-based default view mode.
      // Inline sources are always "rendered" — there's no raw path to show
      // for source view, and all inline variants are meaningful only rendered.
      if (source.kind === "file") {
        setPreviewViewMode(defaultViewMode(source.filePath));
      } else {
        setPreviewViewMode("rendered");
      }
      setPreviewOpen(true);
    } else {
      setPreviewOpen(false);
    }
  }, []);

  const setPreviewFile = useCallback(
    (path: string | null) => {
      if (path === null) {
        setPreviewSource(null);
      } else {
        setPreviewSource({ kind: "file", filePath: path });
      }
    },
    [setPreviewSource],
  );

  // Reset doc preview and panels when navigating between pages/sessions
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPreviewSourceRaw(null);
    setPreviewOpen(false);
  }, [pathname]);
  // 测试工作台首次打开后置位「曾打开」，之后常驻挂载（不再随 testPanelOpen 卸载）。
  useEffect(() => {
    if (testPanelOpen) setTestEverOpened(true);
  }, [testPanelOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep chat list state in sync when resizing across the breakpoint.
  // 缩窄一律收起(<lg 时 aside 本来就被 CSS hidden);放宽只在用户没有
  // 显式折叠(偏好≠"0")时自动展开,不覆盖手动折叠的意图。
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => {
      if (!e.matches) setChatListOpenRaw(false);
      else if (localStorage.getItem(CHATLIST_OPEN_KEY) !== "0") setChatListOpenRaw(true);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);


  // --- Skip-permissions indicator ---
  const [skipPermissionsActive, setSkipPermissionsActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const doFetch = async () => {
      try {
        const res = await fetch("/api/settings/app");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSkipPermissionsActive(data.settings?.dangerously_skip_permissions === "true");
        }
      } catch { /* ignore */ }
    };
    doFetch();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") doFetch();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", doFetch);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", doFetch);
    };
  }, []);

  // --- Update checker (native Electron + browser fallback) ---
  const updateContextValue = useUpdateChecker();

  const panelContextValue = useMemo(
    () => ({
      fileTreeOpen,
      setFileTreeOpen,
      taskListOpen,
      setTaskListOpen,
      gitPanelOpen,
      setGitPanelOpen,
      previewOpen,
      setPreviewOpen,
      terminalOpen,
      setTerminalOpen,
      dashboardPanelOpen,
      setDashboardPanelOpen,
      assistantPanelOpen,
      setAssistantPanelOpen,
      isAssistantWorkspace,
      setIsAssistantWorkspace,
      isOfficeSession,
      setIsOfficeSession,
      testPanelOpen,
      setTestPanelOpen,
      testPanelBaseSession,
      currentBranch,
      gitDirtyCount,
      currentWorktreeLabel,
      setCurrentWorktreeLabel,
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,
      activeStreamingSessions,
      pendingApprovalSessionIds,
      pendingQuestionSessionIds,
      previewSource,
      setPreviewSource,
      previewFile,
      setPreviewFile,
      previewViewMode,
      setPreviewViewMode,
    }),
    [fileTreeOpen, taskListOpen, gitPanelOpen, previewOpen, terminalOpen, dashboardPanelOpen, assistantPanelOpen, isAssistantWorkspace, isOfficeSession, testPanelOpen, testPanelBaseSession, currentBranch, gitDirtyCount, currentWorktreeLabel, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, activeStreamingSessions, pendingApprovalSessionIds, pendingQuestionSessionIds, previewSource, setPreviewSource, previewFile, setPreviewFile, previewViewMode]
  );

  const imageGenValue = useImageGenState();
  const batchImageGenValue = useBatchImageGenState();

  return (
    <UpdateContext.Provider value={updateContextValue}>
      <PanelContext.Provider value={panelContextValue}>
        <SplitContext.Provider value={splitContextValue}>
        <ImageGenContext.Provider value={imageGenValue}>
        <BatchImageGenContext.Provider value={batchImageGenValue}>
        <TooltipProvider delayDuration={300}>
          <div className="flex h-screen overflow-hidden">
            <ErrorBoundary>
              <ChatListPanel
                open={chatListOpen}
                onToggle={toggleChatList}
                width={chatListWidth}
                hasUpdate={updateContextValue.updateInfo?.updateAvailable ?? false}
                readyToInstall={updateContextValue.updateInfo?.readyToInstall ?? false}
              />
            </ErrorBoundary>
            {chatListOpen && (
              <ResizeHandle side="left" onResize={handleChatListResize} onResizeEnd={handleChatListResizeEnd} />
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <UnifiedTopBar />
              <UpdateBanner />
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <main className="relative flex-1 overflow-hidden">
                    {isSplitActive ? (
                      <SplitChatContainer />
                    ) : (
                      <ErrorBoundary>{children}</ErrorBoundary>
                    )}
                    {/* 测试工作台常驻（保活）：一旦打开过就保持挂载，跨路由不卸载。可见性
                        用 CSS 切换 —— 显示时 display:contents（面板自身 absolute inset-0
                        盖满本 relative main），隐藏时 display:none（组件实例、内部 state、
                        in-flight 执行全程保留，仅不渲染视觉）。非 chat 路由（如设置页）隐藏，
                        让 children 正常显示；切回 chat 再显示，执行进度不丢。 */}
                    {testEverOpened && (
                      <div className={testPanelOpen && isChatRoute ? "contents" : "hidden"}>
                        <InlineTestingPanel />
                      </div>
                    )}
                  </main>
                </div>
                {/* Hide all side panels while the test workbench is open — it's a
                    full-content takeover. PanelZone is a sibling of <main> (which
                    holds the workbench overlay), so without this the file/git/etc.
                    panel would stay visible to the right of the overlay. Panel
                    open-state is preserved (only the render is gated), so closing
                    the workbench restores the previous layout. */}
                {/* E4 (cowork): 办公会话压制全部侧边研发面板(文件树/Git/任务/
                    预览/看板/助理)— 面板状态保留,切回研发会话原样恢复 */}
                {isChatDetailRoute && !testPanelOpen && !isOfficeSession && <PanelZone />}
              </div>
            </div>
          </div>
          <UpdateDialog />
          <FeatureAnnouncementDialog />
          <Toaster />
          <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
          {/* 设置弹窗 —— 全局唯一,由 'open-settings' 事件唤起(侧栏齿轮 / 各处深链) */}
          <SettingsDialog />
          {setupOpen && (
            <SetupCenter
              onClose={() => setSetupOpen(false)}
              initialCard={setupInitialCard}
            />
          )}
        </TooltipProvider>
        </BatchImageGenContext.Provider>
        </ImageGenContext.Provider>
        </SplitContext.Provider>
      </PanelContext.Provider>
    </UpdateContext.Provider>
  );
}

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  GitBranch,
  TreeStructure,
  ListChecks,
  PencilSimple,
  DotOutline,
  ChartBar,
  Brain,
  Clock,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { useClientPlatform } from '@/hooks/useClientPlatform';
import { showToast } from '@/hooks/useToast';
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, type Species } from '@/lib/buddy';
import { stashRoutineDraft, stripFileMeta } from '@/lib/routine-draft';
import type { TranslationKey } from '@/i18n';

export function UnifiedTopBar() {
  const {
    sessionTitle,
    setSessionTitle,
    sessionId,
    workingDirectory,
    fileTreeOpen,
    setFileTreeOpen,
    taskListOpen,
    setTaskListOpen,
    gitPanelOpen,
    setGitPanelOpen,
    dashboardPanelOpen,
    setDashboardPanelOpen,
    assistantPanelOpen,
    setAssistantPanelOpen,
    isAssistantWorkspace,
    isOfficeSession,
    currentBranch,
    gitDirtyCount,
  } = usePanel();
  const { t } = useTranslation();
  const router = useRouter();
  const { isWindows } = useClientPlatform();

  /**
   * 「存为定时任务」:取本次会话的**最后一条用户指令**作为预填,跳到新建表单。
   *
   * 预填走 sessionStorage 而不是 URL 参数 —— 指令动辄几百字,塞进 URL 既难看又可能超长;
   * 而且它只是「这一次跳转」的临时数据,不该留在地址栏里被复制传播。
   */
  const saveSessionAsRoutine = useCallback(async (sid: string, title: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sid}/messages?limit=200`);
      const data = res.ok ? await res.json() : { messages: [] };
      const lastUser = [...(data.messages || [])].reverse()
        .find((m: { role: string; content: string }) => m.role === 'user');
      // 取不到就跳空表单 —— 比拦下来报错好:用户本来就可以自己写
      stashRoutineDraft({ prompt: stripFileMeta(lastUser?.content || ''), name: title || '' });
    } catch {
      stashRoutineDraft({ prompt: '', name: title || '' });
    }
    router.push('/routines?new=1');
  }, [router]);
  const [assistantName, setAssistantName] = useState('');
  const [buddyEmoji, setBuddyEmoji] = useState('');
  const [buddySpecies, setBuddySpecies] = useState('');

  useEffect(() => {
    if (!isAssistantWorkspace) return;
    let cancelled = false;
    fetch('/api/workspace/summary')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) { setAssistantName(data?.name || ''); setBuddyEmoji(data?.buddy?.emoji || ''); setBuddySpecies(data?.buddy?.species || ''); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAssistantWorkspace]);
  const pathname = usePathname();

  // Only show Git/terminal/panel controls on chat detail routes (/chat/[id]),
  // not on the empty /chat page where panels aren't mounted.
  const isChatRoute = pathname.startsWith("/chat/") && pathname !== "/chat";

  // --- Title editing ---
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleStartEditTitle = useCallback(() => {
    setEditTitle(sessionTitle || t('chat.newConversation'));
    setIsEditingTitle(true);
  }, [sessionTitle, t]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setIsEditingTitle(false);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setSessionTitle(trimmed);
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { id: sessionId, title: trimmed } }));
      }
    } catch {
      showToast({ type: 'error', message: t('error.titleSaveFailed') });
    }
    setIsEditingTitle(false);
  }, [editTitle, sessionId, setSessionTitle, t]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  }, [handleSaveTitle]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Extract project name from working directory
  const projectName = workingDirectory ? workingDirectory.split(/[\\/]/).filter(Boolean).pop() || '' : '';

  // On non-chat routes (incl. the /chat index, where the 测试工作台 overlay can
  // render), draw only a drag region — no visible bar.
  //
  // On Windows the frameless window stamps the system controls (min/max/close,
  // ~138px wide) into the top-right of the viewport via titleBarOverlay
  // (electron/main.ts, height 44). Content rendered below this strip — e.g. the
  // 测试工作台 header's model picker, which lives in an `absolute inset-0`
  // overlay mounted just under this bar — would otherwise sit *under* those
  // buttons and become unclickable. So on Windows reserve the full overlay
  // height (via the Window-Controls-Overlay env var, with a 44px fallback that
  // matches titleBarOverlay.height) to push that content clear of the buttons.
  // mac (traffic light, top-left) and linux (no overlay) keep the thin 12px
  // strip — just enough for window dragging.
  if (!isChatRoute) {
    return (
      <div
        className="shrink-0"
        style={{
          WebkitAppRegion: 'drag',
          height: isWindows ? 'env(titlebar-area-height, 44px)' : '0.75rem',
        } as React.CSSProperties}
      />
    );
  }

  return (
    <>
      <div
        className="flex h-12 shrink-0 items-center gap-2 bg-background px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: chat title + project folder */}
        <div
          className="flex items-center gap-1.5 min-w-0 shrink"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isChatRoute && sessionTitle && (
            isEditingTitle ? (
              <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <Input
                  ref={titleInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={handleSaveTitle}
                  className="h-7 text-sm max-w-[200px]"
                />
              </div>
            ) : (
              <div className="flex items-center gap-1 cursor-default max-w-[200px]">
                <h2 className="text-sm font-medium text-foreground/80 truncate">
                  {sessionTitle}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleStartEditTitle}
                  className="shrink-0 h-auto w-auto p-0.5"
                >
                  <PencilSimple size={12} className="text-muted-foreground" />
                </Button>
              </div>
            )
          )}

          {/* E4 (cowork): 办公会话隐藏项目文件夹 chip —— 它会显示宿主暂存
              目录名(=会话 id),对用户是噪音;办公不绑项目文件夹。 */}
          {isChatRoute && projectName && sessionTitle && !isOfficeSession && (
            <span className="text-xs text-muted-foreground/60 shrink-0">/</span>
          )}

          {isChatRoute && projectName && !isOfficeSession && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground/60 shrink-0 hover:text-foreground transition-colors h-auto p-0"
                  onClick={() => {
                    if (workingDirectory) {
                      if (window.electronAPI?.shell?.openPath) {
                        window.electronAPI.shell.openPath(workingDirectory);
                      } else {
                        fetch('/api/files/open', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: workingDirectory }),
                        }).catch(() => {});
                      }
                    }
                  }}
                >
                  {projectName}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs break-all">{workingDirectory}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: action buttons */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* P7:办公会话的「存为定时任务」——从现有对话固化。
              这条路径的价值在于**时机**:用户刚看到满意的结果,正是「以后每天都这样」
              的念头最强的时刻,而这时让他去侧边栏另起一个新建表单、把指令重打一遍,
              念头就凉了。点它带着本次会话的最后一条指令跳到新建表单,原会话不受影响。 */}
          {isChatRoute && isOfficeSession && sessionId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => saveSessionAsRoutine(sessionId, sessionTitle)}
                >
                  <Clock size={16} />
                  <span className="text-xs">{t('routines.saveAsRoutine' as TranslationKey)}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{t('routines.saveAsRoutineHint' as TranslationKey)}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* E4 (cowork): 办公会话隐藏全部研发面板按钮(Git/文件树/任务/看板)
              —— 面板本体已由 AppShell 的 PanelZone gate 压制,按钮同步消失。 */}
          {isChatRoute && !isOfficeSession && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={gitPanelOpen ? "secondary" : "ghost"}
                    size="sm"
                    className={`h-7 gap-1 px-1.5 ${gitPanelOpen ? "" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setGitPanelOpen(!gitPanelOpen)}
                  >
                    <GitBranch size={16} />
                    {currentBranch && (
                      <span className="text-xs max-w-[100px] truncate">{currentBranch}</span>
                    )}
                    {gitDirtyCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-amber-500">
                        <DotOutline size={10} weight="fill" />
                        {gitDirtyCount}
                      </span>
                    )}
                    <span className="sr-only">{t('topBar.git')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.git')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={fileTreeOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={fileTreeOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setFileTreeOpen(!fileTreeOpen)}
                  >
                    <TreeStructure size={16} />
                    <span className="sr-only">{t('topBar.fileTree')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.fileTree')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={taskListOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={taskListOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setTaskListOpen(!taskListOpen)}
                  >
                    <ListChecks size={16} />
                    <span className="sr-only">{t('topBar.taskList')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.taskList')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={dashboardPanelOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={dashboardPanelOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setDashboardPanelOpen(!dashboardPanelOpen)}
                  >
                    {isAssistantWorkspace
                      ? <img
                          src={buddySpecies ? (SPECIES_IMAGE_URL[buddySpecies as Species] || '') : EGG_IMAGE_URL}
                          alt="" width={16} height={16} className="rounded-sm"
                        />
                      : <ChartBar size={16} />}
                    <span className="sr-only">{t('topBar.dashboard')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isAssistantWorkspace ? 'Assistant' : t('topBar.dashboard')}
                </TooltipContent>
              </Tooltip>
            </>
          )}
          {/* Windows: reserve the top-right strip occupied by the frameless
              window's system controls (min/max/close) so the right-hand actions
              above aren't covered. Width tracks the actual controls via the
              Window-Controls-Overlay env vars (controls width = viewport −
              titlebar-area width − its x offset); 138px fallback matches the
              default control cluster when the env vars aren't resolved. mac's
              traffic light is top-left (handled by hiddenInset), linux has no
              overlay — so this is Windows-only. */}
          {isWindows && (
            <div
              className="shrink-0"
              style={{ width: 'calc(100vw - env(titlebar-area-width, calc(100vw - 138px)) - env(titlebar-area-x, 0px))' }}
            />
          )}
        </div>
      </div>
    </>
  );
}

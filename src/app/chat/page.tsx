'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Message, SSEEvent, SessionResponse, TokenUsage, PermissionRequestEvent, FileAttachment, MentionRef } from '@/types';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput } from '@/components/chat/MessageInput';
import { ChatComposerActionBar } from '@/components/chat/ChatComposerActionBar';
import { ModeIndicator } from '@/components/chat/ModeIndicator';
import { ChatPermissionSelector } from '@/components/chat/ChatPermissionSelector';
import { ImageGenToggle } from '@/components/chat/ImageGenToggle';
import { PermissionPrompt } from '@/components/chat/PermissionPrompt';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { OfficeEmptyCard } from '@/components/layout/OfficeEmptyCard';
import { loadWorkspaceTab, saveWorkspaceTab, type WorkspaceTab } from '@/components/layout/chat-list-utils';
import { OnboardingWizard } from '@/components/assistant/OnboardingWizard';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FolderPicker } from '@/components/chat/FolderPicker';
import { useNativeFolderPicker } from '@/hooks/useNativeFolderPicker';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import { maybeShowStatusToast } from '@/hooks/useSSEStream';
import { seedSnapshotPatch } from '@/lib/stream-session-manager';
import { warmSdkCommandCache } from '@/lib/sdk-init-cache';
import { NEW_CHAT_PREFILL_KEY } from '@/lib/constants/chat-prefill';
import { buildFilesDisplayContent } from '@/lib/file-utils';
import { parseMessageContent } from '@/types';
import { BtwPanel } from '@/components/chat/BtwPanel';
import { useBtw } from '@/hooks/useBtw';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Pick the provider group to default-select when the user has no saved choice
 * and no account-delivered global default. Prefers the first CONFIGURED
 * provider (account-managed / BYOK) that actually has models, because the
 * built-in 'env' "Claude Code" group is listed first but is NOT part of the
 * account-delivered model list — defaulting to it surprises managed users who
 * never see "Claude Code" in their list. Falls back to the first group (env, or
 * whatever exists) only when no other provider has models, so env-only / local
 * setups are unaffected.
 */
function pickDefaultProviderGroup<T extends { provider_id: string; models?: Array<unknown> }>(
  groups: T[],
): T {
  // Callers guard against empty `groups` before calling, matching the previous
  // `|| groups[0]` convention.
  return (
    groups.find((g) => g.provider_id !== 'env' && (g.models?.length ?? 0) > 0) ||
    groups[0]
  );
}

export default function NewChatPage() {
  const router = useRouter();
  // Read the one-shot prefill once on mount. Prefer sessionStorage (set by the
  // caller right before an SPA navigation — reliable across App Router client
  // nav and inside the packaged Electron window) and fall back to the
  // ?prefill= query string for backward compatibility / hard navigations.
  // Avoids useSearchParams, which would require a Suspense boundary.
  const prefillText = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      const stored = sessionStorage.getItem(NEW_CHAT_PREFILL_KEY);
      if (stored) {
        sessionStorage.removeItem(NEW_CHAT_PREFILL_KEY);
        return stored;
      }
    } catch {
      /* sessionStorage unavailable — fall through to URL param */
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('prefill') || '';
  }, []);
  const { setPendingApprovalSessionId } = usePanel();
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinkingContent, setStreamingThinkingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [workingDir, setWorkingDir] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{ message: string; description?: string } | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [hasProvider, setHasProvider] = useState(true); // assume true until checked
  const [showWizard, setShowWizard] = useState(false);
  const [assistantConfigured, setAssistantConfigured] = useState(false);
  const [assistantWorkspacePath, setAssistantWorkspacePath] = useState('');
  const [mode, setMode] = useState('code');

  // E4 (cowork): 办公 tab 下的落地页变体 —— 显示「开始办公对话」引导卡,
  // 替代研发的「项目对话/选择文件夹」。tab 初值读 localStorage,侧边栏切换
  // 经 'workspace-tab-changed' 事件实时同步;cowork 可用性走状态 API(fail-closed)。
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(() => loadWorkspaceTab());
  const [coworkAvailable, setCoworkAvailable] = useState(false);
  const [coworkImageProvisioned, setCoworkImageProvisioned] = useState(true);
  const [creatingOffice, setCreatingOffice] = useState(false);

  useEffect(() => {
    fetch('/api/cowork/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCoworkAvailable(!!d.enabled);
        setCoworkImageProvisioned(!!d.imageProvisioned);
      })
      .catch(() => {});
    const onTabChange = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (tab === 'office' || tab === 'dev') setWorkspaceTab(tab);
    };
    window.addEventListener('workspace-tab-changed', onTabChange);
    return () => window.removeEventListener('workspace-tab-changed', onTabChange);
  }, []);

  // E4.1 (用户反馈问题2): 带预填跳到 /chat(设置-CLI工具「添加工具」等)是
  // 研发工作流 —— 强制切回研发 tab(连同侧边栏,经事件同步),否则办公
  // landing 会替换掉预填输入界面。
  useEffect(() => {
    if (!prefillText) return;
    if (loadWorkspaceTab() !== 'dev') {
      saveWorkspaceTab('dev');
      setWorkspaceTab('dev');
      window.dispatchEvent(new CustomEvent('workspace-tab-changed', { detail: 'dev' }));
    }
  }, [prefillText]);

  const handleStartOfficeSession = useCallback(async () => {
    setCreatingOffice(true);
    try {
      const model = localStorage.getItem('codepilot:last-model') || '';
      const provider_id = localStorage.getItem('codepilot:last-provider-id') || '';
      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandbox_enabled: 1, model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent('session-created'));
        router.push(`/chat/${data.session.id}`);
      }
    } catch {
      // Silently fail (same convention as openFolderAsNewSession)
    } finally {
      setCreatingOffice(false);
    }
  }, [router]);

  // Model/provider start empty — populated by the async global-default fetch.
  // This prevents the race where a user sends before the fetch completes and
  // gets the stale localStorage model instead of the configured default.
  const [modelReady, setModelReady] = useState(false);
  const [currentModel, setCurrentModel] = useState(() => {
    if (typeof window === 'undefined') return '';
    // One-time migration: clear stale model/provider from pre-0.38 installs
    if (!localStorage.getItem('codepilot:migration-038')) {
      localStorage.removeItem('codepilot:last-model');
      localStorage.removeItem('codepilot:last-provider-id');
      localStorage.setItem('codepilot:migration-038', '1');
    }
    return '';
  });
  const [currentProviderId, setCurrentProviderId] = useState(() => {
    if (typeof window === 'undefined') return '';
    if (!localStorage.getItem('codepilot:migration-038')) {
      return '';
    }
    return '';
  });
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [permissionProfile, setPermissionProfile] = useState<'default' | 'full_access'>('default');
  const [createdSessionId, setCreatedSessionId] = useState<string | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  // Effort level — lifted here so the first message includes it
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>(undefined);
  // Provider options (thinking mode + 1M context)
  const [thinkingMode, setThinkingMode] = useState<string>('adaptive');
  const [context1m, setContext1m] = useState(false);

  // Prewarm the slash popover's SDK-command cache (CLI built-ins like
  // /simplify are invisible to the filesystem scan; the new-chat page is
  // exactly where they'd otherwise be missing). Once per page load — the
  // ChatView mount on /chat/[id] fires the same guarded call.
  useEffect(() => { warmSdkCommandCache(); }, []);

  // Fetch provider-specific options (with abort to prevent stale responses on fast switch)
  useEffect(() => {
    const pid = currentProviderId || 'env';
    const controller = new AbortController();
    fetch(`/api/providers/options?providerId=${encodeURIComponent(pid)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted) {
          setThinkingMode(data?.options?.thinking_mode || 'adaptive');
          setContext1m(!!data?.options?.context_1m);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [currentProviderId]);

  // Validate restored model/provider against actual available providers/models.
  // For NEW conversations, the global default model takes priority
  // over localStorage's last-model (which is a cross-session global memory).
  useEffect(() => {
    let cancelled = false;

    // Fetch models and global default in parallel
    const modelsP = fetch('/api/providers/models').then(r => r.ok ? r.json() : null);
    const globalP = fetch('/api/providers/options?providerId=__global__').then(r => r.ok ? r.json() : null);

    Promise.all([modelsP, globalP]).then(([modelsData, globalData]) => {
      if (cancelled || !modelsData?.groups || modelsData.groups.length === 0) {
        // No provider data — fall back to localStorage best-effort
        const savedModel = localStorage.getItem('codepilot:last-model') || '';
        const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
        setCurrentModel(savedModel);
        setCurrentProviderId(savedProvider);
        setModelReady(true);
        return;
      }
      const groups = modelsData.groups as Array<{ provider_id: string; models: Array<{ value: string }> }>;
      const globalDefaultModel = globalData?.options?.default_model || '';
      const globalDefaultProvider = globalData?.options?.default_model_provider || '';

      // Apply global default for new conversations
      // Case 1: both provider and model are set and valid
      if (globalDefaultModel && globalDefaultProvider) {
        const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
        const modelValid = targetGroup?.models.some(m => m.value === globalDefaultModel);
        if (modelValid) {
          setCurrentModel(globalDefaultModel);
          setCurrentProviderId(globalDefaultProvider);
          setModelReady(true);
          return;
        }
      }
      // Case 2: provider is set but model was cleared (e.g. after doctor repair / provider delete)
      // → use that provider's first available model
      if (globalDefaultProvider && !globalDefaultModel) {
        const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
        if (targetGroup?.models?.length) {
          setCurrentModel(targetGroup.models[0].value);
          setCurrentProviderId(globalDefaultProvider);
          setModelReady(true);
          return;
        }
      }

      // No global default — use localStorage, validate against provider's list
      const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
      const savedModel = localStorage.getItem('codepilot:last-model') || '';
      const validProvider = groups.find(g => g.provider_id === savedProvider);
      const resolvedGroup = validProvider || pickDefaultProviderGroup(groups);
      const resolvedPid = resolvedGroup?.provider_id || '';

      if (validProvider) {
        setCurrentProviderId(savedProvider);
      } else {
        setCurrentProviderId(resolvedPid);
      }

      if (resolvedGroup?.models && resolvedGroup.models.length > 0) {
        const validModel = savedModel && resolvedGroup.models.some(m => m.value === savedModel);
        if (validModel) {
          setCurrentModel(savedModel);
        } else {
          setCurrentModel(resolvedGroup.models[0].value);
        }
      } else {
        setCurrentModel(savedModel || '');
      }
      setModelReady(true);
    }).catch(() => {
      // Fetch failed — fall back to localStorage best-effort
      const savedModel = localStorage.getItem('codepilot:last-model') || 'sonnet';
      const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
      setCurrentModel(savedModel);
      setCurrentProviderId(savedProvider);
      setModelReady(true);
    });

    return () => { cancelled = true; };
   
  }, []); // Run once on mount to validate initial values

  // Initialize workingDir from localStorage (or setup default), validating the path exists
  useEffect(() => {
    let cancelled = false;

    const validateDir = async (path: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/files/browse?dir=${encodeURIComponent(path)}`);
        return res.ok;
      } catch {
        return false;
      }
    };

    const tryFallbackToDefault = async () => {
      try {
        const res = await fetch('/api/setup');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data?.defaultProject) return;
        if (await validateDir(data.defaultProject) && !cancelled) {
          setWorkingDir(data.defaultProject);
          localStorage.setItem('codepilot:last-working-directory', data.defaultProject);
        }
      } catch { /* ignore */ }
    };

    const init = async () => {
      const saved = localStorage.getItem('codepilot:last-working-directory');
      if (saved) {
        if (await validateDir(saved) && !cancelled) {
          setWorkingDir(saved);
        } else if (!cancelled) {
          // Stale — clear and try setup default
          localStorage.removeItem('codepilot:last-working-directory');
          await tryFallbackToDefault();
        }
      } else {
        await tryFallbackToDefault();
      }
    };

    init();

    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) setWorkingDir(path);
    };
    window.addEventListener('project-directory-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('project-directory-changed', handler);
    };
  }, []);

  // Load recent projects for empty state
  useEffect(() => {
    fetch('/api/setup/recent-projects')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(data => setRecentProjects(data.projects || []))
      .catch(() => {});
  }, []);

  // Detect assistant workspace status
  useEffect(() => {
    fetch('/api/settings/workspace')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.path && data?.valid !== false) {
          setAssistantWorkspacePath(data.path);
          setAssistantConfigured(!!data.state?.onboardingComplete);
        }
      })
      .catch(() => {});
  }, []);

  // Check provider availability — only 'completed' counts, 'skipped' means user deferred but has no real credentials
  useEffect(() => {
    const checkProvider = () => {
      // Lock sending while we re-resolve the model/provider
      setModelReady(false);
      fetch('/api/setup')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setHasProvider(data.provider === 'completed');
          }
        })
        .catch(() => {});
      // Sync provider/model, applying global default model for new conversations.
      const savedProviderId = localStorage.getItem('codepilot:last-provider-id');

      // Fetch models + global default in parallel
      const modelsP = fetch('/api/providers/models').then(r => r.ok ? r.json() : null);
      const globalP = fetch('/api/providers/options?providerId=__global__').then(r => r.ok ? r.json() : null);

      Promise.all([modelsP, globalP]).then(([modelsData, globalData]) => {
        if (!modelsData?.groups || modelsData.groups.length === 0) {
          setModelReady(true);
          return;
        }
        const groups = modelsData.groups as Array<{ provider_id: string; models: Array<{ value: string }> }>;
        const globalDefaultModel = globalData?.options?.default_model || '';
        const globalDefaultProvider = globalData?.options?.default_model_provider || '';

        // Validate and apply provider
        if (savedProviderId !== null) {
          const validProvider = groups.find(g => g.provider_id === savedProviderId);
          if (validProvider) {
            setCurrentProviderId(savedProviderId);
          } else {
            setCurrentProviderId('');
            localStorage.removeItem('codepilot:last-provider-id');
          }
        }

        // Apply global default for new conversations
        // Case 1: both provider and model are set and valid
        if (globalDefaultModel && globalDefaultProvider) {
          const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
          const modelValid = targetGroup?.models.some(m => m.value === globalDefaultModel);
          if (modelValid) {
            setCurrentModel(globalDefaultModel);
            setCurrentProviderId(globalDefaultProvider);
            setModelReady(true);
            return;
          }
        }
        // Case 2: provider is set but model was cleared (e.g. after doctor repair / provider delete)
        // → use that provider's first available model
        if (globalDefaultProvider && !globalDefaultModel) {
          const targetGroup = groups.find(g => g.provider_id === globalDefaultProvider);
          if (targetGroup?.models?.length) {
            setCurrentModel(targetGroup.models[0].value);
            setCurrentProviderId(globalDefaultProvider);
            setModelReady(true);
            return;
          }
        }

        // No global default — validate current model. When the user has no
        // saved provider, default to the first configured (non-env) provider
        // rather than the built-in "Claude Code" group.
        const fallbackGroup = pickDefaultProviderGroup(groups);
        const resolvedPid = savedProviderId && groups.find(g => g.provider_id === savedProviderId)
          ? savedProviderId
          : fallbackGroup?.provider_id || '';
        const resolvedGroup = groups.find(g => g.provider_id === resolvedPid) || fallbackGroup;
        setCurrentProviderId(resolvedPid);
        if (resolvedGroup?.models?.length > 0) {
          const savedModel = localStorage.getItem('codepilot:last-model');
          const validModel = savedModel && resolvedGroup.models.some(
            (m: { value: string }) => m.value === savedModel
          );
          if (validModel) {
            setCurrentModel(savedModel);
          } else {
            const fallback = resolvedGroup.models[0].value;
            setCurrentModel(fallback);
            localStorage.setItem('codepilot:last-model', fallback);
          }
        }
        setModelReady(true);
      }).catch(() => {
        // On fetch failure, still apply localStorage values as-is (best effort)
        if (savedProviderId !== null) setCurrentProviderId(savedProviderId);
        const savedModel = localStorage.getItem('codepilot:last-model');
        if (savedModel) setCurrentModel(savedModel);
        setModelReady(true);
      });
    };
    checkProvider();

    window.addEventListener('provider-changed', checkProvider);
    return () => window.removeEventListener('provider-changed', checkProvider);
  }, []);

  // Create a brand-new conversation rooted at `path` and open it. Mirrors the
  // sidebar's ChatListPanel.handleFolderSelect so the empty-state「选择文件夹」
  // flow matches user expectation: the folder appears as a project group in the
  // list (via 'session-created') and the new conversation opens automatically.
  // On failure, fall back to the old behaviour — set the dir locally so the
  // user can still type a first message — and surface an error banner.
  const openFolderAsNewSession = useCallback(async (path: string) => {
    localStorage.setItem('codepilot:last-working-directory', path);
    try {
      const model = localStorage.getItem('codepilot:last-model') || '';
      const provider_id = localStorage.getItem('codepilot:last-provider-id') || '';
      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_directory: path, model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent('session-created'));
        router.push(`/chat/${data.session.id}`);
        return;
      }
    } catch {
      // fall through to the local-dir fallback below
    }
    setWorkingDir(path);
    setErrorBanner({ message: t('error.directoryInvalid') });
  }, [router, t]);

  const handleSelectFolder = useCallback(async () => {
    if (isElectron) {
      const path = await openNativePicker({ title: t('folderPicker.title') });
      if (path) openFolderAsNewSession(path);
    } else {
      setFolderPickerOpen(true);
    }
  }, [isElectron, openNativePicker, t, openFolderAsNewSession]);

  const handleFolderPickerSelect = useCallback((path: string) => {
    setFolderPickerOpen(false);
    openFolderAsNewSession(path);
  }, [openFolderAsNewSession]);

  // Recent-project chip: open the project's most recent existing conversation
  // (per user preference); if the folder has no conversation yet, start a fresh
  // one. by-cwd resolves the latest session for a working directory.
  const handleSelectProject = useCallback(async (path: string) => {
    localStorage.setItem('codepilot:last-working-directory', path);
    try {
      const res = await fetch(`/api/chat/sessions/by-cwd?cwd=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) {
          router.push(`/chat/${data.sessionId}`);
          return;
        }
      }
    } catch {
      // fall through to create a new session
    }
    openFolderAsNewSession(path);
  }, [router, openFolderAsNewSession]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => {
    if (!pendingPermission) return;

    const body: { permissionRequestId: string; decision: { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] } | { behavior: 'deny'; message?: string } } = {
      permissionRequestId: pendingPermission.permissionRequestId,
      decision: decision === 'deny'
        ? { behavior: 'deny', message: denyMessage || 'User denied permission' }
        : {
            behavior: 'allow',
            ...(updatedInput ? { updatedInput } : {}),
            ...(decision === 'allow_session' && pendingPermission.suggestions
              ? { updatedPermissions: pendingPermission.suggestions }
              : {}),
          },
    };

    setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
    setPendingApprovalSessionId('');

    try {
      await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Best effort
    }

    setTimeout(() => {
      setPendingPermission(null);
      setPermissionResolved(null);
    }, 1000);
  }, [pendingPermission, setPendingApprovalSessionId]);

  const sendFirstMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[]) => {
      if (isStreaming) return;

      // Wait for model/provider to be resolved from the global default before allowing send
      if (!modelReady) return;

      // Require a project directory before sending
      if (!workingDir.trim()) {
        setErrorBanner({ message: t('chat.empty.noDirectory') });
        return;
      }

      // Require a provider before sending
      if (!hasProvider) {
        setErrorBanner({
          message: t('error.providerUnavailable'),
          description: t('chat.empty.noProvider'),
        });
        return;
      }

      setIsStreaming(true);
      setStreamingContent('');
      setToolUses([]);
      setToolResults([]);
      setStatusText(undefined);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let sessionId = '';

      try {
        // Create a new session with working directory + model/provider
        const createBody: Record<string, string> = {
          title: content.slice(0, 50),
          mode,
          working_directory: workingDir.trim(),
          permission_profile: permissionProfile,
          model: currentModel,
          provider_id: currentProviderId,
          // Persist the reasoning effort chosen on the new-chat screen so it
          // survives the redirect to /chat/[id]. 'auto'/undefined → '' (no
          // explicit effort); only real levels are stored.
          effort: selectedEffort && selectedEffort !== 'auto' ? selectedEffort : '',
        };

        const createRes = await fetch('/api/chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });

        if (!createRes.ok) {
          const errBody = await createRes.json().catch(() => ({}));
          throw new Error(errBody.error || `Failed to create session (${createRes.status})`);
        }

        const { session }: SessionResponse = await createRes.json();
        sessionId = session.id;
        setCreatedSessionId(sessionId);

        // Notify ChatListPanel to refresh immediately
        window.dispatchEvent(new CustomEvent('session-created'));

        // Add user message to UI — use displayOverride for chat bubble if provided
        const displayUserContent = displayOverride || content;
        const contentWithFileMeta = files && files.length > 0
          ? buildFilesDisplayContent(files, displayUserContent)
          : displayUserContent;
        const userMessage: Message = {
          id: 'temp-' + Date.now(),
          session_id: session.id,
          role: 'user',
          content: contentWithFileMeta,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages([userMessage]);

        // Build thinking config from settings
        const thinkingConfig = thinkingMode && thinkingMode !== 'adaptive'
          ? { type: thinkingMode }
          : thinkingMode === 'adaptive' ? { type: 'adaptive' } : undefined;

        // Send the message via streaming API
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: session.id,
            content,
            mode,
            model: currentModel,
            provider_id: currentProviderId,
            ...(files && files.length > 0 ? { files } : {}),
            ...(mentions && mentions.length > 0 ? { mentions } : {}),
            ...(systemPromptAppend ? { systemPromptAppend } : {}),
            // 'auto' sentinel means "no explicit effort" — omit so Claude
            // Code CLI applies its per-model default (Opus 4.7 → xhigh).
            ...(selectedEffort && selectedEffort !== 'auto' ? { effort: selectedEffort } : {}),
            ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
            ...(context1m ? { context_1m: true } : {}),
            ...(displayOverride ? { displayOverride } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (err?.code === 'NEEDS_PROVIDER_SETUP' && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('open-setup-center', {
              detail: { initialCard: err.initialCard ?? 'provider' },
            }));
          }
          throw new Error(err?.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let accumulated = '';
        let tokenUsage: TokenUsage | null = null;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
              const event: SSEEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'text': {
                  accumulated += event.data;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'tool_use': {
                  try {
                    const toolData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolUses((prev) => {
                      if (prev.some((t) => t.id === toolData.id)) return prev;
                      return [...prev, { id: toolData.id, name: toolData.name, input: toolData.input }];
                    });
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolResults((prev) => [...prev, { tool_use_id: resultData.tool_use_id, content: resultData.content }]);
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_output': {
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed._progress) {
                      setStatusText(`Running ${parsed.tool_name}... (${Math.round(parsed.elapsed_time_seconds)}s)`);
                      break;
                    }
                  } catch {
                    // Not JSON — raw stderr output
                  }
                  setStreamingToolOutput((prev) => {
                    const next = prev + (prev ? '\n' : '') + event.data;
                    return next.length > 5000 ? next.slice(-5000) : next;
                  });
                  break;
                }
                case 'status': {
                  try {
                    const statusData = JSON.parse(event.data);
                    // step_complete — agent-loop 每步发出的 token 统计事件，无可
                    // 显示文案，静默丢弃（与 useSSEStream 的 status 分支保持一致），
                    // 否则会被下面的兜底原样打印到执行状态行。
                    if (statusData.subtype === 'step_complete') {
                      break;
                    }
                    if (statusData.session_id) {
                      // Don't surface bare env aliases (sonnet/opus/haiku) in
                      // managed deployments — show a real model or just "Connected".
                      const m = statusData.requested_model || statusData.model || '';
                      const isEnvAlias = m === 'sonnet' || m === 'opus' || m === 'haiku';
                      setStatusText(m && !isEnvAlias ? `Connected (${m})` : 'Connected');
                      setTimeout(() => setStatusText(undefined), 2000);
                    } else if (statusData.notification) {
                      // Shared toast routing so code-driven notifications
                      // (e.g. RUNTIME_EFFORT_IGNORED) survive the next
                      // status-text update on both the first-message flow
                      // (this page) and the ongoing session flow
                      // (useSSEStream via stream-session-manager).
                      maybeShowStatusToast(statusData);
                      setStatusText(statusData.message || statusData.title || undefined);
                    } else if (typeof statusData === 'string') {
                      // 仅纯字符串状态文案才显示；结构化对象（含未知 subtype）忽略，
                      // 避免原始 JSON 泄漏到执行状态行。
                      setStatusText(statusData || undefined);
                    }
                  } catch {
                    setStatusText(event.data || undefined);
                  }
                  break;
                }
                case 'result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    if (resultData.usage) tokenUsage = resultData.usage;
                    // Phase 1: seed terminal_reason into the snapshot the
                    // redirected ChatView will read so first-turn
                    // prompt_too_long / blocking_limit / max_turns /
                    // hook_stopped can still surface the chip + action
                    // buttons in the post-redirect view.
                    if (resultData.terminal_reason && session?.id) {
                      seedSnapshotPatch(session.id, {
                        terminalReason: resultData.terminal_reason as string,
                      });
                    }
                  } catch { /* skip */ }
                  setStatusText(undefined);
                  break;
                }
                case 'rate_limit': {
                  // Phase 2: subscription rate-limit telemetry. Seed the
                  // snapshot so RateLimitBanner renders after redirect.
                  try {
                    const info = JSON.parse(event.data);
                    if (session?.id) {
                      seedSnapshotPatch(session.id, { rateLimitInfo: info });
                    }
                  } catch { /* skip */ }
                  break;
                }
                case 'context_usage': {
                  // Phase 5 extension-point; no producer currently (see
                  // b65c6ac). Seed the snapshot for forward compatibility.
                  try {
                    const snap = JSON.parse(event.data);
                    if (session?.id) {
                      seedSnapshotPatch(session.id, { contextUsageSnapshot: snap });
                    }
                  } catch { /* skip */ }
                  break;
                }
                case 'thinking': {
                  // Opus 4.7 with display: 'summarized' streams reasoning
                  // as thinking deltas. Accumulate them into the same
                  // streamingThinkingContent surface that ChatView's
                  // MessageList already renders, so the first-turn UI
                  // shows the reasoning block as it streams in. Backend
                  // /api/chat/route.ts separately persists thinking as a
                  // content-block JSON on the assistant message, so the
                  // redirected ChatView gets a fully-formed message from
                  // DB — this branch is for the pre-redirect live view.
                  setStreamingThinkingContent((prev) => prev + event.data);
                  break;
                }
                case 'permission_request': {
                  try {
                    const permData: PermissionRequestEvent = JSON.parse(event.data);
                    setPendingPermission(permData);
                    setPermissionResolved(null);
                    setPendingApprovalSessionId(sessionId);
                  } catch {
                    // skip malformed permission_request data
                  }
                  break;
                }
                case 'error': {
                  // Try to parse structured error JSON from classifier
                  let errorDisplay: string;
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.category && parsed.userMessage) {
                      errorDisplay = parsed.userMessage;
                      if (parsed.actionHint) errorDisplay += `\n\n**What to do:** ${parsed.actionHint}`;
                      if (parsed.details) errorDisplay += `\n\nDetails: ${parsed.details}`;
                      // Add diagnostic guidance for provider/auth related errors
                      const diagCategories = new Set([
                        'AUTH_REJECTED', 'AUTH_FORBIDDEN', 'AUTH_STYLE_MISMATCH',
                        'NO_CREDENTIALS', 'PROVIDER_NOT_APPLIED', 'MODEL_NOT_AVAILABLE',
                        'NETWORK_UNREACHABLE', 'ENDPOINT_NOT_FOUND', 'PROCESS_CRASH',
                        'CLI_NOT_FOUND', 'UNSUPPORTED_FEATURE',
                      ]);
                      if (diagCategories.has(parsed.category)) {
                        errorDisplay += '\n\n💡 [Run Provider Diagnostics](/settings#providers) to troubleshoot.';
                      }
                    } else {
                      errorDisplay = event.data;
                    }
                  } catch {
                    errorDisplay = event.data;
                  }
                  accumulated += '\n\n**Error:** ' + errorDisplay;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'done':
                  break;
              }
            } catch {
              // skip
            }
          }
        }

        // Add the completed assistant message
        if (accumulated.trim()) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: session.id,
            role: 'assistant',
            content: accumulated.trim(),
            created_at: new Date().toISOString(),
            token_usage: tokenUsage ? JSON.stringify(tokenUsage) : null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        // Navigate to the session page after response is complete
        router.push(`/chat/${session.id}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // User stopped - navigate to session if we have one
          if (sessionId) {
            router.push(`/chat/${sessionId}`);
          }
        } else {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          setErrorBanner({ message: t('error.sessionCreateFailed'), description: errMsg });
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingThinkingContent('');
        setToolUses([]);
        setToolResults([]);
        setStreamingToolOutput('');
        setStatusText(undefined);
        setPendingPermission(null);
        setPermissionResolved(null);
        setPendingApprovalSessionId('');
        abortControllerRef.current = null;
      }
    },
    [isStreaming, router, workingDir, mode, currentModel, currentProviderId, permissionProfile, selectedEffort, thinkingMode, context1m, setPendingApprovalSessionId, t, hasProvider, modelReady]
  );

  // ── /btw side question — same hook as ChatView so the new-chat screen behaves
  // identically. Context is the (usually empty) in-memory snapshot; on the
  // welcome screen /btw is a quick no-context aside that never enters a session.
  const btwGetContext = useCallback(() => {
    const ctx = messages
      .map((m) => ({
        role: m.role,
        content: parseMessageContent(m.content)
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n')
          .trim(),
      }))
      .filter((m) => m.content)
      .slice(-40);
    if (streamingContent && streamingContent.trim()) {
      ctx.push({ role: 'assistant', content: streamingContent });
    }
    return ctx;
  }, [messages, streamingContent]);
  const btw = useBtw({ getContext: btwGetContext, model: currentModel, providerId: currentProviderId });

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case '/help': {
        const helpMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Available Commands\n\n- **/help** - Show this help message\n- **/clear** - Clear conversation history\n- **/compact** - Compress conversation context\n- **/cost** - Show token usage statistics\n- **/doctor** - Check system health\n- **/init** - Initialize CLAUDE.md\n- **/review** - Start code review\n- **/terminal-setup** - Configure terminal\n\n**Tips:**\n- Type \`@\` to mention files\n- Use Shift+Enter for new line\n- Select a project folder to enable file operations`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, helpMessage]);
        break;
      }
      case '/clear':
        setMessages([]);
        break;
      case '/cost': {
        const costMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Token Usage\n\nToken usage tracking is available after sending messages. Check the token count displayed at the bottom of each assistant response.`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, costMessage]);
        break;
      }
      default:
        sendFirstMessage(command);
    }
  }, [sendFirstMessage]);

  // E4 (cowork): 办公 tab 下的落地页只给「开始办公对话」引导 —— 不渲染研发
  // 的选文件夹空态与 composer(此页的首条消息流程按研发语义校验 workingDir,
  // 办公会话必须先建会话再进入 /chat/[id] 输入)。
  if (coworkAvailable && workspaceTab === 'office' && messages.length === 0 && !isStreaming) {
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        <OfficeEmptyCard
          variant="landing"
          imageProvisioned={coworkImageProvisioned}
          creating={creatingOffice}
          onStart={handleStartOfficeSession}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {messages.length === 0 && !isStreaming && (!workingDir.trim() || !hasProvider) ? (
        <ChatEmptyState
          hasDirectory={!!workingDir.trim()}
          hasProvider={hasProvider}
          onSelectFolder={handleSelectFolder}
          recentProjects={recentProjects}
          onSelectProject={handleSelectProject}
          assistantConfigured={assistantConfigured}
          onOpenAssistant={() => {
            if (assistantConfigured) {
              // Navigate to the latest assistant session
              fetch(`/api/workspace/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'checkin' }),
              })
                .then(r => r.json())
                .then(data => router.push(`/chat/${data.session.id}`))
                .catch(() => {});
            } else if (assistantWorkspacePath) {
              setShowWizard(true);
            } else {
              router.push('/settings#assistant');
            }
          }}
        />
      ) : (
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          streamingThinkingContent={streamingThinkingContent}
          isStreaming={isStreaming}
          sessionId={createdSessionId}
          toolUses={toolUses}
          toolResults={toolResults}
          streamingToolOutput={streamingToolOutput}
          statusText={statusText}
        />
      )}
      {errorBanner && (
        <ErrorBanner
          message={errorBanner.message}
          description={errorBanner.description}
          className="mx-4 mb-2"
          onDismiss={() => setErrorBanner(null)}
          actions={[
            { label: t('error.retry'), onClick: () => setErrorBanner(null) },
          ]}
        />
      )}
      <PermissionPrompt
        pendingPermission={pendingPermission}
        permissionResolved={permissionResolved}
        onPermissionResponse={handlePermissionResponse}
        toolUses={toolUses}
      />
      <MessageInput
        onSend={sendFirstMessage}
        onCommand={handleCommand}
        onBtw={btw.ask}
        onStop={stopStreaming}
        disabled={!modelReady}
        isStreaming={isStreaming}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={(pid, model) => {
          setCurrentProviderId(pid);
          setCurrentModel(model);
          localStorage.setItem('codepilot:last-provider-id', pid);
          localStorage.setItem('codepilot:last-model', model);
        }}
        workingDirectory={workingDir}
        effort={selectedEffort}
        onEffortChange={setSelectedEffort}
        initialValue={prefillText}
      />
      {btw.open && (
        <BtwPanel
          messages={btw.messages}
          loading={btw.loading}
          error={btw.error}
          onAsk={btw.ask}
          onStop={btw.stop}
          onClear={btw.clear}
          onClose={() => btw.setOpen(false)}
        />
      )}
      <ChatComposerActionBar
        left={<><ModeIndicator mode={mode} onModeChange={setMode} disabled={isStreaming} />{/* ImageGenToggle hidden from UI — restore by uncommenting. Component + ImageGen logic kept intact. */}{/* <ImageGenToggle /> */}</>}
        center={
          <ChatPermissionSelector
            permissionProfile={permissionProfile}
            onPermissionChange={setPermissionProfile}
          />
        }
      />
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderPickerSelect}
      />
      {showWizard && assistantWorkspacePath && (
        <OnboardingWizard
          workspacePath={assistantWorkspacePath}
          onComplete={(session) => {
            setShowWizard(false);
            setAssistantConfigured(true);
            router.push(`/chat/${session.id}`);
          }}
        />
      )}
    </div>
  );
}

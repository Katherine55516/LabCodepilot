import { useRef, useCallback } from 'react';
import type { SSEEvent, TokenUsage, PermissionRequestEvent, MediaBlock, VmArtifactFile, VmStatusEvent } from '@/types';
import { saveCachedSdkInitMeta } from '@/lib/sdk-init-cache';
import { buildSseErrorNote, readSseErrorCategory } from '@/lib/sse-error-format';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

export interface SkillNudgeData {
  message: string;
  step: number;
  distinctToolCount: number;
  toolNames: string[];
}

export interface SSECallbacks {
  onText: (accumulated: string) => void;
  onToolUse: (tool: ToolUseInfo) => void;
  onToolResult: (result: ToolResultInfo) => void;
  onToolOutput: (data: string) => void;
  onToolProgress: (toolName: string, elapsedSeconds: number) => void;
  onStatus: (text: string | undefined) => void;
  onResult: (usage: TokenUsage | null, meta?: { terminalReason?: string }) => void;
  /** SDK 0.2.111 subscription rate-limit telemetry. Fires only on
   *  claude.ai subscription paths; absent for API-key sessions. */
  onRateLimit?: (info: RateLimitInfo) => void;
  /** Cowork sandbox: files the agent created/modified in the VM this turn. */
  onVmArtifacts?: (files: VmArtifactFile[]) => void;
  /** Cowork sandbox: VM provisioning progress during the cold-start window. */
  onVmStatus?: (status: VmStatusEvent) => void;
  onPermissionRequest: (data: PermissionRequestEvent) => void;
  onToolTimeout: (toolName: string, elapsedSeconds: number) => void;
  onModeChanged: (mode: string) => void;
  onTaskUpdate: (sessionId: string) => void;
  onRewindPoint: (sdkUserMessageId: string) => void;
  onThinking?: (delta: string) => void;
  onKeepAlive: () => void;
  /**
   * @param accumulated flat text with the error note already appended
   * @param note        the note alone (`**Error:** …`), for callers that
   *                    rebuild the message from ordered blocks and must
   *                    append it as its own trailing text block
   * @param category    error-classifier category, for category-specific
   *                    affordances (e.g. retry only on transient drops)
   */
  onError: (accumulated: string, note?: string, category?: string) => void;
  onSkillNudge?: (data: SkillNudgeData) => void;
  onContextCompressed?: (data: { message: string; messagesCompressed: number; tokensSaved: number }) => void;
  onInitMeta?: (meta: {
    tools?: unknown;
    slash_commands?: unknown;
    skills?: unknown;
    plugins?: Array<{ name: string; path: string }>;
    mcp_servers?: unknown;
    output_style?: string;
  }) => void;
}

/**
 * Subscription rate-limit info payload mirroring SDKRateLimitInfo.
 * Forwarded verbatim from the server for Phase 2 of agent-sdk-0-2-111.
 */
export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
}

/**
 * Notification codes that must persist past the next setStatusText() call.
 * Scoped narrowly — only codes that represent one-shot decisions the user
 * needs to see regardless of subsequent streaming progress belong here.
 */
export const TOAST_STATUS_CODES = new Set<string>([
  'RUNTIME_EFFORT_IGNORED', // Opus 4.7 on native runtime — explicit effort dropped
]);

/**
 * Inspect a parsed status event payload and fire a toast when it carries a
 * whitelisted code. Exposed so both useSSEStream's helper and inline SSE
 * parsers in page-level components can share toast routing without
 * duplicating the whitelist. No-op when the code isn't on the whitelist
 * or when the browser toast registry hasn't initialized (tests / SSR).
 */
export function maybeShowStatusToast(statusData: { code?: string; message?: string; title?: string }): void {
  if (!statusData?.code || !TOAST_STATUS_CODES.has(statusData.code)) return;
  void import('./useToast').then(({ showToast }) => {
    showToast({
      type: statusData.code === 'RUNTIME_EFFORT_IGNORED' ? 'warning' : 'info',
      message: statusData.message || statusData.title || 'Status notification',
      duration: 8000,
    });
  }).catch(() => { /* toast system unavailable — caller falls back to status text */ });
}

/**
 * Parse a single SSE line (after stripping "data: " prefix) and dispatch
 * to the appropriate callback.  Returns the updated accumulated text.
 */
function handleSSEEvent(
  event: SSEEvent,
  accumulated: string,
  callbacks: SSECallbacks,
): string {
  switch (event.type) {
    case 'text': {
      const next = accumulated + event.data;
      callbacks.onText(next);
      return next;
    }

    case 'thinking': {
      callbacks.onThinking?.(event.data);
      return accumulated;
    }

    case 'tool_use': {
      try {
        const toolData = JSON.parse(event.data);
        callbacks.onToolUse({
          id: toolData.id,
          name: toolData.name,
          input: toolData.input,
        });
      } catch {
        // skip malformed tool_use data
      }
      return accumulated;
    }

    case 'tool_result': {
      try {
        const resultData = JSON.parse(event.data);
        callbacks.onToolResult({
          tool_use_id: resultData.tool_use_id,
          content: resultData.content,
          ...(resultData.is_error ? { is_error: true } : {}),
          ...(Array.isArray(resultData.media) && resultData.media.length > 0
            ? { media: resultData.media }
            : {}),
        });
      } catch {
        // skip malformed tool_result data
      }
      return accumulated;
    }

    case 'tool_output': {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed._progress) {
          callbacks.onToolProgress(parsed.tool_name, Math.round(parsed.elapsed_time_seconds));
          return accumulated;
        }
      } catch {
        // Not JSON - raw stderr output, fall through
      }
      callbacks.onToolOutput(event.data);
      return accumulated;
    }

    case 'status': {
      try {
        const statusData = JSON.parse(event.data);
        // Skip internal-only status events (e.g. resume fallback notifications)
        if (statusData._internal) {
          return accumulated;
        }
        // Skill nudge — dedicated handler for persistent UI banner
        if (statusData.subtype === 'skill_nudge' && statusData.payload) {
          callbacks.onSkillNudge?.({
            message: statusData.message || statusData.payload.message || '',
            step: statusData.payload.reason?.step || 0,
            distinctToolCount: statusData.payload.reason?.distinctToolCount || 0,
            toolNames: statusData.payload.reason?.toolNames || [],
          });
          return accumulated;
        }
        // Context compressed — dedicated handler so stream-session-manager
        // dispatches the 'context-compressed' window event (drives hasSummary
        // state in ChatView). Before the human-readable message change,
        // onStatus received the literal string 'context_compressed' and the
        // manager matched it directly. Now the SSE payload has subtype +
        // structured stats, so we intercept here before it hits the generic
        // notification branch which would pass the full message string.
        if (statusData.subtype === 'context_compressed') {
          callbacks.onContextCompressed?.({
            message: statusData.message || '',
            messagesCompressed: statusData.stats?.messagesCompressed || 0,
            tokensSaved: statusData.stats?.tokensSaved || 0,
          });
          return accumulated;
        }
        // step_complete — agent-loop 的 onStepFinish 在每个 step 结束时发出，
        // 仅携带 usage/finishReason/toolsUsed，不含任何可显示文案。token 用量
        // 已由下方的 'result' 事件统一上报，前端没有该事件的消费者，故在此静默
        // 丢弃。否则它会落入下面的 else 兜底，被原样当作状态文案显示在执行状态
        // 行（曾导致原始 step_complete JSON 直接打印到界面的回归）。
        if (statusData.subtype === 'step_complete') {
          return accumulated;
        }
        if (statusData.session_id) {
          // Don't surface bare env aliases (sonnet/opus/haiku) — in managed
          // deployments they aren't real catalog models. Show the model only
          // when it's a real (non-alias) value; otherwise just "Connected".
          const m = statusData.requested_model || statusData.model || '';
          const isEnvAlias = m === 'sonnet' || m === 'opus' || m === 'haiku';
          callbacks.onStatus(m && !isEnvAlias ? `Connected (${m})` : 'Connected');
          callbacks.onInitMeta?.({
            tools: statusData.tools,
            slash_commands: statusData.slash_commands,
            skills: statusData.skills,
            plugins: statusData.plugins,
            mcp_servers: statusData.mcp_servers,
            output_style: statusData.output_style,
          });
          // Persist for the slash popover: before a session's first init,
          // CLI-built-in commands (embedded in the claude binary, invisible
          // to the filesystem scan) are only knowable from a previous
          // session's init. See sdk-init-cache.ts.
          saveCachedSdkInitMeta({
            slash_commands: statusData.slash_commands,
            skills: statusData.skills,
          });
        } else if (statusData.notification) {
          // Code-driven toasts (e.g. Opus 4.7 native-runtime
          // RUNTIME_EFFORT_IGNORED): route through the shared helper so
          // the inline parser in app/chat/page.tsx can reuse the same
          // whitelist without duplicating the toast import logic.
          maybeShowStatusToast(statusData);
          callbacks.onStatus(statusData.message || statusData.title || undefined);
        } else if (typeof statusData === 'string') {
          // 仅当 payload 本身是纯字符串状态文案时才显示。能 JSON.parse 成结构化
          // 对象、却不匹配上述任何已知类型的 status 事件（如未来新增的带 subtype
          // 事件），不应被当作人类可读文案——原样透传会把原始 JSON 打印到执行
          // 状态行。这类结构化对象在此静默忽略。
          callbacks.onStatus(statusData || undefined);
        }
      } catch {
        callbacks.onStatus(event.data || undefined);
      }
      return accumulated;
    }

    case 'result': {
      try {
        const resultData = JSON.parse(event.data);
        const meta = resultData.terminal_reason ? { terminalReason: resultData.terminal_reason as string } : undefined;
        callbacks.onResult(resultData.usage || null, meta);
      } catch {
        callbacks.onResult(null);
      }
      callbacks.onStatus(undefined);
      return accumulated;
    }

    case 'rate_limit': {
      // SDK 0.2.111 subscription rate-limit event. Structured payload
      // forwarded from claude-client.ts verbatim.
      try {
        const info = JSON.parse(event.data) as RateLimitInfo;
        callbacks.onRateLimit?.(info);
      } catch {
        // skip malformed payload — better to miss a rate-limit update
        // than to crash the stream
      }
      return accumulated;
    }

    case 'vm_artifacts': {
      // Cowork sandbox — 回合末权威全量快照(E4.2)。空表必须放行:纯删除
      // 回合(清单被删空)靠它清掉卡片 —— 曾有 length>0 守卫(增量语义残留)
      // 吞掉空快照,导致「只删文件的回合卡片不刷新」(用户实测报告,E4.3)。
      // Malformed payload → skip;回合完成的自动 refetch 兜底恢复。
      try {
        const payload = JSON.parse(event.data) as { files?: VmArtifactFile[] };
        if (Array.isArray(payload.files)) {
          callbacks.onVmArtifacts?.(payload.files);
        }
      } catch { /* skip malformed artifacts payload */ }
      return accumulated;
    }

    case 'vm_status': {
      // Cowork sandbox VM provisioning progress (P1-D readiness window).
      try {
        const status = JSON.parse(event.data) as VmStatusEvent;
        if (status && typeof status.phase === 'string') callbacks.onVmStatus?.(status);
      } catch { /* skip malformed vm_status payload */ }
      return accumulated;
    }

    case 'permission_request': {
      try {
        const permData: PermissionRequestEvent = JSON.parse(event.data);
        callbacks.onPermissionRequest(permData);
      } catch {
        // skip malformed permission_request data
      }
      return accumulated;
    }

    case 'tool_timeout': {
      try {
        const timeoutData = JSON.parse(event.data);
        callbacks.onToolTimeout(timeoutData.tool_name, timeoutData.elapsed_seconds);
      } catch {
        // skip malformed timeout data
      }
      return accumulated;
    }

    case 'mode_changed': {
      callbacks.onModeChanged(event.data);
      return accumulated;
    }

    case 'task_update': {
      try {
        const taskData = JSON.parse(event.data);
        callbacks.onTaskUpdate(taskData.session_id);
      } catch {
        // skip malformed task_update data
      }
      return accumulated;
    }

    case 'rewind_point': {
      try {
        const rpData = JSON.parse(event.data);
        if (rpData.userMessageId) {
          callbacks.onRewindPoint(rpData.userMessageId);
        }
      } catch {
        // skip malformed rewind_point data
      }
      return accumulated;
    }

    case 'keep_alive': {
      callbacks.onKeepAlive();
      return accumulated;
    }

    case 'error': {
      // Rendering lives in sse-error-format.ts so the server-side tee that
      // writes the DB row produces byte-identical text — otherwise the note
      // the user reads mid-turn changes wording after a reload.
      const note = buildSseErrorNote(event.data);
      const next = accumulated + '\n\n' + note;
      // `note` is passed separately because the caller cannot recover it from
      // `next`: the final message is rebuilt from ordered blocks, and the flat
      // accumulated text is only an empty-blocks fallback. Without it the
      // error silently vanished from every turn that had thinking or tools.
      callbacks.onError(next, note, readSseErrorCategory(event.data));
      return next;
    }

    case 'done': {
      return accumulated;
    }

    default:
      return accumulated;
  }
}

/**
 * Reads an SSE response body and dispatches parsed events through callbacks.
 * Returns the final accumulated text and token usage.
 */
export async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSECallbacks,
): Promise<{ accumulated: string; tokenUsage: TokenUsage | null }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let tokenUsage: TokenUsage | null = null;

  const wrappedCallbacks: SSECallbacks = {
    ...callbacks,
    onResult: (usage, meta) => {
      tokenUsage = usage;
      callbacks.onResult(usage, meta);
    },
  };

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
        accumulated = handleSSEEvent(event, accumulated, wrappedCallbacks);
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return { accumulated, tokenUsage };
}

/**
 * Hook that provides a stable consumeSSEStream function bound to the latest
 * callbacks via a ref, avoiding stale closures.
 */
export function useSSEStream() {
  const callbacksRef = useRef<SSECallbacks | null>(null);

  const processStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      callbacks: SSECallbacks,
    ) => {
      callbacksRef.current = callbacks;

      // Proxy through ref so callers always hit the latest callbacks
      const proxied: SSECallbacks = {
        onText: (a) => callbacksRef.current?.onText(a),
        onToolUse: (t) => callbacksRef.current?.onToolUse(t),
        onToolResult: (r) => callbacksRef.current?.onToolResult(r),
        onToolOutput: (d) => callbacksRef.current?.onToolOutput(d),
        onToolProgress: (n, s) => callbacksRef.current?.onToolProgress(n, s),
        onStatus: (t) => callbacksRef.current?.onStatus(t),
        onResult: (u, meta) => callbacksRef.current?.onResult(u, meta),
        onPermissionRequest: (d) => callbacksRef.current?.onPermissionRequest(d),
        onToolTimeout: (n, s) => callbacksRef.current?.onToolTimeout(n, s),
        onModeChanged: (m) => callbacksRef.current?.onModeChanged(m),
        onTaskUpdate: (s) => callbacksRef.current?.onTaskUpdate(s),
        onRewindPoint: (id) => callbacksRef.current?.onRewindPoint(id),
        onThinking: (d) => callbacksRef.current?.onThinking?.(d),
        onKeepAlive: () => callbacksRef.current?.onKeepAlive(),
        onError: (a, note, category) => callbacksRef.current?.onError(a, note, category),
        onInitMeta: (m) => callbacksRef.current?.onInitMeta?.(m),
        onRateLimit: (info) => callbacksRef.current?.onRateLimit?.(info),
      };

      return consumeSSEStream(reader, proxied);
    },
    [],
  );

  return { processStream };
}

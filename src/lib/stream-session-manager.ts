/**
 * Stream Session Manager — client-side singleton that manages SSE streams
 * independently of React component lifecycle.
 *
 * When a user switches sessions, the old ChatView unmounts but the stream
 * continues running here. The new ChatView (or the same one re-mounted)
 * subscribes to get the current snapshot.
 *
 * Uses globalThis pattern (same as conversation-registry.ts) to survive
 * Next.js HMR without losing state.
 */

import { consumeSSEStream } from '@/hooks/useSSEStream';
import { transferPendingToMessage } from '@/lib/image-ref-store';
import { translate, type Locale } from '@/i18n';
import { STREAM_NO_CONTENT_TIMEOUT_MS, shouldAbortForNoContent } from '@/lib/stream-timeout';
import type {
  ToolUseInfo,
  ToolResultInfo,
  SessionStreamSnapshot,
  StreamEvent,
  StreamEventListener,
  TokenUsage,
  PermissionRequestEvent,
  FileAttachment,
  MentionRef,
  MessageContentBlock,
} from '@/types';
import { sanitizeOrphanToolUses } from '@/lib/tool-result-pairing';

// ==========================================
// Internal types
// ==========================================

interface ActiveStream {
  sessionId: string;
  abortController: AbortController;
  snapshot: SessionStreamSnapshot;
  idleCheckTimer: ReturnType<typeof setInterval> | null;
  /** Last time ANY SSE event arrived (incl. keep_alive) — connection liveness. */
  lastEventTime: number;
  /** Last time a SUBSTANTIVE event arrived (real model/tool content, NOT
   *  keep_alive/status). Drives the no-content timeout — see STREAM_NO_CONTENT_TIMEOUT_MS. */
  lastSubstantiveEventTime: number;
  gcTimer: ReturnType<typeof setTimeout> | null;
  /** Tracked ad-hoc timeouts — cleaned up when the stream ends. */
  pendingTimers: Set<ReturnType<typeof setTimeout>>;
  // Mutable accumulators (snapshot gets new object refs on each emit)
  accumulatedText: string;
  accumulatedThinking: string;
  /** All thinking blocks concatenated (preserved for finalMessageContent) */
  fullThinking: string;
  /** Tracks whether non-thinking content has arrived since last thinking delta */
  thinkingPhaseEnded: boolean;
  toolUsesArray: ToolUseInfo[];
  toolResultsArray: ToolResultInfo[];
  toolOutputAccumulated: string;
  toolTimeoutInfo: { toolName: string; elapsedSeconds: number } | null;
  isIdleTimeout: boolean;
  sendMessageFn: ((content: string, files?: FileAttachment[]) => void) | null;
  rewindPoints: Array<{ userMessageId: string }>;
  /**
   * Ordered content blocks built in SSE-event arrival order — the source of
   * truth for the interleaved render + final persistence. text/tool/thinking
   * are appended as they arrive, preserving true chronological order.
   */
  orderedBlocks: MessageContentBlock[];
  /**
   * Offset into the monotonic `accumulatedText` where the CURRENT trailing
   * text segment begins. onText gives the full accumulated text; the current
   * text block's content = accumulatedText.slice(currentTextOffset).
   */
  currentTextOffset: number;
  /**
   * Set true when a tool/thinking event ends the current text run, so the
   * next onText starts a NEW text block instead of extending the previous one.
   */
  needNewTextBlock: boolean;
}

export interface StartStreamParams {
  sessionId: string;
  content: string;
  mode: string;
  model: string;
  providerId: string;
  files?: FileAttachment[];
  mentions?: MentionRef[];
  systemPromptAppend?: string;
  pendingImageNotices?: string[];
  /** When true, backend skips saving user message and title update (assistant auto-trigger) */
  autoTrigger?: boolean;
  /** Called when SDK mode changes (e.g. plan → code) */
  onModeChanged?: (mode: string) => void;
  /** Reference to the outer sendMessage so tool-timeout auto-retry works */
  sendMessageFn?: (content: string, files?: FileAttachment[]) => void;
  /** SDK effort level (low/medium/high/max) — only sent when model supports it */
  effort?: string;
  /** SDK thinking config */
  thinking?: { type: string; budgetTokens?: number };
  /** Enable 1M context window (beta) */
  context1m?: boolean;
  /** Called when init status event provides metadata (tools, slash_commands, skills) */
  onInitMeta?: (meta: { tools?: unknown; slash_commands?: unknown; skills?: unknown }) => void;
  /** Display-only content for user message (e.g. /skillName instead of expanded prompt) */
  displayOverride?: string;
}

// ==========================================
// Singleton via globalThis
// ==========================================

const GLOBAL_KEY = '__streamSessionManager__' as const;
const LISTENERS_KEY = '__streamSessionListeners__' as const;
// STREAM_NO_CONTENT_TIMEOUT_MS + shouldAbortForNoContent 现集中在 @/lib/stream-timeout
// (便于脱离浏览器依赖做单测)。keep_alive/状态心跳不重置该计时——详见该模块与 issue B-019。
const GC_DELAY_MS = 5 * 60 * 1000; // 5 minutes

function getStreamsMap(): Map<string, ActiveStream> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, ActiveStream>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, ActiveStream>;
}

/** Listener registry — persists independently of stream entries so GC doesn't orphan listeners */
function getListenersMap(): Map<string, Set<StreamEventListener>> {
  if (!(globalThis as Record<string, unknown>)[LISTENERS_KEY]) {
    (globalThis as Record<string, unknown>)[LISTENERS_KEY] = new Map<string, Set<StreamEventListener>>();
  }
  return (globalThis as Record<string, unknown>)[LISTENERS_KEY] as Map<string, Set<StreamEventListener>>;
}

// ==========================================
// Helpers
// ==========================================

function buildSnapshot(stream: ActiveStream): SessionStreamSnapshot {
  return {
    sessionId: stream.sessionId,
    phase: stream.snapshot.phase,
    streamingContent: stream.accumulatedText,
    streamingThinkingContent: stream.accumulatedThinking,
    toolUses: [...stream.toolUsesArray],
    toolResults: [...stream.toolResultsArray],
    streamingToolOutput: stream.toolOutputAccumulated,
    blocks: [...stream.orderedBlocks],
    statusText: stream.snapshot.statusText,
    pendingPermission: stream.snapshot.pendingPermission,
    permissionResolved: stream.snapshot.permissionResolved,
    tokenUsage: stream.snapshot.tokenUsage,
    startedAt: stream.snapshot.startedAt,
    completedAt: stream.snapshot.completedAt,
    error: stream.snapshot.error,
    finalMessageContent: stream.snapshot.finalMessageContent,
    terminalReason: stream.snapshot.terminalReason,
    rateLimitInfo: stream.snapshot.rateLimitInfo,
    // buildSnapshot is a field WHITELIST — every emit() rebuilds the snapshot
    // from scratch, so any field patched onto stream.snapshot by a callback
    // MUST be re-listed here or it is silently dropped before broadcast.
    // (vmArtifacts was missing at first: the realtime artifacts card never
    // showed until a remount refetched the list.)
    vmArtifacts: stream.snapshot.vmArtifacts,
    vmStatus: stream.snapshot.vmStatus,
  };
}

function emit(stream: ActiveStream, type: StreamEvent['type']) {
  const snapshot = buildSnapshot(stream);
  stream.snapshot = snapshot; // store latest
  const event: StreamEvent = { type, sessionId: stream.sessionId, snapshot };
  const listeners = getListenersMap().get(stream.sessionId);
  if (listeners) {
    for (const listener of listeners) {
      try { listener(event); } catch { /* listener error */ }
    }
  }
  // Also dispatch window event for AppShell
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('stream-session-event', { detail: event }));
  }
}

function scheduleGC(stream: ActiveStream) {
  if (stream.gcTimer) clearTimeout(stream.gcTimer);
  stream.gcTimer = setTimeout(() => {
    const map = getStreamsMap();
    const current = map.get(stream.sessionId);
    if (current === stream && current.snapshot.phase !== 'active') {
      map.delete(stream.sessionId);
    }
  }, GC_DELAY_MS);
}

function cleanupTimers(stream: ActiveStream) {
  if (stream.idleCheckTimer) {
    clearInterval(stream.idleCheckTimer);
    stream.idleCheckTimer = null;
  }
  // Clear all tracked ad-hoc timeouts
  for (const t of stream.pendingTimers) {
    clearTimeout(t);
  }
  stream.pendingTimers.clear();
}

/** Schedule a tracked timeout on the stream. Auto-removes itself after firing. */
function streamTimeout(stream: ActiveStream, fn: () => void, ms: number): void {
  const id = setTimeout(() => {
    stream.pendingTimers.delete(id);
    fn();
  }, ms);
  stream.pendingTimers.add(id);
}

// ==========================================
// Public API
// ==========================================

export function startStream(params: StartStreamParams): void {
  const map = getStreamsMap();
  const existing = map.get(params.sessionId);

  // If already streaming this session, abort old stream first
  if (existing && existing.snapshot.phase === 'active') {
    existing.abortController.abort();
    cleanupTimers(existing);
  }

  const abortController = new AbortController();

  const stream: ActiveStream = {
    sessionId: params.sessionId,
    abortController,
    snapshot: {
      sessionId: params.sessionId,
      phase: 'active',
      streamingContent: '',
      streamingThinkingContent: '',
      toolUses: [],
      toolResults: [],
      streamingToolOutput: '',
      blocks: [],
      statusText: undefined,
      pendingPermission: null,
      permissionResolved: null,
      tokenUsage: null,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      finalMessageContent: null,
    },
    idleCheckTimer: null,
    lastEventTime: Date.now(),
    lastSubstantiveEventTime: Date.now(),
    gcTimer: null,
    pendingTimers: new Set(),
    accumulatedText: '',
    accumulatedThinking: '',
    fullThinking: '',
    thinkingPhaseEnded: false,
    toolUsesArray: [],
    toolResultsArray: [],
    toolOutputAccumulated: '',
    toolTimeoutInfo: null,
    isIdleTimeout: false,
    sendMessageFn: params.sendMessageFn ?? null,
    rewindPoints: [],
    orderedBlocks: [],
    currentTextOffset: 0,
    needNewTextBlock: false,
  };

  map.set(params.sessionId, stream);
  emit(stream, 'phase-changed');

  // Run the stream in background (non-blocking)
  runStream(stream, params).catch(() => {});
}

// ── Ordered block accumulation (interleaved render source of truth) ─────────
// All updates are IMMUTABLE (new block objects + new array) so React reconciles
// correctly across throttled snapshot emits.

/** Update/extend the current trailing text block from the monotonic accumulated text. */
function appendOrderedText(stream: ActiveStream, acc: string) {
  const segText = acc.slice(stream.currentTextOffset);
  const blocks = stream.orderedBlocks;
  const last = blocks[blocks.length - 1];
  if (!stream.needNewTextBlock && last && last.type === 'text') {
    if (segText === last.text) return; // no change
    stream.orderedBlocks = [...blocks.slice(0, -1), { type: 'text', text: segText }];
  } else if (segText.length > 0) {
    // First text, or first text after a tool/thinking boundary → new block.
    stream.orderedBlocks = [...blocks, { type: 'text', text: segText }];
    stream.needNewTextBlock = false;
  }
}

/** Mark a boundary: next text starts a fresh block beginning after current acc. */
function endOrderedTextRun(stream: ActiveStream) {
  stream.currentTextOffset = stream.accumulatedText.length;
  stream.needNewTextBlock = true;
}

/** Append a thinking delta — new phase starts a new thinking block. */
function appendOrderedThinking(stream: ActiveStream, delta: string, newPhase: boolean) {
  const blocks = stream.orderedBlocks;
  const last = blocks[blocks.length - 1];
  if (!newPhase && last && last.type === 'thinking') {
    stream.orderedBlocks = [...blocks.slice(0, -1), { type: 'thinking', thinking: last.thinking + delta }];
  } else {
    stream.orderedBlocks = [...blocks, { type: 'thinking', thinking: delta }];
  }
}

/** Push a tool_use block (idempotent by id). */
function pushOrderedToolUse(stream: ActiveStream, tool: ToolUseInfo) {
  if (stream.orderedBlocks.some(b => b.type === 'tool_use' && b.id === tool.id)) return;
  stream.orderedBlocks = [...stream.orderedBlocks, { type: 'tool_use', id: tool.id, name: tool.name, input: tool.input }];
}

/** Insert/update the tool_result block for a given tool_use_id. */
function pushOrderedToolResult(stream: ActiveStream, res: ToolResultInfo) {
  const block: MessageContentBlock = {
    type: 'tool_result',
    tool_use_id: res.tool_use_id,
    content: res.content,
    ...(res.is_error ? { is_error: true } : {}),
    ...(res.media && res.media.length > 0 ? { media: res.media } : {}),
  };
  const idx = stream.orderedBlocks.findIndex(b => b.type === 'tool_result' && b.tool_use_id === res.tool_use_id);
  if (idx >= 0) {
    const next = [...stream.orderedBlocks];
    next[idx] = block;
    stream.orderedBlocks = next;
  } else {
    stream.orderedBlocks = [...stream.orderedBlocks, block];
  }
}

/** Serialize ordered blocks → final persisted message content. */
function buildFinalContentFromBlocks(stream: ActiveStream, fallbackText: string): string {
  // Pair every tool_use with a result before persisting, so an interrupted /
  // permission-hung turn never writes an orphan tool_use into the DB (which
  // would later break history replay with AI_MissingToolResultsError).
  const cleaned = sanitizeOrphanToolUses(stream.orderedBlocks).filter(
    b => b.type !== 'text' || (b.text != null && b.text.trim().length > 0),
  );
  if (cleaned.length === 0) return fallbackText.trim();
  const hasNonText = cleaned.some(b => b.type !== 'text');
  const textCount = cleaned.filter(b => b.type === 'text').length;
  // Single text-only message → persist as plain text (back-compat with readers
  // that expect bare text). Anything interleaved → ordered JSON array.
  if (!hasNonText && textCount <= 1) {
    const only = cleaned[0];
    return only && only.type === 'text' ? only.text.trim() : fallbackText.trim();
  }
  return JSON.stringify(cleaned);
}

async function runStream(stream: ActiveStream, params: StartStreamParams): Promise<void> {
  // Liveness ping — bumps lastEventTime only. For keep_alive / pure-status events
  // that prove the connection is alive but carry NO model progress.
  const markActive = () => { stream.lastEventTime = Date.now(); };
  // Real progress — bumps BOTH timers. Only substantive content (model text /
  // thinking / tool activity) resets the no-content timeout. keep_alive must NOT
  // call this, or a wedged-but-connected upstream would never time out.
  const markSubstantive = () => {
    const now = Date.now();
    stream.lastEventTime = now;
    stream.lastSubstantiveEventTime = now;
  };

  // No-content timeout checker — see @/lib/stream-timeout. Aborts only when no
  // SUBSTANTIVE content has arrived for the ceiling AND not blocked on permission
  // (keep_alive/status pings do not reset stream.lastSubstantiveEventTime).
  stream.idleCheckTimer = setInterval(() => {
    if (shouldAbortForNoContent(
      Date.now(),
      stream.lastSubstantiveEventTime,
      STREAM_NO_CONTENT_TIMEOUT_MS,
      !!stream.snapshot.pendingPermission,
    )) {
      cleanupTimers(stream);
      stream.isIdleTimeout = true;
      stream.abortController.abort();
    }
  }, 10_000);

  // Flush pending image notices
  let effectiveContent = params.content;
  if (params.pendingImageNotices && params.pendingImageNotices.length > 0) {
    const notices = params.pendingImageNotices.join('\n\n');
    effectiveContent = `${notices}\n\n---\n\n${params.content}`;
  }

  // Adaptive text emit throttle — avoids excessive React re-renders during fast streaming.
  // Defined before try/catch so flushTextThrottle is accessible in the error path.
  const TEXT_THROTTLE_MS = 100;
  let textEmitTimer: ReturnType<typeof setTimeout> | null = null;
  let textDirty = false;

  const emitTextUpdate = () => {
    textDirty = false;
    emit(stream, 'snapshot-updated');
  };

  const throttledTextEmit = () => {
    textDirty = true;
    if (!textEmitTimer) {
      textEmitTimer = setTimeout(() => {
        textEmitTimer = null;
        if (textDirty) emitTextUpdate();
      }, TEXT_THROTTLE_MS);
    }
  };

  const flushTextThrottle = () => {
    if (textEmitTimer) {
      clearTimeout(textEmitTimer);
      textEmitTimer = null;
    }
    if (textDirty) emitTextUpdate();
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: params.sessionId,
        content: effectiveContent,
        mode: params.mode,
        model: params.model,
        provider_id: params.providerId,
        ...(params.files && params.files.length > 0 ? { files: params.files } : {}),
        ...(params.mentions && params.mentions.length > 0 ? { mentions: params.mentions } : {}),
        ...(params.systemPromptAppend ? { systemPromptAppend: params.systemPromptAppend } : {}),
        ...(params.autoTrigger ? { autoTrigger: true } : {}),
        ...(params.effort ? { effort: params.effort } : {}),
        ...(params.thinking ? { thinking: params.thinking } : {}),
        ...(params.context1m ? { context_1m: true } : {}),
        ...(params.displayOverride ? { displayOverride: params.displayOverride } : {}),
      }),
      signal: stream.abortController.signal,
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

    const result = await consumeSSEStream(reader, {
      onText: (acc) => {
        markSubstantive();
        stream.accumulatedText = acc;
        stream.thinkingPhaseEnded = true;
        appendOrderedText(stream, acc); // ordered: extend current text block
        throttledTextEmit();
      },
      onThinking: (delta) => {
        markSubstantive();
        // If non-thinking content has arrived since last thinking delta,
        // this is a new thinking phase (e.g. after a tool_use round-trip).
        // Reset the live accumulator so the UI shows only the current phase.
        const newPhase = stream.thinkingPhaseEnded;
        if (stream.thinkingPhaseEnded) {
          // Save previous thinking to full history before resetting
          if (stream.accumulatedThinking) {
            stream.fullThinking += (stream.fullThinking ? '\n\n---\n\n' : '') + stream.accumulatedThinking;
          }
          stream.accumulatedThinking = '';
          stream.thinkingPhaseEnded = false;
        }
        stream.accumulatedThinking += delta;
        // ordered: a new thinking phase ends the current text run + opens a new
        // thinking block; continuation extends the trailing thinking block.
        if (newPhase) endOrderedTextRun(stream);
        appendOrderedThinking(stream, delta, newPhase);
        emit(stream, 'snapshot-updated');
      },
      onToolUse: (tool) => {
        markSubstantive();
        flushTextThrottle(); // Ensure text is up-to-date before tool events
        stream.thinkingPhaseEnded = true;
        stream.toolOutputAccumulated = '';
        if (!stream.toolUsesArray.some(t => t.id === tool.id)) {
          stream.toolUsesArray = [...stream.toolUsesArray, tool];
        }
        // ordered: a tool ends the current text run + appends a tool_use block
        endOrderedTextRun(stream);
        pushOrderedToolUse(stream, tool);
        emit(stream, 'snapshot-updated');
      },
      onToolResult: (res) => {
        markSubstantive();
        stream.toolOutputAccumulated = '';
        const existingIdx = stream.toolResultsArray.findIndex(r => r.tool_use_id === res.tool_use_id);
        if (existingIdx >= 0) {
          const next = [...stream.toolResultsArray];
          next[existingIdx] = res;
          stream.toolResultsArray = next;
        } else {
          stream.toolResultsArray = [...stream.toolResultsArray, res];
        }
        pushOrderedToolResult(stream, res); // ordered: pair result to its tool_use
        emit(stream, 'snapshot-updated');
        // Refresh file tree after each tool completes
        window.dispatchEvent(new Event('refresh-file-tree'));
      },
      onToolOutput: (data) => {
        markSubstantive();
        const next = stream.toolOutputAccumulated + (stream.toolOutputAccumulated ? '\n' : '') + data;
        stream.toolOutputAccumulated = next.length > 2000 ? next.slice(-2000) : next;
        emit(stream, 'snapshot-updated');
      },
      onToolProgress: (toolName, elapsed) => {
        markSubstantive();
        stream.snapshot = { ...stream.snapshot, statusText: `Running ${toolName}... (${elapsed}s)` };
        emit(stream, 'snapshot-updated');
      },
      onSkillNudge: (data) => {
        // Broadcast as window event — ChatView listens and renders a
        // persistent banner. We don't use the snapshot because the nudge
        // should persist after the stream completes (snapshot gets cleared).
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('skill-nudge', {
            detail: { sessionId: params.sessionId, ...data },
          }));
        }
      },
      onContextCompressed: (data) => {
        markSubstantive();
        // Dispatch the 'context-compressed' window event that ChatView
        // uses to flip hasSummary state and show the context indicator.
        // Also show a brief human-readable status line so the user knows
        // compression happened.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('context-compressed', {
            detail: { sessionId: params.sessionId, ...data },
          }));
        }
        // Show the compression message briefly in the status bar
        if (data.message) {
          stream.snapshot = { ...stream.snapshot, statusText: data.message };
          emit(stream, 'snapshot-updated');
          streamTimeout(stream, () => {
            if (stream.snapshot.statusText === data.message) {
              stream.snapshot = { ...stream.snapshot, statusText: undefined };
              emit(stream, 'snapshot-updated');
            }
          }, 5000); // Show for 5s so user can read it
        }
      },
      onStatus: (text) => {
        markActive();
        if (text === 'context_compressing_retry') {
          // Show a brief status while PTL auto-retry is in progress
          stream.snapshot = { ...stream.snapshot, statusText: 'Compressing context...' };
          emit(stream, 'snapshot-updated');
          return;
        }
        // 所有经 onStatus 到达的文案都是一次性提示（连接完成、子代理任务结束、
        // 会话恢复回退…），没有一条需要常驻。此前只有 'Connected (' 会自到期，
        // 其余走 else 永久占用状态行，直到下一条 status 或本回合结束——一条长
        // 通知能就此霸占状态行整个回合。统一改为设置即挂到期定时器，只是连接
        // 提示更短（2s），其余留足阅读时间（8s）。到期后状态行回落到工具进度/
        // Thinking，是合理降级。
        stream.snapshot = { ...stream.snapshot, statusText: text };
        emit(stream, 'snapshot-updated');
        if (text) {
          const ttl = text.startsWith('Connected (') ? 2000 : 8000;
          streamTimeout(stream, () => {
            // Only clear if still the same status
            if (stream.snapshot.statusText === text) {
              stream.snapshot = { ...stream.snapshot, statusText: undefined };
              emit(stream, 'snapshot-updated');
            }
          }, ttl);
        }
      },
      onResult: (usage, meta) => {
        markSubstantive();
        stream.snapshot = {
          ...stream.snapshot,
          tokenUsage: usage,
          ...(meta?.terminalReason ? { terminalReason: meta.terminalReason } : {}),
        };
      },
      onRateLimit: (info) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, rateLimitInfo: info };
        emit(stream, 'snapshot-updated');
      },
      onVmArtifacts: (files) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, vmArtifacts: files };
        emit(stream, 'snapshot-updated');
      },
      onVmStatus: (status) => {
        markActive();
        stream.snapshot = { ...stream.snapshot, vmStatus: status };
        emit(stream, 'snapshot-updated');
      },
      onPermissionRequest: (permData) => {
        markActive();
        stream.snapshot = {
          ...stream.snapshot,
          pendingPermission: permData,
          permissionResolved: null,
        };
        emit(stream, 'permission-request');
      },
      onToolTimeout: (toolName, elapsedSeconds) => {
        markActive();
        stream.toolTimeoutInfo = { toolName, elapsedSeconds };
      },
      onModeChanged: (sdkMode) => {
        markActive();
        if (params.onModeChanged) {
          params.onModeChanged(sdkMode);
        }
      },
      onTaskUpdate: () => {
        markActive();
        window.dispatchEvent(new CustomEvent('tasks-updated'));
      },
      onRewindPoint: (sdkUserMessageId) => {
        markActive();
        stream.rewindPoints = [...stream.rewindPoints, { userMessageId: sdkUserMessageId }];
      },
      onKeepAlive: () => {
        markActive();
      },
      onError: (acc) => {
        markActive();
        stream.accumulatedText = acc;
        emit(stream, 'snapshot-updated');
      },
      onInitMeta: (meta) => {
        markActive();
        params.onInitMeta?.(meta);
      },
    });

    // Flush any pending throttled text update before building final content
    flushTextThrottle();

    // Stream completed successfully — build final message content from the
    // ordered blocks (true chronological order). This replaces the old
    // hardcoded thinking→text→tools rebuild so the persisted message matches
    // the interleaved render. `accumulated` is the back-compat fallback for
    // text-only turns where orderedBlocks may be empty.
    const accumulated = result.accumulated;
    const messageContent = buildFinalContentFromBlocks(stream, accumulated);

    // Update snapshot with completion info
    stream.snapshot = {
      ...buildSnapshot(stream),
      phase: 'completed',
      completedAt: Date.now(),
      tokenUsage: result.tokenUsage,
      finalMessageContent: messageContent || null,
      statusText: undefined,
      pendingPermission: null,
      permissionResolved: null,
    };
    stream.accumulatedText = '';
    stream.accumulatedThinking = '';
    stream.fullThinking = '';
    stream.thinkingPhaseEnded = false;
    stream.toolUsesArray = [];
    stream.toolResultsArray = [];
    stream.toolOutputAccumulated = '';
    stream.orderedBlocks = [];
    stream.currentTextOffset = 0;
    stream.needNewTextBlock = false;

    cleanupTimers(stream);
    emit(stream, 'completed');
    scheduleGC(stream);

    // Refresh file tree after completion
    window.dispatchEvent(new CustomEvent('refresh-file-tree'));

  } catch (error) {
    flushTextThrottle();
    cleanupTimers(stream);

    // Helper: build finalMessageContent from the interleaved ordered blocks
    // accumulated so far, appending an optional trailing note (e.g. "generation
    // stopped", an error/timeout message). This preserves the text / tool /
    // thinking the user already saw, in order — previously the error/stop path
    // only serialized merged text + thinking and dropped the tool calls.
    const buildFinalContent = (note: string | null): string | null => {
      // Same orphan-tool_use guard as the success path — the error/abort/timeout
      // path is in fact the most likely to leave a tool_use without a result.
      const blocks: MessageContentBlock[] = sanitizeOrphanToolUses(stream.orderedBlocks).filter(
        b => b.type !== 'text' || (b.text != null && b.text.trim().length > 0),
      );
      if (note) blocks.push({ type: 'text', text: note });
      if (blocks.length === 0) return null;
      if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text;
      return JSON.stringify(blocks);
    };

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (stream.isIdleTimeout) {
        // No-content timeout: connection was alive but no substantive model
        // output arrived within the deadline (see the checker above).
        const timeoutSecs = Math.round(STREAM_NO_CONTENT_TIMEOUT_MS / 1000);
        const locale = (typeof document !== 'undefined'
          ? document.documentElement.lang
          : 'en') as Locale;
        // Text already lives in orderedBlocks; append only the error note.
        const note = translate(locale, 'streaming.noContentTimeout', { secs: timeoutSecs });

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'error',
          completedAt: Date.now(),
          error: `Stream no-content timeout (${timeoutSecs}s)`,
          finalMessageContent: buildFinalContent(note),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        emit(stream, 'completed');
        // Clear stale SDK session so next message starts fresh
        fetch(`/api/chat/sessions/${encodeURIComponent(stream.sessionId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdk_session_id: '' }),
        }).catch(() => {});
        scheduleGC(stream);
      } else if (stream.toolTimeoutInfo) {
        // Tool timeout — auto-retry
        const timeoutInfo = stream.toolTimeoutInfo;
        const note = `*(tool ${timeoutInfo.toolName} timed out after ${timeoutInfo.elapsedSeconds}s)*`;

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'stopped',
          completedAt: Date.now(),
          finalMessageContent: buildFinalContent(note),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        stream.toolTimeoutInfo = null;
        emit(stream, 'completed');
        scheduleGC(stream);

        // Auto-retry via sendMessageFn
        if (stream.sendMessageFn) {
          const fn = stream.sendMessageFn;
          streamTimeout(stream, () => {
            fn(
              `The previous tool "${timeoutInfo.toolName}" timed out after ${timeoutInfo.elapsedSeconds} seconds. Please try a different approach to accomplish the task. Avoid repeating the same operation that got stuck.`
            );
          }, 500);
        }
      } else {
        // User manually stopped — append a "(generation stopped)" note.
        const note = '*(generation stopped)*';

        stream.snapshot = {
          ...buildSnapshot(stream),
          phase: 'stopped',
          completedAt: Date.now(),
          finalMessageContent: buildFinalContent(note),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        };
        stream.accumulatedText = '';
        stream.accumulatedThinking = '';
        stream.fullThinking = '';
        stream.toolUsesArray = [];
        stream.toolResultsArray = [];
        stream.toolOutputAccumulated = '';
        emit(stream, 'completed');
        scheduleGC(stream);
      }
    } else {
      // Non-abort error
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      stream.snapshot = {
        ...buildSnapshot(stream),
        phase: 'error',
        completedAt: Date.now(),
        error: errMsg,
        finalMessageContent: buildFinalContent(`**Error:** ${errMsg}`),
        statusText: undefined,
        pendingPermission: null,
        permissionResolved: null,
      };
      stream.accumulatedText = '';
      stream.accumulatedThinking = '';
      stream.fullThinking = '';
      stream.toolUsesArray = [];
      stream.toolResultsArray = [];
      stream.toolOutputAccumulated = '';
      emit(stream, 'completed');
      scheduleGC(stream);
    }
  }
}

// ==========================================
// Stop
// ==========================================

export function stopStream(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.phase === 'active') {
    // Try graceful interrupt first, fallback to abort
    fetch('/api/chat/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {
      // Interrupt failed, force abort
    }).finally(() => {
      // Always abort after a short delay to ensure cleanup
      streamTimeout(stream, () => {
        if (stream.snapshot.phase === 'active') {
          stream.abortController.abort();
        }
      }, 2000);
    });
  }
}

// ==========================================
// Subscribe
// ==========================================

export function subscribe(sessionId: string, listener: StreamEventListener): () => void {
  const listenersMap = getListenersMap();
  let listeners = listenersMap.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    listenersMap.set(sessionId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) {
      listenersMap.delete(sessionId);
    }
  };
}

// ==========================================
// Snapshot access
// ==========================================

export function getSnapshot(sessionId: string): SessionStreamSnapshot | null {
  const stream = getStreamsMap().get(sessionId);
  if (!stream) return null;
  // Don't return stale placeholder entries
  if (stream.snapshot.startedAt === 0) return null;
  return stream.snapshot;
}

export function isStreamActive(sessionId: string): boolean {
  const stream = getStreamsMap().get(sessionId);
  return stream?.snapshot.phase === 'active' || false;
}

export function getRewindPoints(sessionId: string): Array<{ userMessageId: string }> {
  const stream = getStreamsMap().get(sessionId);
  return stream?.rewindPoints ?? [];
}

export function getActiveSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, stream] of getStreamsMap()) {
    if (stream.snapshot.phase === 'active') {
      ids.push(id);
    }
  }
  return ids;
}

// ==========================================
// Permission response
// ==========================================

export async function respondToPermission(
  sessionId: string,
  decision: 'allow' | 'allow_session' | 'deny',
  updatedInput?: Record<string, unknown>,
  denyMessage?: string,
): Promise<void> {
  const stream = getStreamsMap().get(sessionId);
  if (!stream || !stream.snapshot.pendingPermission) return;

  const perm = stream.snapshot.pendingPermission;

  const body = {
    permissionRequestId: perm.permissionRequestId,
    decision: decision === 'deny'
      ? { behavior: 'deny' as const, message: denyMessage || 'User denied permission' }
      : {
          behavior: 'allow' as const,
          ...(decision === 'allow_session' && perm.suggestions
            ? { updatedPermissions: perm.suggestions }
            : {}),
          ...(updatedInput ? { updatedInput } : {}),
        },
  };

  // Update snapshot immediately
  stream.snapshot = {
    ...stream.snapshot,
    permissionResolved: decision === 'deny' ? 'deny' : 'allow',
  };
  emit(stream, 'snapshot-updated');

  try {
    await fetch('/api/chat/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Best effort
  }

  // Clear permission state after delay (only if no new request arrived)
  const answeredId = perm.permissionRequestId;
  streamTimeout(stream, () => {
    if (stream.snapshot.pendingPermission?.permissionRequestId === answeredId) {
      stream.snapshot = {
        ...stream.snapshot,
        pendingPermission: null,
        permissionResolved: null,
      };
      emit(stream, 'snapshot-updated');
    }
  }, 1000);
}

// ==========================================
// Cleanup
// ==========================================

export function clearSnapshot(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.phase !== 'active') {
    if (stream.gcTimer) clearTimeout(stream.gcTimer);
    // Reset the snapshot (listeners are in a separate registry)
    stream.snapshot = {
      ...stream.snapshot,
      startedAt: 0,
      finalMessageContent: null,
    };
  }
}

/**
 * Seed a snapshot with initial patch for paths that don't go through
 * startStream() — currently only the first-message flow in
 * `app/chat/page.tsx`, which hand-parses SSE, creates a session row, and
 * redirects to /chat/[id]. Without this seed, the snapshot the redirected
 * ChatView reads is null and first-turn signals (terminal_reason,
 * rate_limit_info) never reach the chip/banner UI.
 *
 * Registers a minimal ActiveStream with phase='completed' if none exists.
 * If a full stream is already registered (shouldn't normally happen on
 * first turn), just merges the patch into the existing snapshot.
 */
export function seedSnapshotPatch(
  sessionId: string,
  patch: Partial<SessionStreamSnapshot>,
): void {
  const map = getStreamsMap();
  const existing = map.get(sessionId);
  if (existing) {
    existing.snapshot = { ...existing.snapshot, ...patch };
    emit(existing, 'snapshot-updated');
    return;
  }
  // Register a placeholder stream. It's not 'active' so the ChatView will
  // treat it as post-stream state; no subscription wiring needed because
  // the ChatView that reads it will re-subscribe on mount (its own useEffect).
  const placeholder: ActiveStream = {
    sessionId,
    abortController: new AbortController(),
    idleCheckTimer: null,
    lastEventTime: Date.now(),
    lastSubstantiveEventTime: Date.now(),
    gcTimer: null,
    pendingTimers: new Set(),
    accumulatedText: '',
    accumulatedThinking: '',
    fullThinking: '',
    thinkingPhaseEnded: false,
    toolUsesArray: [],
    toolResultsArray: [],
    toolOutputAccumulated: '',
    toolTimeoutInfo: null,
    isIdleTimeout: false,
    sendMessageFn: null,
    rewindPoints: [],
    orderedBlocks: [],
    currentTextOffset: 0,
    needNewTextBlock: false,
    snapshot: {
      sessionId,
      phase: 'completed',
      streamingContent: '',
      streamingThinkingContent: '',
      toolUses: [],
      toolResults: [],
      streamingToolOutput: '',
      blocks: [],
      statusText: undefined,
      pendingPermission: null,
      permissionResolved: null,
      tokenUsage: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
      error: null,
      finalMessageContent: null,
      ...patch,
    },
  };
  map.set(sessionId, placeholder);
}

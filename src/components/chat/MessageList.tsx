'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Button } from '@/components/ui/button';
import type { Message, MessageContentBlock } from '@/types';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { MessageItem } from './MessageItem';
import { StreamingMessage } from './StreamingMessage';
import { CodePilotLogo } from './CodePilotLogo';
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, RARITY_BG_GRADIENT, type Species, type Rarity } from '@/lib/buddy';

/**
 * Scrolls to bottom when streaming starts or new messages are appended.
 * Must be rendered inside <Conversation> (StickToBottom provider).
 */
function ScrollOnStream({ isStreaming, messageCount, suppressAutoScrollRef }: { isStreaming: boolean; messageCount: number; suppressAutoScrollRef: React.MutableRefObject<boolean> }) {
  const { scrollToBottom } = useStickToBottomContext();
  const wasStreaming = useRef(false);
  const prevCount = useRef(messageCount);

  // Scroll when new messages are appended (covers optimistic user message + assistant completion).
  // Pagination fetches (load earlier/later) set the suppress flag — those batches
  // must keep the reader anchored instead of yanking the viewport to the bottom.
  useEffect(() => {
    if (messageCount > prevCount.current) {
      if (suppressAutoScrollRef.current) {
        suppressAutoScrollRef.current = false;
      } else {
        scrollToBottom();
      }
    }
    prevCount.current = messageCount;
  }, [messageCount, scrollToBottom, suppressAutoScrollRef]);

  useEffect(() => {
    if (isStreaming && !wasStreaming.current) {
      scrollToBottom();
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, scrollToBottom]);

  return null;
}

/**
 * Pagination button rendered inside the StickToBottom context. stopScroll()
 * drops the bottom lock BEFORE the fetch, so the positive-resize auto-stick
 * (and any in-flight scroll animation) can't pull the reader to the bottom
 * when the new batch lands — scroll events during a resize are ignored by
 * use-stick-to-bottom, so escaping after the fact doesn't work.
 */
function PaginationButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  const { stopScroll } = useStickToBottomContext();
  return (
    <div className="flex justify-center">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => { stopScroll(); onClick(); }}
        className="text-muted-foreground hover:text-foreground"
      >
        {label}
      </Button>
    </div>
  );
}

/**
 * Rewind button shown on user messages that have file checkpoints.
 */
function RewindButton({ sessionId, userMessageId }: { sessionId: string; userMessageId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'preview' | 'loading' | 'done'>('idle');
  const [preview, setPreview] = useState<{ filesChanged?: string[]; insertions?: number; deletions?: number } | null>(null);

  const handleDryRun = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId, dryRun: true }),
      });
      const data = await res.json();
      if (data.canRewind) {
        setPreview(data);
        setState('preview');
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  }, [sessionId, userMessageId]);

  const handleRewind = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId }),
      });
      const data = await res.json();
      if (data.canRewind !== false) {
        setState('done');
        setTimeout(() => setState('idle'), 3000);
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  }, [sessionId, userMessageId]);

  if (state === 'done') {
    return (
      <span className="text-[10px] text-status-success-foreground ml-2">
        {t('messageList.rewindDone' as TranslationKey)}
      </span>
    );
  }

  if (state === 'preview' && preview) {
    return (
      <span className="inline-flex items-center gap-1.5 ml-2">
        <span className="text-[10px] text-muted-foreground">
          {preview.filesChanged?.length || 0} files, +{preview.insertions || 0}/-{preview.deletions || 0}
        </span>
        <Button
          variant="link"
          size="xs"
          onClick={handleRewind}
          className="text-[10px] text-primary h-auto p-0"
        >
          {t('messageList.rewindConfirm' as TranslationKey)}
        </Button>
        <Button
          variant="link"
          size="xs"
          onClick={() => setState('idle')}
          className="text-[10px] text-muted-foreground h-auto p-0"
        >
          {t('messageList.rewindCancel' as TranslationKey)}
        </Button>
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={handleDryRun}
      disabled={state === 'loading'}
      className="text-[10px] text-muted-foreground hover:text-foreground ml-2 opacity-0 group-hover:opacity-100 h-auto p-0"
    >
      {state === 'loading' ? '...' : t('messageList.rewindToHere' as TranslationKey)}
    </Button>
  );
}

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

/** Rewind points contain SDK UUIDs (not local message IDs) */
interface RewindPoint {
  userMessageId: string; // SDK UUID
}

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  /** Ordered content blocks for the interleaved live render. */
  streamingBlocks?: MessageContentBlock[];
  streamingToolOutput?: string;
  streamingThinkingContent?: string;
  statusText?: string;
  onForceStop?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Deep-link window: newer messages exist below the loaded tail. */
  hasMoreAfter?: boolean;
  loadingLater?: boolean;
  onLoadLater?: () => void;
  /** Scroll to and flash this message after mount (jump from global search). */
  targetMessageId?: string;
  /** SDK rewind points — only emitted for visible prompt-level user messages (not tool results or auto-triggers), mapped by position */
  rewindPoints?: RewindPoint[];
  sessionId?: string;
  startedAt?: number;
  /** Whether this is an assistant workspace project */
  isAssistantProject?: boolean;
  /** Assistant name for avatar display */
  assistantName?: string;
  /** Cowork sandbox session — suppresses per-message DiffSummary cards. */
  sandboxEnabled?: boolean;
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingBlocks = [],
  streamingToolOutput,
  streamingThinkingContent,
  statusText,
  onForceStop,
  hasMore,
  loadingMore,
  onLoadMore,
  hasMoreAfter,
  loadingLater,
  onLoadLater,
  targetMessageId,
  rewindPoints = [],
  sessionId,
  startedAt,
  isAssistantProject,
  assistantName,
  sandboxEnabled,
}: MessageListProps) {
  const { t } = useTranslation();
  // Scroll anchor: preserve position when messages are prepended (block 'start')
  // or appended via forward pagination (block 'end').
  const anchorRef = useRef<{ id: string; block: ScrollLogicalPosition } | null>(null);
  // One-shot flag telling ScrollOnStream to skip its scroll-to-bottom for the
  // next count increase (pagination batch, not fresh conversation content).
  const suppressAutoScrollRef = useRef(false);
  // Before loading more, record the first visible message ID
  const handleLoadMore = () => {
    if (messages.length > 0) {
      anchorRef.current = { id: messages[0].id, block: 'start' };
      suppressAutoScrollRef.current = true;
    }
    onLoadMore?.();
  };

  // Before loading later messages, pin the current last message to the viewport
  // bottom so the appended batch doesn't yank the reader to the new bottom.
  const handleLoadLater = () => {
    if (messages.length > 0) {
      anchorRef.current = { id: messages[messages.length - 1].id, block: 'end' };
      suppressAutoScrollRef.current = true;
    }
    onLoadLater?.();
  };

  // After messages change, scroll the anchor element back into view.
  // Uses the anchor ID (set before loading) rather than a length comparison,
  // because a capped prepend can swap messages without changing total count.
  useEffect(() => {
    if (anchorRef.current) {
      const el = document.getElementById(`msg-${anchorRef.current.id}`);
      if (el) {
        el.scrollIntoView({ block: anchorRef.current.block });
      }
      anchorRef.current = null;
    }
  }, [messages]);

  // Jump-to-message (deep link from global search): scroll the target into view
  // and flash it. Runs once per mount — ChatView is remounted per target (key).
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  useEffect(() => {
    if (!targetMessageId) return;
    let realignTimer: ReturnType<typeof setTimeout> | undefined;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${targetMessageId}`);
      if (!el) return; // target missing (deleted/filtered) — leave scroll as-is
      el.scrollIntoView({ block: 'center' });
      setFlashMessageId(targetMessageId);
      // Re-align once after initial layout settles (images/widgets shift heights).
      realignTimer = setTimeout(() => {
        document.getElementById(`msg-${targetMessageId}`)?.scrollIntoView({ block: 'center' });
      }, 300);
      flashTimer = setTimeout(() => setFlashMessageId(null), 2600);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (realignTimer) clearTimeout(realignTimer);
      if (flashTimer) clearTimeout(flashTimer);
    };
  }, [targetMessageId]);

  if (messages.length === 0 && !isStreaming) {
    if (isAssistantProject) {
      // Assistant workspace — show buddy or egg welcome
      const buddyInfo = typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>).__codepilot_buddy_info__ as { species?: string; rarity?: string } | undefined
        : undefined;
      const hasBuddy = !!buddyInfo?.species;
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            {hasBuddy ? (
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{ background: RARITY_BG_GRADIENT[buddyInfo!.rarity as Rarity] || '' }}
              >
                <img
                  src={SPECIES_IMAGE_URL[buddyInfo!.species as Species] || ''}
                  alt="" width={64} height={64} className="drop-shadow-md"
                />
              </div>
            ) : (
              <img src={EGG_IMAGE_URL} alt="" width={64} height={64} className="drop-shadow-md" />
            )}
            <div className="space-y-1">
              <h3 className="font-medium text-sm">
                {hasBuddy
                  ? (assistantName || t('messageList.claudeChat'))
                  : t('buddy.adoptPrompt' as TranslationKey)}
              </h3>
              <p className="text-muted-foreground text-sm">
                {hasBuddy
                  ? t('messageList.emptyDescription')
                  : t('buddy.adoptDescription' as TranslationKey)}
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center">
        <ConversationEmptyState
          title={t('messageList.claudeChat')}
          description={t('messageList.emptyDescription')}
          icon={<CodePilotLogo className="h-16 w-16" />}
        />
      </div>
    );
  }

  return (
    // Deep link: suppress the initial scroll-to-bottom so the jump-to-message
    // effect can position the viewport on the target instead.
    <Conversation {...(targetMessageId ? { initial: false } : {})}>
      <ScrollOnStream isStreaming={isStreaming} messageCount={messages.length} suppressAutoScrollRef={suppressAutoScrollRef} />
      <ConversationContent className="mx-auto max-w-3xl px-4 py-6 gap-6">
        {hasMore && (
          <PaginationButton
            label={loadingMore ? t('messageList.loading') : t('messageList.loadEarlier')}
            disabled={loadingMore}
            onClick={handleLoadMore}
          />
        )}
        {messages.map((message) => {
          // Map rewind points to visible user messages by position:
          // Backend only emits rewind_point for prompt-level user messages
          // (not tool results, not auto-trigger), so they're 1:1 with visible user messages.
          let rewindSdkUuid: string | undefined;
          if (message.role === 'user' && sessionId && rewindPoints.length > 0) {
            const userMsgsBefore = messages.filter(m => m.role === 'user');
            const userIndex = userMsgsBefore.indexOf(message);
            if (userIndex >= 0 && userIndex < rewindPoints.length) {
              rewindSdkUuid = rewindPoints[userIndex].userMessageId;
            }
          }

          return (
            <div key={message.id} id={`msg-${message.id}`} className={message.id === flashMessageId ? 'group message-target-flash' : 'group'}>
              <MessageItem message={message} sessionId={sessionId} isAssistantProject={isAssistantProject} assistantName={assistantName} sandboxEnabled={sandboxEnabled} />
              {/* E4 (cowork): 回滚是研发工作流(跨 VM 恢复语义未验证),办公隐藏 */}
              {rewindSdkUuid && sessionId && !isStreaming && !sandboxEnabled && (
                <RewindButton sessionId={sessionId} userMessageId={rewindSdkUuid} />
              )}
            </div>
          );
        })}

        {hasMoreAfter && !isStreaming && (
          <PaginationButton
            label={loadingLater ? t('messageList.loading') : t('messageList.loadLater')}
            disabled={loadingLater}
            onClick={handleLoadLater}
          />
        )}

        {isStreaming && (
          <StreamingMessage
            content={streamingContent}
            isStreaming={isStreaming}
            sessionId={sessionId}
            startedAt={startedAt!}
            blocks={streamingBlocks}
            toolUses={toolUses}
            toolResults={toolResults}
            streamingToolOutput={streamingToolOutput}
            thinkingContent={streamingThinkingContent}
            statusText={statusText}
            onForceStop={onForceStop}
          />
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

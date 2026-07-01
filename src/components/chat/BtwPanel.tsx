'use client';

/**
 * BtwPanel — Claude-desktop-style "Side chat" floating popup for /btw.
 *
 * A small, draggable, resizable panel (NOT a centered modal) holding a
 * multi-turn aside anchored to the current conversation. Replaces the old
 * radix Dialog BtwDialog.
 *
 * - Drag the title bar to move it anywhere on screen (pointer-capture, clamped
 *   to the viewport). Title bar is WebkitAppRegion:'no-drag' so it doesn't drag
 *   the OS window in Electron.
 * - Drag any edge/corner to resize (pointer-capture + min/max clamp).
 * - Messages render as bubbles (Message/MessageContent/MessageResponse); the
 *   in-flight assistant turn shows a Shimmer "thinking" state until first token.
 * - Bottom textarea sends follow-ups (Enter submits; IME-safe).
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Trash } from '@phosphor-icons/react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import type { BtwMessage } from '@/hooks/useBtw';

interface BtwPanelProps {
  messages: BtwMessage[];
  loading: boolean;
  error: string | null;
  onAsk: (question: string) => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
}

const MIN_W = 300;
const MIN_H = 320;
const DEFAULT_W = 380;
const DEFAULT_H = 500;
const MARGIN = 24;

interface Rect { top: number; left: number; width: number; height: number; }

export function BtwPanel({ messages, loading, error, onAsk, onStop, onClear, onClose }: BtwPanelProps) {
  const { t } = useTranslation();

  // Initial dock: bottom-right (component only mounts when open → window exists).
  const [rect, setRect] = useState<Rect>(() => {
    const width = DEFAULT_W, height = DEFAULT_H;
    if (typeof window === 'undefined') return { width, height, top: 80, left: 80 };
    return {
      width,
      height,
      left: Math.max(MARGIN, window.innerWidth - width - MARGIN),
      top: Math.max(MARGIN, window.innerHeight - height - MARGIN),
    };
  });
  const [input, setInput] = useState('');
  const composingRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);
  const resizeRef = useRef<{ dir: string; startX: number; startY: number; r: Rect } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // ── Drag to move (title bar) ──
  const onDragDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startTop: rect.top, startLeft: rect.left };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    document.body.style.userSelect = 'none';
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const left = Math.min(Math.max(0, d.startLeft + (e.clientX - d.startX)), maxLeft);
    const top = Math.min(Math.max(0, d.startTop + (e.clientY - d.startY)), maxTop);
    setRect((r) => ({ ...r, top, left }));
  };
  const onDragUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* no active pointer */ }
    document.body.style.userSelect = '';
  };

  // ── Resize (edges + corners) ──
  const onResizeDown = (dir: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { dir, startX: e.clientX, startY: e.clientY, r: rect };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    document.body.style.userSelect = 'none';
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const rz = resizeRef.current;
    if (!rz) return;
    const dx = e.clientX - rz.startX;
    const dy = e.clientY - rz.startY;
    const { dir, r } = rz;
    let { top, left, width, height } = r;
    const maxW = window.innerWidth - MARGIN;
    const maxH = window.innerHeight - MARGIN;
    if (dir.includes('e')) width = Math.min(maxW, Math.max(MIN_W, r.width + dx));
    if (dir.includes('s')) height = Math.min(maxH, Math.max(MIN_H, r.height + dy));
    if (dir.includes('w')) { width = Math.min(maxW, Math.max(MIN_W, r.width - dx)); left = r.left + (r.width - width); }
    if (dir.includes('n')) { height = Math.min(maxH, Math.max(MIN_H, r.height - dy)); top = r.top + (r.height - height); }
    setRect({ top, left, width, height });
  };
  const onResizeUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* no active pointer */ }
    document.body.style.userSelect = '';
  };

  const submit = useCallback(() => {
    const v = input.trim();
    if (!v || loading) return;
    setInput('');
    onAsk(v);
  }, [input, loading, onAsk]);

  const handles: Array<{ dir: string; cls: string }> = [
    { dir: 'n', cls: 'top-0 left-2 right-2 h-1.5 cursor-ns-resize' },
    { dir: 's', cls: 'bottom-0 left-2 right-2 h-1.5 cursor-ns-resize' },
    { dir: 'e', cls: 'right-0 top-2 bottom-2 w-1.5 cursor-ew-resize' },
    { dir: 'w', cls: 'left-0 top-2 bottom-2 w-1.5 cursor-ew-resize' },
    { dir: 'ne', cls: 'top-0 right-0 w-3 h-3 cursor-nesw-resize' },
    { dir: 'nw', cls: 'top-0 left-0 w-3 h-3 cursor-nwse-resize' },
    { dir: 'se', cls: 'bottom-0 right-0 w-3 h-3 cursor-nwse-resize' },
    { dir: 'sw', cls: 'bottom-0 left-0 w-3 h-3 cursor-nesw-resize' },
  ];

  return (
    <div
      className="fixed z-[90] flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Title bar — drag to move */}
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b px-3 py-2"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
      >
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">/btw</span>
        <span className="flex-1 truncate text-xs font-semibold">{t('btw.title')}</span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClear}
          aria-label={t('btw.clear')}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Trash size={14} />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          aria-label={t('btw.close')}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-xs">
        {messages.length === 0 && !loading && (
          <div className="py-6 text-center text-muted-foreground">{t('btw.emptyHint')}</div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <Message key={m.id} from="user">
              <MessageContent>{m.content}</MessageContent>
            </Message>
          ) : (
            <Message key={m.id} from="assistant">
              <MessageContent>
                {m.content ? (
                  <MessageResponse>{m.content}</MessageResponse>
                ) : loading ? (
                  <Shimmer>{t('btw.thinking')}</Shimmer>
                ) : null}
              </MessageContent>
            </Message>
          ),
        )}
        {error && <div className="px-1 text-destructive">{error}</div>}
      </div>

      {/* Follow-up input — textarea + send/stop button side by side, equal height */}
      <div className="shrink-0 border-t p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t('btw.placeholder')}
            rows={1}
            className="min-h-8 max-h-24 min-w-0 flex-1 resize-none rounded-md border bg-transparent px-2 py-1.5 text-xs leading-5 outline-none focus:ring-1 focus:ring-ring"
          />
          {/* Send / stop button — mirrors the main composer (send idle, stop ■ while streaming) */}
          <PromptInputSubmit
            className="size-8 shrink-0"
            size="icon-sm"
            status={loading ? 'streaming' : undefined}
            onStop={onStop}
            onClick={submit}
            disabled={!loading && !input.trim()}
          />
        </div>
      </div>

      {/* Resize handles (edges + corners) */}
      {handles.map((h) => (
        <div
          key={h.dir}
          className={cn('absolute touch-none', h.cls)}
          onPointerDown={onResizeDown(h.dir)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
        />
      ))}
    </div>
  );
}

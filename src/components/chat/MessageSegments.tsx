'use client';

import React from 'react';
import type { RenderSegment } from '@/types';
import { ToolActionRow, ThinkingRow } from '@/components/ai-elements/tool-actions-group';

interface MessageSegmentsProps {
  /** Ordered segments (text / thinking / tool) in true chronological order. */
  segments: RenderSegment[];
  /**
   * Render a text segment. Widget / markdown / image-gen parsing lives in the
   * caller (MessageItem uses AssistantContent; StreamingMessage uses its
   * streaming-aware renderer). `isStreaming` is true only for the trailing
   * text segment while the turn is still streaming.
   */
  renderText: (text: string, opts: { isStreaming: boolean; keyHint: string }) => React.ReactNode;
  /** True while the turn is actively streaming. */
  isStreaming?: boolean;
  /** Live stderr/progress for the currently-running tool. */
  streamingToolOutput?: string;
}

/**
 * Renders an assistant message as an interleaved flow — text, tool calls and
 * thinking laid out in the exact order they occurred, like Claude Desktop.
 *
 * Consecutive tool/thinking segments are grouped under one continuous left
 * border (blockquote-style), and text segments break the groups. Tools are
 * flat single rows (no "N completed" collapse, no auto-grouping).
 */
export function MessageSegments({
  segments,
  renderText,
  isStreaming = false,
  streamingToolOutput,
}: MessageSegmentsProps) {
  // The last still-running tool gets the live streaming output attached.
  let lastRunningToolId: string | undefined;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.kind === 'tool' && s.result === undefined) { lastRunningToolId = s.id; break; }
  }

  // Only the last text segment is "streaming" (actively being appended).
  let lastTextIdx = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].kind === 'text') { lastTextIdx = i; break; }
  }

  const out: React.ReactNode[] = [];
  let run: Array<{ seg: RenderSegment; i: number }> = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const first = run[0].i;
    out.push(
      <div
        key={`run-${first}`}
        className="w-[min(100%,48rem)] border-l-2 border-border/50 pl-2 ml-1.5 my-1"
      >
        {run.map(({ seg, i }) =>
          seg.kind === 'thinking' ? (
            <ThinkingRow
              key={`th-${i}`}
              content={seg.thinking}
              isStreaming={isStreaming && i === segments.length - 1}
            />
          ) : seg.kind === 'tool' ? (
            <ToolActionRow
              key={seg.id || `tool-${i}`}
              tool={{
                id: seg.id,
                name: seg.name,
                input: seg.input,
                result: seg.result,
                isError: seg.isError,
                media: seg.media,
              }}
              streamingToolOutput={seg.id === lastRunningToolId ? streamingToolOutput : undefined}
            />
          ) : null,
        )}
      </div>,
    );
    run = [];
  };

  segments.forEach((seg, i) => {
    if (seg.kind === 'text') {
      flushRun();
      const node = renderText(seg.text, { isStreaming: isStreaming && i === lastTextIdx, keyHint: `t-${i}` });
      out.push(<React.Fragment key={`text-${i}`}>{node}</React.Fragment>);
    } else {
      run.push({ seg, i });
    }
  });
  flushRun();

  return <>{out}</>;
}

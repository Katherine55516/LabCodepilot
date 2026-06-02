'use client';

import React, { useState, useMemo, createElement } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Icon } from "@phosphor-icons/react";
import {
  File,
  NotePencil,
  Terminal,
  MagnifyingGlass,
  Wrench,
  SpinnerGap,
  CheckCircle,
  XCircle,
  CaretRight,
  Brain,
  Image as ImageIcon,
  Lightning,
} from "@phosphor-icons/react";
import { cn } from '@/lib/utils';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';

const thinkingPlugins = { cjk, math, mermaid };
import type { MediaBlock } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { formatToolInput, truncateToolResult } from '@/lib/message-segments';
import { toolDiff, type LineDiff } from '@/lib/tool-diff';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolAction {
  id?: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  media?: MediaBlock[];
}

interface ToolActionsGroupProps {
  tools: ToolAction[];
  isStreaming?: boolean;
  streamingToolOutput?: string;
  /** When true, skip the collapsible header and render the tool list directly */
  flat?: boolean;
  /** Thinking/reasoning content — rendered as the first expandable item inside the group */
  thinkingContent?: string;
}

// ---------------------------------------------------------------------------
// Tool Registry — extensible per-type rendering
// ---------------------------------------------------------------------------

interface ToolRendererDef {
  match: (name: string) => boolean;
  icon: Icon;
  label: string;
  getSummary: (input: unknown, name?: string) => string;
  /** Render inline detail when tool row is hovered/expanded (optional) */
  renderDetail?: (tool: ToolAction, streamingOutput?: string) => React.ReactNode;
}

function extractFilename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function getFilePath(input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return '';
  return (inp.file_path || inp.path || inp.filePath || '') as string;
}

function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;
  return '...' + path.slice(path.length - maxLen + 3);
}

const TOOL_REGISTRY: ToolRendererDef[] = [
  {
    match: (n) => ['bash', 'execute', 'run', 'shell', 'execute_command'].includes(n.toLowerCase()),
    icon: Terminal,
    label: 'bash',
    // Collapsed row reads "bash — <description>": prefer the human-readable
    // `description`; fall back to the command when none was provided.
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const desc = (inp?.description || '') as string;
      if (desc) return desc.length > 80 ? desc.slice(0, 77) + '...' : desc;
      const cmd = (inp?.command || inp?.cmd || '') as string;
      return cmd ? (cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd) : 'bash';
    },
    renderDetail: (tool, streamingOutput) => {
      const cmd = ((tool.input as Record<string, unknown>)?.command || (tool.input as Record<string, unknown>)?.cmd || '') as string;
      const isRunning = tool.result === undefined;
      // While running: show command + last 5 lines of output (rolling window)
      // When done: show command + full result (collapsible)
      const outputText = isRunning ? streamingOutput : tool.result;
      const displayLines = (() => {
        if (!outputText) return null;
        if (isRunning) {
          // Rolling window: only last 5 lines while streaming
          const lines = outputText.split('\n');
          return lines.slice(-5).join('\n');
        }
        // Completed: show full output, truncated to 20 lines with indicator
        const lines = outputText.split('\n');
        if (lines.length > 20) {
          return lines.slice(0, 20).join('\n') + `\n… +${lines.length - 20} lines`;
        }
        return outputText;
      })();

      return (
        <div className="mt-1 rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground/80 max-h-[140px] overflow-auto whitespace-pre-wrap break-all">
          {cmd && <div className="text-foreground/70">$ {cmd}</div>}
          {displayLines && (
            <div className={cn("mt-1", isRunning ? "text-muted-foreground/50" : "text-muted-foreground/60")}>
              {displayLines}
            </div>
          )}
        </div>
      );
    },
  },
  {
    match: (n) => ['write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit'].includes(n.toLowerCase()),
    icon: NotePencil,
    label: 'Edit',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : 'file';
    },
  },
  {
    match: (n) => ['read', 'readfile', 'read_file'].includes(n.toLowerCase()),
    icon: File,
    label: 'Read',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : 'file';
    },
  },
  {
    match: (n) => ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search'].includes(n.toLowerCase()),
    icon: MagnifyingGlass,
    label: 'Search',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const pattern = (inp?.pattern || inp?.query || inp?.glob || '') as string;
      return pattern ? `"${pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern}"` : 'search';
    },
  },
  {
    match: (n) => n.toLowerCase() === 'agent',
    icon: Lightning,
    label: 'Agent',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const agentType = (inp?.agent || 'general') as string;
      const prompt = (inp?.prompt || '') as string;
      const short = prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt;
      return `${agentType}: ${short}`;
    },
    renderDetail: (tool, streamingOutput) => {
      const isRunning = tool.result === undefined;
      const outputText = isRunning ? streamingOutput : undefined;
      if (!outputText && isRunning) return null;

      // Parse progress lines into structured items
      const lines = (outputText || '').split('\n').filter(Boolean);
      // Only show last 8 lines to avoid clutter
      const visible = lines.slice(-8);

      return (
        <div className="mt-1 ml-4 border-l-2 border-border/30 pl-2 space-y-0.5">
          {visible.map((line, i) => {
            const isActive = line.startsWith('>');
            const isDone = line.startsWith('[+]');
            const isError = line.startsWith('[x]');
            const isHeader = line.startsWith('[subagent:');
            return (
              <div
                key={i}
                className={cn(
                  "text-[11px] font-mono truncate",
                  isHeader ? "text-muted-foreground/70" :
                  isActive ? "text-muted-foreground/60" :
                  isDone ? "text-green-500/60" :
                  isError ? "text-red-500/60" :
                  "text-muted-foreground/50"
                )}
              >
                {isActive && <SpinnerGap size={10} className="inline-block mr-1 animate-spin align-text-bottom" />}
                {isDone && <CheckCircle size={10} className="inline-block mr-1 align-text-bottom" />}
                {isError && <XCircle size={10} className="inline-block mr-1 align-text-bottom" />}
                {line.replace(/^\[subagent:\w+\]\s*/, '').replace(/^>\s*/, '').replace(/^\[[+x]\]\s*/, '')}
              </div>
            );
          })}
        </div>
      );
    },
  },
  {
    // Fallback — must be last. Shows the raw tool name so unregistered tools
    // (TodoWrite, MCP tools, plugin tools) remain identifiable.
    match: () => true,
    icon: Wrench,
    label: '',
    getSummary: (input, name?: string) => {
      const prefix = name || '';
      if (!input || typeof input !== 'object') return prefix;
      const str = JSON.stringify(input);
      const detail = str.length > 50 ? str.slice(0, 47) + '...' : str;
      return prefix ? `${prefix} ${detail}` : detail;
    },
  },
];

function getRenderer(name: string): ToolRendererDef {
  return TOOL_REGISTRY.find((r) => r.match(name)) || TOOL_REGISTRY[TOOL_REGISTRY.length - 1];
}

/** Register a custom tool renderer. It takes priority over built-in ones. */
export function registerToolRenderer(def: ToolRendererDef): void {
  TOOL_REGISTRY.unshift(def);
}

// ---------------------------------------------------------------------------
// Status indicator — running: gray, completed: green, error: red
// ---------------------------------------------------------------------------

type ToolStatus = 'running' | 'success' | 'error';

function getStatus(tool: ToolAction): ToolStatus {
  if (tool.result === undefined) return 'running';
  return tool.isError ? 'error' : 'success';
}

function StatusDot({ status }: { status: ToolStatus }) {
  return (
    <AnimatePresence mode="wait">
      {status === 'running' && (
        <motion.span
          key="running"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="inline-flex"
        >
          <SpinnerGap size={14} className="shrink-0 animate-spin text-muted-foreground/50" />
        </motion.span>
      )}
      {status === 'success' && (
        <motion.span
          key="success"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="inline-flex"
        >
          <CheckCircle size={14} className="shrink-0 text-green-500" />
        </motion.span>
      )}
      {status === 'error' && (
        <motion.span
          key="error"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="inline-flex"
        >
          <XCircle size={14} className="shrink-0 text-red-500" />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Context tool grouping — auto-group 3+ consecutive read/search tools
// ---------------------------------------------------------------------------

const CONTEXT_TOOLS = new Set([
  'read', 'readfile', 'read_file',
  'glob', 'grep',
  'ls', 'list', 'list_files',
  'search', 'find_files', 'search_files',
]);

function isContextTool(name: string): boolean {
  return CONTEXT_TOOLS.has(name.toLowerCase());
}

type Segment =
  | { kind: 'context'; tools: ToolAction[] }
  | { kind: 'single'; tool: ToolAction };

function computeSegments(tools: ToolAction[]): Segment[] {
  const segments: Segment[] = [];
  let contextBuffer: ToolAction[] = [];

  const flushContext = () => {
    if (contextBuffer.length >= 3) {
      segments.push({ kind: 'context', tools: contextBuffer });
    } else {
      for (const t of contextBuffer) {
        segments.push({ kind: 'single', tool: t });
      }
    }
    contextBuffer = [];
  };

  for (const tool of tools) {
    if (isContextTool(tool.name)) {
      contextBuffer.push(tool);
    } else {
      flushContext();
      segments.push({ kind: 'single', tool });
    }
  }
  flushContext();
  return segments;
}

function ContextGroup({ tools }: { tools: ToolAction[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = tools.some((t) => t.result === undefined);
  const hasError = tools.some((t) => t.isError);
  const groupStatus: ToolStatus = hasRunning ? 'running' : hasError ? 'error' : 'success';

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-2 py-1 min-h-[28px] text-xs hover:bg-muted/30 rounded-sm transition-colors"
      >
        <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
        <CaretRight
          size={10}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
        <span className="font-medium text-muted-foreground">
          {hasRunning ? `Gathering context (${tools.length})` : `Gathered context (${tools.length} files)`}
        </span>
        <span className="ml-auto">
          <StatusDot status={groupStatus} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="ml-6 border-l-2 border-border/30 pl-2">
              {tools.map((tool, i) => (
                <ToolActionRow key={tool.id || `ctx-${i}`} tool={tool} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking row — same style as tool rows, Brain icon → caret on hover
// ---------------------------------------------------------------------------

export function ThinkingRow({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  // Default open during streaming, collapsed in history
  const [expanded, setExpanded] = useState(!!isStreaming);
  const [hovered, setHovered] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  // Extract summary from first **bold** or # heading
  const summary = (() => {
    const boldMatch = content.match(/\*\*(.+?)\*\*/);
    if (boldMatch) return boldMatch[1];
    const headingMatch = content.match(/^#{1,4}\s+(.+)$/m);
    if (headingMatch) return headingMatch[1];
    return isStreaming ? 'Thinking...' : 'Thought';
  })();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const willExpand = !expanded;
          setExpanded(willExpand);
          // Detach from auto-scroll when expanding to prevent page jump
          if (willExpand) stopScroll();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex items-center gap-2 px-2 py-1 min-h-[28px] text-xs hover:bg-muted/30 rounded-sm transition-colors w-full"
      >
        {hovered ? (
          <CaretRight
            size={14}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        ) : (
          <Brain size={14} className="shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-muted-foreground/60 truncate flex-1 text-left">
          {isStreaming ? <Shimmer duration={1.5}>{summary}</Shimmer> : summary}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="ml-6 px-2 py-1.5 text-xs text-muted-foreground/70 border-l-2 border-border/30 prose prose-sm dark:prose-invert max-w-none">
              <Streamdown plugins={thinkingPlugins}>{content}</Streamdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Shell-style tools: the param worth showing is the raw command, not the full
// {command, description} JSON (the description already sits in the collapsed row).
const COMMAND_TOOL_NAMES = new Set(['bash', 'execute', 'run', 'shell', 'execute_command']);

// ---------------------------------------------------------------------------
// Generic tool detail — params + result panel for tools without a bespoke
// renderDetail (Read / Edit / Write / Search / MCP / …). Also used for bash and
// agent AFTER they finish, so their final result (not just live progress) shows.
// ---------------------------------------------------------------------------

function GenericToolDetail({ tool, streamingToolOutput }: { tool: ToolAction; streamingToolOutput?: string }) {
  const { t } = useTranslation();
  const isRunning = tool.result === undefined;
  // Shell tools show just the raw command; everything else shows pretty JSON.
  const inp = tool.input as Record<string, unknown> | undefined;
  const shellCommand = COMMAND_TOOL_NAMES.has(tool.name.toLowerCase())
    ? ((inp?.command || inp?.cmd) as string | undefined)
    : undefined;
  const inputStr = typeof shellCommand === 'string' && shellCommand
    ? shellCommand
    : formatToolInput(tool.input);
  const rawResult = isRunning ? (streamingToolOutput ?? '') : (tool.result ?? '');
  const { text: shownResult, truncated, hiddenLines } = truncateToolResult(rawResult);
  const hasResult = shownResult.length > 0;

  return (
    <div className="mt-1 ml-6 border-l-2 border-border/30 pl-2 space-y-1.5 pb-1">
      {inputStr && (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.parameters')}
          </div>
          <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground/70">
            {inputStr}
          </pre>
        </div>
      )}
      {hasResult ? (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.result')}
          </div>
          <pre className={cn(
            "max-h-[240px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px]",
            tool.isError ? "text-red-500/70" : "text-muted-foreground/70"
          )}>
            {shownResult}
            {truncated && (
              <span className="mt-1 block text-muted-foreground/40">
                {hiddenLines > 0 ? t('tool.moreLines', { count: hiddenLines }) : t('tool.truncated')}
              </span>
            )}
          </pre>
        </div>
      ) : isRunning ? (
        <div className="py-0.5 text-[11px] text-muted-foreground/40">{t('tool.running')}</div>
      ) : (
        <div className="py-0.5 text-[11px] text-muted-foreground/40">{t('tool.noResult')}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff view — green/red line diff for Edit / Write / MultiEdit tool calls.
// Mirrors Claude desktop: removed lines red, added lines green, unchanged lines
// dimmed as context.
// ---------------------------------------------------------------------------

const MAX_DIFF_ROWS = 400;

function ToolDiffView({ diff }: { diff: LineDiff }) {
  const { t } = useTranslation();
  const rows = diff.lines.slice(0, MAX_DIFF_ROWS);
  const hidden = diff.lines.length - rows.length;

  return (
    <div className="mt-1 ml-6 border-l-2 border-border/30 pl-2 pb-1">
      <div className="max-h-[320px] overflow-auto rounded bg-muted/40 font-mono text-[11px] leading-relaxed">
        {rows.map((ln, i) => (
          <div
            key={i}
            className={cn(
              "flex px-2",
              ln.type === 'add' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              ln.type === 'remove' && "bg-red-500/10 text-red-600 dark:text-red-400",
              ln.type === 'context' && "text-muted-foreground/50",
            )}
          >
            <span className="mr-2 w-3 shrink-0 select-none opacity-60">
              {ln.type === 'add' ? '+' : ln.type === 'remove' ? '−' : ''}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all">{ln.text || ' '}</span>
          </div>
        ))}
        {hidden > 0 && (
          <div className="px-2 py-0.5 text-muted-foreground/40">{t('tool.moreLines', { count: hidden })}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact row for a single tool action — collapsible like ThinkingRow.
// Hover swaps the tool icon for a caret; click toggles an inline detail panel
// showing the call params + return result (or a diff view for file edits).
// ---------------------------------------------------------------------------

export function ToolActionRow({ tool, streamingToolOutput }: { tool: ToolAction; streamingToolOutput?: string }) {
  const renderer = getRenderer(tool.name);
  const summary = renderer.getSummary(tool.input, tool.name);
  const filePath = getFilePath(tool.input);
  const status = getStatus(tool);
  const isRunning = status === 'running';

  // bash / agent show their bespoke streaming detail ONLY while running (live
  // rolling output / sub-task progress). Once finished, they fall through to
  // GenericToolDetail so the final result is visible too.
  const hasCustomDetail = (renderer.icon === Terminal || renderer.icon === Lightning) && !!renderer.renderDetail;
  const liveCustom = hasCustomDetail && isRunning;
  // File-edit tools (Edit / Write / MultiEdit) render a green/red line diff and
  // a `+N −M` badge in the row header, Claude-desktop style.
  const diff = useMemo(() => toolDiff(tool.name, tool.input), [tool.name, tool.input]);
  const hasDiff = !!diff && (diff.added > 0 || diff.removed > 0);
  const hasInput = !!tool.input && typeof tool.input === 'object' && Object.keys(tool.input as Record<string, unknown>).length > 0;
  const hasResult = tool.result !== undefined && tool.result !== '';
  const expandable = liveCustom || hasDiff || hasResult || hasInput || (isRunning && !!streamingToolOutput);

  // Running rows default open (watch live output); completed/historical rows
  // default closed. Initial value is read once on mount, so a tool that
  // finishes while expanded stays expanded.
  const [expanded, setExpanded] = useState(isRunning);
  const [hovered, setHovered] = useState(false);
  const { stopScroll } = useStickToBottomContext();

  const rowInner = (
    <>
      {expandable && hovered ? (
        <CaretRight
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
      ) : (
        createElement(renderer.icon, { size: 14, className: "shrink-0 text-muted-foreground" })
      )}

      {renderer.label && (
        <span className="font-medium text-muted-foreground shrink-0">{renderer.label}</span>
      )}

      <span className="font-mono text-muted-foreground/60 truncate flex-1 text-left">
        {summary}
      </span>

      {filePath && !hasCustomDetail && !hasDiff && (
        <span className="text-muted-foreground/40 text-[11px] font-mono truncate max-w-[200px] hidden sm:inline">
          {truncatePath(filePath)}
        </span>
      )}

      {hasDiff && (
        <span className="shrink-0 flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
          {diff!.added > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{diff!.added}</span>}
          {diff!.removed > 0 && <span className="text-red-600 dark:text-red-400">−{diff!.removed}</span>}
        </span>
      )}

      {tool.media && tool.media.length > 0 && (
        <ImageIcon size={14} className="shrink-0 text-primary/60" />
      )}

      <StatusDot status={status} />
    </>
  );

  const rowClass = "flex w-full items-center gap-2 px-2 py-1 min-h-[28px] text-xs text-left hover:bg-muted/30 rounded-sm transition-colors";

  return (
    <div>
      {expandable ? (
        <button
          type="button"
          onClick={() => {
            const willExpand = !expanded;
            setExpanded(willExpand);
            if (willExpand) stopScroll();
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={rowClass}
        >
          {rowInner}
        </button>
      ) : (
        <div className={rowClass}>{rowInner}</div>
      )}

      <AnimatePresence initial={false}>
        {expandable && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            {liveCustom
              ? renderer.renderDetail?.(tool, streamingToolOutput)
              : hasDiff
                ? <ToolDiffView diff={diff!} />
                : <GenericToolDetail tool={tool} streamingToolOutput={streamingToolOutput} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header summary helper — build running task description
// ---------------------------------------------------------------------------

function getRunningDescription(tools: ToolAction[]): string {
  const running = tools.filter((t) => t.result === undefined);
  if (running.length === 0) return '';
  const last = running[running.length - 1];
  return getRenderer(last.name).getSummary(last.input, last.name);
}

// ---------------------------------------------------------------------------
// Main group component
// ---------------------------------------------------------------------------

export function ToolActionsGroup({
  tools,
  isStreaming = false,
  streamingToolOutput,
  flat = false,
  thinkingContent,
}: ToolActionsGroupProps) {
  const hasRunningTool = tools.some((t) => t.result === undefined);

  // Track whether user has manually toggled and their chosen state
  const [userExpandedState, setUserExpandedState] = useState<boolean | null>(null);

  // Derived: if user has toggled, use their choice; otherwise auto-expand based on streaming state
  const expanded = userExpandedState !== null ? userExpandedState : (hasRunningTool || isStreaming);

  if (tools.length === 0 && !thinkingContent) return null;

  // Flat mode: skip header, render tool list directly
  if (flat) {
    const lastRunningId = [...tools].reverse().find((t) => t.result === undefined)?.id;
    return (
      <div className="w-[min(100%,48rem)]">
        <div className="border-l-2 border-border/50 pl-2 ml-1.5">
          {thinkingContent && <ThinkingRow content={thinkingContent} isStreaming={isStreaming} />}
          {computeSegments(tools).map((seg, i) =>
            seg.kind === 'context' ? (
              <ContextGroup key={`ctx-group-${i}`} tools={seg.tools} />
            ) : (
              <ToolActionRow
                key={seg.tool.id || `tool-${i}`}
                tool={seg.tool}
                streamingToolOutput={seg.tool.id === lastRunningId ? streamingToolOutput : undefined}
              />
            )
          )}
        </div>
      </div>
    );
  }

  const runningCount = tools.filter((t) => t.result === undefined).length;
  const doneCount = tools.length - runningCount;
  const runningDesc = getRunningDescription(tools);

  const handleToggle = () => {
    setUserExpandedState((prev) => prev !== null ? !prev : !expanded);
  };

  // Build summary text parts
  const summaryParts: string[] = [];
  if (runningCount > 0) summaryParts.push(`${runningCount} running`);
  if (doneCount > 0) summaryParts.push(`${doneCount} completed`);
  if (runningCount === 0 && isStreaming) summaryParts.push('generating response');
  if (summaryParts.length === 0) summaryParts.push(`${tools.length} actions`);

  return (
    <div className="w-[min(100%,48rem)]">
      {/* Header — content left, caret right */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 py-1 text-xs rounded-sm hover:bg-muted/30 transition-colors"
      >
        <span className="inline-flex items-center justify-center rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground/70 tabular-nums">
          {tools.length + (thinkingContent ? 1 : 0)}
        </span>

        <span className="text-muted-foreground/60 truncate">
          {summaryParts.join(' · ')}
        </span>

        {/* Show running task description */}
        {runningDesc && (
          <span className="text-muted-foreground/40 text-[11px] font-mono truncate max-w-[40%]">
            {hasRunningTool ? <Shimmer duration={1.5}>{runningDesc}</Shimmer> : runningDesc}
          </span>
        )}

        <CaretRight
          size={12}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform duration-200 ml-auto",
            expanded && "rotate-90"
          )}
        />
      </button>

      {/* Expanded list — left vertical line like blockquote */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden', transformOrigin: 'top' }}
          >
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div className="ml-1.5 mt-0.5 border-l-2 border-border/50 pl-2">
                {thinkingContent && <ThinkingRow content={thinkingContent} isStreaming={isStreaming} />}
                {(() => {
                  const segments = computeSegments(tools);
                  // Find the last running tool to attach streamingToolOutput
                  const lastRunningId = [...tools].reverse().find((t) => t.result === undefined)?.id;
                  return segments.map((seg, i) =>
                    seg.kind === 'context' ? (
                      <ContextGroup key={`ctx-group-${i}`} tools={seg.tools} />
                    ) : (
                      <ToolActionRow
                        key={seg.tool.id || `tool-${i}`}
                        tool={seg.tool}
                        streamingToolOutput={seg.tool.id === lastRunningId ? streamingToolOutput : undefined}
                      />
                    )
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

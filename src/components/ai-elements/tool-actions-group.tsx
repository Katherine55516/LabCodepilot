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
  Globe,
  ListChecks,
  CheckSquare,
  Square,
  Question,
  Sparkle,
  ClipboardText,
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
import { toolTodos, activeTodoForm, type TodoItem } from '@/lib/tool-todos';
import { parseAskQuestions, parseAskAnswers } from '@/lib/tool-ask';

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
  /** When set, the expanded "参数" panel shows just this input field's raw
   *  string value (e.g. 'command' for bash, 'prompt' for WebFetch) instead of
   *  the full input JSON — the other fields already surface in the collapsed
   *  row (bash description / WebFetch url). */
  primaryParam?: string;
  /** Custom 参数 panel renderer — overrides primaryParam / JSON. */
  renderParams?: (input: unknown) => React.ReactNode;
  /** Custom 结果 panel renderer — overrides the raw result text (e.g. show only
   *  the user's selected answers for AskUserQuestion). */
  renderResult?: (result: string, input: unknown) => React.ReactNode;
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
    primaryParam: 'command',
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
    primaryParam: 'file_path',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : 'file';
    },
  },
  {
    match: (n) => ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search'].includes(n.toLowerCase()),
    icon: MagnifyingGlass,
    label: 'Search',
    renderParams: (input) => <SearchParamsView input={input} />,
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const pattern = (inp?.pattern || inp?.query || inp?.glob || '') as string;
      return pattern ? `"${pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern}"` : 'search';
    },
  },
  {
    // WebFetch — collapsed row shows the target URL; expanded 参数 shows the prompt.
    match: (n) => ['webfetch', 'web_fetch', 'fetch', 'url_fetch'].includes(n.toLowerCase()),
    icon: Globe,
    label: 'WebFetch',
    getSummary: (input) => {
      const url = ((input as Record<string, unknown>)?.url || '') as string;
      return url || 'fetch';
    },
    primaryParam: 'prompt',
    renderResult: (result) => <MarkdownResultView result={result} />,
  },
  {
    // TodoWrite — collapsed row shows the in-progress step's activeForm;
    // expanded panel renders the todos as a checklist (see TodoListView).
    match: (n) => ['todowrite', 'todo_write'].includes(n.toLowerCase()),
    icon: ListChecks,
    label: 'TodoWrite',
    getSummary: (input) => {
      const todos = toolTodos('todowrite', input);
      return todos ? activeTodoForm(todos) : 'todos';
    },
  },
  {
    // AskUserQuestion — 参数 panel lists each question + its options;
    // 结果 panel shows only the user's selected answers (see tool-ask.ts).
    match: (n) => ['askuserquestion', 'ask_user_question'].includes(n.toLowerCase()),
    icon: Question,
    label: 'AskUserQuestion',
    getSummary: (input) => {
      const qs = parseAskQuestions(input);
      return qs && qs[0]?.question ? qs[0].question : 'question';
    },
    renderParams: (input) => <AskQuestionsView input={input} />,
    renderResult: (result, input) => <AskAnswersView result={result} input={input} />,
  },
  {
    // Skill — collapsed row shows the skill name; expanded 参数 shows args.
    match: (n) => n.toLowerCase() === 'skill',
    icon: Sparkle,
    label: 'Skill',
    getSummary: (input) => {
      const skill = ((input as Record<string, unknown>)?.skill || '') as string;
      return skill || 'skill';
    },
    primaryParam: 'args',
  },
  {
    // ExitPlanMode — collapsed row shows only the label; 参数 splits into the
    // plan (rendered as markdown) and the plan file path.
    match: (n) => ['exitplanmode', 'exit_plan_mode'].includes(n.toLowerCase()),
    icon: ClipboardText,
    label: 'ExitPlanMode',
    getSummary: () => '',
    renderParams: (input) => <ExitPlanParamsView input={input} />,
  },
  {
    match: (n) => n.toLowerCase() === 'agent',
    icon: Lightning,
    label: 'Agent',
    // Collapsed row reads "Agent <subagent_type>"; params show 任务描述 + 提示词,
    // result is the sub-agent's final markdown output (rendered, not truncated).
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      return (inp?.subagent_type || inp?.agent || 'general') as string;
    },
    renderParams: (input) => <AgentParamsView input={input} />,
    renderResult: (result) => <MarkdownResultView result={result} />,
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

// ---------------------------------------------------------------------------
// Search params — show 路径 / 匹配规则 instead of raw {path, pattern} JSON.
// ---------------------------------------------------------------------------

function SearchParamsView({ input }: { input: unknown }) {
  const { t } = useTranslation();
  const inp = (input || {}) as Record<string, unknown>;
  const path = (inp.path || '') as string;
  const pattern = (inp.pattern || inp.query || inp.glob || '') as string;
  return (
    <div className="space-y-1 rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground/70">
      {path && (
        <div className="break-all">
          <span className="text-muted-foreground/40">{t('tool.searchPath')}：</span>{path}
        </div>
      )}
      {pattern && (
        <div className="break-all">
          <span className="text-muted-foreground/40">{t('tool.searchPattern')}：</span>{pattern}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AskUserQuestion — questions + options (参数) and the user's selected answers
// (结果). Single / multi-select and free-text "Other" all handled by tool-ask.ts.
// ---------------------------------------------------------------------------

function AskQuestionsView({ input }: { input: unknown }) {
  const questions = parseAskQuestions(input);
  if (!questions) return null;
  return (
    <div className="space-y-2">
      {questions.map((q, qi) => (
        <div key={qi} className="space-y-1">
          <div className="text-xs font-medium text-foreground/80 break-words">{q.question}</div>
          <div className="ml-1 space-y-1">
            {q.options.map((opt, oi) => (
              <div key={oi} className="border-l-2 border-border/40 pl-2">
                <div className="text-[11px] font-medium text-muted-foreground/80 break-words">{opt.label}</div>
                {opt.description && (
                  <div className="text-[11px] text-muted-foreground/50 break-words">{opt.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AskAnswersView({ result, input }: { result: string; input: unknown }) {
  const answers = parseAskAnswers(result, input);
  if (answers.length === 0) {
    return <span className="text-[11px] text-muted-foreground/60 break-words">{result}</span>;
  }
  return (
    <div className="space-y-1.5">
      {answers.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          {a.answers.map((ans, j) => (
            <span
              key={j}
              className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
            >
              <CheckCircle size={12} weight="fill" className="shrink-0" />
              {ans}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent (sub-agent) — params show 任务描述 + 提示词; result is the sub-agent's
// final markdown output, rendered with a reader (full content, scrollable).
// ---------------------------------------------------------------------------

function AgentParamsView({ input }: { input: unknown }) {
  const { t } = useTranslation();
  const inp = (input || {}) as Record<string, unknown>;
  const description = (inp.description || '') as string;
  const prompt = (inp.prompt || '') as string;
  return (
    <div className="space-y-1.5">
      {description && (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.agentDescription')}
          </div>
          <div className="rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground/80 break-words">
            {description}
          </div>
        </div>
      )}
      {prompt && (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.agentPrompt')}
          </div>
          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground/70">
            {prompt}
          </pre>
        </div>
      )}
    </div>
  );
}

function MarkdownResultView({ result }: { result: string }) {
  // Shared compact markdown reader for tool results (Agent sub-agent output,
  // WebFetch page content). Body ≈ the old plain-text size (11px), headings kept
  // small but still tiered (h1>h2>h3>h4), colors softened. Arbitrary variants
  // reliably override the typography plugin's larger defaults.
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none max-h-[520px] overflow-auto rounded bg-muted/40 px-3 py-2 text-[11px] leading-relaxed",
        "[&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[12px] [&_h4]:text-[11px]",
        "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold",
        "[&_h1]:mb-1 [&_h1]:mt-2 [&_h2]:mb-1 [&_h2]:mt-2 [&_h3]:mb-0.5 [&_h3]:mt-1.5 [&_h4]:mb-0.5 [&_h4]:mt-1.5",
        "[&_h1]:text-foreground/85 [&_h2]:text-foreground/85 [&_h3]:text-foreground/80 [&_h4]:text-foreground/80",
        "[&_p]:my-1 [&_p]:text-[11px] [&_p]:text-muted-foreground/80",
        "[&_li]:my-0.5 [&_li]:text-[11px] [&_li]:text-muted-foreground/80 [&_ul]:my-1 [&_ol]:my-1",
        "[&_strong]:font-semibold [&_strong]:text-foreground/90",
        "[&_code]:text-[11px] [&_pre]:my-1 [&_pre]:text-[11px]",
        "[&_table]:text-[11px] [&_th]:text-[11px] [&_td]:text-[11px]",
        "[&_a]:text-primary",
      )}
    >
      <Streamdown plugins={thinkingPlugins}>{result}</Streamdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExitPlanMode params — the plan (rendered as markdown) + the plan file path.
// ---------------------------------------------------------------------------

function ExitPlanParamsView({ input }: { input: unknown }) {
  const { t } = useTranslation();
  const inp = (input || {}) as Record<string, unknown>;
  const plan = (inp.plan || '') as string;
  const planFilePath = (inp.planFilePath || '') as string;
  return (
    <div className="space-y-2">
      {plan && (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.planContent')}
          </div>
          <MarkdownResultView result={plan} />
        </div>
      )}
      {planFilePath && (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.planFile')}
          </div>
          <div className="rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground/70 break-all">
            {planFilePath}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic tool detail — params + result panel for tools without a bespoke
// renderDetail (Read / Edit / Write / Search / MCP / …). Also used for bash and
// agent AFTER they finish, so their final result (not just live progress) shows.
// ---------------------------------------------------------------------------

function GenericToolDetail({ tool, streamingToolOutput }: { tool: ToolAction; streamingToolOutput?: string }) {
  const { t } = useTranslation();
  const renderer = getRenderer(tool.name);
  const isRunning = tool.result === undefined;
  // Param panel: renderParams (custom JSX) > primaryParam (single raw field) > JSON.
  const inp = tool.input as Record<string, unknown> | undefined;
  const customParams = renderer.renderParams?.(tool.input);
  const primaryVal = renderer.primaryParam && inp ? inp[renderer.primaryParam] : undefined;
  const inputStr = typeof primaryVal === 'string' && primaryVal
    ? primaryVal
    : formatToolInput(tool.input);
  // Result panel: renderResult (custom JSX, e.g. selected answers) > raw text.
  const customResult = !isRunning && tool.result ? renderer.renderResult?.(tool.result, tool.input) : undefined;
  const rawResult = isRunning ? (streamingToolOutput ?? '') : (tool.result ?? '');
  const { text: shownResult, truncated, hiddenLines } = truncateToolResult(rawResult);
  const hasResult = shownResult.length > 0;

  return (
    <div className="mt-1 ml-6 border-l-2 border-border/30 pl-2 space-y-1.5 pb-1">
      {(customParams || inputStr) && (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.parameters')}
          </div>
          {customParams ?? (
            <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground/70">
              {inputStr}
            </pre>
          )}
        </div>
      )}
      {customResult ? (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/40">
            {t('tool.result')}
          </div>
          {customResult}
        </div>
      ) : hasResult ? (
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
// Todo checklist — TodoWrite renders its todos as a checklist (completed
// struck-through, in_progress highlighted, pending hollow), matching the
// agent's live task tracker. Row text uses the `content` field.
// ---------------------------------------------------------------------------

function TodoListView({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="mt-1 ml-6 border-l-2 border-border/30 pl-2 pb-1 space-y-1">
      {todos.map((todo, i) => {
        const done = todo.status === 'completed';
        const active = todo.status === 'in_progress';
        return (
          <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
            {done ? (
              <CheckSquare size={15} weight="fill" className="mt-px shrink-0 text-muted-foreground/50" />
            ) : active ? (
              <CheckSquare size={15} weight="fill" className="mt-px shrink-0 text-primary" />
            ) : (
              <Square size={15} className="mt-px shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                "flex-1 break-words",
                done && "line-through text-muted-foreground/50",
                active && "text-primary font-medium",
                !done && !active && "text-muted-foreground/70",
              )}
            >
              {todo.content || todo.activeForm}
            </span>
          </div>
        );
      })}
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
  // TodoWrite renders its todos as a checklist instead of raw JSON.
  const todos = useMemo(() => toolTodos(tool.name, tool.input), [tool.name, tool.input]);
  const hasTodos = !!todos && todos.length > 0;
  const hasInput = !!tool.input && typeof tool.input === 'object' && Object.keys(tool.input as Record<string, unknown>).length > 0;
  const hasResult = tool.result !== undefined && tool.result !== '';
  const expandable = liveCustom || hasDiff || hasTodos || hasResult || hasInput || (isRunning && !!streamingToolOutput);

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
                : hasTodos
                  ? <TodoListView todos={todos!} />
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

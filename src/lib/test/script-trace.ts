import fs from 'fs';
import { atomicWriteText, sha256Hex, stableStringify, traceFile } from './script-artifacts';

export interface ScriptTraceAction {
  caseId: string;
  sequence: number;
  toolName: string;
  playwrightCode?: string;
  success: boolean;
  usesMock: boolean;
  timestampOffsetMs: number;
}

export interface ScriptTraceFile {
  version: 1;
  taskName: string;
  env: string;
  runHash: string;
  createdAt: string;
  actions: ScriptTraceAction[];
}

interface PendingTool {
  caseId: string;
  sequence: number;
  toolName: string;
  startedAt: number;
}

export interface TraceRedaction {
  value: string | null | undefined;
  replacement: string;
}

// NOTE: 与 markers.ts 的口径保持一致(容忍 `**@@CASE_START {...}**` 这类装饰)。这里贪婪
// 到行内最后一个 `}`,对本模块只取 `id` 的用途足够;严格的 JSON 收割一律走 markers.ts。
const TRACE_MARKER = /@@(CASE_START|RESULT)\s+(\{[^\r\n]*\})/g;

export function extractPlaywrightCode(content: string): string | undefined {
  const match = /### Ran Playwright code\s*\r?\n```(?:js|javascript|ts|typescript)?\r?\n([\s\S]*?)\r?\n```/i.exec(content);
  return match?.[1]?.trim() || undefined;
}

export function redactTraceText(value: string, redactions: TraceRedaction[]): string {
  let out = value;
  for (const item of redactions) {
    if (!item.value) continue;
    out = out.split(item.value).join(item.replacement);
  }
  out = out
    .replace(/(authorization\s*[:=]\s*["']?)(bearer\s+)?[^"'\s,;}]+/gi, '$1$2${AUTH_TOKEN}')
    .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["'])[^"']+(["'])/gi, '$1${SECRET}$2')
    .replace(/([?&](?:token|access_token|refresh_token|api_key)=)[^&#\s]+/gi, '$1${SECRET}');
  return out;
}

export class ScriptTraceCollector {
  private activeCaseId = '';
  private textBuffer = '';
  private markerScanOffset = 0;
  private sequenceByCase = new Map<string, number>();
  private pending = new Map<string, PendingTool>();
  private actions: ScriptTraceAction[] = [];

  constructor(
    private readonly runStartMs: number,
    private readonly redactions: TraceRedaction[] = [],
  ) {}

  feedText(chunk: string): void {
    this.textBuffer += chunk;
    TRACE_MARKER.lastIndex = this.markerScanOffset;
    let processedThrough = this.markerScanOffset;
    for (;;) {
      const match = TRACE_MARKER.exec(this.textBuffer);
      if (!match) break;
      processedThrough = TRACE_MARKER.lastIndex;
      try {
        const value = JSON.parse(match[2]) as { id?: unknown };
        if (typeof value.id !== 'string' || !value.id.trim()) continue;
        const id = value.id.trim();
        if (match[1] === 'CASE_START') this.activeCaseId = id;
        else if (id === this.activeCaseId) this.activeCaseId = '';
      } catch { /* malformed marker: consume it once and continue */ }
    }
    this.markerScanOffset = processedThrough;
    // Bound memory without dropping a marker that may be split across stream chunks.
    if (this.textBuffer.length > 32_768) {
      const drop = Math.min(this.markerScanOffset, this.textBuffer.length - 16_384);
      if (drop > 0) {
        this.textBuffer = this.textBuffer.slice(drop);
        this.markerScanOffset -= drop;
      }
    }
  }

  feedToolUse(raw: unknown): void {
    const value = raw as { id?: unknown; name?: unknown };
    if (!this.activeCaseId || typeof value.id !== 'string' || typeof value.name !== 'string') return;
    if (!/browser_/i.test(value.name)) return;
    const next = (this.sequenceByCase.get(this.activeCaseId) ?? 0) + 1;
    this.sequenceByCase.set(this.activeCaseId, next);
    this.pending.set(value.id, {
      caseId: this.activeCaseId,
      sequence: next,
      toolName: value.name,
      startedAt: Date.now(),
    });
  }

  feedToolResult(raw: unknown): void {
    const value = raw as { tool_use_id?: unknown; content?: unknown; is_error?: unknown };
    if (typeof value.tool_use_id !== 'string') return;
    const pending = this.pending.get(value.tool_use_id);
    if (!pending) return;
    this.pending.delete(value.tool_use_id);
    const content = typeof value.content === 'string' ? redactTraceText(value.content, this.redactions) : '';
    const code = extractPlaywrightCode(content);
    this.actions.push({
      caseId: pending.caseId,
      sequence: pending.sequence,
      toolName: pending.toolName,
      ...(code ? { playwrightCode: code } : {}),
      success: value.is_error !== true,
      usesMock: /browser_(?:un)?route/i.test(pending.toolName),
      timestampOffsetMs: Math.max(0, pending.startedAt - this.runStartMs),
    });
  }

  finish(): ScriptTraceAction[] {
    return [...this.actions].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.sequence - b.sequence);
  }
}

export function normalizedTraceHash(actions: ScriptTraceAction[]): string {
  const normalized = actions.map(({ caseId, sequence, toolName, playwrightCode, success, usesMock }) => ({
    caseId,
    sequence,
    toolName,
    playwrightCode: playwrightCode?.replace(/\s+/g, ' ').trim(),
    success,
    usesMock,
  }));
  return sha256Hex(stableStringify(normalized));
}

export function writeTraceFile(
  projectPath: string,
  taskName: string,
  env: string,
  runHash: string,
  actions: ScriptTraceAction[],
): void {
  const header = { type: 'header', version: 1, taskName, env, runHash, createdAt: new Date().toISOString() };
  const lines = [JSON.stringify(header), ...actions.map((action) => JSON.stringify({ type: 'action', ...action }))];
  atomicWriteText(traceFile(projectPath, taskName, env), lines.join('\n') + '\n');
}

export function readTraceFile(projectPath: string, taskName: string, env: string): ScriptTraceFile | null {
  try {
    const lines = fs.readFileSync(traceFile(projectPath, taskName, env), 'utf-8').split('\n').filter(Boolean);
    if (!lines.length) return null;
    const header = JSON.parse(lines[0]) as Record<string, unknown>;
    if (header.type !== 'header' || header.version !== 1) return null;
    const actions: ScriptTraceAction[] = [];
    for (const line of lines.slice(1)) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (value.type === 'action' && typeof value.caseId === 'string' && typeof value.sequence === 'number') {
          const { type: _type, ...action } = value;
          void _type;
          actions.push(action as unknown as ScriptTraceAction);
        }
      } catch { /* skip malformed line */ }
    }
    return {
      version: 1,
      taskName: String(header.taskName ?? ''),
      env: String(header.env ?? ''),
      runHash: String(header.runHash ?? ''),
      createdAt: String(header.createdAt ?? ''),
      actions,
    };
  } catch {
    return null;
  }
}

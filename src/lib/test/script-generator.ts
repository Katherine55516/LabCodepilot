import { generateTextViaSdk } from '@/lib/claude-client';
import type { ReducedTest, RunJson } from './reduce';
import {
  SCRIPT_GENERATOR_VERSION,
  SCRIPT_TEMPLATE_VERSION,
  scriptFileName,
  sha256Hex,
  stableStringify,
} from './script-artifacts';
import { normalizedTraceHash, redactTraceText, type ScriptTraceAction, type TraceRedaction } from './script-trace';
import { isUnsafeSegment } from './path-safety';

export interface EligibleScriptCase {
  /** ID used by this execution run (unique even in the aggregate regression-library task). */
  id: string;
  /** ID that must appear in the generated script title and filename. */
  scriptCaseId: string;
  /** Optional physical owner for synthetic regression-library runs. */
  targetTaskName?: string;
  sourceMissing?: boolean;
  testCase: Record<string, unknown>;
  result: ReducedTest;
  actions: ScriptTraceAction[];
  fileName: string;
  fingerprint: string;
  usesMock: boolean;
}

export interface EligibleSelection {
  eligible: EligibleScriptCase[];
  staleIds: string[];
  errors: string[];
  blockedReason?: 'circuit_broken';
}

function readCases(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
  if (raw && typeof raw === 'object' && Array.isArray((raw as { cases?: unknown }).cases)) {
    return ((raw as { cases: unknown[] }).cases).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
  }
  return [];
}

function semanticFingerprint(
  testCase: Record<string, unknown>,
  actions: ScriptTraceAction[],
  runtimeVersion: string,
): string {
  return sha256Hex(stableStringify({
    testCase,
    traceHash: normalizedTraceHash(actions),
    generatorVersion: SCRIPT_GENERATOR_VERSION,
    templateVersion: SCRIPT_TEMPLATE_VERSION,
    runtimeVersion,
  }));
}

export function selectEligibleCases(
  casesRaw: unknown,
  run: RunJson,
  actions: ScriptTraceAction[],
  runtimeVersion: string,
): EligibleSelection {
  const cases = readCases(casesRaw);
  const errors: string[] = [];
  const caseById = new Map<string, Record<string, unknown>>();
  for (const testCase of cases) {
    const id = typeof testCase.id === 'string' ? testCase.id.trim() : '';
    if (!id) { errors.push('case without id'); continue; }
    if (caseById.has(id)) { errors.push(`duplicate case id: ${id}`); continue; }
    caseById.set(id, testCase);
  }
  const resultById = new Map<string, ReducedTest>();
  for (const result of run.tests ?? []) {
    if (resultById.has(result.id)) { errors.push(`duplicate result id: ${result.id}`); continue; }
    resultById.set(result.id, result);
  }
  if (run.circuitBroken) {
    return { eligible: [], staleIds: [...caseById.keys()], errors, blockedReason: 'circuit_broken' };
  }

  const eligible: EligibleScriptCase[] = [];
  const staleIds: string[] = [];
  for (const [id, testCase] of caseById) {
    const tags = Array.isArray(testCase.tags) ? testCase.tags.filter((t): t is string => typeof t === 'string') : [];
    const result = resultById.get(id);
    if (!tags.includes('回归测试') || result?.status !== 'pass') {
      staleIds.push(id);
      continue;
    }
    const caseActions = actions.filter((action) => action.caseId === id && action.success);
    const fingerprint = semanticFingerprint(testCase, caseActions, runtimeVersion);
    eligible.push({
      id,
      scriptCaseId: id,
      testCase,
      result,
      actions: caseActions,
      fileName: scriptFileName(id),
      fingerprint,
      usesMock: caseActions.some((a) => a.usesMock),
    });
  }
  return { eligible, staleIds, errors };
}

/**
 * The project-level regression library is a synthetic task. Retarget its run IDs
 * back to the real task/case so one physical script is owned by the source task,
 * while keeping the synthetic run ID as the manifest/retry key.
 */
export function retargetLibraryCandidates(
  candidates: EligibleScriptCase[],
  idMap: Record<string, { task: string; originalId: string }>,
  runtimeVersion: string,
): EligibleScriptCase[] {
  return candidates.map((candidate) => {
    const source = idMap[candidate.id];
    if (!source || isUnsafeSegment(source.task) || !source.originalId.trim()) {
      return { ...candidate, sourceMissing: true };
    }
    const scriptCaseId = source.originalId.trim();
    const testCase = { ...candidate.testCase, id: scriptCaseId };
    const actions = candidate.actions.map((action) => ({ ...action, caseId: scriptCaseId }));
    return {
      ...candidate,
      scriptCaseId,
      targetTaskName: source.task,
      testCase,
      result: { ...candidate.result, id: scriptCaseId },
      actions,
      fileName: scriptFileName(scriptCaseId),
      fingerprint: semanticFingerprint(testCase, actions, runtimeVersion),
    };
  });
}

export interface GeneratedScript {
  caseId: string;
  fileName: string;
  content: string;
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['scripts'],
  properties: {
    scripts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caseId', 'fileName', 'content'],
        properties: {
          caseId: { type: 'string' },
          fileName: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  },
};

function parseJsonResult(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* try fenced payload */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  if (fenced) return JSON.parse(fenced.trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('generator returned invalid JSON');
}

/**
 * `@playwright/test` is the specifier every model reaches for, but the script
 * runner only symlinks the `playwright` package bundled with @playwright/mcp —
 * `@playwright/test` is not resolvable there, so the validator rejects it and
 * the whole case fails. `playwright/test` re-exports the same `test`/`expect`
 * (see playwright/test.js), making this rewrite a semantic no-op that turns an
 * otherwise-good script into a valid one.
 */
export function normalizePlaywrightImport(source: string): string {
  return source.replace(
    /((?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["'])@playwright\/test(["'])/g,
    '$1playwright/test$2',
  );
}

function validateGeneratedPayload(raw: unknown, expected: EligibleScriptCase[]): GeneratedScript[] {
  const scripts = raw && typeof raw === 'object' && Array.isArray((raw as { scripts?: unknown }).scripts)
    ? (raw as { scripts: unknown[] }).scripts : [];
  const expectedById = new Map(expected.map((c) => [c.id, c]));
  const out: GeneratedScript[] = [];
  const seen = new Set<string>();
  for (const value of scripts) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    if (typeof item.caseId !== 'string' || typeof item.fileName !== 'string' || typeof item.content !== 'string') continue;
    const target = expectedById.get(item.caseId);
    if (!target || seen.has(item.caseId) || item.fileName !== target.fileName) continue;
    seen.add(item.caseId);
    out.push({ caseId: item.caseId, fileName: item.fileName, content: normalizePlaywrightImport(item.content) });
  }
  return out;
}

export async function generateScriptsBatch(params: {
  candidates: EligibleScriptCase[];
  model?: string;
  providerId?: string;
  redactions?: TraceRedaction[];
  abortSignal?: AbortSignal;
}): Promise<GeneratedScript[]> {
  const candidates = params.candidates.slice(0, 5);
  if (!candidates.length) return [];
  const payload = candidates.map((candidate) => ({
    // caseId is the unique response key. scriptCaseId is the human/source ID
    // that must appear in the Playwright test title.
    caseId: candidate.id,
    scriptCaseId: candidate.scriptCaseId,
    fileName: candidate.fileName,
    testCase: candidate.testCase,
    executionResult: candidate.result,
    usesMock: candidate.usesMock,
    executedPlaywrightCode: candidate.actions.map((action) => ({
      tool: action.toolName,
      code: action.playwrightCode ?? '',
    })),
  }));
  const cleanPayload = redactTraceText(JSON.stringify(payload, null, 2), params.redactions ?? []);
  const system = `你是 Playwright 自动化脚本工程师。把已经真实执行并通过的回归用例沉淀为可独立运行的 TypeScript 测试。
只返回符合 JSON Schema 的对象，不输出 Markdown，不调用任何工具。
每条输入必须恰好返回一个脚本，caseId/fileName 原样返回。
脚本必须 import { test, expect } from "playwright/test"（注意：不是 "@playwright/test"，运行环境里不存在该包），
每文件恰好一个 test，标题包含 scriptCaseId，至少一个 expect。除此之外禁止任何 import/require。
只能使用相对 URL 或 process.env.BASE_URL；账号密码只能引用 process.env.TEST_USERNAME/TEST_PASSWORD，禁止写真实秘密、storageState 路径和本机绝对路径。
优先 getByTestId/getByRole/getByLabel，其次 getByText/getByPlaceholder；不得使用 MCP ref。
定位器必须唯一：Playwright 的 name 选项默认按【子串】匹配，页面上的列表项/卡片常带 role="button" 且文案包含同样的字，
一个宽泛的 name 会命中多个元素并以 strict mode violation 失败。因此 getByRole/getByText 传字符串 name 时必须写
{ name: "…", exact: true }（传正则时不需要，正则本身已限定）。若同一名称仍可能重复，用 getByTestId 或先
locator("form")/locator("dialog") 等容器缩小范围，再在容器内定位；不要用 .first() 掩盖歧义。
脚本必须建立自身前置条件，不依赖上一条用例状态，并按用例 cleanup 清理。`;
  const text = await generateTextViaSdk({
    providerId: params.providerId,
    model: params.model,
    system,
    prompt: `为以下 ${candidates.length} 条用例生成脚本。执行轨迹是事实依据；用例 expected 用于生成断言。\n\n${cleanPayload}`,
    abortSignal: params.abortSignal,
    // 每条用例要产出一个完整 Playwright 文件，默认 60s 在满批（5 条）时必然超时。
    timeoutMs: Math.max(120_000, candidates.length * 60_000),
    outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA },
  });
  return validateGeneratedPayload(parseJsonResult(text), candidates);
}

// ── AI 修复（运行失败 → 喂回错误定向修脚本）─────────────────────────────────
// 测试人员不写代码，脚本运行失败后的唯一出路是把失败原因交还给模型修。
// 红线：只修技术缺陷（定位器、等待、前置数据），不得为通过而弱化断言 ——
// 否则「修复」会亲手掩盖用例本应暴露的产品缺陷。

export interface RepairScriptInput {
  candidate: EligibleScriptCase;
  /** The script as it exists on disk right now. */
  currentContent: string;
  /** Why the last run failed (redacted). This is what the model must address. */
  failure: string;
}

export interface RepairOutcome {
  caseId: string;
  fixed: boolean;
  /** 面向不写代码的测试人员的一句话解释（修了什么 / 为什么不能修）。 */
  reason: string;
  /** Present only when fixed. */
  content?: string;
}

const REPAIR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['repairs'],
  properties: {
    repairs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caseId', 'fileName', 'fixed', 'reason', 'content'],
        properties: {
          caseId: { type: 'string' },
          fileName: { type: 'string' },
          fixed: { type: 'boolean' },
          reason: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  },
};

export function validateRepairPayload(raw: unknown, expected: RepairScriptInput[]): RepairOutcome[] {
  const repairs = raw && typeof raw === 'object' && Array.isArray((raw as { repairs?: unknown }).repairs)
    ? (raw as { repairs: unknown[] }).repairs : [];
  const expectedById = new Map(expected.map((input) => [input.candidate.id, input]));
  const out: RepairOutcome[] = [];
  const seen = new Set<string>();
  for (const value of repairs) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    if (typeof item.caseId !== 'string' || typeof item.fileName !== 'string'
      || typeof item.fixed !== 'boolean' || typeof item.reason !== 'string'
      || typeof item.content !== 'string') continue;
    const target = expectedById.get(item.caseId);
    if (!target || seen.has(item.caseId) || item.fileName !== target.candidate.fileName) continue;
    seen.add(item.caseId);
    // 声称修了却没给内容 → 视为未修，把模型的解释保留给用户。
    if (item.fixed && !item.content.trim()) {
      out.push({ caseId: item.caseId, fixed: false, reason: item.reason || 'AI 声称已修复但未返回脚本内容' });
      continue;
    }
    out.push({
      caseId: item.caseId,
      fixed: item.fixed,
      reason: item.reason,
      ...(item.fixed ? { content: normalizePlaywrightImport(item.content) } : {}),
    });
  }
  return out;
}

export async function repairScriptsBatch(params: {
  inputs: RepairScriptInput[];
  model?: string;
  providerId?: string;
  redactions?: TraceRedaction[];
  abortSignal?: AbortSignal;
}): Promise<RepairOutcome[]> {
  const inputs = params.inputs.slice(0, 5);
  if (!inputs.length) return [];
  const payload = inputs.map(({ candidate, currentContent, failure }) => ({
    caseId: candidate.id,
    scriptCaseId: candidate.scriptCaseId,
    fileName: candidate.fileName,
    testCase: candidate.testCase,
    executionResult: candidate.result,
    failure,
    currentScript: currentContent,
  }));
  const cleanPayload = redactTraceText(JSON.stringify(payload, null, 2), params.redactions ?? []);
  const system = `你是 Playwright 自动化脚本工程师。以下每条输入是一份【运行失败】的回归脚本：testCase 是用例（事实依据），currentScript 是当前脚本，failure 是本次运行的失败原因。请针对 failure 修复脚本。
只返回符合 JSON Schema 的对象，不输出 Markdown，不调用任何工具。每条输入恰好返回一项，caseId/fileName 原样返回。
【只允许修技术缺陷】：定位器歧义或找不到元素（getByRole/getByText 传字符串 name 必须 { exact: true }；仍有歧义就用 getByTestId 或先用容器缩小范围，不要用 .first() 掩盖）、等待时机、前置条件/数据准备。
【红线】：如果 failure 表明页面实际行为与用例 expected 不一致（断言如实失败），这不是脚本缺陷，禁止通过弱化、删除或反转断言让脚本通过 —— 返回 fixed=false，reason 用一句测试人员能懂的话说明「页面实际行为是 X，用例预期是 Y，需人工确认是产品缺陷还是用例预期有误」。
fixed=true 时 content 为修复后的完整脚本，并保持生成约束：import { test, expect } from "playwright/test"（不是 "@playwright/test"）；每文件恰好一个 test，标题含 scriptCaseId，至少一个 expect；只用相对 URL 或 process.env.BASE_URL；账号密码只用 process.env.TEST_USERNAME/TEST_PASSWORD；除 playwright/test 外禁止任何 import/require。fixed=false 时 content 返回空字符串。
reason 永远必填：修了什么、或为什么不能修，一句话，写给不会写代码的测试人员。`;
  const text = await generateTextViaSdk({
    providerId: params.providerId,
    model: params.model,
    system,
    prompt: `修复以下 ${inputs.length} 条运行失败的脚本。\n\n${cleanPayload}`,
    abortSignal: params.abortSignal,
    // 修复比生成更重：输入含完整旧脚本 + 失败原因，还要判断「该不该修」。单条 120s 实测
    // 会超时（qwen3.7-max）；给足预算，避免超时抛错让流水线中断。
    timeoutMs: Math.max(300_000, inputs.length * 120_000),
    outputFormat: { type: 'json_schema', schema: REPAIR_SCHEMA },
  });
  return validateRepairPayload(parseJsonResult(text), inputs);
}

import { generateTextViaSdk } from '@/lib/claude-client';
import type { ReducedTest, RunJson } from './reduce';
import {
  SCRIPT_GENERATOR_VERSION,
  SCRIPT_TEMPLATE_VERSION,
  scriptFileName,
  sha256Hex,
  stableStringify,
} from './script-artifacts';
import {
  normalizedTraceHash,
  redactTraceText,
  type ObservedElement,
  type ObservedElementsByCase,
  type ScriptTraceAction,
  type TraceRedaction,
} from './script-trace';
import { isUnsafeSegment } from './path-safety';
import { caseFingerprint } from './library';

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
  /**
   * 执行当时页面可访问性树里观察到的具名元素（含从未被点击的断言目标）。断言的定位器词汇表
   * ——没有它，模型只能给「只看过没点过」的元素凭空捏 CSS class（见 script-trace.ts）。
   */
  observedElements: ObservedElement[];
  fileName: string;
  fingerprint: string;
  usesMock: boolean;
  /** 用例体语义指纹(caseFingerprint 口径)——落 manifest 供回归重放防错配。 */
  caseBodyHash: string;
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
  elementsByCase: ObservedElementsByCase = {},
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
      observedElements: elementsByCase[id] ?? [],
      fileName: scriptFileName(id),
      fingerprint,
      usesMock: caseActions.some((a) => a.usesMock),
      // caseFingerprint 排除 id/tags —— retarget 改写 id 后依然同值,无需重算。
      caseBodyHash: caseFingerprint(testCase as Parameters<typeof caseFingerprint>[0]),
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
  throw new Error('AI 返回的内容不是有效 JSON');
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
    observedElements: candidate.observedElements,
  }));
  const cleanPayload = redactTraceText(JSON.stringify(payload, null, 2), params.redactions ?? []);
  const system = `你是 Playwright 自动化脚本工程师。把已经真实执行并通过的回归用例沉淀为可独立运行的 TypeScript 测试。
只返回符合 JSON Schema 的对象，不输出 Markdown，不调用任何工具。
每条输入必须恰好返回一个脚本，caseId/fileName 原样返回。
脚本必须 import { test, expect } from "playwright/test"（注意：不是 "@playwright/test"，运行环境里不存在该包），
每文件恰好一个 test，标题包含 scriptCaseId，至少一个 expect。除此之外禁止任何 import/require。
只能使用相对 URL 或 process.env.BASE_URL；账号密码只能引用 process.env.TEST_USERNAME/TEST_PASSWORD，禁止写真实秘密、storageState 路径和本机绝对路径。
整份文件【只能有一个顶层 test(...)】，标题必须以 scriptCaseId 开头。多个步骤要写进【同一个】test 内，用 await test.step("步骤N：…", async () => { … }) 分段（test.step 不算额外的 test，且不要给它加标题外的 ID）。绝对不要把每个步骤拆成多个 test()，也不要用 test.describe 包多个 test —— 校验器会以「恰好一个 test()」直接判失败。结构必须严格如下（占位符换成真实内容）：
import { test, expect } from "playwright/test";

test("<scriptCaseId> <一句话用例目的>", async ({ page }) => {
  await test.step("步骤1：…", async () => {
    // 操作 + await expect(...) 断言
  });
  await test.step("步骤2：…", async () => {
    // …
  });
});

优先 getByTestId/getByRole/getByLabel，其次 getByText/getByPlaceholder；不得使用 MCP ref。
定位器必须唯一：Playwright 的 name 选项默认按【子串】匹配，页面上的列表项/卡片常带 role="button" 且文案包含同样的字，
一个宽泛的 name 会命中多个元素并以 strict mode violation 失败。因此 getByRole/getByText 传字符串 name 时必须写
{ name: "…", exact: true }（传正则时不需要，正则本身已限定）。若同一名称仍可能重复，用 getByTestId 或先
locator("form")/locator("dialog") 等容器缩小范围，再在容器内定位；不要用 .first() 掩盖歧义。
注意 exact 只防【子串误配】，防不了【精确重名】：查询表单的字段 label 与表格列头往往逐字相同（如「员工姓名」
既是表单 label 又是列头），断言这类文本必须先用 locator("form") 等容器收窄，否则 strict mode violation（真机踩坑）。
按用例内容判断它是 UI 测试还是 API 接口测试：
- UI 测试：用上面的定位器对页面做断言。
- API 接口测试（用例在验证某个 HTTP 接口的状态码/响应体/字段，如「验证 GET /api/xxx 返回…」）：用 Playwright 的 request fixture ——
  test("标题", async ({ request }) => { const res = await request.get("/api/xxx"); expect(res.status()).toBe(200); const body = await res.json(); ... })，
  URL 用相对路径（自动走 BASE_URL），断言 res.status()/res.ok() 与 await res.json() 的字段。
  【严禁】使用 fetch()/XMLHttpRequest/eval/Function/page.evaluate 里发网络请求，也不要 import 任何 http 库 —— 校验器会直接拒绝，只能用 request fixture。
【observedElements = 执行当时从页面可访问性树观察到的真实元素（role + name），是断言定位器的事实来源】：
- executedPlaywrightCode 只覆盖【被操作过】的元素；断言常打在【只出现在页面、从未被点击】的元素上，
  这类元素的唯一事实来源就是 observedElements。
- 断言定位器只能来自两处：① executedPlaywrightCode 里真实出现过的定位器；② observedElements 里的元素
  ——写成 getByRole("<role>", { name: "<name>", exact: true })，role/name 必须与清单里的条目【逐字一致】。
- 【严禁】臆造 CSS class / 结构选择器（如 .avatar-uploader、.el-upload、div > span）——这类选择器是组件库
  内部实现，页面上未必存在、版本一变就失效，重放会直接 element(s) not found（真机踩坑）。
- observedElements 里【没有】的元素，不要断言它存在：清单是这条用例执行期间页面上出现过的元素并集，
  找不到就说明轨迹没证据，改用轨迹已验证过的其它断言，不要硬编一个定位器。
- 注意清单是【词汇表】不是【当前页面状态】：一条用例可能跨多个页面，清单是并集；元素是否在断言时可见，
  以轨迹与用例语义为准。

【断言必须基于执行轨迹这个事实来源，不要凭 expected 文案臆造】——这是脚本重放能通过的关键：
1. 优先复用 executedPlaywrightCode 里【真实出现过并成功】的选择器、文本、正则。它们是"页面确实如此"的铁证；
   用例 expected 只是预期描述，措辞常和真实 DOM 不一致。两者冲突时【以轨迹为准】。
2. 轨迹里若用 page.evaluate 读 document.body.innerText 做子串/正则检查（说明"某文本出现在整页某处"），
   生成脚本对应的断言【必须】用 await expect(page.locator("body")).toContainText("轨迹里检查的那个字符串或正则")，
   【不要】用 page.getByText(/.../)。因为 getByText 匹配【单个元素】的文本，而"阶段"和数字"0"这类统计常在
   不同 DOM 元素里（<span>阶段</span><span>0</span>），innerText 拼接后是"阶段 0"、但没有任何单元素文本等于
   "阶段 0"，getByText 会匹配失败（真机踩坑）。整页文本判断只能用 locator("body").toContainText。
3. 不要臆造比轨迹更强/更具体的断言：轨迹只验证了 /阶段\s*\d+/（存在阶段数），就别写 /阶段\s*0/（恰好 0）；
   除非 expected 明确要求某具体值、且轨迹也确实验证过该值。断言宁可贴合轨迹已证事实，也不要更严导致重放失败。
脚本必须建立自身前置条件，不依赖上一条用例状态，并按用例 cleanup 清理。`;
  const text = await generateTextViaSdk({
    providerId: params.providerId,
    model: params.model,
    system,
    prompt: `为以下 ${candidates.length} 条用例生成脚本。executedPlaywrightCode 执行轨迹是【事实来源】——断言优先基于它已验证过的选择器/文本/正则；用例 expected 只提供意图，与轨迹冲突时以轨迹为准。\n\n${cleanPayload}`,
    abortSignal: params.abortSignal,
    // 逐条生成（generateMissing 每次传 1 条），单条给 240s。真机实测：企业代理延迟忽高忽低，
    // 120s 下约 1/3 单条生成会顶破超时（且每轮超时的用例还不一样，纯环境抖动、非用例问题）。
    // 逐条隔离后单条超时不再拖累别人，故放宽到 240s 给代理留足余量。formula 保留对多条的兼容。
    timeoutMs: Math.max(240_000, candidates.length * 60_000),
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
    observedElements: candidate.observedElements,
    failure,
    currentScript: currentContent,
  }));
  const cleanPayload = redactTraceText(JSON.stringify(payload, null, 2), params.redactions ?? []);
  const system = `你是 Playwright 自动化脚本工程师。以下每条输入是一份【运行失败】的回归脚本：testCase 是用例（事实依据），currentScript 是当前脚本，failure 是本次运行的失败原因。请针对 failure 修复脚本。
只返回符合 JSON Schema 的对象，不输出 Markdown，不调用任何工具。每条输入恰好返回一项，caseId/fileName 原样返回。
【只允许修技术缺陷】：定位器歧义或找不到元素（getByRole/getByText 传字符串 name 必须 { exact: true }；仍有歧义就用 getByTestId 或先用容器缩小范围，不要用 .first() 掩盖）、等待时机、前置条件/数据准备。
【strict mode violation（定位器命中多个元素）的修法】：先读 failure 里列出的候选元素文本——若与断言文本【逐字相同】（如查询表单 label 与表格列头都叫「员工姓名」），加 { exact: true } 无效：exact 只防子串误配，防不了精确重名。必须用容器收窄——failure 里每个候选自带的 aka 提示就是现成答案（如 aka locator("form").getByText(...) → 直接照抄），或改用 getByTestId；不要用 .first() 掩盖（真机踩坑：修复只加了 exact，重跑仍以同样的 strict mode violation 失败）。
【observedElements = 执行当时页面可访问性树里的真实元素（role + name），修定位器时以它为准】：failure 若是
element(s) not found / Locator 找不到，且当前脚本用的是 CSS class 或结构选择器（如 .avatar-uploader），
几乎可以断定是【臆造的定位器】——去 observedElements 里找语义对应的元素，改写成
getByRole("<role>", { name: "<name>", exact: true })（role/name 与清单逐字一致）。清单里确实没有对应元素时，
说明该元素在执行期从未出现过，属于断言与事实不符 → 走下面的红线（fixed=false、讲清楚），不要再换一个猜的选择器。
【断言写法与页面渲染不符，属技术缺陷、必须修正（不是弱化）】：仔细读 failure 里的 Received/实际文本——如果它【确实包含】expected 想验证的内容，只是格式/顺序/正则方向和断言写法对不上，就把断言改成匹配真实渲染。典型：页面渲染是「数字在前」如 "0踩坑"，而断言写成 /踩坑\s*\d+/（数字在后）永远匹配不上，应改成 /\d+\s*踩坑/；或 getByText 单元素匹配不到跨元素拼接的文本，应改用 expect(page.locator("body")).toContainText(...)。这类是把断言【对齐事实】，不是弱化，放心修。
【红线】：只有当 Received 里【根本没有】expected 要验证的内容（页面实际行为与用例预期真不一致、断言如实失败）时，才禁止通过弱化/删除/反转断言让脚本通过 —— 返回 fixed=false，reason 用一句测试人员能懂的话说明「页面实际是 X、用例预期是 Y，需人工确认是产品缺陷还是用例预期有误」。
fixed=true 时 content 为修复后的完整脚本，并保持生成约束：import { test, expect } from "playwright/test"（不是 "@playwright/test"）；【整份文件恰好一个顶层 test】，标题以 scriptCaseId 开头，多个步骤写进同一个 test 内并用 await test.step("步骤N：…", async () => {…}) 分段，绝不拆成多个 test 或用 test.describe 包多个；至少一个 expect；只用相对 URL 或 process.env.BASE_URL；账号密码只用 process.env.TEST_USERNAME/TEST_PASSWORD；除 playwright/test 外禁止任何 import/require。fixed=false 时 content 返回空字符串。
reason 永远必填：修了什么、或为什么不能修，一句话，写给不会写代码的测试人员。`;
  const text = await generateTextViaSdk({
    providerId: params.providerId,
    model: params.model,
    system,
    prompt: `修复以下 ${inputs.length} 条运行失败的脚本。\n\n${cleanPayload}`,
    abortSignal: params.abortSignal,
    // 修复比生成更重：输入含完整旧脚本 + 失败原因，还要判断「该不该修」。真机实测复杂用例
    // （TC-034 那种 Dashboard 渲染）单条 300s 仍会超时；配合流式连接不掉，放宽到 480s 给足预算。
    timeoutMs: Math.max(480_000, inputs.length * 150_000),
    outputFormat: { type: 'json_schema', schema: REPAIR_SCHEMA },
  });
  return validateRepairPayload(parseJsonResult(text), inputs);
}

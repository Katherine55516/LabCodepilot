import fs from 'fs';
import path from 'path';
import { appendAudit } from './audit';
import { resolveProjectEnvWithDb } from './env-resolve';
import { sha1Hex } from './history';
import { artifactPaths } from './prompts';
import { generateScriptsBatch, repairScriptsBatch, retargetLibraryCandidates, selectEligibleCases, type EligibleScriptCase, type GeneratedScript, type RepairScriptInput } from './script-generator';
import {
  SCRIPT_GENERATOR_VERSION,
  SCRIPT_MANIFEST_VERSION,
  SCRIPT_TEMPLATE_VERSION,
  jobKey,
  manifestCounts,
  readManifest,
  scriptFile,
  scriptsDir,
  writeManifest,
  type ScriptManifest,
  type ScriptManifestCase,
} from './script-artifacts';
import { readTraceFile, redactTraceText, type ObservedElement, type ScriptTraceAction, type TraceRedaction } from './script-trace';
import { isSafeForAutomaticReplay, validateScriptSource, type StaticScriptValidation } from './script-validator';
import { resolveScriptPlaywrightRuntime, runGeneratedScript, summarizeRunFailure } from './script-runner';
import { isUnsafeSegment } from './path-safety';
import type { ReducedTest, RunJson } from './reduce';
import { buildRunnableCases, libraryRunMapFile, readLibrary, REGRESSION_LIBRARY_TASK } from './library';

export interface ScriptJobRequest {
  projectPath: string;
  taskName: string;
  env: string;
  runHash: string;
  model?: string;
  providerId?: string;
  forceCaseIds?: string[];
  /**
   * 回归轮次号。v2 起回归执行的产物落 `report/{task}/{roundId}/`,不带它就会去平铺目录找
   * run.json 并 ENOENT —— 回归轮次的脚本生成因此**从来没成功过**(审计里那条
   * 「回归脚本后台生成失败:ENOENT ... 回归用例库-local.run.json」)。普通任务不传,路径不变。
   */
  roundId?: string;
  /**
   * 跳过 done/partial 的幂等去重、重新排一次任务（executeJob 内部的指纹复用仍生效：
   * 没变的用例不再调模型）。手动「重试缺口」必须置 true —— 否则用例改了（指纹变了）、
   * 或上轮有 failed 用例时，同 runHash 的重试会被去重静默吞掉，按钮等于空转。
   * 报告流的自动触发不置此值，保持重复报告幂等。
   */
  forceRefresh?: boolean;
  /** 生成后自动运行 + 失败自动修的流水线（被测应用可达时才跑）。默认关闭；报告触发的自动生成默认开启。 */
  runPipeline?: boolean;
  /** 修复轮次上限，默认 3。 */
  maxRepairRounds?: number;
}

const DEFAULT_MAX_REPAIR_ROUNDS = 3;

/**
 * 生成阶段（纯模型调用）的并发度。
 *
 * 定成 3 而不是更大：瓶颈是等模型返回，并发能线性摊薄墙上时钟；但网关有速率限制，且每条
 * 并发都占一个 SDK 子进程（内存/句柄），过高反而触发限流与资源竞争。3 条足以把典型的
 * 4-9 条批次压到 1/3 左右，是收益与风险的平衡点。
 *
 * 注意：只有【生成】并发。校验/重放仍严格串行 —— 它们要起 Playwright 真跑被测应用，
 * 并发操作同一个 SUT 会互相踩数据（详见 generateMissing 的两阶段注释）。
 */
const GENERATION_CONCURRENCY = 3;

export interface EnqueueResult {
  queued: boolean;
  reused: boolean;
  jobKey: string;
}

/**
 * 逐条增量生成请求(执行流中 @@RESULT pass 一落就发)。
 *
 * 与整轮任务(ScriptJobRequest)的根本差别:**此刻 run.json 还不存在**(它在执行收口才落盘),
 * 所以输入靠内存直传,不读文件、不校 runHash。
 */
export interface IncrementalScriptCaseRequest {
  projectPath: string;
  taskName: string;
  env: string;
  roundId?: string;
  model?: string;
  providerId?: string;
  /** 本轮执行起始挂钟:同一轮内稳定,仅用于日志/审计标识,不写进 manifest.latestRunHash。 */
  runStartMs: number;
  /** cases.json 里的用例体(执行开始时读入)。 */
  caseBody: Record<string, unknown>;
  /** 该用例的 @@RESULT 判定(仅 pass 才会走到这里)。 */
  result: ReducedTest;
  /** 该用例已收集的操作轨迹(collector.drainCase)。 */
  traceActions: ScriptTraceAction[];
  /** 该用例已观察到的元素清单(collector.elementsForCase)。 */
  observedElements: ObservedElement[];
}

interface FullQueueEntry extends ScriptJobRequest {
  kind: 'full';
  key: string;
}

interface IncrementalQueueEntry extends IncrementalScriptCaseRequest {
  kind: 'incremental';
  key: string;
}

type QueueEntry = FullQueueEntry | IncrementalQueueEntry;

const queue: QueueEntry[] = [];
const queuedKeys = new Set<string>();
const activeKeys = new Set<string>();
const abortByScope = new Map<string, AbortController>();
let running = false;

const scopeKey = (request: ScriptJobRequest) => `${path.resolve(request.projectPath)}\0${request.taskName}\0${request.env}`;

function runtimeVersion(): string {
  try { return resolveScriptPlaywrightRuntime().version; } catch { return 'unknown'; }
}

function newManifest(request: ScriptJobRequest, key: string, previous?: ScriptManifest | null): ScriptManifest {
  const now = new Date().toISOString();
  return {
    version: SCRIPT_MANIFEST_VERSION,
    taskName: request.taskName,
    env: request.env,
    latestRunHash: request.runHash,
    jobKey: key,
    jobStatus: 'queued',
    generatorVersion: SCRIPT_GENERATOR_VERSION,
    templateVersion: SCRIPT_TEMPLATE_VERSION,
    runtimeVersion: runtimeVersion(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    counts: previous?.counts ?? { eligible: 0, generated: 0, verified: 0, needsReview: 0, failed: 0 },
    cases: previous?.cases ?? [],
  };
}

function markManifest(
  request: ScriptJobRequest,
  patch: Partial<ScriptManifest>,
): ScriptManifest {
  const current = readManifest(request.projectPath, request.taskName, request.env)
    ?? newManifest(request, jobKey(request.projectPath, request.taskName, request.env, request.runHash));
  const next: ScriptManifest = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeManifest(request.projectPath, request.taskName, request.env, next);
  return next;
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }        // signal 0 = 存活探测，不真正发信号
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } // EPERM = 存在但无权限
}

function readLockOwnerPid(file: string): number | null {
  try {
    const pid = (JSON.parse(fs.readFileSync(file, 'utf-8')) as { pid?: unknown }).pid;
    return typeof pid === 'number' && Number.isInteger(pid) ? pid : null;
  } catch { return null; }
}

/**
 * 非抛错版锁获取(回归轮次「脚本重放」用):锁被生成任务持有时返回 null,调用方把该任务的
 * 用例整组降级走 AI 执行,不阻塞轮次。僵尸锁判定与 acquireLock 一致(内部同一实现)。
 */
export function tryAcquireScriptLock(projectPath: string, taskName: string, env: string): { close: () => void } | null {
  try {
    return acquireLock({ projectPath, taskName, env, runHash: 'regression-replay' });
  } catch {
    return null;
  }
}

function acquireLock(request: ScriptJobRequest): { close: () => void } {
  const dir = scriptsDir(request.projectPath, request.taskName, request.env);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.generation.lock');
  const tryOpen = () => fs.openSync(file, 'wx');
  let fd: number;
  try {
    fd = tryOpen();
  } catch {
    try {
      const stat = fs.statSync(file);
      // 判定僵尸锁：① 持有者进程已死（应用被强退/崩溃留下的锁 —— 无需等 30 分钟）；
      // ② 或超过 30 分钟（同机异进程、或读不到 pid 的兜底）。命中即抢占。
      const age = Date.now() - stat.mtimeMs;
      const owner = readLockOwnerPid(file);
      const ownerDead = owner != null && owner !== process.pid && !isPidAlive(owner);
      if (ownerDead || age > 30 * 60_000) fs.unlinkSync(file);
      fd = tryOpen();
    } catch {
      throw new Error('脚本任务正在运行中，请稍候再试');
    }
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, jobKey: jobKey(request.projectPath, request.taskName, request.env, request.runHash), time: new Date().toISOString() }));
  return {
    close() {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    },
  };
}

function parseCaseFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
}

function regressionLibraryIdMap(projectPath: string): Record<string, { task: string; originalId: string }> {
  try {
    const raw = JSON.parse(fs.readFileSync(libraryRunMapFile(projectPath), 'utf-8')) as { idMap?: unknown };
    if (raw.idMap && typeof raw.idMap === 'object' && !Array.isArray(raw.idMap)) {
      const out: Record<string, { task: string; originalId: string }> = {};
      for (const [runId, source] of Object.entries(raw.idMap as Record<string, unknown>)) {
        if (!source || typeof source !== 'object') continue;
        const value = source as { task?: unknown; originalId?: unknown };
        if (typeof value.task === 'string' && typeof value.originalId === 'string') {
          out[runId] = { task: value.task, originalId: value.originalId };
        }
      }
      if (Object.keys(out).length) return out;
    }
  } catch { /* old aggregate runs fall back to the current deterministic library map */ }
  return buildRunnableCases(readLibrary(projectPath)).idMap;
}

function redactionsFor(request: ScriptJobRequest): TraceRedaction[] {
  const resolved = resolveProjectEnvWithDb(request.projectPath, request.env);
  return [
    { value: request.projectPath, replacement: '${PROJECT_ROOT}' },
    { value: resolved.frontendBaseUrl, replacement: '${BASE_URL}' },
    { value: resolved.storageStatePath, replacement: '${STORAGE_STATE}' },
    { value: resolved.loginAccount?.username, replacement: '${TEST_USERNAME}' },
    { value: resolved.loginAccount?.password, replacement: '${TEST_PASSWORD}' },
  ];
}

function safeRedactionsFor(request: ScriptJobRequest): TraceRedaction[] {
  try { return redactionsFor(request); }
  catch { return [{ value: request.projectPath, replacement: '${PROJECT_ROOT}' }]; }
}

function currentInputs(request: ScriptJobRequest): {
  run: RunJson;
  casesRaw: unknown;
  traceActions: NonNullable<ReturnType<typeof readTraceFile>>['actions'];
  traceElements: NonNullable<ReturnType<typeof readTraceFile>>['elementsByCase'];
  runContent: string;
} {
  const p = artifactPaths(request.taskName, request.env, request.roundId);
  const runContent = fs.readFileSync(path.join(request.projectPath, p.runJson), 'utf-8');
  if (sha1Hex(runContent) !== request.runHash) throw new Error('已被更新的一轮执行取代（superseded）');
  const run = JSON.parse(runContent) as RunJson;
  const casesRaw = parseCaseFile(path.join(request.projectPath, artifactPaths(request.taskName).cases));
  const trace = readTraceFile(request.projectPath, request.taskName, request.env);
  const sameRun = trace?.runHash === request.runHash;
  const traceActions = sameRun ? trace.actions : [];
  // 存量 trace 无 elements 行 → 空表，候选的 observedElements 退化为 []（行为等同改动前）。
  const traceElements = sameRun ? trace.elementsByCase : {};
  return { run, casesRaw, traceActions, traceElements, runContent };
}

function candidateTempFile(finalFile: string): string {
  const dir = path.dirname(finalFile);
  const stem = path.basename(finalFile, '.spec.ts');
  return path.join(dir, `.${stem}.${process.pid}.${Date.now()}.candidate.spec.ts`);
}

function candidateFinalFile(request: ScriptJobRequest, candidate: EligibleScriptCase): string {
  return scriptFile(
    request.projectPath,
    candidate.targetTaskName ?? request.taskName,
    request.env,
    candidate.scriptCaseId,
  );
}

function candidateSource(candidate: EligibleScriptCase): Pick<ScriptManifestCase, 'sourceTask' | 'sourceCaseId'> {
  return candidate.targetTaskName
    ? { sourceTask: candidate.targetTaskName, sourceCaseId: candidate.scriptCaseId }
    : {};
}

// ── Recovery state-machine contract ───────────────────────────────────────────
// The generation pipeline has exactly two dead-end-free recovery channels, and a
// case must land in a state one of them accepts or it is permanently stuck. These
// predicates make that contract explicit and testable (a 2026-07-11 review found a
// replay-failed read-only case was dead-ended as 'failed' — outside BOTH channels).

/**
 * Script is on disk and may be run / re-run against the SUT (运行 / pipeline).
 *
 * 含 `outdated`：该状态的定义就是「重新生成失败，但**盘上仍有一份可用的旧脚本**」——
 * 两处产生点(generateMissing / validateAndPublish 的 failed 分支)都以
 * `fs.existsSync(finalFile)` 为前提，没有旧文件的一律记 `failed`。
 *
 * 真机踩坑(2026-07-21)：TC-051 点「重试」重新生成时撞上跨境链路坏窗口（网关 401 被 SDK
 * 原样报成 `Not logged in`），落 `outdated`。此后那份完好的旧脚本**掉出了所有恢复通道**
 * —— 不能运行(此谓词曾排除它)、不能 AI 修复(无 lastRunError)、不能人工确认(非
 * needs_review)，唯一出路是反复重试生成、反复赌网络。这与 2026-07-11 修掉的 `failed`
 * 死态是同一类问题：**有可用脚本却无路可走**。
 */
export function isRunnableStatus(status: ScriptManifestCase['status']): boolean {
  return status === 'verified' || status === 'needs_review' || status === 'outdated';
}

/**
 * 属于【本轮】用例集的条目。`stale` = 本轮未测(历次用例集换代后留下的旧条目,脚本文件仍在
 * 盘上但已不在当前回归范围内)。
 *
 * 存在的理由(真机踩坑 2026-07-21):`jobStatus` 的终态判定曾写成
 * `manifest.cases.some(c => c.lastRunError)` —— 全量扫描。一条 7-14 留下的 stale 条目
 * (TC-005,当时前端没起、报 ECONNREFUSED)让本轮 6/6 全部通过的任务被判成 `partial`,
 * 卡片常驻红色「存在缺口」徽章,而用户在列表里找不到任何失败项。
 * 凡是回答「本轮怎么样」的统计,都必须先过这道过滤。
 */
export function isCurrentRoundCase(item: Pick<ScriptManifestCase, 'status'>): boolean {
  return item.status !== 'stale';
}

/**
 * The AI-repair loop may act on this case: it carries a recorded run failure.
 * A 'failed' case (static/collect failure at generation — no lastRunError, no
 * on-disk script) is deliberately NOT fixable; its only recovery is 「重试缺口」
 * (re-generation). This is precisely why a loadable-but-replay-failed script must
 * be published as needs_review WITH lastRunError (see validateAndPublish), never
 * dead-ended as 'failed' — otherwise it is neither runnable nor fixable and stuck.
 */
export function isFixableCase(item: Pick<ScriptManifestCase, 'lastRunError'>): boolean {
  return !!item.lastRunError;
}

/**
 * Given freshly generated content and an injectable repair function, decide what
 * to publish. When the content fails static validation we feed the *exact*
 * validator errors back to the model once and re-validate — mirroring the
 * runtime-repair closed loop, which the generation path previously lacked.
 *
 * Before this, a single non-conforming output (multiple `test()`, a title without
 * the case ID, a stray import) dead-ended at `failed` with no recourse; the UI's
 * 「重试缺口」 just re-rolled the same prompt/model and usually failed the same way
 * (observed 2026-07-11: gateway model produced 2 `test()` blocks with step-titles
 * → 「每个脚本必须恰好一个 test(); test 标题必须包含用例 ID」 → 0/1, permanently 存在缺口).
 *
 * The repair fn is INJECTED so this decision logic is unit-testable without the
 * SDK. It resolves to the repaired source, or null when repair is impossible;
 * it may REJECT (e.g. the job was superseded / aborted) — that propagates.
 */
export async function resolveStaticValidContent(params: {
  content: string;
  scriptCaseId: string;
  repair: (errors: string[]) => Promise<string | null>;
}): Promise<{ content: string; check: StaticScriptValidation; repaired: boolean }> {
  const first = validateScriptSource(params.content, params.scriptCaseId);
  if (first.ok) return { content: params.content, check: first, repaired: false };
  const repaired = await params.repair(first.errors);
  if (repaired && repaired.trim()) {
    const recheck = validateScriptSource(repaired, params.scriptCaseId);
    // Only accept the repair if it actually clears static validation; otherwise
    // keep the original content so the manifest records the true first errors.
    if (recheck.ok) return { content: repaired, check: recheck, repaired: true };
  }
  return { content: params.content, check: first, repaired: false };
}

/**
 * Static-validation repair via the SDK — reuses the runtime-repair batch entry
 * (its prompt already restates every generation constraint). The failure text is
 * framed as a structural/写法 problem so the red-line ("页面行为≠预期时不得弱化断言")
 * never misfires: a static failure is never a behavior mismatch.
 */
async function staticRepairViaSdk(params: {
  request: ScriptJobRequest;
  candidate: EligibleScriptCase;
  content: string;
  errors: string[];
  redactions: TraceRedaction[];
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const failure = `脚本未通过静态校验（尚未运行——属于结构/写法问题，不是页面实际行为与用例预期不符）。请逐条修正以下校验错误后重新输出完整脚本：\n- ${params.errors.join('\n- ')}`;
  try {
    const outcomes = await repairScriptsBatch({
      inputs: [{ candidate: params.candidate, currentContent: params.content, failure }],
      model: params.request.model,
      providerId: params.request.providerId,
      redactions: params.redactions,
      abortSignal: params.abortSignal,
    });
    const fixed = outcomes.find((o) => o.caseId === params.candidate.id && o.fixed && o.content);
    return fixed?.content ?? null;
  } catch (err) {
    // Job superseded / aborted → let it bubble so the outer loop stops cleanly.
    if (params.abortSignal?.aborted) throw err;
    // Repair call itself failed (timeout / gateway drop) → give up on repair for
    // this case, fall back to the original static errors. Don't sink the batch.
    return null;
  }
}

async function validateAndPublish(params: {
  request: ScriptJobRequest;
  candidate: EligibleScriptCase;
  generated: GeneratedScript;
  previous?: ScriptManifestCase;
  redactions: TraceRedaction[];
  abortSignal?: AbortSignal;
  /**
   * 跳过生成期真机重放(逐条增量生成用)。此时【执行智能体正在操作被测系统】,重放会和它
   * 并发抢同一份数据/页面。脚本照常过静态 + Playwright 加载校验后落盘标 needs_review,
   * 重放延后到执行收口后由既有自动流水线(runAndRepairLoop 本就跑 verified|needs_review
   * 全集)统一补跑 —— 零新增机制。
   */
  deferReplay?: boolean;
}): Promise<ScriptManifestCase> {
  const { request, candidate, generated, previous, redactions, abortSignal, deferReplay } = params;
  const now = new Date().toISOString();
  const finalFile = candidateFinalFile(request, candidate);
  const source = candidateSource(candidate);
  const { content, check: staticCheck } = await resolveStaticValidContent({
    content: generated.content,
    scriptCaseId: candidate.scriptCaseId,
    repair: (errors) => staticRepairViaSdk({ request, candidate, content: generated.content, errors, redactions, abortSignal }),
  });
  const failed = (error: string, warnings: string[] = []): ScriptManifestCase => ({
    caseId: candidate.id,
    file: candidate.fileName,
    ...source,
    fingerprint: candidate.fingerprint,
    caseBodyHash: candidate.caseBodyHash,
    status: previous && fs.existsSync(finalFile) ? 'outdated' : 'failed',
    usesMock: candidate.usesMock,
    lastSeenRunHash: request.runHash,
    ...(previous?.generatedAt ? { generatedAt: previous.generatedAt } : {}),
    validation: { syntax: false, collected: false, replayed: false, warnings, error },
    error,
  });
  if (!staticCheck.ok) return failed(staticCheck.errors.join('; '), staticCheck.warnings);

  fs.mkdirSync(path.dirname(finalFile), { recursive: true });
  const temp = candidateTempFile(finalFile);
  fs.writeFileSync(temp, content, 'utf-8');
  try {
    const resolved = resolveProjectEnvWithDb(request.projectPath, request.env);
    const runnerBase = {
      scriptFile: temp,
      baseUrl: resolved.frontendBaseUrl,
      storageStatePath: resolved.storageStatePath,
      username: resolved.loginAccount?.username,
      password: resolved.loginAccount?.password,
      redactions,
    };
    const collected = await runGeneratedScript({ ...runnerBase, collectOnly: true, timeoutMs: 30_000 });
    // summarizeRunFailure 抓真正的失败诊断行（Error/Locator/Expected/Received），
    // 不再 slice(-1000) 取输出末尾——那截到的是代码框/trace 附件路径，看不到"为什么挂"。
    if (!collected.ok) return failed(`Playwright 加载校验失败: ${summarizeRunFailure(collected.output, collected.timedOut)}`, staticCheck.warnings);

    const safeReplay = !deferReplay && isSafeForAutomaticReplay(candidate.testCase);
    let replayed = false;
    let replayError = '';
    if (safeReplay) {
      const replay = await runGeneratedScript({ ...runnerBase, collectOnly: false, timeoutMs: 120_000 });
      replayed = replay.ok;
      if (!replay.ok) replayError = `Playwright 自动重放失败: ${summarizeRunFailure(replay.output, replay.timedOut)}`;
    }
    // 生成期自动重放失败【不再】dead-end 成 status:'failed'。'failed' 是死态：
    // 它不带 lastRunError，而运行(runScriptCases 只跑 verified|needs_review)、AI 修复
    // (repairScriptCases 跳过无 lastRunError 的)、自动流水线(fixable 要求 lastRunError)
    // 全都不碰它，孤零零一个 failed 连流水线都不触发 —— 只读用例遇到被测应用没启动，
    // 就永久卡 0/1 存在缺口，唯一出路是「重试缺口」重新生成、再撞同一堵墙。
    // 脚本既已通过静态 + Playwright 加载(collect)校验，就落盘、标 needs_review 并把
    // replayError 记进 lastRunError，交给既有闭环(运行→失败自动修 / isEnvironmentFailure
    // 停靠 / 手动 AI 修复)在被测应用起来后收口。写操作用例本就跳过重放、同样 needs_review。
    // 注意：collect 失败仍保留 failed —— 连加载都过不了的脚本是 malformed，该重新生成而非留存。
    const replayFailed = safeReplay && !replayed;
    fs.renameSync(temp, finalFile);
    const needsReview = replayFailed || staticCheck.needsReview || candidate.usesMock || !safeReplay || candidate.sourceMissing;
    return {
      caseId: candidate.id,
      file: candidate.fileName,
      ...source,
      fingerprint: candidate.fingerprint,
      caseBodyHash: candidate.caseBodyHash,
      status: needsReview ? 'needs_review' : 'verified',
      usesMock: candidate.usesMock,
      generatedAt: now,
      ...(replayed ? { lastVerifiedAt: now } : {}),
      ...(replayFailed ? { lastRunError: replayError, lastRunAt: now } : {}),
      lastSeenRunHash: request.runHash,
      validation: {
        syntax: true,
        collected: true,
        replayed,
        warnings: [
          ...staticCheck.warnings,
          ...(candidate.usesMock ? ['执行时使用了接口模拟（browser_route mock），需人工确认真实环境可通过'] : []),
          ...(deferReplay ? ['执行过程中即时生成，重放延后至执行结束由「自动跑通」统一验证'] : []),
          ...(!deferReplay && !safeReplay ? ['已跳过自动重放：用例含写操作且未声明 cleanup 清理方式，请人工运行确认（或给用例补 cleanup 字段）'] : []),
          ...(replayFailed ? ['生成期自动重放未通过，脚本已保存待复核：可能被测应用未启动，或脚本需 AI 修复 —— 已进入运行/修复闭环，可点「运行」或「AI 修复」，或在被测应用启动后重跑'] : []),
          ...(candidate.sourceMissing ? ['回归用例库来源映射缺失，脚本暂存于聚合任务目录'] : []),
        ],
      },
    };
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* ignore */ }
  }
}

// 生成期【瞬时】错误：网络/鉴权抖动导致（企业代理超时、连接中途掐断、平台后台刷 token
// 窗口内网关回绝那次调用的伪「未登录」、常见网络/网关码）——退避重发大概率自愈。
// 刻意不含校验不过/断言不符/AI 未返回这类【确定性】失败——重试它们无意义、只是空耗。
export function isTransientGenerationError(message: string): boolean {
  return /(timed out|Connection closed|Not logged in|Please run \/login|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network error|\b(?:429|500|502|503|504)\b)/i.test(message);
}

// 可被 abort 打断的等待：新任务取代时立即退出，不空等完退避。
function abortableDelay(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal.aborted) { reject(new Error('aborted')); return; }
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  });
}

async function generateMissing(
  request: ScriptJobRequest,
  candidates: EligibleScriptCase[],
  previousById: Map<string, ScriptManifestCase>,
  redactions: TraceRedaction[],
  abortSignal: AbortSignal,
  deferReplay = false,
): Promise<Map<string, ScriptManifestCase>> {
  const result = new Map<string, ScriptManifestCase>();
  const failedEntry = (candidate: EligibleScriptCase, error: string): ScriptManifestCase => ({
    caseId: candidate.id,
    file: candidate.fileName,
    ...candidateSource(candidate),
    fingerprint: candidate.fingerprint,
    caseBodyHash: candidate.caseBodyHash,
    // 已有旧脚本 → outdated（保留旧版可用）；否则 failed。
    status: previousById.has(candidate.id) && fs.existsSync(candidateFinalFile(request, candidate)) ? 'outdated' : 'failed',
    usesMock: candidate.usesMock,
    lastSeenRunHash: request.runHash,
    error,
    validation: { syntax: false, collected: false, replayed: false, warnings: [], error },
  });

  // 逐条生成：每条一次独立 SDK 调用、独立超时、独立失败。此前是【批量】(一次塞 5 条、
  // 要求模型一口气输出全部脚本)——只要整批超过 180s 就全部丢失、整个任务 jobStatus:error，
  // 哪怕其中几条单独生成毫无问题（用户实测：满批 3 条 180s 超时，3 条脚本连同任务一起挂）。
  // 逐条后：一条超时/失败只记为该条 failed，其余照常生成落盘；单条 prompt 更小、返回更快、
  // 超时概率更低。代价是 N 次子进程调用而非 ceil(N/5)，但脚本生成是后台任务，稳健优先。
  // 单条遇瞬时错误时退避重发（首次 + 最多 2 次）：给企业代理/平台刷 token 缓过来的时间。
  // 退避后再撞硬性/确定性错误则立即放弃，不空耗。
  const RETRY_BACKOFFS_MS = [4_000, 10_000];

  /** 单条的模型调用（含瞬时错误退避重发）。不碰被测系统，故可并发。 */
  const generateOne = async (candidate: EligibleScriptCase): Promise<GeneratedScript | { error: string }> => {
    let lastError = '生成失败';
    for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
      if (abortSignal.aborted) throw new Error('脚本生成已中止（被更新的任务取代）');
      try {
        const generated = await generateScriptsBatch({
          candidates: [candidate],
          model: request.model,
          providerId: request.providerId,
          redactions,
          abortSignal,
        });
        const item = generated.find((g) => g.caseId === candidate.id);
        return item ?? { error: 'AI 未返回该用例的脚本' };
      } catch (error) {
        if (abortSignal.aborted) throw error;  // 被新任务取代 → 冒泡让 executeJob 走 stale 分支
        lastError = redactTraceText(error instanceof Error ? error.message : String(error), redactions);
        // 非瞬时错误、或已到重试上限 → 不再重试。
        if (attempt >= RETRY_BACKOFFS_MS.length || !isTransientGenerationError(lastError)) break;
        console.log(`[script-gen] ${candidate.scriptCaseId} 瞬时错误，${RETRY_BACKOFFS_MS[attempt] / 1000}s 后重试(${attempt + 1}/${RETRY_BACKOFFS_MS.length}): ${lastError.slice(0, 80)}`);
        try { await abortableDelay(RETRY_BACKOFFS_MS[attempt], abortSignal); }
        catch { throw new Error('脚本生成已中止（被更新的任务取代）'); }
      }
    }
    return { error: lastError.slice(0, 300) };
  };

  // ── 两阶段：模型调用【并发】，落盘校验【串行】────────────────────────────────
  // 瓶颈是【等模型返回】(跨境链路 latency-bound，实测单条 ~120s 里大头在此)，这类等待型
  // 工作只有并发能成倍改善：3 条并发等 70s ≈ 1 条等 70s。
  //
  // 但**校验/重放必须串行**：validateAndPublish 会起 Playwright 真跑被测应用，多个浏览器
  // 并发操作同一个 SUT 会互相踩数据（真机已见测试库里堆出 5 条同名「前端开发」）。
  // 故拆开：阶段 A 并发拿脚本文本(纯 API，不碰 SUT)，阶段 B 顺序校验落盘。
  const inFlight = new Map<string, Promise<GeneratedScript | { error: string }>>();
  let cursor = 0;
  const pump = () => {
    while (inFlight.size < GENERATION_CONCURRENCY && cursor < candidates.length) {
      const candidate = candidates[cursor++];
      inFlight.set(candidate.id, generateOne(candidate));
    }
  };
  pump();

  for (const candidate of candidates) {
    if (abortSignal.aborted) throw new Error('脚本生成已中止（被更新的任务取代）');
    const pending = inFlight.get(candidate.id);
    // 阶段 A 的产物按候选顺序消费：先到的先算好放着，轮到谁就取谁，保持结果顺序确定。
    const outcome = pending ? await pending : await generateOne(candidate);
    inFlight.delete(candidate.id);
    pump();   // 腾出一个槽位就补下一条，保持并发度

    if ('error' in outcome) {
      result.set(candidate.id, failedEntry(candidate, outcome.error));
      continue;
    }
    result.set(candidate.id, await validateAndPublish({
      request,
      candidate,
      generated: outcome,
      previous: previousById.get(candidate.id),
      redactions,
      abortSignal,
      deferReplay,
    }));
  }
  return result;
}

async function executeJob(entry: FullQueueEntry): Promise<void> {
  const request: ScriptJobRequest = entry;
  const scope = scopeKey(request);
  const abortController = new AbortController();
  let lock: ReturnType<typeof acquireLock> | null = null;
  try {
    lock = acquireLock(request);
    abortByScope.get(scope)?.abort();
    abortByScope.set(scope, abortController);
    let manifest = markManifest(request, { jobStatus: 'running', error: undefined });
    const inputs = currentInputs(request);
    const selection = selectEligibleCases(
      inputs.casesRaw, inputs.run, inputs.traceActions, manifest.runtimeVersion, inputs.traceElements,
    );
    if (selection.errors.length) throw new Error(selection.errors.join('; '));
    if (selection.blockedReason === 'circuit_broken') throw new Error('执行阶段熔断已触发，跳过脚本生成');
    const eligible = request.taskName === REGRESSION_LIBRARY_TASK
      ? retargetLibraryCandidates(
          selection.eligible,
          regressionLibraryIdMap(request.projectPath),
          manifest.runtimeVersion,
        )
      : selection.eligible;

    const previousById = new Map(manifest.cases.map((item) => [item.caseId, item]));
    const eligibleIds = new Set(eligible.map((candidate) => candidate.id));
    const force = request.forceCaseIds?.length ? new Set(request.forceCaseIds) : null;
    const nextCases: ScriptManifestCase[] = [];
    const pending: EligibleScriptCase[] = [];
    for (const candidate of eligible) {
      const previous = previousById.get(candidate.id);
      // 回归轮次「脚本重放」判定的 pass(run.json via:'script'):判定本就来自已沉淀脚本,
      // 本轮没有 MCP 工具轨迹(trace 为空 → 语义指纹必然漂移)。跳过重生成——否则每轮回归
      // 都会拿空轨迹churn一遍脚本。有旧条目原样保留(回填 caseBodyHash);无旧条目(聚合
      // manifest 首次见到该 runId)也不生成,脚本的权威元数据在来源任务 manifest 里。
      if (candidate.result.via === 'script') {
        if (previous) nextCases.push({ ...previous, caseBodyHash: candidate.caseBodyHash, lastSeenRunHash: request.runHash });
        continue;
      }
      const finalFile = candidateFinalFile(request, candidate);
      const reusable = !force?.has(candidate.id)
        && previous?.fingerprint === candidate.fingerprint
        && (previous.status === 'verified' || previous.status === 'needs_review')
        && fs.existsSync(finalFile);
      if (reusable) {
        // 顺手补写 caseBodyHash:语义指纹相同 ⇒ 用例体相同,给存量条目回填、让回归重放的防错配尽快生效。
        nextCases.push({ ...previous, caseBodyHash: candidate.caseBodyHash, lastSeenRunHash: request.runHash });
      } else if (!force || force.has(candidate.id)) {
        pending.push(candidate);
      } else if (previous) {
        nextCases.push(previous);
      }
    }
    // 「本轮没轮到」≠「本轮失去资格」。执行中断/AI 漏跑的用例会被 reduce 按 cases 全集兜底
    // 补成 blocked+notExecuted —— 它们没有失去回归资格,只是这轮没跑到。若一并标 stale,
    // 一次断流轮就会把几十条 verified 脚本打出运行/修复/重放的全部通道(stale 不是
    // isRunnableStatus)。故这类用例的旧条目原样保留,等下一轮完整执行再对账。
    const notExecutedIds = new Set(
      (inputs.run.tests ?? []).filter((t) => t.notExecuted).map((t) => t.id),
    );
    for (const previous of manifest.cases) {
      if (eligibleIds.has(previous.caseId)) continue;
      if (notExecutedIds.has(previous.caseId)) { nextCases.push(previous); continue; }
      nextCases.push({ ...previous, status: 'stale', lastSeenRunHash: request.runHash });
    }

    const generated = await generateMissing(request, pending, previousById, safeRedactionsFor(request), abortController.signal);
    for (const candidate of pending) {
      const item = generated.get(candidate.id);
      if (item) nextCases.push(item);
    }
    // Newest run wins: re-read current manifest before publishing terminal state.
    const latest = readManifest(request.projectPath, request.taskName, request.env);
    if (latest && latest.latestRunHash !== request.runHash) return;
    const terminal = manifestCounts(nextCases, eligible.length);
    const hasGap = terminal.failed > 0 || nextCases.some((item) => item.status === 'outdated');
    manifest = markManifest(request, {
      cases: nextCases.sort((a, b) => a.caseId.localeCompare(b.caseId)),
      counts: terminal,
      jobStatus: hasGap ? 'partial' : 'done',
      error: hasGap ? 'one or more eligible scripts could not be generated or validated' : undefined,
    });
    await appendAudit(request.projectPath, request.taskName, {
      action: 'generate-scripts',
      mode: 'auto',
      step: 'report',
      detail: `回归脚本后台生成:${manifest.counts.verified} 已验证、${manifest.counts.needsReview} 待复核、${manifest.counts.failed} 失败`,
    });

    // 自动流水线：生成后运行 + 失败自动修，直至全部（可修复的）通过。仅在被测应用可达时进行，
    // best-effort —— 流水线出问题不抹掉已生成的脚本，只把没跑成的留给用户手动触发。
    // 「有没有可跑的」也按本轮口径:全是退役脚本时不该白启动一次流水线(它会去探测被测应用、
    // 起 Playwright 运行器,最后无事可做)。
    if (request.runPipeline && manifest.cases.some((c) => isCurrentRoundCase(c) && isRunnableStatus(c.status))) {
      if (await isSutReachable(request)) {
        try {
          const summary = await runAndRepairLoop(request, manifest, request.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS);
          const finalCounts = manifestCounts(manifest.cases, manifest.counts.eligible);
          // 只看【本轮】用例:stale 条目的陈年 lastRunError 会把 6/6 全通过的任务误判成 partial
          // (卡片常驻「存在缺口」而列表里找不到失败项 —— 2026-07-21 真机复现)。
          const unpassed = manifest.cases.filter(isCurrentRoundCase).some((c) => c.lastRunError);
          // cases 必须随终态一起落盘：markManifest 从磁盘重读后仅覆盖 patch 字段，而
          // runAndRepairLoop 在最后一次 persistRunning 之后还会改写 repairNote（「AI 修改后
          // 仍未通过」的讲真话覆盖）——不带 cases 这次改写就被磁盘旧值静默吞掉（真机踩坑：
          // manifest 里模型乐观的修复说明与 lastRunError 并存，测试人员看到「说修好了却报错」）。
          manifest = markManifest(request, {
            cases: manifest.cases,
            counts: finalCounts,
            jobStatus: finalCounts.failed > 0 || unpassed ? 'partial' : 'done',
            error: unpassed ? '部分回归脚本自动跑通未成功（详见各用例）' : undefined,
          });
          await appendAudit(request.projectPath, request.taskName, {
            action: 'run-repair-pipeline', mode: 'auto', step: 'report',
            detail: `自动跑通:${summary.passed.length} 通过、${summary.needsHuman.length} 需人工、${summary.environmentBlocked.length} 环境阻塞、${summary.stillFailing.length} 未修复(${summary.rounds} 轮)`,
          });
        } catch (pipelineError) {
          const clean = redactTraceText(pipelineError instanceof Error ? pipelineError.message : String(pipelineError), safeRedactionsFor(request));
          // 流水线中途失败不能把 manifest 卡在 persistRunning 写下的 'running'：落终态，保留已生成脚本。
          // cases 一并落盘，理由同上（中断前循环内存里的最后状态不能被磁盘旧值吞掉）。
          const unpassed = manifest.cases.filter(isCurrentRoundCase).some((c) => c.lastRunError);
          manifest = markManifest(request, {
            cases: manifest.cases,
            counts: manifestCounts(manifest.cases, manifest.counts.eligible),
            jobStatus: (unpassed || manifest.counts.failed > 0) ? 'partial' : 'done',
            error: `自动跑通中断:${clean.slice(0, 300)}`,
          });
          await appendAudit(request.projectPath, request.taskName, {
            action: 'run-repair-pipeline', mode: 'auto', step: 'report', detail: `自动跑通中断:${clean.slice(0, 300)}`,
          });
        }
      } else {
        await appendAudit(request.projectPath, request.taskName, {
          action: 'run-repair-pipeline', mode: 'auto', step: 'report', detail: '自动跑通跳过:被测应用未就绪（frontendBaseUrl 不可达）',
        });
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const clean = redactTraceText(msg, safeRedactionsFor(request));
    const latest = readManifest(request.projectPath, request.taskName, request.env);
    if (!latest || latest.latestRunHash === request.runHash) {
      markManifest(request, { jobStatus: clean.includes('superseded') ? 'stale' : 'error', error: clean.slice(0, 2000) });
    }
    await appendAudit(request.projectPath, request.taskName, {
      action: 'generate-scripts', mode: 'auto', step: 'report', detail: `回归脚本后台生成失败:${clean.slice(0, 500)}`,
    });
  } finally {
    if (abortByScope.get(scope) === abortController) abortByScope.delete(scope);
    lock?.close();
  }
}

/**
 * 逐条增量生成(执行进行中,一条用例 pass 就生成它的脚本)。
 *
 * 为什么不复用 executeJob:后者以【整轮 run.json】为输入做资格 join、stale 对账、counts
 * 重算,而此刻 run.json 还不存在。这里只做一件事:把这一条用例的脚本生成出来、upsert 进
 * manifest.cases。
 *
 * 三条刻意的克制(每条都对应一个会咬人的坑):
 *   1. **不碰 latestRunHash / jobStatus**:它们描述的是【整轮生成任务】的身份与终态,增量
 *      不是那个任务。若把临时 hash 写进 latestRunHash,收口 job 的「newest run wins」判定
 *      会误判、报告触发的去重也会错乱;若把 jobStatus 置 running,断流轮没有收口 job 来
 *      settle,它会永远卡 running。
 *   2. **不进 abortByScope**:executeJob 靠它「新任务取代旧任务」。增量任务彼此是不同用例、
 *      必须各自跑完,注册进去会导致后一条把前一条掐死。
 *   3. **锁被占就跳过**:不排队等、不阻塞执行流。这条用例交给收口 job 生成即可。
 *
 * 与整轮任务的指纹必须严格一致(否则收口 job 会把刚生成的脚本判成漂移、重新烧一遍模型):
 * 故这里合成一份单条用例的 cases/run 输入,走【同一个】selectEligibleCases 构造候选。
 */
async function executeIncrementalJob(entry: IncrementalQueueEntry): Promise<void> {
  const { projectPath, taskName, env, caseBody, result, traceActions, observedElements } = entry;
  // 增量任务只做生成,不读 run.json —— 但 validateAndPublish / candidateFinalFile 等共用
  // 逻辑要一个 ScriptJobRequest 形状。runHash 仅用于条目的 lastSeenRunHash 标记。
  const request: ScriptJobRequest = {
    projectPath, taskName, env,
    runHash: `incr-${entry.runStartMs}`,
    roundId: entry.roundId,
    model: entry.model,
    providerId: entry.providerId,
  };
  let lock: ReturnType<typeof acquireLock> | null = null;
  try {
    try {
      lock = acquireLock(request);
    } catch {
      // 后台生成/手动运行/AI 修复正持锁 → 本条交给收口 job,不等不抢。
      return;
    }
    const manifest = readManifest(projectPath, taskName, env);
    const runtime = manifest?.runtimeVersion ?? runtimeVersion();

    // 走与整轮任务【同一条】构造通道 → 语义指纹逐字一致 → 收口 job 能命中复用。
    const selection = selectEligibleCases(
      [caseBody],
      { tests: [result] } as unknown as RunJson,
      traceActions,
      runtime,
      { [result.id]: observedElements },
    );
    const eligible = taskName === REGRESSION_LIBRARY_TASK
      ? retargetLibraryCandidates(selection.eligible, regressionLibraryIdMap(projectPath), runtime)
      : selection.eligible;
    const candidate = eligible[0];
    if (!candidate) return;   // 没打回归标签 / 非 pass —— 上游已过滤,这里兜底

    const previous = manifest?.cases.find((item) => item.caseId === candidate.id);
    // 指纹未变且旧脚本还在 → 本轮无需重生成(与整轮任务的复用口径一致)。
    if (previous?.fingerprint === candidate.fingerprint
      && isRunnableStatus(previous.status)
      && fs.existsSync(candidateFinalFile(request, candidate))) {
      return;
    }

    const generated = await generateMissing(
      request,
      [candidate],
      new Map(previous ? [[previous.caseId, previous]] : []),
      safeRedactionsFor(request),
      new AbortController().signal,
      true,   // deferReplay:执行智能体正在操作被测系统,重放延后到收口后的自动跑通
    );
    const item = generated.get(candidate.id);
    if (!item) return;

    // 重读 manifest 再 upsert:生成期间(可能数分钟)别的写入者可能动过它。
    const latest = readManifest(projectPath, taskName, env);
    const cases = latest?.cases ? [...latest.cases] : [];
    const at = cases.findIndex((c) => c.caseId === item.caseId);
    if (at >= 0) cases[at] = item; else cases.push(item);
    cases.sort((a, b) => a.caseId.localeCompare(b.caseId));
    markManifest(request, {
      cases,
      // eligible 计数归收口 job 管(它才知道整轮有多少条合格);这里只让已生成的条目如实计数。
      counts: manifestCounts(cases, Math.max(latest?.counts.eligible ?? 0, cases.length)),
    });
  } catch (error) {
    // 增量生成是执行流的旁路增强:失败只留日志,绝不影响执行本身,也不改 manifest 终态。
    console.warn(`[script-gen] 增量生成失败 ${entry.result.id}:`, error instanceof Error ? error.message : error);
  } finally {
    lock?.close();
  }
}

/**
 * 执行流中一条用例 pass 即入队生成它的脚本(不等报告)。
 *
 * 治的是「断流全丢」:生成原本由【报告成功】门控,执行被网络掐断(本环境跨境链路间歇丢包,
 * 真机两次断在 82/93、29/93)→ 报告不跑 → 已通过用例的脚本一条都不沉淀,整轮 token 白烧。
 *
 * fire-and-forget:调用方不 await,失败只记日志。
 */
export function enqueueIncrementalScriptCase(request: IncrementalScriptCaseRequest): void {
  const key = `incr\0${path.resolve(request.projectPath)}\0${request.taskName}\0${request.env}\0${request.result.id}\0${request.runStartMs}`;
  if (queuedKeys.has(key) || activeKeys.has(key)) return;
  queue.push({ ...request, kind: 'incremental', key });
  queuedKeys.add(key);
  drain();
}

function drain(): void {
  if (running) return;
  const entry = queue.shift();
  if (!entry) return;
  running = true;
  queuedKeys.delete(entry.key);
  activeKeys.add(entry.key);
  const job = entry.kind === 'incremental' ? executeIncrementalJob(entry) : executeJob(entry);
  void job.finally(() => {
    activeKeys.delete(entry.key);
    running = false;
    drain();
  });
}

export async function enqueueScriptJob(request: ScriptJobRequest): Promise<EnqueueResult> {
  const key = jobKey(request.projectPath, request.taskName, request.env, request.runHash);
  const current = readManifest(request.projectPath, request.taskName, request.env);
  if (!request.forceCaseIds?.length && !request.forceRefresh && current?.latestRunHash === request.runHash
    && (current.jobStatus === 'queued' || current.jobStatus === 'running' || current.jobStatus === 'done' || current.jobStatus === 'partial')) {
    if ((current.jobStatus === 'queued' || current.jobStatus === 'running') && !queuedKeys.has(key) && !activeKeys.has(key)) {
      queue.push({ ...request, kind: 'full', key });
      queuedKeys.add(key);
      drain();
    }
    return { queued: current.jobStatus === 'queued' || current.jobStatus === 'running', reused: true, jobKey: key };
  }

  const scope = scopeKey(request);
  abortByScope.get(scope)?.abort();
  const manifest = newManifest(request, key, current);
  writeManifest(request.projectPath, request.taskName, request.env, manifest);
  if (!queuedKeys.has(key)) {
    queue.push({ ...request, kind: 'full', key });
    queuedKeys.add(key);
    drain();
  }
  await appendAudit(request.projectPath, request.taskName, {
    action: 'generate-scripts', mode: request.forceCaseIds?.length ? 'manual' : 'auto', step: 'report', detail: `回归脚本任务已排队:${key.slice(0, 12)}`,
  });
  return { queued: true, reused: false, jobKey: key };
}

/** GET route calls this to recover a durable queued/stale-running manifest after refresh/restart. */
export function recoverScriptJob(request: Omit<ScriptJobRequest, 'runHash'>): void {
  const manifest = readManifest(request.projectPath, request.taskName, request.env);
  if (!manifest) return;
  const age = Date.now() - Date.parse(manifest.updatedAt || manifest.createdAt);
  if (manifest.jobStatus === 'queued' || (manifest.jobStatus === 'running' && age > 30 * 60_000)) {
    void enqueueScriptJob({ ...request, runHash: manifest.latestRunHash });
  }
}

// ── AI 修复：运行失败的脚本 → 失败原因喂回模型定向修 → 重新校验/重放 ──────────
// 测试人员不写代码，「重试」只是盲目重新生成（不读失败原因）、「运行」只是原样重放。
// 这里是唯一消费 lastRunError 的闭环。红线在 repairScriptsBatch 的 prompt 里：
// 只修技术缺陷，断言如实失败（页面行为 ≠ 用例预期）时拒绝修改并说明原因。

export interface RepairRequest {
  projectPath: string;
  taskName: string;
  env: string;
  /** Limit to these cases; default = every case with a lastRunError. */
  caseIds?: string[];
  model?: string;
  providerId?: string;
}

export interface RepairResultItem {
  caseId: string;
  fixed: boolean;
  /** 给测试人员看的一句话：修了什么 / 为什么没修。 */
  reason: string;
  status: ScriptManifestCase['status'];
}

export async function repairFailedScripts(request: RepairRequest): Promise<{
  results: RepairResultItem[];
  manifest: ScriptManifest;
}> {
  const manifest = readManifest(request.projectPath, request.taskName, request.env);
  if (!manifest) throw new Error('尚未生成脚本清单（manifest）');
  const jobRequest: ScriptJobRequest = {
    projectPath: request.projectPath,
    taskName: request.taskName,
    env: request.env,
    runHash: manifest.latestRunHash,
    model: request.model,
    providerId: request.providerId,
  };
  // Same lock as generation so a repair can't race a queued/running job.
  const lock = acquireLock(jobRequest);
  try {
    const results = await repairScriptCases(jobRequest, manifest, request.caseIds);
    if (!results.length) throw new Error('没有需要修复的运行失败脚本');
    manifest.counts = manifestCounts(manifest.cases, manifest.counts.eligible);
    manifest.jobStatus = manifest.counts.failed > 0 ? 'partial' : 'done';
    writeManifest(request.projectPath, request.taskName, request.env, manifest);
    await appendAudit(request.projectPath, request.taskName, {
      action: 'repair-scripts', mode: 'manual', step: 'report',
      detail: `AI 修复回归脚本:${results.filter((r) => r.fixed).length}/${results.length} 修复成功`,
    });
    return { results, manifest };
  } finally {
    lock.close();
  }
}

/** 手动「运行」入口（自持锁，与生成/修复互斥）。UI 的运行全部/运行所选走这里。 */
/**
 * 人工确认 mock 脚本通过 —— 「需人工确认」这句话的落点。
 *
 * 只对 `usesMock && needs_review` 的条目生效：非 mock 的待复核脚本各有其技术原因
 * （重放失败、静态告警），有 运行/AI 修复 两条既有通道，不该被一键"确认"绕过。
 *
 * 刻意保留 `usesMock` 与那条 mock 警告：确认的是「我看过、认可它」，不是「它没用过 mock」。
 * 回归重放的资格判定同样继续排除 mock 脚本，此处不放开自动重放。
 */
export async function confirmMockScripts(request: {
  projectPath: string;
  taskName: string;
  env: string;
  caseIds: string[];
}): Promise<{ confirmed: string[]; skipped: Array<{ caseId: string; reason: string }>; manifest: ScriptManifest }> {
  const manifest = readManifest(request.projectPath, request.taskName, request.env);
  if (!manifest) throw new Error('尚未生成脚本清单（manifest）');
  const wanted = new Set(request.caseIds);
  const lock = acquireLock({
    projectPath: request.projectPath, taskName: request.taskName, env: request.env,
    runHash: manifest.latestRunHash,
  });
  try {
    const now = new Date().toISOString();
    const confirmed: string[] = [];
    const skipped: Array<{ caseId: string; reason: string }> = [];
    for (const item of manifest.cases) {
      if (!wanted.has(item.caseId)) continue;
      if (item.status !== 'needs_review') { skipped.push({ caseId: item.caseId, reason: `状态为 ${item.status}，无需确认` }); continue; }
      if (!item.usesMock) { skipped.push({ caseId: item.caseId, reason: '非接口模拟脚本，请走「运行」或「AI 修复」' }); continue; }
      if (item.lastRunError) { skipped.push({ caseId: item.caseId, reason: '存在运行失败记录，请先修复再确认' }); continue; }
      item.status = 'verified';
      item.manualVerifiedAt = now;
      item.lastVerifiedAt = now;
      confirmed.push(item.caseId);
    }
    if (!confirmed.length && skipped.length) throw new Error(skipped[0].reason);
    if (!confirmed.length) throw new Error('没有可确认的脚本');
    manifest.counts = manifestCounts(manifest.cases, manifest.counts.eligible);
    // 终态按本轮口径重算（与 5b54341 的收口一致：退役条目的陈年失败不参与判定）。
    const unpassed = manifest.cases.filter(isCurrentRoundCase).some((c) => c.lastRunError);
    manifest.jobStatus = (manifest.counts.failed > 0 || unpassed) ? 'partial' : 'done';
    if (manifest.jobStatus === 'done') manifest.error = undefined;
    writeManifest(request.projectPath, request.taskName, request.env, manifest);
    await appendAudit(request.projectPath, request.taskName, {
      action: 'confirm-mock-scripts', mode: 'manual', step: 'report',
      detail: `人工确认接口模拟脚本通过:${confirmed.join('、')}`,
    });
    return { confirmed, skipped, manifest };
  } finally {
    lock.close();
  }
}

export async function runScripts(request: RepairRequest): Promise<{
  results: Array<{ caseId: string; ok: boolean; output: string; timedOut: boolean }>;
  manifest: ScriptManifest;
}> {
  const manifest = readManifest(request.projectPath, request.taskName, request.env);
  if (!manifest) throw new Error('尚未生成脚本清单（manifest）');
  const jobRequest: ScriptJobRequest = {
    projectPath: request.projectPath, taskName: request.taskName, env: request.env,
    runHash: manifest.latestRunHash, model: request.model, providerId: request.providerId,
  };
  const lock = acquireLock(jobRequest);
  try {
    const results = await runScriptCases(jobRequest, manifest, request.caseIds);
    if (!results.length) throw new Error('没有可运行的脚本');
    manifest.counts = manifestCounts(manifest.cases, manifest.counts.eligible);
    manifest.jobStatus = manifest.counts.failed > 0 ? 'partial' : 'done';
    writeManifest(request.projectPath, request.taskName, request.env, manifest);
    await appendAudit(request.projectPath, request.taskName, {
      action: 'run-scripts', mode: 'manual', step: 'report',
      detail: `运行回归脚本:${results.filter((r) => r.ok).length}/${results.length} 通过`,
    });
    return { results, manifest };
  } finally {
    lock.close();
  }
}

// ── Lock-free 核心：由手动路由（自持锁）与自动流水线（在 executeJob 锁内）共用 ──

/** 运行一批脚本对真实被测应用回放，就地改 manifest.cases（verified / lastRunError），返回结果。不加锁、不写盘、不改 counts —— 由调用方收口。 */
async function runScriptCases(
  jobRequest: ScriptJobRequest,
  manifest: ScriptManifest,
  caseIds?: string[] | null,
): Promise<Array<{ caseId: string; ok: boolean; output: string; timedOut: boolean }>> {
  const requested = caseIds?.length ? new Set(caseIds) : null;
  // 未显式点名时只跑【本轮】用例 —— 否则「运行全部/自动跑通」会把已退役(stale)的历史脚本
  // 也拉去跑,既慢又可能拿旧脚本的失败污染本轮终态。用户在弹框里显式点某条 stale 脚本时
  // (requested 命中)仍然放行,那是明确的人为意图。
  const runnable = manifest.cases.filter((item) =>
    isRunnableStatus(item.status)
    && (requested ? requested.has(item.caseId) : isCurrentRoundCase(item)));
  const resolved = resolveProjectEnvWithDb(jobRequest.projectPath, jobRequest.env);
  const results: Array<{ caseId: string; ok: boolean; output: string; timedOut: boolean }> = [];
  for (const item of runnable) {
    const now = new Date().toISOString();
    const fail = (reason: string) => {
      item.lastRunError = reason; item.lastRunAt = now;
      results.push({ caseId: item.caseId, ok: false, output: reason, timedOut: false });
    };
    const ownerTask = item.sourceTask ?? jobRequest.taskName;
    if (isUnsafeSegment(ownerTask)) { fail('脚本归属任务名非法'); continue; }
    const root = scriptsDir(jobRequest.projectPath, ownerTask, jobRequest.env);
    const file = path.resolve(root, item.file);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file)) { fail('脚本文件不存在，请先重试生成'); continue; }
    const result = await runGeneratedScript({
      scriptFile: file,
      baseUrl: resolved.frontendBaseUrl,
      storageStatePath: resolved.storageStatePath,
      username: resolved.loginAccount?.username,
      password: resolved.loginAccount?.password,
      collectOnly: false,
      timeoutMs: 120_000,
    });
    results.push({ caseId: item.caseId, ok: result.ok, output: result.output.slice(-4000), timedOut: result.timedOut });
    item.lastRunAt = now;
    if (!result.ok) {
      // 运行失败不降级 status（脚本可能没问题、只是被测应用没起），只记录原因。
      item.lastRunError = summarizeRunFailure(result.output, result.timedOut);
      continue;
    }
    item.lastRunError = undefined;
    // `outdated` 跑通【不提升】为 verified:它的 manifest 记的是【新】指纹,盘上却是【旧】
    // 脚本内容(重新生成失败所致)。若提升,下轮的复用判定会看到「指纹匹配 + 已验证」而直接
    // 复用旧脚本,等于悄悄用过时脚本冒充当前用例的验证 —— 用例可能已经改过。
    // 它跑通只说明「旧脚本目前还能跑」,是诊断与止血,不是「当前版本已验证」。诚实的出路
    // 仍是把重新生成跑成功(卡片也据此继续显示存在缺口)。
    if (!item.usesMock && item.status !== 'outdated') {
      item.status = 'verified';
      item.lastVerifiedAt = now;
      item.validation = { ...(item.validation ?? { syntax: true, collected: true, replayed: false, warnings: [] }), replayed: true, error: undefined };
      item.error = undefined;
    }
  }
  return results;
}

/** 修复一批带 lastRunError 的脚本，就地改 manifest.cases，返回逐条结果。不加锁、不写盘。 */
async function repairScriptCases(
  jobRequest: ScriptJobRequest,
  manifest: ScriptManifest,
  caseIds?: string[] | null,
): Promise<RepairResultItem[]> {
  // currentInputs re-hashes run.json — repairs only ever apply to the latest run.
  const inputs = currentInputs(jobRequest);
  // 带上 observedElements：AI 修复「element(s) not found」时要靠它把臆造的 CSS class 换成
  // 真实存在的 role/name（见 repairScriptsBatch 的 system prompt）。
  const selection = selectEligibleCases(
    inputs.casesRaw, inputs.run, inputs.traceActions, manifest.runtimeVersion, inputs.traceElements,
  );
  const eligible = jobRequest.taskName === REGRESSION_LIBRARY_TASK
    ? retargetLibraryCandidates(selection.eligible, regressionLibraryIdMap(jobRequest.projectPath), manifest.runtimeVersion)
    : selection.eligible;
  const candidateById = new Map(eligible.map((candidate) => [candidate.id, candidate]));

  const requested = caseIds?.length ? new Set(caseIds) : null;
  const repairInputs: RepairScriptInput[] = [];
  const skipped: RepairResultItem[] = [];
  for (const item of manifest.cases) {
    if (!item.lastRunError) continue;
    if (requested && !requested.has(item.caseId)) continue;
    const candidate = candidateById.get(item.caseId);
    const file = candidate ? candidateFinalFile(jobRequest, candidate) : null;
    if (!candidate || !file || !fs.existsSync(file)) {
      // 生成期就失败的用例没有落盘脚本，修复无从谈起 —— 那是「重试缺口」(重新生成)的职责。
      skipped.push({ caseId: item.caseId, fixed: false, reason: '脚本文件不存在或用例已不在本轮合格集内，请用「重试缺口」重新生成', status: item.status });
      continue;
    }
    repairInputs.push({ candidate, currentContent: fs.readFileSync(file, 'utf-8'), failure: item.lastRunError });
  }

  const redactions = safeRedactionsFor(jobRequest);
  const outcomes = repairInputs.length
    ? await repairScriptsBatch({ inputs: repairInputs, model: jobRequest.model, providerId: jobRequest.providerId, redactions })
    : [];
  const outcomeById = new Map(outcomes.map((outcome) => [outcome.caseId, outcome]));

  const results: RepairResultItem[] = [...skipped];
  const itemById = new Map(manifest.cases.map((item) => [item.caseId, item]));
  for (const input of repairInputs) {
    const item = itemById.get(input.candidate.id)!;
    const outcome = outcomeById.get(input.candidate.id);
    if (!outcome) {
      item.repairNote = 'AI 修复未返回该用例的结果，请重试';
      results.push({ caseId: item.caseId, fixed: false, reason: item.repairNote, status: item.status });
      continue;
    }
    if (!outcome.fixed || !outcome.content) {
      // 模型判定不是脚本缺陷（或无法修）：保留原脚本与失败记录，把解释持久化给测试人员。
      item.repairNote = outcome.reason;
      results.push({ caseId: item.caseId, fixed: false, reason: outcome.reason, status: item.status });
      continue;
    }
    // 修复稿走与生成完全相同的发布管线（静态校验 → collect → 安全时真实重放），全过才原子覆盖。
    const published = await validateAndPublish({
      request: jobRequest,
      candidate: input.candidate,
      generated: { caseId: input.candidate.id, fileName: input.candidate.fileName, content: outcome.content },
      previous: item,
      redactions,
    });
    if (published.status === 'verified' || published.status === 'needs_review') {
      const next: ScriptManifestCase = { ...published, repairNote: outcome.reason };
      manifest.cases = manifest.cases.map((existing) => (existing.caseId === item.caseId ? next : existing));
      itemById.set(item.caseId, next);
      results.push({ caseId: item.caseId, fixed: true, reason: outcome.reason, status: next.status });
    } else {
      item.repairNote = `AI 修复稿未通过校验/重放，已保留原脚本：${(published.error ?? '').slice(0, 200)}`;
      results.push({ caseId: item.caseId, fixed: false, reason: item.repairNote, status: item.status });
    }
  }
  return results;
}

// ── 自动流水线：运行 → 失败自动修 → 再跑 → …直至全部（可修复的）通过 ──────────
// 终止条件三选一，且都不为了「全绿」而造假：
//  1. 没有可修复的失败了（全部通过，或剩下的都是环境问题/如实失败）；
//  2. 达到轮次上限（防无限循环烧 token）；
//  3. 被测应用不可达 —— 由调用方在入口拦截。

/** 连接被拒/域名解析失败等 = 被测应用没起或网络问题，不是脚本缺陷，不该喂给 AI 修。 */
export function isEnvironmentFailure(reason: string): boolean {
  return /net::ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_FAILED|CONNECTION_TIMED_OUT|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)|ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH/i.test(reason);
}

export interface PipelineSummary {
  rounds: number;
  passed: string[];
  /** 环境问题（被测应用没起）导致跑不了的用例。 */
  environmentBlocked: string[];
  /** AI 判定「不是脚本缺陷、需人工确认」的用例（断言如实失败）。 */
  needsHuman: string[];
  /** 轮次耗尽仍未通过、也未被明确归类的用例。 */
  stillFailing: string[];
}

/**
 * Lock-free：由 executeJob 在生成后（持锁内）调用，或 pipeline 路由（自持锁）调用。
 * 每一步都写盘（jobStatus 保持 running），让 UI 轮询能看到进度。
 */
async function runAndRepairLoop(
  jobRequest: ScriptJobRequest,
  manifest: ScriptManifest,
  maxRounds: number,
): Promise<PipelineSummary> {
  const parked = new Set<string>();          // 不再重试：环境问题 / AI 拒修 / 修复稿发布失败
  const needsHuman = new Set<string>();       // AI 明确判定需人工的（断言如实失败）
  const environmentBlocked = new Set<string>();
  const persistRunning = () => {
    manifest.counts = manifestCounts(manifest.cases, manifest.counts.eligible);
    manifest.jobStatus = 'running';
    writeManifest(jobRequest.projectPath, jobRequest.taskName, jobRequest.env, manifest);
  };

  // 第 0 步：运行全部可跑脚本。
  await runScriptCases(jobRequest, manifest, null);
  persistRunning();

  const parkEnv = () => {
    // 同样只看本轮:退役条目的陈年环境失败(如 TC-005 在 7-14 留下的 ECONNREFUSED)会被
    // 计进 environmentBlocked,让「N 条环境阻塞」的汇总与审计常年多出一条不存在的问题。
    for (const c of manifest.cases.filter(isCurrentRoundCase)) {
      if (c.lastRunError && isEnvironmentFailure(c.lastRunError)) { parked.add(c.caseId); environmentBlocked.add(c.caseId); }
    }
  };

  let rounds = 0;
  for (let round = 1; round <= maxRounds; round++) {
    parkEnv();  // 环境问题（被测应用没起）不喂给 AI。
    // 只修本轮用例:退役脚本的陈年失败不该消耗修复轮次与 token(化石进循环只会被修复通道
    // 判「不在合格集内」跳过、再被 park 成需人工 —— 每轮空转一次并虚报审计计数)。
    const fixable = manifest.cases.filter((c) => isCurrentRoundCase(c) && isFixableCase(c) && !parked.has(c.caseId));
    if (!fixable.length) break;
    rounds = round;

    const outcomes = await repairScriptCases(jobRequest, manifest, fixable.map((c) => c.caseId));
    persistRunning();

    const fixed: string[] = [];
    for (const outcome of outcomes) {
      if (outcome.fixed) { fixed.push(outcome.caseId); continue; }
      // AI 明确判定「不是脚本缺陷/无法修」→ park 需人工，不再重试。
      parked.add(outcome.caseId);
      needsHuman.add(outcome.caseId);
    }
    // 修复稿已发布并清掉 lastRunError；再跑一遍确认真实通过（needs_review 用例生成期没重放过）。
    if (fixed.length) {
      await runScriptCases(jobRequest, manifest, fixed);
      persistRunning();
      // 一次带确切失败原因的定向修复仍没跑通 → 不再盲目重试，park 需人工。
      // 这堵住了 AI 误把「断言如实失败」当技术 bug、反复加等待却治不好而空烧轮次的浪费：
      // 不管模型嘴上说没说 fixed，跑不通就是跑不通，交人工。
      for (const id of fixed) {
        const c = manifest.cases.find((x) => x.caseId === id);
        if (!c?.lastRunError) continue;               // 真通过了
        parked.add(id);
        if (isEnvironmentFailure(c.lastRunError)) environmentBlocked.add(id);
        else {
          needsHuman.add(id);
          // 模型自称已修但重跑仍挂：覆盖它乐观的 repairNote，讲真话。多为页面实际行为与用例预期不符。
          c.repairNote = 'AI 修改后仍未通过，多为页面实际行为与用例预期不一致（非脚本缺陷），需人工确认是产品缺陷还是用例预期有误';
        }
      }
    }
  }
  parkEnv();

  for (const id of environmentBlocked) needsHuman.delete(id);
  // 汇总同样只统计本轮,避免退役条目混进「通过/未修复」的口径。
  const currentCases = manifest.cases.filter(isCurrentRoundCase);
  const passed = currentCases.filter((c) => c.status === 'verified' && !c.lastRunError).map((c) => c.caseId);
  // 循环结束仍带失败、又没归入环境/人工的（只会在 maxRounds 用尽且还有未处理项时出现）：统一算需人工。
  const stillFailing = currentCases
    .filter((c) => c.lastRunError && !environmentBlocked.has(c.caseId) && !needsHuman.has(c.caseId))
    .map((c) => c.caseId);
  for (const id of stillFailing) needsHuman.add(id);
  return { rounds, passed, environmentBlocked: [...environmentBlocked], needsHuman: [...needsHuman], stillFailing };
}

/** 快速探测被测应用是否在线（frontendBaseUrl 根路径）。任何 HTTP 响应即视为可达。 */
async function isSutReachable(jobRequest: ScriptJobRequest): Promise<boolean> {
  let base: string | null = null;
  try { base = resolveProjectEnvWithDb(jobRequest.projectPath, jobRequest.env).frontendBaseUrl; }
  catch { return false; }
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(base, { signal: controller.signal, redirect: 'manual' });
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 手动「自动跑通」入口：对现有 manifest 直接跑一遍 运行→修复→再跑 的流水线（自持锁）。
 * 与生成解耦 —— 用户在被测应用起好后一键触发，不必重新生成脚本。
 */
export async function runPipelineForTask(request: {
  projectPath: string; taskName: string; env: string;
  model?: string; providerId?: string; maxRepairRounds?: number;
}): Promise<{ summary: PipelineSummary; manifest: ScriptManifest }> {
  const manifest = readManifest(request.projectPath, request.taskName, request.env);
  if (!manifest) throw new Error('尚未生成脚本清单（manifest）');
  const jobRequest: ScriptJobRequest = {
    projectPath: request.projectPath, taskName: request.taskName, env: request.env,
    runHash: manifest.latestRunHash, model: request.model, providerId: request.providerId,
  };
  if (!(await isSutReachable(jobRequest))) {
    throw new Error('被测应用未就绪：请先启动前端（frontendBaseUrl）再自动跑通');
  }
  // 无论正常结束还是中途抛错，都要给 manifest 落一个终态 —— 否则 persistRunning 写下的
  // 'running' 会一直卡住，UI 永远转圈、后续触发全被当成「已在运行」拒绝。
  const settle = (status: ScriptManifest['jobStatus'], error?: string) => {
    manifest.counts = manifestCounts(manifest.cases, manifest.counts.eligible);
    manifest.jobStatus = status;
    manifest.error = error;
    manifest.updatedAt = new Date().toISOString();
    writeManifest(request.projectPath, request.taskName, request.env, manifest);
  };
  const lock = acquireLock(jobRequest);
  try {
    let summary: PipelineSummary;
    try {
      summary = await runAndRepairLoop(jobRequest, manifest, request.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS);
    } catch (loopError) {
      const clean = redactTraceText(loopError instanceof Error ? loopError.message : String(loopError), safeRedactionsFor(jobRequest));
      settle('partial', `自动跑通中断:${clean.slice(0, 300)}`);
      throw loopError;
    }
    // 同上:只按本轮用例判终态,不被 stale 的历史失败记录拖住。
    const unpassed = manifest.cases.filter(isCurrentRoundCase).some((c) => c.lastRunError);
    settle(unpassed ? 'partial' : 'done', unpassed ? '部分回归脚本自动跑通未成功（详见各用例）' : undefined);
    await appendAudit(request.projectPath, request.taskName, {
      action: 'run-repair-pipeline', mode: 'manual', step: 'report',
      detail: `自动跑通:${summary.passed.length} 通过、${summary.needsHuman.length} 需人工、${summary.environmentBlocked.length} 环境阻塞(${summary.rounds} 轮)`,
    });
    return { summary, manifest };
  } finally {
    lock.close();
  }
}

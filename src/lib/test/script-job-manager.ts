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
import { readTraceFile, redactTraceText, type TraceRedaction } from './script-trace';
import { isSafeForAutomaticReplay, validateScriptSource } from './script-validator';
import { resolveScriptPlaywrightRuntime, runGeneratedScript, summarizeRunFailure } from './script-runner';
import { isUnsafeSegment } from './path-safety';
import type { RunJson } from './reduce';
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

export interface EnqueueResult {
  queued: boolean;
  reused: boolean;
  jobKey: string;
}

interface QueueEntry extends ScriptJobRequest {
  key: string;
}

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
  runContent: string;
} {
  const p = artifactPaths(request.taskName, request.env);
  const runContent = fs.readFileSync(path.join(request.projectPath, p.runJson), 'utf-8');
  if (sha1Hex(runContent) !== request.runHash) throw new Error('已被更新的一轮执行取代（superseded）');
  const run = JSON.parse(runContent) as RunJson;
  const casesRaw = parseCaseFile(path.join(request.projectPath, artifactPaths(request.taskName).cases));
  const trace = readTraceFile(request.projectPath, request.taskName, request.env);
  const traceActions = trace?.runHash === request.runHash ? trace.actions : [];
  return { run, casesRaw, traceActions, runContent };
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

async function validateAndPublish(params: {
  request: ScriptJobRequest;
  candidate: EligibleScriptCase;
  generated: GeneratedScript;
  previous?: ScriptManifestCase;
  redactions: TraceRedaction[];
}): Promise<ScriptManifestCase> {
  const { request, candidate, generated, previous, redactions } = params;
  const now = new Date().toISOString();
  const finalFile = candidateFinalFile(request, candidate);
  const source = candidateSource(candidate);
  const staticCheck = validateScriptSource(generated.content, candidate.scriptCaseId);
  const failed = (error: string, warnings: string[] = []): ScriptManifestCase => ({
    caseId: candidate.id,
    file: candidate.fileName,
    ...source,
    fingerprint: candidate.fingerprint,
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
  fs.writeFileSync(temp, generated.content, 'utf-8');
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
    if (!collected.ok) return failed(`Playwright 加载校验失败: ${collected.output.slice(-1000)}`, staticCheck.warnings);

    const safeReplay = isSafeForAutomaticReplay(candidate.testCase);
    let replayed = false;
    let replayError = '';
    if (safeReplay) {
      const replay = await runGeneratedScript({ ...runnerBase, collectOnly: false, timeoutMs: 120_000 });
      replayed = replay.ok;
      if (!replay.ok) replayError = `Playwright 自动重放失败: ${replay.output.slice(-1000)}`;
    }
    if (safeReplay && !replayed) return failed(replayError, staticCheck.warnings);

    fs.renameSync(temp, finalFile);
    const needsReview = staticCheck.needsReview || candidate.usesMock || !safeReplay || candidate.sourceMissing;
    return {
      caseId: candidate.id,
      file: candidate.fileName,
      ...source,
      fingerprint: candidate.fingerprint,
      status: needsReview ? 'needs_review' : 'verified',
      usesMock: candidate.usesMock,
      generatedAt: now,
      ...(replayed ? { lastVerifiedAt: now } : {}),
      lastSeenRunHash: request.runHash,
      validation: {
        syntax: true,
        collected: true,
        replayed,
        warnings: [
          ...staticCheck.warnings,
          ...(candidate.usesMock ? ['执行时使用了接口模拟（browser_route mock），需人工确认真实环境可通过'] : []),
          ...(!safeReplay ? ['已跳过自动重放：用例含写操作且未声明 cleanup 清理方式，请人工运行确认（或给用例补 cleanup 字段）'] : []),
          ...(candidate.sourceMissing ? ['回归用例库来源映射缺失，脚本暂存于聚合任务目录'] : []),
        ],
      },
    };
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* ignore */ }
  }
}

async function generateMissing(
  request: ScriptJobRequest,
  candidates: EligibleScriptCase[],
  previousById: Map<string, ScriptManifestCase>,
  redactions: TraceRedaction[],
  abortSignal: AbortSignal,
): Promise<Map<string, ScriptManifestCase>> {
  const result = new Map<string, ScriptManifestCase>();
  for (let i = 0; i < candidates.length; i += 5) {
    if (abortSignal.aborted) throw new Error('脚本生成已中止（被更新的任务取代）');
    const batch = candidates.slice(i, i + 5);
    let generated = await generateScriptsBatch({
      candidates: batch,
      model: request.model,
      providerId: request.providerId,
      redactions,
      abortSignal,
    });
    const generatedIds = new Set(generated.map((g) => g.caseId));
    for (const missing of batch.filter((candidate) => !generatedIds.has(candidate.id))) {
      if (abortSignal.aborted) throw new Error('脚本生成已中止（被更新的任务取代）');
      const retry = await generateScriptsBatch({
        candidates: [missing],
        model: request.model,
        providerId: request.providerId,
        redactions,
        abortSignal,
      });
      generated = [...generated, ...retry];
    }
    const byId = new Map(generated.map((item) => [item.caseId, item]));
    for (const candidate of batch) {
      const item = byId.get(candidate.id);
      if (!item) {
        result.set(candidate.id, {
          caseId: candidate.id,
          file: candidate.fileName,
          ...candidateSource(candidate),
          fingerprint: candidate.fingerprint,
          status: previousById.has(candidate.id) && fs.existsSync(candidateFinalFile(request, candidate)) ? 'outdated' : 'failed',
          usesMock: candidate.usesMock,
          lastSeenRunHash: request.runHash,
          error: 'AI 重试后仍未返回该用例的脚本',
          validation: { syntax: false, collected: false, replayed: false, warnings: [], error: 'AI 重试后仍未返回该用例的脚本' },
        });
        continue;
      }
      result.set(candidate.id, await validateAndPublish({
        request,
        candidate,
        generated: item,
        previous: previousById.get(candidate.id),
        redactions,
      }));
    }
  }
  return result;
}

async function executeJob(entry: QueueEntry): Promise<void> {
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
    const selection = selectEligibleCases(inputs.casesRaw, inputs.run, inputs.traceActions, manifest.runtimeVersion);
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
      const finalFile = candidateFinalFile(request, candidate);
      const reusable = !force?.has(candidate.id)
        && previous?.fingerprint === candidate.fingerprint
        && (previous.status === 'verified' || previous.status === 'needs_review')
        && fs.existsSync(finalFile);
      if (reusable) {
        nextCases.push({ ...previous, lastSeenRunHash: request.runHash });
      } else if (!force || force.has(candidate.id)) {
        pending.push(candidate);
      } else if (previous) {
        nextCases.push(previous);
      }
    }
    for (const previous of manifest.cases) {
      if (!eligibleIds.has(previous.caseId)) nextCases.push({ ...previous, status: 'stale', lastSeenRunHash: request.runHash });
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
    if (request.runPipeline && manifest.cases.some((c) => c.status === 'verified' || c.status === 'needs_review')) {
      if (await isSutReachable(request)) {
        try {
          const summary = await runAndRepairLoop(request, manifest, request.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS);
          const finalCounts = manifestCounts(manifest.cases, manifest.counts.eligible);
          const unpassed = manifest.cases.some((c) => c.lastRunError);
          manifest = markManifest(request, {
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
          const unpassed = manifest.cases.some((c) => c.lastRunError);
          manifest = markManifest(request, {
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

function drain(): void {
  if (running) return;
  const entry = queue.shift();
  if (!entry) return;
  running = true;
  queuedKeys.delete(entry.key);
  activeKeys.add(entry.key);
  void executeJob(entry).finally(() => {
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
      queue.push({ ...request, key });
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
    queue.push({ ...request, key });
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
  const runnable = manifest.cases.filter((item) =>
    (item.status === 'verified' || item.status === 'needs_review') && (!requested || requested.has(item.caseId)));
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
    if (!item.usesMock) {
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
  const selection = selectEligibleCases(inputs.casesRaw, inputs.run, inputs.traceActions, manifest.runtimeVersion);
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
    for (const c of manifest.cases) {
      if (c.lastRunError && isEnvironmentFailure(c.lastRunError)) { parked.add(c.caseId); environmentBlocked.add(c.caseId); }
    }
  };

  let rounds = 0;
  for (let round = 1; round <= maxRounds; round++) {
    parkEnv();  // 环境问题（被测应用没起）不喂给 AI。
    const fixable = manifest.cases.filter((c) => c.lastRunError && !parked.has(c.caseId));
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
  const passed = manifest.cases.filter((c) => c.status === 'verified' && !c.lastRunError).map((c) => c.caseId);
  // 循环结束仍带失败、又没归入环境/人工的（只会在 maxRounds 用尽且还有未处理项时出现）：统一算需人工。
  const stillFailing = manifest.cases
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
    const unpassed = manifest.cases.some((c) => c.lastRunError);
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

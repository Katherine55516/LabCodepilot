import fs from 'fs';
import path from 'path';
import { appendAudit } from './audit';
import { resolveProjectEnvWithDb } from './env-resolve';
import { sha1Hex } from './history';
import { artifactPaths } from './prompts';
import { generateScriptsBatch, retargetLibraryCandidates, selectEligibleCases, type EligibleScriptCase, type GeneratedScript } from './script-generator';
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
import { resolveScriptPlaywrightRuntime, runGeneratedScript } from './script-runner';
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
   * 回归轮次号。v2 起回归执行的产物落 `report/{task}/{roundId}/`,不带它就会去平铺目录找
   * run.json 并 ENOENT —— 回归轮次的脚本生成因此**从来没成功过**(审计里那条
   * 「回归脚本后台生成失败:ENOENT ... 回归用例库-local.run.json」)。普通任务不传,路径不变。
   */
  roundId?: string;
}

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
      if (Date.now() - stat.mtimeMs > 30 * 60_000) fs.unlinkSync(file);
      fd = tryOpen();
    } catch {
      throw new Error('script generation is already running');
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
  const p = artifactPaths(request.taskName, request.env, request.roundId);
  const runContent = fs.readFileSync(path.join(request.projectPath, p.runJson), 'utf-8');
  if (sha1Hex(runContent) !== request.runHash) throw new Error('superseded by a newer execution');
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
    if (!collected.ok) return failed(`Playwright collection failed: ${collected.output.slice(-1000)}`, staticCheck.warnings);

    const safeReplay = isSafeForAutomaticReplay(candidate.testCase);
    let replayed = false;
    let replayError = '';
    if (safeReplay) {
      const replay = await runGeneratedScript({ ...runnerBase, collectOnly: false, timeoutMs: 120_000 });
      replayed = replay.ok;
      if (!replay.ok) replayError = `Playwright replay failed: ${replay.output.slice(-1000)}`;
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
          ...(candidate.usesMock ? ['execution used browser_route mock'] : []),
          ...(!safeReplay ? ['automatic replay skipped because the case may mutate business data without cleanup'] : []),
          ...(candidate.sourceMissing ? ['regression-library source mapping was missing; script kept under the synthetic task'] : []),
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
    if (abortSignal.aborted) throw new Error('script generation aborted');
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
      if (abortSignal.aborted) throw new Error('script generation aborted');
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
          error: 'generator omitted the eligible case after retry',
          validation: { syntax: false, collected: false, replayed: false, warnings: [], error: 'generator omitted the eligible case after retry' },
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
    if (selection.blockedReason === 'circuit_broken') throw new Error('execution circuit breaker is active; script generation skipped');
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
  if (!request.forceCaseIds?.length && current?.latestRunHash === request.runHash
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

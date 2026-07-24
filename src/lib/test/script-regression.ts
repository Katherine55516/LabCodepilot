import fs from 'fs';
import path from 'path';
import {
  readManifest,
  writeManifest,
  scriptsDir,
  type ScriptManifestCase,
} from './script-artifacts';
import { runGeneratedScript, summarizeRunFailure, type ScriptRunnerResult, type ScriptRunnerOptions } from './script-runner';
import { isEnvironmentFailure, tryAcquireScriptLock } from './script-job-manager';
import { caseFingerprint, REGRESSION_LIBRARY_TASK, type TestCase } from './library';
import { resolveProjectEnvWithDb } from './env-resolve';
import { appendAudit } from './audit';
import { isUnsafeSegment } from './path-safety';
import type { RoundSnapshot } from './rounds';

/**
 * 回归轮次 · 脚本重放优先(阶段 A)。
 *
 * 功能测试沉淀的 Playwright 脚本(见 script-job-manager)在回归执行时作为「快车道」:
 * 有合格脚本的用例由平台直接运行脚本产出判定(秒级/条、零 token),其余用例仍由 AI
 * 执行(阶段 B)。本模块负责:
 *   1. resolveReplayPlan  —— 资格判定(双 manifest 合并、状态/mock/失败记录/指纹/文件五道闸);
 *   2. acquireReplayLocks —— 按 manifest 归属任务拿 .generation.lock(锁忙 → 整组降级走 AI);
 *   3. buildScriptPhaseStream —— 逐条跑脚本并发出与 AI 执行【同构】的 SSE 合成帧
 *      (@@CASE_START / ▶ 进度行 / @@RESULT),归约器与实时面板零改动直接消费。
 *
 * 失败策略(2026-07-13 用户拍板,策略 A):脚本失败 = 用例失败,不自动转 AI;连续失败
 * ≥2 次在 error 里附治理建议。环境类失败(连接被拒等)判 blocked、不计连败。
 */

/** 一条待判定资格的回归用例(来自当轮快照或套件求值预览)。 */
export interface ReplayCandidate {
  /** 本轮 run.json 使用的 id(快照 cases 的 id;预览场景传占位即可)。 */
  runId: string;
  /** 来源任务(idMap / _source 反解)。 */
  task: string;
  originalId: string;
  /** 用例体(算 caseFingerprint 用;多余字段无害——指纹自动排除 id/tags/_source/_lib)。 */
  caseBody: Record<string, unknown>;
  /** ▶ 进度行标题(purpose)。 */
  title: string;
}

/** 通过资格判定、可脚本重放的用例。 */
export interface ReplayPlanItem extends ReplayCandidate {
  /** 脚本元数据所属任务(= 来源任务,或聚合任务 回归用例库)——重放后更新该 manifest。 */
  manifestTask: string;
  /** 该 manifest 内的条目 caseId。 */
  manifestCaseId: string;
  /** 脚本物理文件绝对路径(已过根目录校验)。 */
  scriptFile: string;
}

export interface ReplayPlan {
  eligible: ReplayPlanItem[];
  skipped: Array<{ runId: string; reason: string }>;
}

/** 快照 cases + idMap → 候选列表(缺映射/坏条跳过,由 resolveReplayPlan 判为无脚本)。 */
export function candidatesFromSnapshot(snapshot: RoundSnapshot): ReplayCandidate[] {
  const out: ReplayCandidate[] = [];
  for (const raw of snapshot.cases) {
    if (!raw || typeof raw !== 'object') continue;
    const body = raw as Record<string, unknown>;
    const runId = typeof body.id === 'string' ? body.id : '';
    if (!runId) continue;
    const source = snapshot.idMap[runId];
    if (!source || isUnsafeSegment(source.task) || !source.originalId?.trim()) continue;
    out.push({
      runId,
      task: source.task,
      originalId: source.originalId.trim(),
      caseBody: body,
      title: typeof body.purpose === 'string' ? body.purpose : runId,
    });
  }
  return out;
}

/** 条目"新鲜度"时间戳(ISO 字符串直接比较):脚本被生成/验证/运行的最近时刻。 */
function entryFreshness(e: ScriptManifestCase): string {
  return [e.generatedAt, e.lastVerifiedAt, e.lastRunAt].filter((v): v is string => !!v).sort().pop() ?? '';
}

/** 解析条目的脚本物理文件(镜像 runScriptCases 的 ownerTask + 根目录校验口径)。 */
function entryScriptFile(projectPath: string, env: string, manifestTask: string, entry: ScriptManifestCase): string | null {
  const ownerTask = entry.sourceTask ?? manifestTask;
  if (isUnsafeSegment(ownerTask)) return null;
  const root = path.resolve(scriptsDir(projectPath, ownerTask, env));
  const file = path.resolve(root, entry.file);
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}

/**
 * 资格判定。脚本元数据可能有两个家(同一物理文件的两种视图):
 *   - 来源任务 manifest(功能测试轮生成,caseId = 任务内用例 id);
 *   - 回归用例库聚合 manifest(回归轮生成,caseId = 当时的 runId,带 sourceTask/sourceCaseId)。
 * 取**最新鲜**的那条做判定——旧视图描述的可能已不是文件的当前内容。
 *
 * 五道闸(全过才重放):非 mock → 状态 verified / needs_review(后者不得带失败记录)→
 * caseBodyHash 与当前用例体一致(缺失宽限)→ 文件存在 → (执行期)拿得到锁。
 */
export function resolveReplayPlan(projectPath: string, env: string, candidates: ReplayCandidate[]): ReplayPlan {
  const eligible: ReplayPlanItem[] = [];
  const skipped: Array<{ runId: string; reason: string }> = [];
  const manifestCache = new Map<string, ReturnType<typeof readManifest>>();
  const getManifest = (task: string) => {
    if (!manifestCache.has(task)) {
      let m: ReturnType<typeof readManifest> = null;
      try { m = readManifest(projectPath, task, env); } catch { /* 段非法/损坏 → 视作无 */ }
      manifestCache.set(task, m);
    }
    return manifestCache.get(task) ?? null;
  };

  for (const c of candidates) {
    // 双 manifest 收集候选条目。
    const found: Array<{ manifestTask: string; entry: ScriptManifestCase }> = [];
    const src = getManifest(c.task);
    const srcEntry = src?.cases.find((e) => e.caseId === c.originalId && !e.sourceTask);
    if (srcEntry) found.push({ manifestTask: c.task, entry: srcEntry });
    const agg = getManifest(REGRESSION_LIBRARY_TASK);
    for (const e of agg?.cases ?? []) {
      if (e.sourceTask === c.task && e.sourceCaseId === c.originalId) found.push({ manifestTask: REGRESSION_LIBRARY_TASK, entry: e });
    }
    if (!found.length) { skipped.push({ runId: c.runId, reason: '无沉淀脚本' }); continue; }
    // 最新鲜的视图代表文件当前内容。
    found.sort((a, b) => entryFreshness(b.entry).localeCompare(entryFreshness(a.entry)));
    const { manifestTask, entry } = found[0];

    if (entry.usesMock) { skipped.push({ runId: c.runId, reason: '脚本使用接口模拟(mock),不参与回归重放' }); continue; }
    if (entry.status !== 'verified' && entry.status !== 'needs_review') {
      skipped.push({ runId: c.runId, reason: `脚本状态 ${entry.status},不可重放` }); continue;
    }
    if (entry.status === 'needs_review' && entry.lastRunError) {
      skipped.push({ runId: c.runId, reason: '脚本待复核且带失败记录,交给修复通道' }); continue;
    }
    if (entry.caseBodyHash && entry.caseBodyHash !== caseFingerprint(c.caseBody as TestCase)) {
      skipped.push({ runId: c.runId, reason: '用例已修改,与脚本指纹不匹配' }); continue;
    }
    const file = entryScriptFile(projectPath, env, manifestTask, entry);
    if (!file || !fs.existsSync(file)) { skipped.push({ runId: c.runId, reason: '脚本文件缺失' }); continue; }

    eligible.push({ ...c, manifestTask, manifestCaseId: entry.caseId, scriptFile: file });
  }
  return { eligible, skipped };
}

/** 套件求值预览用:圈选集内可脚本重放的条数(不碰锁——锁是瞬时执行态)。 */
export function countScriptableEntries(
  projectPath: string,
  env: string,
  entries: Array<Record<string, unknown> & { _source: { task: string; originalId: string } }>,
): number {
  const candidates: ReplayCandidate[] = entries.map((e, i) => ({
    runId: `preview-${i}`,
    task: e._source.task,
    originalId: e._source.originalId,
    caseBody: e,
    title: '',
  }));
  try { return resolveReplayPlan(projectPath, env, candidates).eligible.length; } catch { return 0; }
}

export interface ReplayLocks {
  /** 拿到锁、确认进入阶段 A 的用例。 */
  locked: ReplayPlanItem[];
  /** 所属 manifest 的锁被生成任务占用 → 整组降级走 AI。 */
  deferred: Array<{ runId: string; reason: string }>;
  release: () => void;
}

/**
 * 按 manifest 归属任务分组拿 .generation.lock(与后台脚本生成/手动运行互斥)。
 * 锁在整个阶段 A 期间持有,由 buildScriptPhaseStream 收尾时 release(调用方需保证
 * 异常路径也 release——route 侧 try/catch 兜底)。
 */
export function acquireReplayLocks(projectPath: string, env: string, items: ReplayPlanItem[]): ReplayLocks {
  const groups = new Map<string, ReplayPlanItem[]>();
  for (const it of items) {
    if (!groups.has(it.manifestTask)) groups.set(it.manifestTask, []);
    groups.get(it.manifestTask)!.push(it);
  }
  const locked: ReplayPlanItem[] = [];
  const deferred: ReplayLocks['deferred'] = [];
  const handles: Array<{ close: () => void }> = [];
  for (const [task, group] of groups) {
    const h = tryAcquireScriptLock(projectPath, task, env);
    if (h) { handles.push(h); locked.push(...group); }
    else for (const it of group) deferred.push({ runId: it.runId, reason: '脚本任务运行中(锁占用),本轮走 AI 执行' });
  }
  let released = false;
  return {
    locked,
    deferred,
    release: () => {
      if (released) return;
      released = true;
      for (const h of handles) { try { h.close(); } catch { /* ignore */ } }
    },
  };
}

/** SSE text 帧(与 streamClaude 的帧编码一致,归约器/实时面板按行解析其中的标记)。 */
function sseText(text: string): string {
  return `data: ${JSON.stringify({ type: 'text', data: text })}\n\n`;
}

/** 连败 ≥2 的治理建议(策略 A:不转 AI,提示用户去修)。 */
function streakHint(n: number): string {
  return `；该脚本已连续 ${n} 次重放失败——建议到「功能测试 → 报告 → 回归自动化脚本」面板执行「AI 修复」或「重试缺口」，或发起回归时关闭「优先脚本重放」让本用例走 AI 执行对照`;
}

export interface ScriptPhaseParams {
  projectPath: string;
  env: string;
  roundId: string;
  /** 已拿到锁的重放用例(acquireReplayLocks().locked)。 */
  items: ReplayPlanItem[];
  /** 本轮用例总数(▶ 进度行的分母;含走 AI 的部分)。 */
  totalCases: number;
  abortSignal?: AbortSignal;
  /** 阶段 B 被整体跳过时,在阶段 A 末尾补发的收尾说明。 */
  closingNote?: string;
  /** 锁释放回调(流关闭/取消/异常时调用,幂等)。 */
  release?: () => void;
  /** 测试注入用的脚本运行器(缺省 = 真实 runGeneratedScript)。 */
  runner?: (opts: ScriptRunnerOptions) => Promise<ScriptRunnerResult>;
}

/**
 * 阶段 A 执行流:逐条跑脚本、发合成帧、就地更新 manifest(lastRunAt/lastRunError/
 * 连败计数/verified 提升),组结束原子落盘。帧与 AI 执行同构 → wrapExecutionStream
 * 的归约/计时/实时面板零改动。
 */
export function buildScriptPhaseStream(params: ScriptPhaseParams): ReadableStream<string> {
  const { projectPath, env, roundId, items, totalCases, abortSignal, closingNote, release } = params;
  const runner = params.runner ?? runGeneratedScript;
  let cancelled = false;

  return new ReadableStream<string>({
    async start(controller) {
      const startedMs = Date.now();
      let pass = 0, fail = 0, blocked = 0;
      try {
        controller.enqueue(sseText(`⚡ 脚本重放优先：本轮 ${totalCases} 条用例中 ${items.length} 条存在已沉淀的自动化脚本，由平台直接运行（不消耗 AI）。\n`));
        const resolved = resolveProjectEnvWithDb(projectPath, env);
        // 按 manifest 归属分组:组内逐条跑,组末一次性落盘(条目更新就地改)。
        const groups = new Map<string, ReplayPlanItem[]>();
        for (const it of items) {
          if (!groups.has(it.manifestTask)) groups.set(it.manifestTask, []);
          groups.get(it.manifestTask)!.push(it);
        }
        let index = 0;
        let aborted = false;
        for (const [manifestTask, group] of groups) {
          const manifest = readManifest(projectPath, manifestTask, env);
          const byCase = new Map((manifest?.cases ?? []).map((e) => [e.caseId, e]));
          let touched = false;
          for (const item of group) {
            index++;
            if (cancelled || abortSignal?.aborted) { aborted = true; break; }
            controller.enqueue(sseText(
              `@@CASE_START ${JSON.stringify({ id: item.runId, index })}\n▶ 用例 ${index}/${totalCases}：${item.title}（脚本重放）\n`,
            ));
            const now = new Date().toISOString();
            const entry = byCase.get(item.manifestCaseId);
            let result: ScriptRunnerResult;
            try {
              result = await runner({
                scriptFile: item.scriptFile,
                baseUrl: resolved.frontendBaseUrl,
                storageStatePath: resolved.storageStatePath,
                username: resolved.loginAccount?.username,
                password: resolved.loginAccount?.password,
                collectOnly: false,
                timeoutMs: 120_000,
              });
            } catch (e) {
              result = { ok: false, exitCode: null, output: e instanceof Error ? e.message : String(e), timedOut: false };
            }

            let verdict: { id: string; status: string; actual: string; error: string; evidence: string[]; via: 'script' };
            if (result.ok) {
              pass++;
              if (entry) {
                entry.lastRunAt = now; entry.lastRunError = undefined; entry.consecutiveRunFailures = 0;
                if (!entry.usesMock) {
                  entry.status = 'verified';
                  entry.lastVerifiedAt = now;
                  entry.validation = { ...(entry.validation ?? { syntax: true, collected: true, replayed: false, warnings: [] }), replayed: true, error: undefined };
                  entry.error = undefined;
                }
                touched = true;
              }
              verdict = { id: item.runId, status: 'pass', actual: '脚本重放通过（Playwright 断言全部通过）', error: '', evidence: [], via: 'script' };
            } else {
              const summary = summarizeRunFailure(result.output, result.timedOut);
              if (isEnvironmentFailure(summary)) {
                // 环境失败 ≠ 脚本腐化:判 blocked、不计连败(与既有流水线分类一致)。
                blocked++;
                if (entry) { entry.lastRunAt = now; entry.lastRunError = summary; touched = true; }
                verdict = { id: item.runId, status: 'blocked', actual: '脚本重放未完成（被测环境异常）', error: `被测环境异常：${summary}`, evidence: [], via: 'script' };
              } else {
                fail++;
                const streak = (entry?.consecutiveRunFailures ?? 0) + 1;
                if (entry) { entry.lastRunAt = now; entry.lastRunError = summary; entry.consecutiveRunFailures = streak; touched = true; }
                verdict = {
                  id: item.runId,
                  status: 'fail',
                  actual: '脚本重放失败（Playwright 断言未通过）',
                  error: summary + (streak >= 2 ? streakHint(streak) : ''),
                  evidence: [],
                  via: 'script',
                };
              }
            }
            controller.enqueue(sseText(`@@RESULT ${JSON.stringify(verdict)}\n`));
          }
          if (touched && manifest) {
            manifest.updatedAt = new Date().toISOString();
            try { writeManifest(projectPath, manifestTask, env, manifest); } catch { /* manifest 更新失败不影响轮次结果 */ }
          }
          if (aborted) break;
        }
        const secs = ((Date.now() - startedMs) / 1000).toFixed(1);
        controller.enqueue(sseText(`\n📊 脚本重放完成：${pass} 通过 · ${fail} 失败 · ${blocked} 环境阻塞（共 ${items.length} 条，耗时 ${secs}s）。\n`));
        if (closingNote && !aborted) controller.enqueue(sseText(`${closingNote}\n`));
        // await(而非 fire-and-forget):流关闭即审计落定,不给测试目录清理/进程退出留竞态。
        await appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
          action: 'script-replay',
          mode: 'auto',
          step: 'execution',
          detail: `轮次 ${roundId} 脚本重放 ${items.length} 条：${pass} 通过 / ${fail} 失败 / ${blocked} 环境阻塞${aborted ? '（用户中止，未跑完）' : ''}`,
        }).catch(() => { /* 审计失败不影响轮次 */ });
      } catch (e) {
        // 阶段 A 异常不摧毁整条流:已发出的判定仍有效,剩余用例由归约器补「未执行」。
        controller.enqueue(sseText(`\n⚠️ 脚本重放阶段异常中止：${e instanceof Error ? e.message : String(e)}\n`));
      } finally {
        release?.();
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      release?.();
    },
  });
}

/**
 * 顺序拼接两条 SSE 流(pull-based,第二条【惰性】创建——阶段 A 跑完才起 AI,避免
 * 双方并发操作同一被测系统)。second 缺省 = 只有第一条。
 */
export function concatSseStreams(
  first: ReadableStream<string>,
  second?: () => ReadableStream<string>,
): ReadableStream<string> {
  let reader = first.getReader();
  let phase: 0 | 1 = 0;
  return new ReadableStream<string>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) { controller.enqueue(value); return; }
        if (phase === 0 && second) {
          phase = 1;
          reader = second().getReader();
          continue;
        }
        controller.close();
        return;
      }
    },
    cancel(reason) {
      try { void reader.cancel(reason); } catch { /* ignore */ }
    },
  });
}

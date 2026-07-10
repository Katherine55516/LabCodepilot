import fs from 'fs';
import path from 'path';
import { artifactPaths, type TestStep } from '@/lib/test/prompts';
import { reduceFromText } from '@/lib/test/reduce';
import { snapshotRunJson, sha1Hex } from '@/lib/test/history';
import { sweepStrayEvidence, normalizeEvidenceExt } from '@/lib/test/evidence';
import { createCaseTimer } from '@/lib/test/exec-timing';
import { buildStepCompleted, recordStatsEvents } from '@/lib/test/stats-recorder';
import { appendAudit } from '@/lib/test/audit';
import { depositTask, readTaskCases, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import { readRoundSnapshot } from '@/lib/test/rounds';
import { ScriptTraceCollector, writeTraceFile, type TraceRedaction } from '@/lib/test/script-trace';
import { enqueueScriptJob } from '@/lib/test/script-job-manager';

/**
 * 测试执行路由的 SSE 流包装器（从 src/app/api/test/run/route.ts 抽出）。
 *
 * 抽出原因：Next.js 构建期路由类型校验只允许 route.ts 导出 HTTP method handler
 * 与路由配置字段，helper 导出（wrapExecutionStream 等）会导致 `next build` 失败
 * （"is not a valid Route export field"）。单测与复用方从本模块导入。
 */

/**
 * 使用统计上下文（body 携带 taskId 时才构造；缺失 → 全部埋点跳过，宁缺毋错）。
 * abort/error 收尾的运行不记事件——错误轮不能被记成完成（口径见执行计划）。
 */
export interface StepStats {
  taskId: string;
  model?: string;
  providerId?: string;
  stepStartMs: number;
  aborted: () => boolean;
}

/**
 * 干净收尾时补发的 step_stats 帧（沿用 run_json 手写帧先例，不进 SSEEventType 联合，
 * 前端未知类型静默忽略 → 旧前端零影响）：前端据此把节点用时/模型写进 TaskState
 * 并随 test-workbench.json 持久化（流程节点徽标的数据源）。
 */
export function stepStatsFrame(step: TestStep, stats: StepStats): string {
  return `data: ${JSON.stringify({
    type: 'step_stats',
    data: JSON.stringify({ step, durationMs: Date.now() - stats.stepStartMs, model: stats.model ?? null }),
  })}\n\n`;
}

/**
 * Wrap the execution step's SSE stream: forward every frame to the client
 * unchanged AND accumulate the agent's `text` frames server-side. When the stream
 * ends, deterministically reduce the harvested `@@RESULT` lines into the canonical
 * run.json (code computes counts / env-reclass / 401 circuit-breaker — NOT the
 * LLM), write it to AI_LabTest/report/{task}/{task}-{env}.run.json, and emit a
 * final `{type:'run_json'}` frame so the panel shows the authoritative result.
 */
export function wrapExecutionStream(
  src: ReadableStream<string>,
  opts: {
    projectPath: string;
    taskName: string;
    env: string;
    runStartMs: number;
    leadingFrame?: string;
    stats?: StepStats;
    roundId?: string;
    traceRedactions?: TraceRedaction[];
  },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  let sawError = false;
  // 逐用例计时：对 text 增量做行缓冲，▶ 行 → 下一条 @@RESULT 行的挂钟差（见 exec-timing.ts）
  const timer = createCaseTimer();
  const traceCollector = new ScriptTraceCollector(opts.runStartMs, opts.traceRedactions ?? []);
  return new ReadableStream<string>({
    start(controller) {
      // 有头被自动回落无头时,先补发一条提示帧让用户在对话里看到「已改无头」(见 POST 内)。
      if (opts.leadingFrame) controller.enqueue(opts.leadingFrame);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const paths = artifactPaths(opts.taskName, opts.env, opts.roundId);
          const evidenceAbs = path.join(opts.projectPath, paths.evidenceDir);
          // Evidence 收口: sweep stray screenshots/videos created this run into the
          // evidence dir, then give extension-less files a real ext (magic-number).
          try {
            sweepStrayEvidence({
              dirs: [opts.projectPath, path.join(opts.projectPath, 'AI_LabTest', 'report')],
              evidenceDir: evidenceAbs,
              sinceMs: opts.runStartMs,
            });
            normalizeEvidenceExt(evidenceAbs);
          } catch {
            // best-effort cleanup
          }
          // Join cases.json's oracle 双轴 (verification field) so the reduction can
          // compute the dual-rate pass (功能验证 vs 回归基线). best-effort: missing /
          // unparseable cases → undefined map → reduce falls back to single-rate.
          let verificationById: Record<string, string> | undefined;
          let caseIds: string[] | undefined;
          let suiteIds: string[] | undefined;
          try {
            const casesAbs = path.join(opts.projectPath, artifactPaths(opts.taskName).cases);
            const parsed = JSON.parse(await fs.promises.readFile(casesAbs, 'utf-8')) as unknown;
            // cases.json 可能是 { cases: [...] } 或顶层数组 [...]（与 report-xlsx 同口径兼容）。
            const list = Array.isArray((parsed as { cases?: unknown })?.cases)
              ? (parsed as { cases: Array<{ id?: unknown; verification?: unknown; tags?: unknown }> }).cases
              : Array.isArray(parsed)
                ? (parsed as Array<{ id?: unknown; verification?: unknown; tags?: unknown }>)
                : [];
            const map: Record<string, string> = {};
            const ids: string[] = [];
            const suite: string[] = [];
            for (const c of list) {
              if (c && typeof c.id === 'string') {
                ids.push(c.id);
                if (typeof c.verification === 'string') map[c.id] = c.verification;
                // 回归集 = tags 含「回归测试」（§1.7,与 verification 回归基线正交）。
                if (Array.isArray(c.tags) && c.tags.some((tg) => tg === '回归测试')) suite.push(c.id);
              }
            }
            if (Object.keys(map).length) verificationById = map;
            // 用例全集 id（按 cases.json 顺序）→ 交给 reduce 兜底补全漏执行的用例（问题②修复：
            // 报告以用例全集为准，AI 漏跑的用例补成「未执行」blocked，而非静默丢失）。
            if (ids.length) caseIds = ids;
            if (suite.length) suiteIds = suite;
          } catch {
            // no cases / parse fail → reduce falls back to single-rate + 不补全
          }
          // 回归轮次:当轮快照 idMap(runId→来源任务)注入归约 → run.json 带 taskCounts
          // 按来源任务分组小计(「哪个功能的回归挂了」一眼可见)。快照缺损 → 不分组,不阻塞。
          let taskOf: Record<string, string> | undefined;
          if (opts.roundId) {
            try {
              const snap = readRoundSnapshot(opts.projectPath, opts.roundId);
              if (snap?.idMap) {
                taskOf = {};
                for (const [rid, src] of Object.entries(snap.idMap)) taskOf[rid] = src.task;
              }
            } catch { /* best-effort */ }
          }
          const reduced = reduceFromText(textAcc, {
            module: opts.taskName,
            env: opts.env,
            time: new Date().toISOString(),
            verificationById,
            caseIds,
            suiteIds,
            taskOf,
          });
          // 逐用例耗时合入 tests[]（在 stringify 之前 → run.json 与 runHash 都覆盖 durations）。
          // 对齐补全的「未执行」条目天然测不到时长，保持缺省。
          const durations = timer.finish(Date.now());
          for (const t of reduced.tests) {
            const d = durations[t.id];
            if (typeof d === 'number' && d > 0) t.durationMs = d;
          }
          const runContent = JSON.stringify(reduced, null, 2);
          const runHash = sha1Hex(runContent);
          try {
            const runAbs = path.join(opts.projectPath, paths.runJson);
            const reportTaskDir = path.dirname(runAbs);
            await fs.promises.mkdir(reportTaskDir, { recursive: true });
            await fs.promises.writeFile(runAbs, runContent, 'utf-8');
            // 缺陷报告是【上一次执行】的产物（仅在有 fail 时条件生成、非每次覆盖）。本次重新
            // 执行已写新 run.json，旧缺陷报告随即作废：删掉它，否则会出现「本次全部通过/缺陷
            // 已修，却仍显示上一次的缺陷报告」（用户反馈的 bug）。本次若仍有 fail，前端 ReportView
            // 会按新 run.json 重新自动生成缺陷报告(见 autoDefectForTimeRef)。单文件删除、非批量，
            // 不触发 EDR 反勒索。best-effort，无旧文件则忽略。
            try {
              await fs.promises.unlink(path.join(reportTaskDir, `${opts.taskName}-${opts.env}-缺陷报告.md`));
            } catch { /* 无旧缺陷报告则忽略 */ }
            // 历史快照（报告多版本对比的数据基础）：除覆盖式 latest 外，再存一份带
            // 时间戳的副本到 .history/（SHA-1 去重，与上一份相同则跳过）。best-effort。
            snapshotRunJson({ reportTaskDir, taskName: opts.taskName, env: opts.env, content: runContent });
          } catch {
            // best-effort: still emit the reduced result even if the write fails
          }
          try {
            writeTraceFile(opts.projectPath, opts.taskName, opts.env, runHash, traceCollector.finish());
          } catch {
            // trace 是脚本生成增强产物；失败不得改变执行结果
          }
          // 使用统计：执行轮干净收尾（无 error 帧、未中断）才记 execution_completed +
          // step_completed；runHash 与快照去重同源（sha1(runContent)，已含 durations）。
          const stats = opts.stats;
          if (stats && !sawError && !stats.aborted()) {
            recordStatsEvents([
              {
                eventType: 'execution_completed',
                projectPath: opts.projectPath,
                taskId: stats.taskId,
                taskName: opts.taskName,
                env: opts.env,
                payload: {
                  env: opts.env,
                  model: stats.model ?? null,
                  counts: reduced.counts,
                  funcCounts: reduced.funcCounts,
                  circuitBroken: reduced.circuitBroken,
                  durationMs: Date.now() - stats.stepStartMs,
                  runHash,
                  tests: reduced.tests.map((t) => ({ id: t.id, durationMs: t.durationMs ?? null })),
                },
              },
              buildStepCompleted({
                taskId: stats.taskId,
                projectPath: opts.projectPath,
                taskName: opts.taskName,
                env: opts.env,
                step: 'execution',
                stepStartMs: stats.stepStartMs,
                model: stats.model,
                providerId: stats.providerId,
              }),
            ]);
          }
          if (stats && !sawError && !stats.aborted()) {
            controller.enqueue(stepStatsFrame('execution', stats));
          }
          controller.enqueue(`data: ${JSON.stringify({ type: 'run_json', data: JSON.stringify(reduced) })}\n\n`);
          controller.close();
          return;
        }
        controller.enqueue(value);
        // Parse forwarded frames to accumulate agent text (source of @@RESULT lines).
        frameBuf += value;
        const frames = frameBuf.split('\n\n');
        frameBuf = frames.pop() || '';
        for (const f of frames) {
          const line = f.replace(/^data:\s?/, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt?.type === 'text') {
              textAcc += evt.data || '';
              timer.feedText(evt.data || '', Date.now());
              traceCollector.feedText(evt.data || '');
            } else if (evt?.type === 'tool_use') {
              try { traceCollector.feedToolUse(JSON.parse(evt.data || '{}')); } catch { /* ignore */ }
            } else if (evt?.type === 'tool_result') {
              try { traceCollector.feedToolResult(JSON.parse(evt.data || '{}')); } catch { /* ignore */ }
            } else if (evt?.type === 'error') {
              // SDK 报错路径先发 error 帧再发 done 帧——错误轮不得记成完成
              sawError = true;
            } else if (evt?.type === 'result') {
              // SDK 会话级失败（限流/鉴权/额度）只发 result{is_error:true}，无 error 帧
              try {
                const r = JSON.parse(evt.data || '{}') as { is_error?: unknown };
                if (r?.is_error === true) sawError = true;
              } catch { /* native result 帧无 is_error → 非错误 */ }
            }
          } catch {
            // ignore non-JSON frames
          }
        }
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      reader.cancel(reason);
    },
  });
}

/**
 * 报告步收口：报告 .md 全靠 report 步的 AI 用 Write 落盘（见 reportPrompt 落点）。AI 偶发
 * 只产摘要不调 Write → 步骤照样以「流结束无 error」标 done，结果「已完成」却无报告文档。
 * 这里在流结束时校验 `{task}-{env}.md` 是否真存在，缺失就补发一条 error 帧——前端据此把
 * 报告步标「失败」（而非误报已完成），面板转入失败态提示「重跑」，让用户能重试。
 */
export function wrapReportStream(
  src: ReadableStream<string>,
  opts: {
    projectPath: string;
    taskName: string;
    env: string;
    model?: string;
    providerId?: string;
    aborted?: () => boolean;
    stats?: StepStats;
    roundId?: string;
  },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let sawError = false;
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const reportAbs = path.join(opts.projectPath, artifactPaths(opts.taskName, opts.env, opts.roundId).report);
          const reportExists = fs.existsSync(reportAbs);
          if (!reportExists) {
            controller.enqueue(`data: ${JSON.stringify({ type: 'error', data: '测试报告文档未生成（AI 未写出 .md），请点「重跑」重试。' })}\n\n`);
          }
          let reportRunHash: string | null = null;
          try {
            reportRunHash = sha1Hex(
              fs.readFileSync(path.join(opts.projectPath, artifactPaths(opts.taskName, opts.env, opts.roundId).runJson), 'utf-8'),
            );
          } catch {
            /* run.json 缺失 → runHash 缺省（统计聚合按时序回填兜底），也不排脚本后台任务 */
          }
          // 使用统计：报告真的写出来了、且流干净收尾才记 report_generated + step_completed。
          // runHash 读 run.json 内容重算（与执行步 sha1(runContent) 同源同值）。
          const stats = opts.stats;
          if (stats && reportExists && !sawError && !stats.aborted()) {
            recordStatsEvents([
              {
                eventType: 'report_generated',
                projectPath: opts.projectPath,
                taskId: stats.taskId,
                taskName: opts.taskName,
                env: opts.env,
                payload: { env: opts.env, runHash: reportRunHash, model: stats.model ?? null },
              },
              buildStepCompleted({
                taskId: stats.taskId,
                projectPath: opts.projectPath,
                taskName: opts.taskName,
                env: opts.env,
                step: 'report',
                stepStartMs: stats.stepStartMs,
                model: stats.model,
                providerId: stats.providerId,
              }),
            ]);
            controller.enqueue(stepStatsFrame('report', stats));
          }
          // 报告成功后只等待 queued manifest 落盘，不等待后台生成；软失败不改变报告 done。
          if (reportExists && !sawError && !opts.aborted?.() && reportRunHash) {
            try {
              await enqueueScriptJob({
                projectPath: opts.projectPath,
                taskName: opts.taskName,
                env: opts.env,
                runHash: reportRunHash,
                model: opts.model,
                providerId: opts.providerId,
                // 报告触发的自动生成默认接入「运行→失败自动修→再跑」流水线；
                // 被测应用不可达时 executeJob 内部会跳过运行、只停在生成态。
                runPipeline: true,
              });
            } catch {
              // 后台增强产物失败不得拖垮报告主流程
            }
          }
          controller.close();
          return;
        }
        controller.enqueue(value);
        // 观察 error 帧（SDK 报错后仍会发 done 帧，错误轮不得记成完成）
        frameBuf += value;
        const frames = frameBuf.split('\n\n');
        frameBuf = frames.pop() || '';
        for (const f of frames) {
          const line = f.replace(/^data:\s?/, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type?: string; data?: string };
            if (evt?.type === 'error') sawError = true;
            else if (evt?.type === 'result') {
              try {
                const r = JSON.parse(evt.data || '{}') as { is_error?: unknown };
                if (r?.is_error === true) sawError = true;
              } catch { /* native result 帧无 is_error → 非错误 */ }
            }
          } catch {
            /* ignore non-JSON frames */
          }
        }
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      reader.cancel(reason);
    },
  });
}

/**
 * 用例设计步收口:透传全部帧;流结束时把该任务【打了「回归测试」标签的用例】自动 upsert 进
 * 项目级回归用例库(需求:每个任务在「用例设计完成后」自动沉淀回归用例;详见
 * docs/exec-plans/active/regression-library.md)。
 *
 * best-effort:入库失败一律静默,绝不阻塞用例设计步本身完成(库是增强特性)。upsert by 来源
 * 任务(depositTask 内)保证重复跑/修订不产生重复。保留任务名 `回归用例库` 自身不入库(它是
 * 重跑聚合的产物、不是真实测试任务),避免库自我递归。
 */
export function wrapCasesStream(
  src: ReadableStream<string>,
  opts: { projectPath: string; taskName: string },
): ReadableStream<string> {
  const reader = src.getReader();
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          try {
            if (opts.taskName !== REGRESSION_LIBRARY_TASK) {
              const casesAbs = path.join(opts.projectPath, artifactPaths(opts.taskName).cases);
              const cases = readTaskCases(casesAbs);
              if (cases.length) {
                const r = depositTask(opts.projectPath, opts.taskName, cases);
                void appendAudit(opts.projectPath, opts.taskName, {
                  action: 'deposit-library',
                  mode: 'auto',
                  step: 'cases',
                  detail: `回归用例库自动入库:新增 ${r.added} 条、替换旧 ${r.removed} 条,库共 ${r.total} 条`,
                });
                controller.enqueue(`data: ${JSON.stringify({ type: 'library_updated', data: JSON.stringify(r) })}\n\n`);
              }
            }
          } catch {
            // 入库 best-effort:失败不影响用例设计步完成
          }
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      reader.cancel(reason);
    },
  });
}

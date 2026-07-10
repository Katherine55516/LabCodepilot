import fs from 'fs';
import path from 'path';
import { streamClaude } from '@/lib/claude-client';
import type { MCPServerConfig } from '@/types';
// Side-effect import: registers the agent runtimes (native + sdk) in the registry.
// streamClaude() resolves a runtime from this registry, so without this import the
// route fails with "No agent runtime registered" (the chat route gets it via its
// own `@/lib/runtime` import).
import { predictNativeRuntime } from '@/lib/runtime';
import { buildStep, buildPlaywrightMcp, willRunHeaded, artifactPaths, requirementOriginalPath, requirementImportedTextPath, TEST_STEPS, type TestStep } from '@/lib/test/prompts';
import { probeUrlWithRetry } from '@/lib/test/probe';
import { reduceFromText } from '@/lib/test/reduce';
import { snapshotRunJson, sha1Hex } from '@/lib/test/history';
import { sweepStrayEvidence, normalizeEvidenceExt } from '@/lib/test/evidence';
import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { createCaseTimer } from '@/lib/test/exec-timing';
import { buildStepCompleted, observeStream, recordCasesGenerated, recordStatsEvents } from '@/lib/test/stats-recorder';
import { appendAudit } from '@/lib/test/audit';
import { depositTask, readTaskCases, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import { readRoundSnapshot } from '@/lib/test/rounds';

// Reference the import so it isn't tree-shaken away (keeps the registration side-effect).
void predictNativeRuntime;

/**
 * 使用统计上下文（body 携带 taskId 时才构造；缺失 → 全部埋点跳过，宁缺毋错）。
 * abort/error 收尾的运行不记事件——错误轮不能被记成完成（口径见执行计划）。
 */
interface StepStats {
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
function stepStatsFrame(step: TestStep, stats: StepStats): string {
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
  opts: { projectPath: string; taskName: string; env: string; runStartMs: number; leadingFrame?: string; stats?: StepStats; roundId?: string },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  let sawError = false;
  // 逐用例计时：对 text 增量做行缓冲，▶ 行 → 下一条 @@RESULT 行的挂钟差（见 exec-timing.ts）
  const timer = createCaseTimer();
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
                  runHash: sha1Hex(runContent),
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
  opts: { projectPath: string; taskName: string; env: string; stats?: StepStats; roundId?: string },
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
          // 使用统计：报告真的写出来了、且流干净收尾才记 report_generated + step_completed。
          // runHash 读 run.json 内容重算（与执行步 sha1(runContent) 同源同值）。
          const stats = opts.stats;
          if (stats && reportExists && !sawError && !stats.aborted()) {
            let runHash: string | null = null;
            try {
              runHash = sha1Hex(
                fs.readFileSync(path.join(opts.projectPath, artifactPaths(opts.taskName, opts.env, opts.roundId).runJson), 'utf-8'),
              );
            } catch {
              /* run.json 缺失 → runHash 缺省，聚合按时序回填兜底 */
            }
            recordStatsEvents([
              {
                eventType: 'report_generated',
                projectPath: opts.projectPath,
                taskId: stats.taskId,
                taskName: opts.taskName,
                env: opts.env,
                payload: { env: opts.env, runHash, model: stats.model ?? null },
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

/**
 * AI 测试工作台 · 步骤执行路由（Phase 2 · 移植 ai-lab-test-framework 执行流程）。
 *
 * 单步执行：按 step 用框架的角色 system prompt + 规则跑一步，产物落到项目根
 * 的 AI_LabTest/ 下，下一步读上一步产物（顺序门控由前端按产物/状态控制）。
 * 4 步：requirement → cases → execution → report（框架 6 步裁掉代码分析 + 评审）。
 *
 * 刻意 ADDITIVE 且与聊天路径隔离：
 *  - 独立路由（不碰 /api/chat）
 *  - 合成 sessionId（不建 chat_sessions 行；streamClaudeSdk 不持久化它）
 *  - 直接调 streamClaude，不修改它
 *
 * 仅「测试执行」步注入 Playwright MCP（按运行注入，不进全局 MCP 配置），且其
 * SSE 流经 wrapExecutionStream 包装：服务端解析 @@RESULT → 确定性归约 → 落盘
 * run.json + 末尾补发 run_json 帧（见该函数）。
 * 证据采集收口（已接）：MCP 垫片 chdir 到证据目录（buildPlaywrightMcp）+ 运行后
 * sweepStrayEvidence 扫散落 + normalizeEvidenceExt 补后缀（见 wrapExecutionStream
 * done 分支）。canUseTool 改写截图路径未做（streamClaude 自管 canUseTool，不便注入；
 * --output-dir + 垫片 + 扫散落已覆盖）。chdir/扫散落的真实效果需真跑浏览器验证；
 * 纯 fs 逻辑（sweep/normalize/sniff）已单测覆盖。
 * 环境对接（已接）：执行步从 `{项目}/AI_LabTest/environments.json`（设置·测试账号
 * 导出）解析目标 baseUrl + 登录态（resolveProjectEnv），baseUrl 进执行 prompt、
 * storageState 经 --storage-state 注入 Playwright，让 AI 开跑即已登录。
 */

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = body.taskName || '测试任务';
    const rawStep: string = body.step;
    const step: TestStep = (TEST_STEPS as string[]).includes(rawStep) ? (rawStep as TestStep) : 'requirement';
    const envArg: string = body.env || 'local';
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;
    // 使用统计的任务身份（workbench 任务 UUID）。旧前端不带 → 跳过埋点（宁缺毋错，
    // taskName 仅项目内唯一、不能冒充 id）。
    const taskId: string | null =
      typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim().slice(0, 128) : null;
    // Free-text 追加指令 from the 测试对话 composer (additive; only affects this run's prompt).
    const extraInstruction: string | undefined =
      typeof body.extraInstruction === 'string' && body.extraInstruction.trim() ? body.extraInstruction : undefined;
    // 新建任务 imported this step's artifact → reuse the upload as authoritative source.
    const reuseImported: boolean = body.reuseImported === true;
    // 导入需求的来源模式（用户在需求分析节点选择后透传）+ 保留原文的扩展名，用于定位需求来源文件。
    const requirementMode: 'generate-md' | 'use-original' | undefined =
      body.requirementMode === 'generate-md' || body.requirementMode === 'use-original' ? body.requirementMode : undefined;
    const requirementOriginalExt: string | undefined =
      typeof body.requirementOriginalExt === 'string' && body.requirementOriginalExt.trim()
        ? body.requirementOriginalExt.trim() : undefined;
    // 执行方式(执行前确认弹窗):true=独立窗口可见运行(有头),false/缺省=后台无头运行。
    // 仅「测试执行」步注入 Playwright,故只对该步生效。
    const headed: boolean = body.headed === true;
    // 回归轮次号(v2):仅回归用例库的轮次化执行传入——执行/报告产物落 report/{task}/{roundId}/
    // 子目录,同环境多轮互不覆盖。普通任务禁止传(避免任意任务产物被改道)。
    const roundId: string | undefined =
      typeof body.roundId === 'string' && body.roundId.trim() ? body.roundId.trim() : undefined;

    if (!projectPath || typeof projectPath !== 'string') {
      return new Response(JSON.stringify({ error: 'projectPath is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // taskName composes the AI_LabTest/ artifact paths (artifactPaths) — reject a
    // traversal value so a run can't write/read outside the project.
    if (isUnsafeSegment(taskName)) {
      return new Response(JSON.stringify({ error: 'invalid taskName' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // roundId 同样进产物路径(report/{task}/{roundId}/) → 同 taskName 一样做段安全校验;
    // 且只允许保留任务名使用(轮次是回归用例库的概念)。
    if (roundId && (isUnsafeSegment(roundId) || taskName !== REGRESSION_LIBRARY_TASK)) {
      return new Response(JSON.stringify({ error: 'invalid roundId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Resolve the target env from the project's exported environments.json
    // (configured in 设置·测试账号). That file is the source of truth for the
    // execution baseUrl + captured login state; body.baseUrl is only a fallback.
    const resolved = resolveProjectEnvWithDb(projectPath, envArg);
    const env = resolved.env;
    // 执行前确认弹窗允许用户编辑「被测链接」(尤其 local 指向本机任意端口)。用户显式给出的
    // baseUrl 对本次运行有最高优先级;未给出则回落到 environments.json 解析出的目标。其它步
    // (需求/用例/报告)不传 baseUrl,仍走解析值,行为不变。
    const overrideUrl =
      typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : undefined;
    const baseUrl = overrideUrl || resolved.frontendBaseUrl || undefined;

    // 可达性闸门(仅执行步 + 给了 http/https 被测地址)：开跑前先探活，最多 3 次；连续 3 次
    // 仍不可达就直接拦下、不启动 AI —— 否则被测系统没起时 AI 会按规则 §0.3 反复 curl 探活、
    // 永不终止(用户反馈的「无限重试」缺陷)。返回非 2xx JSON{error}，前端(runStep 的 !res.ok
    // 分支)会渲染成错误气泡并把该步标失败，用户排查好被测系统后点「重跑」即可。未配置地址 /
    // 非 http(s) 地址不在此拦，仍交由 AI 按「地址不可达→blocked」处理，行为不变。
    if (step === 'execution' && baseUrl && /^https?:\/\//i.test(baseUrl)) {
      const gate = await probeUrlWithRetry(baseUrl, { attempts: 3, timeoutMs: 5000, delayMs: 800, signal: req.signal });
      if (!gate.reachable) {
        const reason = gate.last.error ? `（${gate.last.error}）` : '';
        const msg = `被测系统无法访问：已连续尝试 ${gate.attempts} 次仍无法连接 ${baseUrl}${reason}。请检查被测系统是否已正常启动、被测链接是否正确，确认可访问后再点「重跑」重试。`;
        return new Response(JSON.stringify({ error: msg }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 登录态提示(执行步)：本项目该环境是否已捕获 storageState。未配置 → 执行 prompt 提醒 AI
    // 「遇登录墙判 blocked 并引导用户去设置·测试账号配置」，而非(非交互运行里)用 AskUserQuestion
    // 向用户要凭证——那会卡死(用户反馈的「询问弹不出来」缺陷)。
    const hasLoginState = !!resolved.storageStatePath;
    // 密码方式自动登录（问题修复：配了「密码」账号却在被测登录页无法自动填充）：本项目该环境
    // 配的是「密码」账号(有用户名+密码)、且没有已捕获的 storageState 时，把凭据下发给执行智能体，
    // 让它在登录页 browser_fill_form/browser_type 填入并提交(替代旧的「遇登录墙一律 blocked」)。
    // storageState 更稳、优先：capture 抓过就走登录态注入，不再重复自动登录(hasLoginState 分支)。
    const cred = resolved.loginAccount;
    const loginCredentials =
      step === 'execution' && !hasLoginState && cred?.authType === 'password' && cred.username && cred.password
        ? { username: cred.username, password: cred.password }
        : undefined;
    // 需求来源文件（相对项目根）：requirement 步(生成 md)读保留原文/抽取文本、写 需求.md；
    // cases 步(直接用原文)直接读原文/抽取文本；其余(生成 md 的 cases / 旧任务无 ext)留空 → prompts 回退 需求.md。
    let requirementSourcePath: string | undefined;
    if (requirementOriginalExt) {
      const origSource = requirementOriginalExt === 'docx'
        ? requirementImportedTextPath(taskName)
        : requirementOriginalPath(taskName, requirementOriginalExt);
      if (step === 'requirement' && requirementMode === 'generate-md') requirementSourcePath = origSource;
      else if (step === 'cases' && requirementMode === 'use-original') requirementSourcePath = origSource;
    }
    const { systemPrompt, prompt, needsPlaywright } = buildStep(step, { taskName, env, baseUrl, extraInstruction, reuseImported, requirementMode, requirementSourcePath, hasLoginState, loginCredentials, roundId });

    let mcpServers: Record<string, MCPServerConfig> | undefined;
    if (needsPlaywright) {
      const evidenceDir = artifactPaths(taskName, env, roundId).evidenceDir;
      // Pass the captured storageState so the AI starts logged in (set up in 设置·测试账号).
      // headed: 用户在执行前确认弹窗选了「独立窗口可见运行」→ 弹出可见浏览器窗口(打包态走系统 Chrome)。
      mcpServers = { playwright: buildPlaywrightMcp(projectPath, evidenceDir, resolved.storageStatePath, { headed }) };
    }

    // Wire client disconnect (panel 停止按钮 aborts the fetch) → abort the agent
    // run so backend AI generation actually stops, not just the client read.
    // Same pattern as /api/chat (route.ts): request.signal → AbortController.
    const abortController = new AbortController();
    req.signal.addEventListener('abort', () => abortController.abort());

    const runStartMs = Date.now();
    const stream = streamClaude({
      prompt,
      // Synthetic id — used only as a label; streamClaudeSdk does not persist it.
      sessionId: `test-${step}-${taskName}`,
      systemPrompt,
      workingDirectory: projectPath,
      model,
      providerId,
      mcpServers,
      abortController,
      // Headless run: no user to approve permission prompts. Writes are constrained
      // by the system prompt to AI_LabTest/; the hard canUseTool whitelist is a
      // later hardening step.
      bypassPermissions: true,
      autoTrigger: true,
    });

    // 有头请求但本机定位不到完整浏览器(打包态随包仅无头 shell + 没装 Chrome)→ buildPlaywrightMcp
    // 已自动回落无头;这里据同一判定补发一条提示帧,让用户知道本次未弹可见窗口、为什么。
    const headedDowngraded = step === 'execution' && headed && !willRunHeaded(headed);
    const leadingFrame = headedDowngraded
      ? `data: ${JSON.stringify({ type: 'exec_notice', data: 'headed_downgraded_no_chrome' })}\n\n`
      : undefined;

    // 使用统计上下文（缺 taskId 则为 undefined → 所有埋点跳过）
    const stats: StepStats | undefined = taskId
      ? { taskId, model, providerId, stepStartMs: runStartMs, aborted: () => abortController.signal.aborted }
      : undefined;

    // Execution step: wrap to sweep evidence + reduce/persist run.json + emit run_json.
    // Report step: wrap to verify the .md was actually written (else emit error → 失败).
    // Requirement/cases steps: 仅观测包装（step_completed / cases_generated 埋点），
    // 不改变任何对客户端可见的行为；无 taskId 时保持原样直通。
    const finalStream =
      step === 'execution'
        ? wrapExecutionStream(stream, { projectPath, taskName, env, runStartMs, leadingFrame, stats, roundId })
        : step === 'report'
          ? wrapReportStream(stream, { projectPath, taskName, env, stats, roundId })
          : stats
            ? observeStream(
                step === 'cases' ? wrapCasesStream(stream, { projectPath, taskName }) : stream,
                {
                  aborted: stats.aborted,
                  cleanDoneFrame: () => stepStatsFrame(step, stats),
                  onCleanDone: () => {
                    recordStatsEvents([
                      buildStepCompleted({
                        taskId: stats.taskId,
                        projectPath,
                        taskName,
                        env,
                        step,
                        stepStartMs: stats.stepStartMs,
                        model,
                        providerId,
                      }),
                    ]);
                    if (step === 'cases') {
                      recordCasesGenerated({ taskId: stats.taskId, projectPath, taskName, sinceMs: stats.stepStartMs, model });
                    }
                  },
                }
              )
            : step === 'cases'
              ? wrapCasesStream(stream, { projectPath, taskName })
            : stream;

    return new Response(finalStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

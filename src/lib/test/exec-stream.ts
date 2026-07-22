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
import { readRoundSnapshot, createRoundKeeper, type RoundKeeper } from '@/lib/test/rounds';
import { ScriptTraceCollector, writeTraceFile, type TraceRedaction } from '@/lib/test/script-trace';
import { enqueueIncrementalScriptCase, enqueueScriptJob, type IncrementalScriptCaseRequest } from '@/lib/test/script-job-manager';
import { harvestMarkerObjects } from '@/lib/test/markers';
import { createCaseIdResolver, remapCaseKeys } from '@/lib/test/case-id';

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

export interface IncrementalScriptFeeder {
  /** 喂入一段 text 增量(行缓冲;@@RESULT 可能被 SSE 切分到多帧)。 */
  feedText(chunk: string): void;
  /** 流结束:冲刷可能没有换行结尾的尾行。 */
  finish(): void;
}

/**
 * 执行流里逐条捕获「pass 的回归用例」并入队生成脚本。
 *
 * 时序保证:@@RESULT 是该用例的最后一行输出,此时它的工具调用都已回执,`drainCase` 拿到的
 * 就是完整轨迹。
 *
 * 刻意的过滤(每条都有由头):
 *   - 只认 pass:失败/阻塞的用例不该沉淀成回归脚本(与 selectEligibleCases 同口径);
 *   - 只认带「回归测试」标签的:同上;
 *   - 跳过 `via === 'script'`:这条判定本就来自已沉淀脚本的重放,没有 MCP 轨迹(指纹必然
 *     漂移),重生成 = 每轮 churn 一遍(executeJob 里已有同款短路);
 *   - 同 id 只入队一次:模型违规重复输出 @@RESULT 时不重复烧模型。
 *
 * 全程 best-effort:cases.json 读不到/解析不了 → 整个特性静默关闭,绝不影响执行流。
 */
export function createIncrementalScriptFeeder(opts: {
  projectPath: string;
  taskName: string;
  env: string;
  roundId?: string;
  model?: string;
  providerId?: string;
  runStartMs: number;
  trace: ScriptTraceCollector;
  /** 注入点(单测用):默认打到真实队列。 */
  enqueue?: (request: IncrementalScriptCaseRequest) => void;
}): IncrementalScriptFeeder {
  const enqueue = opts.enqueue ?? enqueueIncrementalScriptCase;
  const caseById = new Map<string, Record<string, unknown>>();
  let resolveCaseId: (id: string) => string = (id) => id;
  try {
    // 执行【开始】就读:执行期间用例文件若被改动,以开跑时的版本为准(与本轮判定同源)。
    const casesAbs = path.join(opts.projectPath, artifactPaths(opts.taskName).cases);
    const parsed = JSON.parse(fs.readFileSync(casesAbs, 'utf-8')) as unknown;
    const list = Array.isArray((parsed as { cases?: unknown })?.cases)
      ? (parsed as { cases: Array<Record<string, unknown>> }).cases
      : Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
    const allIds: string[] = [];
    for (const c of list) {
      if (!c || typeof c.id !== 'string') continue;
      allIds.push(c.id);
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (tags.some((t) => t === '回归测试')) caseById.set(c.id, c);
    }
    // 解析器喂【全量】id 而非只喂回归子集:歧义保护要看得见所有用例,否则一条非回归用例的
    // id 可能规范化后撞上某条回归用例、被误认成它。见 case-id.ts。
    if (allIds.length) resolveCaseId = createCaseIdResolver(allIds);
  } catch {
    // 没有用例文件(或坏 JSON)→ caseById 空 → 本特性自动静默,执行照常。
  }

  let lineBuf = '';
  const seen = new Set<string>();
  const onLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.includes('@@RESULT')) return;
    // 与 reduce.harvestResults / exec-timing 共用 markers.ts 的唯一解析器 —— 三处宽严必须
    // 完全一致,否则带 markdown 装饰的行会一边采到、一边漏掉(见 markers.ts 模块头的事故)。
    const [parsed] = harvestMarkerObjects<{ id?: unknown; status?: unknown; via?: unknown }>(line, 'RESULT');
    if (!parsed || typeof parsed.id !== 'string') return;
    const emitted = parsed.id.trim();
    if (!emitted) return;
    if (String(parsed.status ?? '').toLowerCase() !== 'pass') return;
    if (parsed.via === 'script') return;
    // 回贴成 cases.json 的权威 id 再查:模型把弯引号抄成直引号就查不到 caseBody、整条用例
    // 静默不入队(与 reduce 同一个 bug 的另一张脸)。轨迹侧仍按【模型写的】id 取——
    // @@CASE_START 与 @@RESULT 出自同一次输出,漂移一致。
    const id = resolveCaseId(emitted);
    if (seen.has(id)) return;
    const caseBody = caseById.get(id);
    if (!caseBody) return;
    seen.add(id);
    try {
      enqueue({
        projectPath: opts.projectPath,
        taskName: opts.taskName,
        env: opts.env,
        roundId: opts.roundId,
        model: opts.model,
        providerId: opts.providerId,
        runStartMs: opts.runStartMs,
        caseBody,
        result: { id, status: 'pass', actual: '', error: '', evidence: [] },
        // 取用【模型写的】id(轨迹收集器的键),但带出去的动作要挂权威 id ——
        // 下游 selectEligibleCases 按 action.caseId === 用例 id 过滤,不改就是 0 条动作。
        traceActions: opts.trace.drainCase(emitted).map((a) => ({ ...a, caseId: id })),
        observedElements: opts.trace.elementsForCase(emitted),
      });
    } catch {
      // 入队失败不得拖累执行流
    }
  };

  return {
    feedText(chunk) {
      lineBuf += chunk;
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() || '';
      for (const l of lines) onLine(l);
    },
    finish() {
      if (lineBuf) onLine(lineBuf);
      lineBuf = '';
    },
  };
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
    model?: string;
    providerId?: string;
    stats?: StepStats;
    roundId?: string;
    traceRedactions?: TraceRedaction[];
    /**
     * 后台脚本沉淀(逐条增量生成 + 收口对账入队)。默认开启。
     *
     * 两个来源:
     *  1. **任务级开关**(新建任务时选定、任务页可改)—— 不是所有任务都需要沉淀回归脚本,
     *     关掉可省下每条用例约两分钟的生成与真机重放开销;
     *  2. **单测**必须传 false:带「回归测试」标签的 pass 用例会触发真实模型调用,让流包装器
     *     的单测变成网络依赖,失败后还要走退避重试、把全局单并发队列堵十几秒。沉淀本身另有
     *     专项单测(script-incremental.test.ts,注入假队列)。
     *
     * 缺省 true:存量任务与旧客户端不传该字段,行为必须不变,故判定一律写 `!== false`。
     */
    depositScripts?: boolean;
  },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  let sawError = false;
  // 逐用例计时：对 text 增量做行缓冲，▶ 行 → 下一条 @@RESULT 行的挂钟差（见 exec-timing.ts）
  const timer = createCaseTimer();
  // projectPath 是必须的:真机里快照多以【项目相对路径的文件链接】形态出现(MCP 配了
  // --output-dir),不给根就一个元素都收不到(2026-07-17 真机实测的初版失效原因)。
  const traceCollector = new ScriptTraceCollector(opts.runStartMs, opts.traceRedactions ?? [], opts.projectPath);
  const deposit = opts.depositScripts !== false;
  // 逐条增量沉淀:一条回归用例 pass 就立刻生成它的脚本,不等报告。治「断流全丢」——生成原本
  // 由报告成功门控,执行被网络掐断 → 报告不跑 → 已通过用例的脚本一条都不沉淀。
  const incremental = createIncrementalScriptFeeder({
    projectPath: opts.projectPath,
    taskName: opts.taskName,
    env: opts.env,
    roundId: opts.roundId,
    model: opts.model,
    providerId: opts.providerId,
    runStartMs: opts.runStartMs,
    trace: traceCollector,
    ...(deposit ? {} : { enqueue: () => {} }),
  });
  // 轮次守护(仅回归轮次有 roundId,普通任务零影响):收口所有权在服务端 + 心跳活性。
  // 真机事故:轮次收口原本只由前端流消费完后 PATCH——执行中途页面刷新,settle 永远不会
  // 到达,轮次卡「执行中」直到 2h 惰性兜底。现在流的 done/cancel/error 三条路径都由
  // 服务端直接收口;进程本身被杀则由心跳陈旧让读侧判孤儿(见 rounds.ts 三层设计)。
  const round: RoundKeeper | null = opts.roundId
    ? createRoundKeeper(opts.projectPath, opts.roundId)
    : null;
  return new ReadableStream<string>({
    start(controller) {
      // 有头被自动回落无头时,先补发一条提示帧让用户在对话里看到「已改无头」(见 POST 内)。
      if (opts.leadingFrame) controller.enqueue(opts.leadingFrame);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // 冲刷尾行:最后一条 @@RESULT 可能没有换行结尾,不冲就永远漏掉最后一条用例。
          incremental.finish();
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
          // caseIds 缺席（无 cases.json / 解析失败）时退化为恒等，行为与修复前一致。
          const resolveCaseId = caseIds?.length ? createCaseIdResolver(caseIds) : (id: string) => id;
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
          // 耗时表/轨迹的键都取自模型回写的 id，reduce 已把 tests[].id 回贴成 cases.json 的
          // 权威写法（见 case-id.ts）——两侧得走同一把解析器，否则模型一拉直引号，时长与轨迹
          // 就静默挂空：报告不显示耗时、脚本生成拿到 0 条动作。
          const durations = remapCaseKeys(timer.finish(Date.now()), resolveCaseId);
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
            // 落盘前把轨迹的 caseId 也回贴到权威 id：轨迹是脚本生成的输入，
            // selectEligibleCases 用 cases.json 的 id 去 filter(action.caseId === id)，
            // 存模型的变体等于让每条用例都匹配到 0 条动作。
            writeTraceFile(
              opts.projectPath, opts.taskName, opts.env, runHash,
              traceCollector.finish().map((a) => ({ ...a, caseId: resolveCaseId(a.caseId) })),
              remapCaseKeys(traceCollector.finishElements(), resolveCaseId),
            );
          } catch {
            // trace 是脚本生成增强产物；失败不得改变执行结果
          }
          // 轮次收口(层①):执行流走到头 = 轮次终态定了,服务端直接写,不等前端 PATCH。
          // 语义与前端现状一致——settle('done') 本就只看执行流是否消费完(report 步返回值
          // 被忽略),error 帧不改变收口事实(counts 里的 blocked/fail 才是结论)。用户主动
          // 中止(stats.aborted)是唯一例外:半截轮按 aborted 收。
          if (round) {
            if (opts.stats?.aborted?.()) round.settleAborted();
            else round.settleDone({ counts: { ...reduced.counts }, suitePassStr: reduced.suitePassStr });
          }
          // 执行收口即入队整轮生成任务(不再只由报告触发):run.json + trace 都已落盘,输入齐了。
          // 作用是【对账】——增量已把 pass 用例生成完,这里走指纹复用(零模型消耗)补上
          // stale 标记与 counts,并接自动跑通流水线统一补跑延后的重放。
          // 报告流那次入队保持不变:同 runHash 会被 enqueueScriptJob 现有去重短路,健康轮次
          // 行为等价;用户只跑执行不跑报告时,脚本也不再悬空。
          // 用户主动中止的轮次不入队(半截产物不该触发后台生成);网络掐断(sawError)则【照常】
          // 入队 —— 那正是本改动要救的场景,已 pass 的用例应当收口沉淀。
          if (deposit && !opts.stats?.aborted?.()) {
            try {
              await enqueueScriptJob({
                projectPath: opts.projectPath,
                taskName: opts.taskName,
                env: opts.env,
                roundId: opts.roundId,
                runHash,
                model: opts.model,
                providerId: opts.providerId,
                runPipeline: true,
              });
            } catch {
              // 后台增强产物失败不得拖垮执行主流程
            }
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
              // 顺序要紧:先喂 trace(把该用例的轨迹/元素收全),再让 feeder 取用。
              incremental.feedText(evt.data || '');
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
        // 流内部报错(SDK 流 reject 等):run.json 没写成,轮次按中断收(层①的 error 路径)。
        round?.settleAborted();
        controller.error(e);
      }
    },
    cancel(reason) {
      // 客户端断开(刷新/关窗/停止):Next 调 cancel、pull 不再来,done 分支永远到不了。
      // 这正是「轮次卡执行中」事故的路径——在这里由服务端收口(层①的 cancel 路径)。
      round?.settleAborted();
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
    /**
     * 任务级「沉淀回归脚本」开关(缺省开)。关闭时报告成功也不入队生成任务 ——
     * 与 wrapExecutionStream 的同名参数一起构成该任务的完整关断。
     */
    depositScripts?: boolean;
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
          if (reportExists && !sawError && !opts.aborted?.() && reportRunHash && opts.depositScripts !== false) {
            try {
              await enqueueScriptJob({
                projectPath: opts.projectPath,
                taskName: opts.taskName,
                env: opts.env,
                // 回归轮次的 run.json 在 report/{task}/{roundId}/ 下,不传 roundId 会 ENOENT。
                roundId: opts.roundId,
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

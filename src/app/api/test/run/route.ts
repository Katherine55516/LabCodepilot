import { streamClaude } from '@/lib/claude-client';
import type { MCPServerConfig } from '@/types';
// Side-effect import: registers the agent runtimes (native + sdk) in the registry.
// streamClaude() resolves a runtime from this registry, so without this import the
// route fails with "No agent runtime registered" (the chat route gets it via its
// own `@/lib/runtime` import).
import { predictNativeRuntime } from '@/lib/runtime';
import { buildStep, buildPlaywrightMcp, willRunHeaded, artifactPaths, requirementOriginalPath, requirementImportedTextPath, TEST_STEPS, type TestStep } from '@/lib/test/prompts';
import { probeUrlWithRetry } from '@/lib/test/probe';
import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { buildStepCompleted, observeStream, recordCasesGenerated, recordStatsEvents } from '@/lib/test/stats-recorder';
import { REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import { readRoundSnapshot, finishRound } from '@/lib/test/rounds';
// 回归轮次 · 脚本重放优先(阶段 A):有合格沉淀脚本的用例由平台直接跑脚本产出判定,
// AI(阶段 B)只执行剩余——全覆盖时完全跳过智能体。见 script-regression.ts 模块头。
import {
  candidatesFromSnapshot,
  resolveReplayPlan,
  acquireReplayLocks,
  buildScriptPhaseStream,
  concatSseStreams,
  type ReplayPlanItem,
} from '@/lib/test/script-regression';
// SSE 流包装器（原先定义在本文件内）：Next.js 构建期路由类型校验只允许 route.ts 导出
// HTTP method handler，helper 导出会使 `next build` 失败，故抽至 lib（见 exec-stream.ts 模块头）。
import { wrapExecutionStream, wrapReportStream, wrapCasesStream, stepStatsFrame, type StepStats } from '@/lib/test/exec-stream';

// Reference the import so it isn't tree-shaken away (keeps the registration side-effect).
void predictNativeRuntime;

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
  // 层①补漏(见 rounds.ts 三层收口):执行步在建流【之前】早退失败(可达性闸门 503 /
  // 兜底 500)时,轮次已被 library/run 建为 running、keeper 尚未创建——若押前端 settle,
  // 客户端恰在此刻死亡就孤儿。在 try 内 roundId 就位后赋值,两处失败出口调用。
  let settleRoundOnFailure: () => void = () => {};
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
    // 回归执行「优先脚本重放」开关(发起弹窗透传;缺省开)。false = 全部走 AI(排障/对照用)。
    const scriptFirst: boolean = body.scriptFirst !== false;
    // 任务级「沉淀回归脚本」开关。缺省 true —— 存量任务与旧客户端不传该字段,行为必须不变。
    const depositScripts: boolean = body.depositScripts !== false;

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
    if (step === 'execution' && roundId && projectPath && typeof projectPath === 'string') {
      const p = projectPath;
      const rid = roundId;
      settleRoundOnFailure = () => {
        try { finishRound(p, rid, { status: 'aborted', ifRunning: true }); } catch { /* 读侧心跳兜底 */ }
      };
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
        // 轮次执行被闸门拦下 = 本轮没跑起来,服务端直接按中断收口(不押前端 settle 到达)。
        settleRoundOnFailure();
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
    // ── 回归轮次 · 脚本重放优先(阶段 A)规划 ──────────────────────────────
    // 仅 回归用例库+roundId+开关开 时生效:按当轮快照判定哪些用例有合格脚本(资格五道闸,
    // 见 resolveReplayPlan),并按 manifest 归属拿 .generation.lock(锁忙 → 该组降级走 AI)。
    // 锁的释放归 buildScriptPhaseStream 收尾(流关闭/取消/异常均触发,幂等)。
    let replay: { items: ReplayPlanItem[]; release: () => void; totalCases: number } | null = null;
    if (step === 'execution' && taskName === REGRESSION_LIBRARY_TASK && roundId && scriptFirst) {
      try {
        const snapshot = readRoundSnapshot(projectPath, roundId);
        if (snapshot && Array.isArray(snapshot.cases) && snapshot.cases.length) {
          const plan = resolveReplayPlan(projectPath, env, candidatesFromSnapshot(snapshot));
          if (plan.eligible.length) {
            const locks = acquireReplayLocks(projectPath, env, plan.eligible);
            if (locks.locked.length) {
              replay = { items: locks.locked, release: locks.release, totalCases: snapshot.cases.length };
            } else {
              locks.release();
            }
          }
        }
      } catch (e) {
        // 规划失败不阻塞轮次:回退全 AI 执行(行为与关闭开关一致)。
        console.warn('[script-replay] 重放规划失败,本轮全部走 AI:', e);
        replay = null;
      }
    }

    const { systemPrompt, prompt, needsPlaywright } = buildStep(step, {
      taskName, env, baseUrl, extraInstruction, reuseImported, requirementMode, requirementSourcePath, hasLoginState, loginCredentials, roundId,
      scriptDone: replay ? { ids: replay.items.map((i) => i.runId), total: replay.totalCases } : undefined,
    });

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
    // AI 智能体流改为【惰性】工厂:脚本重放阶段存在时,等阶段 A 跑完才创建(避免脚本与
    // AI 并发操作同一被测系统);全部用例被脚本覆盖时根本不创建(整轮零模型消耗)。
    const makeAgentStream = () => streamClaude({
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
    let stream: ReadableStream<string>;
    if (replay && roundId) {
      const remaining = replay.totalCases - replay.items.length;
      const phaseStream = buildScriptPhaseStream({
        projectPath,
        env,
        roundId,
        items: replay.items,
        totalCases: replay.totalCases,
        abortSignal: abortController.signal,
        closingNote: remaining <= 0 ? '✅ 本轮全部用例已由脚本重放完成，未启动 AI 执行。' : undefined,
        release: replay.release,
      });
      // 剩余用例 >0 → 阶段 A 后惰性接 AI;=0 → 只有阶段 A(归约器在流末照常落 run.json)。
      stream = remaining > 0 ? concatSseStreams(phaseStream, makeAgentStream) : phaseStream;
    } else {
      stream = makeAgentStream();
    }

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
        ? wrapExecutionStream(stream, {
            projectPath,
            taskName,
            env,
            runStartMs,
            leadingFrame,
            // 逐条增量生成 + 收口入队都要用它调模型(stats 只在带 taskId 时才有,不能依赖)。
            model,
            providerId,
            depositScripts,
            stats,
            roundId,
            traceRedactions: [
              { value: projectPath, replacement: '${PROJECT_ROOT}' },
              { value: baseUrl, replacement: '${BASE_URL}' },
              { value: resolved.storageStatePath, replacement: '${STORAGE_STATE}' },
              { value: resolved.loginAccount?.username, replacement: '${TEST_USERNAME}' },
              { value: resolved.loginAccount?.password, replacement: '${TEST_PASSWORD}' },
            ],
          })
        : step === 'report'
          ? wrapReportStream(stream, {
              projectPath,
              taskName,
              env,
              model,
              providerId,
              aborted: () => abortController.signal.aborted,
              stats,
              roundId,
              depositScripts,
            })
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
    // 建流之前抛错(建流之后 keeper 已接管;重复 settle 有 ifRunning 幂等保护,无害)。
    settleRoundOnFailure();
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

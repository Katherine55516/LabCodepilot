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
import { snapshotRunJson } from '@/lib/test/history';
import { sweepStrayEvidence, normalizeEvidenceExt } from '@/lib/test/evidence';
import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';
import { isUnsafeSegment } from '@/lib/test/path-safety';

// Reference the import so it isn't tree-shaken away (keeps the registration side-effect).
void predictNativeRuntime;

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
  opts: { projectPath: string; taskName: string; env: string; runStartMs: number; leadingFrame?: string },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  return new ReadableStream<string>({
    start(controller) {
      // 有头被自动回落无头时,先补发一条提示帧让用户在对话里看到「已改无头」(见 POST 内)。
      if (opts.leadingFrame) controller.enqueue(opts.leadingFrame);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const paths = artifactPaths(opts.taskName, opts.env);
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
          try {
            const casesAbs = path.join(opts.projectPath, artifactPaths(opts.taskName).cases);
            const parsed = JSON.parse(await fs.promises.readFile(casesAbs, 'utf-8')) as unknown;
            // cases.json 可能是 { cases: [...] } 或顶层数组 [...]（与 report-xlsx 同口径兼容）。
            const list = Array.isArray((parsed as { cases?: unknown })?.cases)
              ? (parsed as { cases: Array<{ id?: unknown; verification?: unknown }> }).cases
              : Array.isArray(parsed)
                ? (parsed as Array<{ id?: unknown; verification?: unknown }>)
                : [];
            const map: Record<string, string> = {};
            const ids: string[] = [];
            for (const c of list) {
              if (c && typeof c.id === 'string') {
                ids.push(c.id);
                if (typeof c.verification === 'string') map[c.id] = c.verification;
              }
            }
            if (Object.keys(map).length) verificationById = map;
            // 用例全集 id（按 cases.json 顺序）→ 交给 reduce 兜底补全漏执行的用例（问题②修复：
            // 报告以用例全集为准，AI 漏跑的用例补成「未执行」blocked，而非静默丢失）。
            if (ids.length) caseIds = ids;
          } catch {
            // no cases / parse fail → reduce falls back to single-rate + 不补全
          }
          const reduced = reduceFromText(textAcc, {
            module: opts.taskName,
            env: opts.env,
            time: new Date().toISOString(),
            verificationById,
            caseIds,
          });
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
            if (evt?.type === 'text') textAcc += evt.data || '';
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
  opts: { projectPath: string; taskName: string; env: string },
): ReadableStream<string> {
  const reader = src.getReader();
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const reportAbs = path.join(opts.projectPath, artifactPaths(opts.taskName, opts.env).report);
          if (!fs.existsSync(reportAbs)) {
            controller.enqueue(`data: ${JSON.stringify({ type: 'error', data: '测试报告文档未生成（AI 未写出 .md），请点「重跑」重试。' })}\n\n`);
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
    const { systemPrompt, prompt, needsPlaywright } = buildStep(step, { taskName, env, baseUrl, extraInstruction, reuseImported, requirementMode, requirementSourcePath, hasLoginState });

    let mcpServers: Record<string, MCPServerConfig> | undefined;
    if (needsPlaywright) {
      const evidenceDir = artifactPaths(taskName, env).evidenceDir;
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

    // Execution step: wrap to sweep evidence + reduce/persist run.json + emit run_json.
    // Report step: wrap to verify the .md was actually written (else emit error → 失败).
    const finalStream =
      step === 'execution'
        ? wrapExecutionStream(stream, { projectPath, taskName, env, runStartMs, leadingFrame })
        : step === 'report'
          ? wrapReportStream(stream, { projectPath, taskName, env })
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

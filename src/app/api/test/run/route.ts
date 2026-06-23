import fs from 'fs';
import path from 'path';
import { streamClaude } from '@/lib/claude-client';
import type { MCPServerConfig } from '@/types';
// Side-effect import: registers the agent runtimes (native + sdk) in the registry.
// streamClaude() resolves a runtime from this registry, so without this import the
// route fails with "No agent runtime registered" (the chat route gets it via its
// own `@/lib/runtime` import).
import { predictNativeRuntime } from '@/lib/runtime';
import { buildStep, buildPlaywrightMcp, artifactPaths, TEST_STEPS, type TestStep } from '@/lib/test/prompts';
import { reduceFromText } from '@/lib/test/reduce';
import { sweepStrayEvidence, normalizeEvidenceExt } from '@/lib/test/evidence';
import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';

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
function wrapExecutionStream(
  src: ReadableStream<string>,
  opts: { projectPath: string; taskName: string; env: string; runStartMs: number },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  return new ReadableStream<string>({
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
          const reduced = reduceFromText(textAcc, {
            module: opts.taskName,
            env: opts.env,
            time: new Date().toISOString(),
          });
          try {
            const runAbs = path.join(opts.projectPath, paths.runJson);
            await fs.promises.mkdir(path.dirname(runAbs), { recursive: true });
            await fs.promises.writeFile(runAbs, JSON.stringify(reduced, null, 2), 'utf-8');
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

    if (!projectPath || typeof projectPath !== 'string') {
      return new Response(JSON.stringify({ error: 'projectPath is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Resolve the target env from the project's exported environments.json
    // (configured in 设置·测试账号). That file is the source of truth for the
    // execution baseUrl + captured login state; body.baseUrl is only a fallback.
    const resolved = resolveProjectEnvWithDb(projectPath, envArg);
    const env = resolved.env;
    const baseUrl = resolved.frontendBaseUrl || (typeof body.baseUrl === 'string' ? body.baseUrl : undefined);

    const { systemPrompt, prompt, needsPlaywright } = buildStep(step, { taskName, env, baseUrl, extraInstruction, reuseImported });

    let mcpServers: Record<string, MCPServerConfig> | undefined;
    if (needsPlaywright) {
      const evidenceDir = artifactPaths(taskName, env).evidenceDir;
      // Pass the captured storageState so the AI starts logged in (set up in 设置·测试账号).
      mcpServers = { playwright: buildPlaywrightMcp(projectPath, evidenceDir, resolved.storageStatePath) };
    }

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
      // Headless run: no user to approve permission prompts. Writes are constrained
      // by the system prompt to AI_LabTest/; the hard canUseTool whitelist is a
      // later hardening step.
      bypassPermissions: true,
      autoTrigger: true,
    });

    // Execution step: wrap to sweep evidence + reduce/persist run.json + emit run_json.
    const finalStream =
      step === 'execution'
        ? wrapExecutionStream(stream, { projectPath, taskName, env, runStartMs })
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

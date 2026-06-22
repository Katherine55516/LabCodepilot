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
  opts: { projectPath: string; taskName: string; env: string },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const reduced = reduceFromText(textAcc, {
            module: opts.taskName,
            env: opts.env,
            time: new Date().toISOString(),
          });
          try {
            const runRel = artifactPaths(opts.taskName, opts.env).runJson;
            const runAbs = path.join(opts.projectPath, runRel);
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
 * 说明：执行步的证据采集收口（MCP 垫片 / canUseTool 改写 / 扫散落）+ 环境账号
 * 配置为下一轮硬化项（需真跑浏览器验证）。
 */

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = body.taskName || '测试任务';
    const rawStep: string = body.step;
    const step: TestStep = (TEST_STEPS as string[]).includes(rawStep) ? (rawStep as TestStep) : 'requirement';
    const env: string = body.env || 'local';
    const baseUrl: string | undefined = body.baseUrl;
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;

    if (!projectPath || typeof projectPath !== 'string') {
      return new Response(JSON.stringify({ error: 'projectPath is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { systemPrompt, prompt, needsPlaywright } = buildStep(step, { taskName, env, baseUrl });

    let mcpServers: Record<string, MCPServerConfig> | undefined;
    if (needsPlaywright) {
      const evidenceDir = artifactPaths(taskName, env).evidenceDir;
      mcpServers = { playwright: buildPlaywrightMcp(projectPath, evidenceDir) };
    }

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

    // Execution step: wrap to reduce + persist run.json + emit the run_json frame.
    const finalStream =
      step === 'execution' ? wrapExecutionStream(stream, { projectPath, taskName, env }) : stream;

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

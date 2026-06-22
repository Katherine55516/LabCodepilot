import path from 'path';
import { streamClaude } from '@/lib/claude-client';
import type { MCPServerConfig } from '@/types';
// Side-effect import: registers the agent runtimes (native + sdk) in the registry.
// streamClaude() resolves a runtime from this registry, so without this import the
// route fails with "No agent runtime registered" (the chat route gets it via its
// own `@/lib/runtime` import).
import { predictNativeRuntime } from '@/lib/runtime';

// Reference the import so it isn't tree-shaken away (keeps the registration side-effect).
void predictNativeRuntime;

const EXECUTION_SYSTEM_PROMPT = `你是 QA 自动化测试平台的"测试执行工程师"。你通过 Playwright MCP 的浏览器工具（browser_navigate / browser_snapshot / browser_click / browser_type / browser_take_screenshot 等）在被测系统中实操执行测试用例。

铁律：
1. 只在被测系统 UI 内操作；**绝不修改任何业务源码与配置**；只允许写入项目根目录下的 AI_LabTest/。
2. 严格对照用例「预期结果」判定四态：pass / fail / partial / blocked。环境/连接类错误归 blocked（非应用 bug）。
3. 每条用例先打印进度 \`▶ 用例 N/总数：{标题}\`，结束输出单行 JSON：\`@@RESULT {"id":"...","status":"pass|fail|partial|blocked","actual":"...","evidence":["TC-*.png"],"error":""}\`。`;

/**
 * Build the Playwright MCP server config injected ONLY for the execution step.
 * Mirrors the framework's runner.js launch flags. Per-run injection —普通对话
 * 不会看到它（不进全局 MCP 配置）。
 */
function buildPlaywrightMcp(projectPath: string): MCPServerConfig {
  const cli = path.join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js');
  const evidenceDir = path.join(projectPath, 'AI_LabTest', 'report', '_evidence');
  return {
    type: 'stdio',
    command: process.execPath,
    args: [
      cli,
      '--browser', 'chromium',
      '--headless',
      '--isolated',
      '--caps', 'devtools,network',
      '--output-dir', evidenceDir,
      '--viewport-size', '1280,800',
    ],
    // Packaged build will additionally need ELECTRON_RUN_AS_NODE=1 (handled later).
  };
}

/**
 * Phase 2.0 POC — programmatic test-step runner.
 *
 * Runs ONE test step (currently: requirement analysis) by calling the shared
 * `streamClaude()` with a custom system prompt + the project's working directory,
 * and streams the agent's SSE frames straight back to the inline testing panel.
 *
 * Deliberately ADDITIVE and isolated from the chat path:
 *  - separate route (does NOT touch /api/chat)
 *  - synthetic sessionId (no chat_sessions row; streamClaudeSdk doesn't persist)
 *  - calls streamClaude WITHOUT modifying it
 *
 * POC scope: no Playwright, no hard write-whitelist yet (the system prompt
 * constrains writes to AI_LabTest/; bypassPermissions is used so the headless run
 * isn't blocked by permission prompts). The hard canUseTool whitelist + the other
 * steps land in later Phase 2 sub-steps.
 */

const REQUIREMENT_SYSTEM_PROMPT = `你是 QA 自动化测试平台的"需求分析师"。你的任务：分析当前项目，产出一份**可测试的需求清单**。

铁律：
1. 只读业务源码用于理解；**只允许写入项目根目录下的 AI_LabTest/ 目录**，绝不修改任何业务源码、配置或其它文件。
2. 不执行构建、不运行项目、不安装依赖。

工作方式（三级回退）：
- L1：若用户已提供需求文档（在 prompt 中或 docs/），以其为准。
- L2：扫描项目内可能的需求来源（docs/、requirements/、README* 等）。
- L3：以上都没有时，从代码逆向推断（路由、表单、错误处理、数据模型）。

输出：写入 \`AI_LabTest/requirements/{模块}-requirement.md\`，每条需求标注来源（USER / PROJECT_DOC:{path} / REVERSE_ENGINEERED）。每条需求需可测试（对应具体操作与可观察的预期）。完成后用一句话总结产出了哪些文件、识别了哪些需求。`;

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = body.taskName || '需求分析';
    const step: string = body.step === 'execution' ? 'execution' : 'requirement';
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;

    if (!projectPath || typeof projectPath !== 'string') {
      return new Response(JSON.stringify({ error: 'projectPath is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isExec = step === 'execution';
    const systemPrompt = isExec ? EXECUTION_SYSTEM_PROMPT : REQUIREMENT_SYSTEM_PROMPT;
    const mcpServers = isExec ? { playwright: buildPlaywrightMcp(projectPath) } : undefined;
    const prompt = isExec
      ? `请对本项目「${taskName}」执行测试用例：用 Playwright 浏览器工具逐条执行，按规则判定四态并输出 @@RESULT。`
      : `请对本项目执行测试需求分析。任务：「${taskName}」。\n` +
        `按系统提示的三级回退策略梳理可测试需求，并写入 AI_LabTest/requirements/ 下（按模块命名）。`;

    const stream = streamClaude({
      prompt,
      // Synthetic id — used only as a label; streamClaudeSdk does not persist it.
      sessionId: `test-poc-${Date.now()}`,
      systemPrompt,
      workingDirectory: projectPath,
      model,
      providerId,
      mcpServers,
      // Headless run: no user to approve permission prompts. Writes are
      // constrained by the system prompt for the POC; hard whitelist comes next.
      bypassPermissions: true,
      autoTrigger: true,
    });

    return new Response(stream, {
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

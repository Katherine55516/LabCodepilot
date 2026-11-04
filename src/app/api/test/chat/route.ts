import { streamClaude } from '@/lib/claude-client';
import { predictNativeRuntime } from '@/lib/runtime';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';

// Side-effect import registers the agent runtimes (see run/route.ts for why).
void predictNativeRuntime;

/**
 * 测试对话（真对话）——区别于 revise（单次定向改产物）与 submitNote（只记 notes 不调 AI）：
 * 本路由让用户在某个测试任务的工作台里与 AI **多轮对话**，AI 在该任务上下文中
 *   ① 答疑（Read 产物/源码回答）
 *   ② 改产物（按指令改 需求/用例，Write 覆盖，仅限 AI_LabTest/）
 *   ③ 建议触发步骤（输出 @@ACTION 行，前端渲染成确认按钮交用户点，AI 不能自己跑流程）
 * 多轮历史用 streamClaude 原生 conversationHistory；写入靠 prompt 约束 + bypassPermissions。
 * 不含浏览器实操（不注入 Playwright MCP）。
 */
const SYSTEM_PROMPT = `你是 QA 自动化测试平台的「测试对话助手」。用户正在某个测试任务的工作台里与你对话，你能在该任务上下文中回答问题、修改产物、并建议触发流程步骤。

能力边界（严格遵守）：
1. 答疑：用 Read 读取本任务的产物文件（需求/用例/run.json/报告/证据目录）与项目源码、文档来回答。读源码仅为理解被测系统，不评判代码质量。
2. 改产物：仅当用户明确要求修改需求或用例时，先 Read 现有产物 → 精准改写 → 用 Write 覆盖保存。只能写 AI_LabTest/ 目录内的文件，绝不修改任何业务源码、配置或 AI_LabTest/ 以外的文件。改 cases.json 必须保持严格合法 UTF-8 JSON（可被 JSON.parse 解析、无注释无尾逗号）、字段结构不变，内层引号一律用中文全角「」或""，绝不用英文半角 "（会断开 JSON）。
3. 建议触发步骤：你不能自己运行测试流程（需求/用例/执行/报告四步由平台调度）。当你判断应重跑或补测某步时，在回复末尾单独输出一行动作标记：
@@ACTION {"type":"runStep","step":"requirement|cases|execution|report","reason":"一句话原因"}
平台会把它渲染成一个确认按钮，由用户决定是否执行。一次回复最多建议一个动作；只在确有必要时建议，不要每次都建议；不要用其它格式描述这个动作。

通用：基于真实证据回答，读不到就说读不到，不臆造。只读源码与文档；只写 AI_LabTest/。`;

const STEP_LABELS: Record<string, string> = {
  requirement: '需求分析',
  cases: '用例设计',
  execution: '测试执行',
  report: '测试报告',
};

type HistoryItem = { role: 'user' | 'assistant'; content: string };

/** 后端再保险：只收 user/assistant + 字符串 content，截断最近 20 条（前端已转，这里兜底）。 */
function sanitizeHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (h): h is HistoryItem =>
        !!h &&
        typeof h === 'object' &&
        ((h as HistoryItem).role === 'user' || (h as HistoryItem).role === 'assistant') &&
        typeof (h as HistoryItem).content === 'string',
    )
    .slice(-20)
    .map((h) => ({ role: h.role, content: h.content }));
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = body.taskName || '测试任务';
    const focusStep: string = typeof body.focusStep === 'string' ? body.focusStep : '';
    const message: string = typeof body.message === 'string' ? body.message.trim() : '';
    const env: string = typeof body.env === 'string' && body.env ? body.env : 'local';
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;
    const history = sanitizeHistory(body.history);

    if (!projectPath || !message) {
      return new Response(JSON.stringify({ error: 'projectPath and message are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // taskName 与 env 都会进 artifactPaths 拼 run.json/report 路径 → 必须校验（revise 不依赖 env 故未校验）。
    if (isUnsafeSegment(taskName) || isUnsafeSegment(env)) {
      return new Response(JSON.stringify({ error: 'invalid taskName or env' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const p = artifactPaths(taskName, env);
    let baseUrl: string | null = null;
    try {
      baseUrl = resolveProjectEnvWithDb(projectPath, env).frontendBaseUrl;
    } catch {
      /* DB unavailable / unconfigured — baseUrl 仅作只读上下文，缺失不阻断 */
    }
    const stepLabel = STEP_LABELS[focusStep] || focusStep || '（未指定）';

    const prompt = `你正在「${taskName}」测试任务的工作台中。当前聚焦步骤：${stepLabel}。
测试目标环境：${env}（baseUrl：${baseUrl || '未配置'}）。

本任务的产物文件（按需 Read，不存在则说明尚未生成）：
- 需求分析：${p.requirement}
- 测试用例：${p.cases}
- 运行结果(JSON)：${p.runJson}
- 测试报告：${p.report}
- 证据目录：${p.evidenceDir}

用户消息：
"""${message}"""

请在本任务上下文中回答或处理。若需改产物，用 Write 覆盖对应文件（只写 AI_LabTest/ 内）；若建议重跑某步，按系统约定在回复末尾单独输出一行 @@ACTION。`;

    const abortController = new AbortController();
    req.signal.addEventListener('abort', () => abortController.abort());
    const stream = streamClaude({
      prompt,
      sessionId: `test-chat-${taskName}`,
      systemPrompt: SYSTEM_PROMPT,
      workingDirectory: projectPath,
      conversationHistory: history,
      fallbackTokenBudget: 30000,
      model,
      providerId,
      abortController,
      bypassPermissions: true,
      autoTrigger: true,
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

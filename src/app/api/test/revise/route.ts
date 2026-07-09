import fs from 'fs';
import path from 'path';
import { streamClaude } from '@/lib/claude-client';
import { predictNativeRuntime } from '@/lib/runtime';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';

// Side-effect import registers the agent runtimes (see run/route.ts for why).
void predictNativeRuntime;

/**
 * 对话式定向修订（移植 ai-lab-test-framework app/src/main/engine/revise.js）。
 *
 * 区别于「追加指令」（submitNote：把指令存进 notes、喂下一步 prompt，不改当前产物）：
 * 本路由读当前 step 的产物 → AI 按用户指令**精准修改并覆盖**该产物。仅需求/用例两步
 * 可修订（它们的产物是稳定文件：需求 md / 用例 json）。与 run/report 路由一样直接调
 * streamClaude（独立 sessionId、bypassPermissions、写入靠 prompt 约束在 AI_LabTest/）。
 */
const SYSTEM_PROMPT = `你是 QA 自动化测试平台的「产物修订助手」。
任务：根据用户的修改要求，对指定步骤已生成的产物文档做精准修改，保持其既有结构与规范，只改必要部分。
要求：基于真实证据（产物原文 + 代码/文档）；只读源码与文档；只把结果写入 AI_LabTest/ 目录，绝不修改任何业务源码与配置文件。`;

const CASES_SCHEMA = '{"cases":[{"id","caseType","requirement","priority","purpose","precondition","steps":[{"content","expected"}],"assertion","oracle","verification","cleanup"}]}';

/** 支持修订的步骤 → 产物相对路径 + 是否 JSON + 中文步名。其余步返回 null（不支持）。 */
function targetArtifact(step: string, taskName: string): { rel: string; json: boolean; label: string } | null {
  const p = artifactPaths(taskName);
  if (step === 'requirement') return { rel: p.requirement, json: false, label: '需求分析' };
  if (step === 'cases') return { rel: p.cases, json: true, label: '用例设计' };
  return null;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = body.taskName || '测试任务';
    const step: string = body.step;
    const instruction: string = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;

    if (!projectPath || !instruction) {
      return new Response(JSON.stringify({ error: 'projectPath and instruction are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (isUnsafeSegment(taskName)) {
      return new Response(JSON.stringify({ error: 'invalid taskName' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const target = targetArtifact(step, taskName);
    if (!target) {
      return new Response(JSON.stringify({ error: '该步骤暂不支持对话修订（仅需求/用例两步）' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    let existing = '';
    try { existing = fs.readFileSync(path.join(projectPath, target.rel), 'utf-8'); } catch { /* missing */ }
    if (!existing.trim()) {
      return new Response(JSON.stringify({ error: `本步尚无产物（${target.rel}），请先运行此步再修订` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const jsonNote = target.json
      ? `\n⚠️ 本产物是 JSON 数据文件（平台用可编辑页面渲染）：修改后必须仍是**严格合法的 UTF-8 JSON**（可被 JSON.parse 解析，无注释/无尾逗号），字段结构保持不变。结构：\`${CASES_SCHEMA}\`。内层引号一律用中文全角「」或""，绝不用英文半角 \`"\`（会断开 JSON）。`
      : '';
    const prompt = `你正在修订「${taskName}」的 **${target.label}** 产物。

当前产物：${target.rel}　← 请第一步就用 Read 读取它的现有内容。
${jsonNote}

用户本次修改要求：
"""${instruction}"""

请执行：
1. Read 读取当前产物 ${target.rel}。
2. 按用户要求**精准修改**：只动需要改的部分，保留其余内容、结构与来源标注（如新增内容沿用 PROJECT_DOC / REVERSE_ENGINEERED 标注，不臆造无依据内容）。
3. 用 Write **覆盖保存** ${target.rel}（只能写 AI_LabTest/ 内，不要改业务源码、不要写别的文件）。
4. 完成后用一句话说明你具体改了什么。`;

    const abortController = new AbortController();
    req.signal.addEventListener('abort', () => abortController.abort());
    const stream = streamClaude({
      prompt,
      sessionId: `test-revise-${step}-${taskName}`,
      systemPrompt: SYSTEM_PROMPT,
      workingDirectory: projectPath,
      model,
      providerId,
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

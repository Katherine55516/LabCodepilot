import fs from 'fs';
import path from 'path';
import { streamClaude } from '@/lib/claude-client';
import { predictNativeRuntime } from '@/lib/runtime';
import { artifactPaths } from '@/lib/test/prompts';
import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';

// Side-effect import registers the agent runtimes (see run/route.ts for why).
void predictNativeRuntime;

/**
 * 缺陷报告（第三交付物，移植 ai-lab-test-framework app/src/main/engine/defect-report.js）。
 *
 * 报告阶段产「测试报告 + run.json」；本路由按需追加一份给开发的**缺陷单**：只挑
 * status=fail 且确属应用 bug 的用例，产出可定位的缺陷报告（只写期望行为 + 验收标准，
 * 守 QA 铁律——禁修复方案/优先级/指派）。读 run.json + cases.json，AI 自行筛选。
 * 写入 AI_LabTest/report/{task}/{task}-{env}-缺陷报告.md。
 */
const SYSTEM_PROMPT = `你是 QA 自动化测试平台的「缺陷报告员」。
任务：从一次测试执行结果里挑出真实应用缺陷，按缺陷单模板整合成给开发平台用的 Markdown 缺陷报告。
铁律：① 只把 status=fail 且确属被测应用自身缺陷（应用bug）的用例写成缺陷；明显是测试bug/环境问题/flaky 的不写；partial/blocked/pass 一律不写。
② 只陈述事实，引用真实证据（实际结果/错误/截图/接口），不臆造、不放大。
③ 「修复要求」只写期望行为 + 验收标准（怎样算修好、怎么验证），禁止写修复方案/改哪行代码/优先级/是否发布/指派责任人。
④ 报告内不向用户提问、不留 TBD；只读输入与业务源码，只写 AI_LabTest/ 目录。`;

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = body.taskName || '测试任务';
    const envArg: string = body.env || 'local';
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;

    if (!projectPath) {
      return new Response(JSON.stringify({ error: 'projectPath is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const resolved = resolveProjectEnvWithDb(projectPath, envArg);
    const env = resolved.env;
    const baseUrl = resolved.frontendBaseUrl || (typeof body.baseUrl === 'string' ? body.baseUrl : undefined);
    const p = artifactPaths(taskName, env);

    // run.json 必须存在（缺陷报告消费它）。
    let runRaw = '';
    try { runRaw = fs.readFileSync(path.join(projectPath, p.runJson), 'utf-8'); } catch { /* missing */ }
    if (!runRaw.trim()) {
      return new Response(JSON.stringify({ error: `执行结果缺失（${p.runJson}），请先执行测试再出缺陷报告` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const defectRel = `AI_LabTest/report/${taskName}/${taskName}-${env}-缺陷报告.md`;
    const prompt = `请为测试任务「${taskName}」（环境 ${env}）生成**缺陷报告**（Markdown，给开发平台作修复依据）。

输入产物（请先 Read）：
- 执行结果（权威事实）：${p.runJson}（失败用例的 actual / error / evidence / 可能的 api 字段）
- 测试用例：${p.cases}（含 ID / 需求引用 / 前置条件 / 测试步骤 / 预期结果）
${baseUrl ? `被测前端地址：${baseUrl}` : '（未配置被测地址）'}

筛选规则（严格遵守）：
- 只处理 run.json 的 tests 里 status="fail" 的用例；逐条判断是否**被测应用自身缺陷（应用bug）**。
- 排除：测试bug（用例/数据自身问题）、环境问题、flaky（偶现）→ 不写进缺陷报告；partial / blocked / pass → 一律不写。
- 没有任何应用缺陷时，按下方「无缺陷留痕」格式输出整篇。

每条缺陷按以下模板（用例 ID 作缺陷编号，逐条一节）：

### 缺陷 {序号}：{用例标题 purpose}
- **缺陷编号**：{用例ID}
- **关联需求**：{用例的需求引用，无则「—」}
- **环境 / 被测地址**：${env} / ${baseUrl || '—'}
- **前置条件**：{用例前置条件}
- **重现步骤**：{用例的测试操作，逐步编号；保证开发照着能复现}
- **预期结果**：{用例预期结果}
- **实际结果**：{run.json 该用例 actual}
- **错误信息**：{run.json 该用例 error，无则「—」}
- **证据**：{run.json 该用例 evidence 截图路径，无则「—」}
- **接口信息**：{若该用例有 api 字段则写 method/URL/状态码/响应；无则「—（未捕获接口 / 纯前端缺陷）」}
- **期望行为 / 验收标准**：{用一两句写正确行为应是什么 + 怎样验证算修好，例：「重新执行上述步骤应{预期结果}；对应接口应返回 2xx 且响应符合预期」}

无缺陷留痕格式（当没有任何应用缺陷时，整篇就这样）：
\`\`\`
# ${taskName} 缺陷报告（${env}）
本轮共执行 N 条用例：通过 X / 失败 Y / 部分 Z / 阻塞 W。
**未发现应用缺陷。**（失败 / 阻塞用例均属测试侧或环境 / 路径原因，非被测应用缺陷，详见测试报告。）
\`\`\`

⚠️ 落点（必须遵守）：报告**只能用 Write 写入** \`${defectRel}\`。守铁律③：不写修复方案 / 改哪行 / 优先级 / 指派；不向用户提问、不留 TBD。

完成后用一句话总结：本任务应用缺陷数、主要风险点（仅事实）。`;

    const abortController = new AbortController();
    req.signal.addEventListener('abort', () => abortController.abort());
    const stream = streamClaude({
      prompt,
      sessionId: `test-defect-${taskName}`,
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

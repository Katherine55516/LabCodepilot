import fs from 'fs';
import path from 'path';
import { streamClaude } from '@/lib/claude-client';
// Side-effect import registers the agent runtimes (see run/route.ts for why).
import { predictNativeRuntime } from '@/lib/runtime';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { appendAudit } from '@/lib/test/audit';

export const runtime = 'nodejs';

void predictNativeRuntime;

/**
 * 存量用例 · AI 推荐回归集（需求③：对已生成/导入的用例集按「失败即阻塞」标准打标）。
 *
 * 模式复制 run/route.ts 的流包装：透传 streamClaude 的 SSE（用户实时看到判定过程）+
 * 服务端累积 text 帧；流结束时 harvest `@@RECOMMEND {"id","suite","reason"}` 行 →
 * **代码 merge**（只增删各条 `tags` 里的「回归测试」，其余字段原样，.tmp+rename 原子
 * 写回）→ 补发 `{type:'cases_updated'}` 帧。与 revise 的「AI 直接覆盖产物」相反，AI
 * 全程**只读**——防重写整份 JSON 丢字段（tags 之外的 oracle/verification 等）。
 * 审计在服务端记 recommend-suite（结果条数一并入 detail）。
 */

const SYSTEM_PROMPT = `你是 QA 自动化测试平台的「回归集标注助手」。
任务：按「失败后果」判定每条测试用例是否属于回归集（发版必跑、失败即阻塞系统运行），逐条输出判定行。
要求：只读用例与需求文档；**绝不**用 Write/Edit 修改任何文件——平台按你的输出行精确更新标签。`;

function buildPrompt(taskName: string): string {
  const p = artifactPaths(taskName);
  return `请为任务「${taskName}」的存量测试用例推荐回归集标注。

回归集 = 用例 \`tags\` 含「回归测试」：**该用例不通过即阻塞系统运行**、每次发版必跑且必须全过（详见《测试用例完整性规范》§1.7）。

判定标准（以「失败后果」为唯一判据，满足任一 → 回归集）：
- 登录 / 鉴权不可用（后续功能全部无法进入）；
- 核心业务主链路中断（主要用户旅程走不通）；
- 数据写入丢失或一致性被破坏；
- 应用崩溃 / 白屏 / 无法启动。

克制原则：P0 是天然候选但以失败后果为准，**禁止** P0 无脑全选；纯提示文案/样式/次要交互**禁止**入选；回归集通常 ≤ 总数 30%，超出请逐条复核。
⚠️ 与 \`verification\`（功能验证/回归基线，oracle 口径）是**正交维度**：禁止「回归基线 ⇒ 回归集」或反向推导。

执行：
1. Read 用例文件 \`${p.cases}\`；若存在需求文档 \`${p.requirement}\` 也 Read（理解每条用例覆盖的功能与失败后果）。
2. 对用例文件里的**每一条**用例输出一行判定（一条都不能漏、按原顺序、一行一条）：
   @@RECOMMEND {"id":"TC-001","suite":true,"reason":"登录主流程,失败阻塞全部功能"}
   —— \`suite\`: true=应打「回归测试」标签；false=不应打（已打的会被移除）。\`reason\` 一句话，内层引用一律用中文引号「」。
3. **只读不写**：禁止修改任何文件。
4. 输出完后自检条数（判定行数 == 用例总数），再用一句话总结：共 N 条用例，推荐回归集 M 条。`;
}

/** 提取 @@RECOMMEND 行 → id → suite。坏行跳过（仿 reduce.ts harvestResults）。 */
export function harvestRecommend(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const line of text.split('\n')) {
    const idx = line.indexOf('@@RECOMMEND');
    if (idx < 0) continue;
    try {
      const obj = JSON.parse(line.slice(idx + '@@RECOMMEND'.length).trim());
      if (obj && typeof obj.id === 'string' && typeof obj.suite === 'boolean') out.set(obj.id, obj.suite);
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

/** 一条推荐判定(可视化审阅用:比 harvestRecommend 多带 reason)。 */
export interface RecommendVerdict {
  id: string;
  suite: boolean;
  reason: string;
}

/**
 * 提取 @@RECOMMEND 行 → [{id, suite, reason}]（审阅模式用；保留理由供可视化表格展示）。
 * 同 id 多行时后者覆盖前者（与 harvestRecommend 的 Map 语义一致）。坏行跳过。
 */
export function harvestRecommendDetailed(text: string): RecommendVerdict[] {
  const byId = new Map<string, RecommendVerdict>();
  for (const line of text.split('\n')) {
    const idx = line.indexOf('@@RECOMMEND');
    if (idx < 0) continue;
    try {
      const obj = JSON.parse(line.slice(idx + '@@RECOMMEND'.length).trim());
      if (obj && typeof obj.id === 'string' && typeof obj.suite === 'boolean') {
        byId.set(obj.id, { id: obj.id, suite: obj.suite, reason: typeof obj.reason === 'string' ? obj.reason : '' });
      }
    } catch {
      // ignore malformed lines
    }
  }
  return [...byId.values()];
}

/**
 * 按推荐结果 merge cases.json：只增删各条 tags 里的「回归测试」，其余字段与文件结构
 * （{cases:[...]} 或顶层数组）原样保留；.tmp+rename 原子写。返回统计供前端提示。
 */
export function applyRecommend(
  casesAbs: string,
  rec: Map<string, boolean>,
): { changed: number; total: number; suiteTotal: number } {
  const raw = JSON.parse(fs.readFileSync(casesAbs, 'utf-8')) as unknown;
  const list: Array<Record<string, unknown>> = Array.isArray((raw as { cases?: unknown })?.cases)
    ? ((raw as { cases: Array<Record<string, unknown>> }).cases)
    : Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : [];
  let changed = 0;
  let suiteTotal = 0;
  for (const c of list) {
    const id = typeof c?.id === 'string' ? c.id : '';
    const tags: string[] = Array.isArray(c?.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    const has = tags.includes('回归测试');
    if (!id || !rec.has(id)) {
      if (has) suiteTotal++;
      continue;
    }
    const want = rec.get(id)!;
    if (want && !has) {
      c.tags = [...tags, '回归测试'];
      changed++;
    } else if (!want && has) {
      c.tags = tags.filter((t) => t !== '回归测试');
      changed++;
    }
    if (want) suiteTotal++;
  }
  const out = Array.isArray(raw) ? list : { ...(raw as Record<string, unknown>), cases: list };
  const tmp = casesAbs + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
  fs.renameSync(tmp, casesAbs);
  return { changed, total: list.length, suiteTotal };
}

/**
 * 透传 SSE + 累积 text 帧；流尾按模式收口：
 *  - 默认(auto-apply):harvest→merge→审计→补发 cases_updated 帧(旧行为)。
 *  - review 模式(可视化审阅,不写盘):harvest 详细判定→补发 recommend_verdicts 帧;【不】改 cases.json、
 *    【不】记审计——真正写盘与审计留到用户在弹窗点「应用」时走 /apply 接口。
 */
function wrapRecommendStream(
  src: ReadableStream<string>,
  opts: { projectPath: string; taskName: string; review?: boolean },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (opts.review) {
            // 只推荐、不写盘：把详细判定(含 reason)发给前端弹窗渲染,由用户审阅后再决定应用。
            let verdicts: ReturnType<typeof harvestRecommendDetailed> = [];
            try { verdicts = harvestRecommendDetailed(textAcc); } catch { /* 坏流→空判定,前端提示无结果 */ }
            controller.enqueue(`data: ${JSON.stringify({ type: 'recommend_verdicts', data: JSON.stringify(verdicts) })}\n\n`);
            controller.close();
            return;
          }
          let summary = { changed: 0, total: 0, suiteTotal: 0 };
          try {
            const rec = harvestRecommend(textAcc);
            if (rec.size) {
              summary = applyRecommend(path.join(opts.projectPath, artifactPaths(opts.taskName).cases), rec);
            }
          } catch {
            // merge best-effort：失败则 summary 保持 0，前端按「无变更」提示
          }
          void appendAudit(opts.projectPath, opts.taskName, {
            action: 'recommend-suite',
            mode: 'manual',
            step: 'cases',
            detail: `AI 推荐回归集：调整 ${summary.changed} 条，回归集 ${summary.suiteTotal}/${summary.total}`,
          });
          controller.enqueue(`data: ${JSON.stringify({ type: 'cases_updated', data: JSON.stringify(summary) })}\n\n`);
          controller.close();
          return;
        }
        controller.enqueue(value);
        frameBuf += value;
        const frames = frameBuf.split('\n\n');
        frameBuf = frames.pop() || '';
        for (const f of frames) {
          const line = f.replace(/^data:\s?/, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type?: string; data?: string };
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

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = typeof body.taskName === 'string' ? body.taskName : '';
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;
    // review=true:可视化审阅模式——只推荐(发 recommend_verdicts 帧)不写盘,用户在弹窗审阅后走 /apply。
    const review: boolean = body.review === true;
    if (!projectPath || !taskName) {
      return Response.json({ error: 'projectPath, taskName required' }, { status: 400 });
    }
    if (isUnsafeSegment(taskName)) {
      return Response.json({ error: 'invalid taskName' }, { status: 400 });
    }
    const casesAbs = path.join(projectPath, artifactPaths(taskName).cases);
    if (!fs.existsSync(casesAbs)) {
      return Response.json({ error: '当前任务尚无用例（先运行「用例设计」或导入用例）' }, { status: 400 });
    }

    const stream = streamClaude({
      prompt: buildPrompt(taskName),
      sessionId: `test-recommend-${taskName}`,
      systemPrompt: SYSTEM_PROMPT,
      workingDirectory: projectPath,
      model,
      providerId,
      bypassPermissions: true,
      autoTrigger: true,
    });
    return new Response(wrapRecommendStream(stream, { projectPath, taskName, review }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

import fs from 'fs';
import path from 'path';
import { streamClaude } from '@/lib/claude-client';
// Side-effect import registers the agent runtimes (see run/route.ts for why).
import { predictNativeRuntime } from '@/lib/runtime';
import { appendAudit } from '@/lib/test/audit';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import { readRounds, normalizeStaleRounds, readRoundSnapshot, roundArtifactPaths } from '@/lib/test/rounds';
import { buildCaseHistory } from '@/lib/test/case-history';
import {
  buildVerdictPrompt,
  harvestVerdicts,
  writeVerdicts,
  verdictKey,
  type CaseVerdict,
  type FailureContext,
} from '@/lib/test/verdicts';

export const runtime = 'nodejs';

void predictNativeRuntime;

/**
 * 回归轮次 · AI 失败归因(v2 二期)。
 *
 * POST { projectPath, roundId, model?, providerId? } → SSE(透传模型输出,前端只需消费到 done)
 *
 * 范式与 `/api/test/cases/recommend` 一致——**AI 只读、代码落盘**:模型没有 Write 权限,
 * 平台在流尾 harvest `@@VERDICT` 行,反解 runId → (来源任务, 原ID),原子写
 * `report/回归用例库/{roundId}/verdicts.json`。这样模型幻觉最多让某一条归因缺失/被丢弃,
 * 不会污染产物结构。
 *
 * 归因是**建议**不是结论:UI 标明「AI 归因」来源,转缺陷仍走人工确认。
 */
const SYSTEM_PROMPT = `你是 QA 自动化测试平台的「回归失败归因助手」。
任务：为一轮回归里失败的用例判定失败原因分类，逐条输出判定行。
铁律：① 只用平台给出的事实（实际结果 / 错误 / 关键接口 / 跨轮历史），绝不臆造；
② **绝不**用 Write/Edit 修改任何文件——平台按你的输出行落盘；
③ 只给下一步动作建议，不写修复方案、优先级、是否发版、指派责任人。`;

/** 流尾 harvest:runId → verdict,经当轮快照 idMap 反解为库条目身份键后原子落盘。 */
function wrapVerdictStream(
  src: ReadableStream<string>,
  opts: { projectPath: string; roundId: string; idMap: Record<string, { task: string; originalId: string }>; failures: number },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let textAcc = '';
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          let written = 0;
          try {
            const byRunId = harvestVerdicts(textAcc);
            const out: Record<string, CaseVerdict> = {};
            for (const [runId, v] of Object.entries(byRunId)) {
              const src2 = opts.idMap[runId];
              if (!src2) continue; // 模型编了个不存在的 id → 丢弃
              out[verdictKey(src2.task, src2.originalId)] = v;
            }
            written = Object.keys(out).length;
            if (written) writeVerdicts(opts.projectPath, opts.roundId, out);
          } catch {
            // harvest/落盘失败 → 报告页仍显示「待归因」,不影响主体
          }
          void appendAudit(opts.projectPath, REGRESSION_LIBRARY_TASK, {
            action: 'verdict-round',
            mode: 'manual',
            step: 'report',
            detail: `AI 失败归因 ${opts.roundId}:${written}/${opts.failures} 条失败用例已归因`,
          });
          controller.enqueue(`data: ${JSON.stringify({ type: 'verdicts_updated', data: JSON.stringify({ written, total: opts.failures }) })}\n\n`);
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
    const roundId: string | undefined = body.roundId;
    const model: string | undefined = body.model;
    const providerId: string | undefined = body.providerId;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ error: 'projectPath is required' }, { status: 400 });
    }
    if (!roundId || typeof roundId !== 'string' || isUnsafeSegment(roundId)) {
      return Response.json({ error: 'invalid roundId' }, { status: 400 });
    }

    const round = normalizeStaleRounds(readRounds(projectPath).rounds).find((r) => r.roundId === roundId);
    if (!round) return Response.json({ error: 'round not found' }, { status: 404 });

    const snap = readRoundSnapshot(projectPath, roundId);
    if (!snap?.idMap) return Response.json({ error: '当轮快照缺失，无法反解用例来源' }, { status: 400 });

    let tests: Array<{ id?: unknown; status?: unknown; actual?: unknown; error?: unknown; api?: unknown }> = [];
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(projectPath, roundArtifactPaths(roundId, round.env).runJson), 'utf-8')) as { tests?: unknown };
      if (Array.isArray(raw.tests)) tests = raw.tests as typeof tests;
    } catch {
      return Response.json({ error: '该轮执行结果缺失（run.json），无法归因' }, { status: 400 });
    }

    // 跨轮历史:判 flaky / 连败的唯一依据,按行身份取该用例的结果串。
    const hist = buildCaseHistory(projectPath);
    const histOf = new Map(hist.cases.map((c) => [verdictKey(c.task, c.originalId), c.res.join('')]));
    const purposeByRunId = new Map<string, string>();
    for (const c of Array.isArray(snap.cases) ? snap.cases : []) {
      const cc = c as { id?: unknown; purpose?: unknown };
      if (typeof cc.id === 'string') purposeByRunId.set(cc.id, typeof cc.purpose === 'string' ? cc.purpose : '');
    }

    const failures: FailureContext[] = [];
    for (const t of tests) {
      if (!t || typeof t.id !== 'string' || typeof t.status !== 'string' || t.status === 'pass') continue;
      const src = snap.idMap[t.id];
      if (!src) continue;
      failures.push({
        runId: t.id,
        task: src.task,
        originalId: src.originalId,
        purpose: purposeByRunId.get(t.id) ?? '',
        status: t.status,
        actual: typeof t.actual === 'string' ? t.actual : undefined,
        error: typeof t.error === 'string' ? t.error : undefined,
        api: t.api,
        history: histOf.get(verdictKey(src.task, src.originalId)) ?? '',
      });
    }
    if (!failures.length) {
      return Response.json({ error: '该轮没有失败用例，无需归因' }, { status: 400 });
    }

    const stream = streamClaude({
      prompt: buildVerdictPrompt(roundId, failures),
      sessionId: `test-verdict-${roundId}`,
      systemPrompt: SYSTEM_PROMPT,
      workingDirectory: projectPath,
      model,
      providerId,
      bypassPermissions: true,
      autoTrigger: true,
    });
    return new Response(wrapVerdictStream(stream, { projectPath, roundId, idMap: snap.idMap, failures: failures.length }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}

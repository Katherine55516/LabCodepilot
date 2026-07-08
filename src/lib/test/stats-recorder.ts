import fs from 'fs';
import path from 'path';
import { insertTestStatsEvents, queryTestStatsEvents } from '@/lib/db';
import { snapshotCases } from '@/lib/test/stats';
import { artifactPaths, type TestStep } from '@/lib/test/prompts';
import type { TestStatsEventInput } from '@/types';

/**
 * 测试统计 · 服务端埋点胶水（run/revise/cases 路由内直接写库，不经 HTTP）。
 *
 * 纪律（执行计划冻结）：
 * - **fail-safe**：任何埋点异常只打日志，绝不影响测试主流程；
 * - **宁缺毋错**：请求体没带 taskId（旧前端）→ 跳过埋点，不用 taskName 冒充 id
 *   （taskName 仅项目内唯一，跨项目会串数据）；
 * - **错误/中断不算完成**：SDK 报错路径也会发 done 帧（claude-client.ts:2095-2110），
 *   observeStream 跟踪 error 帧与 abort 信号，只有干净收尾才触发 onCleanDone。
 *
 * 事件字典与口径见 docs/exec-plans/active/test-usage-stats.md。
 */

/** 统一 fail-safe 落库。 */
export function recordStatsEvents(events: TestStatsEventInput[]): void {
  try {
    insertTestStatsEvents(events);
  } catch (e) {
    console.error('[test-stats] record failed:', e instanceof Error ? e.message : String(e));
  }
}

/** step_completed 事件（四步任一步干净收尾时）。 */
export function buildStepCompleted(args: {
  taskId: string;
  projectPath: string;
  taskName: string;
  env: string;
  step: TestStep;
  stepStartMs: number;
  model?: string;
  providerId?: string;
}): TestStatsEventInput {
  return {
    eventType: 'step_completed',
    projectPath: args.projectPath,
    taskId: args.taskId,
    taskName: args.taskName,
    // env 只对执行/报告步有意义（需求/用例与环境无关）
    env: args.step === 'execution' || args.step === 'report' ? args.env : undefined,
    payload: {
      step: args.step,
      status: 'done',
      durationMs: Date.now() - args.stepStartMs,
      model: args.model ?? null,
      providerId: args.providerId ?? null,
    },
  };
}

/**
 * cases 步 / revise 干净收尾：读 cases.json 拍 id+hash 快照记 cases_generated。
 * round = 该任务已有生成轮数 + 1（首轮即采纳率的「首轮基线」）。
 * sinceMs 门：事件字典的触发条件是「写出 cases.json」而非「流结束」——AI 偶发只产
 * 摘要不调 Write（报告步已有同款失效模式），文件 mtime 早于本轮开跑就跳过，
 * 否则会对旧快照记一轮幻影返工（sinceMs 模式同 sweepStrayEvidence）。
 */
export function recordCasesGenerated(args: {
  taskId: string;
  projectPath: string;
  taskName: string;
  sinceMs: number;
  model?: string;
}): void {
  try {
    const file = path.join(args.projectPath, artifactPaths(args.taskName).cases);
    const st = fs.statSync(file);
    if (st.mtimeMs < args.sinceMs - 1000) return; // 本轮未重写（1s 容差防低精度 fs 时钟）
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray((parsed as { cases?: unknown })?.cases)
      ? (parsed as { cases: unknown[] }).cases
      : Array.isArray(parsed)
        ? parsed
        : [];
    const snap = snapshotCases(list);
    const round = queryTestStatsEvents({ taskId: args.taskId, eventTypes: ['cases_generated'] }).length + 1;
    recordStatsEvents([
      {
        eventType: 'cases_generated',
        projectPath: args.projectPath,
        taskId: args.taskId,
        taskName: args.taskName,
        payload: { round, caseCount: snap.length, model: args.model ?? null, cases: snap },
      },
    ]);
  } catch (e) {
    // cases.json 缺失/损坏 → 本轮快照缺省（不阻塞）；聚合按无基线处理
    console.error('[test-stats] cases_generated skipped:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * 通用 SSE 流观测包装：原样转发所有帧，只观察 error 帧；流干净收尾（无 error 帧、
 * 未被 abort）时回调 onCleanDone。用于给「无服务端收尾钩子」的步骤（需求/用例/修订）
 * 挂 step_completed / cases_generated 埋点，不改变任何对客户端可见的行为。
 */
export function observeStream(
  src: ReadableStream<string>,
  opts: { aborted?: () => boolean; onCleanDone: () => void },
): ReadableStream<string> {
  const reader = src.getReader();
  let frameBuf = '';
  let sawError = false;
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (!sawError && !(opts.aborted?.() ?? false)) {
            try {
              opts.onCleanDone();
            } catch (e) {
              console.error('[test-stats] onCleanDone failed:', e instanceof Error ? e.message : String(e));
            }
          }
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
            if (evt?.type === 'error') sawError = true;
            // SDK 会话级失败（限流/鉴权/额度等）只发 result{is_error:true} + done，
            // 不发 error 帧（claude-client.ts result 分支）——同样不算干净收尾。
            else if (evt?.type === 'result') {
              try {
                const r = JSON.parse(evt.data || '{}') as { is_error?: unknown };
                if (r?.is_error === true) sawError = true;
              } catch {
                /* native result 帧非 JSON/无 is_error → 非错误 */
              }
            }
          } catch {
            /* ignore non-JSON frames */
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

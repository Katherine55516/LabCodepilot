import fs from 'fs';
import path from 'path';
import { sha1Hex } from '@/lib/test/history';

/**
 * List a project's persisted test reports for the 报告 view.
 *
 * Reports live on disk at `{projectPath}/AI_LabTest/report/{task}/{task}-{env}.run.json`
 * (written by the execution step's deterministic reduction). A task can therefore have
 * MULTIPLE reports — one per environment (local / SIT); re-running the same env overwrites
 * its file (latest only, no time history). We return one entry per run.json, grouped on
 * the client by task.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  if (!projectPath) {
    return Response.json({ error: 'projectPath is required' }, { status: 400 });
  }

  const reportRoot = path.join(projectPath, 'AI_LabTest', 'report');
  const reports: unknown[] = [];
  // 收集一个目录里的 run.json 报告条目。roundId(v2 回归轮次):回归用例库的轮次化产物落
  // report/回归用例库/{roundId}/ 子目录,扫描时下钻一层并把子目录名作为 roundId 透传——
  // 前端仍按 task 分组,轮次报告归在「回归用例库」组内、带轮次标识。
  const collectDir = (dir: string, taskName: string, roundId?: string) => {
    let files: string[] = [];
    try { files = fs.readdirSync(dir); } catch { return; }
    for (const f of files) {
      if (!f.endsWith('.run.json')) continue;
      try {
        const runContent = fs.readFileSync(path.join(dir, f), 'utf-8');
        const raw = JSON.parse(runContent) as Record<string, unknown>;
          // runHash = sha1(run.json 全文)，与执行/报告步埋点、.history 去重同源同值，
          // 把人工复核（report_reviewed）关联到确切执行轮（重跑即失效）。
          const runHash = sha1Hex(runContent);
          const counts = (raw.counts ?? {}) as Record<string, number>;
          const fc = (raw.funcCounts ?? {}) as Record<string, number>;
          // The 报告 step also writes a markdown report doc next to the run.json
          // ({task}-{env}.md) — include it so the 报告 view can show the full doc.
          let markdown = '';
          try { markdown = fs.readFileSync(path.join(dir, f.replace(/\.run\.json$/, '.md')), 'utf-8'); } catch { /* no .md */ }
          // 缺陷报告（第三交付物，按需生成）：{task}-{env}-缺陷报告.md
          let defectMarkdown = '';
          try { defectMarkdown = fs.readFileSync(path.join(dir, f.replace(/\.run\.json$/, '-缺陷报告.md')), 'utf-8'); } catch { /* none */ }
          // 注：Excel 执行矩阵不再依赖磁盘 .xlsx —— 由 /api/test/report-xlsx 从 run.json 即时派生（见该 route）。
          reports.push({
            task: taskName,
            ...(roundId ? { roundId } : {}),
            env: typeof raw.env === 'string' ? raw.env : '',
            time: typeof raw.time === 'string' ? raw.time : '',
            status: typeof raw.status === 'string' ? raw.status : '',
            passStr: typeof raw.passStr === 'string' ? raw.passStr : '',
            circuitBroken: !!raw.circuitBroken,
            counts: {
              total: counts.total ?? 0,
              pass: counts.pass ?? 0,
              fail: counts.fail ?? 0,
              partial: counts.partial ?? 0,
              blocked: counts.blocked ?? 0,
            },
            // 双口径（oracle 双轴）：功能验证四态 + 通过率字符串。legacy run.json 无此
            // 字段时回退 counts/passStr（单口径），保持旧报告可读、不虚报功能验证率。
            funcCounts: {
              total: fc.total ?? counts.total ?? 0,
              pass: fc.pass ?? counts.pass ?? 0,
              fail: fc.fail ?? counts.fail ?? 0,
              partial: fc.partial ?? counts.partial ?? 0,
              blocked: fc.blocked ?? counts.blocked ?? 0,
            },
            funcPassStr:
              typeof raw.funcPassStr === 'string'
                ? raw.funcPassStr
                : typeof raw.passStr === 'string'
                  ? raw.passStr
                  : '',
            regressionTotal: typeof raw.regressionTotal === 'number' ? raw.regressionTotal : 0,
            // 回归集口径（tags 含「回归测试」,与上面 regressionTotal 的回归基线口径正交）:
            // 可选透传——旧 run.json 无此字段 → undefined,前端不渲染回归集区块。
            ...(raw.suiteCounts && typeof raw.suiteCounts === 'object'
              ? { suiteCounts: raw.suiteCounts, suitePassStr: typeof raw.suitePassStr === 'string' ? raw.suitePassStr : '' }
              : {}),
            tests: Array.isArray(raw.tests) ? raw.tests : [],
            // 冒烟：体验观察（@@OBSERVATION 归约产物）。功能/回归 run.json 无此字段 →
            // 不透传，前端不渲染体验问题区块。
            ...(Array.isArray(raw.observations) && raw.observations.length
              ? { observations: raw.observations }
              : {}),
            runHash,
            markdown,
            defectMarkdown,
          });
      } catch {
        /* skip unreadable / malformed run.json */
      }
    }
  };
  try {
    for (const taskDir of fs.readdirSync(reportRoot, { withFileTypes: true })) {
      if (!taskDir.isDirectory() || taskDir.name.startsWith('_')) continue; // skip _evidence
      const dir = path.join(reportRoot, taskDir.name);
      collectDir(dir, taskDir.name);
      // 下钻一层:轮次子目录(report/{task}/{roundId}/*.run.json)。跳过 .history(执行步
      // 的多版本快照目录,不是独立报告)。
      let subs: fs.Dirent[] = [];
      try { subs = fs.readdirSync(dir, { withFileTypes: true }); } catch { subs = []; }
      for (const sub of subs) {
        if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
        collectDir(path.join(dir, sub.name), taskDir.name, sub.name);
      }
    }
  } catch {
    /* no report dir yet → empty list */
  }

  reports.sort((a, b) => {
    const ax = a as { task: string; env: string };
    const bx = b as { task: string; env: string };
    return ax.task.localeCompare(bx.task) || ax.env.localeCompare(bx.env);
  });

  return Response.json({ reports });
}

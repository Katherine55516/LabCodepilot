import fs from 'fs';
import path from 'path';

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
  try {
    for (const taskDir of fs.readdirSync(reportRoot, { withFileTypes: true })) {
      if (!taskDir.isDirectory() || taskDir.name.startsWith('_')) continue; // skip _evidence
      const dir = path.join(reportRoot, taskDir.name);
      let files: string[] = [];
      try { files = fs.readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.run.json')) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>;
          const counts = (raw.counts ?? {}) as Record<string, number>;
          const fc = (raw.funcCounts ?? {}) as Record<string, number>;
          // The 报告 step also writes a markdown report doc next to the run.json
          // ({task}-{env}.md) — include it so the 报告 view can show the full doc.
          let markdown = '';
          try { markdown = fs.readFileSync(path.join(dir, f.replace(/\.run\.json$/, '.md')), 'utf-8'); } catch { /* no .md */ }
          // 缺陷报告（第三交付物，按需生成）：{task}-{env}-缺陷报告.md
          let defectMarkdown = '';
          try { defectMarkdown = fs.readFileSync(path.join(dir, f.replace(/\.run\.json$/, '-缺陷报告.md')), 'utf-8'); } catch { /* none */ }
          // 可选交付物 XLSX（执行矩阵，按需由 anthropic-skills:xlsx 生成；命名规则与 .md 不同，
          // 见 rules/test-report.md §9）。在同任务目录里找一个含本 env 标签的 .xlsx，存在才回传
          // basename，供产物列表「测试报告(Excel)」行显隐 + 表格预览定位。
          const envLabel = typeof raw.env === 'string' ? raw.env : '';
          let xlsxFile = '';
          try {
            const x = files.find((fn) => fn.toLowerCase().endsWith('.xlsx') && (!envLabel || fn.includes(envLabel)));
            if (x) xlsxFile = x;
          } catch { /* none */ }
          reports.push({
            task: taskDir.name,
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
            tests: Array.isArray(raw.tests) ? raw.tests : [],
            markdown,
            defectMarkdown,
            xlsxFile,
          });
        } catch {
          /* skip unreadable / malformed run.json */
        }
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

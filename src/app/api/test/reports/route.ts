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
            tests: Array.isArray(raw.tests) ? raw.tests : [],
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

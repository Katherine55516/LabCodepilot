import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { listRunHistory } from '@/lib/test/history';

/**
 * List run.json history snapshots for one task+env (报告多版本对比).
 *
 * GET ?projectPath&taskName&env → { history: RunHistoryEntry[] }（newest first）.
 * Snapshots live at {projectPath}/AI_LabTest/report/{task}/.history/{task}-{env}-{stamp}.run.json
 * (written by the execution step's snapshotRunJson — SHA-1 deduped). Each entry
 * carries the summary (counts/funcCounts/passStr/funcPassStr) + per-case
 * {id,status} the client needs to run diffRuns between any two versions.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  const taskName = url.searchParams.get('taskName');
  const env = url.searchParams.get('env') || 'local';
  if (!projectPath || !taskName) {
    return Response.json({ error: 'projectPath and taskName are required' }, { status: 400 });
  }
  // artifactPaths(taskName, env).runJson = AI_LabTest/report/{task}/{task}-{env}.run.json
  // → its dir = the report task dir that holds .history/.
  const reportTaskDir = path.dirname(path.join(projectPath, artifactPaths(taskName, env).runJson));
  const history = listRunHistory(reportTaskDir, taskName, env);
  return Response.json({ history });
}

import * as legacy from '../ppt-store.mjs';
import { recoverRun } from './run-service.mjs';

export function recoverStructuredRuns() {
  const recovered = [];
  for (const project of legacy.listPending()) {
    const run = recoverRun(project);
    if (run) recovered.push({ projectId: project.id, runId: run.id, stage: run.stage });
  }
  return recovered;
}

import { ensureProjectV3 } from './ir.mjs';

export function migrateProject(project) {
  if (!project) return { project, changed: false };
  const before = JSON.stringify(project);
  const migrated = ensureProjectV3(project);
  return { project: migrated, changed: before !== JSON.stringify(migrated) };
}

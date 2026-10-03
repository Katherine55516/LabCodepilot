import { ensureProjectV3 } from './ir.mjs';

export function migrateProject(project) {
  if (!project) return { project, changed: false };
  // V3 snapshots already carry canonical object IDs. Refresh creation context
  // at mutation boundaries, not by cloning every media string on every read.
  if (project.schemaVersion === 3 && project.creationContext?.schemaVersion === 1 &&
      Number.isInteger(project.revision) && (!project.deck || project.deck.schemaVersion === 3 &&
      project.deck.slides.every(slide => Array.isArray(slide.nodeOrder) && Array.isArray(slide.nodes))))
    return { project, changed: false };
  const before = JSON.stringify(project);
  const migrated = ensureProjectV3(project);
  return { project: migrated, changed: before !== JSON.stringify(migrated) };
}

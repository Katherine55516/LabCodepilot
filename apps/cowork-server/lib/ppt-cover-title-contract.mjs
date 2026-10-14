/** A native cover may express its bilingual title as a short headline plus
 * the complete original title in a measured subtitle. Notes alone do not count.
 * Actual subtitle completeness and fit are checked before confirmation. */
export function nativeCoverTitleHierarchy(project) {
  const cover=project.templateFidelity?.slides?.[0];
  return project.templateFidelity?.mode==='preserve'&&project.deckTitle?.source!=='user'&&
    !!project.source?.text?.match(/^#\s+.+$/mu)&&cover?.slots?.some(s=>s.role==='title')&&
    !cover.slots.some(s=>s.role==='content'||s.purpose==='subtitle');
}

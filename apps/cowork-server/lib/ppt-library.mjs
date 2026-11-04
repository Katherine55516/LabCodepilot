/** One persisted identity carries source/checkpoints and two independent views.
 * Deleting a task record never deletes a published presentation. */
export function hasPublishedPresentation(project){
 return Boolean(!project.presentationDeletedPermanentlyAt&&project.deck?.slides?.length&&(project.status==='completed'||Number(project.publishedRevision)>0));
}
export function libraryEligible(project){return !project.deletedAt&&hasPublishedPresentation(project);}
export function taskEligible(project){return !project.taskDeletedAt&&(!project.externalPptx||Boolean(project.version?.parentId));}

/** A published file uses one slot even during an edit. Unpublished ingest,
 * outline/confirmation and generation reserve a future file slot. Paused,
 * failed and cancelled records do not reserve one; resuming reacquires it. */
export function countsAgainstLibraryQuota(project){
 return !project.deletedAt&&!project.taskRecordOnly&&(hasPublishedPresentation(project)||['ingesting','outlining','input_ready','outline_ready','generating'].includes(project.status));
}

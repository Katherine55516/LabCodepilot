/** Generated presentations and unsuccessful/planning tasks are distinct.
 * A published prior version remains a presentation during an unsuccessful edit.
 * Legacy completed decks remain visible; a candidate outline is never a deck. */
export function libraryEligible(project){
 return Boolean(project.deck?.slides?.length&&(project.status==='completed'||Number(project.publishedRevision)>0));
}

/** A retained published file may also have a running or failed edit task. */
export function taskEligible(project){
 return !libraryEligible(project)||['ingesting','outlining','generating','paused','failed','quality_blocked'].includes(project.status);
}

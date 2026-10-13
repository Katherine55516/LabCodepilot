import type {PptProject} from '@/components/ppt/types';
/** The server owns classification; fallback only for older completed records. */
export function isLibraryPresentation(project:Pick<PptProject,'libraryEligible'|'status'|'publishedRevision'>){
 return project.libraryEligible??(project.status==='completed'||Number(project.publishedRevision)>0);
}

export function isPptTask(project:Pick<PptProject,'taskEligible'|'libraryEligible'|'status'|'publishedRevision'>){
 return project.taskEligible??(!isLibraryPresentation(project)||['ingesting','outlining','generating','paused','failed','quality_blocked'].includes(project.status));
}

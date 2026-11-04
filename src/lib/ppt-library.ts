import type {PptProject} from '@/components/ppt/types';
/** The server owns classification; fallback only for older completed records. */
export function isLibraryPresentation(project:Pick<PptProject,'libraryEligible'|'status'|'publishedRevision'|'deletedAt'|'presentationDeletedPermanentlyAt'>){
 return !project.deletedAt&&!project.presentationDeletedPermanentlyAt&&(project.libraryEligible??(project.status==='completed'||Number(project.publishedRevision)>0));
}

export function isPptTask(project:Pick<PptProject,'taskEligible'|'taskDeletedAt'>){
 return !project.taskDeletedAt&&(project.taskEligible??true);
}

import {libraryEligible} from './ppt-library.mjs';
const count=value=>Number.isInteger(value)&&value>=0?value:null;
/** Distinguish an estimate, accepted plan, current draft and published file. */
export function presentationPageCounts(project){
 const eligible=libraryEligible(project),verification=project.quality?.exportVerification;
 const verified=verification?.status==='passed'&&verification.revision===project.publishedRevision?count(verification.slides):null;
 const published=eligible?(count(project.publishedPageCount)??verified??count(project.publishedRenderTree?.slides?.length)??(project.revision===project.publishedRevision||project.status==='completed'?count(project.deck?.slides?.length):null)):0;
 return {estimated:count(project.pages),planned:project.outline?.length||0,confirmed:count(project.confirmedOutline?.pages)??(project.pageDecision?.confirmedAt?count(project.pages):null),draft:project.deck?.slides?.length||0,published};
}
export function presentationTimeline(project){
 const rows=[{stage:'created',at:project.createdAt}];
 const dag=project.dagNodes||{};
 for(const stage of ['source','outline','content','layout','quality','publish']){
  const node=dag[stage==='publish'?'publish:deck':stage]||dag[stage];
  if(stage==='publish'&&!libraryEligible(project))continue;
  const at=stage==='outline'?project.confirmedOutline?.confirmedAt||node?.completedAt:stage==='publish'?project.publishedAt||node?.completedAt:node?.completedAt;
  if(at&&Number.isFinite(Date.parse(at)))rows.push({stage,at});
 }
 return rows.filter(row=>row.at&&Number.isFinite(Date.parse(row.at)));
}

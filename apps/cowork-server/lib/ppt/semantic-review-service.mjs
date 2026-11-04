import {confirmReviewFindings} from './review-findings-confirmation.mjs';
import {confirmNegativeClaimAudits} from './claim-audit-confirmation.mjs';
import { reviewWithContractRepair } from '../ppt-quality.mjs';
import { bindReview, reviewIsCurrent } from './versioning.mjs';
import { editError } from './edit-context.mjs';

export async function reviewSemantic(project, deps, activity, log = () => {}) {
  const call=(prompt,nodeKey)=>deps.modelCall(project,prompt,activity,log,{nodeKey});
  if (reviewIsCurrent(project)) {
    if(!deps?.modelCall&&(['missing','repeated','conflicts','unsupported'].some(key=>project.quality.modelReview[key]?.length)||project.quality.modelReview.claimAudit?.checks?.some(c=>c.status!=='entailed')))throw editError('the selected model is required to confirm negative findings',503);
    const claims=await confirmNegativeClaimAudits(project,project.quality.modelReview,call);
    const confirmed=await confirmReviewFindings(project,claims,call);
    if(confirmed!==project.quality.modelReview)bindReview(project,confirmed);
    return project;
  }
  if (!deps?.modelCall) throw editError('the selected model is required to review the changed content', 503);
  const reviewStartedAt=new Date().toISOString();
  const normalized = await reviewWithContractRepair(project,call);
  const claims=await confirmNegativeClaimAudits(project,normalized,call);
  const review=await confirmReviewFindings(project,claims,call);
  bindReview(project, review,{reviewStartedAt,reviewCompletedAt:new Date().toISOString()});
  return project;
}

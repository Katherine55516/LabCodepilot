import { getProject, saveProject, saveRevision, enqueueProject } from './repository.mjs';
import { newId } from './ir.mjs';
import { reviewProject } from './quality-service.mjs';
import { renderImportedPptx } from './import-pptx.mjs';
import { reviewSemantic } from './semantic-review-service.mjs';
import { semanticReviewKey, reviewIsCurrent } from './versioning.mjs';
import { cardsFlow } from '../ppt-flow.mjs';
import { finalQualityReport } from '../ppt-quality.mjs';
import { blockExportVerification } from '../ppt-export-integrity.mjs';
import { renderWithPageFallback } from '../ppt-export-fallback.mjs';
import {prepareNativeExportFrames} from '../ppt-native-text-fit.mjs';

export async function publishProject(uid, projectId, deps, activity, log) {
  const operationId=newId('publication');
  const snapshot=await enqueueProject(uid,projectId,()=>{
    const p=getProject(uid,projectId);
    if(!p||p.deletedAt||!['completed','quality_blocked'].includes(p.status))throw Object.assign(new Error('project is not ready to publish'),{statusCode:409});
    const active=p.runtime?.publication;
    if(active?.pid===process.pid&&['reviewing','publishing'].includes(active.phase))throw Object.assign(new Error('publication already in progress'),{statusCode:409});
    // A generation blocked before its first export has revision zero. The
    // editor's explicit publish must create the same first revision as the
    // generation path; zero is deliberately treated as unpublished by clients.
    p.revision=Math.max(1,Number(p.revision||0));p.draftRevision=p.revision;
    prepareNativeExportFrames(p);
    p.runtime ||= {};p.runtime.publication={id:operationId,pid:process.pid,revision:p.revision,phase:'reviewing',startedAt:new Date().toISOString()};
    saveProject(p);return p;
  });
  const inputHash=semanticReviewKey(snapshot);
  let completion='failed';
  try {
    // D3: a card deck publishes without a model review; an AI check the author
    // ran on this content stays as review notes (aiCheckProject).
    if(!cardsFlow(snapshot))await reviewSemantic(snapshot,deps,activity,log);
    else if(!reviewIsCurrent(snapshot))snapshot.quality={...(snapshot.quality||{}),modelReview:{evaluation:'not_evaluated',basis:'on_demand',missing:[],repeated:[],conflicts:[],unsupported:[]}};
    const result=await enqueueProject(uid,projectId,()=>publishLocked(uid,projectId,deps,snapshot,inputHash));
    completion=result.published?'published':'blocked';return result;
  } finally {
    await enqueueProject(uid,projectId,()=>{
      const p=getProject(uid,projectId);
      if(p?.runtime?.publication?.id!==operationId)return;
      p.runtime.publication={...p.runtime.publication,phase:completion,completedAt:new Date().toISOString()};
      saveProject(p);
    });
  }
}

async function publishLocked(uid, projectId, deps, snapshot, inputHash) {
  let project = getProject(uid, projectId);
  if (!project) throw Object.assign(new Error('project not found'), { statusCode: 404 });
  if (!['completed', 'quality_blocked'].includes(project.status) || project.deletedAt) throw Object.assign(new Error('project is not ready to publish'), { statusCode: 409 });
  if (semanticReviewKey(project) !== inputHash) throw Object.assign(new Error('content changed during review; publish again'), { statusCode: 409 });
  project.runtime ||= {};if(project.runtime.publication?.id===snapshot.runtime?.publication?.id)project.runtime.publication.phase='publishing';
  saveProject(project);
  project.quality = snapshot.quality;
  // An editor mutation invalidates the generation DAG review node. Publishing
  // performs a fresh review on a snapshot, so carry its validated result back
  // with the current revision instead of leaving a completed deck "pending".
  if(project.dagNodes?.['review:deck'])project.dagNodes['review:deck']={...project.dagNodes['review:deck'],status:'completed',error:null,result:project.quality.modelReview,inputHash,projectRevision:project.revision,
    ...(project.quality.reviewStartedAt?{startedAt:project.quality.reviewStartedAt}:{}),completedAt:project.quality.reviewCompletedAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  const reviewed = reviewProject(project);
  project = reviewed.project;
  // Native fidelity changes a rule's applicability at inspection time. It must
  // never remove findings here: a clean critic cannot override visible loss.
  project.quality = { ...(project.quality || {}), ...finalQualityReport(reviewed.deterministic, [], project.quality?.modelReview || { evaluation: 'not_evaluated', missing: [], repeated: [], conflicts: [], unsupported: [] }, {}, { judgedAdvisory: project.planningContract?.version === 3 }) };
  if (!project.quality.publishEligible) {
    project.status = 'quality_blocked'; project.stage = 'repair'; project.qualityBlockReason = 'checks'; project.error = 'PPT quality gate blocked publish';
    saveProject(project); return { project, published: false };
  }
  const output = `/workspace/published-${project.revision}-${newId('artifact')}.pptx`;
  // One automatic repair of the page an export failure names before it blocks (Fable 2026-11-02, G3).
  const render=current=>{const candidate={...current,renderOutput:output};return current.externalPptx?(deps.renderImportedPptx||renderImportedPptx)(candidate):deps.renderPptx(candidate);};
  try {
    await renderWithPageFallback(project,render);
  } catch(error) {
    blockExportVerification(project,error);saveProject(project);return {project,published:false};
  }
  project.publishedArtifactPath = output;
  delete project.renderUpgradePending;
  project.status = 'completed'; project.stage = 'completed'; project.error = '';
  project.publishedRevision = project.revision; project.publishedPageCount=project.deck.slides.length; project.publishedAt = new Date().toISOString();
  project.publishedRenderTree = project.renderTree;
  saveProject(project); saveRevision(project, 'publish');
  return { project, published: true };
}

/** AI check (D3): the model review of a card deck, run when the author asks.
 * Its findings are review notes (tierCardDeckModelIssues); the deck's status
 * and publication do not change. */
export async function aiCheckProject(uid, projectId, deps, activity, log) {
  const snapshot=await enqueueProject(uid,projectId,()=>{
    const p=getProject(uid,projectId);
    if(!p||p.deletedAt||!['completed','quality_blocked'].includes(p.status))throw Object.assign(new Error('the deck is not ready for an AI check'),{statusCode:409});
    if(!cardsFlow(p))throw Object.assign(new Error('the AI check is for card decks; other decks are reviewed when they publish'),{statusCode:409});
    return structuredClone(p);
  });
  const inputHash=semanticReviewKey(snapshot);
  if(reviewIsCurrent(snapshot))return {project:snapshot,checked:false};
  await reviewSemantic(snapshot,deps,activity,log);
  const project=await enqueueProject(uid,projectId,()=>{
    let p=getProject(uid,projectId);
    if(!p||semanticReviewKey(p)!==inputHash)throw Object.assign(new Error('the deck changed during the AI check; run it again'),{statusCode:409});
    p.quality={...(p.quality||{}),modelReview:snapshot.quality.modelReview,reviewState:snapshot.quality.reviewState,reviewInputHash:snapshot.quality.reviewInputHash,reviewerModel:snapshot.quality.reviewerModel,rubricVersion:snapshot.quality.rubricVersion,
      ...(snapshot.quality.reviewStartedAt?{reviewStartedAt:snapshot.quality.reviewStartedAt,reviewCompletedAt:snapshot.quality.reviewCompletedAt}:{})};
    const reviewed=reviewProject(p);p=reviewed.project;
    // Model-judged findings are review advisories the editor lists (apply or dismiss).
    p.quality={...(p.quality||{}),...finalQualityReport(reviewed.deterministic,[],p.quality.modelReview,{},{judgedAdvisory:true})};
    saveProject(p);return p;
  });
  return {project,checked:true};
}

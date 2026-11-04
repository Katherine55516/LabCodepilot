import {claimAuditFailures} from '../ppt-claim-semantics.mjs';
import { obligationRegistry, obligationFailures } from '../ppt-obligations.mjs';
import {inspectObjectIntegrity} from '../ppt-object-integrity.mjs';
import { reviewWithContractRepair } from '../ppt-quality.mjs';
import { inputFramework } from '../ppt-input-scope.mjs';
import { digest, editError } from './edit-context.mjs';
import {inspectSourceNumbers} from '../ppt-source-numbers.mjs';
import {cardsFlow} from '../ppt-flow.mjs';
const semantic = slide => ({ title: slide.title, nodes: (slide.nodes || []).map(node => ({ id: node.id, type: node.type, content: node.content })) });
function changedSlideIds(before, after) {
  const prior = new Map((before.deck?.slides || []).map(slide => [slide.id, digest(semantic(slide))]));
  const current=(after.deck?.slides || []).filter(slide => prior.get(slide.id) !== digest(semantic(slide))).map(slide => slide.id);
  return [...current,...[...prior.keys()].filter(id=>!after.deck?.slides.some(slide=>slide.id===id))];
}
function candidateHash(project, ids) {
  return digest({ frameworkHash: inputFramework(project).frameworkHash, template: project.templateSpec,
    slides: project.deck?.slides.filter(slide => ids.includes(slide.id)).map(semantic) });
}

/** Reject semantic drift before an AI candidate can become a saved proposal.
 * Compare semantic content only: style/position changes need no extra call. */
export async function assertCandidateScope(before, after, deps, activity, log = () => {}) {
  const changed = changedSlideIds(before, after);
  if (!changed.length) return { status: 'unchanged', frameworkHash: inputFramework(before).frameworkHash, changedSlideIds: [], candidateHash: candidateHash(after, []) };
  // A card deck's edit is checked by code on the pages it changes: numbers the
  // source does not have, objects lost and citations dropped, new against the
  // deck before the edit. The whole-deck model review (~160k characters per edit)
  // is the publication check (Fable 2026-10-25).
  if (cardsFlow(after)) {
    const key = issue => `${issue.code}:${issue.slideId}:${issue.message}`;
    const fresh = (beforeIssues, afterIssues) => { const old = new Set(beforeIssues.map(key)); return afterIssues.filter(issue => issue.severity === 'error' && changed.includes(issue.slideId) && !old.has(key(issue))); };
    const findings = [...fresh(inspectSourceNumbers(before), inspectSourceNumbers(after)), ...fresh(inspectObjectIntegrity(before).issues, inspectObjectIntegrity(after).issues)];
    for (const id of changed) {
      const was = before.deck?.slides?.find(slide => slide.id === id), now = after.deck?.slides?.find(slide => slide.id === id);
      const dropped = (was?.sourceRefs || []).filter(ref => !(now?.sourceRefs || []).includes(ref));
      if (was && now && dropped.length) findings.push({ code: 'citation_dropped', severity: 'error', slideId: id, message: `the edit drops source references ${dropped.slice(0, 5).join(', ')}` });
    }
    if (findings.length) throw editError('AI candidate changes facts, objects or citations of the source', 422, { findings });
    return { frameworkHash: inputFramework(before).frameworkHash, checkedSlideIds: [...changed], status: 'complete', coverage: 'deterministic_card', publicationReviewRequired: true,
      dependencySlideIds: [], dependencyHash: candidateHash(after, []), unchangedSlidesHash: candidateHash(after, after.deck.slides.filter(slide => !changed.includes(slide.id)).map(slide => slide.id)),
      changedSlideIds: changed, obligationRegistryHash: obligationRegistry(after).registryHash, candidateHash: candidateHash(after, changed) };
  }
  if (!deps?.modelCall) throw editError('the selected model is required for the input scope audit', 503);
  // The candidate never contributes new source authority to its own audit.
  const candidate = { ...after, prompt: before.prompt, source: before.source, generationPolicy: before.generationPolicy, importedInputScope: before.importedInputScope, update: before.update };
  let auditView=candidate;
  const allSlides=candidate.deck.slides;
  const partialLive=['generating','paused','failed'].includes(before.status)&&(before.outline||[]).some(s=>before.nodes?.[s.id]?.status!=='done');
  if((allSlides.length>=20||partialLive)&&changed.length<allSlides.length/2){
    const ids=new Set(changed),entries=obligationRegistry(candidate).entries;
    // Include every page jointly carrying a changed-page obligation. Unowned
    // global obligations remain in the separate whole-deck publish audit.
    let expanded=true;while(expanded){expanded=false;for(const entry of entries)if(entry.slideIds.some(id=>ids.has(id)))for(const id of entry.slideIds)if(!ids.has(id)){ids.add(id);expanded=true;}}
    const selected=entries.filter(entry=>entry.slideIds.some(id=>ids.has(id))).map(entry=>entry.id);
    // Measure object retention against the complete candidate before taking a
    // local view, as the production page-batch reviewer already does. Objects
    // carried by unchanged pages must not become fictitious missing objects.
    const fullObjectCoverage=inspectObjectIntegrity(candidate).ledger.objects.filter(o=>[...(o.plannedSlideIds||[]),...(o.renderedSlideIds||[])].some(id=>ids.has(id)));
    auditView={...candidate,reviewScope:{mode:'candidate_delta',obligationIds:selected,fullObjectCoverage},deck:{...candidate.deck,slides:allSlides.filter(slide=>ids.has(slide.id))},planning:{...candidate.planning,slidePlan:(candidate.planning?.slidePlan||[]).filter(plan=>ids.has(plan.slideId))}};
  }
  let review;
  try { review = await reviewWithContractRepair(auditView,(prompt,nodeKey)=>deps.modelCall(auditView,prompt,activity,log,{nodeKey}),{nodeKey:'review:deck:local-scope:candidate',partition:false}); }
  catch (error) { throw editError(`candidate input scope audit failed: ${error.message}`, 422); }
  const findings = [...review.unsupported, ...review.conflicts, ...review.repeated].filter(item => item.slideIds.some(id => changed.includes(id)));
  const mandatoryFindings=[...obligationFailures(review.obligationAudit),...claimAuditFailures(review.claimAudit)];
  if (review.evaluation === 'not_evaluated' || findings.length || mandatoryFindings.length)
    throw editError('AI candidate exceeds or has not verified the original input framework', 422, { findings:[...findings,...mandatoryFindings], scopeAudit: review.scopeAudit });
  const dependencySlideIds=auditView===candidate?[]:auditView.deck.slides.filter(slide=>!changed.includes(slide.id)).map(slide=>slide.id);
  return { ...review.scopeAudit, coverage:auditView===candidate?'whole_deck':'changed_and_dependency_pages',publicationReviewRequired:true,dependencySlideIds,dependencyHash:candidateHash(after,dependencySlideIds),unchangedSlidesHash:candidateHash(after,allSlides.filter(slide=>!changed.includes(slide.id)).map(slide=>slide.id)), changedSlideIds: changed, obligationRegistryHash:obligationRegistry(candidate).registryHash, candidateHash: candidateHash(after, changed) };
}

export function assertStoredCandidateScope(before, after, proposal) {
  if (!changedSlideIds(before,after).length) return;
  if (!['complete', 'unchanged'].includes(proposal.scopeAudit?.status) ||
      proposal.scopeAudit.frameworkHash !== inputFramework(before).frameworkHash ||
      proposal.scopeAudit.obligationRegistryHash !== obligationRegistry(after).registryHash ||
      digest(proposal.scopeAudit.changedSlideIds) !== digest(changedSlideIds(before, after)) ||
      proposal.scopeAudit.candidateHash !== candidateHash(after, proposal.scopeAudit.changedSlideIds) ||
      proposal.scopeAudit.dependencyHash && proposal.scopeAudit.dependencyHash!==candidateHash(after,proposal.scopeAudit.dependencySlideIds||[]))
    throw editError('the candidate input scope audit is missing or stale; preview again', 409);
}

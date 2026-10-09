import { obligationRegistry, obligationFailures } from '../ppt-obligations.mjs';
import { deckReviewPrompt, normalizeModelReview } from '../ppt-quality.mjs';
import { inputFramework } from '../ppt-input-scope.mjs';
import { digest, editError } from './edit-context.mjs';
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
  if (!deps?.modelCall) throw editError('the selected model is required for the input scope audit', 503);
  // The candidate never contributes new source authority to its own audit.
  const candidate = { ...after, prompt: before.prompt, source: before.source, generationPolicy: before.generationPolicy, importedInputScope: before.importedInputScope, update: before.update };
  const raw = await deps.modelCall(candidate, deckReviewPrompt(candidate), activity, log, { nodeKey: 'review:scope:candidate' });
  let review;
  try { review = normalizeModelReview(raw, candidate.deck.slides.map(slide => slide.id), candidate); }
  catch (error) { throw editError(`candidate input scope audit failed: ${error.message}`, 422); }
  const findings = [...review.unsupported, ...review.conflicts, ...review.repeated].filter(item => item.slideIds.some(id => changed.includes(id)));
  const mandatoryFindings=obligationFailures(review.obligationAudit);
  if (review.evaluation === 'not_evaluated' || findings.length || mandatoryFindings.length)
    throw editError('AI candidate exceeds or has not verified the original input framework', 422, { findings:[...findings,...mandatoryFindings], scopeAudit: review.scopeAudit });
  return { ...review.scopeAudit, changedSlideIds: changed, obligationRegistryHash:obligationRegistry(candidate).registryHash, candidateHash: candidateHash(after, changed) };
}

export function assertStoredCandidateScope(before, after, proposal) {
  if (!changedSlideIds(before,after).length) return;
  if (!['complete', 'unchanged'].includes(proposal.scopeAudit?.status) ||
      proposal.scopeAudit.frameworkHash !== inputFramework(before).frameworkHash ||
      proposal.scopeAudit.obligationRegistryHash !== obligationRegistry(after).registryHash ||
      digest(proposal.scopeAudit.changedSlideIds) !== digest(changedSlideIds(before, after)) ||
      proposal.scopeAudit.candidateHash !== candidateHash(after, proposal.scopeAudit.changedSlideIds))
    throw editError('the candidate input scope audit is missing or stale; preview again', 409);
}

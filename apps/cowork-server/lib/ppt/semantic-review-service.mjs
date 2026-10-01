import { deckReviewPrompt, normalizeModelReview } from '../ppt-quality.mjs';
import { bindReview, reviewIsCurrent } from './versioning.mjs';
import { editError } from './edit-context.mjs';

export async function reviewSemantic(project, deps, activity, log = () => {}) {
  if (reviewIsCurrent(project) || project.externalPptx) return project;
  if (!deps?.modelCall) throw editError('the selected model is required to review the changed content', 503);
  const raw = await deps.modelCall(project, deckReviewPrompt(project), activity, log, { nodeKey: 'review:deck' });
  const review = normalizeModelReview(raw, project.deck.slides.map(slide => slide.id));
  bindReview(project, review);
  return project;
}

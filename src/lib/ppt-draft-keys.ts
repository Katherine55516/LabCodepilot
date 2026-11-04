/**
 * What a change in the PPT creation wizard invalidates.
 * - Input (text, file, images, fixed template content) is what the draft read:
 *   changing it needs a new reading, so the old draft is superseded.
 * - Plan (generation policy, template) is re-read or re-planned on the same
 *   draft; the server re-reads when the reading's identity changed.
 * - Title and model are metadata: they are applied to the draft and never
 *   discard its reading or outline, so they are not part of either key.
 */
export type DraftInput = {
  fileVersion: number; prompt: string; text: string; importMode: string; supplementMode: string;
  templateContentMode: string; templateFixedObjectIds: string[]; imageIds: string[];
};
export type DraftPlan = { policy: unknown; template: string; templateVersion?: number | string | null };

export const draftSourceKey = (input: DraftInput) => JSON.stringify([input.fileVersion, input.prompt, input.text, input.importMode, input.supplementMode,
  input.templateContentMode, input.templateFixedObjectIds, input.imageIds]);
export const draftPlanKey = (plan: DraftPlan) => JSON.stringify([plan.policy, plan.template, plan.templateVersion ?? null]);
/** The reading's page estimate depends on every plan choice except depth, which re-plans within it. */
export const draftEstimateKey = (plan: DraftPlan) => draftPlanKey({ ...plan, policy: plan.policy && typeof plan.policy === 'object' ? { ...plan.policy, detail: undefined } : plan.policy });

export type DraftState = { source: string; plan: string; pages: number | null } | null;

/** `stale`: the draft read other input; it must be discarded before reading again. */
export function draftChange(analyzed: DraftState, current: { source: string; plan: string; pages: number }, outlineReady: boolean) {
  const stale = Boolean(analyzed && analyzed.source !== current.source);
  const planChanged = Boolean(analyzed && analyzed.plan !== current.plan);
  return {
    stale,
    needsRead: !analyzed || stale || (!outlineReady && planChanged),
    needsReplan: Boolean(analyzed) && !stale && (analyzed!.pages !== current.pages || planChanged),
  };
}

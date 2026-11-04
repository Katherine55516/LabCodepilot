/** Client mirror of apps/cowork-server/lib/ppt-failure-origin.mjs, used for
 * failures saved before the server persisted `failure.origin`. Keep the two in
 * sync; ppt-failure-origin.test.ts runs the same fixture table on both. */
export const FAILURE_ORIGINS = ['model_transport','model_contract','local_capacity','local_coverage','budget','quality','user_cancel','unknown'] as const;
export type PptFailureOrigin = typeof FAILURE_ORIGINS[number];
const TRANSPORT = new Set(['transport','timeout','network','rate_limit','request_invalid','auth','model_unavailable','model_not_found','input_budget']);
const MODEL_OUTPUT = new Set(['invalid_json','truncated_output','empty_visible_output']);
const BUDGET = new Set(['execution_budget','execution_repair_limit','execution_attempt_limit']);
const QUALITY = new Set(['content_invalid','render_invalid','review_invalid','quality_blocked']);
// Validators that judge a model response (not the source or the template).
const MODEL_STEP = /^(?:node \d+: )?(?:ppt_)?(?:semantic_groups_invalid|semantic_editorial_invalid|native_title_delta_invalid|source_graph_audit_invalid|navigation_plan_invalid|input_understanding_invalid|content_selection_invalid|schema_invalid|invalid_json|outline_subject_conflict: outline subject audit)/u;
const CAPACITY = /capacity|overflow|cannot fit|page budget/iu;

export function failureOrigin({ stage = '', code = '', message = '', error = null }: { stage?: string; code?: string; message?: string; error?: { origin?: string; message?: string } | null } = {}): PptFailureOrigin {
  if (error?.origin && (FAILURE_ORIGINS as readonly string[]).includes(error.origin)) return error.origin as PptFailureOrigin;
  const text = String(message || error?.message || '');
  if (code === 'cancelled' || /^ppt_cancelled\b/u.test(text)) return 'user_cancel';
  if (BUDGET.has(code)) return 'budget';
  if (TRANSPORT.has(code)) return 'model_transport';
  if (MODEL_OUTPUT.has(code) || MODEL_STEP.test(text)) return 'model_contract';
  if (code === 'capacity_invalid' || CAPACITY.test(text) && code !== 'coverage_invalid') return 'local_capacity';
  if (code === 'coverage_invalid') return 'local_coverage';
  if (QUALITY.has(code) || stage === 'generation' && code === 'schema_invalid') return 'quality';
  if (code === 'schema_invalid') return 'model_contract';
  return 'unknown';
}

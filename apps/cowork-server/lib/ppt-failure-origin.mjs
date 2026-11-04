/** Where a failure came from, so diagnostics never describe a model contract
 * miss or a generation budget as a local layout problem. The error code alone
 * is ambiguous: model-step validators reuse coverage_invalid/schema_invalid.
 * Mirrored by src/lib/ppt-failure-origin.ts for records saved before origin
 * was persisted; both share the fixture table in the unit test. */
export const FAILURE_ORIGINS = Object.freeze(['model_transport','model_contract','local_capacity','local_coverage','budget','quality','user_cancel','unknown']);
const TRANSPORT = new Set(['transport','timeout','network','rate_limit','request_invalid','auth','model_unavailable','model_not_found','input_budget']);
const MODEL_OUTPUT = new Set(['invalid_json','truncated_output','empty_visible_output']);
const BUDGET = new Set(['execution_budget','execution_repair_limit','execution_attempt_limit']);
const QUALITY = new Set(['content_invalid','render_invalid','review_invalid','quality_blocked']);
// Validators that judge a model response (not the source or the template).
const MODEL_STEP = /^(?:node \d+: )?(?:ppt_)?(?:semantic_groups_invalid|semantic_editorial_invalid|native_title_delta_invalid|source_graph_audit_invalid|navigation_plan_invalid|input_understanding_invalid|content_selection_invalid|schema_invalid|invalid_json|outline_subject_conflict: outline subject audit)/u;
const CAPACITY = /capacity|overflow|cannot fit|page budget/iu;

export function failureOrigin({ stage = '', code = '', message = '', error = null } = {}) {
  if (FAILURE_ORIGINS.includes(error?.origin)) return error.origin;
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

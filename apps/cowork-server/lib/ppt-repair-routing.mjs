/** Layered repair routing: every quality issue names the layer that owns it
 * and the operations allowed there, so geometry problems are not "fixed" by
 * rewriting copy and content gaps are not hidden by shrinking type.
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md (D). */

// First match wins; specific codes come before broad keywords.
const ROUTES = [
  [/^(model_unsupported|model_conflict|numeric_source|source_unsupported|source_number_unsupported|scope_)/u, 'scope', 'remove_or_source', ['rewrite_with_source', 'remove_unsupported_claim']],
  [/^(relation_|page_contract_adjacency)/u, 'semantic', 'restore_relation', ['change_prototype', 'regroup', 'restore_order']],
  [/^big_number_without_source_value$/u, 'composition', 'change_prototype', ['change_prototype', 'bind_sourced_value']],
  [/^(model_missing|mandatory_content|page_contract_unit_missing|source_structure_or_detail_missing|source_end_section_missing|required_source_object|content_depth|rich_source)/u, 'content', 'restore_source_units', ['rewrite_with_source', 'regroup', 'split_proposal']],
  [/(repeat|duplicate|redundan|copy_|filler)/u, 'content', 'deduplicate', ['remove_duplicate', 'replace_with_distinct_source']],
  [/^(planned_|plan_|page_count|density_outline|long_deck)/u, 'plan', 'reallocate', ['regroup', 'reallocate_pages', 'split_proposal']],
  [/(media|image|asset|crop)/u, 'media', 'rebind_media', ['rebind', 'restore_asset', 'change_crop']],
  [/(contrast|palette|theme|^font_)/u, 'theme', 'adjust_token', ['adjust_unbound_token', 'report_binding_conflict']],
  [/(export|pptx|pdf|verification|^math_)/u, 'export', 'rerender', ['rerender', 'fix_runtime']],
  [/(overflow|capacity|fit|collision|overlap|layout|title|point|table_cell|text_box|density|template_)/u, 'composition', 'recompose', ['change_prototype', 'resize_region', 'reflow', 'split_proposal', 'bounded_scale']],
];

export function routeIssue(code = '') {
  const route = ROUTES.find(([pattern]) => pattern.test(String(code)));
  return route ? { ownerLayer: route[1], repairKind: route[2], allowedOperations: route[3] } : { ownerLayer: 'review', repairKind: 'manual_review', allowedOperations: [] };
}
export function annotateIssue(issue) {
  return issue?.ownerLayer ? issue : { ...issue, ...routeIssue(issue?.code) };
}
export const annotateIssues = issues => (issues || []).map(annotateIssue);

/** Explicit theme bindings forbid automatic token changes during repair. */
export function themeBound(project) {
  return project?.bindings?.theme === true || project?.templateSpec?.palette?.locked === true;
}

const hardKeys = review => new Set((review?.issues || []).filter(item => item.severity === 'error').map(item => `${item.code}\u0000${item.slideId || ''}`));
/** Hard errors introduced by a repair candidate (absent before it). */
export function newHardErrors(before, after) {
  const prior = hardKeys(before);
  return (after?.issues || []).filter(item => item.severity === 'error' && !prior.has(`${item.code}\u0000${item.slideId || ''}`));
}

/** Layered repair routing: every quality issue names the layer that owns it
 * and the operations allowed there, so geometry problems are not "fixed" by
 * rewriting copy and content gaps are not hidden by shrinking type.
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md (D). */

// First match wins; specific codes come before broad keywords.
const ROUTES = [
  [/^(model_unsupported|model_conflict|numeric_source|source_unsupported|source_number_unsupported|scope_)/u, 'scope', 'remove_or_source', ['rewrite_with_source', 'remove_unsupported_claim']],
  [/^(relation_|page_contract_adjacency)/u, 'semantic', 'restore_relation', ['change_prototype', 'regroup', 'restore_order']],
  [/^page_contract_structure_waiver$/u, 'plan', 'restore_obligation', ['regroup', 'reallocate_pages', 'split_proposal']],
  [/^math_layout_capacity$/u, 'composition', 'recompose', ['resize_region', 'reflow', 'change_prototype', 'split_proposal']],
  [/^title_overflow$/u, 'composition', 'select_title_candidate', ['select_title_candidate', 'reflow', 'change_prototype']],
  [/^big_number_without_source_value$/u, 'composition', 'change_prototype', ['change_prototype', 'bind_sourced_value']],
  [/^(model_missing|mandatory_content|page_contract_unit_missing|page_contract_qualifier_missing|source_structure_or_detail_missing|source_end_section_missing|required_source_object|content_depth|rich_source)/u, 'content', 'restore_source_units', ['rewrite_with_source', 'regroup', 'split_proposal']],
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

const listTargets = issue => new Set(['nodeIds','sourceUnitIds','values','missingSupport','numericFindings'].flatMap(key=>(issue[key]||[]).map(value=>`${key}:${JSON.stringify(value)}`)));
const magnitude = issue => Math.max(0,...['overflowPt','overflowHeightPt','excess','count','missingCount'].map(key=>Number(issue[key])||0),Number(issue.details?.estimatedHeightPt||0)-Number(issue.details?.availableHeightPt||0));
export function worseningErrors(before,after) {
  return (after?.issues||[]).filter(issue=>issue.severity==='error' && (before?.issues||[]).some(prior=>{
    if(prior.severity!=='error'||prior.code!==issue.code||prior.slideId!==issue.slideId)return false;
    const old=listTargets(prior);return [...listTargets(issue)].some(key=>!old.has(key)) || magnitude(issue)>magnitude(prior)
      || typeof issue.coverage==='number' && typeof prior.coverage==='number' && issue.coverage<prior.coverage;
  }));
}
const snapshot=slide=>JSON.stringify({title:slide.title,bullets:slide.bullets,blocks:slide.blocks,layoutId:slide.layoutId,layoutRef:slide.layoutRef,
  nodes:slide.nodes,locked:slide.locked,titleLocked:slide.titleLocked});
const presentationState=node=>JSON.stringify({geometry:node.geometry,style:node.style,zIndex:node.zIndex,rotation:node.rotation,hidden:node.hidden,groupId:node.groupId});
/** Guard the actual candidate, rather than trusting operation labels in a prompt. */
export function validateRepairCandidate(before,after,{scopeSlideIds=[],operation,issues=[],beforeReview,afterReview}={}) {
  const failures=[], scope=new Set(scopeSlideIds), old=new Map((before.deck?.slides||[]).map(x=>[x.id,x]));
  for(const slide of after.deck?.slides||[]) {
    const prior=old.get(slide.id);if(!prior){failures.push({code:'repair_page_added',slideId:slide.id});continue;}old.delete(slide.id);
    if(snapshot(prior)===snapshot(slide))continue;
    if(scope.size&&!scope.has(slide.id))failures.push({code:'repair_scope_changed',slideId:slide.id});
    if(prior.locked||before.runtime?.slides?.[slide.id]?.accepted||before.constraints?.entries?.some(x=>x.active&&(x.slideId===slide.id||x.slideIds?.includes(slide.id))))failures.push({code:'repair_locked_slide',slideId:slide.id});
    for(const node of prior.nodes||[])if(node.locked && JSON.stringify(node)!==JSON.stringify(slide.nodes?.find(x=>x.id===node.id)))failures.push({code:'repair_locked_node',slideId:slide.id,nodeId:node.id});
    if(prior.titleLocked&&prior.title!==slide.title)failures.push({code:'repair_locked_title',slideId:slide.id});
    // Copy repair cannot change an existing medium's identity, crop or geometry.
    if(['rewrite_with_source','remove_unsupported_claim','remove_duplicate','replace_with_distinct_source'].includes(operation)) {
      if(prior.layoutId!==slide.layoutId||prior.layoutRef!==slide.layoutRef)failures.push({code:'repair_cross_layer_layout',slideId:slide.id});
      const media=nodes=>(nodes||[]).filter(node=>['image','chart','table','foreign'].includes(node.type));
      if(JSON.stringify(media(prior.nodes))!==JSON.stringify(media(slide.nodes)))failures.push({code:'repair_cross_layer_media',slideId:slide.id});
      for(const node of prior.nodes||[]) {
        const next=slide.nodes?.find(x=>x.id===node.id);
        if(next&&presentationState(node)!==presentationState(next))failures.push({code:'repair_cross_layer_composition',slideId:slide.id,nodeId:node.id});
      }
    }
  }
  for(const id of old.keys())failures.push({code:'repair_page_deleted',slideId:id});
  if(themeBound(before)&&JSON.stringify(before.templateSpec?.palette)!==JSON.stringify(after.templateSpec?.palette))failures.push({code:'repair_bound_theme'});
  if(operation&&issues.length&&issues.some(x=>!routeIssue(x.code).allowedOperations.includes(operation)))failures.push({code:'repair_operation_not_allowed',operation});
  if(beforeReview&&afterReview)failures.push(...newHardErrors(beforeReview,afterReview).map(x=>({code:'repair_new_hard_error',finding:x})),...worseningErrors(beforeReview,afterReview).map(x=>({code:'repair_worsened_error',finding:x})));
  return failures;
}

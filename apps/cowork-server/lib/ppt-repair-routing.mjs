/** Layered repair routing: every quality issue names the layer that owns it
 * and the operations allowed there, so geometry problems are not "fixed" by
 * rewriting copy and content gaps are not hidden by shrinking type.
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md (D). */

// First match wins; specific codes come before broad keywords.
const ROUTES = [
  [/^(rendered_title_capacity|fragment_title_mismatch|missing_semantic_title)$/u, 'content', 'rewrite_title', ['rewrite_with_source', 'select_title_candidate']],
  [/^(cover_source_title_incomplete|title_language_inconsistent|terminology_drift)$/u, 'content', 'rewrite_title', ['rewrite_with_source', 'select_title_candidate']],
  [/^explanation_restates_source$/u, 'content', 'deduplicate', ['remove_duplicate', 'rewrite_with_source']],
  [/^(layout_reading_order_broken|code_line_wrapped)$/u, 'composition', 'recompose', ['change_prototype', 'regroup', 'split_proposal']],
  [/^(visible_source_markup|raw_table_as_prose|workflow_sentence_fragment)$/u, 'content', 'restore_source_units', ['rewrite_with_source', 'change_prototype', 'regroup']],
  [/^(source_code_scope_conflict|claim_entailment_|model_unsupported|model_conflict|numeric_source|source_unsupported|source_number_unsupported|scope_)/u, 'scope', 'remove_or_source', ['rewrite_with_source', 'remove_unsupported_claim']],
  [/^(relation_|page_contract_adjacency)/u, 'semantic', 'restore_relation', ['change_prototype', 'regroup', 'restore_order']],
  [/^page_contract_structure_waiver$/u, 'plan', 'restore_obligation', ['regroup', 'reallocate_pages', 'split_proposal']],
  [/^math_layout_capacity$/u, 'composition', 'recompose', ['resize_region', 'reflow', 'change_prototype', 'split_proposal']],
  [/^title_overflow$/u, 'composition', 'select_title_candidate', ['select_title_candidate', 'reflow', 'change_prototype']],
  [/^big_number_without_source_value$/u, 'composition', 'change_prototype', ['change_prototype', 'bind_sourced_value']],
  [/^(required_evidence_missing|template_required_detail_missing|template_content_unrendered|model_missing|mandatory_content|page_contract_unit_missing|page_contract_qualifier_missing|source_structure_or_detail_missing|source_end_section_missing|required_source_object|content_depth|rich_source)/u, 'content', 'restore_source_units', ['rewrite_with_source', 'regroup', 'split_proposal']],
  [/^(claim_multiple_primary_owners)$/u, 'content', 'deduplicate', ['remove_duplicate', 'replace_with_distinct_source']],
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
    // Distinct details, rows and slots are distinct findings. A candidate that
    // leaves one unchanged must not be compared with another finding's score.
    if(['detailIndex','blockIndex','shapeId','sourceUnitId','claimId'].some(key=>
      (prior[key]!==undefined||issue[key]!==undefined)&&prior[key]!==issue[key]))return false;
    const old=listTargets(prior);return [...listTargets(issue)].some(key=>!old.has(key)) || magnitude(issue)>magnitude(prior)
      || typeof issue.coverage==='number' && typeof prior.coverage==='number' && issue.coverage<prior.coverage;
  }));
}
const snapshot=slide=>JSON.stringify({title:slide.title,bullets:slide.bullets,blocks:slide.blocks,layoutId:slide.layoutId,layoutRef:slide.layoutRef,
  nodes:slide.nodes,locked:slide.locked,titleLocked:slide.titleLocked});
const presentationState=node=>JSON.stringify({geometry:node.geometry,style:node.style,zIndex:node.zIndex,rotation:node.rotation,hidden:node.hidden,groupId:node.groupId});
function illustrationReferenceOnly(prior,next,priorSlide,nextSlide){
  const record=next?.optionalIllustrationRebind,old=prior?.templateComponentBinding,binding=next?.templateComponentBinding;
  if(record?.version!==1||!old||!binding||!['image','shape'].includes(prior.type)||!prior.nativeRef||prior.sourceArtifact||prior.content?.mustPreserve||prior.content?.sourceEvidenceIds?.length||old.unitIndex!==record.fromUnitIndex||binding.unitIndex!==record.toUnitIndex||!Array.isArray(record.removedNodeIds)||!record.removedNodeIds.length)return false;
  const anchor=nextSlide.nodes?.find(node=>node.id===record.sourceAnchorNodeId),originalAnchor=priorSlide.nodes?.find(node=>node.id===record.sourceAnchorNodeId);
  if(!anchor?.sourceArtifact||!originalAnchor?.sourceArtifact||anchor.semanticComponentBinding?.unitIndex!==record.toUnitIndex||JSON.stringify(anchor.content)!==JSON.stringify(originalAnchor.content)||nextSlide.nodes?.some(node=>node.semanticComponentBinding?.unitIndex===record.fromUnitIndex))return false;
  if(!record.removedNodeIds.some(id=>{const node=priorSlide.nodes?.find(node=>node.id===id);return node&&!node.locked&&!node.sourceArtifact&&!node.content?.derivedFrom&&!node.content?.sourceEvidenceIds?.length&&node.semanticRole==='source-explanation'&&node.semanticComponentBinding?.unitIndex===record.fromUnitIndex&&!nextSlide.nodes?.some(after=>after.id===id);}))return false;
  const stripped=node=>{const copy=structuredClone(node);delete copy.optionalIllustrationRebind;if(copy.templateComponentBinding){delete copy.templateComponentBinding.unitIndex;delete copy.templateComponentBinding.purpose;}return JSON.stringify(copy);};
  return stripped(prior)===stripped(next);
}
/** Copy repair uses the actual current deck frame, not an older writer cache.
 * Only source-owned text reflows; original artwork and header typography stay
 * frozen. The resulting candidate still passes all repair/quality guards. */
export function preserveCopyRepairFrame(prior,target){
  target.layoutId=prior.layoutId;target.layoutRef=prior.layoutRef;
  const source=node=>node.sourceArtifact||['source-explanation','source-structure'].includes(node.semanticRole);
  const frame=new Map((prior.nodes||[]).filter(node=>node.locked||!source(node)&&['image','chart','foreign','shape'].includes(node.type)).map(node=>[node.id,node]));
  target.nodes=(target.nodes||[]).map(node=>frame.has(node.id)?structuredClone(frame.get(node.id)):node);
  for(const [id,node]of frame)if(!target.nodes.some(next=>next.id===id))target.nodes.push(structuredClone(node));
  for(const node of target.nodes){
    const old=prior.nodes?.find(previous=>previous.id===node.id);if(!old||source(old))continue;
    for(const key of ['geometry','style','styleRef','zIndex','rotation','hidden','groupId']){
      if(Object.hasOwn(old,key))node[key]=structuredClone(old[key]);else delete node[key];
    }
  }
  return target;
}
/** Guard the actual candidate, rather than trusting operation labels in a prompt. */
export function validateRepairCandidate(before,after,{scopeSlideIds=[],operation,issues=[],beforeReview,afterReview}={}) {
  const failures=[], scope=new Set(scopeSlideIds), old=new Map((before.deck?.slides||[]).map(x=>[x.id,x]));
  for(const slide of after.deck?.slides||[]) {
    const prior=old.get(slide.id);if(!prior){failures.push({code:'repair_page_added',slideId:slide.id});continue;}old.delete(slide.id);
    if(snapshot(prior)===snapshot(slide))continue;
    if(scope.size&&!scope.has(slide.id))failures.push({code:'repair_scope_changed',slideId:slide.id});
    if(prior.locked||before.runtime?.slides?.[slide.id]?.accepted||before.constraints?.entries?.some(x=>x.active&&(x.slideId===slide.id||x.slideIds?.includes(slide.id))))failures.push({code:'repair_locked_slide',slideId:slide.id});
    for(const node of prior.nodes||[])if(node.locked && JSON.stringify(node)!==JSON.stringify(slide.nodes?.find(x=>x.id===node.id))&&!illustrationReferenceOnly(node,slide.nodes?.find(x=>x.id===node.id),prior,slide))failures.push({code:'repair_locked_node',slideId:slide.id,nodeId:node.id});
    if(prior.titleLocked&&prior.title!==slide.title)failures.push({code:'repair_locked_title',slideId:slide.id});
    // Copy repair cannot change an existing medium's identity, crop or geometry.
    if(['rewrite_with_source','remove_unsupported_claim','remove_duplicate','replace_with_distinct_source'].includes(operation)) {
      if(prior.layoutId!==slide.layoutId||prior.layoutRef!==slide.layoutRef)failures.push({code:'repair_cross_layer_layout',slideId:slide.id});
      const media=nodes=>(nodes||[]).filter(node=>['image','chart','table','foreign'].includes(node.type));
      const afterMedia=media(slide.nodes).map(node=>{const old=prior.nodes?.find(n=>n.id===node.id);return illustrationReferenceOnly(old,node,prior,slide)?old:node;});
      if(JSON.stringify(media(prior.nodes))!==JSON.stringify(afterMedia))failures.push({code:'repair_cross_layer_media',slideId:slide.id});
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

/** A source writer and the deterministic text reflow are separate operations.
 * Validate content with the old presentation, then validate the final reflow.
 * Media, typography, locked nodes, page count, scope and hard-error guards stay
 * intact. Source-owned text/list frames and unchanged source tables may move.
 * Table weights are measured presentation, while cells and provenance remain
 * exact. They are projected back only for the independent content guard. */
export function validateSourceRewriteWithReflow(before,after,options={}) {
  const projection=structuredClone(after),priorSlides=new Map((before.deck?.slides||[]).map(slide=>[slide.id,slide]));
  const failures=[];
  for(const slide of projection.deck?.slides||[]) {
    const prior=priorSlides.get(slide.id);if(!prior)continue;
    for(const node of slide.nodes||[]) {
      const old=prior.nodes?.find(n=>n.id===node.id);if(!old)continue;
      const tableData=value=>{const data=structuredClone(value);for(const key of ['geometry','zIndex'])delete data[key];if(data.content)for(const key of ['rowWeights','columnWeights'])delete data.content[key];return data;};
      const exactSourceTable=node.type==='table'&&old.type==='table'&&Boolean(old.sourceArtifact?.sourceUnitId)&&
        JSON.stringify(tableData(old))===JSON.stringify(tableData(node));
      const weightsChanged=node.type==='table'&&JSON.stringify(old.content)!==JSON.stringify(node.content);
      if(presentationState(old)===presentationState(node)&&!weightsChanged)continue;
      if((!exactSourceTable&&(!['text','list','timeline'].includes(node.type)||!['source-explanation','source-structure'].includes(node.semanticRole)))||
        JSON.stringify(old.style)!==JSON.stringify(node.style)||old.rotation!==node.rotation||old.hidden!==node.hidden||old.groupId!==node.groupId)
        failures.push({code:'repair_reflow_outside_source_text',slideId:slide.id,nodeId:node.id});
      if(exactSourceTable)for(const key of ['rowWeights','columnWeights']){
        if(Object.hasOwn(old.content||{},key))node.content[key]=structuredClone(old.content[key]);else delete node.content[key];
      }
      for(const key of ['geometry','style','zIndex','rotation','hidden','groupId']){
        if(Object.hasOwn(old,key))node[key]=structuredClone(old[key]);else delete node[key];
      }
    }
  }
  failures.push(...validateRepairCandidate(before,projection,{scopeSlideIds:options.scopeSlideIds,operation:'rewrite_with_source'}));
  failures.push(...validateRepairCandidate(projection,after,{scopeSlideIds:options.scopeSlideIds,operation:'reflow'}));
  if(options.beforeReview&&options.afterReview)failures.push(...newHardErrors(options.beforeReview,options.afterReview).map(finding=>({code:'repair_new_hard_error',finding})),...worseningErrors(options.beforeReview,options.afterReview).map(finding=>({code:'repair_worsened_error',finding})));
  return failures;
}

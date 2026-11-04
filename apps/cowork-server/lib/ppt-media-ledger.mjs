import {validAdaptation}from'./ppt-template-dispositions.mjs';
import {nativeComponentSpecs,componentIconBackground} from './ppt-native-components.mjs';
import {contrastRatio} from './ppt-template-colors.mjs';
import {processCardPlan} from './ppt-process-cards.mjs';
import {diagramCoverage,diagramCardPlan} from './ppt-diagram-cards.mjs';
/** Media ledger: what each template/source medium was for and what happened
 * to it, summarised against the template's own media density. It measures
 * role conservation and runs of text-only pages; it never rewards adding
 * pictures for their own sake (evidence media come from the source only).
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md (C). */
import { visibleNodes } from './ppt-visible-content.mjs';
import { deckMediaMetrics, deckMediaIssues } from './ppt-deck-media-metrics.mjs';
import { FIGURE_TEXT_FLOOR_PT } from './ppt-card-figure-layout.mjs';

export const MEDIA_BUCKETS = ['evidence', 'brand', 'aid', 'decoration', 'unknown'];
const KEPT = new Set(['retained', 'replaced_verified']);
// Evidence must stay fully visible; decoration may be cropped to fit.
const CROP = { evidence: 'no-crop', brand: 'no-crop', aid: 'contain', decoration: 'adaptive', unknown: 'contain' };
export function mediaBucket(role, asset = {}) {
  if (asset.content?.mustPreserve || role === 'brand') return 'brand';
  if (['evidence', 'semanticDiagram', 'source'].includes(role)) return 'evidence';
  if (role === 'template_icon') return 'aid';
  if (['template_decoration', 'template_artwork', 'old_template_content'].includes(role)) return 'decoration';
  return 'unknown';
}
/** Classify actual visible instances. A background/icon is never evidence of
 * an explained relation. Native cards need both source coverage and fit. */
export function slideMedia(project,slide){
  const inventory=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
  return visibleNodes(slide).flatMap(node=>{
    const content=node.content||{},sourceId=node.sourceArtifact?.sourceUnitId;
    const item=inventory.find(item=>item.id===sourceId),base={slideId:slide.id,nodeId:node.id,sourceUnitIds:sourceId?[sourceId]:[],type:node.type};
    if(content.diagram&&item&&node.geometry){
      const coverage=diagramCoverage(item,node),fit=node.type==='list'?diagramCardPlan(content,node.geometry,node.style?.fontSizePt||18):null;
      if(coverage.complete&&coverage.rows.length&&(node.type==='chart'||fit?.overflow===false))return [{...base,bucket:'source_derived',componentType:content.diagram.kind,meaningful:true}];
      return [{...base,bucket:'source_derived',componentType:content.diagram.kind,meaningful:false,reason:'source_coverage_or_capacity'}];
    }
    if(content.processCards?.version===1&&sourceId&&node.geometry)return [{...base,bucket:'source_derived',componentType:'ordered-process',meaningful:content.items?.length===content.processCards.steps&&processCardPlan(content,node.geometry,node.style?.fontSizePt||18)?.overflow===false}];
    if(!['image','table','chart'].includes(node.type))return [];
    // The layout's page picture is decoration of the whole page (Fable G1).
    if(content.derivedFrom==='layout-picture')return [{...base,bucket:'decoration',componentType:'layout-picture',meaningful:false}];
    const role=content.mediaRole||node.templateMediaBinding?.role;
    const bucket=sourceId||content.sourceImageId?'evidence':mediaBucket(role,node);
    // Unknown pictures do not establish semantic media coverage. Tables and
    // charts retain their existing information role; object QA checks data.
    return [{...base,bucket,componentType:node.type,meaningful:['table','chart'].includes(node.type)||bucket==='evidence'}];
  });
}

export function buildMediaLedger(project, slides, objectLedger) {
  const fidelity = project.templateFidelity;
  const semanticEntries=slides.flatMap(slide=>slideMedia(project,slide));
  const sourceObjects = (objectLedger?.objects || []).filter(object => object.type === 'SourceImage')
    .map(object => ({ objectId: object.objectId, bucket: 'evidence', origin: 'source', status: object.status, required: true, cropPolicy: CROP.evidence, boundUnitIds: [] }));
  const content = slides.slice(1);
  let run = 0, longestTextOnlyRun = 0;
  for (const slide of content) { run = semanticEntries.some(entry=>entry.slideId===slide.id&&entry.meaningful) ? 0 : run + 1; longestTextOnlyRun = Math.max(longestTextOnlyRun, run); }
  if (fidelity?.mode === 'mapped' && fidelity.componentProfile) {
    const profile=fidelity.componentProfile;
    const entries=profile.assets.map(asset=>{
      const bindings=slides.flatMap(slide=>(slide.nodes||[]).filter(node=>node.templateMediaBinding?.assetId===asset.assetId).map(node=>({slideId:slide.id,nodeId:node.id,itemId:node.templateMediaBinding.itemId})));
      return {objectId:asset.assetId,origin:'template',role:asset.role,bucket:mediaBucket(asset.role),required:asset.required,cropPolicy:CROP[mediaBucket(asset.role)],boundUnitIds:[],bindings,status:bindings.length?'retained':asset.required?'missing':'not_selected',reason:bindings.length?'mapped_visual_aid':'optional template media not selected by composition'};
    });
    return {version:2,status:'profiled',basis:'mapped_component_profile',profileHash:profile.profileHash,entries:[...entries,...sourceObjects],semanticEntries,longestTextOnlyRun,templateMediaShare:profile.pages.slice(1).filter(p=>p.media.length).length/Math.max(1,profile.pages.length-1),buckets:null,conservation:null};
  }
  if (!fidelity?.slides?.length) return { version: 1, status: 'template_media_not_profiled', basis: project.templateFidelity ? 'template_without_slides' : 'mapped_or_builtin_template',
    entries: sourceObjects, semanticEntries,longestTextOnlyRun, templateMediaShare: null, buckets: null };
  const componentEntries=slides.flatMap(slide=>(slide.nodes||[]).filter(n=>n.templateComponentBinding).map(n=>({slideId:slide.id,nodeId:n.id,type:n.type,...n.templateComponentBinding,geometry:n.geometry})));
  const componentIssues=[];
  slides.forEach((slide,index)=>{const spec=fidelity.slides[index],prototypes=nativeComponentSpecs(spec,fidelity),groups=new Map();for(const node of slide.nodes||[]){const b=node.templateComponentBinding;if(!b)continue;const key=b.componentSpecId+':'+b.unitIndex;groups.set(key,[...(groups.get(key)||[]),node]);}
    const moved=new Set((slide.templateAdaptations||[]).filter(a=>['reanchored_card_icon','reanchored_table_row_icon'].includes(a.action)).map(a=>a.shapeId));
    for(const icon of (slide.nodes||[]).filter(n=>n.type==='image'&&n.content?.foregroundColor&&!n.templateComponentBinding&&moved.has(n.nativeRef?.shapeId))){
      const background=componentIconBackground(slide.nodes,icon,spec?.background||project.templateSpec?.palette?.background||'#ffffff');
      if(contrastRatio(icon.content.foregroundColor,background)<3)componentIssues.push({code:'native_component_contrast',severity:'error',slideId:slide.id,objectId:icon.id,message:'Reanchored native icon has insufficient contrast against its actual carrier/background.'});
    }
    for(const members of groups.values()){const b=members[0].templateComponentBinding,prototype=prototypes.find(p=>p.id===b.componentSpecId);if(!prototype)continue;
      if(!slide.nodes.some(n=>n.semanticComponentBinding?.unitIndex===b.unitIndex))componentIssues.push({code:'native_component_source_anchor_missing',severity:'error',slideId:slide.id,componentSpecId:b.componentSpecId,message:'Native component has no visible atomic source reading unit.'});
      const missing=prototype.nativeMembers.filter(m=>!members.some(n=>n.templateComponentBinding.originalShapeId===m.shapeId));if(missing.length)componentIssues.push({code:'native_component_member_missing',severity:'error',slideId:slide.id,componentSpecId:b.componentSpecId,message:'Whole native component lost members: '+missing.map(m=>m.shapeId).join(', ')});
      for(const image of members.filter(n=>n.type==='image'&&n.content?.foregroundColor)){
        const background=componentIconBackground(members,image,spec?.background||project.templateSpec?.palette?.background||'#ffffff');
        if(contrastRatio(image.content.foregroundColor,background)<3)componentIssues.push({code:'native_component_contrast',severity:'error',slideId:slide.id,objectId:image.id,message:'Monochrome icon has insufficient contrast against its actual retained carrier/background.'});
      }
    }
  });
  const weights={evidence:10,brand:10,aid:3,decoration:1,unknown:5};
  const entries = [...(objectLedger?.templateAssets || []).map(asset => {
    const spec = fidelity.slides[slides.findIndex(slide => slide.id === asset.slideId)];
    const node = spec?.nodes?.find(item => item.id === asset.objectId) || {};
    const bucket = mediaBucket(asset.role, node);
    return { objectId: asset.objectId, slideId: asset.slideId, origin: 'template', role: asset.role, bucket, status: asset.status,
      adaptationVerified:asset.status==='retired_by_adaptation'&&Boolean(slides.find(s=>s.id===asset.slideId)?.templateOmissions?.some(record=>String(record.shapeId)===String(node.nativeRef?.shapeId)&&validAdaptation(project,node,record,asset.role))),
      // A sample icon shown as a numbered marker is replaced in place only
      // when the marker is on the published page (Fable 2026-11-02, N1).
      markerShown:Boolean(slides.find(s=>s.id===asset.slideId)?.nodes?.some(item=>item.content?.derivedFrom==='sample-icon-marker'&&item.content.markerFor===String(node.nativeRef?.shapeId))),required: ['evidence', 'brand'].includes(bucket), cropPolicy: CROP[bucket], boundUnitIds: node.content?.boundUnitIds || [], ...(asset.reason ? { reason: asset.reason } : {}), ...(asset.approvalBasis ? { approvalBasis: asset.approvalBasis } : {}) };
  }), ...sourceObjects];
  const templateContent = fidelity.slides.slice(1);
  const templateMediaShare = templateContent.length ? templateContent.filter(spec => (spec.nodes || []).some(node => ['image', 'chart', 'table'].includes(node.type))).length / templateContent.length : 0;
  const buckets = Object.fromEntries(MEDIA_BUCKETS.map(bucket => {
    const list = entries.filter(entry => entry.origin === 'template' && entry.bucket === bucket);
    const kept = list.filter(entry => KEPT.has(entry.status)).length;
    return [bucket, { expected: list.length, kept, dropped: list.length - kept, reasons: [...new Set(list.filter(entry => !KEPT.has(entry.status)).map(entry => entry.reason).filter(Boolean))].slice(0, 4) }];
  }));
  const expected = ['aid', 'decoration', 'unknown'].reduce((n, bucket) => n + buckets[bucket].expected, 0);
  const kept = ['aid', 'decoration', 'unknown'].reduce((n, bucket) => n + buckets[bucket].kept, 0);
  // Every retired illustrative asset is listed with its page and reason; a
  // user-approved exclusion counts as resolved for the publish gate (MD-P0-3).
  const illustrative = entries.filter(entry => entry.origin === 'template' && ['aid', 'decoration', 'unknown'].includes(entry.bucket));
  const policyResolved=entry=>['design_only','keep_fixed'].includes(project.templateContentMode)&&entry.origin==='template'&&!entry.required&&entry.status==='retired_by_adaptation'&&(entry.role==='old_template_content'&&entry.bucket==='decoration'&&entry.approvalBasis==='design_only_template'||entry.adaptationVerified&&['aid','decoration'].includes(entry.bucket)&&['template_icon','template_decoration','template_artwork'].includes(entry.role)&&(['source_region_card_icon_avoidance','source_region_decoration_avoidance','source_region_artwork_avoidance','card_group_omitted','old_content_by_position'].includes(entry.approvalBasis)||entry.approvalBasis==='sample_icon_marker'&&entry.markerShown)||entry.adaptationVerified&&entry.approvalBasis==='layout_only_page');
  const retired = illustrative.filter(entry => !KEPT.has(entry.status) && entry.status !== 'excluded_by_user' && !policyResolved(entry))
    .map(entry => ({ objectId: entry.objectId, page: slides.findIndex(slide => slide.id === entry.slideId) + 1, role: entry.role, status: entry.status, reason: entry.reason || null, approvalBasis: entry.approvalBasis || null }));
  const approvedExclusions = illustrative.filter(entry => entry.status === 'excluded_by_user').length;
  // Object integrity has already checked each adaptation. A design-only
  // template deliberately retires old report evidence; this is an explicit
  // template-use policy, not a user exclusion or an equivalent new fact.
  const policyRetirements=illustrative.filter(policyResolved).length;
  const templateEntries=entries.filter(entry=>entry.origin==='template'),templateWeight=templateEntries.reduce((n,entry)=>n+weights[entry.bucket],0);
  // Deck-level coverage, picture repeats and frame use (2026-11-02, phase 1).
  // Layout page pictures (Fable G1): each page whose template layout has one
  // shows it, certified, unless the author deleted it.
  const layoutSpecs=slides.map((slide,index)=>({slide,key:fidelity.slides?.[index]?.layoutPicture})).filter(entry=>entry.key);
  const layoutShown=layoutSpecs.filter(({slide,key})=>(slide.nodes||[]).some(node=>node.content?.derivedFrom==='layout-picture'&&node.content.layoutPictureKey===key));
  const layoutPictures={expected:layoutSpecs.length,shown:layoutShown.length,deleted:layoutSpecs.filter(({slide,key})=>slide.layoutPictureDeleted===key).length,
    certified:layoutShown.filter(({slide})=>(slide.nodes||[]).some(node=>node.content?.derivedFrom==='layout-picture'&&node.content.pictureCertificate)).length};
  return { version: 2, status: 'profiled', deck: deckMediaMetrics(project, slides), layoutPictures, figurePlacements: figurePlacements(project, slides), entries, semanticEntries,buckets,componentEntries,componentIssues,roleWeightedEffectiveConservation:templateWeight?templateEntries.reduce((n,e)=>n+(KEPT.has(e.status)||e.status==='excluded_by_user'||policyResolved(e)?weights[e.bucket]:0),0)/templateWeight:null,roleWeightedConservation:templateWeight?templateEntries.reduce((n,e)=>n+(KEPT.has(e.status)?weights[e.bucket]:0),0)/templateWeight:null, longestTextOnlyRun, templateMediaShare: Math.round(templateMediaShare * 100) / 100,
    // Evidence and brand media are governed by object integrity (required);
    // conservation covers the template's illustrative roles.
    conservation: expected ? Math.round(kept / expected * 100) / 100 : null,
    effectiveConservation: expected ? Math.round((kept + approvedExclusions + policyRetirements) / expected * 100) / 100 : null, retired, resolvedAdaptations:illustrative.filter(policyResolved).map(entry=>({objectId:entry.objectId,page:slides.findIndex(s=>s.id===entry.slideId)+1,role:entry.role,status:entry.status,reason:entry.reason,approvalBasis:entry.approvalBasis})), approvedExclusions, policyRetirements };
}

/** Where each source figure landed and the size its own text reached (Fable
 * 2026-11-02, F3): beside the points, under them, or on a page of its own,
 * then with the reason it has one (Fable 2026-11-03): legibility when its text
 * is under the floor even there, else the pairing's no_points, space or titles. */
export function figurePlacements(project, slides) {
  const images = new Map((project.source?.images || []).map(image => [image.id, image]));
  return slides.flatMap((slide, index) => {
    const nodes = visibleNodes(slide), figures = nodes.filter(node => node.type === 'image' && node.sourceArtifact?.type === 'SourceImage' && node.geometry);
    if (!figures.length) return [];
    const page = project.outline?.[index] || {}, points = (page.keyPoints || []).length;
    const body = nodes.filter(node => ['text', 'list'].includes(node.type) && node.geometry && !node.sourceArtifact && !node.nativeRef && node.semanticRole !== 'title' && !node.pinned);
    const beside = (a, b) => (a.x + a.width <= b.x || b.x + b.width <= a.x) && a.y < b.y + b.height && b.y < a.y + a.height;
    const layout = !points || page.figurePage ? 'figure_page' : figures.some(figure => body.some(text => beside(text.geometry, figure.geometry))) ? 'beside' : 'below';
    return figures.map(figure => {
      const image = images.get(figure.sourceArtifact.sourceUnitId) || {}, text = image.figureText || {}, width = figure.geometry.width;
      const size = text.share > 0 ? { figureTextPt: Math.round(text.share * width / 12700 * 10) / 10 } : text.boxWidthPt > 0 ? { figureScale: Math.round(width / 12700 / text.boxWidthPt * 100) / 100 } : {};
      const small = size.figureTextPt !== undefined && size.figureTextPt < FIGURE_TEXT_FLOOR_PT || size.figureScale !== undefined && size.figureScale < 1.75;
      const reason = page.figurePage ? (small ? 'legibility' : page.figureOnlyReason || null) : undefined;
      return { page: index + 1, sourceImageId: figure.sourceArtifact.sourceUnitId, layout, points, ...size, ...(page.pairedFigurePage ? { paired: true } : {}),
        ...(reason !== undefined ? { reason, ...(reason === 'space' ? { note: 'figure-card route not yet tried' } : {}), ...(page.figureOnlyDetail ? { detail: page.figureOnlyDetail } : {}) } : {}) };
    });
  });
}

export function inspectMediaLedger(ledger,{cards=false}={}) {
  if (!ledger || ledger.status !== 'profiled') return [];
  const issues = [...(ledger.componentIssues||[]), ...deckMediaIssues(ledger.deck)];
  // Every figure-only page of a deck the pairing ran on says why it is one
  // (Fable 2026-11-03). A missing reason is a diagnostic, never a gate (the
  // user, 2026-11-03): the page takes the default reason and a warning.
  const placements = ledger.figurePlacements || [], paired = placements.some(item => item.reason || item.paired);
  const unexplained = paired ? placements.filter(item => item.reason === null) : [];
  for (const item of unexplained) item.reason = 'unrecorded';
  if (unexplained.length) issues.push({ code: 'figure_only_reason_missing', severity: 'warning', repairable: false, pages: [...new Set(unexplained.map(item => item.page))],
    message: `Figure page${unexplained.length > 1 ? 's' : ''} ${[...new Set(unexplained.map(item => item.page))].join(', ')} carr${unexplained.length > 1 ? 'y' : 'ies'} no reason for showing the figure without its points.` });
  if (ledger.basis === 'mapped_component_profile') {
    for(const entry of ledger.entries.filter(x=>x.required&&x.status==='missing'))issues.push({code:'media_required_missing',severity:'error',objectId:entry.objectId,repairable:true,message:'Required template media cannot be silently omitted in mapped composition.'});
    return issues;
  }
  // A card deck retires template item icons by design: no "rebind" advice (Fable).
  for (const bucket of cards?['decoration']:['aid', 'decoration']) {
    const item = ledger.buckets[bucket];
    if (item.expected > 0 && item.kept === 0 && !(ledger.effectiveConservation>=1&&ledger.policyRetirements)) issues.push({ code: 'media_role_dropped', severity: 'warning', bucket, repairable: true,
      message: `All ${item.expected} template ${bucket === 'aid' ? 'item icons' : 'decorative/photo'} media were removed${item.reasons.length ? ` (${item.reasons.join('; ')})` : ''}; rebind them to items or choose a prototype that keeps the template's media role.` });
  }
  if(Number.isFinite(ledger.roleWeightedEffectiveConservation)&&ledger.roleWeightedEffectiveConservation<.7)issues.push({code:'media_weighted_conservation_blocked',severity:'error',repairable:true,message:'Role-weighted media conservation is below 70%; preserve meaningful media/carriers or record a valid user exclusion.'});
  const effective = ledger.effectiveConservation ?? ledger.conservation;
  if (effective !== null && effective < .7) issues.push({ code: 'media_conservation_blocked', severity: 'error', repairable: true,
    retired: (ledger.retired || []).slice(0, 40),
    message: `Only ${Math.round(effective * 100)}% of the template's illustrative media remain; ${(ledger.retired || []).length} were retired on pages ${[...new Set((ledger.retired || []).map(item => item.page))].join(', ')}. Re-lay out those pages to keep the media, or confirm each removal explicitly; publishing does not drop them silently.` });
  else if (ledger.conservation !== null && ledger.conservation < .7 && !ledger.policyRetirements) issues.push({ code: 'media_conservation_low', severity: 'warning', repairable: true,
    message: `Only ${Math.round(ledger.conservation * 100)}% of the template's illustrative media survive in the generated pages.` });
  if (ledger.longestTextOnlyRun >= 3 && ledger.templateMediaShare >= .5) issues.push({ code: 'media_text_only_run', severity: 'warning', repairable: true,
    message: `${ledger.longestTextOnlyRun} consecutive content slides have no information media. Review whether source relations need native components; decorative template density alone never requires extra pictures.` });
  return issues;
}

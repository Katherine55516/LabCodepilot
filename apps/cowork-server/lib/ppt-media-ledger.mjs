import {nativeComponentSpecs} from './ppt-native-components.mjs';
import {contrastRatio} from './ppt-template-colors.mjs';
/** Media ledger: what each template/source medium was for and what happened
 * to it, summarised against the template's own media density. It measures
 * role conservation and runs of text-only pages; it never rewards adding
 * pictures for their own sake (evidence media come from the source only).
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md (C). */
import { visibleNodes } from './ppt-visible-content.mjs';

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
const hasMedia = slide => visibleNodes(slide).some(node => ['image', 'chart', 'table'].includes(node.type));

export function buildMediaLedger(project, slides, objectLedger) {
  const fidelity = project.templateFidelity;
  const sourceObjects = (objectLedger?.objects || []).filter(object => object.type === 'SourceImage')
    .map(object => ({ objectId: object.objectId, bucket: 'evidence', origin: 'source', status: object.status, required: true, cropPolicy: CROP.evidence, boundUnitIds: [] }));
  const content = slides.slice(1);
  let run = 0, longestTextOnlyRun = 0;
  for (const slide of content) { run = hasMedia(slide) ? 0 : run + 1; longestTextOnlyRun = Math.max(longestTextOnlyRun, run); }
  if (fidelity?.mode === 'mapped' && fidelity.componentProfile) {
    const profile=fidelity.componentProfile;
    const entries=profile.assets.map(asset=>{
      const bindings=slides.flatMap(slide=>(slide.nodes||[]).filter(node=>node.templateMediaBinding?.assetId===asset.assetId).map(node=>({slideId:slide.id,nodeId:node.id,itemId:node.templateMediaBinding.itemId})));
      return {objectId:asset.assetId,origin:'template',role:asset.role,bucket:mediaBucket(asset.role),required:asset.required,cropPolicy:CROP[mediaBucket(asset.role)],boundUnitIds:[],bindings,status:bindings.length?'retained':asset.required?'missing':'not_selected',reason:bindings.length?'mapped_visual_aid':'optional template media not selected by composition'};
    });
    return {version:2,status:'profiled',basis:'mapped_component_profile',profileHash:profile.profileHash,entries:[...entries,...sourceObjects],longestTextOnlyRun,templateMediaShare:profile.pages.slice(1).filter(p=>p.media.length).length/Math.max(1,profile.pages.length-1),buckets:null,conservation:null};
  }
  if (!fidelity?.slides?.length) return { version: 1, status: 'template_media_not_profiled', basis: project.templateFidelity ? 'template_without_slides' : 'mapped_or_builtin_template',
    entries: sourceObjects, longestTextOnlyRun, templateMediaShare: null, buckets: null };
  const componentEntries=slides.flatMap(slide=>(slide.nodes||[]).filter(n=>n.templateComponentBinding).map(n=>({slideId:slide.id,nodeId:n.id,type:n.type,...n.templateComponentBinding,geometry:n.geometry})));
  const componentIssues=[];
  slides.forEach((slide,index)=>{const spec=fidelity.slides[index],prototypes=nativeComponentSpecs(spec,fidelity),groups=new Map();for(const node of slide.nodes||[]){const b=node.templateComponentBinding;if(!b)continue;const key=b.componentSpecId+':'+b.unitIndex;groups.set(key,[...(groups.get(key)||[]),node]);}
    for(const members of groups.values()){const b=members[0].templateComponentBinding,prototype=prototypes.find(p=>p.id===b.componentSpecId);if(!prototype)continue;
      if(!slide.nodes.some(n=>n.semanticComponentBinding?.unitIndex===b.unitIndex))componentIssues.push({code:'native_component_source_anchor_missing',severity:'error',slideId:slide.id,componentSpecId:b.componentSpecId,message:'Native component has no visible atomic source reading unit.'});
      const missing=prototype.nativeMembers.filter(m=>!members.some(n=>n.templateComponentBinding.originalShapeId===m.shapeId));if(missing.length)componentIssues.push({code:'native_component_member_missing',severity:'error',slideId:slide.id,componentSpecId:b.componentSpecId,message:'Whole native component lost members: '+missing.map(m=>m.shapeId).join(', ')});
      for(const image of members.filter(n=>n.type==='image'&&n.content?.foregroundColor)){
        const carriers=members.filter(n=>n.type==='shape'&&n.style?.fill&&(n.zIndex||0)<(image.zIndex||0));const background=carriers.sort((a,b)=>(b.zIndex||0)-(a.zIndex||0))[0]?.style?.fill||spec?.background||project.templateSpec?.palette?.background||'#ffffff';
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
      required: ['evidence', 'brand'].includes(bucket), cropPolicy: CROP[bucket], boundUnitIds: node.content?.boundUnitIds || [], ...(asset.reason ? { reason: asset.reason } : {}), ...(asset.approvalBasis ? { approvalBasis: asset.approvalBasis } : {}) };
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
  const policyResolved=entry=>['design_only','keep_fixed'].includes(project.templateContentMode)&&entry.origin==='template'&&entry.role==='old_template_content'&&entry.bucket==='decoration'&&!entry.required&&entry.status==='retired_by_adaptation'&&entry.approvalBasis==='design_only_template';
  const retired = illustrative.filter(entry => !KEPT.has(entry.status) && entry.status !== 'excluded_by_user' && !policyResolved(entry))
    .map(entry => ({ objectId: entry.objectId, page: slides.findIndex(slide => slide.id === entry.slideId) + 1, role: entry.role, status: entry.status, reason: entry.reason || null, approvalBasis: entry.approvalBasis || null }));
  const approvedExclusions = illustrative.filter(entry => entry.status === 'excluded_by_user').length;
  // Object integrity has already checked each adaptation. A design-only
  // template deliberately retires old report evidence; this is an explicit
  // template-use policy, not a user exclusion or an equivalent new fact.
  const policyRetirements=illustrative.filter(policyResolved).length;
  const templateEntries=entries.filter(entry=>entry.origin==='template'),templateWeight=templateEntries.reduce((n,entry)=>n+weights[entry.bucket],0);
  return { version: 2, status: 'profiled', entries, buckets,componentEntries,componentIssues,roleWeightedEffectiveConservation:templateWeight?templateEntries.reduce((n,e)=>n+(KEPT.has(e.status)||e.status==='excluded_by_user'||policyResolved(e)?weights[e.bucket]:0),0)/templateWeight:null,roleWeightedConservation:templateWeight?templateEntries.reduce((n,e)=>n+(KEPT.has(e.status)?weights[e.bucket]:0),0)/templateWeight:null, longestTextOnlyRun, templateMediaShare: Math.round(templateMediaShare * 100) / 100,
    // Evidence and brand media are governed by object integrity (required);
    // conservation covers the template's illustrative roles.
    conservation: expected ? Math.round(kept / expected * 100) / 100 : null,
    effectiveConservation: expected ? Math.round((kept + approvedExclusions + policyRetirements) / expected * 100) / 100 : null, retired, approvedExclusions, policyRetirements };
}

export function inspectMediaLedger(ledger) {
  if (!ledger || ledger.status !== 'profiled') return [];
  const issues = [...(ledger.componentIssues||[])];
  if (ledger.basis === 'mapped_component_profile') {
    for(const entry of ledger.entries.filter(x=>x.required&&x.status==='missing'))issues.push({code:'media_required_missing',severity:'error',objectId:entry.objectId,repairable:true,message:'Required template media cannot be silently omitted in mapped composition.'});
    return issues;
  }
  for (const bucket of ['aid', 'decoration']) {
    const item = ledger.buckets[bucket];
    if (item.expected > 0 && item.kept === 0) issues.push({ code: 'media_role_dropped', severity: 'warning', bucket, repairable: true,
      message: `All ${item.expected} template ${bucket === 'aid' ? 'item icons' : 'decorative/photo'} media were removed${item.reasons.length ? ` (${item.reasons.join('; ')})` : ''}; rebind them to items or choose a prototype that keeps the template's media role.` });
  }
  if(Number.isFinite(ledger.roleWeightedEffectiveConservation)&&ledger.roleWeightedEffectiveConservation<.7)issues.push({code:'media_weighted_conservation_blocked',severity:'error',repairable:true,message:'Role-weighted media conservation is below 70%; preserve meaningful media/carriers or record a valid user exclusion.'});
  const effective = ledger.effectiveConservation ?? ledger.conservation;
  if (effective !== null && effective < .7) issues.push({ code: 'media_conservation_blocked', severity: 'error', repairable: true,
    retired: (ledger.retired || []).slice(0, 40),
    message: `Only ${Math.round(effective * 100)}% of the template's illustrative media remain; ${(ledger.retired || []).length} were retired on pages ${[...new Set((ledger.retired || []).map(item => item.page))].join(', ')}. Re-lay out those pages to keep the media, or confirm each removal explicitly; publishing does not drop them silently.` });
  else if (ledger.conservation !== null && ledger.conservation < .7 && !ledger.policyRetirements) issues.push({ code: 'media_conservation_low', severity: 'warning', repairable: true,
    message: `Only ${Math.round(ledger.conservation * 100)}% of the template's illustrative media survive in the generated pages.` });
  if (ledger.longestTextOnlyRun >= 3 && ledger.templateMediaShare >= .5) issues.push({ code: 'media_text_only_run', severity: 'error', repairable: true,
    message: `${ledger.longestTextOnlyRun} consecutive content slides have no image, chart or table although most template pages carry media.` });
  return issues;
}

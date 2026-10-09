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
  const entries = [...(objectLedger?.templateAssets || []).map(asset => {
    const spec = fidelity.slides[slides.findIndex(slide => slide.id === asset.slideId)];
    const node = spec?.nodes?.find(item => item.id === asset.objectId) || {};
    const bucket = mediaBucket(asset.role, node);
    return { objectId: asset.objectId, slideId: asset.slideId, origin: 'template', role: asset.role, bucket, status: asset.status,
      required: ['evidence', 'brand'].includes(bucket), cropPolicy: CROP[bucket], boundUnitIds: node.content?.boundUnitIds || [], ...(asset.reason ? { reason: asset.reason } : {}) };
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
  return { version: 1, status: 'profiled', entries, buckets, longestTextOnlyRun, templateMediaShare: Math.round(templateMediaShare * 100) / 100,
    // Evidence and brand media are governed by object integrity (required);
    // conservation covers the template's illustrative roles.
    conservation: expected ? Math.round(kept / expected * 100) / 100 : null };
}

export function inspectMediaLedger(ledger) {
  if (!ledger || ledger.status !== 'profiled') return [];
  const issues = [];
  if (ledger.basis === 'mapped_component_profile') {
    for(const entry of ledger.entries.filter(x=>x.required&&x.status==='missing'))issues.push({code:'media_required_missing',severity:'error',objectId:entry.objectId,repairable:true,message:'Required template media cannot be silently omitted in mapped composition.'});
    return issues;
  }
  for (const bucket of ['aid', 'decoration']) {
    const item = ledger.buckets[bucket];
    if (item.expected > 0 && item.kept === 0) issues.push({ code: 'media_role_dropped', severity: 'warning', bucket, repairable: true,
      message: `All ${item.expected} template ${bucket === 'aid' ? 'item icons' : 'decorative/photo'} media were removed${item.reasons.length ? ` (${item.reasons.join('; ')})` : ''}; rebind them to items or choose a prototype that keeps the template's media role.` });
  }
  if (ledger.conservation !== null && ledger.conservation < .7) issues.push({ code: 'media_conservation_low', severity: 'warning', repairable: true,
    message: `Only ${Math.round(ledger.conservation * 100)}% of the template's illustrative media survive in the generated pages.` });
  if (ledger.longestTextOnlyRun >= 3 && ledger.templateMediaShare >= .5) issues.push({ code: 'media_text_only_run', severity: 'warning', repairable: true,
    message: `${ledger.longestTextOnlyRun} consecutive content slides have no image, chart or table although most template pages carry media.` });
  return issues;
}

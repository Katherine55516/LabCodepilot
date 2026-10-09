import { createHash } from 'node:crypto';
export const TEMPLATE_DISPOSITION_VERSION=2;
export const templateAssetHash = node => createHash('sha256').update(JSON.stringify({id:node.id,type:node.type,content:node.content,geometry:node.geometry,nativeRef:node.nativeRef})).digest('hex');
/** A model reason is only a request. Deterministic adaptation and a real user
 * decision are separate records; neither is media-equivalence evidence. */
export function adaptationDisposition(project,node,role,basis,reason) {
  return {shapeId:node.nativeRef?.shapeId,version:TEMPLATE_DISPOSITION_VERSION,disposition:'retired_by_adaptation',automatic:true,role,approvalBasis:basis,reason,
    sourceHash:createHash('sha256').update(String(project.source?.text||project.prompt||'')).digest('hex'),templateHash:project.templateFidelity?.sha256||null,beforeHash:templateAssetHash(node),policyVersion:2};
}
export function validAdaptation(project,node,record,role) {
  return Boolean(record?.sourceHash===createHash('sha256').update(String(project.source?.text||project.prompt||'')).digest('hex')&&record?.version===2&&record.policyVersion===2&&record.disposition==='retired_by_adaptation'&&record.beforeHash===templateAssetHash(node)&&record.templateHash===(project.templateFidelity?.sha256||null)&&record.role===role&&
    (role==='old_template_content'&&record.approvalBasis==='deterministic_topic_mismatch'||!['image','chart','table'].includes(node.type)&&record.approvalBasis==='source_region_replacement'));
}
export function verifiedReplacement(node,record,visible) {
  if(record?.version!==2||record.disposition!=='replaced_verified'||record.beforeHash!==templateAssetHash(node)||record.verification?.status!=='passed'||!record.replacementNodeIds?.length)return false;
  const targets=record.replacementNodeIds.map(id=>visible.find(n=>n.id===id));
  if(targets.some(n=>!n))return false;
  // Media must remain media. Typed process structures additionally preserve
  // each declared source relation; a paragraph with a source ID is insufficient.
  if(node.type==='image')return targets.some(n=>n.type==='image'&&n.content?.dataUrl===node.content?.dataUrl);
  if(['chart','table'].includes(node.type))return targets.some(n=>n.type===node.type&&JSON.stringify(n.content)===JSON.stringify(node.content));
  return false;
}

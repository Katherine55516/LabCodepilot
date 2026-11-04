import { createHash } from 'node:crypto';
export const TEMPLATE_DISPOSITION_VERSION=2;
export const templateAssetHash = node => createHash('sha256').update(JSON.stringify({id:node.id,type:node.type,content:node.content,geometry:node.geometry,nativeRef:node.nativeRef})).digest('hex');
/** The asset itself wherever its page sits: a page that moves (a continuation
 * inserted before it) changes its node ids and output slide index, never its
 * content, geometry or source shape (live fz-r13/mlq-r13: every retirement
 * after a continuation lost its approval and publication was blocked). */
// A repeated frame's rotated icon is its slot, not the image the rotation
// put there: a continuation re-rotates the pages after it (live mlq-r15).
export const templateAssetKey = node => createHash('sha256').update(JSON.stringify({type:node.type,content:node.content?.mediaReplacement?{mediaReplacement:true,mediaRole:node.content.mediaRole}:node.content,geometry:node.geometry,shapeId:node.nativeRef?.shapeId,sourceSlideIndex:node.nativeRef?.sourceSlideIndex})).digest('hex');
const sameAsset=(record,node)=>record?.beforeHash===templateAssetHash(node)||Boolean(record?.assetKey)&&record.assetKey===templateAssetKey(node);
/** A model reason is only a request. Deterministic adaptation and a real user
 * decision are separate records; neither is media-equivalence evidence. */
export function adaptationDisposition(project,node,role,basis,reason) {
  return {shapeId:node.nativeRef?.shapeId,version:TEMPLATE_DISPOSITION_VERSION,disposition:'retired_by_adaptation',automatic:true,role,approvalBasis:basis,reason,
    sourceHash:createHash('sha256').update(String(project.source?.text||project.prompt||'')).digest('hex'),templateHash:project.templateFidelity?.sha256||null,beforeHash:templateAssetHash(node),assetKey:templateAssetKey(node),policyVersion:2};
}
export function validAdaptation(project,node,record,role) {
  const r=record?.replacementRegion,g=node.geometry;
  const artworkOverlap=r&&g&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.width>0&&r.height>0?
    Math.max(0,Math.min(g.x+g.width,r.x+r.width)-Math.max(g.x,r.x))*Math.max(0,Math.min(g.y+g.height,r.y+r.height)-Math.max(g.y,r.y))/Math.max(1,g.width*g.height):0;
  return Boolean(record?.sourceHash===createHash('sha256').update(String(project.source?.text||project.prompt||'')).digest('hex')&&record?.version===2&&record.policyVersion===2&&record.disposition==='retired_by_adaptation'&&sameAsset(record,node)&&record.templateHash===(project.templateFidelity?.sha256||null)&&record.role===role&&
    (role==='old_template_content'&&(record.approvalBasis==='deterministic_topic_mismatch'||record.approvalBasis==='design_only_template'&&['design_only','keep_fixed'].includes(project.templateContentMode)&&node.content?.mediaRole==='old_template_content'&&!node.content?.mustPreserve&&!node.content?.mediaReplacement)||!['image','chart','table'].includes(node.type)&&record.approvalBasis==='source_region_replacement'||role==='template_decoration'&&node.type==='image'&&!node.content?.mustPreserve&&record.approvalBasis==='source_region_decoration_avoidance'||role==='template_artwork'&&node.type==='image'&&!node.content?.mustPreserve&&record.approvalBasis==='source_region_artwork_avoidance'&&artworkOverlap>=.35
    ||role==='template_icon'&&node.type==='image'&&!node.content?.mustPreserve&&record.approvalBasis==='source_region_card_icon_avoidance'&&artworkOverlap>=.35
    // Old content by position (Fable 2026-10-26): an uncertified picture at least half in the content band of a page we fill.
    ||!['template_decoration','template_icon'].includes(role)&&node.type==='image'&&!node.content?.mustPreserve&&node.content?.ocr?.status!=='ok'&&record.approvalBasis==='old_content_by_position'&&Number(record.contentBandShare)>=.5
    // A card page omits the decorations of a point group it leaves out.
    ||['template_icon','template_decoration'].includes(role)&&node.type==='image'&&!node.content?.mustPreserve&&record.approvalBasis==='card_group_omitted'
    // A sample icon replaced by a numbered marker on a card page (Fable 2026-11-02, N1).
    ||role==='template_icon'&&node.type==='image'&&!node.content?.mustPreserve&&record.approvalBasis==='sample_icon_marker'
    // A layout-only page leaves out its cloned frame's shapes (Fable G5, 2026-11-02); never the user's brand.
    ||record.approvalBasis==='layout_only_page'&&!node.content?.mustPreserve&&node.content?.mediaRole!=='brand'));
}
export function verifiedReplacement(node,record,visible) {
  if(record?.version!==2||record.disposition!=='replaced_verified'||!sameAsset(record,node)||record.verification?.status!=='passed'||!record.replacementNodeIds?.length)return false;
  const targets=record.replacementNodeIds.map(id=>visible.find(n=>n.id===id));
  if(targets.some(n=>!n))return false;
  // Media must remain media. Typed process structures additionally preserve
  // each declared source relation; a paragraph with a source ID is insufficient.
  if(node.type==='image')return targets.some(n=>n.type==='image'&&n.content?.dataUrl===node.content?.dataUrl);
  if(['chart','table'].includes(node.type))return targets.some(n=>n.type===node.type&&JSON.stringify(n.content)===JSON.stringify(node.content));
  return false;
}

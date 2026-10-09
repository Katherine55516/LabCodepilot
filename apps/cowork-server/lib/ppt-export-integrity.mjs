import {_internals as pointMeasures} from './ppt/point-layout.mjs';
import { visibleNodes } from './ppt-visible-content.mjs';
import crypto from 'node:crypto';
import { buildRenderTree } from './ppt/render-tree.mjs';
export const EXPORT_CONTRACT_VERSION=2;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Small manifest has no image base64 copies. Verify output after reopening. */
export function exportManifest(project, renderTree=buildRenderTree(project)) {
  const manifest={version:EXPORT_CONTRACT_VERSION,revision:Number(project.revision||0),renderHash:renderTree.hash||digest(renderTree),slides:renderTree.slides.map((slide,index)=>{
    const canonical=visibleNodes(project.deck?.slides?.[index]||{});
    const nodes=slide.elements.filter(e=>e.nodeId).map(e=>{
      const original=canonical.find(n=>n.id===e.nodeId)||{},content=e.content||{};
      if(e.nativeRef&&e.nativeRef.contractVersion!==2)throw new Error('native_contract_migration: re-import the PPTX or regenerate with the refreshed template before new publication');
      const imageSha256=content.dataUrl?crypto.createHash('sha256').update(Buffer.from(content.dataUrl.split(',')[1]||'','base64')).digest('hex'):content.imageSha256;
      return {id:e.id,nodeId:e.nodeId,type:e.kind,sourceArtifact:original.sourceArtifact||e.sourceArtifact,nativeRef:e.nativeRef||original.nativeRef,
        geometry:e.content?.mathMl&&e.mathLayout?.bounds?e.mathLayout.bounds:e.bounds,rotation:Number(e.rotation||0),style:e.style,textLayout:e.textLayout,imageLayout:e.imageLayout,chartLayout:e.chartLayout?{...e.chartLayout,svg:undefined}:undefined,
        content:e.kind==='image'?{imageSha256,crop:content.crop,fit:content.fit,nativeMaskXml:content.nativeMaskXml}:content,
        parts:e.kind==='list'&&content.pointLayout?.boxes?content.items.map((item,i)=>{const b=content.pointLayout.boxes[i];if(!b)throw new Error('export manifest has no frame for list point');const {heading,body}=pointMeasures.pointParts(item);return {id:`${e.id}:${i}`,geometry:{x:e.bounds.x+Math.trunc(e.bounds.width*b.x),y:e.bounds.y+Math.trunc(e.bounds.height*b.y),width:Math.trunc(e.bounds.width*b.w),height:Math.trunc(e.bounds.height*b.h)},text:[heading,body].filter(Boolean).join('\n')};}):undefined};
    });
    for(const node of canonical)if((node.content?.text||node.content?.rows?.length||node.content?.items?.length||['image','chart'].includes(node.type))&&!nodes.some(n=>n.nodeId===node.id))throw new Error('Visible canonical object has no exported render mapping: '+node.id);
    return {id:slide.id,size:slide.size,nodes};
  })};
  manifest.manifestHash=digest(manifest);return manifest;
}
export function acceptExportVerification(project, info) {
  const expected=exportManifest(project),v=info?.exportVerification;
  if(v?.status!=='passed'||v.version!==EXPORT_CONTRACT_VERSION||v.manifestHash!==expected.manifestHash||v.renderHash!==expected.renderHash||v.revision!==expected.revision||!v.sha256)throw new Error('PPTX export was not verified against the current instance contract; publication blocked');
  project.quality={...project.quality,exportable:true,exportVerification:info.exportVerification,
    fontResolution:info.fontResolution||[],visualVerified:false, renderedTextVerified:v.renderedVisibility?.status==='passed',
    // Page images and occlusion checks are evidence; a visual review must
    // still evaluate them before anything is called visually verified.
    visualEvidence:v.visualEvidence?{status:v.visualEvidence.status,pages:v.visualEvidence.pages?.length||0,occlusionChecks:v.visualEvidence.occlusionChecks||0,
      softOcclusions:v.visualEvidence.softOcclusions?.length||0,engine:v.visualEvidence.engine||null,manifestHash:v.manifestHash}:{status:'not_evaluated'}};
}
export function blockExportVerification(project,error) {
  const issue={code:'export_integrity_failed',severity:'error',repairable:true,message:String(error?.message||error).slice(-1500)};
  project.status='quality_blocked';project.stage='repair';project.error='PPT export verification blocked publish: '+issue.message;
  const deterministic=project.quality?.deterministic||{issues:[]};
  deterministic.issues=[...(deterministic.issues||[]).filter(i=>i.code!==issue.code),issue];
  deterministic.hardErrors=deterministic.issues.filter(i=>i.severity==='error').length;
  project.quality={...project.quality,status:'blocked',publishEligible:false,exportable:false,visualVerified:false,renderedTextVerified:false,exportVerification:null,deterministic,issueGroups:{...(project.quality?.issueGroups||{}),layout:[...(project.quality?.issueGroups?.layout||[]).filter(i=>i.code!==issue.code),issue]}};
  return project;
}
export { EXPORT_VERIFY_SCRIPT } from './ppt/export-verifier-python.mjs';

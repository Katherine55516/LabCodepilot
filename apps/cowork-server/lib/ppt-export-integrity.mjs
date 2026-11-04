import {selectionNotesBySlide,exactPageConflict} from './ppt-content-selection.mjs';
import {omittedCoverageNotes,cardLanguageNotes,coverSourceNotes,approximateFormulaNotes,optionalFigureNotes,shortenedCaptionNotes,optionalTableNotes,tableCardPointNotes,leadNotes,unshownPointNotes,mergeNotes} from './ppt-card-language.mjs';
import {continuationNotes} from './ppt-continuation-marker.mjs';
import {_internals as pointMeasures} from './ppt/point-layout.mjs';
import { visibleNodes } from './ppt-visible-content.mjs';
import crypto from 'node:crypto';
import { buildRenderTree } from './ppt/render-tree.mjs';
import { RENDER_CONTRACT_VERSION } from './ppt/render-contract.mjs';
import {captionNotes} from './ppt-figure-captions.mjs';
export const EXPORT_CONTRACT_VERSION=2;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** The same edit revision may be re-published by a new renderer. A PDF must
 * belong to that exact published package, not merely to its revision number. */
export const publishedPdfIdentity=project=>digest({revision:project.publishedRevision,path:project.publishedArtifactPath,sha256:project.quality?.exportVerification?.sha256,renderContractVersion:project.quality?.exportVerification?.renderContractVersion});
/** Small manifest has no image base64 copies. Verify output after reopening. */
export function exportManifest(project, renderTree=buildRenderTree(project)) {
  // A matching renderer version alone does not prove that a cached scene
  // belongs to this deck. Compare the actual scene, not a caller supplied hash.
  const current=buildRenderTree(project);
  const comparable=tree=>({slides:tree.slides,size:tree.size,units:tree.units,renderContractVersion:tree.renderContractVersion,...(project.deck?.deckId?{deckId:tree.deckId}:{})});
  if(digest(comparable(renderTree))!==digest(comparable(current)))throw Object.assign(new Error('render_tree_stale: scene IDs, geometry or content differ from the current canonical deck'),{code:'render_invalid'});
  if(exactPageConflict(project,project.deck).length)throw new Error('exact_page_budget_conflict: exported total differs from the explicit request');
  const manifest={notes:mergeNotes(unshownPointNotes(project),leadNotes(project),captionNotes(project),selectionNotesBySlide(project),cardLanguageNotes(project),continuationNotes(project),coverSourceNotes(project),approximateFormulaNotes(project),shortenedCaptionNotes(project),optionalFigureNotes(project),optionalTableNotes(project),tableCardPointNotes(project),omittedCoverageNotes(project)),version:EXPORT_CONTRACT_VERSION,renderContractVersion:RENDER_CONTRACT_VERSION,revision:Number(project.revision||0),renderHash:project.deck?.deckId?(renderTree.hash||digest(renderTree)):digest(comparable(renderTree)),slides:renderTree.slides.map((slide,index)=>{
    const canonical=visibleNodes(project.deck?.slides?.[index]||{});
    const nodes=slide.elements.filter(e=>e.nodeId).map(e=>{
      const original=canonical.find(n=>n.id===e.nodeId)||{},content=e.content||{};
      if(content.mathStatus&&content.mathStatus!=='native_math'||content.richText?.diagnostics?.length||content.cellRich?.flat().some(c=>c.diagnostics?.length)||content.items?.some(i=>i.richText?.diagnostics?.length)||content.paragraphs?.some(i=>i.richText?.diagnostics?.length))throw new Error('unsupported_mathematical_display: repair the exact formula span before export');
      if(e.nativeRef&&e.nativeRef.contractVersion!==2)throw new Error('native_contract_migration: re-import the PPTX or regenerate with the refreshed template before new publication');
      const imageSha256=content.dataUrl?crypto.createHash('sha256').update(Buffer.from(content.dataUrl.split(',')[1]||'','base64')).digest('hex'):content.imageSha256;
      return {id:e.id,nodeId:e.nodeId,type:e.kind,sourceArtifact:original.sourceArtifact||e.sourceArtifact,nativeRef:e.nativeRef||original.nativeRef,
        geometry:e.content?.mathMl&&e.mathLayout?.bounds?e.mathLayout.bounds:e.bounds,rotation:Number(e.rotation||0),style:e.style,surfaceFill:e.surfaceFill,textLayout:e.textLayout,imageLayout:e.imageLayout,chartLayout:e.chartLayout?{...e.chartLayout,svg:undefined}:undefined,
        content:e.kind==='image'?{imageSha256,crop:content.crop,fit:content.fit,nativeMaskXml:content.nativeMaskXml}:content,
        parts:e.kind==='list'&&content.pointLayout?.boxes?content.items.map((item,i)=>{
          // The author's weight and italic (Fable Q1(b)) are what every card run shows.
          const authoredRun=run=>({...run,...(e.textStyleOverrides?.includes('fontWeight')?{bold:Number(e.style?.fontWeight)>=600}:{}),...(e.textStyleOverrides?.includes('fontStyle')?{italic:e.style?.fontStyle==='italic'}:{})});
          const inline=Boolean(content.pointLayout.inlineHeading);const b=content.pointLayout.boxes[i];if(!b)throw new Error('export manifest has no frame for list point');const {heading,body}=pointMeasures.pointParts(item);return {id:`${e.id}:${i}`,geometry:{x:e.bounds.x+Math.trunc(e.bounds.width*b.x),y:e.bounds.y+Math.trunc(e.bounds.height*b.y),width:Math.trunc(e.bounds.width*b.w),height:Math.trunc(e.bounds.height*b.h)},text:[heading,body].filter(Boolean).join(inline?'\u3000':'\n'),fontSizePt:content.pointLayout.fontSizePt,richText:item.bodyRich?{plainText:[heading,body].filter(Boolean).join(inline?'\u3000':'\n'),runs:[...(heading?(item.headingRich?.runs||[{kind:'text',text:heading}]).map(r=>({...r,bold:true,...(content.pointLayout.headingFontSizePt?{fontSizePt:content.pointLayout.headingFontSizePt}:{})})):[]),...(heading?[inline?{kind:'text',text:'\u3000',bold:true}:{kind:'text',text:'\n'}]:[]),...item.bodyRich.runs].map(authoredRun),diagnostics:[...(item.headingRich?.diagnostics||[]),...item.bodyRich.diagnostics]}:undefined};}):undefined};
    });
    for(const node of canonical)if((node.content?.text||node.content?.rows?.length||node.content?.items?.length||['image','chart'].includes(node.type))&&!nodes.some(n=>n.nodeId===node.id))throw new Error('Visible canonical object has no exported render mapping: '+node.id);
    return {id:slide.id,size:slide.size,nodes};
  })};
  manifest.manifestHash=digest(manifest);return manifest;
}
export function relationSegmentCount(manifest){return manifest.slides.flatMap(s=>s.nodes).reduce((total,n)=>total+(n.content?.pointLayout?.connectors||[]).reduce((count,e)=>count+(e.points?.length?e.points.slice(1).filter((p,i)=>p.x!==e.points[i].x||p.y!==e.points[i].y).length:1),0),0);}
export function publishedRenderCurrent(project){
  const proof=project.quality?.exportVerification;
  return proof?.status==='passed'&&proof.revision===project.publishedRevision&&proof.renderContractVersion===RENDER_CONTRACT_VERSION;
}
export function acceptExportVerification(project, info) {
  const expected=exportManifest(project),v=info?.exportVerification;
  if(v?.status!=='passed'||v.version!==EXPORT_CONTRACT_VERSION||v.renderContractVersion!==expected.renderContractVersion||v.manifestHash!==expected.manifestHash||v.renderHash!==expected.renderHash||v.revision!==expected.revision||!v.sha256)throw new Error('PPTX export was not verified against the current instance contract; publication blocked');
  const segments=relationSegmentCount(expected);
  if(segments&&(v.relationRouteVersion!==1||v.relationSegmentsChecked!==segments))throw new Error('PPTX relation routes were not verified against the current scene; publication blocked');
  project.quality={...project.quality,exportable:true,exportVerification:info.exportVerification,
    // renderedVisibility 'unavailable': the host has no rendering engine; the PPTX
    // structure was verified and the missing visibility check is shown to the user.
    acceptanceAxes:{...(project.quality?.acceptanceAxes||{}),nativeExport:{status:'verified',revision:v.revision,exportHash:v.sha256,manifestHash:v.manifestHash,renderHash:v.renderHash,renderedVisibility:v.renderedVisibility?.status||'not_evaluated',verifiedAt:new Date().toISOString()},humanVisualReview:{status:'not_verified'}},
    fontResolution:info.fontResolution||[],visualVerified:false, renderedTextVerified:v.renderedVisibility?.status==='passed',
    // Page images and occlusion checks are evidence; a visual review must
    // still evaluate them before anything is called visually verified.
    visualEvidence:v.visualEvidence?{status:v.visualEvidence.status,pages:v.visualEvidence.pages?.length||0,occlusionChecks:v.visualEvidence.occlusionChecks||0,
      softOcclusions:v.visualEvidence.softOcclusions?.length||0,engine:v.visualEvidence.engine||null,manifestHash:v.manifestHash}:{status:'not_evaluated'}};
  // D2 (2026-10-31): a page the rendered export flags (text lost, overflowing or
  // covered) is marked on that page in the editor; the deck still publishes.
  const deterministic=project.quality.deterministic||{issues:[]},slides=project.deck?.slides||[];
  const kept=(deterministic.issues||[]).filter(issue=>issue.code!=='export_page_visibility');
  const flagged=(Array.isArray(v.pageFlags)?v.pageFlags:[]).map(flag=>{const id=slides[flag.page-1]?.id;return {code:'export_page_visibility',severity:'warning',pageFlag:true,originalSeverity:'error',...(id?{slideId:id,slideIds:[id]}:{}),message:String(flag.message||'').slice(0,300)};});
  if(flagged.length||kept.length!==(deterministic.issues||[]).length)project.quality.deterministic={...deterministic,issues:[...kept,...flagged],flaggedPages:[...new Set([...(deterministic.flaggedPages||[]),...flagged.flatMap(issue=>issue.slideIds||[])])]};
  if(flagged.length||kept.length!==(deterministic.issues||[]).length)project.quality.reviewAdvisories=(project.quality.modelIssues||[]).filter(item=>item.advisory).length+project.quality.deterministic.issues.filter(item=>item.pageFlag).length;
}
/** A verifier failure as the user reads it: a Python traceback is reduced to
 * its final exception message (the trace stays in details), and a missing
 * LibreOffice is an environment error, not a content repair (3143, 367a72d8:
 * the raw "FileNotFoundError: ... 'soffice'" traceback was shown). */
export function exportVerificationIssue(error){
  const raw=String(error?.message||error),traceback=/Traceback \(most recent call last\)/u.test(raw);
  const unavailable=raw.match(/\b(?:export_verifier|office|pdf_converter|svg_rasterizer)_unavailable: [^\n]*/u)?.[0];
  const last=raw.trim().split('\n').map(line=>line.trim()).filter(Boolean).at(-1)||raw;
  const message=unavailable||(traceback?last.replace(/^[A-Za-z_.]*(?:Error|Exception|Missing): /u,''):raw);
  // The page it names, for the blocked-publish list (Fable 2026-11-02, G2).
  const page=raw.match(/\bslide\s+(\d+)\b/iu);
  return{code:unavailable?'export_verifier_unavailable':'export_integrity_failed',severity:'error',repairable:!unavailable,message:message.slice(-1500),...(page?{pageIndex:Number(page[1])-1}:{}),...(traceback?{details:{trace:raw.slice(-4000)}}:{})};
}
export function blockExportVerification(project,error) {
  const issue=exportVerificationIssue(error);
  project.status='quality_blocked';project.stage='repair';project.qualityBlockReason='export';project.error='PPT export verification blocked publish: '+issue.message;
  const deterministic=project.quality?.deterministic||{issues:[]};
  deterministic.issues=[...(deterministic.issues||[]).filter(i=>!['export_integrity_failed','export_verifier_unavailable'].includes(i.code)),issue];
  deterministic.hardErrors=deterministic.issues.filter(i=>i.severity==='error').length;
  project.quality={...project.quality,acceptanceAxes:{...(project.quality?.acceptanceAxes||{}),nativeExport:{status:'failed',revision:project.revision,reason:issue.message},humanVisualReview:{status:'not_verified'}},status:'blocked',publishEligible:false,exportable:false,visualVerified:false,renderedTextVerified:false,exportVerification:null,deterministic,issueGroups:{...(project.quality?.issueGroups||{}),layout:[...(project.quality?.issueGroups?.layout||[]).filter(i=>i.code!==issue.code),issue]}};
  return project;
}
export { EXPORT_VERIFY_SCRIPT } from './ppt/export-verifier-python.mjs';

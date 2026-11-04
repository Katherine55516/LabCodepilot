import {objectPairs} from './ppt-object-pairs.mjs';
import {sourceWarningKey,unresolvedSourceWarnings} from './ppt-source-readiness.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {allowsEditorialSelection} from './ppt-generation-policy.mjs';
import {graphProjectionIdentity,validGraphProjection} from './ppt-ascii-graph.mjs';
import {supportsSourceLineRanges,hasExplicitSourceLineRanges,inspectSourceLineCoverage,materializeSourceLineRange} from './ppt-source-line-ranges.mjs';
import { validAdaptation, verifiedReplacement } from './ppt-template-dispositions.mjs';
/** The ownership ledger measures rendered objects, never mere citations. */
import { sourceComponent, isSourceArtifactItem, protectedTemplateAsset } from './ppt-density-capacity.mjs';
import { sourceDisplayText,sourceRichText } from './ppt-source-text.mjs';
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { templateMediaRole } from './ppt-template-fidelity.mjs';
import { mathMarkupKey } from './ppt-math.mjs';
import {contentSelectionMatchesSource} from './ppt-content-selection.mjs';
import {diagramCoverage} from './ppt-diagram-cards.mjs';
import {validSummaryProjection} from './ppt/source-summary-projection.mjs';
import {displayCaption} from './ppt-figure-captions.mjs';
const key=value=>sourceDisplayText(value).normalize('NFKC').replace(/\s+/gu,' ').trim();
const cellKey=value=>sourceRichText(value,{inline:true}).plainText.normalize('NFKC').replace(/\s+/gu,' ').trim();
const inlineMathKeys=content=>[content.richText,...(content.items||[]).map(item=>item.richText),...(content.cellRich||[]).flat()].flatMap(rich=>(rich?.runs||[]).filter(run=>run.kind==='math').map(run=>run.mathKey||mathMarkupKey(run.mathMl)));
const textOf=content=>content.mathText || content.text || (content.items||[]).map(item=>item.body||item.text||'').join('\n');
const approved=(project,id)=>project.sourceObjectExclusions?.some(item=>item.objectId===id && item.approvedBy==='user' &&
  Boolean(project.source?.sha256) && item.sourceHash===project.source.sha256 && typeof item.reason==='string' && item.reason.trim());

export function inspectObjectIntegrity(project, slides=project.deck?.slides||[]) {
  const issues=[],objects=[],nodes=slides.flatMap(slide=>visibleNodes(slide).map(node=>({slide,node})));
  const allowOriginalSummary=project.generationPolicy?.content==='overview'&&allowsEditorialSelection(project)&&project.pageDecision?.mode==='auto'&&!project.requestedOutline&&!String(project.userRequirements||'').trim()&&contentSelectionMatchesSource(project);
  // A card deck shows a source object verbatim only where the reviewed outline
  // chose it; elsewhere its card's points carry it (3143, 1efa0344: a
  // checklist became the eight points of page 9).
  const cardObjects=cardsFlow(project)?new Set((project.outline||[]).flatMap(page=>page.cardObjects||[])):null;
  for (const item of project.source?.semantic?.inventory?.items||[]) {
    if(!isSourceArtifactItem(item))continue;
    if(cardObjects&&!cardObjects.has(item.id)&&!nodes.some(({node})=>node.sourceArtifact?.sourceUnitId===item.id)){objects.push({objectId:item.id,type:item.type,priority:'card_points',status:'card_points'});continue;}
    if(item.diagramSource?.presentation==='semantic_graph_rows'){
      const valid=validGraphProjection(item),audit=project.sourceGraphAudits?.[item.id];
      if(!valid||audit?.status!=='accepted'||audit.identity!==graphProjectionIdentity(item)||audit.result?.equivalent!==true||!['missingLabels','missingConnections','unsupportedConnections'].every(k=>Array.isArray(audit.result?.[k])&&!audit.result[k].length))issues.push({code:'source_graph_projection_unverified',severity:'error',sourceUnitId:item.id,repairable:false,message:'The source graph needs a current independent audit of its original labels, directions, parallel lanes and branches.'});
      if(!valid)continue;
    }
    const rendered=nodes.filter(({node})=>node.sourceArtifact?.sourceUnitId===item.id);
    const assignments=(project.planning?.slidePlan||[]).filter(plan=>plan.sourceArtifacts?.some(ref=>ref.sourceUnitId===item.id));
    const primaryPages=[...new Set(rendered.filter(({node,slide})=>!['recap','application','translation'].includes(node.repeatPurpose||node.content?.repeatPurpose||slide.repeatPurpose)).map(({slide})=>slide.id))];
    if(!['TableBlock','SummaryTableBlock'].includes(item.type)&&primaryPages.length>1&&!rendered.every(({node})=>node.sourceArtifact.lineStart!==undefined&&node.sourceArtifact.lineEnd!==undefined))issues.push({code:'required_source_object_duplicate',severity:'error',sourceUnitId:item.id,slideIds:primaryPages,slideId:primaryPages[1],repairable:true,
      message:`Required object ${item.id} has multiple primary pages; retain one complete primary representation and declare any purposeful recap explicitly.`});
    let complete=false,missingRows=[],originalRestored=false;
    const legacyDrawing=item.type==='TableBlock'&&item.diagramSource?.kind==='ascii'?sourceComponent(item):null;
    if(legacyDrawing?.content?.codeBlock?.language==='diagram'){
      complete=primaryPages.length===1&&rendered.some(({node})=>node.type==='text'&&node.content?.text===legacyDrawing.content.text&&node.content?.codeBlock?.sourceText===legacyDrawing.content.text&&node.content?.codeBlock?.language==='diagram');
    } else if(['TableBlock','SummaryTableBlock'].includes(item.type)) {
      const rows=new Map();
      const primary=rendered.filter(({node,slide})=>node.type==='table'&&!['recap','application','translation'].includes(node.repeatPurpose||node.content?.repeatPurpose||slide.repeatPurpose));
      for(let a=0;a<primary.length;a++)for(let b=a+1;b<primary.length;b++){
        const left=primary[a],right=primary[b],start=Math.max(left.node.sourceArtifact.rowStart??1,right.node.sourceArtifact.rowStart??1),end=Math.min(left.node.sourceArtifact.rowEnd??item.rows.length,right.node.sourceArtifact.rowEnd??item.rows.length);
        if(start<end)issues.push({code:'required_source_table_row_duplicate',severity:'error',sourceUnitId:item.id,slideId:right.slide.id,slideIds:[left.slide.id,right.slide.id],repairable:true,message:`Table ${item.id} repeats primary data rows ${start}–${end-1}; disjoint fragments and repeated headers are allowed.`});
      }
      // A native diagram (cards, layer bands, KPI tiles, doughnut) displays
      // the same rows: its declared cells must equal the original and each
      // cell must be visible on the diagram.
      for(const {node} of rendered.filter(({node})=>node.content?.diagram?.version===1)){const proof=diagramCoverage(item,node);if(proof.complete)for(const row of proof.rows)rows.set(row,true);}
      // A table shown with its other-language copy line under line (paired
      // objects, Fable plan T26): each cell is the original, or the original
      // above the paired table's cell.
      const twinId=[...objectPairs(project)].find(([,primary])=>primary===item.id)?.[0],twin=twinId&&(project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).find(value=>value.id===twinId);
      const sameCell=(cell,r,col)=>{const orig=String(item.rows[r]?.[col]??''),other=String(twin?.rows?.[r]?.[col]??'').trim();return cellKey(cell)===cellKey(orig)||Boolean(other&&other!==orig.trim()&&cellKey(cell)===cellKey(orig+'\n'+other));};
      for(const {node} of rendered.filter(({node})=>node.type==='table')) {
        const start=node.sourceArtifact.rowStart??1,actual=node.content?.rows||[];
        if(!(actual[0]||[]).every((cell,col)=>sameCell(cell,0,col))||(actual[0]||[]).length!==(item.rows[0]||[]).length)continue;
        actual.slice(1).forEach((row,index)=>{
          const original=start+index;
          if(row.length===item.rows[original]?.length && row.every((cell,col)=>(item.diagramSource?.kind==='ascii'?String(cell)===sourceRichText(item.rows[original][col],{inline:true}).plainText:sameCell(cell,original,col))&&[item.rows[original][col],`${item.rows[original][col]}\n${twin?.rows?.[original]?.[col]??''}`].some(expected=>JSON.stringify((node.content?.cellRich?.[index+1]?.[col]||sourceRichText(cell,{inline:true})).runs.filter(r=>r.kind==='math').map(r=>r.mathKey))===JSON.stringify(sourceRichText(expected,{inline:true}).runs.filter(r=>r.kind==='math').map(r=>r.mathKey)))))rows.set(original,true);
        });
      }
      missingRows=item.rows.slice(1).flatMap((_,index)=>rows.has(index+1)?[]:[index+1]);
      complete=missingRows.length===0 && rendered.length>0;
    } else if(supportsSourceLineRanges(item)&&rendered.some(({node})=>node.sourceArtifact.lineStart!==undefined)){
      const primary=rendered.filter(({node,slide})=>!['recap','application','translation'].includes(node.repeatPurpose||node.content?.repeatPurpose||slide.repeatPurpose));
      const proof=inspectSourceLineCoverage(item,primary.map(({node})=>({...node.sourceArtifact,nodeId:node.id,text:item.type==='CodeBlock'?node.content?.text:node.content?.processSource,language:node.content?.codeBlock?.language})));
      complete=proof.complete&&primary.every(({node})=>{const expected=sourceComponent(item,node.sourceArtifact);return node.type===expected.type&&(item.type==='CodeBlock'?node.content?.text===expected.content.text:key(textOf(node.content||{}))===key(textOf(expected.content)))&&(!expected.content.mathMl||mathMarkupKey(node.content.mathMl)===mathMarkupKey(expected.content.mathMl))&&JSON.stringify(inlineMathKeys(node.content||{}))===JSON.stringify(inlineMathKeys(expected.content));});
      if(!proof.complete)issues.push(...proof.issues.map(issue=>({...issue,severity:'error',sourceUnitId:item.id,slideId:primary.find(({node})=>node.id===issue.nodeId)?.slide.id||primary[0]?.slide.id,repairable:true,message:'Source line fragments must preserve every original line, language, indentation and deck reading order exactly.'})));
    } else if(item.type==='ChartBlock'){
      complete=rendered.some(({node})=>node.type==='chart'&&['chartType','labels','values','series','unit','numberFormat','chartSource','chartTitle','axisTitles'].every(k=>JSON.stringify(node.content?.[k])===JSON.stringify(item.chart?.[k])));
    } else {
      const expected=sourceComponent(item);
      complete=rendered.some(({node})=>node.type===expected.type && (item.type==='CodeBlock' ? textOf(node.content||{})===item.text && node.content?.codeBlock?.language===(item.language||'') : key(textOf(node.content||{}))===key(textOf(expected.content))) &&
        (!expected.content.mathMl || mathMarkupKey(node.content.mathMl)===mathMarkupKey(expected.content.mathMl))&&JSON.stringify(inlineMathKeys(node.content||{}))===JSON.stringify(inlineMathKeys(expected.content)));
      // Restoring the SAME authorized summary to its complete immutable prose
      // is source-preserving. Arbitrary expansions, tables, code and math keep
      // their exact existing contracts; layout/ownership guards still apply.
      if(!complete&&allowOriginalSummary&&expected.type==='text'&&item.derivedSummary?.sourceUnitId===item.id&&item.derivedSummary?.ledgerHash===project.contentSelection.hash&&project.contentSelection.entries.some(e=>e.sourceUnitId===item.id&&e.destination==='summary'&&e.unitHash===item.derivedSummary.unitHash)){
        const original=project.originalSourceInventory?.items?.find(i=>i.id===item.id);
        if(original&&!original.rows&&!['CodeBlock','EquationBlock','ChartBlock'].includes(original.type)){
          const full=sourceComponent(original),math=text=>sourceRichText(text).runs.filter(r=>r.kind==='math').map(r=>r.mathKey);
          originalRestored=full.type==='text'&&rendered.some(({node})=>node.type==='text'&&key(textOf(node.content||{}))===key(textOf(full.content))&&JSON.stringify(math(node.content?.richText?.source||node.content?.rawText||node.content?.text||''))===JSON.stringify(math(original.text)));
          if(originalRestored)complete=true;
        }
      }
      if(!complete&&expected.type==='list'&&rendered.length){
        const fragments=rendered.map(({node})=>node).sort((a,b)=>(a.sourceArtifact.itemStart??Infinity)-(b.sourceArtifact.itemStart??Infinity));
        const count=expected.content.items.length;
        complete=fragments.length===count&&fragments.every((node,i)=>node.type==='list'&&node.sourceArtifact.itemStart===i&&node.sourceArtifact.itemEnd===i+1&&node.content?.items?.length===1&&key(textOf(node.content))===key(textOf({items:[expected.content.items[i]]}))&&
          JSON.stringify(sourceRichText(node.content.items[0].richText?.source||node.content.items[0].text).runs.filter(r=>r.kind==='math').map(r=>r.mathKey))===JSON.stringify(sourceRichText(expected.content.items[i].richText?.source||expected.content.items[i].text).runs.filter(r=>r.kind==='math').map(r=>r.mathKey)));
      }

    }
    if(!complete&&rendered.some(({node})=>validSummaryProjection(project,item,node)))complete=true;
    const excluded=approved(project,item.id),status=excluded?'excluded_approved':complete?'rendered':'failed';
    objects.push({objectId:item.id,type:item.type,priority:'required',status,
      ...(originalRestored?{representation:'complete_immutable_original_instead_of_summary'}:{}),
      plannedSlideIds:assignments.map(plan=>plan.slideId),visibleNodeIds:rendered.map(({node})=>node.id),
      renderedSlideIds:[...new Set(rendered.map(({slide})=>slide.id))],...(missingRows.length?{missingRows}:{})});
    if(!excluded&&!complete)issues.push({code:'required_source_object_missing',severity:'error',sourceUnitId:item.id,
      slideId:assignments[0]?.slideId||null,repairable:true,
      message:`Required ${item.type} ${item.id} is missing or incomplete in visible objects; retain all planned content, columns, variables and relationships.`,
      details:{missingRows,plannedSlideIds:assignments.map(plan=>plan.slideId)}});
  }
  // An optional figure the card outline left out (Fable F3: appendix below the full length) is listed in the notes, not required.
  const optionalFigures=new Set(project.planningContract?.cardOutline?.raw?.optionalFigures||[]);
  for(const image of project.source?.images||[]) {
    if(!image.required && !image.mustPreserve || optionalFigures.has(image.id))continue;
    const found=nodes.filter(({node})=>node.type==='image' && image.dataUrl && node.content?.dataUrl===image.dataUrl);
    // A foreign-language caption is shown in the deck's language (its full text is in the notes; Fable 2026-11-02);
    // a caption beside points shows its first sentence, the notes carrying it whole (Fable P2).
    const shown=displayCaption(project,image);
    const captionVisible=!shown || nodes.some(({node})=>node.content?.sourceImageCaptionId===image.id && ([key(shown),...(node.content.notePointer?[key(shown+'\n'+node.content.notePointer)]:[])].includes(key(node.content.text))||node.content.captionShortened&&String(node.content.text||'').trim().length>0));
    const excluded=approved(project,image.id),complete=found.length>0 && captionVisible;
    objects.push({objectId:image.id,type:'SourceImage',priority:'required',status:excluded?'excluded_approved':complete?'rendered':'failed',visibleNodeIds:found.map(({node})=>node.id),captionVisible});
    if(!excluded&&!complete)issues.push({code:'required_source_media_missing',severity:'error',sourceUnitId:image.id,repairable:true,message:`Required source image ${image.caption?.trim()?`"${image.caption.trim().split('\n')[0].slice(0,80)}" (${image.id})`:image.id} ${found.length?'is shown without its caption':'is on no page'}.`});
  }
  // A user acknowledgement for this exact source hash authorises the loss.
  for(const warning of unresolvedSourceWarnings(project))issues.push({code:'required_source_media_decode',severity:'error',repairable:false,message:warning.message,details:{location:warning.location,key:sourceWarningKey(warning)}});
  for(const slide of slides) for(const node of visibleNodes(slide)) {
    if(node.type!=='image' || !node.content?.mediaReplacement)continue;
    if(!node.content.dataUrl && !node.content.assetRef && !node.content.assetId)issues.push({code:'media_replacement_missing',severity:'error',slideId:slide.id,nodeIds:[node.id],repairable:true,message:'A media replacement has no usable asset.'});
  }
  const templateAssets=[];
  for(let index=0;index<slides.length;index++){
    const spec=project.templateFidelity?.slides?.[index];if(!spec)continue;
    for(const asset of spec.nodes?.filter(node=>['image','chart','table'].includes(node.type))||[]){
      const visible=visibleNodes(slides[index]).find(node=>node.nativeRef?.shapeId===asset.nativeRef?.shapeId);
      const omission=slides[index].templateOmissions?.find(item=>item.shapeId===asset.nativeRef?.shapeId);
      const allVisible=visibleNodes(slides[index]);
      const role=asset.type==='image'?templateMediaRole(asset,spec,project.templateFidelity):asset.content?.mediaRole||'unknown';
      const sameAsset=visible&&visible.type===asset.type&&(asset.type==='image'
        ? visible.content?.dataUrl===asset.content?.dataUrl&&visible.content?.imageSha256===asset.content?.imageSha256
        : JSON.stringify(visible.content)===JSON.stringify(asset.content));
      const artReplacement=visible&&visible.type==='image'&&visible.content?.mediaReplacement&&['template_decoration','template_icon','template_artwork'].includes(role)&&Boolean(visible.content.dataUrl)&&JSON.stringify(visible.geometry)===JSON.stringify(asset.geometry);
      const replaced=verifiedReplacement(asset,omission,allVisible);
      const status=sameAsset?'retained':artReplacement?'replaced_verified':approved(project,asset.id)?'excluded_by_user':replaced?'replaced_verified':!protectedTemplateAsset(asset)&&validAdaptation(project,asset,omission,role)?'retired_by_adaptation':'unresolved';
      templateAssets.push({objectId:asset.id,slideId:slides[index].id,role,status,
        ...(omission?{reason:omission.reason,approvalBasis:omission.approvalBasis||'unverified_request'}:{}),
        replacementNodeIds:artReplacement?[visible.id]:replaced?omission.replacementNodeIds:[],...(artReplacement?{verificationBasis:'decorative_asset_in_same_frame'}:{})});
      if(status==='unresolved')issues.push({code:'template_media_unaccounted',severity:'error',slideId:slides[index].id,repairable:true,message:`Template asset ${asset.id} disappeared without a replacement or justified disposition.`});
    }
  }
  return {issues,ledger:{version:2,sourceHash:project.source?.sha256||null,objects,templateAssets,
    requiredCount:objects.length,fulfilledCount:objects.filter(o=>['rendered','excluded_approved','card_points'].includes(o.status)).length}};
}

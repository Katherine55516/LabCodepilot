import { validAdaptation, verifiedReplacement } from './ppt-template-dispositions.mjs';
/** The ownership ledger measures rendered objects, never mere citations. */
import { sourceComponent, isSourceArtifactItem, protectedTemplateAsset } from './ppt-density-capacity.mjs';
import { sourceDisplayText,sourceRichText } from './ppt-source-text.mjs';
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { templateMediaRole } from './ppt-template-fidelity.mjs';
import { mathMarkupKey } from './ppt-math.mjs';
const key=value=>sourceDisplayText(value).normalize('NFKC').replace(/\s+/gu,' ').trim();
const textOf=content=>content.mathText || content.text || (content.items||[]).map(item=>item.body||item.text||'').join('\n');
const approved=(project,id)=>project.sourceObjectExclusions?.some(item=>item.objectId===id && item.approvedBy==='user' &&
  Boolean(project.source?.sha256) && item.sourceHash===project.source.sha256 && typeof item.reason==='string' && item.reason.trim());

export function inspectObjectIntegrity(project, slides=project.deck?.slides||[]) {
  const issues=[],objects=[],nodes=slides.flatMap(slide=>visibleNodes(slide).map(node=>({slide,node})));
  for (const item of project.source?.semantic?.inventory?.items||[]) {
    if(!isSourceArtifactItem(item))continue;
    const rendered=nodes.filter(({node})=>node.sourceArtifact?.sourceUnitId===item.id);
    const assignments=(project.planning?.slidePlan||[]).filter(plan=>plan.sourceArtifacts?.some(ref=>ref.sourceUnitId===item.id));
    const primaryPages=[...new Set(rendered.filter(({node,slide})=>!['recap','application','translation'].includes(node.repeatPurpose||node.content?.repeatPurpose||slide.repeatPurpose)).map(({slide})=>slide.id))];
    if(!['TableBlock','SummaryTableBlock'].includes(item.type)&&primaryPages.length>1)issues.push({code:'required_source_object_duplicate',severity:'error',sourceUnitId:item.id,slideIds:primaryPages,slideId:primaryPages[1],repairable:true,
      message:`Required object ${item.id} has multiple primary pages; retain one complete primary representation and declare any purposeful recap explicitly.`});
    let complete=false,missingRows=[];
    if(['TableBlock','SummaryTableBlock'].includes(item.type)) {
      const rows=new Map();
      for(const {node} of rendered.filter(({node})=>node.type==='table')) {
        const start=node.sourceArtifact.rowStart??1,actual=node.content?.rows||[];
        if(key(actual[0]?.join('\u241f'))!==key(item.rows[0]?.join('\u241f')))continue;
        actual.slice(1).forEach((row,index)=>{
          const original=start+index;
          if(row.length===item.rows[original]?.length && row.every((cell,col)=>key(cell)===key(item.rows[original][col])&&JSON.stringify((node.content?.cellRich?.[index+1]?.[col]||sourceRichText(cell)).runs.filter(r=>r.kind==='math').map(r=>r.mathKey))===JSON.stringify(sourceRichText(item.rows[original][col]).runs.filter(r=>r.kind==='math').map(r=>r.mathKey))))rows.set(original,true);
        });
      }
      missingRows=item.rows.slice(1).flatMap((_,index)=>rows.has(index+1)?[]:[index+1]);
      complete=missingRows.length===0 && rendered.length>0;
    } else if(item.type==='ChartBlock'){
      complete=rendered.some(({node})=>node.type==='chart'&&['chartType','labels','values','series','unit','numberFormat','chartSource','chartTitle','axisTitles'].every(k=>JSON.stringify(node.content?.[k])===JSON.stringify(item.chart?.[k])));
    } else {
      const expected=sourceComponent(item);
      complete=rendered.some(({node})=>node.type===expected.type && (item.type==='CodeBlock' ? textOf(node.content||{})===item.text && node.content?.codeBlock?.language===(item.language||'') : key(textOf(node.content||{}))===key(textOf(expected.content))) &&
        (!expected.content.mathMl || mathMarkupKey(node.content.mathMl)===mathMarkupKey(expected.content.mathMl)));
      if(!complete&&expected.type==='list'&&rendered.length){
        const fragments=rendered.map(({node})=>node).sort((a,b)=>(a.sourceArtifact.itemStart??Infinity)-(b.sourceArtifact.itemStart??Infinity));
        const count=expected.content.items.length;
        complete=fragments.length===count&&fragments.every((node,i)=>node.type==='list'&&node.sourceArtifact.itemStart===i&&node.sourceArtifact.itemEnd===i+1&&node.content?.items?.length===1&&key(textOf(node.content))===key(textOf({items:[expected.content.items[i]]}))&&
          JSON.stringify(sourceRichText(node.content.items[0].richText?.source||node.content.items[0].text).runs.filter(r=>r.kind==='math').map(r=>r.mathKey))===JSON.stringify(sourceRichText(expected.content.items[i].richText?.source||expected.content.items[i].text).runs.filter(r=>r.kind==='math').map(r=>r.mathKey)));
      }

    }
    const excluded=approved(project,item.id),status=excluded?'excluded_approved':complete?'rendered':'failed';
    objects.push({objectId:item.id,type:item.type,priority:'required',status,
      plannedSlideIds:assignments.map(plan=>plan.slideId),visibleNodeIds:rendered.map(({node})=>node.id),
      renderedSlideIds:[...new Set(rendered.map(({slide})=>slide.id))],...(missingRows.length?{missingRows}:{})});
    if(!excluded&&!complete)issues.push({code:'required_source_object_missing',severity:'error',sourceUnitId:item.id,
      slideId:assignments[0]?.slideId||null,repairable:true,
      message:`Required ${item.type} ${item.id} is missing or incomplete in visible objects; retain all planned content, columns, variables and relationships.`,
      details:{missingRows,plannedSlideIds:assignments.map(plan=>plan.slideId)}});
  }
  for(const image of project.source?.images||[]) {
    if(!image.required && !image.mustPreserve)continue;
    const found=nodes.filter(({node})=>node.type==='image' && image.dataUrl && node.content?.dataUrl===image.dataUrl);
    const captionVisible=!image.caption?.trim() || nodes.some(({node})=>node.content?.sourceImageCaptionId===image.id && key(node.content.text)===key(image.caption));
    const excluded=approved(project,image.id),complete=found.length>0 && captionVisible;
    objects.push({objectId:image.id,type:'SourceImage',priority:'required',status:excluded?'excluded_approved':complete?'rendered':'failed',visibleNodeIds:found.map(({node})=>node.id),captionVisible});
    if(!excluded&&!complete)issues.push({code:'required_source_media_missing',severity:'error',sourceUnitId:image.id,repairable:true,message:`Required source image ${image.id} or its caption has no complete visible representation.`});
  }
  for(const warning of project.source?.mediaWarnings||[])if(warning.required)issues.push({code:'required_source_media_decode',severity:'error',repairable:false,message:warning.message,details:{location:warning.location}});
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
    requiredCount:objects.length,fulfilledCount:objects.filter(o=>['rendered','excluded_approved'].includes(o.status)).length}};
}

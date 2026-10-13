/** Bounded structural repair of overflowing outline pages. The model partitions
 * source ownership; code preserves original copy and checks every selected row.
 * Native reassignment and the existing global gates remain authoritative. */
import {candidateFit} from './ppt-density-packing.mjs';
import {contentCanvas,fitComponents,isSourceArtifactItem,sourceComponent,INCH} from './ppt-density-capacity.mjs';
const unique=list=>[...new Set(list)];
function nativeTargets(project){
  const seen=new Set(),indexes=[];
  for(let index=1;index<project.pages;index++){
    const canvas=contentCanvas(project,index),key=JSON.stringify([canvas.geometry,canvas.fontSizePt]);
    if(!seen.has(key)){seen.add(key);indexes.push(index);}
  }
  return indexes.length?indexes:[1];
}
function conservativeAdvice(slide,project){
  const indexes=nativeTargets(project),items=project.source.semantic.inventory.items;
  const measure=component=>indexes.map(index=>fitComponents([component],project,index));
  const tableFragments=[],componentFits=[];
  for(const item of items.filter(item=>slide.sourceUnitIds?.includes(item.id)&&isSourceArtifactItem(item))){
    const refs=slide.sourceArtifactRanges?.filter(ref=>ref.sourceUnitId===item.id)||[];
    for(const ref of refs.length?refs:[{sourceUnitId:item.id}]){
      const fits=measure(sourceComponent(item,ref));
      componentFits.push({sourceUnitId:item.id,...ref,fitsEveryNativeBody:fits.every(f=>f.capacity_ok)});
      if(item.type!=='TableBlock')continue;
      let start=ref.rowStart??1;const end=ref.rowEnd??item.rows.length;
      while(start<end){
        let best;
        for(let stop=start+1;stop<=end;stop++){
          const selection={sourceUnitId:item.id,rowStart:start,rowEnd:stop},fits=measure(sourceComponent(item,selection));
          if(!fits.every(f=>f.capacity_ok))break;
          if(stop===start+1||fits.every(f=>f.usedHeight<=f.availableHeight*.65))best=selection;else break;
        }
        if(!best){tableFragments.push({sourceUnitId:item.id,rowStart:start,rowEnd:start+1,fitsEveryNativeBody:false});start++;}
        else{tableFragments.push({...best,fitsEveryNativeBody:true});start=best.rowEnd;}
      }
    }
  }
  return {nativeBodyBounds:indexes.map(index=>{const c=contentCanvas(project,index);return {fontSizePt:c.fontSizePt,widthInches:Number((c.geometry.width/INCH).toFixed(2)),heightInches:Number((c.geometry.height/INCH).toFixed(2))};}),componentFits,tableFragments};
}
function scopeSlide(assessed,scope){
  const indexes=Array.isArray(scope)?scope:[scope],slides=indexes.map(index=>assessed.rawOutline.slides[index]);
  if(slides.length===1)return slides[0];
  if(slides.some(s=>s.titleLocked||s.title_locked))throw new Error('cannot repartition several locked titles');
  const items=assessed.project.source.semantic.inventory.items;
  const sourceArtifactRanges=[];
  for(const item of items.filter(item=>item.type==='TableBlock')){
    const rows=new Set();
    for(const slide of slides.filter(s=>s.sourceUnitIds?.includes(item.id))){
      const refs=slide.sourceArtifactRanges?.filter(r=>r.sourceUnitId===item.id)||[];
      for(const ref of refs.length?refs:[{}])for(let row=ref.rowStart??1;row<(ref.rowEnd??item.rows.length);row++)rows.add(row);
    }
    const ordered=[...rows].sort((a,b)=>a-b);let start=ordered[0],last=start;
    for(const row of ordered.slice(1)){if(row!==last+1){sourceArtifactRanges.push({sourceUnitId:item.id,rowStart:start,rowEnd:last+1});start=row;}last=row;}
    if(start!==undefined)sourceArtifactRanges.push({sourceUnitId:item.id,rowStart:start,rowEnd:last+1});
  }
  return {title:slides.map(s=>s.title).join(' / '),originalTitles:slides.map(s=>s.title),
    sourceUnitIds:unique(slides.flatMap(s=>s.sourceUnitIds||[])),sourceImageIds:unique(slides.flatMap(s=>s.sourceImageIds||[])),
    keyPoints:slides.flatMap(s=>s.keyPoints||[]),requiredDetails:slides.flatMap(s=>s.requiredDetails||[]),
    requiredEvidenceIds:unique(slides.flatMap(s=>s.requiredEvidenceIds||[])),sourceArtifactRanges,
    pageContracts:slides.map(s=>s.pageContract)};
}
export function outlineCapacityRepairPrompt(assessed,index){
  const slide=scopeSlide(assessed,index),project=assessed.project;
  const owned=project.source.semantic.inventory.items.filter(item=>slide.sourceUnitIds?.includes(item.id));
  return `局部大纲容量修复。只重新分配给出的失败页面范围，不改写正文，不重做整份大纲。重复来源的多个主讲页已合为一个范围，必须把非表格完整来源分配给唯一主讲页。返回 JSON {"slides":[...]}。可增加候选页，最终页数仍由代码重新拟合决定。\n
每页给 section,title,focus,question,groupId,visualIntent,pageContract,sourceUnitIds,sourceImageIds,sourceArtifactRanges，以及 keyPointIndexes、requiredDetailIndexes、requiredEvidenceIds。不要返回 keyPoints 或 requiredDetails 的新正文，代码会按索引保留初稿的完整文字。keyPointIndexes 覆盖初稿所有 keyPoints 的 0-based 索引，恰好一次；requiredDetailIndexes 同理。保留全部原 sourceUnitIds/sourceImageIds/requiredEvidenceIds，不引入其他来源。非表格来源只主讲一次，可把完整语言单元分到连续页。\n
表格按 rowStart 包含、rowEnd 不包含分片，保留原稿选中的全部行和列，且每行恰好一次。原稿没有范围时表示 [1,rows.length) 全表。表格建议已按所有实际原生正文版式测量，当 tableFragments 的 fitsEveryNativeBody 全部为 true 时，按此测量方案每个 fragment 分配独立页面，不合并不同片段。每页只放一个表格分片与少量相关解释。独立完整小结与长表分开，全部语言保留，不擅自增加双语必须同页的 adjacencyPairs。不同页给各自具体 question/groupId，避免不同职责误合并。表格本身已完整承载事实，避免再复制表格为段落。每页都必须有真实来源单元或原 keyPoint。\n
实际重新分配后还会再次检查容量，不可用 capacity_ok 字段自称通过。保留真实来源关系、公式变量和用户锁定标题，不能删除事实来通过。原 pageContract 是模型草案，不是用户要求；草案发明的双语同页要求无效。两个完整语言 SummaryBlock 若同页无法容纳，必须分别主讲，不能再编造必须同页的 adjacencyPairs。原内容索引只能分配给一个页面，其他页面使用 []。\n
<deck_context>${JSON.stringify({brief:assessed.rawOutline.brief,titles:assessed.outline.map(s=>s.title)})}</deck_context>\n<failed_page>${JSON.stringify({title:slide.title,originalTitles:slide.originalTitles,focus:slide.focus,titleLocked:slide.titleLocked||slide.title_locked,sourceUnitIds:slide.sourceUnitIds,sourceImageIds:slide.sourceImageIds,sourceArtifactRanges:slide.sourceArtifactRanges,keyPoints:slide.keyPoints,requiredDetails:slide.requiredDetails,requiredEvidenceIds:slide.requiredEvidenceIds,densityFit:slide.densityFit})}</failed_page>\n<indexed_copy>${JSON.stringify({keyPoints:(slide.keyPoints||[]).map((point,index)=>({index,...point})),requiredDetails:(slide.requiredDetails||[]).map((text,index)=>({index,text}))})}</indexed_copy>\n<owned_source>${JSON.stringify(owned)}</owned_source>\n<measured_native_advice>${JSON.stringify(conservativeAdvice(slide,project))}</measured_native_advice>\n仅返回紧凑 JSON。`;
}
function requireExactIndexes(slides,key,total){
  const assigned=slides.flatMap(slide=>slide[key]||[]);
  if(assigned.length!==total||assigned.some(i=>!Number.isInteger(i)||i<0||i>=total)||new Set(assigned).size!==total){
    const expected=Array.from({length:total},(_,i)=>i),missing=expected.filter(i=>!assigned.includes(i)),duplicates=unique(assigned.filter((i,n)=>assigned.indexOf(i)!==n));
    throw new Error(`${key} must preserve every original index exactly once: ${JSON.stringify({expected,assigned,missing,duplicates})}. Assign each index to one responsible page only; use [] on other pages.`);
  }
}
function requireOwnership(slides,key,original){
  const assigned=slides.flatMap(s=>s[key]||[]),expected=unique(original||[]);
  if(assigned.some(id=>!expected.includes(id))||expected.some(id=>!assigned.includes(id)))throw new Error(`${key} ownership changed outside failed page`);
}
export function applyOutlineCapacityRepair(assessed,index,response){
  const old=scopeSlide(assessed,index),replacements=response?.slides;
  if(!Array.isArray(replacements)||!replacements.length||replacements.length>16||replacements.some(s=>!s||typeof s!=='object'))throw new Error('invalid bounded page partitions');
  requireExactIndexes(replacements,'keyPointIndexes',old.keyPoints?.length||0);
  requireExactIndexes(replacements,'requiredDetailIndexes',old.requiredDetails?.length||0);
  for(const key of ['sourceUnitIds','sourceImageIds','requiredEvidenceIds'])requireOwnership(replacements,key,old[key]);
  const items=assessed.project.source.semantic.inventory.items;
  for(const id of old.sourceUnitIds||[]){
    const item=items.find(item=>item.id===id),owners=replacements.filter(s=>s.sourceUnitIds?.includes(id));
    if(item.type!=='TableBlock'){if(owners.length!==1)throw new Error('non-table ownership must remain unique');continue;}
    const rowsFor=slides=>slides.flatMap(s=>{
      const refs=(s.sourceArtifactRanges||[]).filter(r=>r.sourceUnitId===id);
      return (refs.length?refs:[{rowStart:1,rowEnd:item.rows.length}]).flatMap(r=>{
        const start=r.rowStart??1,end=r.rowEnd??item.rows.length;
        if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end>item.rows.length||start>=end)throw new Error('invalid table partition range');
        return Array.from({length:end-start},(_,i)=>start+i);
      });
    });
    const before=unique(rowsFor([old])).sort((a,b)=>a-b),after=rowsFor(owners).sort((a,b)=>a-b);
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error(`table partition dropped or duplicated original rows: ${JSON.stringify({sourceUnitId:id,expectedRows:before,assignedRows:after,missing:before.filter(row=>!after.includes(row)),duplicates:unique(after.filter((row,n)=>after.indexOf(row)!==n))})}. rowEnd is exclusive; each selected data row belongs to exactly one fragment.`);
  }
  const result=replacements.map((s,part)=>{
    if(old.titleLocked||old.title_locked)if(s.title!==old.title)throw new Error('locked outline title changed');
    if(!(s.sourceUnitIds?.length||s.keyPointIndexes?.length))throw new Error('empty page partition');
    const {keyPointIndexes,requiredDetailIndexes,keyPoints,requiredDetails,densityFit,id,...fields}=s;
    return {...fields,...(old.titleLocked?{titleLocked:true}:{}),...(old.title_locked?{title_locked:true}:{}),
      keyPoints:(keyPointIndexes||[]).map(i=>structuredClone(old.keyPoints[i])),requiredDetails:(requiredDetailIndexes||[]).map(i=>old.requiredDetails[i])};
  });
  const targets=nativeTargets(assessed.project);
  for(const slide of result){
    const fits=targets.map(target=>candidateFit(slide,assessed.project,target));
    const components=items.filter(item=>slide.sourceUnitIds?.includes(item.id)&&isSourceArtifactItem(item)).flatMap(item=>{
      const refs=slide.sourceArtifactRanges?.filter(ref=>ref.sourceUnitId===item.id)||[];
      return (refs.length?refs:[{}]).map(ref=>sourceComponent(item,ref));
    });
    components.push(...slide.keyPoints.map(point=>({type:'text',content:{text:point.text}})));
    const individuallyPortable=!slide.sourceImageIds?.length&&components.every(component=>targets.every(target=>fitComponents([component],assessed.project,target).capacity_ok));
    if(!fits.some(f=>f.capacity_ok)||individuallyPortable&&!fits.every(f=>f.capacity_ok))throw new Error(`page ${slide.title} fails measured native capacity: ${JSON.stringify({sourceUnitIds:slide.sourceUnitIds,sourceArtifactRanges:slide.sourceArtifactRanges,keyPointCount:slide.keyPoints.length,individuallyPortable,bodyFits:fits.map(f=>({capacity_ok:f.capacity_ok,fontSizePt:f.fontSizePt,overflowEMU:f.predictedOverflow}))})}. Keep each measured table fragment separate; put complete language summaries on separate pages; move original keyPoint indexes to independent explanation pages when necessary. Generated draft adjacencyPairs are not user constraints.`);
  }
  return result;
}
export function overflowingOutlinePages(assessed){
  return assessed.rawOutline.slides.flatMap((s,index)=>index>0&&candidateFit(s,assessed.project,index).predictedOverflow>0?[index]:[]);
}

/** Restore only required source artifacts absent from a generated draft. The
 * source text/cells are not authored here: the original component remains the
 * writer's input. Existing assignments and copy are immutable, and the normal
 * native capacity/coverage assessment still decides acceptance. */
export function restoreMissingSourceArtifacts(assessed){
  const items=assessed.project.source.semantic.inventory.items,slides=assessed.rawOutline.slides;
  const additions=[];
  for(const item of items.filter(isSourceArtifactItem)){
    const owners=slides.filter(s=>s.sourceUnitIds?.includes(item.id));
    const ranges=[];
    if(item.type==='TableBlock'){
      const owned=new Set();
      for(const owner of owners){
        const refs=owner.sourceArtifactRanges?.filter(r=>r.sourceUnitId===item.id)||[];
        for(const ref of refs.length?refs:[{}])for(let row=ref.rowStart??1;row<(ref.rowEnd??item.rows.length);row++)owned.add(row);
      }
      for(let row=1;row<item.rows.length;row++)if(!owned.has(row)){
        const previous=ranges.at(-1);
        if(previous?.rowEnd===row)previous.rowEnd=row+1;else ranges.push({sourceUnitId:item.id,rowStart:row,rowEnd:row+1});
      }
      if(!ranges.length)continue;
    }else if(owners.length)continue;
    const title=item.sectionPath?.at(-1)||item.type;
    additions.push({title,section:(item.sectionPath||[]).join(' / '),question:title,focus:title,
      sourceUnitIds:[item.id],sourceImageIds:[],sourceArtifactRanges:ranges,keyPoints:[],requiredDetails:[],requiredEvidenceIds:[],capacityPartition:true,
      pageContract:{job:'mechanism',requiredUnits:[item.id],requiredRelations:[],adjacencyPairs:[],compositionCandidates:['text']}});
  }
  if(!additions.length)return assessed.rawOutline;
  if(additions.length>16||slides.length+additions.length>100)throw new Error('missing required source artifacts exceed bounded coverage repair');
  const order=new Map(items.map((item,index)=>[item.id,index])),result=slides.map(s=>structuredClone(s));
  for(const addition of additions){
    const position=result.findIndex((slide,index)=>index>0&&(slide.sourceUnitIds||[]).some(id=>order.get(id)>order.get(addition.sourceUnitIds[0])));
    result.splice(position<0?Math.max(1,result.length-1):position,0,addition);
  }
  return {...assessed.rawOutline,slides:result};
}

/** Connected primary-owner conflicts must be repaired together; isolated
 * overflows retain their own scope. Unaffected pages never enter the prompt. */
export function outlineCapacityRepairScopes(assessed){
  const slides=assessed.rawOutline.slides,parent=slides.map((_,i)=>i),selected=new Set(overflowingOutlinePages(assessed));
  const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for(const item of assessed.project.source.semantic.inventory.items.filter(item=>isSourceArtifactItem(item)&&item.type!=='TableBlock')){
    const owners=slides.flatMap((s,i)=>i>0&&s.sourceUnitIds?.includes(item.id)&&!['recap','application','translation'].includes(s.repeatPurpose)?[i]:[]);
    if(owners.length>1)for(const i of owners){selected.add(i);parent[find(i)]=find(owners[0]);}
  }
  // An overflowing table can have another primary copy elsewhere. Repair its
  // overlapping selections together, retaining each distinct source row once.
  // Disjoint, intentional fragments and declared recaps remain independent.
  for(const item of assessed.project.source.semantic.inventory.items.filter(item=>item.type==='TableBlock')){
    const owners=slides.flatMap((s,i)=>i>0&&s.sourceUnitIds?.includes(item.id)&&!['recap','application','translation'].includes(s.repeatPurpose)?[i]:[]);
    const rows=i=>{const refs=slides[i].sourceArtifactRanges?.filter(r=>r.sourceUnitId===item.id)||[];return new Set((refs.length?refs:[{}]).flatMap(r=>Array.from({length:(r.rowEnd??item.rows.length)-(r.rowStart??1)},(_,j)=>(r.rowStart??1)+j)));};
    for(let a=0;a<owners.length;a++)for(let b=a+1;b<owners.length;b++){
      const left=owners[a],right=owners[b];if(!selected.has(left)&&!selected.has(right))continue;
      const leftRows=rows(left);if(![...rows(right)].some(row=>leftRows.has(row)))continue;
      selected.add(left);selected.add(right);parent[find(left)]=find(right);
    }
  }
  const groups=new Map();for(const i of [...selected].sort((a,b)=>a-b)){const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(i);}
  return [...groups.values()].sort((a,b)=>a[0]-b[0]);
}

/** Last bounded fallback: repartition only the original complete components.
 * It writes no new copy and measures every combination against all native body
 * frames, so changing the final template assignment cannot invalidate a merge.
 * The normal outline assessment and all later gates still decide acceptance. */
export function partitionOutlineWithMeasuredComponents(assessed,scope){
  const old=scopeSlide(assessed,scope),indexes=Array.isArray(scope)?scope:[scope],original=assessed.rawOutline.slides[indexes[0]];
  if(indexes.length>1&&indexes.some(i=>assessed.rawOutline.slides[i].titleLocked||assessed.rawOutline.slides[i].title_locked))throw new Error('cannot repartition several locked titles');
  const items=assessed.project.source.semantic.inventory.items,targets=nativeTargets(assessed.project),atoms=[];
  const empty=()=>({sourceUnitIds:[],sourceImageIds:[],sourceArtifactRanges:[],keyPointIndexes:[],requiredDetailIndexes:[],requiredEvidenceIds:[]});
  const advice=conservativeAdvice(old,assessed.project);
  for(const item of items.filter(item=>old.sourceUnitIds?.includes(item.id)&&isSourceArtifactItem(item))){
    if(item.type==='TableBlock'){
      const fragments=advice.tableFragments.filter(ref=>ref.sourceUnitId===item.id);
      if(fragments.some(ref=>!ref.fitsEveryNativeBody))throw new Error('a complete table row cannot fit every native body frame');
      for(const fragment of fragments){const {fitsEveryNativeBody,...ref}=fragment;atoms.push({...empty(),sourceUnitIds:[item.id],sourceArtifactRanges:[ref]});}
    }else atoms.push({...empty(),sourceUnitIds:[item.id]});
  }
  for(const id of old.sourceImageIds||[])atoms.push({...empty(),sourceImageIds:[id]});
  for(let i=0;i<(old.keyPoints?.length||0);i++)atoms.push({...empty(),keyPointIndexes:[i]});
  const merge=(a,b)=>{
    const result={...empty(),sourceUnitIds:unique([...a.sourceUnitIds,...b.sourceUnitIds]),sourceImageIds:unique([...a.sourceImageIds,...b.sourceImageIds]),keyPointIndexes:[...a.keyPointIndexes,...b.keyPointIndexes]};
    const ranges=[...a.sourceArtifactRanges,...b.sourceArtifactRanges].sort((x,y)=>x.sourceUnitId.localeCompare(y.sourceUnitId)||x.rowStart-y.rowStart);
    for(const ref of ranges){const previous=result.sourceArtifactRanges.at(-1);if(previous?.sourceUnitId===ref.sourceUnitId&&previous.rowEnd===ref.rowStart)previous.rowEnd=ref.rowEnd;else result.sourceArtifactRanges.push({...ref});}
    return result;
  };
  const visible=part=>({...part,keyPoints:part.keyPointIndexes.map(i=>old.keyPoints[i])});
  const fits=part=>targets.every(index=>candidateFit(visible(part),assessed.project,index).capacity_ok);
  const parts=[];
  for(const atom of atoms){
    if(!fits(atom))throw new Error('a complete source component cannot fit every native body frame');
    const combined=parts.length?merge(parts.at(-1),atom):null;
    if(combined&&fits(combined))parts[parts.length-1]=combined;else parts.push(atom);
  }
  if(!parts.length||parts.length>16)throw new Error('measured partition exceeds the bounded page scope');
  // Ordinary source-unit IDs carry retrieval ownership rather than extra
  // visible artifacts. Keep formula explanations with their actual formula.
  for(const id of (old.sourceUnitIds||[]).filter(id=>!isSourceArtifactItem(items.find(item=>item.id===id)))){
    const relation=assessed.project.source.semantic.inventory.relationships?.find(r=>r.type==='definition'&&r.unitIds?.includes(id));
    const target=relation?parts.find(part=>part.sourceUnitIds.includes(relation.unitIds[0])):null;
    (target||parts.find(part=>part.keyPointIndexes.length)||parts[0]).sourceUnitIds.push(id);
  }
  const detailTarget=parts.find(part=>part.keyPointIndexes.length)||parts[0];
  detailTarget.requiredDetailIndexes=Array.from({length:old.requiredDetails?.length||0},(_,i)=>i);
  const textOf=part=>{
    const fields=items.filter(item=>part.sourceUnitIds.includes(item.id)&&isSourceArtifactItem(item)).flatMap(item=>{
      const refs=part.sourceArtifactRanges.filter(ref=>ref.sourceUnitId===item.id);
      return (refs.length?refs:[{}]).map(ref=>sourceComponent(item,ref).content);
    });
    return JSON.stringify(fields)+' '+part.keyPointIndexes.map(i=>old.keyPoints[i].text).join(' ');
  };
  for(const id of old.requiredEvidenceIds||[]){const evidence=assessed.project.source.semantic.evidenceAtoms?.find(atom=>atom.id===id);(parts.find(part=>evidence?.exactText&&textOf(part).includes(evidence.exactText))||detailTarget).requiredEvidenceIds.push(id);}
  const slides=parts.map((part,index)=>({...part,capacityPartition:true,section:original.section,
    title:original.title,
    focus:original.focus,question:original.question,groupId:original.groupId,
    pageContract:{job:original.pageContract?.job||'mechanism',requiredUnits:part.sourceUnitIds,requiredRelations:[],adjacencyPairs:[],comparisonAxes:original.pageContract?.comparisonAxes||[],compositionCandidates:['text']}}));
  return applyOutlineCapacityRepair(assessed,scope,{slides});
}

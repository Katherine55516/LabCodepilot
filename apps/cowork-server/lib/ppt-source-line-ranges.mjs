/** Literal source line ranges. Callers
 * must retain the original inventory item as factual/AST authority. Ranges
 * are zero-based, end-exclusive, contiguous in deck reading order. */
const codeError=detail=>Object.assign(new Error('source_line_range_invalid: '+detail),{code:'source_line_range_invalid'});
export function supportsSourceLineRanges(item){return item?.type==='CodeBlock'||item?.type==='ProcessBlock'||item?.type==='ComparisonBlock'&&Boolean(item.diagramSource);}
export function sourceLines(item){if(!supportsSourceLineRanges(item))throw codeError('this source type has no literal line contract');return String(item.text??'').split('\n');}
export function sourceLineRange(item,ref={}){
 const lines=sourceLines(item),hasStart=ref.lineStart!==undefined,hasEnd=ref.lineEnd!==undefined;
 if(ref.sourceUnitId!==undefined&&ref.sourceUnitId!==item.id||hasStart!==hasEnd||ref.rowStart!==undefined||ref.rowEnd!==undefined)throw codeError('mixed or mismatched source reference');
 const start=hasStart?ref.lineStart:0,end=hasEnd?ref.lineEnd:lines.length;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>lines.length)throw codeError('line bounds must be integral and inside the original source');
 return {sourceUnitId:item.id,lineStart:start,lineEnd:end};
}
export function materializeSourceLineRange(item,ref={}){
 const range=sourceLineRange(item,ref);return {...item,text:sourceLines(item).slice(range.lineStart,range.lineEnd).join('\n'),sourceLineRange:range};
}
/** Measure complete literal prefixes; no LLM rewriting, font changes or line
 * dropping. Prefer a source blank/function boundary close to the fullest fit. */
export function paginateSourceLines(item,canFit,ref={}){
 const scope=sourceLineRange(item,ref),lines=sourceLines(item),result=[];let start=scope.lineStart;
 const fits=end=>{const result=canFit({sourceUnitId:item.id,lineStart:start,lineEnd:end});if(typeof result!=='boolean')throw codeError('capacity callback must return a synchronous boolean');return result;};
 while(start<scope.lineEnd){
  if(!fits(start+1))throw codeError('one complete source line cannot fit at the retained font');
  let lo=start+1,hi=scope.lineEnd;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(fits(mid))lo=mid;else hi=mid-1;}
  let end=lo;
  if(end<scope.lineEnd){const earliest=start+Math.max(2,Math.ceil((end-start)*.6));for(let index=end-1;index>=earliest;index--){if(!lines[index].trim()){end=index+1;break;}if(/^\s*(?:def |class |(?:export )?(?:async )?function )/u.test(lines[index])){end=index;break;}}}
  result.push({sourceUnitId:item.id,lineStart:start,lineEnd:end});start=end;
 }
 // Ordered process fragments have no code indentation/function boundary to
 // protect. Balance neighboring fragments after greedy capacity packing so a
 // few terminal steps do not become an otherwise empty page. Each candidate
 // must independently pass the same retained-font/template measurement.
 if(item.type==='ProcessBlock'&&result.length>1){
  for(let i=result.length-1;i>0;i--){
   const left=result[i-1],right=result[i],total=right.lineEnd-left.lineStart;
   if(right.lineEnd-right.lineStart>=(left.lineEnd-left.lineStart)*.6)continue;
   const midpoint=left.lineStart+Math.ceil(total/2);
   for(let boundary=midpoint;boundary<left.lineEnd;boundary++){
    const a={...left,lineEnd:boundary},b={...right,lineStart:boundary};
    if(canFit(a)===true&&canFit(b)===true){result[i-1]=a;result[i]=b;break;}
   }
  }
 }
 return result;
}
/** Every complete source line, indentation and blank line is checked once.
 * Do not sort by range: a reordered deck must fail even if its union is full. */
export function inspectSourceLineCoverage(item,instances=[]){
 const lines=sourceLines(item),issues=[];let next=0;
 for(const instance of instances){
  let ref;try{ref=sourceLineRange(item,instance);}catch{issues.push({code:'source_line_fragment_invalid',nodeId:instance.nodeId});continue;}
  if(ref.lineStart!==next)issues.push({code:ref.lineStart<next?'source_line_fragment_overlap_or_reorder':'source_line_fragment_gap',expectedLineStart:next,actualLineStart:ref.lineStart,nodeId:instance.nodeId});
  const expected=lines.slice(ref.lineStart,ref.lineEnd).join('\n');
  if(instance.text!==expected)issues.push({code:'source_line_fragment_altered',lineStart:ref.lineStart,lineEnd:ref.lineEnd,nodeId:instance.nodeId});
  if(item.type==='CodeBlock'&&String(instance.language||'')!==String(item.language||''))issues.push({code:'source_code_fragment_language_changed',nodeId:instance.nodeId});
  next=ref.lineEnd;
 }
 if(next!==lines.length)issues.push({code:'source_line_fragment_incomplete',expectedLineEnd:lines.length,actualLineEnd:next});
 return {complete:issues.length===0,expectedLines:lines.length,coveredLineEnd:next,issues};
}

export function hasExplicitSourceLineRanges(item,pages=[]){
 return supportsSourceLineRanges(item)&&pages.length>0&&pages.every(page=>{const refs=(page.sourceArtifactRanges||[]).filter(ref=>ref.sourceUnitId===item.id);return refs.length>0&&refs.every(ref=>ref.lineStart!==undefined&&ref.lineEnd!==undefined);});
}
/** Planning proof only; literal visible content is checked separately. */
export function inspectSourceLinePlan(item,pages=[],scopeRefs=[]){
 const expand=ref=>{const range=sourceLineRange(item,ref);return Array.from({length:range.lineEnd-range.lineStart},(_,i)=>range.lineStart+i);};
 try{
  const expected=[...new Set((scopeRefs.length?scopeRefs:[{}]).flatMap(expand))].sort((a,b)=>a-b);
  const actual=pages.flatMap(page=>{const refs=(page.sourceArtifactRanges||[]).filter(ref=>ref.sourceUnitId===item.id);return (refs.length?refs:[{}]).flatMap(expand);});
  return {complete:JSON.stringify(expected)===JSON.stringify(actual),expected,actual};
 }catch(error){return {complete:false,error:error.message,expected:[],actual:[]};}
}

/** Union only the selected scope. Table headers are implicit; literal source
 * lines are zero-based. Never expand a partial owner to the complete source. */
export function mergedSourceRanges(slides,items){
 const result=[];
 for(const item of items){
  const lines=supportsSourceLineRanges(item),table=['TableBlock','SummaryTableBlock'].includes(item.type);
  if(!lines&&!table)continue;
  const startKey=lines?'lineStart':'rowStart',endKey=lines?'lineEnd':'rowEnd';
  const refs=slides.flatMap(slide=>{
   if(!(slide.sourceUnitIds||slide.densityFit?.sourceUnitIds||[]).includes(item.id))return [];
   const selected=(slide.sourceArtifactRanges||[]).filter(ref=>ref.sourceUnitId===item.id);
   if(lines&&!selected.length)return [{sourceUnitId:item.id,...sourceLineRange(item)}];
   return (selected.length?selected:[{}]).map(ref=>lines?sourceLineRange(item,ref):{sourceUnitId:item.id,rowStart:ref.rowStart??1,rowEnd:ref.rowEnd??item.rows.length});
  }).sort((a,b)=>a[startKey]-b[startKey]);
  if(lines&&!slides.some(slide=>(slide.sourceArtifactRanges||[]).some(ref=>ref.sourceUnitId===item.id)))continue;
  const combined=[];
  for(const ref of refs){const previous=combined.at(-1);if(previous&&ref[startKey]<=previous[endKey])previous[endKey]=Math.max(previous[endKey],ref[endKey]);else combined.push({...ref});}
  result.push(...combined);
 }
 return result;
}

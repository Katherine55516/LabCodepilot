import{sourceComponent}from'./ppt-density-capacity.mjs';import{inspectObjectIntegrity}from'./ppt-object-integrity.mjs';import{visibleNodes}from'./ppt-visible-content.mjs';import{visibleEvidenceQuoteId}from'./ppt-obligations.mjs';import{reviewDisplayText,reviewDisplayRows,reviewMathFormatting}from'./ppt-review-display.mjs';import{reviewSourceStructure}from'./ppt-review-source-structure.mjs';
const fields=c=>[c.richText,...(c.items||[]).map(i=>i.richText),...(c.cellRich||[]).flat()];
const links=c=>fields(c).flatMap(r=>(r?.runs||[]).filter(run=>run.href).map(run=>({text:run.text,href:run.href})));
const math=c=>reviewMathFormatting(c).map(({tex,mathMl})=>({tex,mathMl}));
/** Exact witnesses request one bounded independent semantic re-read. No finding
 * is removed in code, and original source contradictions remain possible. */
export function sourceFindingWitnesses(project,review){
 if(project.generationPolicy?.content!=='full_source'||project.generationPolicy?.language?.mode!=='source')return [];
 const findings=[...(review.conflicts||[]),...(review.unsupported||[])],ids=new Set(findings.flatMap(f=>f.slideIds||[]));if(!ids.size)return [];
 const fulfilled=new Set(inspectObjectIntegrity(project).ledger.objects.filter(o=>o.status==='rendered').map(o=>o.objectId)),items=project.source?.semantic?.inventory?.items||[],witnesses=[];
 for(const slide of project.deck?.slides||[])if(ids.has(slide.id))for(const node of visibleNodes(slide)){
  const ref=node.sourceArtifact,item=items.find(i=>i.id===ref?.sourceUnitId);if(!item||!fulfilled.has(item.id)||item.derivedSummary||item.languageProjection||['ChartBlock','SourceImage'].includes(item.type))continue;
  const owned=project.outline?.find(o=>o.id===slide.id)?.sourceUnitIds;
  const bodyNodes=visibleNodes(slide).filter(n=>n.sourceArtifact);
  const completeLiteralBody=Array.isArray(owned)&&owned.length>0&&owned.every(id=>fulfilled.has(id))&&bodyNodes.length>0&&bodyNodes.every(n=>fulfilled.has(n.sourceArtifact.sourceUnitId)&&!['ChartBlock','SourceImage'].includes(n.sourceArtifact.type));
  const titleFinding=completeLiteralBody&&findings.some(f=>f.slideIds?.includes(slide.id)&&String(slide.title||'').length>=8&&String(f.detail||'').includes(slide.title));
  if(!findings.some(f=>f.slideIds?.includes(slide.id)&&(titleFinding||String(f.detail||'').includes(node.id)||node.type==='table'&&/\b(?:table|rows?)\b|表格|数据行/iu.test(f.detail||''))))continue;
  let expected;try{expected=sourceComponent(item,ref);}catch{continue;}
  if(node.type!==expected.type||reviewDisplayText(node)!==reviewDisplayText(expected)||JSON.stringify(math(node.content||{}))!==JSON.stringify(math(expected.content))||JSON.stringify(links(node.content||{}))!==JSON.stringify(links(expected.content)))continue;
  if(expected.content.codeBlock&&(node.content?.text!==expected.content.text||node.content?.codeBlock?.language!==expected.content.codeBlock.language))continue;
  if(expected.content.processSource!==undefined&&node.content?.processSource!==expected.content.processSource)continue;
  if(expected.content.mathMl!==undefined&&node.content?.mathMl!==expected.content.mathMl)continue;
  witnesses.push({slideId:slide.id,nodeId:node.id,quoteId:visibleEvidenceQuoteId(slide.id,node),sourceUnitId:item.id,...(titleFinding?{generatedTitle:slide.title,titleVerified:false,sourceChapterHeadings:item.sectionPath||[],titleReviewBasis:'Exact body presence does not prove this generated title. Independently evaluate whether its topic/claim is entailed by the actual source; keep unsupported or overstated titles blocked.'}:{}),sourceText:item.text,text:reviewDisplayText(node),sourceStructure:reviewSourceStructure(node,project),...(node.type==='table'?{sourceRows:item.rows,visibleRows:reviewDisplayRows(node.content)}:{}),proofScope:'Exact current source carrier, literal cells/text/math/links; not a semantic verdict or proof that original source is internally consistent.'});
 }
 return witnesses.length<=40?witnesses:[];
}

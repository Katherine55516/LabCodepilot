import {componentSurface,chartSeriesColors} from './ppt-template-palette.mjs';
import {figurePills} from './ppt-density-packing.mjs';
import {stackedPictureSets} from './ppt-stacked-pictures.mjs';
import {sourceMediaReceipts}from './ppt-source-media-tasks.mjs';
import {processCardPlan} from './ppt-process-cards.mjs';
import {diagramCardPlan} from './ppt-diagram-cards.mjs';
import {sourceReadingContinuation} from './ppt-source-continuations.mjs';
import { adaptationDisposition } from './ppt-template-dispositions.mjs';
/** Source-owned editable structures. The model selects inventory IDs/row ranges,
 * never invents cells or supplies geometry. Capacity failure asks for split. */
import {readingUnits} from './ppt-semantic-relations.mjs';
import { stableId } from './ppt/ir.mjs';
import { contentCanvas, fitComponents, measureComponent, explanationBudget, protectedTemplateAsset, sourceComponent, sourceComponentParts, prepareReadingComponents, sourceImageComponents, validateSourceArtifactRefs } from './ppt-density-capacity.mjs';
import {sourceDisplayText,richTextContent,ensureRichContent} from './ppt-source-text.mjs';
import {templateMediaRole} from './ppt-template-fidelity.mjs';
import {lockedEvidenceComponents} from './ppt-evidence.mjs';
import {templateTextColor} from './ppt-template-colors.mjs';
import {supplementaryNativeMedia,anchorCardIcons,sourceRegion} from './ppt-media-preserving-layout.mjs';
import {fitSourceLayout} from './ppt-source-layout-fit.mjs';
import {wideFigureFit,figureLayoutScore} from './ppt-figure-composition.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {objectPairs} from './ppt-object-pairs.mjs';
import {shownImage} from './ppt-figure-captions.mjs';
export {sourceDisplayText} from './ppt-source-text.mjs';
const clean = sourceDisplayText;
// Absolute source-owned explanations have no inventory artifact ID, but must
// survive the same preview and export paths as the referenced structures.
export const isSourceOwnedNode = node => Boolean(node.sourceArtifact || node.semanticRole === 'source-explanation'||['source-navigation','source-reading-navigation','notes-disclosure','card-icon','chrome-fallback','layout-picture'].includes(node.content?.derivedFrom));
function appendReadingHandoff(project,slide,index,nodes) {
 const ref=sourceReadingContinuation(project,index),geometry=contentCanvas(project,index).continuationRect;
 if(!ref?.targets.length||!geometry||!nodes.some(n=>ref.sourceUnitIds.includes(n.sourceArtifact?.sourceUnitId)))return;
 const color=templateTextColor(project,index,'body');
 nodes.push({id:stableId('node',slide.id,'source-reading-navigation'),type:'text',semanticRole:'footnote',slotId:'absolute',geometry,
  content:{...richTextContent(ref.text),derivedFrom:'source-reading-navigation',navigationTargets:ref.targets,sourceLeadUnitIds:ref.sourceUnitIds},
  style:{fontSizePt:14,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,color:color.color,lineHeight:1.18,paragraphSpacingEm:0},zIndex:500});
}
export function sourceExplanationComponents(texts) {
  return texts.flatMap(text=>String(text).split(/\n\s*\n/u).filter(part=>part.trim()).map(text=>({type:'text',content:richTextContent(text)})));
}
/** Replace obsolete foreground diagrams in a rebuilt source region. Keep the
 * title/footer, full canvas artwork and photos outside that region. */
/** An icon is part of a card set when another same-size image on the template
 * slide shares its row or column (the repeated card pattern). */
function cardSetIcon(node,spec){
  const g=node.geometry;if(!g)return false;
  const near=(a,b,t)=>Math.abs(a-b)<=t;
  return (spec.nodes||[]).some(other=>other!==node&&other.type==='image'&&other.geometry&&near(other.geometry.width,g.width,g.width*.08)&&near(other.geometry.height,g.height,g.height*.08)
    &&(near(other.geometry.y,g.y,g.height*.25)||near(other.geometry.x,g.x,g.width*.25)));
}
/** The share of a box inside the template page's own content band: below its
 * title and section slots, above its footer and label slots, full width. */
function insideContentBand(project,spec,g){
 const size=project.templateFidelity,boxOf=slot=>(spec.nodes||[]).find(node=>String(node.nativeRef?.shapeId)===String(slot.shapeId))?.geometry;
 const headers=(spec.slots||[]).filter(slot=>['title','section'].includes(slot.role)).map(boxOf).filter(Boolean).filter(box=>box.y<size.height/2);
 // A footer is a footnote or label slot, or any short text slot in the bottom fifth of the page.
 const footers=(spec.slots||[]).filter(slot=>slot.role!=='title'&&slot.role!=='section').map(slot=>({slot,box:boxOf(slot)})).filter(({slot,box})=>box&&box.y>size.height/2&&(['footnote','label'].includes(slot.purpose)||box.y>=size.height*.8&&box.height<=size.height*.1)).map(({box})=>box);
 const top=Math.max(0,...headers.map(box=>box.y+box.height)),bottom=Math.min(size.height,...footers.map(box=>box.y));
 const overlap=Math.max(0,Math.min(g.x+g.width,size.width)-Math.max(g.x,0))*Math.max(0,Math.min(g.y+g.height,bottom)-Math.max(g.y,top));
 return overlap/Math.max(1,g.width*g.height);
}
export function replaceTemplateSourceRegion(project,slide,index,canvas,{keep=new Set(),retireIcons=cardsFlow(project),oldContentByPosition=false}={}) {
  const spec=project.templateFidelity?.slides?.[index];if(!spec||!canvas)return;
  // Include number badges/connectors attached to the old body column. Leaving
  // only their labels removed creates a misleading, orphaned diagram.
  const region=sourceRegion(project,index,canvas),retired=[];
  for(const node of spec.nodes||[]) {
    const g=node.geometry,id=node.nativeRef?.shapeId,slot=spec.slots?.find(s=>s.shapeId===id);
    if(keep.has(id)){
      slide.templateOmissions=(slide.templateOmissions||[]).filter(item=>item.shapeId!==id||!item.automatic||!String(item.approvalBasis||'').startsWith('source_region_'));
      continue;
    }
    const classified=node.type==='image'?templateMediaRole(node,spec,project.templateFidelity):null;
    // Card icons belong to the card set this region replaces; left behind they
    // float over source text. A lone icon stays protected.
    // A card deck retires every template icon in the region, and a repeated
    // frame's rotated icon retires like the original (Fable, live fz-r10:
    // icons marked mediaReplacement were never retired and floated).
    const rotatedIcon=classified==='template_icon'&&node.content?.mediaReplacement&&!node.content?.mediaSourceId;
    const cardIcon=classified==='template_icon'&&!node.content?.mustPreserve&&(cardSetIcon(node,spec)||rotatedIcon||retireIcons),mediaRole=classified;
    if(protectedTemplateAsset(node)||node.type==='foreign'||node.nativeRef?.nestedMediaHashes?.length||['chart','table'].includes(node.type)||node.type==='image'&&!['template_decoration','template_artwork'].includes(mediaRole)&&!cardIcon||!g||id===undefined||['title','section'].includes(slot?.role)||slot?.purpose==='footnote'||node.semanticRole==='page-number'||node.content?.mediaReplacement&&!rotatedIcon)continue;
    const size=project.templateFidelity;
    if(g.width>=size.width*.85&&g.height>=size.height*.85)continue;
    const overlap=Math.max(0,Math.min(g.x+g.width,region.x+region.width)-Math.max(g.x,region.x))*Math.max(0,Math.min(g.y+g.height,region.y+region.height)-Math.max(g.y,region.y));
    // Kept by the region check, a picture no reader certified, lying at least half inside the template
    // page's content band, is old content by position on a page we fill with
    // our own (Fable 2026-10-26, live GPH tpl28: a strip screenshot of the old
    // deck's regression table stayed on every divider). Decoration stays.
    if(overlap/Math.max(1,g.width*g.height)<.35&&oldContentByPosition&&node.type==='image'&&g&&!node.content?.mustPreserve&&!protectedTemplateAsset(node)&&!(g.width>=project.templateFidelity.width*.85&&g.height>=project.templateFidelity.height*.85)&&!['template_decoration','template_icon'].includes(mediaRole)&&node.content?.ocr?.status!=='ok'&&insideContentBand(project,spec,g)>=.5){
      const contentBandShare=Number(insideContentBand(project,spec,g).toFixed(3));
      slide.templateOmissions||=[];
      const record={...adaptationDisposition(project,node,mediaRole||'old_template_content','old_content_by_position','A picture in the content band of a page filled with new content is the old deck\'s content; no reader certified it free of old text.'),automatic:true,contentBandShare};
      const prior=slide.templateOmissions.findIndex(o=>o.shapeId===id);if(prior<0)slide.templateOmissions.push(record);else slide.templateOmissions[prior]=record;
      continue;
    }
    if(overlap/Math.max(1,g.width*g.height)<.35)continue;
    {
      slide.templateOmissions||=[];const priorIndex=slide.templateOmissions.findIndex(o=>o.shapeId===id);const record={...adaptationDisposition(project,node,node.type==='image'?mediaRole:'old_template_content',node.type==='image'?mediaRole==='template_artwork'?'source_region_artwork_avoidance':cardIcon?'source_region_card_icon_avoidance':'source_region_decoration_avoidance':'source_region_replacement','Obsolete template foreground labels/artwork are retired for source-owned structures; this is not a media-equivalence claim.'),...(mediaRole==='template_artwork'||cardIcon?{replacementRegion:region,overlapRatio:overlap/(g.width*g.height)}:{})};
      if(priorIndex<0)slide.templateOmissions.push(record);else slide.templateOmissions[priorIndex]=record;
      if(cardIcon)retired.push(node);
    }
  }
  // An icon's badge (a small shape under it) retires with the icon: alone it
  // is an orange square with nothing on it.
  for(const icon of retired){
    const g=icon.geometry;
    for(const carrier of spec.nodes||[]){
      const c=carrier.geometry,id=carrier.nativeRef?.shapeId;
      if(carrier.type!=='shape'||!c||id===undefined||keep.has(id)||protectedTemplateAsset(carrier)||c.width>=914400*1.5||c.height>=914400*1.5)continue;
      if(!(c.x<=g.x&&c.y<=g.y&&c.x+c.width>=g.x+g.width&&c.y+c.height>=g.y+g.height))continue;
      if(Number.isFinite(carrier.zIndex)&&Number.isFinite(icon.zIndex)&&carrier.zIndex>=icon.zIndex)continue;
      if(slide.templateOmissions.some(o=>o.shapeId===id))continue;
      slide.templateOmissions.push({...adaptationDisposition(project,carrier,'old_template_content','source_region_replacement','The badge of a retired template icon leaves with it.'),automatic:true});
    }
  }
  retireStackedSets(project,slide,spec,keep);
}
/** Pictures stacked edge to edge (three or more, overlapping across) are one
 * drawing, a funnel or a staircase: if the region retires one piece, every
 * piece goes, with the small pictures lying on them (Codex 2026-11-03,
 * Capabilities t9: one trapezoid of the funnel was left floating). */
function retireStackedSets(project,slide,spec,keep=new Set()){
  const pictures=(spec.nodes||[]).filter(node=>node.type==='image'&&node.geometry&&node.nativeRef?.shapeId!==undefined&&!node.content?.mustPreserve&&!protectedTemplateAsset(node));
  const omitted=id=>(slide.templateOmissions||[]).some(item=>String(item.shapeId)===String(id));
  for(const set of stackedPictureSets(spec)){
    if(set.some(node=>node.content?.mustPreserve||protectedTemplateAsset(node)))continue;
    if(!set.some(node=>omitted(node.nativeRef.shapeId))||set.every(node=>omitted(node.nativeRef.shapeId)))continue;
    const boxes=set.map(node=>node.geometry),on=pictures.filter(node=>!set.includes(node)&&boxes.some(b=>{const g=node.geometry;return g.x>=b.x&&g.y>=b.y&&g.x+g.width<=b.x+b.width&&g.y+g.height<=b.y+b.height;}));
    for(const node of [...set,...on]){
      if(omitted(node.nativeRef.shapeId))continue;
      slide.templateOmissions.push({...adaptationDisposition(project,node,templateMediaRole(node,spec,project.templateFidelity)||'template_decoration','source_region_replacement','A piece of a stacked template drawing whose other pieces this page retires.'),automatic:true});
    }
  }
}
/** Native table body rows are exported on white (the header row uses the
 * accent fill with its own contrast colour), so resolve body text on white. */
function tableBodyColor(project,index){
  return templateTextColor(project,index,'body','#ffffff').color;
}
function headerColor(fill) {
  const hex = String(fill).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#242a3b';
  const linear = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return luminance < .179 ? '#ffffff' : '#111111';
}
/** A source page's measured components, laid out as the binder lays them
 * out: its objects, locked evidence and commentary (at most four entries).
 * A native diagram that does not fit falls back to the same rows as a table.
 * The card object page is fitted with this measurement before binding;
 * planned:false measures objects a page plan does not list yet (scheduling). */
// A bilingual card deck's body cell "English 中文" reads as two lines: the
// space at the first Latin-to-Han boundary becomes a line break when both
// halves have four characters or more (Fable review fz-r15 p3/p4/p23). The
// cell compares to the source with whitespace collapsed, so nothing changes.
const PAIR_BOUNDARY=/(?<=[\p{Script=Latin}\p{N})\]$])\s+(?=\p{Script=Han})/u;
export function pairedCell(cell){
  const match=PAIR_BOUNDARY.exec(cell);if(!match)return cell;
  let head=cell.slice(0,match.index),tail=cell.slice(match.index+match[0].length);
  // A short token before the boundary belongs to the Chinese half ("growth q 理论" -> "growth" / "q 理论"; Fable review r16).
  const token=head.match(/(?:^|\s)([A-Za-z]{1,2})$/u);
  if(token&&!/[.!?;:]$/u.test(head.slice(0,head.length-token[1].length).trim())){head=head.slice(0,head.length-token[1].length).trimEnd();tail=`${token[1]} ${tail}`;}
  return [...head.trim()].length>=4&&[...tail.trim()].length>=4?`${head}\n${tail}`:cell;
}
export function composeSourcePage(project,slideId,refs,index,commentary=[],sourceEvidenceIds=[],{planned=true}={}){
  const items=project.source?.semantic?.inventory?.items||[];
  const pairedCells=cardsFlow(project)&&project.generationPolicy?.language?.mode==='source'&&project.generationPolicy?.language?.body==='both';
  const permitted=new Set(project.planning?.slidePlan?.find(plan=>plan.slideId===slideId)?.sourceArtifacts?.map(item=>item.sourceUnitId)||[]);
  const compose=tableOnly=>{
  let components=refs.flatMap(sourceRef=> {
    const ref=tableOnly?{...sourceRef,tableRepresentation:'table'}:sourceRef;
    const item=items.find(value=>value.id===ref.sourceUnitId);
    if (!item||planned&&!permitted.has(item.id)) throw new Error('source artifact not assigned to this page');
    const assigned=planned?project.planning?.slidePlan?.find(plan=>plan.slideId===slideId)?.sourceArtifacts?.filter(a=>a.sourceUnitId===item.id)||[]:[];
    if(assigned.some(a=>a.rowStart!==undefined) && !assigned.some(a=>a.rowStart===(ref.rowStart??1) && a.rowEnd===(ref.rowEnd??item.rows?.length))) throw new Error('source artifact row range differs from page contract');
    if(planned&&(ref.lineStart!==undefined||assigned.some(a=>a.lineStart!==undefined))&&!assigned.some(a=>a.lineStart===ref.lineStart&&a.lineEnd===ref.lineEnd))throw new Error('source artifact line range differs from the frozen page contract');
    return sourceComponentParts(item,ref).map(component=>{
    if(component.content.rows)component.content.rows=component.content.rows.map(row=>row.map(String));
    // A table the source also gives in the other language shows both, line under line (Fable plan T26).
    if(pairedCells&&component.content.rows){
      const twinId=[...objectPairs(project)].find(([,primary])=>primary===item.id)?.[0],twin=twinId&&items.find(value=>value.id===twinId);
      const start=ref.rowStart??1,twinRows=twin?.rows?[twin.rows[0],...twin.rows.slice(start,start+component.content.rows.length-1)]:null;
      if(twinRows&&twinRows.length===component.content.rows.length&&twinRows.every((row,r)=>row.length===component.content.rows[r].length)){
        const {cellRich,rawRows,...rest}=component.content;
        component.content={...rest,rows:component.content.rows.map((row,r)=>row.map((cell,c)=>{const other=String(twinRows[r][c]??'').trim();return other&&other!==String(cell).trim()?`${cell}\n${other}`:cell;}))};
      }
    }
    // The split runs on each cell's source text ($...$ kept), then its rich cells are rebuilt.
    if(pairedCells&&component.content.rows){
      const raw=component.content.rows.map((row,r)=>row.map((cell,c)=>String(component.content.cellRich?.[r]?.[c]?.source??component.content.rawRows?.[r]?.[c]??cell)));
      const paired=raw.map((row,r)=>r>0?row.map(pairedCell):row);
      if(paired.some((row,r)=>row.some((cell,c)=>cell!==raw[r][c]))){const {cellRich,rawRows,...rest}=component.content;component.content={...rest,rows:paired};}
    }
    if(component.content.items)component.content.items=component.content.items.map((entry,n)=>({...entry,id:stableId('item',slideId,item.id,(component.itemFragment?.itemStart||0)+n),...richTextContent(entry.richText?.source??entry.text)}));
    component.content=ensureRichContent(component.content);
    const tableFontPt=component.type==='table'?Number(project.tableTypography?.[item.id]?.fontPt)||0:0;
    const result={...component,item,ref,...(tableFontPt?{tableFontPt}:{})};
    return result;
    });
  });
  // A range belongs under the shared topic, not in a fabricated new title.
  // Measure its small caption with the table so it cannot overlap the header.
  if(cardsFlow(project))components=components.flatMap(component=>{
    const {item,ref}=component;if(!item?.rows||!component.content?.rows)return[component];
    const start=ref.rowStart??1,end=ref.rowEnd??item.rows.length;
    if(start===1&&end===item.rows.length)return[component];
    const zh=String(project.generationPolicy?.language?.locale||project.inputUnderstanding?.primaryLanguage||'en').startsWith('zh');
    const scope={sourceUnitId:item.id,rowStart:start,rowEnd:end,totalRows:item.rows.length-1};
    return[{type:'text',sourceUnitId:item.id,ladderFontPt:12,content:{text:zh?`第 ${start}–${end-1} 行，共 ${item.rows.length-1} 行`:`Rows ${start}–${end-1} of ${item.rows.length-1}`,derivedFrom:'source-navigation',fragmentScope:scope}},component];
  });
  components=components.flatMap(component=>{
    const headers=component.content?.diagram?.headers;
    // A chart names its axes and values itself: the header line beside it was
    // a stray label (Codex, 3197: "MODEL · PARAMETER COUNT" beside the column chart).
    if(!headers?.length||component.type==='chart')return[component];
    // A table represented as editable cards must still show its axes/units.
    // In particular, temperature values alone do not identify τ, and a VAE
    // number alone does not say it is a parameter count.
    return[{type:'text',sourceUnitId:component.content.diagram.sourceUnitId,ladderFontPt:12,content:{...richTextContent(headers.join(' · ')),derivedFrom:'source-reading-navigation',sourceTableHeaderFor:component.content.diagram.sourceUnitId}},component];
  });
  components.push(...lockedEvidenceComponents(project,sourceEvidenceIds,components));
  const copyTypes=new Set(['definition','mechanism','evidence','example','contrast','constraint','implication','stage','decision','next_step','support']);
  if (!Array.isArray(commentary) || commentary.length > 4 || commentary.some(value=>typeof value==='string'?value.length>2000:!value||typeof value.text!=='string'||value.text.length>2000||!copyTypes.has(value.type))) throw new Error(`invalid source commentary: ${JSON.stringify({count:commentary?.length,maxEntries:4,maxTextCharacters:2000,receivedTypes:Array.isArray(commentary)?commentary.map(value=>typeof value==='string'?'legacy_string':value?.type):null,allowedTypes:[...copyTypes]})}; merge related complete explanations into at most four typed entries without deleting necessary facts`);
  const visibleTexts=new Set(components.map(component=>clean(component.content.text || component.content.rows?.map(row=>row.join(' | ')).join('\n') || component.content.items?.map(item=>item.text).join('\n') || '').replace(/\s+/gu,' ').trim()));
  for(const entry of commentary) {
    const text=typeof entry==='string'?entry:entry.text;if(!text.trim())continue;
    const normalized=clean(text),key=normalized.replace(/\s+/gu,' ').trim();
    if(visibleTexts.has(key))continue;
    visibleTexts.add(key);const entryFont=typeof entry==='string'?0:Number(entry.fontSizePt)||0;components.push(...sourceExplanationComponents([text]).map(component=>({...component,...(entryFont?{ladderFontPt:entryFont}:{}),content:{...component.content,pointType:typeof entry==='string'?'mechanism':entry.type}})));
  }
  components=prepareReadingComponents(items,components,project);
  let fit=fitSourceLayout(components,project,index);
  if(fit.componentFallbacks){
    const {componentFallbacks,...measured}=fit;
    components=components.map((component,i)=>componentFallbacks.find(f=>f.index===i)?.component||component);
    fit={...measured,representationFallbacks:componentFallbacks.map(f=>({index:f.index,from:'source-relations',to:'table',basis:'same complete rows and font; measured capacity'}))};
  }
  return {components,fit};
  };
  let composed=compose(false);
  if(!composed.fit.capacity_ok&&composed.components.some(component=>component.content?.diagram)){const table=compose(true);if(table.fit.capacity_ok)composed=table;}
  return cardsFlow(project)?roomierObjectPage(project,index,tablePageFit(project,index,composed)):composed;
}
/** A card's table page (Fable 2026-11-01, review item 2: the CodePilot docx and
 * PDF showed nearly every table half-width at ~8 pt beside a dense column, the
 * bottom 40% empty). A table of up to 6 data rows goes full width on top with
 * the points below when that fits at the template body size, or 1 or 2 pt
 * under it; otherwise the side-by-side page grows its table and its text
 * together, at most 6 pt, to the first size that fills about 60% of the
 * canvas. Kept template artwork and failed fits leave the page as composed. */
const TABLE_STACK_ROWS=6,TABLE_GROWTH_PT=6,TABLE_FILL=.6,TABLE_FILL_MAX=.8;
function tablePageFit(project,index,composed){
  const {components,fit}=composed;
  const tables=components.filter(component=>component.type==='table'&&component.item);
  if(!fit.capacity_ok||tables.length!==1||(fit.keptMediaShapeIds||[]).length)return composed;
  const table=tables[0],body=Number(contentCanvas(project,index)?.fontSizePt)||Number(fit.fontSizePt)||14;
  const text=component=>!component.item&&component.type==='text'&&!component.content?.derivedFrom;
  const sized=(tablePt,textPt)=>components.map(component=>component===table?{...component,tableFontPt:tablePt}:text(component)?{...component,ladderFontPt:textPt}:component);
  if(table.content.rows.length-1<=TABLE_STACK_ROWS){
    for(const pt of [body,body-1,body-2]){
      const stacked=sized(pt,pt),stackedFit=fitSourceLayout(stacked,project,index,{columns:1});
      if(!stackedFit.componentFallbacks&&stackedFit.capacity_ok&&(stackedFit.columns===1||String(stackedFit.layoutId).startsWith('full-width'))){
        return {components:stacked,fit:{...stackedFit,tableArrangement:'stacked'}};
      }
    }
  }
  if(fit.usedHeight>=TABLE_FILL*fit.availableHeight)return composed;
  const at=position=>Number(fit.measurements?.[position]?.fontSizePt)||Number(fit.fontSizePt)||body;
  const tablePt=at(components.indexOf(table)),textPt=Math.max(0,...components.map((component,position)=>text(component)?at(position):0))||Number(fit.fontSizePt)||body;
  // The page font rises with them, so a table measured at the page font grows too.
  const pagePt=Number(fit.fontSizePt)||body;
  // Fill is not monotonic (a split's column ratio may change with the size):
  // every step is measured; the first that fills 60% wins, else the fullest
  // that still beats the page as composed.
  let fullest=null;
  for(let step=1;step<=TABLE_GROWTH_PT;step++){
    const grown=sized(tablePt+step,textPt+step),grownFit=fitSourceLayout(grown,project,index,{fontSizePt:pagePt+step});
    if(grownFit.componentFallbacks||!grownFit.capacity_ok||grownFit.usedHeight>TABLE_FILL_MAX*grownFit.availableHeight)continue;
    const candidate={components:grown,fit:{...grownFit,tableArrangement:'grown'}};
    if(grownFit.usedHeight>=TABLE_FILL*grownFit.availableHeight)return candidate;
    if(grownFit.usedHeight>(fullest?.fit.usedHeight??fit.usedHeight))fullest=candidate;
  }
  return fullest||composed;
}
/** A card deck's object page under 65% full grows its explanation to 16 or 15
 * pt while it stays within 80% of the canvas, and the block is centred
 * vertically (Fable review r11: object pages stayed top-aligned at 14 pt,
 * fz p11 used 2.5 of 4.9 in). Kept artwork keeps its place. */
function roomierObjectPage(project,index,composed){
  let {components,fit}=composed;
  // A table page already arranged by tablePageFit keeps its arrangement (a refit here undid the stack).
  if(!fit.tableArrangement&&fit.capacity_ok&&fit.usedHeight<.65*fit.availableHeight&&components.some(component=>!component.item&&component.type==='text')&&!components.some(component=>!component.item&&component.type==='text'&&Number(component.ladderFontPt)>0&&component.ladderFontPt<fit.fontSizePt)){
    for(const pt of [16,15]){
      if(pt<=fit.fontSizePt)continue;
      // Only the explanation grows; objects keep the page font (a table at 16 pt would not fit).
      const sized=components.map(component=>!component.item&&component.type==='text'?{...component,ladderFontPt:pt}:component),grown=fitSourceLayout(sized,project,index);
      if(!grown.componentFallbacks&&grown.capacity_ok&&grown.usedHeight<=.8*grown.availableHeight){components=sized;fit=grown;break;}
    }
  }
  if(fit.capacity_ok&&!(fit.keptMediaShapeIds||[]).length&&fit.boxes?.length&&fit.canvas){
    const top=Math.min(...fit.boxes.map(box=>box.y)),bottom=Math.max(...fit.boxes.map(box=>box.y+box.height));
    const dy=Math.round(fit.canvas.y+(fit.canvas.height-(bottom-top))/2-top);
    if(dy>0)fit={...fit,boxes:fit.boxes.map(box=>({...box,y:box.y+dy})),balanced:'centered'};
  }
  return {components,fit};
}
export function bindSourceArtifacts(project, slide, refs, index, commentary = [], sourceEvidenceIds = []) {
  if (!Array.isArray(refs)) throw new Error('invalid source artifact refs');
  if (!refs.length && !commentary?.length && !sourceEvidenceIds.length) return slide;
  if(refs.length>64)throw Object.assign(Error('source_resource_limit: at most 64 source objects per page; this is a resource guard, not a readability measurement'),{code:'coverage_invalid',outlineContract:true,details:{reason:'source_resource_limit',maximumObjects:64,actualObjects:refs.length}});
  const spec=project.templateFidelity?.slides?.[index];
  const items=project.source?.semantic?.inventory?.items||[];
  validateSourceArtifactRefs(items,refs);
  const contentIds=new Set(spec?.slots.filter(slot=>slot.role==='content').map(slot=>slot.shapeId)||[]);
  // A native diagram is only used when it fits the page measured for it;
  // otherwise the same rows render as the original table (never a failure
  // that the table itself would not have).
  let {components,fit}=composeSourcePage(project,slide.id,refs,index,commentary,sourceEvidenceIds);
  if(!fit.capacity_ok){
    const sourceComponents=components.filter(component=>component.item||component.content.sourceEvidenceIds?.length);
    const sourceFit=sourceComponents.length?fitSourceLayout(sourceComponents,project,index):{capacity_ok:true,usedHeight:0};
    throw Object.assign(new Error(`source_artifact_capacity: ${JSON.stringify({pageIndex:index,slideId:slide.id,fontSizePt:fit.fontSizePt,availableHeightInches:fit.availableHeight/914400,usedHeightInches:fit.usedHeight/914400,predictedOverflowInches:fit.predictedOverflow/914400,sourceFits:sourceFit.capacity_ok,sourceHeightInches:sourceFit.usedHeight/914400,explanationBudget:explanationBudget(sourceComponents,project,index),boundSourceEvidenceIds:sourceEvidenceIds,admissibleLayouts:fit.admissibleLayouts,...(fit.admissibleNote?{admissibleNote:fit.admissibleNote}:{}),commentaryEntries:commentary.length,commentaryCharacters:commentary.reduce((sum,value)=>sum+(typeof value==='string'?value:value.text).length,0)})}. Retain all frozen source cells, bound source excerpts and font. If sourceFits is true, the source is already portable: only rewrite commentary into complete concise relationships owned by this page, never repeat table/formula contents or bound excerpts or explain adjacent rows; do not change its row ranges or request an unnecessary split. Use the measured single-paragraph budget: merge related complete explanations into one or two entries without blank lines, removing only duplicate explanation, not source facts. Extra entries consume paragraph padding and gaps. With no bound source content, sourceCommentary IS the required visible body and cannot be empty. With bound source content already expressing all required facts, optional commentary may be empty.`),{code:'capacity_invalid',origin:'local_capacity',details:{measurement:'source_component_contract',units:'emu',nodeRole:'source-structure',bounds:fit.canvas||contentCanvas(project,index).geometry,pageIndex:index,slideId:slide.id,fontSizePt:fit.fontSizePt,availableHeightInches:fit.availableHeight/914400,usedHeightInches:fit.usedHeight/914400,predictedOverflowInches:fit.predictedOverflow/914400,sourceFits:sourceFit.capacity_ok,sourceUnitIds:refs.map(ref=>ref.sourceUnitId)}});
  }
  // Keep the template's card artwork when the same components fit beside it,
  // and re-anchor card icons instead of retiring them (MD-P0-1, MD-P1-4).
  const keep=new Set(),movedIcons=[];
  let chosen=fit;
  for(const id of chosen.keptMediaShapeIds||[])keep.add(id);
  // A card deck never re-anchors template icons beside its content (Fable, live fz-r10: a "$" icon beside a table row).
  const anchored=chosen.componentInstances||cardsFlow(project)?null:anchorCardIcons(project,index,components,chosen,cardSetIcon);
  if(anchored){chosen=anchored.fit;for(const icon of anchored.icons){keep.add(icon.shapeId);for(const carrier of icon.carriers||[])keep.add(carrier.shapeId);movedIcons.push(icon);}}
  const primaryComponents=Boolean(chosen.componentInstances?.length);
  chosen=supplementaryNativeMedia(project,index,chosen);
  for(const id of chosen.keptMediaShapeIds||[])keep.add(id);
  const background=project.templateFidelity?.slides?.[index]?.background||project.templateSpec?.palette?.background||'#ffffff';
  // Source text uses the template's own colour for body text on this kind of
  // backdrop (never a forced black); the chosen rule is kept for review.
  const bodyColor=templateTextColor(project,index,'body');
  const nodes=components.map((component,position)=> {
    const {type,content,item,ref}=component;
    if(!item){
      const original=slide.copy?.blocks?.find(block=>clean(block.body)===clean(content.text));
      content.claimId=original?.claimId||stableId('claim',clean(content.text));
      if(original?.repeatPurpose)content.repeatPurpose=original.repeatPurpose;
      if(original?.claimId&&project.outline?.[index]?.repeatSourceUnitIds?.includes(original.claimId))content.repeatPurpose='recap';
    }
    const panelColor=chosen.panelFamily?chosen.panelColors[chosen.readingUnits.findIndex(u=>u.includes(position))]:null;
    const measurement=chosen.measurements[position];
    if(type==='timeline'&&content.processCardsEnabled){const cards=processCardPlan(content,chosen.boxes[position],chosen.fontSizePt);if(cards){if(cards.overflow)throw new Error('source_artifact_capacity: ordered step cards overflow their measured frame');content.items=cards.items;content.pointLayout={boxes:cards.boxes,fontSizePt:cards.fontSizePt,columns:cards.columns,overflow:false,accent:project.templateSpec?.palette?.accent};content.processCards={version:1,basis:cards.basis,steps:cards.items.length};}}
    if(type==='list'&&content.diagram){const plan=diagramCardPlan(content,chosen.boxes[position],chosen.fontSizePt);if(plan){if(plan.overflow)throw new Error('source_artifact_capacity: native diagram cards overflow their measured frame');content.pointLayout={boxes:plan.boxes,...(plan.connectors?{connectors:plan.connectors}:{}),fontSizePt:plan.fontSizePt,columns:plan.columns,overflow:false,variant:plan.kind,headingScale:plan.headingScale,...(plan.headingFontSizePt?{headingFontSizePt:plan.headingFontSizePt}:{}),inlineHeading:plan.inlineHeading,accent:project.templateSpec?.palette?.accent};content.diagramLayout={version:1,kind:plan.kind,cards:plan.boxes.length};}}
    // A figure card's pill (Fable M4): one dark card, its number in a marker.
    if(type==='list'&&content.figurePillOf)Object.assign(content,pillContent(project,content,measurement?.fontSizePt));
    if(type==='table'){content.columnWeights=measurement.columnWeights;content.rowWeights=measurement.rowWeights;
      // A card deck's table with room exports minimum rows that grow to their text (Fable review fz-r15: loose rows).
      // The box is the measured (conservative) height, so the grown rows never pass it (Fable review r16 M2).
      if(cardsFlow(project))content.rowExport='min';}
    return {id:stableId('node',slide.id,item?.id||'source-commentary',ref?.lineStart??ref?.rowStart??position),type,
      semanticRole:item?'source-structure':'source-explanation',slotId:'absolute',geometry:chosen.boxes[position],content,
      ...(primaryComponents?{semanticComponentBinding:{unitIndex:chosen.readingUnits.findIndex(u=>u.includes(position)),sourceUnitIds:chosen.readingUnits.find(u=>u.includes(position))?.map(i=>components[i].item?.id).filter(Boolean)||[],relationship:'atomic source reading unit',textSlot:'native style, measured source-owned replacement'}}:{}),
      ...(item&&project.outline?.[index]?.repeatSourceUnitIds?.includes(item.id)?{repeatPurpose:'recap'}:{}),
      ...(item?{sourceArtifact:{sourceUnitId:item.id,type:item.type,rowStart:ref.rowStart,rowEnd:ref.rowEnd,lineStart:ref.lineStart,lineEnd:ref.lineEnd,...(component.itemFragment||{})},sourceRefs:item.source_ref}:{sourceRefs:slide.sourceRefs||[]}),
      style:{fontSizePt:measurement?.fontSizePt||chosen.fontSizePt,...(measurement?.fontBasis?{fontBasis:measurement.fontBasis}:{}),fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,
        ...(type==='chart'&&project.templateFidelity?.mode==='preserve'?{seriesColors:chartSeriesColors(project.templateSpec?.palette,project.templateFidelity?.slides?.[index]?.background)}:{}),
        lineHeight:1.18,paragraphSpacingEm:type==='timeline'?.15:type==='list'?.4:0,
        ...(type==='table'?{tableHeaderColor:headerColor(project.templateSpec?.palette?.accent||'#e7e5f4')}:{}),
        color:panelColor?headerColor(panelColor):type==='table'?tableBodyColor(project,index):bodyColor.color,colorBasis:type==='table'?'template_table_body':bodyColor.basis,...(panelColor||type==='table'?{fill:panelColor||project.templateSpec?.palette?.accent||'#e7e5f4'}:{})},zIndex:500};
  });
  slide.sourceArtifactFit={...chosen,boxes:chosen.boxes,measurements:chosen.measurements};
  appendReadingHandoff(project,slide,index,nodes);
  slide.sourceArtifactNodes=nodes;
  replaceTemplateSourceRegion(project,slide,index,chosen.canvas,{keep});
  slide.templateComponentClones=(chosen.componentInstances||[]).filter(n=>n.nativeRef.cloneFromShapeId!==undefined);
  for(const instance of chosen.componentInstances||[]){
    if(instance.nativeRef.cloneFromShapeId!==undefined)continue;
    const shapeId=instance.nativeRef.shapeId;
    slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(a=>a.shapeId!==shapeId),{shapeId,action:'whole_component_reflow',geometry:instance.geometry,componentBinding:instance.templateComponentBinding}];
  }
  for(const asset of chosen.mediaAdaptations||[]){
    const live=(slide.nodes||[]).find(node=>node.nativeRef?.shapeId===asset.shapeId);
    if(live)live.geometry={...asset.geometry};
    slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(item=>item.shapeId!==asset.shapeId),{shapeId:asset.shapeId,action:'scaled_artwork_rail',geometry:asset.geometry,originalGeometry:asset.originalGeometry,scale:asset.scale,basis:'same image bytes; contain aspect ratio; measured source fit and unchanged font'}];
  }
  for(const icon of movedIcons){
    for(const carrier of icon.carriers||[]){
      const live=(slide.nodes||[]).find(node=>node.nativeRef?.shapeId===carrier.shapeId);if(live)live.geometry={...carrier.geometry};
      slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(a=>a.shapeId!==carrier.shapeId),{shapeId:carrier.shapeId,action:'reanchored_table_row_icon_carrier',geometry:carrier.geometry,rowBinding:icon.rowBinding,scale:icon.badgeScale,basis:'Original badge/carrier and icon move with one uniform scale; original colour and image identity retained'}];
    }
    const live=(slide.nodes||[]).find(node=>node.nativeRef?.shapeId===icon.shapeId);
    if(live)live.geometry={...icon.geometry};
    slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(a=>a.shapeId!==icon.shapeId),{shapeId:icon.shapeId,action:icon.rowBinding?'reanchored_table_row_icon':'reanchored_card_icon',geometry:icon.geometry,...(icon.rowBinding?{rowBinding:icon.rowBinding}:{})}];
  }
  slide.bullets=[];
  slide.copy={...slide.copy,blocks:nodes.map(node=>({...(node.sourceArtifact?{sourceNodeId:node.id}:{}),type:node.content.pointType||'evidence',heading:node.sourceArtifact?.type.replace('Block','')||'',body:node.type==='table'?node.content.rows.map(row=>row.join(' | ')).join('\n'):node.content.text||(node.content.items||[]).map(item=>item.text).join('\n')})),takeaway:'',subtitle:''};
  if (spec) {
    for (const id of contentIds) if (!slide.templateOmissions?.some(item=>item.shapeId===id)) {
      slide.templateOmissions ||= []; slide.templateOmissions.push({shapeId:id,reason:'Source structure replaces the original content region with editable source-owned objects.'});
    }
  }
  // Invisible duplicate body representations must not count as rendered depth.
  slide.nodes=(slide.nodes||[]).filter(node=>!isSourceOwnedNode(node)&&!['body','subtitle','takeaway'].includes(node.semanticRole));
  slide.nodes.push(...nodes); slide.nodeOrder=slide.nodes.map(node=>node.id);
  slide.mediaTasks=sourceMediaReceipts(project,slide);
  return slide;
}

/** Figures scaled into what the page's text leaves: text components keep their
 * measured boxes at the top; the figures share the rest in one row (a two-
 * column grid from three), each scaled to its aspect above its caption. Null when the text
 * leaves less than 30% of the canvas. */
function scaledMediaFit(components,project,index){
  const {geometry:canvas,fontSizePt}=contentCanvas(project,index),gap=Math.round(914400*.12);
  const isImage=c=>c.type==='image',isCaption=c=>Boolean(c.content?.sourceImageCaptionId);
  const textIndexes=components.map((c,i)=>i).filter(i=>!isImage(components[i])&&!isCaption(components[i]));
  const boxes=new Array(components.length),fonts=new Array(components.length);let top=canvas.y;
  if(textIndexes.length){
    const textFit=fitComponents(textIndexes.map(i=>components[i]),project,index);
    if(!textFit.capacity_ok)return null;
    textIndexes.forEach((i,k)=>{boxes[i]=textFit.boxes[k];});
    top=Math.max(...textFit.boxes.map(box=>box.y+box.height))+gap;
  }
  const height=canvas.y+canvas.height-top;
  if(height<canvas.height*.3)return null;
  const figures=components.map((c,i)=>i).filter(i=>isImage(components[i]));
  // Three or more figures take a two-column grid: a single row of three left
  // captions about 150 pt wide (live world_models.pdf: a 17-line caption).
  const rows=figures.length>=3?2:1,columns=Math.ceil(figures.length/rows);
  const cellWidth=(canvas.width-gap*(columns-1))/columns,cellHeight=(height-gap*(rows-1))/rows;
  for(const [k,i] of figures.entries()){
    const x=canvas.x+(k%columns)*(cellWidth+gap);let y=top+Math.floor(k/columns)*(cellHeight+gap);
    const caption=components[i+1]&&isCaption(components[i+1])?i+1:null;
    // The caption keeps its complete text at its measured height; on a crowded
    // page it steps down to body − 2 (never below 12 pt) before taking up to
    // three quarters of its cell; the figure takes what is left.
    let captionHeight=0;
    if(caption!==null){
      for(let pt=fontSizePt;pt>=Math.max(12,fontSizePt-2);pt--){captionHeight=measureComponent(components[caption],{x,y,width:cellWidth,height:cellHeight},pt).height;fonts[caption]=pt;if(captionHeight<=cellHeight*.6)break;}
      if(captionHeight>cellHeight*.75)return null;
    }
    const room={width:cellWidth,height:cellHeight-captionHeight-(caption===null?0:gap/2)};
    const ratio=Number(components[i].content?.width)/Number(components[i].content?.height)||room.width/room.height;
    const width=Math.min(room.width,room.height*ratio),imageHeight=width/ratio;
    y+=Math.max(0,(cellHeight-imageHeight-captionHeight-(caption===null?0:gap/2))/2);
    boxes[i]={x:Math.round(x+(cellWidth-width)/2),y:Math.round(y),width:Math.round(width),height:Math.round(imageHeight)};
    if(caption!==null)boxes[caption]={x:Math.round(x),y:Math.round(y+imageHeight+gap/2),width:Math.round(cellWidth),height:Math.round(captionHeight)};
  }
  if(boxes.some(box=>!box||box.width<=0||box.height<=0))return null;
  return {capacity_ok:true,scaled:true,fontSizePt,canvas,boxes,captionFonts:fonts,measurementBasis:'scaled_media_fallback'};
}

/** The layout bindSourceMedia keeps for text and figures: the plain fit, a
 * wide figure above its caption, or the figures scaled into the space left. */
/** A figure card's pill as a one-card list in the template's dark panel (Fable M4). */
function pillContent(project,content,fontSizePt=12){
  const surface=componentSurface(project.templateSpec?.palette);
  return {...content,pointLayout:{boxes:[{x:0,y:0,w:1,h:1}],fontSizePt,lineHeight:1.18,columns:1,overflow:false,accent:surface.fill,panelFill:surface.fill,panelText:surface.text,markers:content.markers,markerInches:.34}};
}
function sourceMediaFit(components,project,index){
  const wide=wideFigureFit(components,project,index);
  // Figure cards are laid out only by the wide fit, which places each pill.
  if(components.some(c=>c.content?.figurePillOf))return wide?{fit:wide,scaledBasis:'',components}:sourceMediaFit(components.filter(c=>!c.content?.figurePillOf),project,index);
  let fit=fitComponents(components,project,index),scaledBasis='';
  if(wide&&figureLayoutScore(components,wide)>figureLayoutScore(components,fit)){fit=wide;scaledBasis='proportional picture above complete full-width caption; measured visual area and caption width';}
  const readable=scaledMediaFit(components,project,index),area=result=>result?.capacity_ok?components.reduce((sum,c,k)=>sum+(c.type==='image'?result.boxes[k].width*result.boxes[k].height:0),0):0;
  if(readable&&area(readable)>area(fit)){fit=readable;scaledBasis='largest measured figure area with complete captions and unchanged text';}
  return{fit,scaledBasis,components};
}
/** Whether a built-in template's card page holds these points and figures
 * together (live 2026-11-01, world_models on Blue: five points and a figure
 * failed at generation, with or without the writer). */
export function cardFiguresFit(project,texts,imageIds){
  const images=imageIds.map(id=>project.source?.images?.find(item=>item.id===id)).filter(Boolean).map(image=>({...image,type:'SourceImage'}));
  if(images.length!==imageIds.length)return false;
  const components=[...texts.map(text=>({type:'text',content:{text:String(text)}})),...images.flatMap(sourceImageComponents)];
  // Measured on a neutral page: no deck lock, edit epoch or font floor of page 2 (Fable).
  return Boolean(sourceMediaFit(components,{...project,deck:undefined,editing:undefined,outline:undefined,sourceFontFloors:undefined},1).fit?.capacity_ok);
}

/** Source images are independent obligations, including small equations/icons.
 * Refit the whole source region, rather than stretching every asset as a photo. */
export function bindSourceMedia(project,slide,imageIds,index) {
  if(!imageIds?.length)return slide;
  const images=imageIds.map(id=>{
    const image=project.source?.images?.find(item=>item.id===id);
    if(!image)throw new Error('unknown source image '+id);
    return {...image,type:'SourceImage'};
  });
  const replacing=new Set(imageIds);
  const existing=(slide.nodes||[]).filter(n=>isSourceOwnedNode(n)&&n.content?.derivedFrom!=='source-reading-navigation'&&!replacing.has(n.content?.sourceImageId||n.content?.sourceImageCaptionId||(['SourceImage','SourceImageCaption'].includes(n.sourceArtifact?.type)?n.sourceArtifact.sourceUnitId:null)));
  // A block's heading stays with its body beside a figure (live Blue,
  // 2026-11-02: scores beside Figure 13 lost their method names).
  const commentary=existing.length?[]:(slide.copy?.blocks||[]).map(block=>({type:'text',content:{text:block.heading?`${block.heading}：${block.body}`:block.body}}));
  // Its outline page's figure-card headings (Fable M4) and notes pointers.
  const page=project.outline?.[index]?.id===slide.id?project.outline[index]:project.outline?.find(item=>item.id===slide.id)||{};
  const pills=figurePills(project,{...page,sourceImageIds:imageIds});
  const figureParts=images.flatMap((image,k)=>[...(pills?[{type:'list',content:{items:[{id:'pill_'+image.id,text:pills[k]}],figurePillOf:image.id,markers:[String(k+1)],derivedFrom:'figure-card-heading'}}]:[]),...sourceImageComponents(shownImage(project,image),page.figureNotePointers?.[image.id])]);
  const planned=[...existing.map(node=>({type:node.type,content:node.content})),...commentary,...figureParts];
  // Fable F4 (2026-10-27, world_models.pdf: one page's figures failed the whole
  // deck): a page that cannot fit its figures at full size keeps its text as
  // measured and shows the figures scaled into the space left, each above its
  // caption, with a figure_scaled note. Only text that leaves no room fails.
  const {fit,scaledBasis,components}=sourceMediaFit(planned,project,index);
  if(scaledBasis)slide.figureScaled={imageIds,basis:scaledBasis};
  if(!fit?.capacity_ok)throw new Error('source_media_capacity: split this page without omitting the source images');
  const nodes=components.map((component,position)=>existing[position]?{...existing[position],geometry:fit.boxes[position]}:{
    id:stableId('node',slide.id,component.content.sourceImageId||component.content.sourceImageCaptionId||(component.content.figurePillOf?'pill-'+component.content.figurePillOf:'media-commentary'),position),type:component.type,
    semanticRole:component.type==='image'?'source-media':'source-explanation',slotId:'absolute',geometry:fit.boxes[position],content:component.content.figurePillOf?pillContent(project,component.content,fit.measurements?.[position]?.fontSizePt):component.content,
    ...(component.type==='image'?{sourceArtifact:{sourceUnitId:component.content.sourceImageId,type:'SourceImage'},sourceRefs:component.content.sourceRefs}:component.content.sourceImageCaptionId?{sourceArtifact:{sourceUnitId:component.content.sourceImageCaptionId,type:'SourceImageCaption'}}:{}),
    style:{fontSizePt:fit.measurements?.[position]?.fontSizePt||fit.captionFonts?.[position]||fit.fontSizePt,...(component.content?.sourceImageCaptionId?{fontBasis:'figure_caption'}:{}),fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,
      ...(()=>{const chosen=templateTextColor(project,index,'body');return {color:chosen.color,colorBasis:chosen.basis};})()},zIndex:500});
  const spec=project.templateFidelity?.slides?.[index];
  for(const slot of spec?.slots||[])if(slot.role==='content'&&!slide.templateOmissions?.some(o=>o.shapeId===slot.shapeId)){
    slide.templateOmissions||=[];slide.templateOmissions.push({shapeId:slot.shapeId,reason:'Source media and its explanation replace the original content region.'});
  }
  slide.nodes=(slide.nodes||[]).filter(node=>!isSourceOwnedNode(node)&&!['body','subtitle','takeaway'].includes(node.semanticRole));
  appendReadingHandoff(project,slide,index,nodes);
  slide.nodes.push(...nodes);slide.sourceArtifactNodes=nodes;slide.nodeOrder=slide.nodes.map(node=>node.id);
  slide.bullets=[];slide.copy={...slide.copy,subtitle:'',takeaway:''};slide.sourceArtifactFit=fit;
  replaceTemplateSourceRegion(project,slide,index,fit.canvas);
  return slide;
}

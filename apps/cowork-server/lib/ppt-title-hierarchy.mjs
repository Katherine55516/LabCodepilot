import {cardsFlow} from './ppt-flow.mjs';
import {titleLanguageMode} from './ppt-generation-policy.mjs';
import {pageTopicLanguage} from './ppt-presentation-contract.mjs';
import {normalizeTopicTitle,keepCardContinuation} from './ppt-topic-language.mjs';
import {contrastRatio} from './ppt-template-colors.mjs';
import {richTextContent} from './ppt-source-text.mjs';
import {measureText,textContract} from './ppt/render-contract.mjs';
import {setLeadBinder} from './ppt-template-fill-bind.mjs';
const PT=12700;
function singleLineWidth(node,maxWidth){
 const fits=width=>measureText({...node,kind:'text',bounds:{...node.geometry,width}}).lines<=1;
 if(!fits(maxWidth))return null;
 let low=0,high=maxWidth;for(let i=0;i<18;i++){const middle=(low+high)/2;if(fits(middle))high=middle;else low=middle;}
 return Math.ceil(high+2*PT);
}
export function isBilingualTitlePair(primary,secondary,language){
 if(!secondary||secondary===primary)return false;
 const han=/\p{Script=Han}/u.test(secondary),latin=/[A-Za-z]/u.test(secondary);
 return language==='en'?han:['zh','zh-Hant'].includes(language)?latin&&!han:true;
}
/** Preserve both topic variants as semantic metadata, not one oversized
 * bilingual title string. Do not translate or alter locked user titles. */
export function planTitleHierarchy(project,raw){
 if(project.generationPolicy?.version!==2||project.generationPolicy.language?.mode!=='source')return raw;
 return {...raw,slides:raw.slides.map((s,index)=>{
  if(s.titleLocked||s.title_locked||index===0&&project.deckTitle?.locked)return s;
  const language=pageTopicLanguage(project,s);
  const parts=String(s.title||'').split(/\s+[|｜/]\s+|\n/u).map(x=>x.trim()).filter(Boolean);
  const han=parts.find(x=>/\p{Script=Han}/u.test(x)),latin=parts.find(x=>! /\p{Script=Han}/u.test(x)&&/[A-Za-z]/u.test(x));
  const chosen=language==='en'?latin||s.title:han||s.title;
  const primary=keepCardContinuation(cardsFlow(project),chosen,normalizeTopicTitle(chosen,language));
  const secondary=String(s.titleSecondary||(language==='en'?han:latin)||'').trim();
  const rest={...s};delete rest.titleSecondary;delete rest.titlePair;
  return {...rest,title:primary,...(isBilingualTitlePair(primary,secondary,language)?{titleSecondary:secondary,titlePair:{primary,secondary,primaryLanguage:language,basis:'owned-input-prose-language'}}:{})};
 })};
}
/** A card deck's section label is often longer than the template's sample:
 * its pill or badge (a small text-free shape under the label's start) widens
 * to the label's measured width (live alpha-r13: "Search and Evaluation" ran
 * past a 0.95 in pill). Returns the label's right edge, or null. */
function fitSectionLabelCarrier(project,slide){
 const label=(slide.nodes||[]).find(n=>n.type==='text'&&n.templateSlot?.role==='section'&&String(n.content?.text||'').trim()&&n.geometry);
 const main=(slide.nodes||[]).find(n=>['template-title','title'].includes(n.semanticRole)&&n.type==='text'&&n.geometry);
 if(!label||!main)return null;
 const g=label.geometry,ink=singleLineWidth({...label,geometry:{...g,width:main.geometry.width}},main.geometry.width)||g.width,right=g.x+Math.min(g.width,ink);
 // The label's box is its one-line ink: a box widened to the title's edge
 // would overlap the translation beside it (live r14: render_overlap).
 // Its glyph-extent record would keep the old width for the next fit and the render audit.
 if(ink<g.width){label.geometry={...g,width:ink};delete label.templateTitleFrameAdaptation;}
 const size=project.templateFidelity||{width:12192000,height:6858000},cx=g.x+Math.min(g.height,g.width)/2,cy=g.y+g.height/2;
 const carrier=(slide.nodes||[]).find(n=>n!==label&&n.type==='shape'&&n.nativeRef&&n.geometry&&!n.userGeometry&&!String(n.content?.text||'').trim()&&
  n.geometry.width*n.geometry.height<size.width*size.height*.03&&n.geometry.x<=cx&&n.geometry.x+n.geometry.width>=cx&&n.geometry.y<=cy&&n.geometry.y+n.geometry.height>=cy);
 if(!carrier)return right;
 const c=carrier.geometry,pad=Math.max(g.x-c.x,6*PT),width=Math.min(Math.round(right+pad-c.x),main.geometry.width);
 if(width>c.width){
  carrier.geometry={...c,width};
  slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(item=>String(item.shapeId)!==String(carrier.nativeRef.shapeId)),{shapeId:carrier.nativeRef.shapeId,action:'section_label_carrier_fit',geometry:{...carrier.geometry},basis:'the label carrier widens to the measured section label; same shape, colour and height'}];
 }
 return Math.max(right,carrier.geometry.x+carrier.geometry.width);
}
export function bindTitleHierarchy(project,slide,index){
 const labelRight=project.planningContract?.flow==='cards'?fitSectionLabelCarrier(project,slide):null;
 const outline=project.outline?.[index],pair=outline?.titlePair&&{...outline.titlePair,primary:outline.title};
 if(project.generationPolicy?.version!==2||!pair?.secondary||outline.titleLocked||project.generationPolicy.language?.mode==='output')return;
 const primaryOnly=titleLanguageMode(project)==='primary';
 if(primaryOnly||!isBilingualTitlePair(pair.primary,pair.secondary,pair.primaryLanguage)){
  // An automatic same-language alternative is not a translation, and a
  // primary-only title policy shows none (the pair stays outline metadata).
  // Keep body, primary title and user objects; remove only a stale generated
  // auxiliary.
  slide.nodes=(slide.nodes||[]).filter(n=>{
   if(n.content?.derivedFrom!=='title-hierarchy'||n.userStyle||n.userGeometry||n.locked)return true;
   if(!n.nativeRef)return false;
   n.content={...richTextContent(''),derivedFrom:'title-hierarchy-suppressed'};n.semanticRole='template-section';delete n.titlePair;return true;
  });
  slide.titleHierarchyOmission={reason:primaryOnly?'titles show the primary language only':'same-language alternative is not a bilingual translation',secondary:pair.secondary};delete slide.titlePair;delete slide.titleHierarchyIssue;slide.nodeOrder=slide.nodes.map(n=>n.id);return;
 }
 const manual=slide.nodes?.find(n=>n.semanticRole==='title-translation'&&n.content?.derivedFrom==='title-hierarchy'&&(n.userStyle||n.userGeometry||n.locked));
 if(manual){slide.titlePair=pair;return;}
 slide.nodes=(slide.nodes||[]).filter(n=>n.content?.derivedFrom!=='title-hierarchy'||n.nativeRef||n.userStyle||n.locked);
 const main=slide.nodes.find(n=>['template-title','title'].includes(n.semanticRole)&&n.type==='text');
 if(!main?.geometry||main.userGeometry||main.locked)return;
 const sectionSlot=slide.nodes.find(n=>n.type==='text'&&n.templateSlot?.role==='section'&&!n.locked&&!n.userGeometry);
 // A card deck's section slot carries the chapter label (normalizeDeckEyebrows):
 // the translation never takes it (Fable review r11: every single-slot page
 // lost its label to the title's Chinese half).
 const keepLabel=project.planningContract?.flow==='cards'&&Boolean(sectionSlot&&String(sectionSlot.content?.text||'').trim());
 const section=keepLabel?null:sectionSlot;
 const titleFont=main.style?.fontSizePt||32,font=Math.max(14,Math.min(section?.style?.fontSizePt||16,16,titleFont*.44)),gap=Math.round(font*.3*PT);
 const content={...richTextContent(pair.secondary),derivedFrom:'title-hierarchy',language:pair.primaryLanguage==='en'?'zh':'en'};
 const bg=project.templateFidelity?.slides?.[index]?.background||project.templateSpec?.palette?.background||'#ffffff';
 const palette=[project.templateSpec?.palette?.accent,sectionSlot?.style?.color,'#526a86','#b7c9dc','#333333','#eeeeee'].filter(c=>c&&c!==main.style?.color);
 const color=palette.find(c=>(contrastRatio(c,bg)||0)>=4.5)||main.style?.color;
 if(project.planningContract?.flow==='cards'){
  // Under the title, in the band the content canvas reserves for it (Fable
  // review fz-r15: a translation beside the badge read as one mismatched line).
  // Measured as contentCanvas measures the header: the template's title frame and line.
  {const spec=project.templateFidelity?.slides?.[index],frame=spec?.nodes?.find(n=>String(n.nativeRef?.shapeId)===String(main.nativeRef?.shapeId))||main;
   const margins=frame.nativeTextFrame?.margins||[0,0,0,0],lines=Math.max(1,frame.nativeTextFrame?.paragraphs?.length||1);
   const textHeight=Number(frame.style?.fontSizePt||main.style?.fontSizePt||24)*1.25*PT*lines+(Number(margins[1])||0)+(Number(margins[3])||0);
   const y=Math.round(frame.geometry.y+Math.max(frame.geometry.height,textHeight)+.08*914400),width=main.geometry.width;
   const measured={kind:'text',semanticRole:'title-translation',content,style:{...main.style,fontSizePt:font},bounds:{width,height:0}};
   const contract=textContract(measured),metrics=measureText(measured,contract);
   const height=Math.ceil((metrics.estimatedHeightPt+contract.margins[1]+contract.margins[3]+1)*PT);
   const geometry={x:main.geometry.x,y,width,height};
   const clash=(slide.nodes||[]).some(n=>n!==main&&n!==sectionSlot&&n.geometry&&!n.hidden&&n.content?.derivedFrom!=='title-hierarchy'&&['text','list','table','image','chart'].includes(n.type)&&
    n.geometry.x<geometry.x+geometry.width&&n.geometry.x+n.geometry.width>geometry.x&&n.geometry.y<geometry.y+geometry.height&&n.geometry.y+n.geometry.height>geometry.y);
   if(!clash&&y+height<=(project.templateFidelity?.height||6858000)){
    slide.nodes.push({id:'title_translation_'+slide.id,type:'text',semanticRole:'title-translation',geometry,zIndex:Math.max(10,main.zIndex||0),content,style:{...main.style,fontSizePt:font,color},titlePair:pair});
    slide.titlePair=pair;slide.nodeOrder=slide.nodes.map(n=>n.id);delete slide.titleHierarchyIssue;return;
   }}
 }
 if(keepLabel){
  // Else beside the label, on its row above the title, when there is room.
  // The label's ink and its pill, not its (widened) text box.
  const lg=sectionSlot.geometry,x=Math.round((labelRight??lg.x+lg.width)+12*PT),width=main.geometry.x+main.geometry.width-x;
  if(width>=main.geometry.width*.35){
   const measured={kind:'text',semanticRole:'title-translation',content,style:{...main.style,fontSizePt:font},bounds:{width,height:0}};
   const contract=textContract(measured),metrics=measureText(measured,contract);
   const height=Math.ceil((metrics.estimatedHeightPt+contract.margins[1]+contract.margins[3]+1)*PT);
   const y=Math.round(Math.min(lg.y+lg.height/2-height/2,main.geometry.y-gap/2-height));
   if(y>=0){
    slide.nodes.push({id:'title_translation_'+slide.id,type:'text',semanticRole:'title-translation',geometry:{x,y,width,height},zIndex:Math.max(10,main.zIndex||0),content,style:{...main.style,fontSizePt:font,color},titlePair:pair});
    slide.titlePair=pair;slide.nodeOrder=slide.nodes.map(n=>n.id);delete slide.titleHierarchyIssue;return;
   }
  }
 }
 const titleStyle={...main.style,...section?.style,fontSizePt:font};
 const width=Math.max(section?.geometry?.width||0,main.geometry.x+main.geometry.width-(section?.geometry?.x??main.geometry.x));
 const measured={kind:'text',semanticRole:'title-translation',content,style:titleStyle,nativeRef:section?.nativeRef,nativeTextFrame:section?.nativeTextFrame,bounds:{width,height:0}};
 const contract=textContract(measured),metrics=measureText(measured,contract);
 const height=Math.ceil((metrics.estimatedHeightPt+contract.margins[1]+contract.margins[3]+1)*PT);
 const boxHeight=Math.max(height,section?.geometry?.height||0);
 const frame={x:section?.geometry?.x??main.geometry.x,y:Math.min(section?.geometry?.y??Infinity,main.geometry.y-boxHeight-gap),width,height:boxHeight};
 const geometry=Object.fromEntries(['x','y','width','height'].map(key=>[key,Math.round(frame[key])]));
 const navigation=slide.nodes.find(n=>n.semanticRole==='eyebrow'&&n.content?.derivedFrom==='source-navigation'&&!n.nativeRef&&!n.locked&&!n.userStyle&&!n.userGeometry&&n.geometry);
 let navigationGeometry;
 if(navigation){
  const labelWidth=singleLineWidth(navigation,main.geometry.width),columnGap=8*PT;
  if(labelWidth&&labelWidth+columnGap<width*.65){
   const remaining=width-labelWidth-columnGap;
   const parallel={...measured,bounds:{width:remaining,height:0}},pc=textContract(parallel),pm=measureText(parallel,pc);
   const parallelHeight=Math.ceil((pm.estimatedHeightPt+pc.margins[1]+pc.margins[3]+1)*PT);
   const rowHeight=Math.max(parallelHeight,navigation.geometry.height);
   const rowY=Math.round(main.geometry.y-rowHeight-gap);
   navigationGeometry={...navigation.geometry,x:main.geometry.x,y:rowY,width:labelWidth};
   Object.assign(geometry,{x:main.geometry.x+labelWidth+columnGap,y:rowY,width:remaining,height:parallelHeight});
  }
 }
 // Navigation and translations share the title band. Stack the generated
 // auxiliary above actual occupied objects, rather than overlaying a section
 // label or assuming that a font-sized box can hold a measured text line.
 const size=project.templateFidelity||project.externalPptx||{width:12192000,height:6858000};
 const blockers=(slide.nodes||[]).filter(n=>n!==main&&n!==section&&!(n===navigation&&navigationGeometry)&&n.geometry&&n.content?.derivedFrom!=='title-hierarchy'&&!n.hidden&&Number(n.style?.opacity??1)>0&&
  (n.geometry.width*n.geometry.height<size.width*size.height*.5)&&(!['text','list'].includes(n.type)||n.content?.text||n.content?.items?.length));
 for(let i=0;i<=blockers.length;i++){
  const collision=blockers.filter(n=>{const g=n.geometry;return [geometry,...(navigationGeometry?[{...navigationGeometry,y:geometry.y}]:[])].some(b=>b.x<g.x+g.width&&b.x+b.width>g.x&&b.y<g.y+g.height&&b.y+b.height>g.y);});
  if(!collision.length)break;
  geometry.y=Math.round(Math.min(...collision.map(n=>n.geometry.y))-geometry.height-gap);
 }
 if(geometry.y<0||geometry.y+geometry.height>main.geometry.y-gap/2){slide.titleHierarchyIssue='No safe region above the primary title';return;}
 if(navigationGeometry)navigation.geometry={...navigationGeometry,y:geometry.y};
 const node=section||{id:'title_translation_'+slide.id,type:'text',geometry,zIndex:Math.max(10,main.zIndex||0)};
 // A section label that moves to the title band leaves its pill or badge
 // behind empty: that small text-free carrier goes with it (3143, 367a72d8
 // pages 3, 5, 7: an empty orange pill above the title).
 const was=section?.geometry;
 if(was&&section.nativeRef&&Math.abs(was.y-geometry.y)>was.height){
  // The label's start, not its centre: a label is widened toward the title's right edge.
  const cx=was.x+Math.min(was.width,was.height)/2,cy=was.y+was.height/2,area=size.width*size.height;
  // Template decorations import as locked; only the author's own changes keep a carrier.
  const carriers=slide.nodes.filter(n=>n!==section&&n.type==='shape'&&n.nativeRef&&n.geometry&&!n.userGeometry&&!n.userStyle&&!String(n.content?.text||'').trim()&&
   n.geometry.width*n.geometry.height<area*.03&&n.geometry.x<=cx&&n.geometry.x+n.geometry.width>=cx&&n.geometry.y<=cy&&n.geometry.y+n.geometry.height>=cy);
  if(carriers.length){
   slide.templateOmissions=[...(slide.templateOmissions||[]),...carriers.filter(n=>!(slide.templateOmissions||[]).some(o=>String(o.shapeId)===String(n.nativeRef.shapeId))).map(n=>({shapeId:Number(n.nativeRef.shapeId),reason:'Carrier of the section label that moved to the title band.',automatic:true,approvalBasis:'title_hierarchy_carrier'}))];
   slide.nodes=slide.nodes.filter(n=>!carriers.includes(n));
  }
 }
 node.semanticRole='title-translation';node.content={...node.content,...content};
 node.style={...main.style,...node.style,fontSizePt:font,color};node.geometry=geometry;node.titlePair=pair;
 // The measured frame replaces the native one: a glyph-extent record of the
 // native frame would make the next fit measure the old position and block.
 delete node.templateTitleFrameAdaptation;
 // A reused small native section frame retains editability and identity.
 if(!section)slide.nodes.push(node);
 slide.titlePair=pair;slide.nodeOrder=slide.nodes.map(n=>n.id);delete slide.titleHierarchyIssue;
}
/** A card's lead under its title (the hand deck, Fable G4, 2026-11-02): a
 * page whose template sub-title slot shows it has nothing to add; else one
 * line in the band under the title (and its translation) when nothing there
 * clashes — a theme page reserves that band, a native page's components never
 * move or shrink; else the lead is the first line of the notes (leadNotes). */
// A filled page's short lead becomes this card lead (Fable 2026-11-03, Q6 (b)).
setLeadBinder((project,slide,index)=>bindCardLead(project,slide,index));
export function bindCardLead(project,slide,index){
 const outline=project.outline?.[index],lead=String(outline?.lead||'').trim();
 slide.nodes=(slide.nodes||[]).filter(n=>n.semanticRole!=='card-lead'||n.userStyle||n.userGeometry||n.locked);
 if(project.planningContract?.flow!=='cards'||index<1||!lead||slide.nodes.some(n=>String(n.content?.text||'').trim()===lead))return;
 const main=slide.nodes.find(n=>['template-title','title'].includes(n.semanticRole)&&n.type==='text'&&n.geometry);if(!main)return;
 const above=slide.nodes.find(n=>n.semanticRole==='title-translation'&&n.geometry);
 const spec=project.templateFidelity?.slides?.[index],frame=spec?.nodes?.find(n=>String(n.nativeRef?.shapeId)===String(main.nativeRef?.shapeId))||main;
 const margins=frame.nativeTextFrame?.margins||[0,0,0,0],lines=Math.max(1,frame.nativeTextFrame?.paragraphs?.length||1);
 const textHeight=Number(frame.style?.fontSizePt||main.style?.fontSizePt||24)*1.25*PT*lines+(Number(margins[1])||0)+(Number(margins[3])||0);
 const y=Math.round(above?above.geometry.y+above.geometry.height+.04*914400:frame.geometry.y+Math.max(frame.geometry.height,textHeight)+.08*914400),width=main.geometry.width;
 const content={...richTextContent(lead),derivedFrom:'card-lead'},font=14;
 const body=slide.nodes.find(n=>n.type==='text'&&n!==main&&n.style?.color&&n.semanticRole!=='title-translation');
 const style={...main.style,fontSizePt:font,fontWeight:400,...(body?.style?.fontFamily?{fontFamily:body.style.fontFamily}:{}),color:body?.style?.color||main.style?.color};
 const measured={kind:'text',semanticRole:'card-lead',content,style,bounds:{width,height:0}};
 const contract=textContract(measured),metrics=measureText(measured,contract);
 if(Number(metrics.lines||1)>1)return;
 const height=Math.ceil((metrics.estimatedHeightPt+contract.margins[1]+contract.margins[3]+1)*PT),geometry={x:main.geometry.x,y,width,height};
 // A frame with no fill, no line and no text draws nothing (Capabilities t3's empty "Text 1" under the title).
 const invisible=n=>n.type==='shape'&&!n.style?.fill&&!n.style?.lineColor&&!String(n.content?.text||'').trim();
 const clash=slide.nodes.some(n=>n!==main&&n!==above&&n.geometry&&!n.hidden&&!invisible(n)&&['text','list','table','image','chart','shape'].includes(n.type)&&!(n.type==='shape'&&n.geometry.width*n.geometry.height>=(project.templateFidelity?.width||12192000)*(project.templateFidelity?.height||6858000)*.5)&&
  n.geometry.x<geometry.x+geometry.width&&n.geometry.x+n.geometry.width>geometry.x&&n.geometry.y<geometry.y+geometry.height&&n.geometry.y+n.geometry.height>geometry.y);
 if(clash||y+height>(project.templateFidelity?.height||6858000))return;
 slide.nodes.push({id:'card_lead_'+slide.id,type:'text',semanticRole:'card-lead',geometry,zIndex:Math.max(10,main.zIndex||0),content,style});
 slide.nodeOrder=slide.nodes.map(n=>n.id);
}

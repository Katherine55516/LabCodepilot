import {ensureSlideV3} from './ppt/ir.mjs';
import {closingTopic} from './ppt-topic-language.mjs';
import {deckLanguage} from './ppt-presentation-contract.mjs';
import {automaticPages} from './ppt-density-profile.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {digest} from './ppt/edit-context.mjs';
const greeting=/^(?:thanks?(?:\s+for\s+watching)?[!.！]?|thank\s+you[!.！]?|感谢(?:观看|聆听)|感謝(?:觀看|聆聽)|谢谢(?:观看)?|謝謝(?:觀看)?)$/iu;
export function ownsClosingContent(slide){return Boolean(slide.sourceUnitIds?.length||slide.sourceArtifactRanges?.length||slide.sourceImageIds?.length||slide.repeatSourceUnitIds?.length||slide.claimIds?.length||slide.requiredDetails?.length||slide.refs?.length||slide.chunkRefs?.length);}
// A card deck's closing on an uploaded template is a theme frame page like the
// takeaway (the user, 2026-10-31): the template's background, title style and
// colours, never a content layout's numbered grid or old text boxes.
// Its section label is "Closing"/"结束", as on the fixed closing page: with no
// section, the template's small label pill took the whole title and overflowed
// (World Models, 3197).
const cardClosing=project=>cardsFlow(project)&&project.templateFidelity?.mode==='preserve'?{cardObjects:[],section:deckLanguage(project)==='zh-Hant'?'結束':String(deckLanguage(project)).startsWith('zh')?'结束':'Closing'}:{};
// A card deck's closing has a stable id, derived like its cards' ids from the
// page before it: a random one made two identical outlines differ.
const closingId=(project,raw)=>cardsFlow(project)?{id:'page_'+digest({closingAfter:raw.slides.at(-1)?.id||'',deck:raw.slides.length}).slice(0,20)}:{};
export function cardThemeClosing(project,slide){return cardsFlow(project)&&project.templateFidelity?.mode==='preserve'&&slide?.role==='closing'&&Array.isArray(slide.cardObjects);}
export function ensureOutlineClosing(project,raw){
 if(project.requestedOutline||!raw?.slides?.length)return raw;
 // Card decks end with their own closing page after the takeaway (user
 // decision): the greeting is never squeezed onto the last content card.
 const automatic=automaticPages(project)||cardsFlow(project);
 const sourceClosing=project.generationPolicy?.content==='full_source'&&!project.update&&Boolean(project.source?.semantic?.inventory?.items?.length);
 if(!automatic&&!sourceClosing)return raw;
 // Explicit N keeps its count, but an unowned generated closing placeholder
 // must be a greeting before confirmation, not a second unsourced summary.
 const slides=automatic?raw.slides.filter((slide,index)=>index===0||index===raw.slides.length-1||slide.titleLocked||slide.title_locked||ownsClosingContent(slide)||!greeting.test(slide.title||'')):raw.slides;
 raw={...raw,slides};
 const last=slides.at(-1);
 const closingPlaceholder=!ownsClosingContent(last)&&!last.titleLocked&&!last.title_locked&&(greeting.test(last.title||'')||['closing','conclusion'].includes(last.role||last.pageContract?.job));
 const invitation=closingInvitation(project),closingPoints=invitation?[{text:invitation}]:[];
 if(closingPlaceholder){raw.slides[raw.slides.length-1]={...last,title:closingTopic(deckLanguage(project)),focus:invitation||closingTopic(deckLanguage(project)),question:'',description:'',keyPoints:closingPoints,role:'closing',...cardClosing(project)};return raw;}
 if(!automatic||!ownsClosingContent(last)&&greeting.test(last.title||''))return raw;
 if(slides.length>=100)return raw;
 const content={...last};
 if(greeting.test(content.title||'')){
  const item=(project.source?.semantic?.inventory?.items||[]).find(item=>last.sourceUnitIds?.includes(item.id));
  content.title=item?.sectionPath?.at(-1)||last.section||last.focus||'Next steps';
 }
 return {...raw,slides:[...raw.slides.slice(0,-1),content,{...closingId(project,raw),title:closingTopic(deckLanguage(project)),focus:invitation||closingTopic(deckLanguage(project)),keyPoints:closingPoints,role:'closing',sourceUnitIds:[],sourceImageIds:[],sourceArtifactRanges:[],...cardClosing(project)}]};
}
/** Fixed page budgets retain the last topic and add a small, measurable greeting.
 * The same canonical node enters previews, geometry checks and native exports. */
export function appendClosingGreeting(project,slide){
 const text=closingTopic(deckLanguage(project));if(greeting.test(slide.title||''))return slide;
 Object.assign(slide,ensureSlideV3(slide));
 const origin=project.templateFidelity||project.externalPptx||{},width=origin.width||12192000,height=origin.height||6858000,w=Math.min(width*.4,3657600),h=365760;
 const id='closing_'+slide.id.slice(0,64);
 slide.nodes=[...(slide.nodes||[]).filter(node=>node.id!==id),{id,type:'text',semanticRole:'closing-greeting',content:{text},geometry:{x:Math.round((width-w)/2),y:Math.round(height-502920),width:Math.round(w),height:h},style:{fontSizePt:14,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,textAlign:'center',color:project.templateSpec?.palette?.foreground},zIndex:100,locked:true}];
 slide.closingGreetingText=text;return slide;
}

export function isDedicatedClosing(slide){return !slide.manualBlank&&!ownsClosingContent(slide)&&greeting.test(slide.title||'');}
/** Retire a complete, provably empty numbered content carrier on an automatic
 * closing. Preserve artwork, titles, unknown shapes and all user protection. */
export function closingTemplateOmissions(project,slide,index,{validate=false}={}){
 if(!isDedicatedClosing(project.outline?.[index]||slide)||!validate&&(slide.locked||project.runtime?.slides?.[slide.id]?.accepted)||!['design_only','keep_fixed'].includes(project.templateContentMode))return [];
 const spec=project.templateFidelity?.slides?.[index];if(!spec)return [];
 const fixed=new Set(project.templateFixedObjectIds||[]),prior=new Map((slide.nodes||[]).map(n=>[n.id,n]));
 const protectedNode=n=>n.content?.mustPreserve||fixed.has(n.id)||prior.get(n.id)?.userGeometry||prior.get(n.id)?.userStyle||prior.get(n.id)?.locked&&!n.locked;
 const contains=(a,b)=>a&&b&&a.x<=b.x&&a.y<=b.y&&a.x+a.width>=b.x+b.width&&a.y+a.height>=b.y+b.height;
 const omitted=new Set((slide.templateOmissions||[]).map(o=>String(o.shapeId))),records=[];
 for(const ordinal of spec.nodes.filter(n=>n.type==='text'&&/^\d{1,2}$/u.test(String(n.content?.text||'').trim())&&n.content?.templateDesignOnly&&!protectedNode(n))){
  const carriers=spec.nodes.filter(n=>n.type==='shape'&&n.content?.templateDesignOnly&&!protectedNode(n)&&/RECTANGLE/u.test(n.nativeRef?.autoShapeType||'')&&contains(n.geometry,ordinal.geometry));
  if(carriers.length!==1)continue;
  const carrier=carriers[0],g=carrier.geometry;
  const slots=(spec.slots||[]).filter(s=>s.role==='content').filter(s=>{const n=spec.nodes.find(n=>n.nativeRef?.shapeId===s.shapeId),b=n?.geometry;return b&&b.x>=g.x&&b.x+b.width<=g.x+g.width&&b.y>=g.y+g.height&&b.y<g.y+g.height*3;});
  if(!slots.length||slots.some(s=>!omitted.has(String(s.shapeId))))continue;
  for(const n of [carrier,ordinal])records.push({version:1,shapeId:n.nativeRef.shapeId,automatic:true,approvalBasis:'empty_closing_component',reason:'Dedicated closing has no source body; all content slots in this numbered carrier are omitted.',contentSlotIds:slots.map(s=>s.shapeId)});
 }
 return records;
}
export function deterministicClosingDraft(project,slide,index){
 const native=Boolean(project.externalPptx||project.templateFidelity?.mode==='preserve');
 const slots=project.templateFidelity?.slides?.[index]?.slots||[],label=/[\p{Script=Han}]/u.test(slide.title)?(deckLanguage(project)==='zh-Hant'?'結束':'结束'):'Closing';
 return {title:slide.title,...(!native?{layoutId:'cover'}:{}),eyebrow:'',subtitle:native?'':closingInvitation(project),takeaway:'',contentBlocks:[],blocks:[],sourceArtifacts:[],sourceCommentary:[],sourceEvidenceIds:[],evidenceUsedIds:[],slotTexts:Object.fromEntries(slots.filter(slot=>['title','section'].includes(slot.role)).map(slot=>[String(slot.shapeId),slot.role==='title'?slide.title:label])),omitTemplateShapes:slots.filter(slot=>slot.role==='content').map(slot=>({shapeId:slot.shapeId,reason:'Dedicated closing greeting has no source obligations; omit old report body slots.'}))};
}

// A card deck's closing says only "感谢观看" / "Thanks for watching" (the user, 2026-10-31).
function closingInvitation(project){if(cardsFlow(project))return '';return ({zh:'欢迎提问与交流','zh-Hant':'歡迎提問與交流',ja:'ご質問をどうぞ',ko:'질문을 환영합니다',de:'Fragen und Diskussion',fr:'Questions et discussion',es:'Preguntas y conversación'})[deckLanguage(project)]||'Questions & discussion.';}
export function closingFramingTexts(project){return [closingTopic(deckLanguage(project)),closingInvitation(project)].filter(Boolean);}
export function prepareClosingLayout(project,slide){
 if(!project.externalPptx&&project.templateFidelity?.mode!=='preserve'){Object.assign(slide,ensureSlideV3(slide));for(const node of slide.nodes.filter(node=>['title','subtitle'].includes(node.semanticRole)))node.style={...node.style,textAlign:'center'};return;}
 Object.assign(slide,ensureSlideV3(slide));const size=project.templateFidelity||project.externalPptx,width=size.width||12192000,height=size.height||6858000;
 const titleBottom=Math.max(0,...slide.nodes.filter(node=>['title','template-title'].includes(node.semanticRole)&&node.geometry).map(node=>node.geometry.y+node.geometry.height));
 if(!closingInvitation(project))return;
 const y=Math.max(height*.53,titleBottom+91440),h=Math.min(height*.15,height*.92-y);if(h<457200)throw new Error('Closing layout has no room for its invitation at readable type size; reflow the title or choose a component layout');
 slide.nodes.push({id:'closing_invite_'+slide.id.slice(0,60),type:'text',semanticRole:'closing-greeting',content:{text:closingInvitation(project)},geometry:{x:Math.round(width*.1),y:Math.round(y),width:Math.round(width*.8),height:Math.round(h)},style:{fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,fontSizePt:24,textAlign:'center',color:project.templateSpec?.palette?.foreground},zIndex:100,locked:true});
}

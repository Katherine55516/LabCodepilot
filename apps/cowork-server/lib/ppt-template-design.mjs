import {classifyTemplatePage} from './ppt-template-roles.mjs';
import {templateMediaAssemblies} from './ppt-media-assemblies.mjs';
import {pictureCertificate} from './ppt-template-picture-read.mjs';
/** A new presentation owns its facts. A report used as a template owns only
 * design unless the user explicitly elects to keep its fixed content. The
 * opaque original and cached import remain unchanged. */
// Read text on a kept decorative picture marks it as old content (Fable,
// 2026-10-23; report 84f9e527): three words of 3+ letters, or a run of two digits.
const carriesText=content=>content?.ocr?.status==='ok'&&(content.ocr.words>=3||content.ocr.digitRun);
const textUnchecked=content=>content?.ocr?.status==='unavailable'||content?.ocr?.status==='failed';
const KEPT_ROLES=['template_decoration','template_icon','template_artwork'];
// A picture that links out (a "Made with" badge, a logo to a website) is the
// old deck's attribution or brand, never decoration (Fable, 2026-10-23; report
// a8725ccd, 3143 5f440e7f: a layout's "Made with GAMMA" badge reached every page).
const linked=content=>Boolean(content?.href);
export function templateDesignView(imported, contentImageIds = new Set(),fixedIds = new Set(),{preserveClassifiedDesign=false,roleFor=null}={}) {
  const known=new Set([...imported.deck.slides.flatMap(slide=>slide.nodes||[]).map(node=>node.id),...(imported.externalPptx?.inherited||[]).map(item=>item.key)]);
  if([...fixedIds].some(id=>!known.has(id)))throw new Error('Selected fixed template object is no longer available; review the current template');
  const view = structuredClone(imported);let unchecked=0;const linkedRetired=[];
  // An unbound multi-layer illustration is retired as a unit. Keeping its
  // halves as unrelated rails made split donuts imply unsupported data.
  const assemblies=view.deck.slides.flatMap(slide=>templateMediaAssemblies(slide,view.externalPptx));
  const assemblyByNode=new Map(assemblies.flatMap(group=>group.members.map(node=>[node.id,group])));
  const fixedAssemblyIds=new Set(assemblies.filter(g=>g.members.some(n=>fixedIds.has(n.id))).flatMap(g=>g.members.map(n=>n.id)));
  // A wide picture on a cover or section page whose text was never read sits where
  // a "COMPANY NAME" pill sits: without OCR or a vision check it is retired
  // (Fable, 2026-10-25; report 52c7696e, 3143 g5b/g5c: the Portfolio cover's pill reached the deck).
  const size0=view.externalPptx||{},titlePages=new Set(view.deck.slides.map((slide,index)=>index===0||['cover','section'].includes(classifyTemplatePage(slide,size0).role)?slide:null).filter(Boolean));
  const unreadPill=(node,slide)=>{if(node.type!=='image'||!titlePages.has(slide)||node.content?.ocr?.status==='ok'||node.content?.visionText===false)return false;
    const g=node.geometry||{},area=g.width*g.height/Math.max(1,Number(size0.width||12192000)*Number(size0.height||6858000));
    return area>0&&area<.05&&g.width>=g.height*2;};
  for (const slide of view.deck.slides) for (const node of slide.nodes || []) {
    const role = node.content?.mediaRole || (preserveClassifiedDesign&&roleFor&&node.type==='image'?roleFor(node,slide,view.externalPptx):null);
    if(role&&!node.content?.mediaRole)node.content={...node.content,mediaRole:role,mediaRoleBasis:'shared-template-component-classifier'};
    const brand = fixedIds.has(node.id)||fixedAssemblyIds.has(node.id);
    if (brand) { node.content = { ...node.content, mediaRole: 'brand', mustPreserve: true }; continue; }
    node.content = { ...node.content, templateDesignOnly: true,mustPreserve:false,...(role==='brand'?{mediaRole:undefined}:{}) };
    if(assemblyByNode.has(node.id)){node.content={...node.content,mediaRole:'old_template_content',templateSample:true,templateAssemblyId:assemblyByNode.get(node.id).id,retiredDecorationBasis:'unbound composite template illustration retired as one complete assembly'};continue;}
    const frameSize=view.externalPptx||{},frame=node.geometry||{},frameArea=frame.width*frame.height/Math.max(1,frameSize.width*frameSize.height);
    const coversTitle=node.type==='image'&&frameArea>=.5&&(slide.nodes||[]).some(title=>title.type==='text'&&(title.semanticRole==='title'||title.nativeRef?.shapeType?.startsWith('PLACEHOLDER'))&&Number(title.zIndex)<Number(node.zIndex)&&title.geometry&&title.geometry.x<frame.x+frame.width&&title.geometry.x+title.geometry.width>frame.x&&title.geometry.y<frame.y+frame.height&&title.geometry.y+title.geometry.height>frame.y);
    if(coversTitle){node.content={...node.content,mediaRole:'old_template_content',templateSample:true,retiredDecorationBasis:'foreground raster covers the native title; design reuse does not retain unselected old report content'};continue;}
    if(node.type==='image'&&node.content.emptyContentFrame&&frame.y>=frameSize.height*.18&&frameArea>=.02&&frameArea<.4){
      node.content={...node.content,mediaRole:'old_template_content',templateSample:true,retiredDecorationBasis:'empty old content container; no new binding'};continue;
    }
    if(unreadPill(node,slide)){node.content={...node.content,mediaRole:'old_template_content',templateSample:true,retiredDecorationBasis:'unread wide picture on a title page'};continue;}
    // Raster backgrounds can contain old titles/numbers that XML cannot see.
    // Keep design tokens/vector decoration; retain raster only by explicit selection.
    if(node.type==='foreign'||node.type==='image'&&(!preserveClassifiedDesign||!KEPT_ROLES.includes(role)||carriesText(node.content)||linked(node.content))){node.content={...node.content,mediaRole:'old_template_content',templateSample:true,...(linked(node.content)?{retiredDecorationBasis:'linked picture of the old deck'}:{})};if(linked(node.content))linkedRetired.push({id:node.id,href:node.content.href});continue;}
    const size=view.externalPptx || {},g=node.geometry || {};
    const dataRules=node.type==='shape'&&g.height>0&&g.height<Number(size.height)*.01&&(slide.nodes||[]).some(owner=>['table','chart'].includes(owner.type)&&!fixedIds.has(owner.id)&&owner.geometry&&Math.abs(owner.geometry.x-g.x)<91440&&Math.abs(owner.geometry.width-g.width)<91440&&g.y>=owner.geometry.y&&g.y<Number(size.height)*.94);
    if(dataRules){node.content={...node.content,mediaRole:'old_template_content',templateSample:true,retiredDecorationBasis:'aligned horizontal rules of an unselected old data object'};continue;}
    const area=g.width*g.height/Math.max(1,size.width*size.height);
    const sideBackground=(g.x<=size.width*.035 || g.x+g.width>=size.width*.965) && g.y<=size.height*.035 && g.height>=size.height*.9 && g.width>=size.width*.25 && g.width<=size.width*.55;
    const background=role==='template_decoration' || area>=.8 || sideBackground;
    const foregroundPicture=node.type==='image' && !background && !['template_icon','template_artwork'].includes(role) && area>.005;
    const opaqueContent=node.type==='foreign' && !background && area>.005;
    // A certified photo or painting in a content position stays in the design
    // view; which pages show it is the slot rule's decision (2026-11-02).
    if (!node.content.mustPreserve && (['chart','table'].includes(node.type) || contentImageIds.has(node.id)&&!pictureCertificate(node.content) || foregroundPicture || opaqueContent))
      node.content = { ...node.content, mediaRole: 'old_template_content', templateSample: true };
  }
  unchecked+=view.deck.slides.flatMap(slide=>slide.nodes||[]).filter(node=>node.type==='image'&&node.content?.mediaRole!=='old_template_content'&&textUnchecked(node.content)).length;
  // Masters and layouts paint every slide that uses them, outside the page
  // model: an old footer, date, company name or picture would reach every
  // page of the new deck. Their text is cleared and their pictures removed,
  // unless the user keeps them or a picture is decoration without text
  // (report 84f9e527, gap 1).
  const inherited=view.externalPptx?.inherited||[];
  const asNode=item=>({id:item.key,type:item.kind,geometry:{x:item.x,y:item.y,width:item.width,height:item.height},content:{dataUrl:item.dataUrl,imageSha256:item.imageSha256,text:item.text,href:item.href,ocr:item.ocr,pixels:item.pixels}});
  const at=item=>({scope:item.scope,masterIndex:item.masterIndex,layoutIndex:item.layoutIndex,shapeId:item.shapeId,key:item.key});
  const inheritedActions=inherited.filter(item=>!fixedIds.has(item.key)).flatMap(item=>{
    // A colour layer is the layout's design; only a promotion moves it (Fable G1).
    if(item.kind==='fill')return[];
    if(item.kind==='text')return[{...at(item),action:'clear_text'}];
    const owner={nodes:inherited.filter(other=>other.scope===item.scope&&other.masterIndex===item.masterIndex&&other.layoutIndex===item.layoutIndex).map(asNode)};
    const role=preserveClassifiedDesign&&roleFor?roleFor(asNode(item),owner,view.externalPptx):null,kept=KEPT_ROLES.includes(role)&&!carriesText(item)&&!linked(item);
    if(kept&&textUnchecked(item))unchecked++;
    if(!kept&&linked(item))linkedRetired.push({id:item.key,href:item.href});
    return kept?[]:[{...at(item),action:'remove'}];
  });
  // Whether unread pictures lack an OCR program or failed to read; the gate
  // lists them, it never blocks or retires them for it (Fable 2026-10-26).
  const reads=[...view.deck.slides.flatMap(slide=>slide.nodes||[]).map(node=>node.content?.ocr),...inherited.map(item=>item.ocr)].filter(Boolean);
  const imageTextReader=reads.some(ocr=>ocr.status==='unavailable')?'tesseract_missing':reads.some(ocr=>ocr.status==='failed')?'failed':'ok';
  if(view.externalPptx)view.externalPptx={...view.externalPptx,inheritedActions,imageTextUnchecked:unchecked,imageTextReader,linkedPicturesRetired:linkedRetired};
  return view;
}

export function isOrdinalSequence(nodes) {
  const candidates=nodes.filter(node=>node.type==='text' && /^\s*\d{1,2}\s*$/u.test(node.content?.text || ''));
  const numbers=candidates.map(node=>Number(node.content.text));
  return candidates.length>=2 && new Set(numbers).size===numbers.length && numbers.every(n=>n>=1 && n<=numbers.length)
    ? new Set(candidates.map(node=>node.id)) : new Set();
}

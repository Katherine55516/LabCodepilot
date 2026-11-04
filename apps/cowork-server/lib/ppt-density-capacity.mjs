import {processCardPlan} from './ppt-process-cards.mjs';
import {titleLanguageMode} from './ppt-generation-policy.mjs';
import {sourceReadingContinuation} from './ppt-source-continuations.mjs';
import {validGraphProjection} from './ppt-ascii-graph.mjs';
import {supportsSourceLineRanges,sourceLineRange,materializeSourceLineRange} from './ppt-source-line-ranges.mjs';
import { sourceDisplayText, sourceRichText, richTextContent } from './ppt-source-text.mjs';
import {ensureRichContent,richBraceLegend,braceLegendText} from './ppt-rich-text.mjs';
import {readingUnits} from './ppt-semantic-relations.mjs';
import {stableId} from './ppt/ir.mjs';
import { orderedSourceSteps } from './ppt-source-boundaries.mjs';
import { templateMediaRole } from './ppt-template-fidelity.mjs';
import { cardsFlow } from './ppt-flow.mjs';
/** Shared geometry/line estimator for page planning and source-owned rendering.
 * A fit is an analytic prediction; final Render Tree/PPTX QA remains mandatory. */
import { measureText, textContract, PT_EMU, RENDER_CONTRACT_VERSION, CODE_FONT_FLOOR_PT } from './ppt/render-contract.mjs';
import { chooseTableDiagram, tableDiagramComponent, diagramCardPlan } from './ppt-diagram-cards.mjs';
import {relationalComponent,relationalTableComponent} from './ppt-relational-diagram.mjs';
export { CODE_FONT_FLOOR_PT };
import { displayUnits } from './ppt-density-profile.mjs';
import { equationContent, equationDimensions } from './ppt-math.mjs';
import {chooseLayout,regionsFor,typographyFor} from './ppt-layout.mjs';
export const INCH = 914400;
export const protectedTemplateAsset = node => Boolean(node?.content?.mustPreserve || ['evidence','semanticDiagram','source','brand'].includes(node?.content?.mediaRole));
/** The title translation band under a card page's title, in points. */
export const TITLE_BAND_PT=14*1.25+6;
/** Whether a card page title carries a translation: its titlePair, its
 * titleSecondary, or an "English | 中文" title not yet split. */
export const translatedTitle=slide=>Boolean(slide?.titlePair?.secondary||slide?.titleSecondary||/\p{Script=Han}/u.test(String(slide?.title||''))&&/[A-Za-z]/u.test(String(slide?.title||''))&&/\s[|｜]\s/u.test(String(slide?.title||'')));
/** The title translation band is reserved only when titles show both
 * languages (the user, 2026-10-24: primary-language titles by default). */
export const titleBandReserved=(project,slide)=>titleLanguageMode(project)==='both'&&translatedTitle(slide);
/** A card's lead takes the same band on a theme page (the hand deck, Fable G4). */
export const leadBandReserved=(project,slide)=>cardsFlow(project)&&Boolean(String(slide?.lead||'').trim());
/** Where a card page shows its section label when its template page has no
 * section slot (Fable 2026-10-26, live alpha/pdf on GPH tpl8: the title sat
 * at the top edge, no label fit above it and the page showed none): above the
 * title when that band is free, else (a content card) in the band under the
 * title and its translation, which contentCanvas reserves; null when neither
 * is free. Measured on the template page's own frames, as the scheduler sees them. */
export function derivedSectionLabelFrame(project,index){
 const fidelity=project.templateFidelity,spec=fidelity?.slides?.[index];
 if(!spec||index===0||(spec.slots||[]).some(slot=>slot.role==='section'))return null;
 const title=(spec.nodes||[]).find(node=>node.geometry&&(spec.slots||[]).some(slot=>slot.role==='title'&&String(slot.shapeId)===String(node.nativeRef?.shapeId)));
 if(!title)return null;
 const pt=Number(project.templateSpec?.fonts?.sectionSizePt)||11,g=title.geometry,height=Math.round((pt*1.18+7.2+1)*PT_EMU);
 const area=Number(fidelity.width)*Number(fidelity.height),pageHeight=Number(fidelity.height);
 // A band stops short of an object to its right (GPH tpl8: a photo from 6 in)
 // while 1.5 in stays free; an object at its start blocks it.
 const fit=frame=>{
  if(frame.y<0||frame.y+frame.height>pageHeight)return null;
  const hits=(spec.nodes||[]).filter(n=>n!==title&&n.geometry&&n.geometry.width*n.geometry.height<area*.5&&n.type!=='text'&&n.geometry.x<frame.x+frame.width&&n.geometry.x+n.geometry.width>frame.x&&n.geometry.y<frame.y+frame.height&&n.geometry.y+n.geometry.height>frame.y);
  if(!hits.length)return frame;
  if(hits.some(n=>n.geometry.x<=frame.x))return null;
  const width=Math.min(...hits.map(n=>n.geometry.x))-frame.x-Math.round(INCH*.08);
  return width>=1.5*INCH?{...frame,width}:null;
 };
 const above=fit({x:g.x,y:g.y-height-Math.round(PT_EMU*4),width:g.width,height});
 if(above)return{position:'above',geometry:above,fontSizePt:pt};
 const outline=project.outline?.[index];
 if(!cardsFlow(project)||outline?.cardFrame==='divider')return null;
 // Under the title's line as contentCanvas measures it, and under its translation band.
 const margins=title.nativeTextFrame?.margins||[0,0,0,0],lines=Math.max(1,title.nativeTextFrame?.paragraphs?.length||1);
 const textHeight=Number(title.style?.fontSizePt||24)*1.25/72*INCH*lines+(Number(margins[1])||0)+(Number(margins[3])||0);
 const band=titleBandReserved(project,outline)||leadBandReserved(project,outline)?TITLE_BAND_PT/72*INCH+INCH*.08:0;
 const below=fit({x:g.x,y:Math.round(g.y+Math.max(g.height,textHeight)+INCH*.08+band),width:g.width,height});
 return below?{position:'below',geometry:below,fontSizePt:pt}:null;
}
export function contentCanvas(project = {}, index = 1) {
  const fidelity = project.templateFidelity;
  const spec = fidelity?.slides?.[index];
  const validBox = box => box && ['x','y','width','height'].every(key=>Number.isFinite(box[key])) && box.width>0 && box.height>0;
  // A footer/brand label is not the page's body region. In design-only
  // templates it may be the only non-title text after the old report retires.
  const frames = (spec?.nodes || []).filter(node => validBox(node.geometry) && spec.slots?.some(slot => slot.role === 'content' && !['footnote','group-heading','label'].includes(slot.purpose) && slot.shapeId === node.nativeRef?.shapeId));
  const width = Number(fidelity?.width || project.templateSpec?.width || 12192000);
  const height = Number(fidelity?.height || project.templateSpec?.height || 6858000);
  const fonts = frames.filter(node=>(node.style?.fontWeight||400)<600).map(node=>Number(node.style?.fontSizePt)).filter(pt=>Number.isFinite(pt)&&pt>0);
  const pageId=(project.outline?.[index]||project.deck?.slides?.[index])?.id;
  const fontSizePt = Math.max(14, fonts.length ? Math.min(...fonts) : 18,Number(project.sourceFontFloors?.[pageId])||0);
  let left=width*.065, right=width*.935, top=height*.25, bottom=height*.93;
  // A mapped cover reserves its centered title/eyebrow before source-owned
  // body copy is bound. The generic content canvas overlaps those headers.
  const page=project.deck?.slides?.[index]||project.outline?.[index];
  if(!spec&&page&&chooseLayout(page,index,project.pages||project.outline?.length||1)==='cover'){
    const body=regionsFor({...page,layoutId:'cover'}).find(region=>region.id==='body');
    left=body.x*INCH;right=(body.x+body.w)*INCH;top=body.y*INCH;bottom=(body.y+body.h)*INCH;
  }
  if(!spec){
    const headerPage=page||{layoutId:'summary'};
    // Plan with the actual title ink and footer, before source pagination.
    // Render-time title growth cannot borrow space already assigned to code,
    // a table or another immutable source object.
    const layoutId=chooseLayout(headerPage,index,project.pages||project.outline?.length||project.deck?.slides?.length||3);
    const regions=regionsFor({...headerPage,layoutId}),region=regions.find(r=>r.id==='title'),footer=regions.find(r=>r.id==='footer');
    if(region){
      const node=headerPage.nodes?.find(n=>n.semanticRole==='title'),font=typographyFor({...headerPage,layoutId}).titlePt;
      const title={kind:'text',semanticRole:'title',bounds:node?.geometry||{x:region.x*INCH,y:region.y*INCH,width:region.w*INCH,height:region.h*INCH},content:node?.content||{text:headerPage.title||''},style:{fontFamily:project.templateSpec?.fonts?.title,fontSizePt:Math.round(font*(project.deck?.themeTokens?.titleScale||1)*10)/10,lineHeight:1.05,paragraphSpacingEm:0,fontWeight:700,...node?.style}};
      const contract=textContract(title),measured=measureText(title,contract);
      const inkHeight=!measured.widthOverflow&&measured.lines<=2?Math.ceil((measured.estimatedHeightPt+contract.margins[1]+contract.margins[3]+1)*PT_EMU):title.bounds.height;
      top=Math.max(top,title.bounds.y+Math.max(title.bounds.height,inkHeight)+INCH*.08);
    }
    if(footer)bottom=Math.min(bottom,footer.y*INCH-INCH*.08);
  }
  if(frames.length){
    left=Math.max(0,Math.min(...frames.map(node=>node.geometry.x)));
    right=Math.min(width,Math.max(...frames.map(node=>node.geometry.x+node.geometry.width)));
    top=Math.max(0,Math.min(...frames.map(node=>node.geometry.y)));
    bottom=Math.min(height,Math.max(...frames.map(node=>node.geometry.y+node.geometry.height)));
    // Source-owned components may use free vertical space in the content
    // region. A short legacy textbox is not a limit on a complete table/math
    // object. Keep its horizontal design and all title/footer/image zones.
    const richSource=String(project.source?.text||'').length>=8000;
    if(richSource){
      // Reserve real native title/section/footer geometry below, rather than
      // discarding the entire top quarter even when the header ends earlier.
      top=Math.min(top,height*.065);bottom=Math.max(bottom,height*.93);
    }else if(cardsFlow(project)&&index>0&&!(project.outline?.[index]||page)?.cardFrame&&(project.outline?.[index]||page)?.role!=='closing'){
      // A content card leaves the template's sample pictures out, so its points
      // start under the title, not where the template's body text sat below a
      // picture (demo 2026-10-31: cards at 45-80% and 75-86%, an empty band
      // above). Only the top moves: the frame's bottom and the chapter,
      // takeaway and closing pages keep their template design.
      top=Math.min(top,height*.065);
    }
  }
  // Every template page reserves its title, section and footer, with or
  // without content slots (live alpha/pdf on GPH tpl3/39/41: a title-only
  // page kept the default canvas, and the points ran over its title).
  if(spec){
    const gap=INCH*.08;
    // A card deck retires a banner (regionArtwork) when cutting above it would
    // leave the content under 65% of its region (Fable review r11, fz p2/p7:
    // an empty orange callout under a 2.9 in canvas).
    const cards=cardsFlow(project),bannerCut=g=>cards&&g.y-gap-top<.65*(bottom-top);
    for(const node of spec.nodes||[]){
      if(!validBox(node.geometry))continue;
      const slot=spec.slots?.find(slot=>slot.shapeId===node.nativeRef?.shapeId);
      const header=['title','section'].includes(slot?.role),footer=slot?.purpose==='footnote'||node.semanticRole==='page-number';
      const g=node.geometry;
      const banner=node.type==='image' && g.width>=width*.8 && g.height<height*.3 && g.y>height*.5 && !bannerCut(g);
      if(!header&&!footer&&!banner)continue;
      if(g.x+g.width<=left||g.x>=right)continue;
      if(header && g.y<(top+bottom)/2) {
        // Native title boxes often intentionally allow text to extend beyond
        // their tiny shape height. Reserve the actual line plus native padding,
        // including fallback font metrics, before adding a table underneath.
        const margins=node.nativeTextFrame?.margins||[0,0,0,0];
        const linePt=Number(node.style?.fontSizePt||slot.fontSizePt||24)*1.25;
        const lineCount=Math.max(1,node.nativeTextFrame?.paragraphs?.length||1);
        const textHeight=linePt/72*INCH*lineCount+(Number(margins[1])||0)+(Number(margins[3])||0);
        const headerBottom=g.y+Math.max(g.height,textHeight);
        if(headerBottom>top-gap)top=Math.max(top,headerBottom+gap);
        // A bilingual card page shows its title translation in a band under the
        // title (Fable review fz-r15): the canvas starts below that band.
        // Read from every form the translation takes along the pipeline, so the
        // outline, confirmation and generation measure the same canvas (live
        // mlq-r17: the table fonts were planned before titlePair existed).
        if(slot?.role==="title"&&cards&&index>0&&(titleBandReserved(project,project.outline?.[index])||leadBandReserved(project,project.outline?.[index])))top=Math.max(top,headerBottom+gap+TITLE_BAND_PT/72*INCH+gap);
        // A section label folded under the title (derivedSectionLabelFrame) keeps its band.
        if(slot?.role==="title"&&cards&&index>0){const label=derivedSectionLabelFrame(project,index);if(label?.position==='below')top=Math.max(top,label.geometry.y+label.geometry.height+gap);}
      }
      if((footer||banner) && g.y>top && g.y<bottom+gap)bottom=Math.min(bottom,g.y-gap);
    }
  }
  // Explicit evidence/brand assets are occupied space, not reclaimable old
  // examples. Select a rectangular free region rather than hiding the asset.
  const clearance=INCH*.08;
  for(const node of (spec?.nodes || []).filter(node=>protectedTemplateAsset(node)||node.type==='foreign'&&!(node.content?.templateSample&&node.content?.mediaRole==='old_template_content'&&['design_only','keep_fixed'].includes(project.templateContentMode))||node.type==='image'&&templateMediaRole(node,spec,fidelity)==='unknown')){
    if(!validBox(node.geometry))continue;
    const g=node.geometry;if(g.x>=right||g.x+g.width<=left||g.y>=bottom||g.y+g.height<=top)continue;
    const choices=[{l:left,r:Math.min(right,g.x-clearance),t:top,b:bottom},{l:Math.max(left,g.x+g.width+clearance),r:right,t:top,b:bottom},
      {l:left,r:right,t:top,b:Math.min(bottom,g.y-clearance)},{l:left,r:right,t:Math.max(top,g.y+g.height+clearance),b:bottom}]
      .filter(c=>c.r>c.l&&c.b>c.t).sort((a,b)=>(b.r-b.l)*(b.b-b.t)-(a.r-a.l)*(a.b-a.t));
    if(!choices.length){right=left;bottom=top;break;}
    const c=choices[0];left=c.l;right=c.r;top=c.t;bottom=c.b;
  }
  // A card page keeps its bottom band for the page number (user decision
  // 2026-10-24; r25: object page content met the number at the bottom right).
  if(cardsFlow(project)&&index>0&&fidelity?.height){const limit=fidelity.height-Math.round(.66*INCH);if(bottom>limit)bottom=limit;}
  const continuation=sourceReadingContinuation(project,index);
  const continuationRect=continuation?{x:Math.round(left),y:Math.round(bottom-INCH*.42),width:Math.max(0,Math.round(right-left)),height:Math.round(INCH*.42)}:undefined;
  if(continuation)bottom-=INCH*.5;
  return { continuationRect,geometry:{x:Math.round(left),y:Math.round(top),width:Math.max(0,Math.round(right-left)),height:Math.max(0,Math.round(bottom-top))},fontSizePt,
    capacityBasis:frames.length?'native_frame_geometry':'default_canvas_before_template_parse' };
}
/** Monospace code and literal drawings have their own readable floor (P0-3):
 * a listing keeps its line structure at up to the page font, and steps down
 * (never below CODE_FONT_FLOOR_PT) until its lines stop wrapping or, for a
 * layout-preserving drawing, until its widest line fits the frame. A listing
 * that would still overflow vertically may use down to 12pt to stay on one
 * page; otherwise the measured line paginator splits it. */
function codeFontSize(component,geometry,fontSizePt){
  const source=String(component.content?.text||'').split('\n').length,preserve=component.content?.codeBlock?.preserveLayout;
  const measure=pt=>{const e={kind:'text',bounds:{...geometry,height:1e12},content:component.content,style:{fontSizePt:pt,lineHeight:1.18}};return measureText(e,textContract(e));};
  let chosen=null;
  for(let pt=Math.floor(fontSizePt);pt>=CODE_FONT_FLOOR_PT;pt--){const m=measure(pt);if(preserve?!m.widthOverflow:m.lines<=source+.01){chosen=pt;break;}}
  // Nothing fits even at the floor: keep the page font (unchanged legacy
  // behaviour) and let the measured line paginator or a transform decide.
  if(chosen===null)return fontSizePt;
  // The chosen font must hold the same frame padding that measureComponent
  // returns. Ignoring these 7.2pt made a slightly taller frame keep a larger
  // font and overflow, while a shorter frame shrank and passed instead.
  const fitsHeight=pt=>(measure(pt).estimatedHeightPt+7.2)*PT_EMU<=geometry.height;
  if(!fitsHeight(chosen))for(let pt=chosen-1;pt>=Math.max(12,CODE_FONT_FLOOR_PT);pt--)if(fitsHeight(pt))return pt;
  return chosen===Math.floor(fontSizePt)?fontSizePt:chosen;
}
const tableFitCache=new Map();
export function measureComponent(component, geometry, fontSizePt) {
  if(component.type==='chart')return {lines:0,height:Math.round(INCH*2.8),overflow:false};
  // A table may carry its own smaller font (a row taller than any page at the
  // body font; Fable review r16): it is measured and styled at that size.
  if(component.type==='table'&&Number(component.tableFontPt)>0&&component.tableFontPt<fontSizePt){
    const own=measureComponent({...component,tableFontPt:undefined},geometry,component.tableFontPt);
    return {...own,fontSizePt:component.tableFontPt,fontBasis:'table_row_font_ladder'};
  }
  // An object page's explanation stepped to 13/12 pt so no single point
  // continues alone (Fable r19 D): measured and styled at that size.
  // An object page's explanation grown to 16/15 pt beside its objects (Fable plan T16) is measured the same way.
  if(component.type==='text'&&Number(component.ladderFontPt)>0&&component.ladderFontPt!==fontSizePt){
    const own=measureComponent({...component,ladderFontPt:undefined},geometry,component.ladderFontPt);
    return {...own,fontSizePt:component.ladderFontPt,fontBasis:component.braceLegendOf?'formula_legend':component.ladderFontPt<fontSizePt?'continuation_font_ladder':'explanation_growth'};
  }
  const horizontalPaddingPt = component.type === 'table' ? 14.4 : 7.2;
  const lineUnits = Math.max(0, geometry.width / INCH * 72 - horizontalPaddingPt) / fontSizePt * .88;
  if (!(lineUnits > 0)) return { lines: Infinity, height: Infinity, overflow: true };
  const linesOf = text => String(text || '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(displayUnits(line) / lineUnits)), 0);
  let lines, columnWeights, rowWeights;
  if (component.type === 'table') {
    const rows = component.content.rows || [];
    if (!rows.length || !rows[0].length || rows.some(row => row.length !== rows[0].length)) throw new Error('invalid source table geometry');
    const weights=rows[0].map((_,col)=>Math.max(12,...rows.map(row=>Math.sqrt(displayUnits(row[col]))*4)));
    // "Data/problem" and "LightGBM/v2.1" wrap as one word in PowerPoint (Fable,
    // 2026-10-26; 3143 g2v page 13: "Data/proble m").
    const wordWidths=rows[0].map((_,col)=>Math.max(0,...rows.flatMap(row=>String(row[col]).match(/[A-Za-z][A-Za-z0-9_\-/.]*[A-Za-z0-9]|[A-Za-z]/gu)||[]).map(word=>displayUnits(word)*fontSizePt/.88+14.4)));
    const totalPt=geometry.width/INCH*72,minPt=fontSizePt*2+14.4;
    const evaluate=allocation=>{
      const sum=allocation.reduce((n,v)=>n+v,0);
      const rowHeights=rows.map((row,r)=>Math.max(...row.map((cell,col)=>{
        const e={kind:'text',content:{text:String(cell),richText:component.content.cellRich?.[r]?.[col]},style:{fontSizePt,lineHeight:1.18,paragraphSpacingEm:0},bounds:{width:geometry.width*allocation[col]/sum,height:1e12}};
        return measureText(e,textContract(e,[7.2,3,7.2,3])).estimatedHeightPt+6;
      })));
      const brokenWords=allocation.reduce((n,w,col)=>n+Math.max(0,wordWidths[col]-totalPt*w/sum),0);
      return {columnWeights:allocation,rowWeights:rowHeights,heightPt:rowHeights.reduce((sum,v)=>sum+v,0),brokenWords};
    };
    const minimum=wordWidths.map(width=>Math.max(minPt,width)),remaining=Math.max(0,totalPt-minimum.reduce((n,v)=>n+v,0));
    const strategies=[weights,rows[0].map(()=>1),minimum.map((width,col)=>width+remaining*weights[col]/weights.reduce((n,v)=>n+v,0))];
    const cacheKey=JSON.stringify([RENDER_CONTRACT_VERSION,rows,component.content.cellRich,geometry.width,fontSizePt]);
    let measured=tableFitCache.get(cacheKey);
    if(!measured){
      const better=(a,b)=>Number(a.brokenWords>0)-Number(b.brokenWords>0)||a.heightPt-b.heightPt;
      measured=strategies.map(evaluate).sort(better)[0];
      // The same fixed cells may need unequal columns. Search legal widths
      // before declaring overflow; word minima and the font remain unchanged.
      let allocation=measured.columnWeights.map(w=>w/measured.columnWeights.reduce((a,b)=>a+b,0)*totalPt);
      for(const step of [totalPt*.08,totalPt*.04,totalPt*.02])for(let pass=0;pass<2;pass++){
        let changed=false;
        for(let from=0;from<allocation.length;from++)for(let to=0;to<allocation.length;to++){
          if(from===to||allocation[from]-step<Math.min(minimum[from],totalPt/allocation.length))continue;
          const next=[...allocation];next[from]-=step;next[to]+=step;const trial=evaluate(next);
          if(better(trial,measured)<0){allocation=next;measured=trial;changed=true;}
        }
        if(!changed)break;
      }
      if(tableFitCache.size>=256)tableFitCache.delete(tableFitCache.keys().next().value);tableFitCache.set(cacheKey,measured);
    }
    columnWeights=measured.columnWeights;rowWeights=measured.rowWeights;
    const height=Math.ceil(rowWeights.reduce((sum,v)=>sum+v,0)*PT_EMU);
    return {lines:rowWeights.reduce((sum,v)=>sum+v/(fontSizePt*1.18),0),height,lineUnits,columnWeights,rowWeights,overflow:height>geometry.height};
  } else if(component.type==='image') {
    const ratio=Math.max(.05,Number(component.content?.width||1)/Number(component.content?.height||1));
    return {lines:0,height:Math.ceil(Math.min(geometry.height*.7,geometry.width/ratio)),lineUnits,overflow:false};
  } else if (['list', 'timeline'].includes(component.type)) {
    const cards=component.type==='timeline'&&component.content.processCardsEnabled?processCardPlan(component.content,geometry,fontSizePt):component.type==='list'&&component.content.diagram?diagramCardPlan(component.content,geometry,fontSizePt):null;
    if(cards)return {lines:cards.requiredHeight/PT_EMU/fontSizePt,height:cards.requiredHeight,lineUnits,overflow:cards.overflow,processCards:true};
    const e={kind:component.type,bounds:{...geometry,height:1e12},content:component.content,style:{fontSizePt,lineHeight:1.18,paragraphSpacingEm:component.type==='timeline'?.15:.4}};
    const measured=measureText(e,textContract(e));
    // Actual CJK inline OMML ink exceeded the conservative frame by 1.38pt.
    // Reserve 2pt before pagination; retain the template font and all source.
    const mathInk=(component.content.items||[]).some(item=>(item.richText?.runs||[]).some(run=>run.kind==='math'))?2:0;
    return {lines:measured.lines,height:Math.ceil((measured.estimatedHeightPt+7.2+mathInk)*PT_EMU),lineUnits,overflow:(measured.estimatedHeightPt+mathInk)*PT_EMU>geometry.height};
  } else if(component.content?.mathMl) {
    const dimensions=equationDimensions(component.content,fontSizePt);
    const width=Math.ceil(dimensions.widthPt/72*INCH),height=Math.ceil(dimensions.heightPt/72*INCH);
    return {lines:dimensions.heightPt/fontSizePt,width,height,lineUnits,overflow:width>geometry.width||height>geometry.height};
  } else {
    const codePt=component.content?.codeBlock?codeFontSize(component,geometry,fontSizePt):fontSizePt;
    const e={kind:'text',bounds:{...geometry,height:1e12},content:component.content,style:{fontSizePt:codePt,lineHeight:1.18}};
    const measured=measureText(e,textContract(e));
    const width=component.content?.codeBlock?.preserveLayout?Math.ceil(measured.requiredWidthPt*PT_EMU):undefined;
    return {lines:measured.lines,height:Math.ceil((measured.estimatedHeightPt+7.2)*PT_EMU),lineUnits,...(width?{width}:{}),...(codePt!==fontSizePt?{fontSizePt:codePt,fontBasis:'monospace_code_floor'}:{}),overflow:measured.widthOverflow||measured.estimatedHeightPt*PT_EMU>geometry.height};
  }
  const height = Math.ceil((lines * fontSizePt * 1.18 + 7.2) / 72 * INCH);
  return { lines, height, lineUnits, columnWeights, rowWeights, overflow: height > geometry.height };
}
function componentText(component) {
  const content=component?.content||{};
  return [content.text,...(content.items||[]).map(item=>item?.text||'')].filter(Boolean).join('\n');
}
/** Dominant script of a prose component (null when too short to tell). */
function componentLanguage(component) {
  if(!isProse(component))return null;
  const text=componentText(component),han=(text.match(/\p{Script=Han}/gu)||[]).length,latin=(text.match(/[A-Za-z]/gu)||[]).length;
  return han+latin<8?null:han*2>=latin?'cjk':'latin';
}
function isProse(component){return ['text','list'].includes(component?.type)&&!component.content?.codeBlock&&!component.content?.mathMl;}
/** Down-then-across order of boxes equals the source order. */
export function preservesReadingOrder(boxes){
  const order=boxes.map((box,i)=>({i,x:box.x,y:box.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
  return order.every((item,position)=>item.i===position);
}
/** Source pair IDs decide; unlabelled text pairs only when both the scripts
 * differ and the lengths/shared Latin tokens look like a translation. */
function translationPair(a,b,languageA,languageB){
  if(!a||!b||!isProse(a)||!isProse(b))return false;
  if(a.pairId||b.pairId)return Boolean(a.pairId&&a.pairId===b.pairId);
  if(!languageA||!languageB||languageA===languageB)return false;
  const [latin,cjk]=languageA==='latin'?[componentText(a),componentText(b)]:[componentText(b),componentText(a)];
  const ratio=latin.length/Math.max(1,(cjk.match(/\p{Script=Han}/gu)||[]).length*2.6+(cjk.match(/[A-Za-z0-9]/gu)||[]).length);
  const tokens=text=>new Set((text.match(/[A-Za-z][A-Za-z0-9_]{1,}|\d+(?:[.,]\d+)*/gu)||[]).map(t=>t.toLowerCase()));
  const shared=[...tokens(cjk)].filter(t=>tokens(latin).has(t)).length,cjkTokens=tokens(cjk).size;
  return ratio>.55&&ratio<1.8&&(!cjkTokens||shared/cjkTokens>=.5);
}
const readability=candidate=>candidate.layoutId==='bilingual-rows-source'?2:candidate.readingOrder?1:0;
export function fitComponents(components, project = {}, index = 1, options = {}) {
  const fit=fitComponentsNative(components,project,index,options);
  if(fit.capacity_ok||options.relationalFallback===false||project.deck?.slides?.[index]?.locked||Number(project.editing?.epochs?.[project.outline?.[index]?.id]||0)>0)return fit;
  const fallback=components.map(c=>relationalTableComponent(c)||c);
  if(fallback.every((c,i)=>c===components[i]))return fit;
  const tableFit=fitComponentsNative(fallback,project,index,{...options,relationalFallback:false});
  return tableFit.capacity_ok?{...tableFit,componentFallbacks:fallback.flatMap((component,index)=>component===components[index]?[]:[{index,component}])}:fit;
}
function fitComponentsNative(components, project = {}, index = 1, options = {}) {
  const { geometry: originalCanvas, fontSizePt: defaultFont, capacityBasis } = contentCanvas(project, index);
  const canvas=options.canvas||originalCanvas;
  if(options.canvas&&(!['x','y','width','height'].every(k=>Number.isFinite(canvas[k]))||canvas.width<=0||canvas.height<=0||canvas.x<originalCanvas.x||canvas.y<originalCanvas.y||canvas.x+canvas.width>originalCanvas.x+originalCanvas.width||canvas.y+canvas.height>originalCanvas.y+originalCanvas.height))throw Error('invalid constrained source canvas');
  // A merge proposal must not gain capacity by shrinking already visible type.
  const declaredFloor=Math.max(0,...components.map(c=>Number(c.fontSizePt)||0));
  const pageId=project.outline?.[index]?.id;
  const mayAdapt=options.boundedTypography===true&&project.generationPolicy?.sourceTypography==='bounded'&&Number(project.editing?.epochs?.[pageId]||0)===0&&!components.some(c=>c.locked||c.userGeometry||c.userStyle)&&!project.deck?.slides?.[index]?.locked;
  const roleFloor=project.templateFidelity?.mode==='preserve'?Math.min(defaultFont,16):16;
  const minimumFont=Math.max(roleFloor,Math.ceil(defaultFont*.9*10)/10,declaredFloor,Number(project.sourceFontFloors?.[pageId])||0);
  const requestedFont=Number(options.fontSizePt)||defaultFont;
  if(options.boundedTypography&&(!mayAdapt||requestedFont<minimumFont||requestedFont>defaultFont))throw Error('invalid bounded source typography fit');
  const fontSizePt=mayAdapt?requestedFont:Math.max(defaultFont,requestedFont,declaredFloor);
  const fontAdaptation=fontSizePt<defaultFont?{version:1,basis:'authorized_bounded_source_typography',originalFontSizePt:defaultFont,fontSizePt,minimumFontSizePt:minimumFont,maxReduction:.1}:null;
  if(!components.length||canvas.width<=0||canvas.height<=0){
    const availableHeight=Math.max(0,canvas.height),predictedOverflow=components.length?INCH:0;
    return {capacity_ok:false,predictedOverflow,availableHeight,usedHeight:availableHeight+predictedOverflow,fontSizePt,canvas,boxes:[],measurements:[],capacityBasis,measurementBasis:components.length?'invalid_content_geometry':'missing_display_plan'};
  }
  const oneFragmentedList=components.length>1&&typeof components[0].sourceUnitId==='string'&&components.every(c=>c.type==='list'&&c.itemFragment&&c.sourceUnitId===components[0].sourceUnitId);
  // Each split list point already retains its measured paragraph spacing and
  // text-frame padding. A second outer object gap is optional, not a font or
  // content requirement; remove only that duplicate gap if the full list needs it.
  const gapInches=options.gapInches===0&&oneFragmentedList?0:options.gapInches===.12?.12:.16;
  const gap = Math.round(INCH * gapInches),itemGap=gap;
  const candidates = [];
  const languages=components.map(componentLanguage);
  const atomicPairs=[];
  for(let i=0;i<components.length-1;i++)if(translationPair(components[i],components[i+1],languages[i],languages[i+1])){atomicPairs.push([i,i+1]);i++;}
  const atomicGroups=new Map();components.forEach((c,i)=>{if(c.readingUnitId)atomicGroups.set(c.readingUnitId,[...(atomicGroups.get(c.readingUnitId)||[]),i]);});
  const ordered=components.some(c=>c.type==='timeline');
  // A relationship diagram is already a layout of cards. Packing that whole
  // diagram into a text column nests two column systems and can create a
  // false capacity failure. Reserve a full-width row for it, with measured
  // supporting text rows before/after in the original reading order.
  if(!ordered&&components.length>1&&components.some(c=>c.content?.diagram?.relational))for(const columns of [1,2,3]){
    const boxes=[],measurements=[];let top=canvas.y;
    for(let at=0;at<components.length;){
      const wide=c=>Boolean(c.content?.diagram?.relational||c.type==='table'||c.content?.codeBlock);
      const row=[at++];
      if(!wide(components[row[0]]))while(at<components.length&&row.length<columns&&!wide(components[at]))row.push(at++);
      const width=(canvas.width-gap*(row.length-1))/row.length;
      let rowHeight=0;
      row.forEach((i,column)=>{const box={x:Math.round(canvas.x+column*(width+gap)),y:Math.round(top),width:Math.round(width),height:canvas.height};const m=measureComponent(components[i],box,fontSizePt);box.height=m.height;if(m.width)box.width=Math.min(box.width,m.width);boxes[i]=box;measurements[i]=m;rowHeight=Math.max(rowHeight,m.height);});
      top+=rowHeight+gap;
    }
    const usedHeight=top-gap-canvas.y;
    candidates.push({layoutId:'full-width-relation-notes',columns,readingOrder:true,boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-boxes[i].width:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
  }
  for (const columns of ordered?[1]:options.columns?[options.columns]:[1, 2, 3]) {
    if(columns>components.length || columns===3 && components.some(c=>c.type==='table'))continue;
    const widths = (canvas.width - gap * (columns - 1)) / columns;
    const heights = Array(columns).fill(0), boxes = [], measurements = [];
    for (const component of components) {
      const col = heights.indexOf(Math.min(...heights));
      const box = { x: Math.round(canvas.x + col * (widths + gap)), y: Math.round(canvas.y + heights[col]), width: Math.round(widths), height: canvas.height };
      const measurement = measureComponent(component, box, fontSizePt);
      box.height = measurement.height;
      if(measurement.width)box.width=Math.min(box.width,measurement.width);
      boxes.push(box); measurements.push(measurement); heights[col] += measurement.height + itemGap;
    }
    const usedHeight = Math.max(0, ...heights.map(h => Math.max(0, h - itemGap)));
    candidates.push({ layoutId: columns === 3 ? 'three-column-source' : columns === 2 ? 'parallel-source' : 'stacked-source', columns, boxes, measurements,
      predictedOverflow: Math.max(0, usedHeight - canvas.height,...measurements.map(m=>m.width?m.width-widths:0)), usedHeight, availableHeight: canvas.height, fontSizePt, canvas });
  }
  // Tables get a whole-width region before notes. Compare unequal widths too;
  // every candidate uses the same font, complete components and source order.
  if(!ordered && components.length>=2){
    const tableIndexes=components.map((c,i)=>c.type==='table'?i:-1).filter(i=>i>=0);
    // A leading table, or a leading code block (whose lines must not wrap),
    // takes the full width; notes share two columns below it.
    if(tableIndexes.length===1 && tableIndexes[0]===0 || !tableIndexes.length && components[0].content?.codeBlock){
      const table=measureComponent(components[0],canvas,fontSizePt);
      const boxes=[{...canvas,height:table.height}],measurements=[table];
      const heights=[table.height+gap,table.height+gap],width=(canvas.width-gap)/2;
      for(const component of components.slice(1)){
        const col=heights.indexOf(Math.min(...heights)),box={x:canvas.x+col*(width+gap),y:canvas.y+heights[col],width,height:canvas.height};
        const m=measureComponent(component,box,fontSizePt);box.height=m.height;boxes.push(box);measurements.push(m);heights[col]+=m.height+gap;
      }
      const usedHeight=Math.max(...heights)-gap;
      candidates.push({layoutId:components[0].type==='table'?'full-width-table-notes':'full-width-code-notes',boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-boxes[i].width:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
    }
    // A one-column request (a stacked table page, Fable 2026-11-01) takes no side-by-side split.
    if(components.length===2&&options.columns!==1)for(const ratio of [.35,.65,.4,.6]){
      const widths=[(canvas.width-gap)*ratio,(canvas.width-gap)*(1-ratio)];
      const measurements=components.map((c,i)=>measureComponent(c,{...canvas,width:widths[i]},fontSizePt));
      const boxes=measurements.map((m,i)=>({x:canvas.x+(i?widths[0]+gap:0),y:canvas.y,width:widths[i],height:m.height}));
      const usedHeight=Math.max(...measurements.map(m=>m.height));
      candidates.push({layoutId:'asymmetric-source',columnRatio:ratio,boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-widths[i]:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
    }
  }
  // Reading order. Shortest-column packing can put the Chinese of one
  // paragraph beside the English of the next. Translation pairs share a row
  // (one language per column); other text flows down one column, then the next.
  // A caller that asks for one column (the table of contents) gets no flow into a second one.
  if(!ordered && options.columns!==1 && components.length>=2 && !components.some(c=>c.type==='table')){
    const width=(canvas.width-gap)/2,languages=components.map(componentLanguage);
    const rows=[];for(let i=0;i<components.length;i++){
      if(translationPair(components[i],components[i+1],languages[i],languages[i+1])){rows.push([i,i+1]);i++;}else rows.push([i]);
    }
    const pairs=rows.filter(row=>row.length===2);
    if(pairs.length){
      const left=languages[pairs[0][0]],boxes=[],measurements=[];let y=canvas.y;
      for(const row of rows){
        if(row.length===2){
          const placed=row.map((i,col)=>{const box={x:Math.round(canvas.x+col*(width+gap)),y:Math.round(y),width:Math.round(width),height:canvas.height};const m=measureComponent(components[i],box,fontSizePt);box.height=m.height;return [i,box,m];});
          for(const [i,box,m] of placed){boxes[i]=box;measurements[i]=m;}
          y+=Math.max(...placed.map(([, box])=>box.height))+gap;
        }else{
          const i=row[0],box={x:canvas.x,y:Math.round(y),width:canvas.width,height:canvas.height},m=measureComponent(components[i],box,fontSizePt);
          box.height=m.height;if(m.width)box.width=Math.min(box.width,m.width);boxes[i]=box;measurements[i]=m;y+=m.height+gap;
        }
      }
      const usedHeight=Math.max(0,y-gap-canvas.y);
      candidates.push({layoutId:'bilingual-rows-source',columns:2,readingOrder:true,boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-boxes[i].width:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
    }
    const probe=components.map(c=>measureComponent(c,{...canvas,width},fontSizePt));
    let split=1,bestHeight=Infinity;
    for(let k=1;k<components.length;k++){
      if(atomicPairs.some(([a,b])=>a<k&&b>=k)||[...atomicGroups.values()].some(g=>g[0]<k&&g.at(-1)>=k))continue;
      const h=Math.max(...[probe.slice(0,k),probe.slice(k)].map(part=>part.reduce((n,m)=>n+m.height+itemGap,0)-itemGap));
      if(h<bestHeight){bestHeight=h;split=k;}
    }
    const boxes=[],heights=[0,0];
    components.forEach((c,i)=>{const col=i<split?0:1,box={x:Math.round(canvas.x+col*(width+gap)),y:Math.round(canvas.y+heights[col]),width:Math.round(width),height:probe[i].height};if(probe[i].width)box.width=Math.min(box.width,probe[i].width);boxes.push(box);heights[col]+=probe[i].height+itemGap;});
    candidates.push({layoutId:'column-flow-source',columns:2,readingOrder:true,boxes,measurements:probe,predictedOverflow:Math.max(0,bestHeight-canvas.height,...probe.map(m=>m.width?m.width-width:0)),usedHeight:bestHeight,availableHeight:canvas.height,fontSizePt,canvas});
    // A five-region interval needs more horizontal room than a short window
    // explanation. Equal columns can fail although the same complete source
    // fits legal unequal columns. Measure both frames and retain source order.
    if(components.length>=3&&components.some(c=>c.content?.diagram?.relational))for(const ratio of [.35,.4,.45,.55,.6,.65])for(let k=1;k<components.length;k++){
      if(atomicPairs.some(([a,b])=>a<k&&b>=k)||[...atomicGroups.values()].some(g=>g[0]<k&&g.at(-1)>=k))continue;
      const widths=[Math.round((canvas.width-gap)*ratio),Math.round((canvas.width-gap)*(1-ratio))],boxes=[],measurements=[],heights=[0,0];
      if(Math.min(...widths)<INCH*2)continue;
      components.forEach((component,i)=>{const col=i<k?0:1,box={x:Math.round(canvas.x+(col?widths[0]+gap:0)),y:Math.round(canvas.y+heights[col]),width:widths[col],height:canvas.height};const m=measureComponent(component,box,fontSizePt);box.height=m.height;if(m.width)box.width=Math.min(box.width,m.width);boxes[i]=box;measurements[i]=m;heights[col]+=m.height+gap;});
      const usedHeight=Math.max(...heights)-gap;
      candidates.push({layoutId:'asymmetric-column-flow-source',columns:2,columnRatio:ratio,readingOrder:true,boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-boxes[i].width:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
    }
  }
  for(const candidate of candidates){
    // A graph measured on the entire canvas may change orientation or lose
    // clearance after packing assigns its smaller final frame. Validate that
    // frame now, so planning and binding choose the same faithful fallback.
    candidate.componentCapacityFailures=components.flatMap((component,i)=>{
      // An unbreakable inline formula can exceed a text column's width while
      // the summed column height still fits (3157 world_models p16). Keep
      // this width verdict when ranking layouts; publication uses it too.
      if(candidate.measurements[i]?.overflow)return [{index:i,reason:'component_measurement_overflow',bounds:candidate.boxes[i]}];
      if(!component.content?.diagram?.relational)return [];
      const diagram=diagramCardPlan(component.content,candidate.boxes[i],fontSizePt);
      return !diagram||diagram.overflow?[{index:i,reason:'relational_final_frame',bounds:candidate.boxes[i]}]:[];
    });
    candidate.finalFrameFits=candidate.componentCapacityFailures.length===0;
    if(candidate.readingOrder===undefined)candidate.readingOrder=preservesReadingOrder(candidate.boxes);
    // A code line that wraps in a narrow column restarts at the left edge and
    // loses its indentation; count wrapped code lines per candidate.
    candidate.atomicReadingUnits=[...atomicGroups.values()].every(group=>{
      const bs=group.map(i=>candidate.boxes[i]),r={x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),right:Math.max(...bs.map(b=>b.x+b.width)),bottom:Math.max(...bs.map(b=>b.y+b.height))};
      return candidate.boxes.every((b,i)=>group.includes(i)||b.x>=r.right||b.x+b.width<=r.x||b.y>=r.bottom||b.y+b.height<=r.y);
    })&&atomicPairs.every(([a,b])=>{
      const first=candidate.boxes[a],second=candidate.boxes[b];
      return Math.abs(first.y-second.y)<2 || Math.abs(first.x-second.x)<2&&second.y>=first.y+first.height-2;
    });
    candidate.codeWraps=components.reduce((sum,component,i)=>component.content?.codeBlock?sum+Math.max(0,Math.round(candidate.measurements[i]?.lines||0)-String(component.content.text||'').split('\n').length):sum,0);
    // F-P1-9: the render contract gives every code paragraph a hanging indent,
    // so a wrap that remains continues under its own indentation.
    if(candidate.codeWraps)candidate.codeHangingIndent=true;
  }
  // Among layouts that fit: unwrapped code first, then readable order, then height.
  // Atomic pairs are a capacity constraint: overflow is preferable to a false
  // pass obtained by interleaving unrelated languages in shortest columns.
  const eligible=candidates.filter(candidate=>candidate.atomicReadingUnits&&candidate.readingOrder);
  const primaryFirst = components.length === 2 && ['table','chart','image'].includes(components[0].type) && components[1].type === 'text';
  const balancedPair = candidate => primaryFirst && candidate.layoutId === 'asymmetric-source' && candidate.columnRatio === .65 ? 1 : 0;
  const preferred=options.preferredLayoutId?eligible.filter(c=>c.layoutId===options.preferredLayoutId&&!c.predictedOverflow&&c.finalFrameFits):[];
  const best = (preferred.length?preferred:eligible.length?eligible:candidates).sort((a, b) => Number(a.predictedOverflow > 0||!a.finalFrameFits) - Number(b.predictedOverflow > 0||!b.finalFrameFits)
    || (a.predictedOverflow === 0 && b.predictedOverflow === 0 ? balancedPair(b) - balancedPair(a) : 0)
    || (a.predictedOverflow > 0 ? a.usedHeight - b.usedHeight : a.codeWraps - b.codeWraps || readability(b) - readability(a) || a.usedHeight - b.usedHeight))[0];
  if((best.predictedOverflow>0||!best.finalFrameFits)&&options.gapInches===undefined){const compact=fitComponents(components,project,index,{...options,gapInches:.12});if(compact.capacity_ok)return {...compact,spacingBasis:'measured 0.12in object gaps, unchanged text font/line spacing/source'};if(oneFragmentedList){const listFit=fitComponents(components,project,index,{...options,gapInches:0});if(listFit.capacity_ok)return {...listFit,spacingBasis:'contiguous list fragments retain native paragraph spacing and frame padding; no duplicate outer object gap'};}}
  // A single primary component plus its caption/brief explanation belongs in
  // the middle of the available region, not against an arbitrary template edge.
  if (best.predictedOverflow === 0 && components.length <= 3 && components.filter(c=>['table','image','chart'].includes(c.type)).length === 1) {
    const dy=Math.round((canvas.height-best.usedHeight)/2);
    // Stacked boxes centre one by one; side-by-side columns move as a group.
    const stacked=best.boxes.every((box,i)=>best.boxes.every((other,j)=>i===j||box.y>=other.y+other.height-1||other.y>=box.y+box.height-1));
    // Components sharing horizontal space form one column/stack. Shift that
    // group as a whole: independently centering two paragraphs overlaps them.
    const shifts=new Map(),remaining=new Set(best.boxes.map((_,i)=>i));
    while(remaining.size){
      const group=[remaining.values().next().value];remaining.delete(group[0]);
      for(let n=0;n<group.length;n++)for(const other of [...remaining]){
        const a=best.boxes[group[n]],b=best.boxes[other];
        if(Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+1){group.push(other);remaining.delete(other);}
      }
      const top=Math.min(...group.map(i=>best.boxes[i].y)),bottom=Math.max(...group.map(i=>best.boxes[i].y+best.boxes[i].height));
      const shift=Math.round(canvas.y+(canvas.height-(bottom-top))/2-top);
      for(const i of group)shifts.set(i,shift);
    }
    best.boxes.forEach((box,i)=>{
      box.y+=stacked?dy:shifts.get(i);
      if (components[i].type==='image') {
        const c=components[i].content || {},ratio=Number(c.width)/Number(c.height);
        if (ratio>0) box.width=Math.min(box.width,Math.round(box.height*ratio));
      }
      if(stacked)box.x=Math.round(canvas.x+(canvas.width-box.width)/2);
    });
    if(!stacked){
      const left=Math.min(...best.boxes.map(b=>b.x)),right=Math.max(...best.boxes.map(b=>b.x+b.width));
      const dx=Math.round(canvas.x+(canvas.width-(right-left))/2-left);
      best.boxes.forEach(box=>{box.x+=dx;});
    }
    best.balanced='centered';
  } else if(options.center&&best.predictedOverflow===0&&best.finalFrameFits&&best.boxes.length){
    // A theme card page's block sits in the middle of the content area (Fable
    // review: sparse pages had their points against the top edge).
    const top=Math.min(...best.boxes.map(box=>box.y)),bottom=Math.max(...best.boxes.map(box=>box.y+box.height));
    const dy=Math.round(canvas.y+(canvas.height-(bottom-top))/2-top);
    if(dy>0){best.boxes.forEach(box=>{box.y+=dy;});best.balanced='centered';}
  }
  // Diagnostics name only the layouts that may be used (Fable plan T9): a
  // two-column candidate that breaks reading order never reports its widths.
  const admissibleLayouts=[...new Set(eligible.map(candidate=>candidate.layoutId))];
  return { ...best,admissibleLayouts,...(admissibleLayouts.length&&admissibleLayouts.every(id=>id==='stacked-source')?{admissibleNote:'only the stacked reading-order layout keeps these sources in order'}:{}),...(fontAdaptation?{fontAdaptation}:{}), renderContractVersion:RENDER_CONTRACT_VERSION, layoutGapInches:gapInches, capacity_ok: best.finalFrameFits&&best.predictedOverflow === 0&&best.atomicReadingUnits&&best.readingOrder, capacityBasis, measurementBasis: 'shared_line_estimator',
    ...(process.env.PPT_FIT_DEBUG ? { alternatives: candidates.map(c => ({ layoutId: c.layoutId, overflow: Math.round(c.predictedOverflow / INCH * 100) / 100, used: Math.round(c.usedHeight / INCH * 100) / 100, readingOrder: c.readingOrder })) } : {}) };
}
/** A measured guidance budget, never a text truncator or an acceptance override. */
export function explanationBudget(components, project, index) {
  const source = fitComponents(components, project, index);
  if (components.length&&!source.capacity_ok) return { sourceFits: false, singleParagraphCjkCharacters: 0 };
  let low=0,high=2000;
  while(low<high){
    const middle=Math.ceil((low+high)/2);
    const fit=fitComponents([...components,{type:'text',content:{text:'字'.repeat(middle)}}],project,index);
    if(fit.capacity_ok)low=middle;else high=middle-1;
  }
  return {sourceFits:true,singleParagraphCjkCharacters:low,paragraphCount:1,
    basis:'shared_line_estimator; complete source plus one CJK paragraph; additional paragraphs consume gaps'};
}
export const isSourceArtifactItem = item => Boolean(!['notes_by_contract','excluded_by_policy'].includes(item?.presentation)&&(item?.must_preserve_structure || item?.type === 'SummaryBlock'));
export function validateSourceArtifactRefs(items, refs) {
  if(!Array.isArray(refs))throw new Error('invalid source artifact refs');
  const intervals=new Map();
  for(const ref of refs){
    const item=items.find(item=>item.id===ref?.sourceUnitId);
    if(!isSourceArtifactItem(item))throw new Error('source artifact not assigned to a structure or summary');
    if(ref.lineStart!==undefined||ref.lineEnd!==undefined){
      const range=sourceLineRange(item,ref),ranges=intervals.get(item.id)||[];
      if(ranges.some(([a,b])=>range.lineStart<b&&range.lineEnd>a))throw new Error('overlapping source line ranges');
      ranges.push([range.lineStart,range.lineEnd]);intervals.set(item.id,ranges);continue;
    }
    if(!['TableBlock','SummaryTableBlock'].includes(item.type)){
      if(ref.rowStart!==undefined||ref.rowEnd!==undefined)throw new Error('row range is only valid for a table');
      if(intervals.has(item.id))throw new Error('duplicate source artifact');
      intervals.set(item.id,[]);continue;
    }
    const start=ref.rowStart??1,end=ref.rowEnd??item.rows?.length;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||(end<start||end===start&&item.rows.length!==1)||end>item.rows.length)throw new Error('invalid source table row range');
    const existing=intervals.get(item.id)||[];
    if(existing.some(([a,b])=>start<b&&end>a))throw new Error('overlapping source table row ranges');
    existing.push([start,end]);intervals.set(item.id,existing);
  }
  return refs;
}
/** Source components keep their translation-pair identity for layout. */
export function sourceComponent(item, ref = {}) {
  const displayed=ref.lineStart!==undefined||ref.lineEnd!==undefined?materializeSourceLineRange(item,ref):item;
  const raw = sourceComponentBody(displayed, ref),component={...raw,sourceUnitId:item.id,content:ensureRichContent(raw.content)};
  return item?.languagePairId ? { ...component, pairId: item.languagePairId } : component;
}
/** Checklist members are semantic points, not one paragraph-count proxy.
 * The original source ID remains authoritative; fragments cover ordered item
 * indices exactly and are checked together by object integrity. */
export function sourceComponentParts(item,ref={}){
  const component=sourceComponent(item,ref);
  // A formula's \\underbrace labels read as one 12 pt legend line under it (Fable r19 H);
  // inline formulas of a paragraph, list or table give theirs the same way (Fable plan T30).
  const legend=component.content?.braceLegend||richBraceLegend(component.content);
  const legendPart=legend?.length?[{type:'text',ladderFontPt:12,braceLegendOf:item.id,content:richTextContent(braceLegendText(legend))}]:[];
  if(legendPart.length&&component.content?.braceLegend)return [component,...legendPart];
  if(component.type!=='list'||component.content.diagram||component.content.items.length<2)return [component,...legendPart];
  const parts=component.content.items.map((entry,index)=>({...component,content:{...component.content,items:[entry]},itemFragment:{itemStart:index,itemEnd:index+1},
    ...(component.pairId?{pairId:`${component.pairId}:point:${index}`}:{})}));
  if(!component.pairId)for(let i=0;i<parts.length-1;i++)if(translationPair(parts[i],parts[i+1],componentLanguage(parts[i]),componentLanguage(parts[i+1]))){const id=stableId('unit',item.id,'paired-list',i);parts[i].readingUnitId=id;parts[i+1].readingUnitId=id;i++;}
  return [...parts,...legendPart];
}
function sourceComponentBody(item, ref = {}) {
  if(!validGraphProjection(item))throw new Error('source_graph_projection_invalid: the compact graph changed outside its original source proof');
  if(item.type==='SourceImage'){
    const {id,type,...content}=item;
    return {type:'image',content:{...content,sourceImageId:id}};
  }
  if(item.type==='ChartBlock')return {type:'chart',content:structuredClone(item.chart)};
  if(item.type==='CodeBlock')return {type:'text',content:{text:item.text,codeBlock:{language:item.language || '',sourceText:item.text}}};
  if(item.type==='EquationBlock')return {type:'text',content:equationContent(item.text)};
  // Older parsed snapshots stored compact ASCII branches as lossy table
  // rows but retained the complete immutable diagram alongside them. Render
  // that drawing directly when the reference owns the whole legacy object.
  const legacyDrawing=item.type==='TableBlock'&&item.diagramSource?.kind==='ascii'&&item.diagramSource.presentation!=='semantic_graph_rows'&&item.rows?.slice(1).map(row=>row.length===1?String(row[0]):'').join('\n')!==String(item.diagramSource.text||'')&&/├|└|\b(?:Yes|No)\s*→/u.test(item.diagramSource.text||'')?String(item.diagramSource.text).replace(/\s+$/u,''):'';
  if(legacyDrawing&&legacyDrawing.split('\n').length<=20&&Math.max(...legacyDrawing.split('\n').map(line=>line.length))<=64){
    if(ref.rowStart!==undefined&&(ref.rowStart!==1||ref.rowEnd!==item.rows.length))throw new Error('Legacy ASCII diagram requires its complete original source scope');
    return {type:'text',content:{text:legacyDrawing,codeBlock:{language:'diagram',sourceText:legacyDrawing},processSource:legacyDrawing}};
  }
  if (['TableBlock','SummaryTableBlock'].includes(item.type)) {
    const start = ref.rowStart === undefined ? 1 : Number(ref.rowStart), end = ref.rowEnd === undefined ? item.rows.length : Number(ref.rowEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || (end < start || end === start && item.rows.length !== 1) || end > item.rows.length) throw new Error('invalid source table row range');
    if(ref.tableRepresentation!=='table'){
      const relational=relationalComponent(item,start,end);if(relational)return relational;
    }
    const diagramKind=item.tableRepresentation==='diagram'&&ref.tableRepresentation!=='table'&&item.diagramSource?.presentation!=='semantic_graph_rows'?chooseTableDiagram(item):null;
    if(diagramKind)return tableDiagramComponent(item,diagramKind,start,end);
    // A headerless source table (no header row in the PDF; Fable review 7) repeats no first row on a continuation.
    const headerless=item.headerless===true,rawRows=(headerless&&start>1?item.rows.slice(start,end):[item.rows[0],...item.rows.slice(start,end)]).map(row=>row.map(String)),cellRich=rawRows.map(row=>row.map(value=>sourceRichText(value,{inline:true})));
    return {type:'table',content:{rows:cellRich.map(row=>row.map(cell=>cell.plainText)),rawRows,cellRich,...(headerless?{headerRow:false}:{}),derivedSummary:item.derivedSummary,displayTransformVersion:2,...(item.diagramSource?.presentation==='semantic_graph_rows'?{columnWeights:item.rows[0].length===2?[.5,.5]:[.26,.48,.26],sourceGraph:item.diagramSource.graph}: {})}};
  }
  // A fanned-out or branching ASCII drawing reads as its original drawing in a
  // monospace box; flattening its columns with " / " garbles the arrows.
  const drawing=item.diagramSource?.kind==='ascii'&&['parallel','branching'].includes(item.diagramSource.relation)?(item.sourceLineRange||item.diagramSource.presentation==='literal_source_lines'?item.text:String(item.diagramSource.text||'').replace(/\s+$/u,'')):'';
  if(drawing&&(item.diagramSource.presentation==='literal_source_lines'||item.sourceLineRange||drawing.split('\n').length<=20&&Math.max(...drawing.split('\n').map(line=>line.length))<=64))
    return {type:'text',content:{text:drawing,codeBlock:{language:'diagram',sourceText:drawing,...(item.diagramSource.presentation==='literal_source_lines'?{preserveLayout:true}:{})},processSource:item.text}};
  // A drawing too wide for a slide keeps its source text, one box per line; a
  // timeline would add per-stage chrome and overflow a long architecture.
  const sourceLines=item.text.split('\n').filter(line=>line.trim()),bullet=/^\s*(?:[-*+]|\d+[.)])\s+/;
  // Warning/role/taxonomy classification must not erase the source's list
  // structure. Only a wholly explicit list is split; mixed prose stays whole.
  if (item.type === 'ChecklistBlock'||['WarningBlock','TaxonomyBlock'].includes(item.type)&&sourceLines.length>=1&&sourceLines.every(line=>bullet.test(line))) return { type: 'list', content: { items: sourceLines.filter(line=>bullet.test(line)).map(line => ({ text: line.replace(bullet, '') })) } };
  if(item.type==='ProcessBlock'&&item.diagramSource?.kind==='text-flow')return {type:'timeline',content:{items:item.text.split('\n').map(text=>richTextContent(text)),processSource:item.text}};
  if (item.type==='ProcessBlock' && /branch|if\b|else\b|分支|否则|┌|├|└/i.test(item.text)) return {type:'text',content:{text:item.text,processSource:item.text}};
  if (item.type === 'ProcessBlock') {
    const steps=orderedSourceSteps(item.text);
    return steps.length>1?{type:'timeline',content:{items:steps.map(text=>richTextContent(text)),processSource:item.text}}:{type:'text',content:{text:sourceDisplayText(item.text),processSource:item.text}};
  }
  return {type:'text',content:richTextContent(item.text)};
}
/** Captions use visible source text and their own capacity budget. */
export function sourceImageComponents(image, notePointer = '') {
  // A figure page whose stacked neighbour went to the notes points to it on
  // the caption's last line (Fable 2026-11-02: "Figure 8: see notes").
  return [sourceComponent({...image,type:'SourceImage'}),...(image.caption?.trim()?
    [{type:'text',content:{text:image.caption.trim()+(notePointer?'\n'+notePointer:''),sourceImageCaptionId:image.id,...(notePointer?{notePointer}:{})}}]:[])];
}

/** Shared planning/writing representation: paired list points are contiguous,
 * so reading units cannot differ between a predicted fit and the real writer. */
export function prepareReadingComponents(items,components,project){
 if(project?.generationPolicy?.version===2)components=components.map(c=>c.type==='timeline'&&c.content.processSource?{...c,content:{...c.content,processCardsEnabled:true}}:c);
 const idOf=c=>c.item?.id||c.sourceUnitId,units=readingUnits(items,components.map(idOf).filter(Boolean)),result=[];
 for(const ids of units){
  let parts=components.filter(c=>ids.includes(idOf(c)));
  // Point-wise bilingual alignment requires equal explicit list cardinality.
  // Unequal/mixed lists stay intact as one source reading group; do not infer
  // missing counterparts or silently pair the wrong point with a paragraph.
  const pairs=[...new Set(ids.map(id=>items.find(item=>item.id===id)?.languagePairId).filter(Boolean))];
  for(const pairId of pairs){
    const members=ids.filter(id=>items.find(item=>item.id===id)?.languagePairId===pairId);
    const counts=members.map(id=>parts.filter(part=>idOf(part)===id&&part.itemFragment).length);
    if(members.length<2||!counts.some(Boolean)||counts.every(count=>count>0&&count===counts[0]))continue;
    parts=parts.filter(part=>!members.includes(idOf(part))).concat(members.flatMap(id=>{
      const memberParts=components.filter(part=>idOf(part)===id),first=memberParts[0],item=items.find(item=>item.id===id);
      if(!first||!memberParts.some(part=>part.itemFragment))return memberParts;
      const {itemFragment,readingUnitId,...whole}=first;
      return [{...whole,...sourceComponent(item)}];
    }));
  }
  if(parts.some(c=>c.itemFragment)&&ids.some(id=>items.find(i=>i.id===id)?.languagePairId))parts.sort((a,b)=>(a.itemFragment?.itemStart??-1)-(b.itemFragment?.itemStart??-1)||ids.indexOf(idOf(a))-ids.indexOf(idOf(b)));
  for(const c of parts)result.push({...c,...(ids.length>1?{readingUnitId:stableId('unit',...ids,c.itemFragment?.itemStart??'prose')}:{})});
 }
 const assigned=new Set(units.flat());return [...result,...components.filter(c=>!idOf(c)||!assigned.has(idOf(c)))];
}

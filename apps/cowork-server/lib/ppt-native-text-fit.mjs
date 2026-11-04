import {syncPageNumbers} from './ppt-page-numbers.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {templateVisualUnits as visualUnits} from './ppt-presentation-writing.mjs';
import {equationDimensions} from './ppt-math.mjs';
/** LibreOffice stretches imported Office equations to their containing frame.
 * Source-created equations get a natural frame; native/user frames stay exact. */
export function fitSourceMathFrames(slide,project={}){
 for(const node of slide.nodes||[]){
  if(!node.sourceArtifact||node.nativeRef||node.locked||!node.content?.mathMl||!node.geometry)continue;
  const original=node.sourceMathFrameAdaptation?.originalGeometry||structuredClone(node.geometry);
  const natural=equationDimensions(node.content,Number(node.style?.fontSizePt||18));
  const width=Math.ceil(natural.widthPt*12700),height=Math.ceil(natural.heightPt*12700);
  if(width>original.width||height>original.height){
   node.sourceMathFrameAdaptation={status:'blocked',originalGeometry:original,requiredWidth:width,requiredHeight:height};continue;
  }
  // A card deck's formula keeps its slot's full width: the estimate runs
  // short and LibreOffice shrinks math to a narrow frame (Fable r19 J, mlq p9 at ~80%).
  node.geometry={...original,width:cardsFlow(project)?original.width:width,height};
  const originalStyle=node.sourceMathFrameAdaptation?.originalStyle||structuredClone(node.style||{});
  const hex=String(originalStyle.fill||'').replace('#','');
  const dark=/^[a-f0-9]{6}$/iu.test(hex)&&[0,2,4].reduce((sum,at,index)=>sum+parseInt(hex.slice(at,at+2),16)/255*[.2126,.7152,.0722][index],0)<.35;
  if(dark){
    // Some Office consumers ignore OMML run colour. A source-created math
    // plate must stay readable in both native Office and PDF renderers.
    const index=project.deck?.slides?.indexOf(slide)??-1;
    const candidate=project.templateFidelity?.slides?.[index]?.background||project.templateSpec?.palette?.background||'#ffffff';
    const c=String(candidate).replace('#',''),light=/^[a-f0-9]{6}$/iu.test(c)&&[0,2,4].reduce((sum,at,index)=>sum+parseInt(c.slice(at,at+2),16)/255*[.2126,.7152,.0722][index],0)>.7;
    node.style={...node.style,fill:light?candidate:'#ffffff',color:'#111827',colorBasis:'source-math-accessible-plate'};
  }
  node.sourceMathFrameAdaptation={status:'adapted',basis:'natural-math-frame-same-point-size',originalGeometry:original,originalStyle,fontSizePt:node.style?.fontSizePt};
 }
}
/** Reserve native glyph ink without changing the selected font or point size. */
export function fitNativeTitleFrames(project, slide, {allText=false,only=null}={}) {
  for (const node of slide.nodes || []) {
    if (only && node.id !== only) continue;
    if ((allText ? node.type !== 'text' : node.semanticRole !== 'template-title') || node.locked || node.content?.mustPreserve || !node.nativeRef || !node.geometry || !String(node.content?.text || '').trim()) continue;
    const original = node.templateTitleFrameAdaptation?.originalGeometry || structuredClone(node.geometry);
    const pointSize = Number(node.style?.fontSizePt);
    if (!(pointSize > 0)) continue;
    // Native English title boxes can be shorter than a CJK fallback's glyph
    // extent. Preserve font size, width and origin; add bounded vertical space.
    const cjk = /[\u2e80-\u9fff\uf900-\ufaff]/u.test(node.content.text);
    const lines = String(node.content.text).split('\n').reduce((count, text) => count + (allText || cjk || node.nativeTextFrame?.wordWrap !== false ? Math.max(1, Math.ceil(visualUnits(text) * pointSize / (original.width / 12700))) : 1), 0);
    // CJK fallback line advance is 1.20 em; first-line ascender/descent
    // allowance is separate. Real 34.5 pt two-line native titles span
    // 85.18 pt from frame top, fitting the available 88.26 pt.
    // Native paragraph spacing can place descender ink just below the original
    // frame even though all text is rendered. Reserve 2pt for multi-paragraph
    // native frames, bounded by neighbors; retain every run and its point size.
    const paragraphs=node.nativeTextFrame?.paragraphs?.filter(p=>p.text?.trim())||[];
    const paragraphSpace=allText?paragraphs.reduce((sum,p)=>sum+Number(p.spaceAfterPt||0),0):0;
    const inkReserve=allText&&paragraphs.length>1?2*12700:0;
    // A CJK title reserves what the render audit measures (line height x 1.2
    // per line, plus insets), so a frame the fitter accepts is never refused
    // at publication (3200: a 10-character Chinese cover title at 44.5 pt).
    const margins=node.nativeTextFrame?.margins||[],audited=cjk&&['title','template-title'].includes(node.semanticRole)?Math.ceil((pointSize*(Number(node.style?.lineHeight)||1.12)*1.2*lines+((Number(margins[1])||0)+(Number(margins[3])||0))/12700+1)*12700):0;
    const desired = Math.max(original.height+inkReserve, audited, Math.ceil((pointSize * ((allText ? 1.65 : 1.35) + 1.25 * (lines - 1))+paragraphSpace) * 12700));
    if (desired <= original.height) continue;
    let bottom = Number((project.templateFidelity || project.externalPptx)?.height || 6858000);
    for (const other of slide.nodes) {
      const g = other.geometry;
      if (!g || other.id === node.id || g.x + g.width <= original.x || g.x >= original.x + original.width) continue;
      if (g.y >= original.y + original.height - 1) bottom = Math.min(bottom, g.y - 12700);
    }
    let y=original.y,available = bottom - y;
    const minimum = Math.max(original.height, Math.ceil(pointSize * (1.30 + 1.20 * (lines - 1)) * 12700));
    // Exported native ink can need a few more points than the room below a
    // title. Use measured empty space above before declaring the frame blocked;
    // never move through a neighboring object or change the font size.
    // A CJK title may also take empty space above to reach the audited height.
    const needed=Math.max(allText?minimum:0,audited);
    if(needed&&available<needed){
      let top=0;
      for(const other of slide.nodes||[]){
        const g=other.geometry;
        if(!g||other.id===node.id||g.x+g.width<=original.x||g.x>=original.x+original.width)continue;
        if(g.y<original.y&&g.y+g.height>original.y){top=original.y;break;}
        if(g.y+g.height<=original.y)top=Math.max(top,g.y+g.height+12700);
      }
      const shift=needed-available+12700;
      if(original.y-shift>=top){y=original.y-shift;available=bottom-y;}
    }
    if (available < minimum) {
      node.templateTitleFrameAdaptation = { status: 'blocked', originalGeometry: original, requiredHeight: minimum, availableHeight: available };
      if (!only && coverTitleNode(project, slide, node)) fitCoverTitle(project, slide, node, { allText, pointSize, bottom, minimum, available });
      continue;
    }
    const height = Math.min(desired, available);
    if (height <= original.height) continue;
    node.geometry = { ...original, y, height };
    // Native CJK glyph ink can extend beyond its advance width. Reserve a
    // small right inset so the final wrapped glyph stays inside the frame.
    if (cjk && node.nativeTextFrame?.margins) {
      node.nativeTextFrame = { ...node.nativeTextFrame, margins: node.nativeTextFrame.margins.map((value, index) => index === 2 ? Math.max(value, Math.ceil(pointSize * .08 * 12700)) : value) };
    }
    node.templateTitleFrameAdaptation = { status: 'adapted', reason: cjk ? 'native_cjk_title_glyph_extent' : 'native_latin_title_glyph_extent', originalGeometry: original, geometry: structuredClone(node.geometry), fontSizePt: pointSize };
  }
}

// COVER_TITLE_STEPS (ppt-template-fidelity.mjs, Fable 2026-11-01): the cover title's sizes below its slot's own.
const COVER_STEPS=[36,32,28];
const coverTitleNode=(project,slide,node)=>node.semanticRole==='template-title'&&project.deck?.slides?.[0]===slide;
/** A cover title whose grown frame would run into the frame below it (Fable Q7,
 * 2026-11-03, Portfolio 09-MCP: three lines at 51 pt over the subtitle) steps
 * down to 36, 32 and 28 pt; still blocked, the text frames below it move down
 * inside the slide's bottom margin. The title's words are never cut here. */
function fitCoverTitle(project,slide,node,{allText,pointSize}){
 const baseline={...node.style},first=node.templateTitleFrameAdaptation;
 // Each size is fitted from the slot's own frame; a size that needs no growth leaves no record.
 const attempt=()=>{node.geometry=structuredClone(first.originalGeometry);delete node.templateTitleFrameAdaptation;fitNativeTitleFrames(project,slide,{allText,only:node.id});node.templateTitleFrameAdaptation||={status:'fits',originalGeometry:structuredClone(first.originalGeometry)};};
 for(const pt of COVER_STEPS.filter(pt=>pt<pointSize)){
  node.style={...baseline,fontSizePt:pt};
  attempt();
  if(node.templateTitleFrameAdaptation?.status!=='blocked'){node.templateTitleFrameAdaptation={...node.templateTitleFrameAdaptation,coverFontStep:{from:pointSize,to:pt}};return;}
 }
 const fit=node.templateTitleFrameAdaptation,original=fit?.originalGeometry;if(!original)return;
 const slideHeight=Number((project.templateFidelity||project.externalPptx)?.height||6858000),limit=slideHeight-Math.round(.25*914400);
 const across=g=>!(g.x+g.width<=original.x||g.x>=original.x+original.width),reach=original.y+fit.requiredHeight+12700;
 const blockers=(slide.nodes||[]).filter(other=>other!==node&&other.geometry&&across(other.geometry)&&other.geometry.y>=original.y+original.height-1&&other.geometry.y<reach);
 if(!blockers.length||blockers.some(other=>other.type!=='text'||other.locked))return;
 const shift=reach-Math.min(...blockers.map(other=>other.geometry.y));
 const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
 const backdrop=g=>g.height>=.9*slideHeight;
 const moved=blockers.map(other=>({other,geometry:{...other.geometry,y:other.geometry.y+shift}}));
 if(moved.some(({geometry})=>geometry.y+geometry.height>limit||(slide.nodes||[]).some(rest=>rest!==node&&!blockers.includes(rest)&&rest.geometry&&!backdrop(rest.geometry)&&overlaps(geometry,rest.geometry))))return;
 for(const {other,geometry} of moved){other.coverTitleShift={from:other.geometry.y,to:geometry.y};other.geometry=geometry;}
 attempt();
 if(node.templateTitleFrameAdaptation?.status!=='blocked')node.templateTitleFrameAdaptation={...node.templateTitleFrameAdaptation,coverFontStep:{from:pointSize,to:node.style.fontSizePt},movedBelow:moved.map(({other})=>other.id)};
}

export const fitNativeTextFrames=(project,slide)=>fitNativeTitleFrames(project,slide,{allText:true});


/** A native section label and its small enclosing pill are one visual group.
 * Automatic labels may grow together; user geometry/fixed objects are exact. */
export function fitNativeSectionDecorations(project,slide,index){
 if(slide.sectionLabel?.basis!=='source-heading')return;
 const shapeId=slide.sectionLabel.shapeId,spec=project.templateFidelity?.slides?.[index];
 const label=slide.nodes?.find(node=>node.nativeRef?.shapeId===shapeId&&node.type==='text');
 const original=spec?.nodes?.find(node=>node.nativeRef?.shapeId===shapeId)?.geometry;
 if(!label||!original||label.locked||label.userGeometry||label.content?.mustPreserve)return;
 const candidates=(slide.nodes||[]).filter(node=>{const g=node.geometry;return node.type==='shape'&&g&&!node.locked&&!node.userGeometry&&!node.content?.mustPreserve&&g.width<project.templateFidelity.width*.6&&g.height<project.templateFidelity.height*.12&&g.x<=original.x&&g.x+g.width>=original.x+original.width*.5&&g.y<=original.y+original.height*.5&&g.y+g.height>=original.y+original.height*.5;});
 const pill=candidates.sort((a,b)=>a.geometry.width*a.geometry.height-b.geometry.width*b.geometry.height)[0];if(!pill)return;
 const base=pill.sectionDecorationFrameAdaptation?.originalGeometry||structuredClone(pill.geometry),font=Number(label.style?.fontSizePt)||11,margins=label.nativeTextFrame?.margins||[0,0,0,0];
 const textWidth=Math.ceil([...String(label.content?.text||'')].reduce((sum,char)=>sum+font*(char.codePointAt(0)>127?1:/[MW@]/u.test(char)?.85:.55),0)/.9*12700)+Number(margins[0]||0)+Number(margins[2]||0);
 const inset=Math.max(25400,original.x-base.x),width=Math.max(base.width,inset*2+textWidth);
 let right=project.templateFidelity.width-91440;
 for(const node of slide.nodes||[]){const g=node.geometry;if(node===label||node===pill||!g||g.width*g.height>project.templateFidelity.width*project.templateFidelity.height*.6)continue;if(g.x>=base.x+base.width&&g.y<base.y+base.height&&g.y+g.height>base.y)right=Math.min(right,g.x-12700);}
 if(base.x+width>right){pill.sectionDecorationFrameAdaptation={status:'blocked',originalGeometry:base,requiredWidth:width,availableWidth:right-base.x};return;}
 pill.geometry={...base,width};pill.sectionDecorationFrameAdaptation={status:'adapted',originalGeometry:base,basis:'source-heading label and enclosing decoration, same font; within neighboring-object bounds'};
 label.geometry={...label.geometry,width:Math.max(original.width,textWidth)};
}

/** Commit the exact native export frames before semantic review. Export must
 * not discover a different, unreviewed geometry after publication starts. */
export function prepareNativeExportFrames(project) {
  if(project.templateFidelity?.mode!=='preserve'&&project.externalPptx?.mode!=='preserve')return project;
  // Page numbers follow the final page order (user decision 2026-10-24).
  syncPageNumbers(project);
  for(const slide of project.deck?.slides||[]){fitSourceMathFrames(slide,project);fitNativeTextFrames(project,slide);}
  return project;
}

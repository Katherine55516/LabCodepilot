import { measureText, PT_EMU } from './render-contract.mjs';

const hasText = e => Boolean(e.content?.text?.trim() || e.content?.paragraphs?.length || e.content?.items?.length || e.content?.mathMl);
const overlap = (a,b) => Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+127 && Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+127;
const contains = (a,b) => a.x<=b.x && a.y<=b.y && a.x+a.width>=b.x+b.width && a.y+a.height>=b.y+b.height;
function textBounds(e) {
  if(!hasText(e) || !['text','shape'].includes(e.kind) || e.content?.mathMl || e.rotation) return e.bounds;
  const fit=measureText({...e,kind:'text'});
  const margins=e.textLayout?.margins||[3.6,3.6,3.6,3.6];
  // Prediction excludes unused frame height; final export/visibility checks
  // remain responsible for actual font-engine ink. Never hide width overflow.
  return {x:e.bounds.x+margins[0]*PT_EMU,y:e.bounds.y+margins[1]*PT_EMU,
    width:Math.max(1,e.bounds.width-(margins[0]+margins[2])*PT_EMU),
    height:Math.min(e.bounds.height,Math.max(1,fit.estimatedHeightPt*PT_EMU))};
}
function occupiedBounds(e) {
  if(e.kind==='list'&&e.content?.pointLayout?.boxes) return e.content.pointLayout.boxes.map(b=>({
    x:e.bounds.x+b.x*e.bounds.width,y:e.bounds.y+b.y*e.bounds.height,
    width:b.w*e.bounds.width,height:b.h*e.bounds.height,
  }));
  return [textBounds(e)];
}
const occupiedOverlap=(a,b)=>occupiedBounds(a).some(x=>occupiedBounds(b).some(y=>overlap(x,y)));
export function classifyCollision(a,b) {
  if(!overlap(a.bounds,b.bounds))return {status:'allowed',basis:'disjoint_frames'};
  const carrier=(x,y)=>x.semanticRole==='icon-carrier'&&x.kind==='shape'&&x.groupId===y.id&&y.kind==='image'&&y.semanticRole==='item-icon'&&contains(x.bounds,y.bounds)&&x.zIndex<y.zIndex;
  if(carrier(a,b)||carrier(b,a))return {status:'allowed',basis:'bound_icon_carrier'};
  const aText=hasText(a),bText=hasText(b);
  if((a.content?.pointLayout||b.content?.pointLayout)&&!occupiedOverlap(a,b))return {status:'allowed',basis:'disjoint_point_boxes'};
  const background=(e,other,text,first)=>e.kind==='shape'&&!hasText(e)&&Boolean(e.style?.fill)&&contains(e.bounds,other.bounds)&&(Number(e.zIndex||0)<Number(other.zIndex||0)||first&&Number(e.zIndex||0)===Number(other.zIndex||0))&&text;
  if(background(a,b,bText,true)||background(b,a,aText,false))return {status:'allowed',basis:'background_containment'};
  if(aText&&bText){
    if(!occupiedOverlap(a,b))return {status:'allowed',basis:'disjoint_predicted_text_lines'};
    return {status:'collision',basis:'text_line_collision_prediction'};
  }
  // Connectors, masks and artwork frequently overlap intentionally. Do not
  // certify them from group/locked flags; retain an unresolved diagnostic.
  if(aText||bText){
    const text=aText?a:b,cover=aText?b:a;
    // A template's own static ordinal under its own unreplaced picture is the
    // template's layering (a numbered ring of transparent segments): the export
    // verifier checks its visibility with the picture's alpha (3143 g4d page 9).
    if(text.semanticRole==='ordinal'&&text.nativeRef&&cover.kind==='image'&&cover.nativeRef&&!cover.content?.mediaReplacement&&text.nativeRef.sourceSlideIndex===cover.nativeRef.sourceSlideIndex)
      return {status:'unresolved',basis:'native_template_layering'};
    if((['image','table','chart'].includes(cover.kind)||cover.kind==='shape'&&cover.style?.fill)&&(Number(cover.zIndex||0)>Number(text.zIndex||0)||cover===b&&Number(cover.zIndex||0)===Number(text.zIndex||0))&&occupiedOverlap(cover,text))
      return {status:'occlusion',basis:'foreground_media_over_text'};
  }
  return {status:'unresolved',basis:'native_overlay_requires_render_verification'};
}

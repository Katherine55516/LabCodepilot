/** Text that cannot be seen on its background (Fable, 2026-10-25; 3143 g4
 * page 4: a left-out group's dark box was removed under a kept group's white
 * heading and light description, which then sat on the light slide). On a
 * preserved template, each visible text's background is the topmost filled
 * shape or picture behind the centre of its frame, else the slide background.
 * Below 2:1 is an integrity block; a picture without a known panel colour or
 * a background that is not a plain colour is listed, not blocked. */
import {visibleNodes,nodeContentText} from './ppt-visible-content.mjs';
import {surfaceFill} from './ppt/surface-fill.mjs';

const MINIMUM_CONTRAST=2;
function rgb(value){
  const hex=String(value||'').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/iu)?.[1];if(!hex)return null;
  const full=hex.length===3?[...hex].map(c=>c+c).join(''):hex;
  return [0,2,4].map(at=>parseInt(full.slice(at,at+2),16));
}
function luminance([r,g,b]){
  const linear=channel=>{const c=channel/255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;};
  return .2126*linear(r)+.7152*linear(g)+.0722*linear(b);
}
export function contrastRatio(foreground,background){
  const a=rgb(foreground),b=rgb(background);if(!a||!b)return null;
  const [light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
  return (light+.05)/(dark+.05);
}
const inside=(x,y,box)=>box&&x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height;
/** The colour behind a text node, or null when it cannot be determined. */
function backgroundOf(text,nodes,slideBackground){
  const own=surfaceFill(text);
  if(own?.mode==='solid'&&rgb(own.color)&&Number(text.style?.opacity??1)===1)return {color:own.color,basis:'text-surface',nodeId:text.id};
  const box=text.geometry,x=box.x+box.width/2,y=box.y+box.height/2;
  const behind=nodes.filter(node=>node!==text&&Number.isFinite(node.zIndex)&&node.zIndex<text.zIndex&&inside(x,y,node.geometry)&&
    (node.type==='image'||node.type==='shape'&&rgb(node.style?.fill)))
    .sort((a,b)=>b.zIndex-a.zIndex)[0];
  if(behind?.type==='shape')return {color:behind.style.fill,basis:'shape',nodeId:behind.id};
  if(behind?.type==='image')return behind.content?.panelColor&&rgb(behind.content.panelColor)?{color:behind.content.panelColor,basis:'picture-panel',nodeId:behind.id}:null;
  return typeof slideBackground==='string'&&rgb(slideBackground)?{color:slideBackground,basis:'slide-background'}:null;
}
export function inspectTextContrast(project,slides=project.deck?.slides||[]){
  const fidelity=project.templateFidelity;if(fidelity?.mode!=='preserve')return [];
  const issues=[];
  slides.forEach((slide,index)=>{
    const nodes=visibleNodes(slide),unchecked=[];
    for(const text of nodes.filter(node=>node.type==='text'&&rgb(node.style?.color)&&node.geometry&&Number.isFinite(node.zIndex)&&nodeContentText(node).trim())){
      const background=backgroundOf(text,nodes,fidelity.slides?.[index]?.background);
      if(!background){unchecked.push(text.id);continue;}
      const ratio=contrastRatio(text.style.color,background.color);
      if(ratio!==null&&ratio<MINIMUM_CONTRAST)issues.push({code:'text_contrast_insufficient',severity:'error',slideId:slide.id,index,...(slide.cardPage?.mode?{pageMode:slide.cardPage.mode}:{}),nodeIds:[text.id],ratio:Math.round(ratio*100)/100,color:text.style.color,background:background.color,basis:background.basis,
        message:`Page ${index+1}: text "${nodeContentText(text).trim().slice(0,40)}" (${text.style.color}) on ${background.color} has contrast ${ratio.toFixed(2)}:1, below ${MINIMUM_CONTRAST}:1, and cannot be read.`});
    }
    if(unchecked.length)issues.push({code:'text_contrast_unchecked',severity:'warning',slideId:slide.id,index,nodeIds:unchecked,message:`Page ${index+1}: the background of ${unchecked.length} text frame(s) is a picture or not a plain colour; contrast was not checked.`});
  });
  return issues;
}
/** Text the deck writes into a template slot is meant to be read (Fable D3,
 * 2026-11-01: the Professional-Portfolio section pill, navy on black, was the
 * template's decorative "SLIDE 7" until it carried the section name). When the
 * slot's own colour reads below 3:1 on its background, the text takes the
 * template's first text colour that passes (titles first), else black or
 * white. The template's own text and every shape stay as they are. */
const WRITTEN_CONTRAST=3;
export function readableWrittenText(project,slide,index){
  const fidelity=project.templateFidelity;if(fidelity?.mode!=='preserve')return slide;
  const spec=fidelity.slides?.[index],nodes=visibleNodes(slide);
  const example=new Map((spec?.nodes||[]).map(node=>[String(node.nativeRef?.shapeId),String(node.content?.text||'').trim()]));
  const texts=(fidelity.slides||[]).flatMap(frame=>(frame.nodes||[]).filter(node=>node.type==='text'&&rgb(node.style?.color)));
  const palette=[...new Set([...texts.filter(node=>['title','template-title'].includes(node.semanticRole)),...texts].map(node=>node.style.color.toLowerCase()))];
  for(const text of nodes.filter(node=>node.type==='text'&&node.nativeRef&&rgb(node.style?.color)&&node.geometry&&nodeContentText(node).trim())){
    if(nodeContentText(text).trim()===example.get(String(text.nativeRef.shapeId)))continue;
    const background=backgroundOf(text,nodes,spec?.background);if(!background)continue;
    if((contrastRatio(text.style.color,background.color)??Infinity)>=WRITTEN_CONTRAST)continue;
    const color=palette.find(value=>contrastRatio(value,background.color)>=WRITTEN_CONTRAST)||(luminance(rgb(background.color))>.18?'#000000':'#ffffff');
    text.style={...text.style,color,colorBasis:'readable_written_text'};
  }
  return slide;
}

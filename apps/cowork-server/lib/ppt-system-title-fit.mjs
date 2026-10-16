import {applyRenderContract,measureText} from './ppt/render-contract.mjs';
const PT=12700,INCH=914400;
/** Grow a two-line system title into existing whitespace; never shrink text,
 * alter native masks or override user geometry. If necessary, translate the
 * automatic body group into available bottom whitespace without resizing it. */
export function fitSystemTitleFrames(scene){
 if(scene.templatePreserved)return scene;
 for(const title of scene.elements.filter(element=>element.kind==='text'&&element.semanticRole==='title'&&!element.userGeometry)){
  const measured=measureText(title);if(!measured.overflow||measured.widthOverflow||measured.lines>2)continue;
  const b=title.bounds,margins=title.textLayout.margins;
  const below=scene.elements.filter(element=>element!==title&&['text','list','timeline','metric','table','chart','image','shape','foreign'].includes(element.kind)&&!['page-number','closing-greeting','eyebrow'].includes(element.semanticRole)&&element.bounds.y>b.y&&element.bounds.x<b.x+b.width&&element.bounds.x+element.bounds.width>b.x);
  // Footer ink is a real occupied region, even though it is excluded from
  // the movable body group. Keep the entire translated group above it.
  const footerTop=Math.min(scene.size.height-INCH*.18,...scene.elements.filter(element=>['page-number','closing-greeting'].includes(element.semanticRole)&&element.bounds.y>b.y).map(element=>element.bounds.y-INCH*.08));
  const limit=Math.min(footerTop,...below.map(element=>element.bounds.y-INCH*.08));
  const height=Math.ceil((measured.estimatedHeightPt+margins[1]+margins[3]+1)*PT);
  if(height<=b.height)continue;
  if(b.y+height>limit){
   const delta=Math.ceil(b.y+height+INCH*.08-Math.min(...below.map(element=>element.bounds.y)));
   // Preserve every body component's size, relative placement and content.
   // User-positioned objects freeze this adaptation; unresolved overflow stays a gate failure.
   if(!below.length||below.some(element=>element.userGeometry||element.bounds.y+element.bounds.height+delta>footerTop))continue;
   for(const element of below){element.bounds={...element.bounds,y:element.bounds.y+delta};element.bodyFrameAdaptation={deltaY:delta,basis:'automatic group translated into unused bottom whitespace for a two-line title'};applyRenderContract(element);}
  }
  title.titleFrameAdaptation={beforeHeight:b.height,afterHeight:height,basis:'measured two-line ink height within existing free space'};
  title.bounds={...b,height};applyRenderContract(title);
 }
 return scene;
}

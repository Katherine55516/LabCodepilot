/** One measured source layout for outline capacity and emitted source objects. */
import {fitComponents,measureComponent,INCH} from './ppt-density-capacity.mjs';
import {mediaPreservingFit} from './ppt-media-preserving-layout.mjs';

export function validPlacement(candidate,base,components){
  const canvas=base?.canvas;
  if(!canvas||!candidate?.capacity_ok||candidate.predictedOverflow!==0||candidate.readingOrder!==true||candidate.atomicReadingUnits!==true||candidate.fontSizePt<base.fontSizePt)return false;
  if(candidate.boxes?.length!==components.length||candidate.measurements?.length!==components.length)return false;
  for(let i=0;i<candidate.boxes.length;i++)for(let j=i+1;j<candidate.boxes.length;j++){
    const a=candidate.boxes[i],b=candidate.boxes[j];
    if(Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+1&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+1)return false;
  }
  return candidate.boxes.every((box,i)=>{
    const m=candidate.measurements[i];
    return ['x','y','width','height'].every(key=>Number.isFinite(box[key]))&&box.width>0&&box.height>0&&
      box.x>=canvas.x-1&&box.y>=canvas.y-1&&box.x+box.width<=canvas.x+canvas.width+1&&box.y+box.height<=canvas.y+canvas.height+1&&
      Number.isFinite(m?.height)&&m.height<=box.height+1&&(!m.width||m.width<=box.width+1);
  });
}

function centeredProcess(components,fit,project,index){
  const pageId=project.outline?.[index]?.id;
  if(!fit.capacity_ok||fit.layoutId!=='stacked-source'||components.length>2||Number(project.editing?.epochs?.[pageId])>0)return fit;
  let result=fit;
  for(const [i,component]of components.entries()){
    const items=component.content?.items;
    if(component.type!=='timeline'||component.userGeometry||component.locked||!items?.length||!items.every(item=>/^\s*\d+[.)]\s/u.test(item.text||'')))continue;
    const box=fit.boxes[i],fits=width=>{
      const m=measureComponent(component,{...box,width},fit.fontSizePt);
      return m.height<=box.height+1&&(!m.width||m.width<=width+1);
    };
    let low=Math.min(box.width,Math.max(INCH*2.3,box.width*.3)),high=box.width;
    if(!fits(high))continue;
    for(let pass=0;pass<16&&high-low>1;pass++){
      const width=(low+high)/2;if(fits(width))high=width;else low=width;
    }
    const width=Math.ceil(high);if(width>=box.width*.85)continue;
    const geometry={...box,x:Math.round(box.x+(box.width-width)/2),width};
    const measurements=[...result.measurements],boxes=[...result.boxes];
    boxes[i]=geometry;measurements[i]=measureComponent(component,geometry,fit.fontSizePt);
    result={...result,boxes,measurements,balanced:'centered',sourceLayoutRefinement:'measured_ordered_process_width'};
  }
  return validPlacement(result,fit,components)?result:fit;
}

export function fitSourceLayout(components,project={},index=1,options={}){
  const base=fitComponents(components,project,index,options);
  if(base.componentFallbacks)return base;
  const pageId=project.outline?.[index]?.id;
  if(!base.capacity_ok&&Number(project.editing?.epochs?.[pageId])>0)return base;
  const media=mediaPreservingFit(project,index,components,base);
  const chosen=validPlacement(media,base,components)?media:base;
  if(chosen.capacity_ok)return centeredProcess(components,chosen,project,index);
  // Prefer every valid original-size composition before bounded reduction.
  // This opt-in contract never applies to legacy decks or edited/locked text.
  const floor=Math.max(16,Math.ceil(base.fontSizePt*.9*10)/10,Number(project.sourceFontFloors?.[pageId])||0,...components.map(c=>Number(c.fontSizePt)||0));
  if(project.generationPolicy?.sourceTypography!=='bounded'||Number(project.editing?.epochs?.[pageId]||0)>0||project.deck?.slides?.[index]?.locked||components.some(c=>c.locked||c.userGeometry||c.userStyle)||floor>=base.fontSizePt)return chosen;
  for(let font=Math.max(floor,base.fontSizePt-.5);font>=floor; font=Math.max(floor,Math.round((font-.5)*10)/10)){
    const reduced=fitComponents(components,project,index,{fontSizePt:font,boundedTypography:true});
    if(reduced.componentFallbacks)return reduced;
    const adaptedMedia=mediaPreservingFit(project,index,components,reduced);
    const candidate=validPlacement(adaptedMedia,reduced,components)?{...adaptedMedia,fontAdaptation:reduced.fontAdaptation}:reduced;
    if(validPlacement(candidate,reduced,components))return centeredProcess(components,candidate,project,index);
    if(font===floor)break;
  }
  return chosen;
}

import {contentCanvas,fitComponents,measureComponent,sourceImageComponents,INCH} from './ppt-density-capacity.mjs';
/** Candidate for image-first reading: aspect-preserving pictures with their
 * complete captions below, measured across the available page width. */
/** A figure card's pill: height (in) and type size (Fable M4). */
export const PILL_IN=.38,PILL_PT=12;
export function wideFigureFit(components,project,index,options={}){
 const measuredCanvas=contentCanvas(project,index),canvas=options.canvas||measuredCanvas.geometry,fontSizePt=measuredCanvas.fontSizePt,gap=Math.round(.16*INCH);
 const figures=components.flatMap((c,i)=>c.type==='image'?[i]:[]);if(!figures.length||figures.length>4||canvas.width<=0||canvas.height<=0)return null;
 // A figure card's pill (Fable M4) sits above its own figure, not with the page text.
 const captions=new Set(components.flatMap((c,i)=>c.content?.sourceImageCaptionId?[i]:[])),pills=new Set(components.flatMap((c,i)=>c.content?.figurePillOf?[i]:[]));
 const text=components.flatMap((c,i)=>c.type!=='image'&&!captions.has(i)&&!pills.has(i)?[i]:[]),pillHeight=pills.size?Math.round(PILL_IN*INCH):0;
 const boxes=Array(components.length),measurements=Array(components.length);let top=canvas.y;
 if(text.length){const fit=fitComponents(text.map(i=>components[i]),project,index,{canvas,readingOrder:true});if(!fit.capacity_ok)return null;text.forEach((i,k)=>{boxes[i]=fit.boxes[k];measurements[i]=fit.measurements[k];});top=Math.max(...fit.boxes.map(b=>b.y+b.height))+gap;}
 const rows=figures.length>2?2:1,cols=Math.ceil(figures.length/rows),width=(canvas.width-gap*(cols-1))/cols,height=(canvas.y+canvas.height-top-gap*(rows-1))/rows;
 if(height<INCH*.7)return null;
 const captionPt=Math.max(12,fontSizePt-2);
 for(const [k,i] of figures.entries()){
  const image=components[i],id=image.content?.sourceImageId,caption=[...captions].find(c=>components[c].content.sourceImageCaptionId===id),pill=[...pills].find(c=>components[c].content.figurePillOf===id);
  const x=canvas.x+(k%cols)*(width+gap),cellTop=top+Math.floor(k/cols)*(height+gap),rowTop=cellTop+(pills.size?pillHeight+Math.round(gap/2):0);
  if(pill!==undefined){boxes[pill]={x:Math.round(x),y:Math.round(cellTop),width:Math.floor(width),height:pillHeight};measurements[pill]={lines:1,height:pillHeight,overflow:false,fontSizePt:PILL_PT,fontBasis:'figure_card_heading'};}
  const measured=caption===undefined?null:measureComponent(components[caption],{x,y:rowTop,width,height},captionPt);
  const captionHeight=measured?.height||0,room=height-captionHeight-(measured?gap:0)-(pills.size?pillHeight+Math.round(gap/2):0),ratio=Number(image.content?.width)/Number(image.content?.height);
  if(!(ratio>0)||room<=INCH*.5)return null;
  const pictureWidth=Math.min(width,room*ratio),pictureHeight=pictureWidth/ratio;
  // Below a pill the figure starts at the top of its cell; else it is centred.
  const y=pills.size?rowTop:rowTop+(height-pictureHeight-captionHeight-(measured?gap:0))/2;
  boxes[i]={x:Math.round(x+(width-pictureWidth)/2),y:Math.round(y),width:Math.round(pictureWidth),height:Math.round(pictureHeight)};
  measurements[i]={lines:0,height:boxes[i].height,overflow:false,fontSizePt};
  if(measured){boxes[caption]={x:Math.round(x),y:Math.round(y+pictureHeight+gap),width:Math.floor(width),height:Math.ceil(captionHeight)};measurements[caption]={...measured,fontSizePt:captionPt,fontBasis:'figure_caption'};}
 }
 if(boxes.some(b=>!b||b.width<=0||b.height<=0)||measurements.some(m=>!m||m.overflow))return null;
 return {capacity_ok:true,predictedOverflow:0,canvas,fontSizePt,boxes,measurements,availableHeight:canvas.height,usedHeight:Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y)),layoutId:'figure-above-wide-caption',readingOrder:true,atomicReadingUnits:true,measurementBasis:'complete captions and proportional source images'};
}
export function figureLayoutScore(components,fit){
 if(!fit?.capacity_ok)return -Infinity;
 const images=components.flatMap((c,k)=>c.type==='image'?[fit.boxes[k]]:[]),captions=components.flatMap((c,k)=>c.content?.sourceImageCaptionId?[fit.boxes[k]]:[]);
 // Actual visual area dominates; wide captions break a close tie and reduce
 // narrow text towers. Original raster pixel size never caps display size.
 return images.reduce((n,b)=>n+b.width*b.height,0)+captions.reduce((n,b)=>n+b.width*INCH*.12,0);
}
export function sourceFigureScore(project,index,page){
 if(!page?.figurePage||!page.sourceImageIds?.length)return null;
 const images=page.sourceImageIds.map(id=>project.source?.images?.find(image=>image.id===id));if(images.some(i=>!i))return 1e11;
 const components=images.flatMap(sourceImageComponents),fit=wideFigureFit(components,project,index);
 return fit?Math.max(1,1e7-figureLayoutScore(components,fit)/INCH**2*10000):1e11;
}

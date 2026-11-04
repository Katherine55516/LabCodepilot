import {explicitLayoutLocks} from './ppt-layout-locks.mjs';
import {contentCanvas,INCH} from './ppt-density-capacity.mjs';
import {measureText} from './ppt/render-contract.mjs';

/** Equal-height, centered rows of certified bound containers. Frame rasters
 * retain their aspect ratios; text is measured at its existing font size.
 * This works on a copy first: an unfit/protected candidate changes nothing. */
export function balanceBoundContainers(project,slide,index){
 const text=slide.nodes.filter(n=>n.templateComponentBinding?.containerNodeId&&!n.templateComponentBinding.badge);
 if(text.length<2||text.length>6)return null;
 const explicitLocks=explicitLayoutLocks(project);
 const entries=text.map(node=>({node,frame:slide.nodes.find(n=>n.id===node.templateComponentBinding.containerNodeId)}));
 if(entries.some(e=>!e.frame?.geometry||explicitLocks.has(e.frame.id)||e.frame.content?.mustPreserve||e.frame.userGeometry||e.frame.userStyle||e.node.locked||e.node.userGeometry||e.node.userStyle||(project.templateFixedObjectIds||[]).includes(e.frame.id)))return null;
 const canvas=contentCanvas(project,index).geometry,gap=INCH*.18,candidates=[];
 // Preserve source/card order, rather than sorting by an already broken grid.
 for(let cols=Math.min(3,entries.length);cols>=1;cols--){
  const rows=Math.ceil(entries.length/cols),ratios=entries.map(e=>e.frame.geometry.width/e.frame.geometry.height);
  const maxWidthSum=Math.max(...Array.from({length:rows},(_,r)=>ratios.slice(r*cols,(r+1)*cols).reduce((a,b)=>a+b,0)));
  const h=Math.min((canvas.height-gap*(rows-1))/rows,(canvas.width-gap*(cols-1))/maxWidthSum,INCH*1.85);
  if(h<INCH*.8)continue;
  const changes=[];let fits=true;
  entries.forEach(({node,frame},k)=>{
   const row=Math.floor(k/cols),first=row*cols,count=Math.min(cols,entries.length-first),rowWidth=ratios.slice(first,first+count).reduce((a,b)=>a+b,0)*h+gap*(count-1);
   const x=canvas.x+(canvas.width-rowWidth)/2+ratios.slice(first,k).reduce((a,b)=>a+b,0)*h+gap*(k-first),y=canvas.y+(canvas.height-(rows*h+(rows-1)*gap))/2+row*(h+gap);
   const fg={x:Math.round(x),y:Math.round(y),width:Math.round(h*ratios[k]),height:Math.round(h)};
   const geometry={x:Math.round(x+.16*INCH),y:Math.round(y+.28*INCH),width:Math.round(fg.width-.32*INCH),height:Math.round(h-.44*INCH)};
   if(measureText({...node,kind:'text',bounds:geometry}).overflow)fits=false;
   changes.push({id:frame.id,geometry:fg,shapeId:frame.nativeRef?.shapeId},{id:node.id,geometry});
  });
  if(fits)candidates.push({cols,rows,changes,score:cols*100+h/INCH});
 }
 const best=candidates.sort((a,b)=>b.score-a.score)[0];if(!best)return null;
 for(const change of best.changes){const node=slide.nodes.find(n=>n.id===change.id);node.geometry=change.geometry;
  const artifact=slide.sourceArtifactNodes?.find(n=>n.id===change.id);if(artifact)artifact.geometry={...change.geometry};
  if(change.shapeId!==undefined){slide.templateAdaptations=(slide.templateAdaptations||[]).filter(a=>String(a.shapeId)!==String(change.shapeId));slide.templateAdaptations.push({shapeId:change.shapeId,action:'whole_component_reflow',geometry:change.geometry,componentBinding:node.templateComponentBinding});}
 }
 slide.adaptiveLayout={version:1,layoutId:'balanced-bound-containers',columns:best.cols,rows:best.rows,basis:'equal row height, centered grid, proportional frame images and complete existing text at unchanged font'};
 return best;
}

/** Three bounded components, measured by the shared Render Contract.
 * No whole-page shrink and no content synthesis. Explicit user geometry wins. */
import {applyRenderContract,measureText} from './render-contract.mjs';
import {equationDimensions} from '../ppt-math.mjs';
import {_internals as pointMeasures} from './point-layout.mjs';
const E=914400;
const bounds=(x,y,w,h)=>({x:Math.round(x*E),y:Math.round(y*E),width:Math.round(w*E),height:Math.round(h*E)});
export const COMPONENT_LAYOUTS=['two-panel','formula-variables','item-icons'];
export function componentElements(project,slide,typography) {
  if(!COMPONENT_LAYOUTS.includes(slide.layoutId))return null;
  const fonts=project.templateSpec?.fonts||{},palette=project.templateSpec?.palette||{},elements=[];
  const style={fontFamily:fonts.body,eastAsiaFontFamily:fonts.bodyEastAsia,color:palette.foreground,fontSizePt:Math.max(15,typography.bodyPt||17),lineHeight:1.18,paragraphSpacingEm:.2};
  const emit=(node,frame,kind=node.type,content=node.content,extra={})=>{
    const element={id:node.id,nodeId:node.id,kind,bounds:node.geometry||frame,content,style:{...style,...node.style},zIndex:node.zIndex??20,
      locked:Boolean(node.locked),semanticRole:node.semanticRole,sourceArtifact:node.sourceArtifact,groupId:node.groupId,rotation:node.rotation||0,...extra};
    if(content?.mathMl) {
      const natural=equationDimensions(content,Number(element.style.fontSizePt||17));
      const width=natural.widthPt*12700,height=natural.heightPt*12700,box=element.bounds;
      element.mathLayout={bounds:{x:box.x,y:box.y+Math.max(0,(box.height-height)/2),width,height},
        overflow:width>box.width||height>box.height,...natural};
    }
    elements.push(applyRenderContract(element));return element;
  };
  const title=slide.nodes.find(x=>x.semanticRole==='title');
  if(title)emit(title,bounds(.86,.58,11.55,.9),'text',title.content,{style:{...style,...title.style,fontFamily:fonts.title,fontSizePt:typography.titlePt||32,fontWeight:700}});
  const nodes=slide.nodes.filter(x=>x!==title&&!['eyebrow','subtitle','takeaway','page-number'].includes(x.semanticRole));
  const body=nodes.find(x=>x.semanticRole==='body'&&x.type==='list');
  const icons=nodes.filter(x=>x.semanticRole==='item-icon'&&x.templateMediaBinding);
  if(slide.layoutId==='item-icons'&&body) {
    const items=body.content?.items||[],frame=body.geometry||bounds(.86,1.78,11.55,4.85);
    const columns=items.length>3?2:1,rows=Math.ceil(items.length/columns),gap=.22;
    const width=(frame.width/E-gap*(columns-1))/columns,height=(frame.height/E-gap*(rows-1))/Math.max(1,rows);
    const fontSizePt=Number(body.style?.fontSizePt||style.fontSizePt),boxes=[];
    let overflow=false;
    items.forEach((item,i)=>{
      const x=(i%columns)*(width+gap),y=Math.floor(i/columns)*(height+gap);
      const icon=icons.find(x=>x.templateMediaBinding.itemId===item.id||x.templateMediaBinding.itemIndex===i);
      const reserved=icon?Math.min(.64,width*.25):0;
      if(icon) {
        const size=Math.min(.46,reserved*.8,height*.4);
        const iconFrame=icon.geometry||bounds(frame.x/E+x,frame.y/E+y,size,size);
        // Template icons can be white-on-transparent: preserve a contrast carrier.
        elements.push({id:`carrier_${icon.id}`,nodeId:null,semanticRole:'icon-carrier',kind:'shape',bounds:iconFrame,content:{shape:'rect'},style:{fill:icon.content?.carrierColor||palette.accent},zIndex:(icon.zIndex??30)-1,groupId:icon.id,locked:true});
        emit(icon,iconFrame,'image');
      }
      const w=width-reserved;
      overflow ||= w<=0||height<=0||pointMeasures.requiredHeight(pointMeasures.pointParts(item),w,fontSizePt)>height;
      boxes.push({x:(x+reserved)*E/frame.width,y:y*E/frame.height,w:w*E/frame.width,h:height*E/frame.height});
    });
    // One canonical list remains one editable object. Derived boxes must never
    // masquerade as fragments whose edits replace their parent list's content.
    emit(body,frame,'list',{...body.content,pointLayout:{boxes,fontSizePt,overflow,columns,suggestedSplitCount:overflow?2:1}});
    for(const node of nodes.filter(x=>x!==body&&!icons.includes(x)))emit(node,bounds(.86,6.7,11.55,.25));
  } else if(slide.layoutId==='formula-variables') {
    const formula=nodes.find(x=>x.content?.mathMl||x.content?.latex||x.sourceArtifact?.type==='EquationBlock');
    const rest=nodes.filter(x=>x!==formula);
    if(formula)emit(formula,bounds(.86,1.9,6.55,3.9));
    rest.forEach((node,i)=>emit(node,bounds(7.7,1.9+i*(4.75/Math.max(1,rest.length)),4.71,4.75/Math.max(1,rest.length)-.12)));
  } else {
    // Unequal panels: split a single list at its middle, preserving item order;
    // otherwise keep each existing component atomic, never split a table column.
    const split=nodes.length===1&&body?(body.content.items||[]):null;
    const groups=split?[split.slice(0,Math.ceil(split.length/2)),split.slice(Math.ceil(split.length/2))]:null;
    const units=groups?groups.map(g=>g.reduce((n,x)=>n+String(x.text||x.body||'').length,0)):nodes.map(x=>String(x.content?.text||JSON.stringify(x.content)).length);
    const ratio=Math.max(.4,Math.min(.65,(units[0]||1)/Math.max(1,units.reduce((a,b)=>a+b,0))));
    const left=11.25*ratio,right=11.25-left,frames=[bounds(.86,1.78,left,4.95),bounds(.86+left+.3,1.78,right,4.95)];
    if(groups) {
      const frame=body.geometry||bounds(.86,1.78,11.55,4.95),w=frame.width/E,h=frame.height/E;
      const fontSizePt=Number(body.style?.fontSizePt||style.fontSizePt),boxes=[];
      const gap=Math.min(.3,w*.05),panelWidths=[(w-gap)*ratio,(w-gap)*(1-ratio)];
      let overflow=false;
      groups.forEach((items,column)=>{
        const pw=panelWidths[column],rowGap=.14,available=h-rowGap*Math.max(0,items.length-1);
        const needs=items.map(item=>pointMeasures.requiredHeight(pointMeasures.pointParts(item),pw,fontSizePt));
        const total=needs.reduce((a,b)=>a+b,0);overflow ||= total>available||available<=0;
        let y=0;
        needs.forEach(need=>{
          const height=total<=available?need+(available-total)/Math.max(1,items.length):Math.max(.01,available)*need/Math.max(.01,total);
          boxes.push({x:column?(panelWidths[0]+gap)/w:0,y:y/h,w:pw/w,h:height/h});y+=height+rowGap;
        });
      });
      emit(body,frame,'list',{...body.content,pointLayout:{boxes,fontSizePt,overflow,columns:2,suggestedSplitCount:overflow?2:1}});
    }
    else nodes.forEach((node,i)=>{const column=i%2,row=Math.floor(i/2),count=Math.ceil((nodes.length-column)/2),frame=frames[column];emit(node,{...frame,y:frame.y+Math.round(row*frame.height/count),height:Math.round(frame.height/count-.12*E)});});
  }
  // Auxiliary copy remains visible instead of being silently dropped by a prototype.
  for(const node of slide.nodes.filter(x=>['eyebrow','subtitle','takeaway','page-number'].includes(x.semanticRole)&&x.content?.text)) {
    const y=node.semanticRole==='eyebrow'?.28:node.semanticRole==='subtitle'?1.5:6.82;
    emit(node,bounds(.86,y,11.55,.24),'text',node.content,{style:{...style,fontSizePt:11}});
  }
  return elements.sort((a,b)=>a.zIndex-b.zIndex);
}
export function componentCapacity(elements) {
  return elements.filter(x=>['text','list'].includes(x.kind)).map(element=>({nodeId:element.nodeId,...measureText(element)}));
}

/** Materialize generated source-artifact geometry once; later editor geometry wins. */
export function prepareComponentGeometry(project,slide) {
  if(!COMPONENT_LAYOUTS.includes(slide.layoutId)||slide.componentPrepared)return;
  const clone=structuredClone(slide);
  for(const node of clone.nodes||[])if(!node.locked&&(node.sourceArtifact||node.semanticRole==='source-explanation'))delete node.geometry;
  const elements=componentElements(project,clone,{titlePt:32,bodyPt:17});
  for(const node of slide.nodes||[])if(!node.locked&&(node.sourceArtifact||node.semanticRole==='source-explanation')) {
    const element=elements?.find(x=>x.nodeId===node.id);if(element)node.geometry=element.bounds;
  }
  slide.componentPrepared={version:1,layoutId:slide.layoutId};
}

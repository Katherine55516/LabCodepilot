import {_internals as text} from './ppt/point-layout.mjs';
import {measureText,textContract,CARD_PADDING} from './ppt/render-contract.mjs';
const INCH=914400;
const measurements=new Map(),RAIL_INSET=.42;

/** A source process keeps every step and its original order. The layout uses
 * the same card/text metrics as React, SVG and native PPTX; no font search. */
export function processCardItems(content,{numberPlacement='stacked'}={}){
  if(!content?.processSource||!Array.isArray(content.items)||content.items.length<2||content.items.length>24)return null;
  return content.items.map((item,index)=>{const body=item.richText?.source??item.text??'',prefix=(index+1)+'. ';return {...item,heading:numberPlacement==='inline'?'':String(index+1),body:numberPlacement==='inline'?prefix+body:body,bodyRich:numberPlacement==='inline'&&item.richText?{...item.richText,source:prefix+body,runs:[{kind:'text',text:prefix},...(item.richText.runs||[])]}:item.richText};});
}
export function processCardPlan(content,geometry,fontSizePt,{lineHeight=1.18}={}){
  const items=processCardItems(content);if(!items)return null;
  const flowRow=candidate=>items.length>=3&&items.length<=5&&candidate.columns===items.length;
  const badgeBand=Math.max(0,Number(content.badgeInsetPt)||0)/72;
  // Up to six steps of a template with a dark panel stand in one column on a
  // rail (Fable M2, 2026-11-02, the hand deck's four training steps); a rail
  // that does not fit falls back to the arrowed layouts below.
  const rail=Boolean(content.rail)&&items.length<=6;
  const key=JSON.stringify([3,geometry.width,geometry.height,fontSizePt,lineHeight,badgeBand,rail,items.map(i=>[i.heading,i.body])]);
  const copy=plan=>({...plan,boxes:plan.boxes.map(b=>({...b})),items:processCardItems(content,{numberPlacement:plan.numberPlacement})});
  if(measurements.has(key))return copy(measurements.get(key));
  // Columns leave room for the flow arrow between neighbouring steps.
  const width=geometry.width/INCH,height=geometry.height/INCH,gap=.14,colGap=.32;
  if(rail){
    const inset=RAIL_INSET,cellWidth=width-inset,variantItems=processCardItems(content,{numberPlacement:'inline'});
    const needs=variantItems.map(item=>text.requiredHeight(text.pointParts(item),cellWidth,fontSizePt,lineHeight));
    const measured=variantItems.map(item=>{const element={kind:'text',bounds:{width:cellWidth*INCH,height:1e12},content:{text:item.body,richText:item.bodyRich},style:{fontSizePt,lineHeight}};return measureText(element,textContract(element,CARD_PADDING));});
    const neededHeight=needs.reduce((a,b)=>a+b,0)+gap*(needs.length-1);
    if(cellWidth>=1.35&&neededHeight<=height&&!measured.some(fit=>fit.widthOverflow||fit.brokenWords)){
      const frameHeight=Math.max(.01,neededHeight),boxes=[];let y=0;
      for(const need of needs){boxes.push({x:inset/width,y:y/frameHeight,w:cellWidth/width,h:need/frameHeight});y+=need+gap;}
      const plan={version:1,basis:'complete_ordered_source_steps',numberPlacement:'inline',boxes,fontSizePt,lineHeight,columns:1,brokenWords:0,overflow:false,requiredHeight:Math.ceil(neededHeight*INCH),rail:{x:inset/2/width},suggestedSplitCount:1};
      if(measurements.size>=256)measurements.delete(measurements.keys().next().value);measurements.set(key,plan);
      return copy(plan);
    }
  }
  const columns=[1,2,3,4,5].filter(n=>n<=items.length&&(width-colGap*(n-1))/n>=1.35);
  if(!columns.length)return null;
  const candidates=['stacked','inline'].flatMap(numberPlacement=>columns.map(columns=>{
    const variantItems=processCardItems(content,{numberPlacement}),rows=[];for(let i=0;i<variantItems.length;i+=columns)rows.push(variantItems.slice(i,i+columns));
    const cellWidth=(width-colGap*(columns-1))/columns;
    // A row of step cards with template icon badges keeps a band above them (Fable media decision S3).
    const needs=rows.map(row=>Math.max(...row.map(item=>text.requiredHeight(text.pointParts(item),cellWidth,fontSizePt,lineHeight)))+badgeBand);
    const measured=variantItems.map(item=>{const element={kind:'text',bounds:{width:cellWidth*INCH,height:1e12},content:{text:item.body,richText:item.bodyRich},style:{fontSizePt,lineHeight}};return measureText(element,textContract(element,CARD_PADDING));});
    const widthOverflow=measured.some(fit=>fit.widthOverflow),brokenWords=measured.reduce((n,fit)=>n+fit.brokenWords,0);
    const neededHeight=needs.reduce((a,b)=>a+b,0)+gap*(rows.length-1);
    return {columns,rows,needs,neededHeight,numberPlacement,brokenWords,overflow:neededHeight>height||widthOverflow};
  // Three to five steps that fit read as one arrowed flow, left to right (Fable S1a, 2026-11-01),
  // unless a narrower column breaks a word inside ("initiali|zed"): fewer breaks first.
  })).sort((a,b)=>Number(a.overflow)-Number(b.overflow)||a.brokenWords-b.brokenWords||Number(flowRow(b))-Number(flowRow(a))||a.neededHeight-b.neededHeight||a.columns-b.columns||Number(a.numberPlacement==='inline')-Number(b.numberPlacement==='inline'));
  const best=candidates[0],frameHeight=Math.max(.01,best.neededHeight),boxes=[];
  let y=0;best.rows.forEach((row,r)=>{row.forEach((_,c)=>boxes.push({x:c*((width-colGap*(best.columns-1))/best.columns+colGap)/width,y:(y+badgeBand)/frameHeight,w:(width-colGap*(best.columns-1))/best.columns/width,h:(best.needs[r]-badgeBand)/frameHeight}));y+=best.needs[r]+gap;});
  const plan={version:1,basis:'complete_ordered_source_steps',numberPlacement:best.numberPlacement,boxes,fontSizePt,lineHeight,...(badgeBand?{badgeInsetPt:Number(content.badgeInsetPt)}:{}),columns:best.columns,brokenWords:best.brokenWords,overflow:best.overflow,requiredHeight:Math.ceil(best.neededHeight*INCH),suggestedSplitCount:best.overflow?Math.max(2,Math.ceil(best.neededHeight/Math.max(.1,height))):1};
  if(key.length<8000){if(measurements.size>=256)measurements.delete(measurements.keys().next().value);measurements.set(key,plan);}
  return copy(plan);
}

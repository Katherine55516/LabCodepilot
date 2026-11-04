// A figure page never takes a photo frame (Fable D2, 2026-11-01: the CodePilot
// PDF's diagram sat beside a half-page decorative photo on Mood-Board).
import assert from 'node:assert/strict';
import {figurePhotoCost,FIGURE_PHOTO_COST} from './lib/ppt-card-pages.mjs';
const W=12192000,H=6858000,inch=914400;
const photo={id:'photo',type:'image',nativeRef:{slideIndex:1,shapeId:7},geometry:{x:0,y:0,width:5.2*inch,height:H},content:{mediaRole:'template_decoration'}};
const icon={id:'icon',type:'image',nativeRef:{slideIndex:1,shapeId:8},geometry:{x:12*inch,y:.2*inch,width:.4*inch,height:.4*inch},content:{mediaRole:'template_icon'}};
// The template's content frame is the right half; the photo fills the left.
const frame={id:'frame',type:'text',nativeRef:{slideIndex:1,shapeId:9},geometry:{x:5.6*inch,y:1.2*inch,width:6.9*inch,height:5.6*inch},style:{fontSizePt:18},content:{text:'Body'}};
const project=nodes=>({planningContract:{version:3},outline:[{id:'c'},{id:'f',figurePage:true,sourceImageIds:['img']}],templateFidelity:{mode:'preserve',width:W,height:H,slides:[{nodes:[]},{nodes:[frame,...nodes],slots:[{role:'content',shapeId:9}]}]}});
assert.equal(figurePhotoCost(project([photo,icon]),1),FIGURE_PHOTO_COST,'a half-page photo costs');
assert.equal(figurePhotoCost(project([icon]),1),0,'an icon does not');
assert.equal(figurePhotoCost(project([]),1),0);
assert.ok(FIGURE_PHOTO_COST>1e7&&FIGURE_PHOTO_COST<1e11,'above any figure layout score, below a failed fit');
console.log('PASS figure pages: a template photo frame costs more than any figure layout');

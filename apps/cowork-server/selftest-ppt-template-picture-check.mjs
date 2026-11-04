// Template pictures read by the vision reader when OCR is unavailable (Fable,
// 2026-10-25; 3143 g5b/g5c: a "COMPANY NAME" pill picture reached the deck).
import assert from 'node:assert/strict';
import {checkTemplatePictures} from './lib/ppt-template-picture-check.mjs';

const W=12192000,H=6858000;
const picture=(id,role,box,extra={})=>({id,type:'image',nativeRef:{shapeId:id.length},geometry:box,content:{dataUrl:'data:image/png;base64,'+Buffer.from(id).toString('base64'),imageSha256:id,mediaRole:role,ocr:{status:'unavailable'},...extra}});
const catalog=()=>[{nodes:[picture('pill','template_icon',{x:6e6,y:2.7e6,width:1.6e6,height:6.3e5})]},
  {nodes:[picture('art','old_template_content',{x:0,y:0,width:W/2,height:H})]},
  {nodes:[picture('portrait','old_template_content',{x:0,y:0,width:W/3,height:H})]},
  {nodes:[picture('logo-wall','old_template_content',{x:0,y:0,width:W/3,height:H/3},{retiredDecorationBasis:'logo wall of the old deck'})]},
  {nodes:[picture('icon','template_icon',{x:0,y:0,width:2e5,height:2e5})]}];
const answers={pill:{text:true,people:false},art:{text:false,people:false},portrait:{text:false,people:true},'logo-wall':{text:false,people:false}};
const calls=[];
const call=async(project,prompt,options)=>{calls.push(options);const ids=options.images.map(image=>Buffer.from(image.dataUrl.split(',')[1],'base64').toString());
  return {pictures:options.images.map((image,k)=>({id:image.id,...answers[ids[k]]}))};};
const project=(routes={vision_reader:{primary:{model:'v'}}})=>({executionPolicy:{roleRoutes:routes},templateFidelity:{mode:'preserve',width:W,height:H,sourceCatalog:catalog()}});

// Without a vision reader nothing changes.
{const p=project({});assert.equal(await checkTemplatePictures(p,call),null);assert.equal(calls.length,0);}
{const p=project(),results=await checkTemplatePictures(p,call);
 assert.equal(calls.length,1,'one batched call');assert.ok(!('icon' in results),'icons below the size floor are not sent');
 const role=id=>p.templateFidelity.sourceCatalog.flatMap(slide=>slide.nodes).find(node=>node.id===id).content.mediaRole;
 assert.equal(role('pill'),'old_template_content','a picture with drawn text is retired');
 assert.equal(role('art'),'template_decoration','a foreground picture without text or people is kept as decoration');
 assert.equal(role('portrait'),'old_template_content','a picture of people stays retired');
 assert.equal(role('logo-wall'),'old_template_content','a picture retired for another reason stays retired');
 // Cached by hash: a second check sends nothing.
 calls.length=0;await checkTemplatePictures(p,call);assert.equal(calls.length,0,'results are cached by image hash');}
console.log('PPT template picture check: drawn text retires, plain decoration is kept, people and other retirements stay, cached by hash: OK');

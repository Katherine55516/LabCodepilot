// A card's objects that do not fit one page go over the fewest pages that
// hold them, in order and spread evenly (Fable 2026-10-27, option B; 3157 d1:
// nine one-line LSTM/GRU equations went one per page).
import assert from 'node:assert/strict';
import {fitObjectPage,objectContinuation} from './lib/ppt-card-pages.mjs';
import {splitCardPage} from './lib/ppt-outline-cards.mjs';

const IN=914400;
const frame=h=>({slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:60},{role:'content',shapeId:10}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},geometry:{x:.6*IN,y:.3*IN,width:11.9*IN,height:.8*IN},style:{fontSizePt:28}},{id:'c',type:'text',nativeRef:{shapeId:10,contractVersion:2},geometry:{x:.6*IN,y:1.4*IN,width:11.9*IN,height:h*IN},style:{fontSizePt:14}}]});
const gates=['f','i','o','g','c','h','z','r','u'];
const items=gates.map((gate,k)=>({id:'eq'+k,type:'EquationBlock',text:`${gate}_t = \\sigma(W_${gate} x_t + U_${gate} h_{t-1} + b_${gate})`,source_ref:['s'+k],chunkRefs:['c'+k]}));
const make=(h,n=gates.length,points=[])=>{
 const objects=items.slice(0,n).map(item=>item.id),page={id:'page_eq',title:'LSTM Gate Equations',logicalCardId:'card_lstm',section:'RNNs',cardObjects:objects,keyPoints:points,sourceUnitIds:objects};
 return{page,project:{templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[frame(h),frame(h)]},source:{text:'',semantic:{inventory:{items:items.slice(0,n),relationships:[]}}},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},outline:[{id:'cover',title:'Cover'},page],
  planning:{slidePlan:[{slideId:'page_eq',sourceArtifacts:objects.map(sourceUnitId=>({sourceUnitId}))}]}}};
};
// A part fits when its objects and every point riding with it fit together.
const fitsAlone=(h,ids,points=[])=>{const {project,page}=make(h,gates.length,points),fitted=fitObjectPage(project,1,{...page,cardObjects:ids,keyPoints:points},{planned:false});return Boolean(fitted)&&fitted.kept===points.length;};

// A frame that holds some of the equations but not all nine.
const h=[1,1.2,1.5,2,2.4,3].find(height=>!fitsAlone(height,items.map(item=>item.id))&&fitsAlone(height,items.slice(0,3).map(item=>item.id)));
assert.ok(h,'a frame height that holds three equations but not nine');
const point=(text,ids)=>({text,sourceUnitIds:ids});
const points=[point('The forget gate decides what the cell keeps.',['eq0']),point('Gates use the previous hidden state.',[]),point('GRU merges the forget and input gates.',['eq6'])];
const {project,page}=make(h,gates.length,points);
const hint=objectContinuation(project,1,page,{planned:false});
assert.ok(Array.isArray(hint?.groups),'measured groups, not one object per page: '+JSON.stringify(hint));
const groups=hint.groups;
// The fewest parts: one fewer does not hold the objects.
assert.ok(groups.length>=2&&groups.length<gates.length,String(groups.length));
assert.deepEqual(groups.flat(),items.map(item=>item.id),'every object once, in order');
const sizes=groups.map(group=>group.length);assert.ok(Math.max(...sizes)-Math.min(...sizes)<=1,'spread evenly: '+sizes);
// Each part fits its page with the points that ride with it.
const owner=entry=>items.map(item=>item.id).find(id=>entry.sourceUnitIds.includes(id))||'eq0';
for(const group of groups)assert.ok(fitsAlone(h,group,points.filter(entry=>group.includes(owner(entry)))),'part fits: '+group);
// One fewer part would not fit: the count is the smallest even split that fits.
{const n=groups.length-1,fewer=n<2?null:Array.from({length:n},(_,k)=>items.map(item=>item.id).slice(Math.round(k*gates.length/n),Math.round((k+1)*gates.length/n)));
 if(fewer)assert.ok(fewer.some(group=>group.length>1&&!fitsAlone(h,group,points.filter(entry=>group.includes(owner(entry))))),'n-1 parts do not fit');}

// The split follows the groups: points ride with the first object they cite; loose points open part 1.
{const raw={slides:[{id:'cover',title:'Cover'},page]};
 const proposal=splitCardPage({...project,planningContract:{version:3,flow:'cards'}},raw,1,{...hint,beforeSchedule:true});
 const pages=proposal.raw.slides.slice(1);
 assert.equal(pages.length,groups.length);
 assert.deepEqual(pages.map(slide=>slide.cardObjects),groups);
 assert.deepEqual(pages[0].keyPoints.map(entry=>entry.text),['The forget gate decides what the cell keeps.','Gates use the previous hidden state.',...(groups[0].includes('eq6')?['GRU merges the forget and input gates.']:[])]);
 const gru=pages.findIndex(slide=>slide.cardObjects.includes('eq6'));assert.ok(pages[gru].keyPoints.some(entry=>entry.text.startsWith('GRU')),'a point rides with the object it cites');
 assert.match(proposal.change.reason,/as few pages as hold them, spread evenly/u);
 assert.deepEqual(pages.slice(1).map(slide=>slide.title),pages.slice(1).map(()=>'LSTM Gate Equations (cont.)'),'later parts are marked; the numbering pass counts them');}

console.log('selftest-ppt-object-packing: ok');

// Points spilling from an early table/object part follow all its object parts.
{const {project,page}=make(h,2,[point('First explanation.',['eq0']),point('Second explanation.',['eq0']),point('Third explanation.',['eq0'])]);
 const first={...page,cardObjects:['eq0']},second={...page,id:'object-part-2',cardObjects:['eq1'],keyPoints:[]};
 const out=splitCardPage(project,{slides:[{id:'cover'},first,second,{id:'closing'}]},1,{kept:1});
 assert.deepEqual(out.raw.slides.slice(1,4).map(s=>s.cardObjects),[['eq0'],['eq1'],[]]);
 assert.deepEqual(out.raw.slides[3].keyPoints.map(p=>p.text),['Second explanation.','Third explanation.']);}

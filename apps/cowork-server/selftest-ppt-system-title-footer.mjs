import assert from 'node:assert/strict';
import {fitSystemTitleFrames} from './lib/ppt-system-title-fit.mjs';
import {applyRenderContract,measureText} from './lib/ppt/render-contract.mjs';
const title=()=>({id:'title',kind:'text',semanticRole:'title',bounds:{x:786384,y:621792,width:10561320,height:1019556},content:{text:'Validation rules for inputs and weights'},style:{fontFamily:'Noto Sans CJK SC',fontSizePt:44,lineHeight:1.12,fontWeight:700}});
const body=height=>({id:'code',kind:'text',semanticRole:'source-structure',bounds:{x:792480,y:2923337,width:10607040,height},content:{text:'def validate(values):\n    return values'},style:{fontSizePt:18}});
const footer={id:'page',kind:'text',semanticRole:'page-number',bounds:{x:10881360,y:6428232,width:475488,height:256032},content:{text:'3'},style:{fontSizePt:11}};
function scene(height){const result={size:{width:12192000,height:6858000},elements:[title(),{...body(1062533),id:'prose',bounds:{x:792480,y:1714500,width:10607040,height:1062533}},body(height),structuredClone(footer)]};result.elements.forEach(applyRenderContract);return result;}
const tight=scene(3328416),before=structuredClone(tight);assert.ok(measureText(tight.elements[0]).overflow);fitSystemTitleFrames(tight);
assert.deepEqual(tight.elements.map(e=>e.bounds),before.elements.map(e=>e.bounds),'never translate a body into page-number ink; unresolved title stays visible to the normal gate');assert.ok(measureText(tight.elements[0]).overflow);
const roomy=scene(2600000);fitSystemTitleFrames(roomy);assert.equal(measureText(roomy.elements[0]).overflow,false,'two-line growth still works with real free space');
const code=roomy.elements.find(e=>e.id==='code');assert.ok(code.bounds.y+code.bounds.height<=footer.bounds.y-914400*.08);assert.equal(code.bounds.height,2600000);assert.deepEqual(roomy.elements.at(-1).bounds,footer.bounds);
const manual=scene(2600000);manual.elements[2].userGeometry=true;const manualBefore=structuredClone(manual);fitSystemTitleFrames(manual);assert.deepEqual(manual.elements.map(e=>e.bounds),manualBefore.elements.map(e=>e.bounds));
console.log('Two-line adaptation respects actual footer ink, preserves source sizes and user geometry, and remains enabled with sufficient real whitespace.');

const {contentCanvas}=await import('./lib/ppt-density-capacity.mjs');
const {candidateFit}=await import('./lib/ppt-density-packing.mjs');
const project={pages:3,outline:[{title:'Cover'},{id:'body',title:'Validation rules for inputs and weights'},{title:'Thanks for watching!'}]};
const canvas=contentCanvas(project,1).geometry;assert.ok(canvas.y>=914400*1.92);assert.ok(canvas.y+canvas.height<=footer.bounds.y-914400*.08);
const long={...project.outline[1],title:'Validation rules for inputs and weights: preserve all conditions',keyPoints:[{text:'Check the original evidence.'}]};
const candidate=candidateFit(long,project,1);const actual=contentCanvas({...project,outline:[project.outline[0],long,project.outline[2]]},1).geometry;assert.deepEqual(candidate.availableContentRect,actual,'measured pagination uses the actual candidate topic rather than a previous page title');assert.equal(project.outline[1].title,'Validation rules for inputs and weights');

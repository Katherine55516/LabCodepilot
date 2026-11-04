import assert from 'node:assert/strict';
import {nativeContentLayout} from './lib/ppt/native-content-layout.mjs';
const I=914400;
const content=[{id:'a',type:'text',sourceArtifact:{sourceUnitId:'source-a'},geometry:{x:I,y:2*I,width:5*I,height:I},style:{fontSizePt:18},content:{text:'Only the source-owned content frames may move.'}},{id:'b',type:'text',sourceArtifact:{sourceUnitId:'source-b'},geometry:{x:7*I,y:2*I,width:4*I,height:I},style:{fontSizePt:18},content:{text:'Keep the applicability and source selection unchanged.'}}];
const slide={id:'s',nodes:[{id:'brand',type:'text',nativeRef:{shapeId:1},geometry:{x:I,y:I*.3,width:10*I,height:I*.5},content:{text:'Protected template title'}},...content]};
const p={pages:3,outline:[{id:'cover'},{id:'s'},{id:'closing'}],deck:{slides:[{id:'cover',nodes:[]},slide,{id:'closing',nodes:[]}]},templateFidelity:{mode:'preserve',width:13.333*I,height:7.5*I,slides:[{}, {nodes:[]},{}]},source:{text:'Authoritative content'},runtime:{slides:{}}};
const before=structuredClone(p);const changes=nativeContentLayout(p,{scope:'slide',slideId:'s'});
assert.deepEqual(p,before,'preview must not mutate source, geometry or template');assert.equal(changes[0].type,'nodes.setGeometry');assert.deepEqual(new Set(changes[0].payload.changes.map(c=>c.nodeId)),new Set(['a','b']));
for(const c of changes[0].payload.changes){assert.ok(c.geometry.y>slide.nodes[0].geometry.y+slide.nodes[0].geometry.height);assert.ok(c.geometry.x>=0&&c.geometry.x+c.geometry.width<=p.templateFidelity.width);}
slide.nodes[1].locked=true;assert.throws(()=>nativeContentLayout(p,{scope:'slide',slideId:'s'}),/unlock/);delete slide.nodes[1].locked;
slide.nodes[1].userGeometry=true;assert.throws(()=>nativeContentLayout(p,{scope:'slide',slideId:'s'}),/unlock/);delete slide.nodes[1].userGeometry;
assert.throws(()=>nativeContentLayout(p,{scope:'object',slideId:'s',nodeIds:['a','brand']}),/unlock/);
slide.nodes.push({id:'protected-picture',type:'image',nativeRef:{shapeId:9},geometry:{x:I,y:2*I,width:11*I,height:4*I}});assert.throws(()=>nativeContentLayout(p,{scope:'slide',slideId:'s'}),/intersect/);
console.log('PASS native content reflow: source-owned-only geometry, preview immutability, preserved branding/font/source/count, locked/manual/foreign targets and protected native intersections rejected.');

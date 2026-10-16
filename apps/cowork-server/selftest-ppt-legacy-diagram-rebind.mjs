import assert from 'node:assert/strict';
import {sourceComponent} from './lib/ppt-density-capacity.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {reviewSourceStructure} from './lib/ppt-review-source-structure.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
const drawing='Planner\n  ↓\nimage_required?\n  ├─ No → render\n  │\n  └─ Yes\n    Image Intent → Source Router\n   ↙    ↓    ↘\n stock web   gen\n    result media → Card';
const item={id:'legacy_diagram',type:'TableBlock',must_preserve_structure:true,mustDisplay:true,text:'Planner image_required?\nImage Intent Source Router stock web gen result media Card',rows:[[''],['Planner image_required?'],['Image Intent Source Router stock web gen result media Card']],diagramSource:{kind:'ascii',relation:'parallel',text:drawing,presentation:'ordered_rows'}};
const ref={sourceUnitId:item.id,type:'TableBlock',rowStart:1,rowEnd:3};
const p={id:'legacy-drawing-test',pages:3,revision:5,source:{text:drawing,sha256:'immutable-input',semantic:{inventory:{items:[item]}}},template:'violet',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='violet')),generationPolicy:{content:'full_source',language:{mode:'source'}},outline:[{id:'cover',title:'Media'},{id:'body',title:'Image routing',sourceUnitIds:[item.id]},{id:'end',title:'Thanks for watching!'}],planning:{slidePlan:[{slideId:'body',sourceArtifacts:[ref]}]},deck:{slides:[]},editing:{epochs:{body:1}}};
const source=JSON.stringify(p.source),outline=JSON.stringify(p.outline),body={id:'body',title:'Image routing',nodes:[],nodeOrder:[]};
bindSourceArtifacts(p,body,[ref],1);p.deck.slides=[body];const node=body.sourceArtifactNodes[0];assert.equal(node.type,'text');assert.equal(node.content.text,drawing);assert.equal(node.content.codeBlock.sourceText,drawing);assert.equal(inspectObjectIntegrity(p).issues.length,0);assert.equal(reviewSourceStructure(node,p).kind,'literal_ascii_diagram');assert.equal(JSON.stringify(p.source),source);assert.equal(JSON.stringify(p.outline),outline);
for(const change of [n=>n.content.text=n.content.text.replace('No → render','No'),n=>n.content.codeBlock.sourceText='Other diagram',n=>n.content.text=n.content.text.replace('  └─ Yes','└─ Yes')]){const bad=structuredClone(p);const n=bad.deck.slides[0].nodes.find(n=>n.sourceArtifact);change(n);assert.equal(inspectObjectIntegrity(bad).issues.length>0,true,'missing branch, changed source witness or indentation cannot pass');}
assert.throws(()=>sourceComponent(item,{rowStart:1,rowEnd:2}),/complete original source scope/);
const realTable={...item,diagramSource:undefined};assert.equal(sourceComponent(realTable,ref).type,'table','real tables retain exact rows');
console.log('Legacy compact ASCII tables restore all literal branches without source/outline edits; partial scope, missing branch, source witness and indentation negatives pass.');

const modern={...item,rows:[[''],...drawing.split('\n').map(line=>[line])]};const fragment=sourceComponent(modern,{rowStart:1,rowEnd:5});assert.equal(fragment.type,'table');assert.ok(sourceComponent(modern).content.rows.flat().some(s=>s.includes('No → render')));assert.equal(modern.rows.slice(1).map(r=>r[0]).join('\n'),drawing);

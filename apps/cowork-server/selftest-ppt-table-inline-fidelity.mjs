/** Table cells are inline content: comparison signs and literal labels are facts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {sourceRichText,ensureRichContent} from './lib/ppt-rich-text.mjs';
import {sourceComponent} from './lib/ppt-density-capacity.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {renderPptx} from './lib/ppt-render.mjs';import {localPptRuntime} from './test/ppt-local-runtime.mjs';
const rows=[['Horizon','Threshold','Meaning'],['Daily','> 0.05','**Strong**, check leakage'],['Monthly','> 0.05','$x_i > 0$'],['Label','1. Stage 5','# literal label']];
for(const value of ['> 0.05','< 0.05','1. Stage 5','# literal label','    indented value'])assert.equal(sourceRichText(value,{inline:true}).plainText,value);
assert.equal(sourceRichText('> quoted paragraph').plainText,'quoted paragraph','ordinary block quotes retain the block contract');
assert.equal(sourceRichText('> quoted paragraph',{inline:true}).plainText,'> quoted paragraph','inline cache must not reuse block projection');
const item={id:'thresholds',type:'TableBlock',must_preserve_structure:true,rows,text:rows.map(r=>r.join(' | ')).join('\n'),source_ref:['1']};
const component=sourceComponent(item);assert.equal(component.content.rows[1][1],'> 0.05');assert.equal(component.content.rows[2][1],'> 0.05');
const legacy=structuredClone(component.content);legacy.rows[1][1]='0.05';legacy.cellRich[1][1]={version:6,source:'> 0.05',plainText:'0.05',runs:[{kind:'text',text:'0.05'}],diagnostics:[]};
assert.equal(ensureRichContent(legacy).rows[1][1],'> 0.05','old source-backed cells rebuild from their unchanged raw source');
const I=914400,p={id:'table-inline',source:{sha256:'immutable',semantic:{inventory:{items:[item]}}},template:'violet',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='violet')),outline:[{id:'one',sourceUnitIds:[item.id]}],planning:{slidePlan:[{slideId:'one',sourceArtifacts:[{sourceUnitId:item.id}]}]},deck:{slides:[{id:'one',title:'Threshold conditions',nodes:[{id:'table',...component,slotId:'absolute',geometry:{x:I*.7,y:I*1.7,width:I*11.8,height:I*3},style:{fontSizePt:18},sourceArtifact:{sourceUnitId:item.id,type:item.type,rowStart:1,rowEnd:rows.length}}]}]}};
assert.deepEqual(inspectObjectIntegrity(p).issues,[]);
const broken=structuredClone(p);broken.deck.slides[0].nodes[0].content.rows[1][1]='0.05';broken.deck.slides[0].nodes[0].content.cellRich[1][1]=sourceRichText('0.05',{inline:true});
assert.ok(inspectObjectIntegrity(broken).issues.some(i=>i.sourceUnitId===item.id),'a genuinely lost strict inequality cannot match the original source');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-table-inline-'));
try{const out=await renderPptx(p,localPptRuntime(root).io);assert.equal(out.exportVerification.status,'passed');console.log('Table inline comparison signs, cache isolation, legacy rebuild, missing-sign negative and actual PPTX export passed');}finally{fs.rmSync(root,{recursive:true,force:true});}

/** Real source/parser/component matrix. This does not claim live model quality
 * or whole-deck publication for inputs other than the gamma HTTP fixture. */
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import assert from'node:assert/strict';
import {normalizePaste,extractFile}from'../../apps/cowork-server/lib/ppt-source.mjs';
import{sourceComponent,fitComponents}from'../../apps/cowork-server/lib/ppt-density-capacity.mjs';
import{BUILT_INS,snapshotTemplate,analyzeTemplate}from'../../apps/cowork-server/lib/ppt-template.mjs';
import{localPptRuntime}from'../../apps/cowork-server/test/ppt-local-runtime.mjs';
const out=path.resolve(process.env.PPT_MATRIX_OUTPUT||'outputs/ppt-fixture-implementation-20261019/source-matrix');fs.mkdirSync(out,{recursive:true});
const dir=process.env.PPT_EVAL_INPUT_DIR||'/Users/dongli/Documents/quant_research/quant_3.0';
const sources=[['Gamma',process.env.PPT_GAMMA_INPUT||'/Users/dongli/Documents/ChatGPT/CodePilot/gamma.md'],['Factor Zoo',path.join(dir,'04_factor_zoo_overview.md')],['Deep learning',path.join(dir,'13_dl_quant.md')],['Alpha Mining',path.join(dir,'10_alpha_mining.md')],['Machine learning',path.join(dir,'12_ml_quant.md')]];
const runtime=localPptRuntime(out+'/runtime'),templateDir=process.env.PPT_MATRIX_TEMPLATE_DIR||'/Users/dongli/Desktop/Spatial_omics/templates';
const templates=BUILT_INS.filter(t=>['light','blue'].includes(t.id)).map(snapshotTemplate);
for(const [index,file]of ['Copy-of-Mood-Board.pptx','Copy-of-Deal-Review (1).pptx'].entries()){
 const bytes=fs.readFileSync(path.join(templateDir,file)),t=await analyzeTemplate('fixture-matrix','template-'+index,'pptx',bytes,runtime.io);assert.equal(t.compatibility,'mapped');assert.ok(t.fonts.title&&t.fonts.body);
 templates.push({...t,id:'uploaded-'+index,name:file,kind:'uploaded',sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
const matrix=[];
for(const[name,file]of sources){const bytes=fs.readFileSync(file),text=bytes.toString('utf8'),paste=normalizePaste(text),source=await extractFile({id:'matrix-'+matrix.length},path.basename(file),bytes,runtime.io);
 const semantic=s=>s.semantic.inventory.items.map(({type,text,rows})=>({type,text,rows}));assert.deepEqual(semantic(source),semantic(paste),'typed text/rows survive file extraction just as paste; fence syntax is represented by code segment metadata');
 const inventory=source.semantic.inventory;assert.ok(inventory.items.length>0);
 const components=inventory.items.filter(i=>i.must_preserve_structure||i.rows).map(i=>({id:i.id,...sourceComponent(i,{sourceUnitId:i.id})}));
 matrix.push({name,file,sourceBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),units:inventory.items.length,types:Object.fromEntries([...new Set(inventory.items.map(i=>i.type))].map(type=>[type,inventory.items.filter(i=>i.type===type).length])),relations:inventory.relationships.length,templates:templates.map(t=>({id:t.id,name:t.name,fonts:t.fonts,components:components.map(c=>{const fit=fitComponents([c],{source,templateSpec:t,generationPolicy:{version:2,content:'full_source',sourceTypography:'bounded'}},1);return {sourceId:c.id,type:c.content?.diagram?.kind||c.type,capacity:fit.capacity_ok?'fits':'requires_partition',fontSizePt:fit.fontSizePt};})}))});
}
fs.writeFileSync(out+'/manifest.json',JSON.stringify({basis:'real production parser and measured components; no simulated business states; not live LLM/deck acceptance',matrix},null,2));console.log(matrix.map(m=>({name:m.name,units:m.units,relations:m.relations,templates:m.templates.length})));

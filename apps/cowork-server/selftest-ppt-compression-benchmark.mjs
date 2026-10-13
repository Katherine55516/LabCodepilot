import fs from 'node:fs';import assert from 'node:assert/strict';import {normalizePaste} from './lib/ppt-source.mjs';import {sourceSentences} from './lib/ppt-source-boundaries.mjs';import {compileContentSelection,selectionSource,selectionNotes,exactPageConflict} from './lib/ppt-content-selection.mjs';import {sourceComponent,fitComponents} from './lib/ppt-density-capacity.mjs';import {snapshotTemplate,BUILT_INS} from './lib/ppt-template.mjs';import {mandatorySelectionFacts} from './lib/ppt-content-selection.mjs';
const out=process.env.PPT_BENCH_OUTPUT;fs.mkdirSync(out,{recursive:true});const report=[];
for(const [lang,label,condition] of [['en','Verification','Do not omit the cost.'],['zh','检验','不得省略成本。'],['zh-HK','檢驗','不得省略成本。']])for(const domain of ['text','math','table'])for(const N of [3,5,10]){
 const body=domain==='table'?'| Metric | Value |\n| --- | --- |\n'+Array.from({length:30},(_,i)=>`| Row ${i+1} | ${i+1}% |`).join('\n'):domain==='math'?'$$\\alpha_i+\\frac{x}{1+y^2}$$\n\n'+condition:Array.from({length:12},(_,i)=>`${label} ${i+1}. Secondary detail A. Secondary detail B. ${condition}`).join('\n\n');
 const source=normalizePaste('# '+label+'\n\n'+body),before=JSON.stringify(source),inventory=source.semantic.inventory;
 const project={pages:N,pageDecision:{mode:'explicit',finalPageCount:N},generationPolicy:{content:'overview',details:'notes',language:{mode:'output',locale:lang}},source,originalSourceInventory:structuredClone(inventory),templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light'))};
 const selection=inventory.items.map(i=>{
  if(i.type==='TableBlock'&&!i.mustDisplay)return {sourceUnitId:i.id,destination:'summary',rowIndices:[1,i.rows.length-1],reason:'Representative source rows, complete master in notes'};
  const sentences=sourceSentences(i.text),indices=sentences.map((s,index)=>index===0||/not|不得/.test(s)?index:-1).filter(i=>i>=0);
  if(!i.mustDisplay&&!['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock'].includes(i.type)&&indices.length&&indices.length<sentences.length)return {sourceUnitId:i.id,destination:'summary',sentenceIndices:indices,reason:'Core exact sentences and conditions; complete master in notes'};
  return {sourceUnitId:i.id,destination:'slides',reason:'Required complete structure'};
 });
 const slides=Array.from({length:N},(_,i)=>({id:'s'+i,sourceUnitIds:i===1?inventory.items.map(u=>u.id):[]})),raw={slides,selection};
 const ledger=compileContentSelection(project,raw);project.contentSelection=ledger;project.source=selectionSource(project,ledger);
 const facts=mandatorySelectionFacts(project);for(const entry of facts)assert.ok(project.source.semantic.inventory.items.find(u=>u.id===entry.sourceUnitId).text.includes(entry.text));
 const components=project.source.semantic.inventory.items.filter(u=>!u.presentation).map(u=>sourceComponent(u)),fit=fitComponents(components,project,1);
 assert.equal(JSON.stringify(source),before,'immutable input');assert.equal(exactPageConflict(project,raw).length,0);assert.equal(exactPageConflict(project,{slides:slides.slice(1)}).length,1);
 const notes=selectionNotes(project);for(const e of ledger.entries.filter(e=>e.destination==='summary'))assert.ok(notes.some(n=>n.sourceUnitId===e.sourceUnitId&&n.text));
 report.push({lang,domain,N,contract:'overview + explicit notes',sourceHash:ledger.sourceHash,ledgerHash:ledger.hash,originalUnits:inventory.items.length,mainMandatoryFacts:facts.length,notesUnits:notes.length,fontSizePt:fit.fontSizePt,capacity:fit.capacity_ok?'fits':'explicit conflict: distribute across body pages or revise authorized budget',overflow:fit.predictedOverflow,exactN:'passed',immutableSource:'passed'});
}
fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log('27 domain/language/page-budget cases: exact total, immutable source, explicit summaries, complete notes and critical conditions passed; capacity measured independently');

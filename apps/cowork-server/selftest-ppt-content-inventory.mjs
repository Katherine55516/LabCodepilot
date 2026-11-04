import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {coverageMapV2,topicGroupDecisions,inspectInventoryCoverage} from './lib/ppt-content-inventory.mjs';
import {bindSourceArtifacts,sourceDisplayText} from './lib/ppt-source-artifacts.mjs';
import {inspectContent} from './lib/ppt-content-qa.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';import {BUILT_INS} from './lib/ppt-template.mjs';import {_internals as renderer} from './lib/ppt-render.mjs';
for(const domain of ['Research measurement','Business operating review','Product service architecture']) {
 const source=normalizePaste(`# ${domain}\n\n## Definitions\n\n| Object | Meaning | Condition |\n|---|---|---|\n| Queue | Pending work | Before execution |\n| Result | Validated outcome | After review |\n\n## Mechanism\n\n$$\nq = a + b\n$$\n\n## Workflow\n\nIntake -> Validate -> Execute -> Review\n\n## Checklist\n\n- Verify owner.\n- Confirm evidence.\n- Record decision.\n\n## Summary\n\nValidation binds the result to evidence and the responsible owner.`);
 const inventory=source.semantic.inventory;
 for(const type of ['TableBlock','EquationBlock','ProcessBlock','ChecklistBlock','SummaryBlock'])assert.ok(inventory.items.some(item=>item.type===type),`${domain}: ${type}`);
 const outline=[{id:'cover',chunkRefs:[]},{id:'main',chunkRefs:source.semantic.chunks.map(chunk=>chunk.id)},{id:'closing',chunkRefs:[]}];
 const map=coverageMapV2(source,outline);assert.equal(map.version,2);assert.ok(map.detail.every(item=>item.slideIds.includes('main')));
 const groups=topicGroupDecisions(source,outline,[{slideId:'main',semanticUnitBudget:8}]);assert.ok(groups.every(item=>item.decision==='merge'));
 const split=topicGroupDecisions(source,[{id:'a',chunkRefs:[source.semantic.chunks[0].id]},{id:'b',chunkRefs:[source.semantic.chunks[0].id]}],[]);assert.equal(split[0].decision,'split');
 const missing=inspectInventoryCoverage(source,[{text:'Summary',nodes:[]}],slide=>slide.text);assert.ok(missing.issues.some(item=>item.code==='source_end_section_missing'));
 const table=inventory.items.find(item=>item.type==='TableBlock');
 const project={id:'test',source,outline,templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#222222'}},planning:{slidePlan:[{slideId:'main',sourceArtifacts:[{sourceUnitId:table.id}]}]}};
 const slide={id:'main',nodes:[]};bindSourceArtifacts(project,slide,[{sourceUnitId:table.id}],1);
 assert.equal(slide.nodes[0].type,'table');assert.deepEqual(slide.nodes[0].content.rows,table.rows);assert.equal(slide.nodes[0].style.fontSizePt,18);
 assert.throws(()=>bindSourceArtifacts(project,{id:'main',nodes:[]},[{sourceUnitId:'untrusted'}],1),/not assigned/);
 assert.throws(()=>bindSourceArtifacts(project,{id:'main',nodes:[]},[{sourceUnitId:table.id,rowStart:0}],1),/row range/);
 const observed=inspectInventoryCoverage(source,[{nodes:slide.nodes,text:table.rows.flat().join(' ')}],slide=>slide.text);assert.equal(observed.metrics.tableCellRecall[0].recall,1);
 if(domain==='Product service architecture') {
  project.templateSpec=BUILT_INS[0];project.deck={slides:[slide]};project.renderTree=buildRenderTree(project);
  assert.equal(project.renderTree.slides[0].elements.filter(item=>item.kind==='table').length,1,'built-in templates retain source table exactly once');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-source-table-')),file=path.join(root,'table.pptx');
  const python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
  try {
   const rendered=spawnSync(python,['-c',renderer.SCRIPT],{input:JSON.stringify({slides:project.deck.slides,renderTree:project.renderTree,palette:project.templateSpec.palette,fonts:project.templateSpec.fonts}),env:{...process.env,PPT_OUTPUT:file},maxBuffer:2000000});assert.equal(rendered.status,0,rendered.stderr.toString());
   const inspected=spawnSync(python,['-c',`import json,sys\nfrom pptx import Presentation\np=Presentation(sys.argv[1]);t=next(s.table for s in p.slides[0].shapes if s.has_table)\nprint(json.dumps({'rows':[[c.text for c in r.cells] for r in t.rows],'sizes':[run.font.size.pt for r in t.rows for c in r.cells for p in c.text_frame.paragraphs for run in p.runs]}))`,file]);assert.equal(inspected.status,0,inspected.stderr.toString());const output=JSON.parse(inspected.stdout);assert.deepEqual(output.rows,table.rows);assert.ok(output.sizes.every(size=>size===18),'generic exporter must not shrink source table text');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
}
const sparse={source:normalizePaste('A short statement.'),deck:{slides:[{id:'a',title:'Intro'},{id:'b',title:'Message',bullets:['Short point']},{id:'c',title:'End'}]}};
assert.equal(sourceDisplayText(String.raw`Alpha ($\alpha_i$) and $\frac{a}{b}$`),'Alpha (αi) and (a)/(b)');
assert.equal(sourceDisplayText(String.raw`$\unsupported{x}$`),String.raw`$\unsupported{x}$`,'unsupported notation must remain visible');
assert.ok(!inspectContent(sparse).issues.some(issue=>issue.code==='rich_source_underfilled'));
console.log('PPT cross-domain inventory, typed retention, merge/split, cell recall, end-section and sparse source: OK');

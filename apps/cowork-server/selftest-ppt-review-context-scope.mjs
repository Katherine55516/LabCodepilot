import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {richTextContent} from './lib/ppt-source-text.mjs';
import {sourceComponent} from './lib/ppt-density-capacity.mjs';
import {reviewBatches} from './lib/ppt-review-batches.mjs';
import {deckReviewPrompt} from './lib/ppt-quality.mjs';
import {visibleEvidenceQuoteId,obligationRegistry} from './lib/ppt-obligations.mjs';
import {reviewDisplayText} from './lib/ppt-review-display.mjs';
const text=Array.from({length:20},(_,i)=>`## Cohort ${i+1}\nCohort ${i+1} recorded ${i+2} checks. Only recorded checks count; missing records stay pending. Formula $x^{${i+1}}$ and [record](https://example.test/${i+1}) retain their original meaning.`).join('\n\n')+'\n\n## Shared table\n| Cohort | Checks |\n|---|---:|\n| North | 3 |\n| South | 4 |';
const source=normalizePaste(text),prose=source.semantic.inventory.items.filter(i=>i.text.startsWith('Cohort ')),table=source.semantic.inventory.items.find(i=>i.type==='TableBlock');assert.equal(prose.length,20);assert.ok(table);
const slides=prose.map((item,i)=>({id:'cohort-'+i,title:'Cohort '+(i+1),nodes:[{id:'visible-'+i,type:'text',semanticRole:'source-structure',sourceArtifact:{sourceUnitId:item.id,type:item.type},content:richTextContent(item.text)}]}));
for(const index of [7,8]){const ref={sourceUnitId:table.id,rowStart:index===7?1:2,rowEnd:index===7?2:3},component=sourceComponent(table,ref);slides[index].nodes.push({id:'table-'+index,type:'table',semanticRole:'source-structure',sourceArtifact:{...ref,type:table.type},content:component.content});}
const p={source,pages:20,userRequirements:'Preserve original cohort facts and conditions.',generationPolicy:{content:'full_source',knowledge:'source_only',language:{mode:'source',body:'both'}},outline:slides.map((s,i)=>({id:s.id,title:s.title,sourceUnitIds:[prose[i].id,...([7,8].includes(i)?[table.id]:[])],chunkRefs:prose[i].chunkRefs})),deck:{slides},planning:{brief:{mustInclude:[]},slidePlan:[]}};
const before=JSON.stringify(p),batches=reviewBatches(p),global=batches.at(-1).project;assert.equal(batches.length,4);
for(const batch of batches)assert.equal(batch.project.source,source,'full immutable source authority is retained in every view');
assert.ok(batches[0].project.reviewScope.fullSourceInstances.some(n=>n.nodeId==='table-8'&&n.text.includes('South')),'the actual table continuation outside this page batch stays available');
assert.ok(!batches[0].project.deck.slides.some(s=>s.id==='cohort-8'),'outside context never expands the audited page set');
assert.ok(!batches[0].project.reviewScope.fullSourceInstances.some(n=>n.nodeId==='visible-19'),'an unrelated chapter is audited in its own batch/global view');
const assigned=batches.flatMap(b=>b.project.reviewScope.obligationIds);assert.deepEqual([...assigned].sort(),obligationRegistry(p).entries.map(e=>e.id).sort(),'all obligations remain assigned exactly once');
const prompt=deckReviewPrompt(global),pageJson=prompt.match(/页面：(.*)\n来源：/u)[1],catalog=JSON.parse(pageJson).flatMap(s=>s.semanticComponents.map(c=>({...c,slideId:s.slideId}))),refs=global.reviewScope.fullSourceInstances;
assert.equal(refs.length,slides.reduce((n,s)=>n+s.nodes.length,0));
for(const ref of refs){const actual=catalog.find(n=>n.quoteId===ref.visibleWitnessRef);assert.ok(actual);assert.equal(actual.sourceArtifact.sourceUnitId,ref.sourceUnitId);const node=slides.flatMap(s=>s.nodes).find(n=>n.id===actual.nodeId);if(node.type==='table')assert.deepEqual(actual.rows,node.content.rows);else assert.equal(actual.text,reviewDisplayText(node));}
for(const s of slides)for(const n of s.nodes)assert.ok(catalog.some(c=>c.quoteId===visibleEvidenceQuoteId(s.id,n)),'every actual quote remains in the global catalog');
assert.equal(JSON.stringify(p),before,'review views do not mutate source, deck or ownership');
const altered=structuredClone(p);altered.deck.slides[0].nodes[0].content=richTextContent('Cohort 1 recorded 999 checks. Missing records now count.');
const badPrompt=deckReviewPrompt(reviewBatches(altered).at(-1).project);assert.ok(badPrompt.includes('999 checks'));assert.ok(badPrompt.includes('Only recorded checks count'),'source and changed actual copy remain distinct for independent review');
const missing=structuredClone(p);missing.deck.slides[8].nodes=missing.deck.slides[8].nodes.filter(n=>n.id!=='table-8');const missingBatches=reviewBatches(missing);assert.ok(!missingBatches[0].project.reviewScope.fullSourceInstances.some(n=>n.nodeId==='table-8'),'removed continuation cannot be revived from source');assert.equal(missingBatches.at(-1).project.reviewScope.fullObjectCoverage.find(o=>o.objectId===table.id).status,'failed');
console.log('Complete source, exact global quote catalog, scoped page audits, cross-batch table rows, all obligations and changed/missing-visible-source negatives passed.');

import assert from 'node:assert/strict';import{inspectSystemOutlineTitles}from'./lib/ppt-outline-title-fit.mjs';import{BUILT_INS,snapshotTemplate}from'./lib/ppt-template.mjs';import{applyOutlineMetadataRepair}from'./lib/ppt-outline-protocol.mjs';
const p={source:{text:'# Alpha Mining\n\nOperators and validation',semantic:{inventory:{items:[]}}},templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='violet')),generationPolicy:{language:{mode:'source',body:'both'}}};
const titles=['Power and Danger of Exhaustive Search: Tutorial 10 — Alpha Mining: Formulaic Alphas, Operators, and Automated Search','Validation Over Search and Motivated Constraints: The central tension: mining power vs. overfitting'];
const raw={version:2,slides:[{id:'cover',title:'Alpha Mining',sourceUnitIds:[]},...titles.map((title,index)=>({id:'page'+index,title,sourceUnitIds:[]})),{id:'close',title:'Thanks for watching!',sourceUnitIds:[]}]};
const issues=inspectSystemOutlineTitles(p,raw.slides);assert.deepEqual(issues.map(i=>i.pageIndex),[1,2]);assert.ok(issues.every(i=>i.reason==='system_title_capacity'&&i.measuredLines>=3));
const repaired=applyOutlineMetadataRepair(raw,{details:{metadataConflicts:issues}},{version:2,updates:[{pageIndex:1,field:'title',text:'Exhaustive Search Risks'},{pageIndex:2,field:'title',text:'Validation and Constraints'}]});assert.deepEqual(inspectSystemOutlineTitles(p,repaired.slides),[]);assert.equal(raw.slides[1].title,titles[0]);assert.equal(repaired.slides[1].titleBasis,'system_capacity_metadata_repair');
const locked=structuredClone(raw);locked.slides[1].titleLocked=true;assert.ok(inspectSystemOutlineTitles(p,locked.slides).some(i=>i.pageIndex===1),'a locked title is reported, never silently shortened');
const native={...p,templateFidelity:{mode:'preserve'}};assert.deepEqual(inspectSystemOutlineTitles(native,raw.slides),[]);
console.log('Actual system header/font detects both Alpha three-line failures before confirmation; bounded metadata repair fits and preserves source/locked title.');

const boundary='AI Product Architecture Review: Establishes the primary mechanism block defining';
const copyBudgetIssue=inspectSystemOutlineTitles(p,[raw.slides[0],{id:'budget',title:boundary,role:'mechanism',sourceUnitIds:[]},raw.slides.at(-1)]);
assert.equal(copyBudgetIssue[0].reason,'system_title_copy_budget');assert.equal(copyBudgetIssue[0].measuredLines,2);assert.equal(copyBudgetIssue[0].capacityVisualUnits,44);assert.ok(copyBudgetIssue[0].usedVisualUnits>44,'physical two-line fit never bypasses the unchanged writer topic budget');

const realFailureTitle='Recommended PPT AI Architecture Pipeline: This ten-stage pipeline embodies the core';
const realShortTitle='Recommended PPT AI Architecture Pipeline';
const realRaw={version:2,slides:[raw.slides[0],{id:'measured-guidance',title:realFailureTitle,role:'summary',sourceUnitIds:[]},raw.slides.at(-1)]};
const guidance=inspectSystemOutlineTitles(p,realRaw.slides);assert.ok(guidance.length);assert.ok(realShortTitle.length>guidance[0].recommendedMaxLength);assert.ok(realShortTitle.length<=guidance[0].maxLength);
const physicallySafe=applyOutlineMetadataRepair(realRaw,{details:{metadataConflicts:guidance}},{version:2,updates:[{pageIndex:1,field:'title',text:realShortTitle}]});assert.deepEqual(inspectSystemOutlineTitles(p,physicallySafe.slides),[],'a rough character recommendation cannot overrule actual unchanged-font capacity and writer budget');assert.equal(realRaw.slides[1].title,realFailureTitle);
assert.throws(()=>applyOutlineMetadataRepair(realRaw,{details:{metadataConflicts:guidance}},{version:2,updates:[{pageIndex:1,field:'title',text:realFailureTitle}]}),/exact title capacity/,'a structural text bound never bypasses the unchanged writer budget');

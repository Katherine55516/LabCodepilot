import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {_internals as api} from './lib/ppt-api.mjs';
import {mergeUnderfilledPages} from './lib/ppt-outline-condense.mjs';

const sections=[
 ['Scope','The pilot includes document search and permission filtering for the internal support team. Citations must open a source that the current user may access.'],
 ['Release gates','The owner confirms permission checks, rollback instructions and support documentation before enabling the full team. A relevance test alone is insufficient.'],
 ['Rollout','Enable five volunteers first, review failures daily and expand only after permission checks pass. Retain the current search path for rollback.'],
 ['Responsibilities','Engineering owns permission failures and rollback. Support maintains the pilot issue log. The release owner records evidence and unresolved limitations.'],
];
const source=normalizePaste('# Release readiness\n\n'+sections.map(([heading,text])=>`## ${heading}\n\n${text}`).join('\n\n'));
const items=source.semantic.inventory.items.filter(item=>item.type!=='HeadingBlock');
assert.equal(items.length,4);
const policy={version:1,detail:'balanced',content:'full_source',details:'slides',knowledge:'source_only',images:'source',language:{mode:'source'}};
const project={pages:3,inputKind:'paste',source,template:'light',pageDecision:{source:'estimate',mode:'auto'},generationPolicy:policy};
const raw={version:2,selection:items.map(item=>({sourceUnitId:item.id,destination:'slides',reason:'Keep the complete source'})),slides:[
 {title:'Release readiness',focus:'Introduce the release',role:'cover',sourceUnitIds:[]},
 ...items.map((item,index)=>({title:sections[index][0],focus:sections[index][1],sourceUnitIds:[item.id]})),
 {title:'Thanks for watching!',focus:'Questions and discussion',role:'closing',sourceUnitIds:[]},
]};
const assess=(p,candidate)=>api.assessOutlineCandidate(p,candidate);
const before=assess(project,structuredClone(raw));
const merged=await mergeUnderfilledPages(project,before,assess,{ignoreBudget:true,low:.55});
assert.ok(merged&&merged.outline.length<before.outline.length,'full-source automatic grouping merges sparse neighbours');
assert.deepEqual(merged.rawOutline.slides.flatMap(slide=>slide.sourceUnitIds||[]).sort(),items.map(item=>item.id).sort(),'each complete source unit is still owned exactly once');
assert.deepEqual(merged.rawOutline.selection,before.rawOutline.selection,'merging never moves complete-source facts into notes or summaries');
assert.ok(merged.rawOutline.slides.every(slide=>!slide.densityFit?.predictedOverflow),'all merged pages pass the real measured capacity assessment');
assert.ok(merged.issues.length<=before.issues.length,'the same source and semantic gates still apply');
for(const pageDecision of [{source:'user',mode:'explicit'},{source:'estimate',mode:'auto',confirmedAt:'2026-10-14T00:00:00Z'}]){
 assert.equal(await mergeUnderfilledPages({...project,pageDecision},before,assess,{ignoreBudget:true}),null,'explicit or confirmed page counts stay frozen');
}
const locked={...before,rawOutline:{...before.rawOutline,slides:before.rawOutline.slides.map(slide=>({...slide,titleLocked:true}))}};
assert.equal(await mergeUnderfilledPages(project,locked,assess,{ignoreBudget:true}),null,'manual page locks prevent merging');
console.log('Full-source sparse-page merging: complete ownership, unchanged selection, measured fit, explicit counts and manual locks passed');

// A real regression: code plus a thin interpretation fits by changing columns,
// even though adding separate-page heights exceeds the old .95 prefilter.
const weightedSource=normalizePaste("# Weighted selection\nFixture assumptions: w_i >= 0 and sum_i w_i = 1. The score s=sum_i w_i*x_i is defined only when all required x_i are available. Do not silently renormalize weights when a required input is missing.\n\n## Worked example\nFor x=(2,4) and w=(0.25,0.75), s=3.5. The first contribution is 0.5 and the second is 3.0. The example describes arithmetic, not evidence of predictive performance.\n\n## Validation\nReject negative weights. Reject a weight sum outside the declared numerical tolerance. Return a missing-input result when a required observation is absent.\n```python\ndef weighted_score(values, weights):\n    if len(values) != len(weights):\n        raise ValueError(\"length mismatch\")\n    if any(w < 0 for w in weights):\n        raise ValueError(\"negative weight\")\n    if abs(sum(weights) - 1) > 1e-8:\n        raise ValueError(\"weight sum\")\n    if any(x is None for x in values):\n        return None\n    return sum(w*x for w, x in zip(weights, values))\n```\n\n## Interpretation\nIncreasing a weight changes the contribution of its associated value and requires another weight to change to keep the sum equal to one. Preserve the normalization constraint alongside the score formula.");
const weightedProject={...project,source:weightedSource,pages:5};
const weightedRaw={"version": 2, "selection": null, "slides": [{"title": "Weighted selection", "focus": "Cover slide introducing the weighted selection mechanism, its worked example, validation rules, and interpretation constraints.", "section": "Weighted selection", "sourceUnitIds": [], "role": "cover"}, {"title": "Fixture assumptions and score definition", "focus": "The score s=sum_i w_i*x_i requires w_i >= 0, sum_i w_i = 1, and all required x_i available. Do not silently renormalize weights when a required input is missing.；For x=(2,4) and w=(0.25,0.75), s=3.5. The first contribution is 0.5 and the second is 3.0. This describes arithmetic, not evidence of predictive performance.", "section": "Weighted selection", "sourceUnitIds": ["b_0002", "b_0004", "b_0006"], "role": "definition"}, {"title": "Validation implementation", "focus": "Python function enforcing length match between values and weights, rejecting negative weights, and implementing the validation rules from the evidence block.", "section": "Validation", "sourceUnitIds": ["b_0007"], "role": "workflow", "sourceArtifactRanges": []}, {"title": "Interpretation of weight changes", "focus": "Increasing a weight changes the contribution of its associated value and requires another weight to change to keep the sum equal to one. Preserve the normalization constraint during interpretation.", "section": "Interpretation", "sourceUnitIds": ["b_0009"], "role": "mechanism"}, {"title": "Thanks for watching!", "focus": "Questions & discussion.", "section": "Interpretation", "sourceUnitIds": [], "role": "closing"}]};
const weightedBefore=assess(weightedProject,weightedRaw);
const weightedAfter=await mergeUnderfilledPages(weightedProject,weightedBefore,assess,{ignoreBudget:true,low:.55});
assert.equal(weightedBefore.outline.length,5);
assert.ok(weightedAfter.outline.length<=4,"measured multi-column layout absorbs the sparse interpretation");
assert.deepEqual(weightedAfter.rawOutline.slides.flatMap(s=>s.sourceUnitIds||[]).sort(),weightedBefore.rawOutline.slides.flatMap(s=>s.sourceUnitIds||[]).sort());
assert.ok(weightedAfter.rawOutline.slides.every(s=>s.densityFit?.capacity_ok));
assert.equal(weightedAfter.issues.length,0);
const {mergedTopicTitle}=await import('./lib/ppt-merged-topic.mjs');
const both=mergedTopicTitle({source:{text:''}},'Automation effort reduction','Friday review and acceptance rules');
assert.equal(both,'Automation effort reduction & Friday review and acceptance rules','a label longer than sixty characters must not silently lose its second topic');
assert.equal(mergedTopicTitle({source:{text:''}},'A'.repeat(100),'B'.repeat(100)),null,'do not merge when complete subjects exceed the metadata contract');
const {packOutline}=await import('./lib/ppt-density-packing.mjs');
const packingProject={...project,source:{...source,semantic:{...source.semantic,inventory:{...source.semantic.inventory,items:items.map(item=>({...item,chunkRefs:['shared'],must_preserve_structure:true}))}}}};
const packed=packOutline(packingProject,{version:2,slides:[{title:'Cover',role:'cover',sourceUnitIds:[]},...items.slice(0,2).map((item,index)=>({title:index?'Release gates':'Scope',focus:'A clear related release condition.',section:'Release',sourceUnitIds:[item.id]})),{title:'Thanks for watching!',role:'closing',sourceUnitIds:[]}]});
assert.ok(packed.slides.some(s=>s.sourceUnitIds?.includes(items[0].id)&&s.sourceUnitIds.includes(items[1].id)&&s.title.includes('Scope')&&s.title.includes('Release gates')),'density repacking also names both combined subjects');

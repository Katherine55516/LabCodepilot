import assert from 'node:assert/strict';
import {boundedCapacityPartitions,partitionOutlineWithMeasuredComponents}from './lib/ppt-outline-capacity-repair.mjs';
import {candidateFit}from './lib/ppt-density-packing.mjs';
import {compileOutlineCandidate}from './lib/ppt-outline-compile.mjs';
import {BUILT_INS,snapshotTemplate}from './lib/ppt-template.mjs';

const items=Array.from({length:220},(_,i)=>({id:'code-'+i,type:'CodeBlock',language:'python',text:'pass',must_preserve_structure:true,source_ref:['1'],chunkRefs:['chunk-'+Math.floor(i/11)]}));
const project={pages:22,template:'violet',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='violet')),source:{text:'Complete source examples',semantic:{inventory:{items}}},generationPolicy:{content:'full_source',knowledge:'source_only',language:{mode:'source'}},pageDecision:{source:'estimate',mode:'auto'}};
const cover={title:'Source examples',role:'cover',sourceUnitIds:[]},closing={title:'Thanks for watching!',role:'closing',sourceUnitIds:[]};
const bodies=Array.from({length:20},(_,i)=>({title:'Example group '+i,focus:'Complete original snippets',planningProtocolVersion:2,sourceUnitIds:items.slice(i*11,i*11+11).map(item=>item.id),keyPoints:[],requiredDetails:[],requiredEvidenceIds:[]}));
const raw={version:2,slides:[cover,...bodies,closing]},snapshot=JSON.stringify(raw),scopes=bodies.map((_,i)=>[i+1]);
assert.ok(bodies.every(s=>!candidateFit(s,project,1).capacity_ok));
const parts=scopes.map(scope=>partitionOutlineWithMeasuredComponents({project,rawOutline:raw},scope));
assert.ok(parts.every(part=>part.length>=2&&part.every(s=>candidateFit(s,project,1).capacity_ok)));
const complete=boundedCapacityPartitions(raw,scopes,parts);
assert.equal(complete.applied,20);assert.equal(complete.deferred.length,0);
assert.deepEqual(complete.raw.slides.flatMap(s=>s.sourceUnitIds||[]),items.map(item=>item.id),'all original source objects remain once and in reading order');
// With only two pages of headroom the same real partitions must keep valid
// progress, rather than discard every repair because the entire batch is large.
const crowded={...raw,slides:[...raw.slides.slice(0,-1),...Array.from({length:76},(_,i)=>({title:'Reserved '+i,sourceUnitIds:[]})),closing]};
const bounded=boundedCapacityPartitions(crowded,scopes,parts);
assert.equal(bounded.raw.slides.length,100);assert.equal(bounded.applied,2);assert.equal(bounded.deferred.length,18);
assert.deepEqual(bounded.raw.slides.flatMap(s=>s.sourceUnitIds||[]),items.map(item=>item.id));
assert.equal(JSON.stringify(raw),snapshot,'original proposals stay immutable');
assert.throws(()=>boundedCapacityPartitions(raw,[[1],[1]],[parts[0],parts[0]]),/overlapping/);

const compiled=compileOutlineCandidate(project,raw);
assert.equal(compiled.raw.slides.filter(s=>s.role==='navigation').length,1);
assert.deepEqual(compiled.raw.slides.find(s=>s.role==='navigation').sourceUnitIds,[]);
assert.deepEqual(compiled.raw.slides.flatMap(s=>s.sourceUnitIds),items.map(item=>item.id));
assert.ok(compiled.corrections.some(c=>c.code==='navigation_page_reserved'));
assert.equal(compileOutlineCandidate(project,compiled.raw).raw.slides.filter(s=>s.role==='navigation').length,1,'reservation is idempotent');
for(const frozen of [{...project,pageDecision:{source:'user',mode:'explicit'}},{...project,confirmedOutline:{hash:'frozen'}}])assert.equal(compileOutlineCandidate(frozen,raw).raw.slides.length,raw.slides.length,'explicit or frozen totals never grow');
const full={...raw,slides:[...raw.slides,...Array.from({length:78},()=>({title:'Reserved',sourceUnitIds:[]}))]};
assert.equal(compileOutlineCandidate(project,full).raw.slides.length,100,'a missing navigation page cannot exceed the hard limit');

// Regression from the actual long-source table: the component-only estimate
// fitted while the final page header made its last rows overflow.
const rows=[['Horizon 频率','$|\\overline{IC}|$','Interpretation 解读'],['Daily 日频','0.00–0.02','Weak / likely noise 较弱/很可能是噪音'],['Daily 日频','0.02–0.03','Notable for a single daily signal 对单一日频信号而言已属明显'],['Daily 日频','> 0.05','Rare, strong (verify for look-ahead bugs first!) 罕见的高强度信号（务必先排查未来函数错误！）'],['Monthly 月频','0.00–0.03','Weak 较弱'],['Monthly 月频','0.03–0.05','Reasonable factor 合理的因子水平'],['Monthly 月频','> 0.05','Notable, historically top-decile academic factors land here 显著，历史上顶尖学术因子多落在此区间']];
const table={id:'threshold-fixture',type:'TableBlock',must_preserve_structure:true,rows,source_ref:['table'],chunkRefs:['table']},tableProject={...project,pages:3,source:{text:'Table fixture',semantic:{inventory:{items:[table]}}}};
const tableSlide={...bodies[0],title:'Rule-of-Thumb Thresholds for IC Magnitude',sourceUnitIds:[table.id]};
const fragments=partitionOutlineWithMeasuredComponents({project:tableProject,rawOutline:{slides:[cover,tableSlide,closing]}},1);
assert.ok(fragments.every(s=>candidateFit(s,tableProject,1).capacity_ok),'every actual header + row interval fits at the unchanged font');
assert.deepEqual(fragments.flatMap(s=>s.sourceArtifactRanges.flatMap(ref=>Array.from({length:ref.rowEnd-ref.rowStart},(_,i)=>ref.rowStart+i))),[1,2,3,4,5,6]);
assert.ok(fragments.every(s=>candidateFit(s,tableProject,1).fontSizePt===18));

const mixedItems=items.slice(0,22).map((item,i)=>({...item,sectionPath:[i<11?'Access checks':'Rollback criteria']}));
const mixedProject={...project,pages:3,source:{text:'Access checks and rollback criteria',semantic:{inventory:{items:mixedItems}}}};
const mixedSlide={...bodies[0],title:'Access checks',sourceUnitIds:mixedItems.map(item=>item.id)};
const split=partitionOutlineWithMeasuredComponents({project:mixedProject,rawOutline:{slides:[cover,mixedSlide,closing]}},1);
const rollbackOnly=split.filter(s=>s.sourceUnitIds.length&&s.sourceUnitIds.every(id=>mixedItems.find(item=>item.id===id).sectionPath[0]==='Rollback criteria'));
assert.ok(rollbackOnly.length);assert.ok(rollbackOnly.every(s=>s.title==='Rollback criteria'),'a partition cannot inherit the exclusive subject of the other source section');
console.log('Twenty real overflows: bounded atomic progress, exact source ownership, unchanged fit/font, and automatic-only navigation reservation: OK');

import {test} from 'node:test';
import assert from 'node:assert/strict';
const modulePath=process.cwd()+'/apps/cowork-server/lib/ppt/component-assignment.mjs';
type Fragment={pointId:string;sourceText:string;startStep?:number;endStep?:number;continuationFromPrevious?:boolean;continuesNext?:boolean};
type Assignment={id:string;pointIds:string[];fragments:Fragment[]};
const frames=(n:number)=>Array.from({length:n},(_,i)=>({id:'box'+i,capacity:{maxLines:4,latinCharactersPerLine:40}}));

test('two reviewed process chains allocate across three boxes before writing, without losing boundary qualifiers',async()=>{
 const {planComponentAssignments}=await import(modulePath);
 const points=[{id:'dev',text:'Researcher/LLM -> candidate card -> compiler -> evaluator on development'},
  {id:'test',text:'Frozen candidate -> separate outer-test evaluator -> decision record'}];
 const plan=planComponentAssignments(points,frames(3));
 const a:Assignment[]=plan.assignments;
 assert.deepEqual(a.map(a=>a.id),['box0','box1','box2']);assert.ok(a.every(a=>a.fragments.length&&a.pointIds.length));
 for(const p of points){
  const parts=a.flatMap(a=>a.fragments).filter(f=>f.pointId===p.id),steps=p.text.split(' -> ');
  assert.equal(parts[0].startStep,0);assert.equal(parts.at(-1)?.endStep,steps.length-1);
  parts.forEach((f,i)=>{assert.equal(f.sourceText,steps.slice(f.startStep,(f.endStep??0)+1).join(' → '));if(i)assert.equal(f.startStep,parts[i-1].endStep);});
 }
 assert.ok(JSON.stringify(plan).includes('evaluator on development'));assert.ok(JSON.stringify(plan).includes('separate outer-test evaluator'));
 assert.deepEqual(plan,planComponentAssignments(points,frames(3)),'deterministic source allocation');
 assert.equal(planComponentAssignments([{id:'multiline',text:'First stage\n → Second stage\n → Final stage'}],frames(2)).assignments.length,2);
});

test('capacity changes fragment allocation while preserving contiguous source order',async()=>{
 const {planComponentAssignments}=await import(modulePath);
 const points=[{id:'flow',text:'First stage -> Second stage -> Third stage -> Fourth stage -> Fifth stage'}];
 const normal=planComponentAssignments(points,frames(2));const unequal=frames(2);unequal[0].capacity={maxLines:1,latinCharactersPerLine:8};unequal[1].capacity={maxLines:8,latinCharactersPerLine:80};
 const smaller=planComponentAssignments(points,unequal);
 assert.ok(smaller.assignments[0].fragments[0].endStep<normal.assignments[0].fragments[0].endStep);
 assert.equal(smaller.assignments[0].fragments[0].endStep,smaller.assignments[1].fragments[0].startStep);
});

test('multiple unsplit points combine in fewer containers without fabricated text or omitted points',async()=>{
 const {planComponentAssignments}=await import(modulePath);
 const points=['Alpha condition','Beta limitation','Gamma evidence','Delta conclusion'].map((text,i)=>({id:'p'+i,text}));
 const a:Assignment[]=planComponentAssignments(points,frames(2)).assignments;
 assert.deepEqual(a.flatMap(a=>a.fragments.map(f=>f.sourceText)),points.map(p=>p.text));
 assert.deepEqual(a.flatMap(a=>a.pointIds),points.map(p=>p.id));
 assert.equal(planComponentAssignments(points,frames(1)).assignments.length,1);
});

test('insufficient prose, code, equations, bilingual chains and empty stages cannot be split to invent fillers',async()=>{
 const {planComponentAssignments}=await import(modulePath);
 for(const text of ['One short statement.','A -> B','A -> -> B','x=1 -> y=2 -> z=3','`A -> B -> C`','A -> B | 甲 -> 乙']){
  assert.throws(()=>planComponentAssignments([{id:'p',text}],frames(2)),/source_insufficient/);
 }
 assert.throws(()=>planComponentAssignments([{id:'p',text:'A -> B -> C'}],frames(4)),/source_insufficient/);
 assert.throws(()=>planComponentAssignments([{id:'p',text:'A'}],[{id:'same'},{id:'same'}]),/invalid_component_plan/);
});

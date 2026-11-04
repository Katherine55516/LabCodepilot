// Below the full length a page showing a table keeps at most three points
// beside it and none that only restates the table; the rest go to the page's
// speaker notes (the user, 2026-11-01: CodePilot docx held 8 points at 10 pt
// beside a table; "四层容量证据" repeated its four rows). Numbered steps stay.
import assert from 'node:assert/strict';
import {trimTablePoints,TABLE_POINTS_MAX} from './lib/ppt-card-capacity-preflight.mjs';

const rows=[['层次','输入与用途','不能证明什么'],['字符预算','写卡时约束语言长度','不能证明指定字体在指定框中放得下'],['槽位与组件测量','按共享合同预测几何','不是系统字体的精确 shaping']];
const project={source:{semantic:{inventory:{items:[{id:'t',type:'TableBlock',text:rows.map(row=>row.join(' | ')).join('\n'),rows},{id:'u1',type:'Paragraph',text:'x'}]}}}};
const point=(text,ids)=>({text,sourceUnitIds:ids});
const page=(keyPoints,extra={})=>({id:'p',title:'四层容量证据',cardObjects:['t'],keyPoints,...extra});

// Restatements of the shown table leave; the other points stay.
{const restate=point('字符预算约束语言长度，不能证明指定字体在指定框中放得下',['t']),own=point('容量检查分四层，各自只证明一部分',['u1']),also=point('预测与实测各管一层',['u1']);
 const out=trimTablePoints(project,page([restate,own,also]));
 assert.deepEqual(out.page.keyPoints.map(p=>p.text),[own.text,also.text]);
 assert.deepEqual(out.page.notePoints.map(p=>p.text),[restate.text],'the restatement is in the notes');
 assert.equal(out.restated,1);
 // No bare table page (Fable E, 2026-11-01): two points stay visible, a restating one too.
 assert.equal(trimTablePoints(project,page([restate,own])),null,'with one other point the restatement stays');}
// A point citing the table that says something of its own stays.
{const reading=point('预测通过不等于实际验收，人工审查仍然必要',['t']);
 assert.equal(trimTablePoints(project,page([reading])),null);}
// At most three points beside the table, in their order; an appendix pointer stays last.
{const many=Array.from({length:6},(_,k)=>point(`第 ${k+1} 条独立结论`,['u1'])),pointer={text:'完整表格见附录 A',navigation:true};
 const out=trimTablePoints(project,page([...many,pointer]));
 assert.equal(TABLE_POINTS_MAX,3);
 assert.deepEqual(out.page.keyPoints.map(p=>p.text),['第 1 条独立结论','第 2 条独立结论','第 3 条独立结论','完整表格见附录 A']);
 assert.deepEqual(out.page.notePoints.map(p=>p.text),['第 4 条独立结论','第 5 条独立结论','第 6 条独立结论']);
 assert.equal(trimTablePoints(project,out.page),null,'idempotent');}
// A numbered list of steps keeps every step; only restatements would leave.
{const steps=Array.from({length:6},(_,k)=>point(`步骤 ${k+1}`,['u1']));
 assert.equal(trimTablePoints(project,page(steps,{numberedPoints:true})),null);}
// A procedure among other points stays whole and the others go to the notes
// (Fable, 2026-11-01; World Models p4: steps 1-5 beside three results).
{const steps='1. Collect 10,000 rollouts from a random policy.\n2. Train the VAE to encode frames.\n3. Train the MDN-RNN to model the next z.\n4. Define the controller as a linear map.\n5. Use CMA-ES to solve for the controller weights.';
 const p2={source:{semantic:{inventory:{items:[{id:'t',type:'TableBlock',text:'MODEL | PARAMETER COUNT\nVAE | 4,348,547',rows:[['MODEL','PARAMETER COUNT'],['VAE','4,348,547']]},{id:'s',type:'TaxonomyBlock',text:steps},{id:'r',type:'Paragraph',text:'Results'}]}}}};
 const keyPoints=['Collect 10,000 rollouts from a random policy','Train the VAE to encode frames','Train the MDN-RNN to model the next z','Define the controller as a linear map','Use CMA-ES to solve for the controller weights'].map(text=>({text,sourceUnitIds:['s']}));
 const results=['The agent scores 906 on average','Full world model beats V alone','Score clears the 900 bar'].map(text=>({text,sourceUnitIds:['r']}));
 const out=trimTablePoints(p2,{id:'p',title:'Car Racing',cardObjects:['t'],keyPoints:[...keyPoints,...results]});
 assert.deepEqual(out.page.keyPoints.map(point=>point.text),keyPoints.map(point=>point.text),'all five steps stay');
 assert.equal(out.page.numberedPoints,true);assert.equal(out.page.notePoints.length,3,'the results go to the notes');}
console.log('PASS table points: restatements of the shown table and points past three go to the notes; steps stay');

// Small source tables stay tables (Fable D1, 2026-11-01): up to 4 columns and
// 8 data rows, a source table is drawn as a table with its own first row as
// the header, never as cards; a share column summing to 100% may be a donut.
import assert from 'node:assert/strict';
import {chooseTableDiagram} from './lib/ppt-diagram-cards.mjs';
import {sourceComponent} from './lib/ppt-density-capacity.mjs';
const table=(rows,extra={})=>({id:'t',type:'TableBlock',tableRepresentation:'diagram',rows,...extra});
// World Models' temperature table showed as 7 chips "VIRTUAL SCORE：2086 ± 140".
const temperature=table([['TEMPERATURE τ','VIRTUAL SCORE','ACTUAL SCORE'],['0.10','2086 ± 140','193 ± 58'],['0.50','2060 ± 277','196 ± 50'],['1.00','1145 ± 690','868 ± 511'],['1.15','918 ± 546','1092 ± 556'],['1.30','732 ± 269','753 ± 139'],['RANDOM POLICY','N/A','210 ± 108'],['GYM LEADER','N/A','820 ± 58']]);
assert.equal(chooseTableDiagram(temperature),null);
const component=sourceComponent(temperature,{sourceUnitId:'t'});
assert.equal(component.type,'table');
assert.deepEqual(component.content.rows[0],['TEMPERATURE τ','VIRTUAL SCORE','ACTUAL SCORE'],'the source block\'s first row is the header');
assert.equal(component.content.rows.length,8,'every row is drawn');
// A decision table and a metric table of the same size are tables too.
assert.equal(chooseTableDiagram(table([['选项','理由'],['A','快'],['B','稳']])),null);
assert.equal(chooseTableDiagram(table([['指标','目标'],['采纳率','≥ 70%'],['响应','≤ 15 秒']])),null);
// A share column summing to 100% is still a chart, and larger tables keep their diagrams.
assert.equal(chooseTableDiagram(table([['渠道','占比'],['A','30%'],['B','50%'],['C','20%']])),'donut');
const wide=table([['指标','目标'],...Array.from({length:9},(_,k)=>['m'+k,'≥ '+(60+k)+'%'])]);
assert.equal(chooseTableDiagram(wide),'kpi','over 8 data rows the existing rules apply');
console.log('PASS small source tables stay tables with their own header; donuts and larger tables keep their diagrams');

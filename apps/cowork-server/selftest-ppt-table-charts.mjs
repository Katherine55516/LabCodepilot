// Source tables of measures become native column charts (Fable S3,
// 2026-11-01): 3-8 named categories, 1-3 columns of numbers in one shared
// unit; every value is the source cell's own and the chart's coverage proves
// it. Mixed units, year columns, numeric or long category names stay tables.
import assert from 'node:assert/strict';
import {chooseTableDiagram,tableDiagramComponent,diagramCoverage,chartSeries} from './lib/ppt-diagram-cards.mjs';

const table=rows=>({id:'t',type:'TableBlock',rows});
const params=table([['模型','参数量（M）'],['VAE','4.3'],['MDN-RNN','422'],['Controller','0.9']]);
assert.equal(chooseTableDiagram(params),'column-chart');
const chart=tableDiagramComponent(params,'column-chart');
assert.equal(chart.type,'chart');assert.equal(chart.content.chartType,'bar');
assert.deepEqual(chart.content.labels,['VAE','MDN-RNN','Controller']);
assert.deepEqual(chart.content.values,[4.3,422,0.9],'the source values, nothing derived');
assert.equal(chart.content.chartTitle,'参数量（M）');
assert.equal(diagramCoverage(params,{type:'chart',content:chart.content}).complete,true,'every cell is shown');
const tampered={...chart.content,values:[4.3,420,0.9]};
assert.equal(diagramCoverage(params,{type:'chart',content:tampered}).complete,false,'a changed value fails coverage');

const twoSeries=table([['季度','收入','成本'],['一季度','1,200万','800万'],['二季度','1,350万','820万'],['三季度','1,500万','900万']]);
const both=tableDiagramComponent(twoSeries,chooseTableDiagram(twoSeries));
assert.deepEqual(both.content.series.map(s=>s.name),['收入','成本']);
assert.deepEqual(both.content.series[0].values,[1200,1350,1500]);
assert.equal(both.content.unit,'万');
assert.equal(diagramCoverage(twoSeries,{type:'chart',content:both.content}).complete,true);

assert.equal(chartSeries(table([['指标','值'],['A','10%'],['B','12 ms'],['C','15%']])),null,'mixed units stay a table');
assert.equal(chartSeries(table([['年份','收入'],['2021','10'],['2022','12'],['2023','15']])),null,'numeric categories stay a table');
assert.equal(chartSeries(table([['模型','分数'],['A','906 ± 21'],['B','840 ± 30'],['C','790 ± 15']])),null,'a value with its error is not a bare measure');
assert.equal(chartSeries(table([['阶段','耗时'],['一个很长很长的阶段名称','10'],['B','12'],['C','15']])),null,'long category names stay a table');
assert.equal(chartSeries(table([['A','B'],['x','1'],['y','2']])),null,'fewer than three categories stay a table');
assert.equal(chartSeries(table([['模型','训练轮数','准确率'],['A','600','72.9'],['B','600','77.5'],['C','300','79.3']])),null,'two unitless columns are different measures: a table');
assert.ok(chartSeries(table([['模型','准确率'],['A','72.9'],['B','77.5'],['C','79.3']])),'one unitless column is a chart');
const headerless={...table([['ViT-B/16','600','72.9'],['ViT-L/16','600','77.5'],['ViT-H/14','300','79.3'],['ViT-H/16 448','300','81.1']]),headerless:true};
assert.equal(chartSeries(headerless),null);assert.equal(chooseTableDiagram(headerless),null,'a headerless table has no names for a diagram: it stays a table');
console.log('PASS table charts: measures in one unit become column charts with full cell coverage');

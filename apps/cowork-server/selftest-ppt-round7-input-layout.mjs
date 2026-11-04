import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {sourceChart} from './lib/ppt-source-chart.mjs';
import {fitComponents,sourceComponent,sourceComponentParts} from './lib/ppt-density-capacity.mjs';
import {layoutBalance,inspectLayoutBalance} from './lib/ppt-layout-balance.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
import {renderPptx} from './lib/ppt-render.mjs';

const exported=[];
for (const [input,values,type] of [
  ['销量：Q1 120、Q2 150、Q3 170',[120,150,170],'bar'],
  ['Sales line chart: Q1 1,200, Q2 1,500',[1200,1500],'line'],
  ['折线图利润：A -4、B 7',[-4,7],'line'],
  ['饼图比例：A 40%、B 60%',[40,60],'pie'],
]) {
  const source=normalizePaste(input),item=source.semantic.inventory.items.find(item=>item.type==='ChartBlock');
  assert.ok(item,input);assert.deepEqual(item.chart.values,values);assert.equal(item.chart.chartType,type);
  const project={source,planning:{slidePlan:[{slideId:'data',sourceArtifacts:[{sourceUnitId:item.id}]}]},templateSpec:{fonts:{title:'Arial',body:'Arial',titleEastAsia:'Arial',bodyEastAsia:'Arial'},palette:{background:'#ffffff',foreground:'#202124',accent:'#7657e8',muted:'#666666'}},deck:{slides:[{id:'cover',title:'Overview',nodes:[]},{id:'data',title:'Observed data',nodes:[]}]}};
  bindSourceArtifacts(project,project.deck.slides[1],[{sourceUnitId:item.id}],1,[]);
  const tree=buildRenderTree(project);assert.ok(tree.slides[1].elements.some(element=>element.kind==='chart'));
  assert.equal(inspectObjectIntegrity(project).ledger.objects.find(object=>object.objectId===item.id).status,'rendered');
  exported.push({project,chart:item.chart});
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-round7-native-chart-')),python=process.env.PPT_TEST_PYTHON||'python3',runtime=localPptRuntime(temp,python);
try {
 for(const [index,{project,chart}] of exported.entries()){
  project.id='chart-'+index;const artifact=await renderPptx(project,runtime.io);
  const audit=spawnSync(python,['-c',String.raw`
import sys,json,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z:
 names=[n for n in z.namelist() if n.startswith('ppt/charts/chart') and n.endswith('.xml')]
 assert len(names)==1, names
 root=E.fromstring(z.read(names[0]));ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
 series=root.find('.//c:ser',ns)
 values=[float(n.text) for n in series.findall('./c:val//c:numCache/c:pt/c:v',ns)]
 labels=[n.text for n in series.findall('./c:cat//c:strCache/c:pt/c:v',ns)]
 assert any(n.startswith('ppt/embeddings/') and n.endswith('.xlsx') for n in z.namelist()), 'native editable chart workbook is missing'
 print(json.dumps({'values':values,'labels':labels}))
`,artifact.path],{encoding:'utf8'});
  assert.equal(audit.status,0,audit.stderr);const actual=JSON.parse(audit.stdout);
  assert.deepEqual(actual.values,chart.values,'the actual PPTX native chart keeps every source number');
  assert.deepEqual(actual.labels,chart.labels,'the actual PPTX native chart keeps every category');
 }
}finally {fs.rmSync(temp,{recursive:true,force:true});}
const tabular=normalizePaste('# Sales bar chart\n\n| Quarter | Sales |\n|---|---|\n| Q1 | 120 |\n| Q2 | 150 |');
assert.deepEqual(tabular.semantic.inventory.items.find(item=>item.type==='ChartBlock')?.chart.values,[120,150]);
assert.ok(normalizePaste('| Method | Count |\n|---|---|\n| A | 4 |\n| B | 7 |').semantic.inventory.items.some(item=>item.type==='TableBlock'),'a plain table stays a table');
for(const input of ['Create a revenue chart','销量：Q1 120万元、Q2 150%','销量：Q1 120、Q1 150','饼图：A -4、B 7'])assert.equal(sourceChart(input),null,'ambiguous or unsupported data stays source text');
const components=[{type:'table',content:{rows:[['Item','Value'],['A','4'],['B','7']]}},{type:'text',content:{text:'The complete observations are shown; A and B use the same measurement rule.'}}];
const fit=fitComponents(components);assert.ok(fit.capacity_ok);assert.equal(fit.layoutId,'asymmetric-source');assert.equal(fit.columnRatio,.65);
const balance=layoutBalance(fit.boxes,fit.canvas);assert.ok(balance.x<.001&&balance.y<.001);
assert.ok(fit.boxes.every(box=>Math.abs(box.y+box.height/2-fit.canvas.y-fit.canvas.height/2)<1),'both components center vertically');
const slide={id:'s',sourceArtifactFit:fit,nodes:components.map((component,index)=>({id:'n'+index,type:component.type,sourceArtifact:{sourceUnitId:'u'+index},geometry:fit.boxes[index]}))};
const project={deck:{slides:[{id:'cover'},slide]}};assert.deepEqual(inspectLayoutBalance(project),[]);
slide.nodes[1].geometry={...slide.nodes[1].geometry,x:fit.canvas.x+fit.canvas.width};assert.equal(inspectLayoutBalance(project)[0].code,'layout_unbalanced');
slide.nodes[1].userGeometry=true;assert.deepEqual(inspectLayoutBalance(project),[],'manual placement wins');
console.log('PPT round 7: Prompt source data becomes verified charts; table/explanation balanced 65/35 layout; manual geometry respected: OK');

{
 const size={width:12192000,height:6858000};
 const project={source:{text:'Source details '.repeat(1000)},templateFidelity:{mode:'preserve',...size,slides:[{}, {nodes:[{type:'text',nativeRef:{shapeId:10},geometry:{x:5422367,y:2064274,width:5918846,height:3500000},style:{fontSizePt:14.5}}],slots:[{shapeId:10,role:'content',purpose:'body'}]}]}};
 const text=Array.from({length:12},(_,i)=>'- [Reference '+i+' on architecture and generation workflow](https://example.com/source/'+i+')').join('\n');
 const item={id:'reference-list',type:'TaxonomyBlock',text},parts=sourceComponentParts(item),before=JSON.stringify(parts),fit=fitComponents(parts,project,1);
 assert.ok(fit.capacity_ok,'all twelve reference items fit without changing the source or template font');assert.equal(fit.fontSizePt,14.5);assert.equal(JSON.stringify(parts),before);assert.equal(fit.boxes.length,12);
 for(const box of fit.boxes)assert.ok(box.y+box.height<=fit.canvas.y+fit.canvas.height+1,'every source point remains inside the native content region');
 console.log('PASS complete reference-list fit: native 14.5pt type, original source items and clipping bounds retained');
}

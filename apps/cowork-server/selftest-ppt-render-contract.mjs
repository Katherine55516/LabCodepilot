import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {renderPdf} from './lib/ppt-pdf.mjs';
import {sourceDensityPlan} from './lib/ppt-density-packing.mjs';
import {normalizePaste,extractFile} from './lib/ppt-source.mjs';
import {applyRenderContract,measureText,chartContract,imageContract,PT_EMU} from './lib/ppt/render-contract.mjs';
import {renderIssues} from './lib/ppt/render-audit.mjs';
import {sourceComponent,measureComponent,contentCanvas} from './lib/ppt-density-capacity.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {buildRenderTree,rebuildRenderTree} from './lib/ppt/render-tree.mjs';
import {deterministicReview} from './lib/ppt-quality.mjs';
import {slideSvg} from './lib/ppt/exporters/preview.mjs';
import {_internals as exporter} from './lib/ppt-render.mjs';
import {_internals as nativeExporter} from './lib/ppt/import-pptx.mjs';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
const python=process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const persistent=process.env.PPT_CONTRACT_OUTPUT;
const root=persistent?path.resolve(persistent):fs.mkdtempSync(path.join(os.tmpdir(),'ppt-contract-'));
fs.mkdirSync(root,{recursive:true});const runtime=localPptRuntime(root,python);
const size={width:12192000,height:6858000};
const fonts={title:'Arial',body:'Arial',titleEastAsia:'Noto Sans CJK SC',bodyEastAsia:'Noto Sans CJK SC',cjkExplicit:true};
const palette={background:'#ffffff',accent:'#6758c8',foreground:'#111827',muted:'#222222'};
const code='def verify(value):\n    if value < 0:\n        return "保留负号"\n\n    return value\n';
const input='# Technical guide\n\n## Implementation\n\n```python\n'+code+'```\n\n## Workflow\n\n1. Intake request\n2. Validate evidence\n3. Decide release or rollback\n';
try {
 const paste=normalizePaste(input),markdown=await extractFile({id:'md'},'guide.md',Buffer.from(input),runtime.io);
 for(const source of [paste,markdown]){
  assert.ok(source.semantic.inventory.items.some(i=>i.type==='ProcessBlock'),'ordered workflow has a structural obligation');
  const item=source.semantic.inventory.items.find(item=>item.type==='CodeBlock');assert.ok(item);assert.equal(item.text,code.slice(0,-1));assert.equal(item.language,'python');assert.equal(item.must_preserve_structure,true);
  const component=sourceComponent(item);assert.equal(component.content.codeBlock.sourceText,item.text);
  const project={id:'code',source,templateSpec:{fonts,palette},planning:{slidePlan:[{slideId:'s',sourceArtifacts:[{sourceUnitId:item.id}]}]}};
  const slide={id:'s',nodes:[]};bindSourceArtifacts(project,slide,[{sourceUnitId:item.id}],0);
  assert.equal(slide.nodes[0].content.text,item.text);assert.equal(inspectObjectIntegrity(project,[slide]).ledger.objects.find(o=>o.objectId===item.id).status,'rendered');
  slide.nodes[0].content.text=slide.nodes[0].content.text.replace('    if',' if');assert.equal(inspectObjectIntegrity(project,[slide]).ledger.objects.find(o=>o.objectId===item.id).status,'failed','indentation loss is an object failure');
 }
 const csv='Metric,Value,Note\nDrawdown,-12.5,"USD | net"\nMissing,,"two\nlines"\n';
 const csvSource=await extractFile({id:'csv'},'data.csv',Buffer.from(csv),runtime.io);
 const matrix=[['Metric','Value','Note'],['Drawdown','-12.5','USD | net'],['Missing','','two\nlines']];
 assert.deepEqual(csvSource.semantic.inventory.items.find(i=>i.type==='TableBlock').rows,matrix);
 const html=await extractFile({id:'html'},'guide.html',Buffer.from('<h1>Guide</h1><pre>'+code+'</pre><table><tr><th>A</th><th>B</th></tr><tr><td>-4</td><td></td></tr></table>'),runtime.io);
 assert.equal(html.semantic.inventory.items.find(i=>i.type==='CodeBlock').text,code);
 assert.deepEqual(html.semantic.inventory.items.find(i=>i.type==='TableBlock').rows,[['A','B'],['-4','']]);
 const office=spawnSync(python,['-c',`from openpyxl import Workbook\nfrom docx import Document\nfrom pptx import Presentation\nimport sys\nw=Workbook();s=w.active;s.append(['Metric','Value','Note']);s.append(['Drawdown',-12.5,'USD | net']);s.append(['Missing',None,'two\\nlines']);w.save(sys.argv[1]+'/data.xlsx')\nd=Document();t=d.add_table(rows=2,cols=2);t.cell(0,0).text='Name';t.cell(0,1).text='Value';t.cell(1,0).text='Loss';t.cell(1,1).text='-4';d.save(sys.argv[1]+'/data.docx')\np=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);t=s.shapes.add_table(2,2,0,0,4000000,2000000).table;t.cell(0,0).text='Name';t.cell(0,1).text='Value';t.cell(1,0).text='Loss';t.cell(1,1).text='-4';p.save(sys.argv[1]+'/data.pptx')`,root]);assert.equal(office.status,0,office.stderr.toString());
 for(const ext of ['xlsx','docx','pptx']){
  const source=await extractFile({id:ext},'data.'+ext,fs.readFileSync(path.join(root,'data.'+ext)),runtime.io);
  const table=source.semantic.inventory.items.find(i=>i.type==='TableBlock');assert.ok(table?.rows.length>=2,ext+' matrix');
  if(ext==='xlsx')assert.deepEqual(table.rows,matrix);
 }
 const text=(value,width=300,height=140)=>applyRenderContract({id:'text',nodeId:'text',kind:'text',bounds:{x:0,y:0,width:width*PT_EMU,height:height*PT_EMU},style:{fontSizePt:18,lineHeight:1.18},content:{text:value},zIndex:1});
 for(const value of ['Short operating brief: validate records before release.','双语机制说明：先核验再发布。\nValidate records before release.','A'.repeat(130),'第一段。\n\n第二段包含成立条件。']){
  const e=text(value);assert.equal(e.textLayout.wrap,true);assert.ok(!measureText(e).overflow);
  const svg=slideSvg({size,elements:[e]});assert.match(svg,/white-space:pre-wrap/);assert.match(svg,/overflow-wrap:anywhere/);
 }
 const tiny=text('中',4,100);assert.ok(measureText(tiny).widthOverflow,'one glyph cannot fit in a narrower frame even with wrapping');
 const cjkCode=applyRenderContract({...text('中'.repeat(20),200,100),content:{text:'中'.repeat(20),codeBlock:{language:'text'}}});assert.equal(measureText(cjkCode).lines,3,'CJK code glyphs consume full em width');
 const mixed=applyRenderContract({...text('',300,100),style:{fontSizePt:28},content:{paragraphs:[{label:'条件',body:'需要先核验记录。 Validate evidence.'}]},nativeTextFrame:{paragraphs:[{runs:[{text:'条件',fontSizePt:24},{text:'需要先核验记录。 Validate evidence.',fontSizePt:16}],lineSpacing:1.18,spaceAfterPt:8}]}});
 assert.deepEqual(mixed.textLayout.paragraphs[0].runs.map(r=>r.fontSizePt),[24,16]);assert.ok(!measureText(mixed).overflow);assert.match(slideSvg({size,elements:[mixed]}),/font-size:21\.333/);
 const nativeParas=applyRenderContract({...text('First\n第二段',300,100),nativeTextFrame:{paragraphs:[{text:'First',runs:[{text:'First',fontSizePt:20}],lineSpacing:1.1,spaceAfterPt:6},{text:'第二段',runs:[{text:'第二段',fontSizePt:16}],lineSpacing:1.3,spaceAfterPt:0}]}});
 assert.deepEqual(nativeParas.textLayout.paragraphs.map(p=>p.spaceAfterPt),[6,0]);assert.deepEqual(nativeParas.textLayout.paragraphs.map(p=>p.lineHeight),[1.1,1.3]);
 const invalidTable=applyRenderContract({id:'bad-table',nodeId:'bad-table',kind:'table',bounds:{x:0,y:0,width:400*PT_EMU,height:100*PT_EMU},content:{rows:[['a','b']],columnWeights:[0,0]},style:{fontSizePt:18}});
 assert.ok(renderIssues({slides:[{id:'s',size,elements:[invalidTable]}]}).some(i=>i.code==='table_weights_invalid'),'invalid weights cannot pass through NaN capacity math');
 assert.ok(renderIssues({slides:[{id:'s',size,elements:[{id:'missing-frame',nodeId:'missing-frame',kind:'text',content:{text:'Bad geometry'}}]}]}).some(i=>i.code==='render_geometry_invalid'),'malformed frames fail quality instead of crashing it');
 const asset={id:'evidence',type:'image',nativeRef:{shapeId:10},geometry:{x:500*PT_EMU,y:140*PT_EMU,width:250*PT_EMU,height:300*PT_EMU},content:{mustPreserve:true,mediaRole:'evidence'}};
 const protectedProject={id:'protected',source:paste,templateFidelity:{width:size.width,height:size.height,slides:[{nodes:[asset],slots:[]}]}};
 const region=contentCanvas(protectedProject,0).geometry;
 assert.ok(region.x+region.width<=asset.geometry.x || region.x>=asset.geometry.x+asset.geometry.width || region.y+region.height<=asset.geometry.y || region.y>=asset.geometry.y+asset.geometry.height,'protected evidence is not available writing space');
 assert.ok(inspectObjectIntegrity(protectedProject,[{id:'s',nodes:[],templateOmissions:[{shapeId:10,reason:'need more room'}]}]).issues.some(i=>i.code==='template_media_unaccounted'),'saving room does not authorize loss of protected assets');
 const excludedAsset={...protectedProject,sourceObjectExclusions:[{objectId:asset.id,approvedBy:'user',sourceHash:paste.sha256,reason:'User excluded this evidence image'}]};
 assert.equal(inspectObjectIntegrity(excludedAsset,[{id:'s',nodes:[]}]).ledger.templateAssets[0].status,'excluded_by_user','explicit current-source approval remains valid');
 const emptyRows=normalizePaste('# Data\n\n| A | B |\n| --- | --- |\n|  |  |\n| `a\\|b` | -4 |');
 assert.deepEqual(emptyRows.semantic.inventory.items.find(i=>i.type==='TableBlock').rows.slice(0,2),[['A','B'],['','']]);
 const overflow=text('双语 dense text '.repeat(100),90,25);
 assert.ok(renderIssues({slides:[{id:'s',size,elements:[overflow]}]}).some(i=>i.code==='typography_capacity'&&i.severity==='error'));
 overflow.nativeRef={shapeId:1};assert.ok(renderIssues({slides:[{id:'s',size,elements:[overflow]}]}).some(i=>i.code==='typography_capacity'),'native ref cannot exempt visible loss');
 const project={id:'gate',templateSpec:{fonts,palette},deck:{slides:[{id:'s',title:'A clear statement',nodes:[{id:'bad',type:'text',semanticRole:'source-explanation',geometry:overflow.bounds,content:overflow.content,style:overflow.style}]}]}};
 assert.ok(deterministicReview(project).issues.some(i=>i.code==='typography_capacity'&&i.severity==='error'),'generation workflow uses the same gate');
 const importedProject={...project,externalPptx:{mode:'preserve',width:9144000,height:6858000},deck:{slides:[{id:'s',nativeSlideIndex:0,nodes:[{id:'bad',type:'text',nativeRef:{slideIndex:0,shapeId:1},geometry:overflow.bounds,content:overflow.content,style:overflow.style,nativeTextFrame:{margins:[0,0,0,0]}}]}]}};
 const importedTree=buildRenderTree(importedProject);assert.equal(importedTree.slides[0].size.width,9144000);assert.deepEqual(importedTree.slides[0].elements[0].textLayout.margins,[0,0,0,0]);
 const legacyTree=structuredClone(importedTree);delete legacyTree.renderContractVersion;delete legacyTree.slides[0].elements[0].textLayout;
 assert.ok(rebuildRenderTree(importedProject,legacyTree,['unrelated']).slides[0].elements[0].textLayout,'legacy incremental caches must regenerate contracts even on unaffected pages');
 assert.equal(chartContract({labels:['a'],values:[-1],chartType:'pie'}).valid,false);
 assert.equal(imageContract({crop:[null,0,0,0]}).valid,false);assert.equal(imageContract({crop:[.96,0,.01,0]}).valid,true);
 for(const values of [[-1,-4],[0,0],[.1,-.2],[3,2]]){const a=chartContract({labels:['a','b'],values,chartType:'bar'});assert.ok(a.valid);assert.ok(a.minimum<=Math.min(0,...values));assert.ok(a.maximum>=Math.max(0,...values));}
 const rich=normalizePaste('# Operating mechanism\n\n'+('Records are validated before release; if evidence is missing, the owner must stop the release and investigate because downstream users depend on accuracy. ').repeat(8));
 const balanced=sourceDensityPlan(rich,{generationPolicy:{detail:'balanced'}}),detailed=sourceDensityPlan(rich,{generationPolicy:{detail:'detailed'}});assert.ok(detailed.contentCost>balanced.contentCost);assert.ok(balanced.contentCost>65,'deep source is not reduced to one fixed short summary budget');
 const elements=[];
 const add=(kind,content,x,y,w,h,style={})=>{const e=applyRenderContract({id:kind+elements.length,nodeId:kind+elements.length,kind,bounds:{x:x*PT_EMU,y:y*PT_EMU,width:w*PT_EMU,height:h*PT_EMU},content,style:{fontSizePt:18,lineHeight:1.18,color:'#111827',...style},zIndex:1});elements.push(e);return e;};
 add('text',{text:'多输入渲染契约 / Cross-input rendering'},40,25,870,60,{fontSizePt:28});
 add('text',sourceComponent(paste.semantic.inventory.items.find(i=>i.type==='CodeBlock')).content,45,105,390,180);
 const table=sourceComponent(csvSource.semantic.inventory.items.find(i=>i.type==='TableBlock'));
 const tableMeasurement=measureComponent(table,{width:450*PT_EMU,height:250*PT_EMU},18);Object.assign(table.content,{columnWeights:tableMeasurement.columnWeights,rowWeights:tableMeasurement.rowWeights});
 add('table',table.content,465,105,450,200);
 const chart=add('chart',{labels:['Profit','Loss','Zero'],values:[5,-4,0],chartType:'bar',unit:'USD'},45,315,390,185);
 const domain=chart.chartLayout;assert.ok(domain.minimum<0&&domain.maximum>0);assert.match(domain.svg,/data-value="-4"/);
 const imageOut=spawnSync(python,['-c',"from PIL import Image,ImageDraw\nimport sys\ni=Image.new('RGB',(400,100),'white');d=ImageDraw.Draw(i);d.rectangle((0,0,99,99),fill='red');d.rectangle((300,0,399,99),fill='blue');i.save(sys.argv[1])",path.join(root,'image.png')]);assert.equal(imageOut.status,0);
 const dataUrl='data:image/png;base64,'+fs.readFileSync(path.join(root,'image.png')).toString('base64');
 add('image',{dataUrl,fit:'contain'},465,325,130,165);add('image',{dataUrl,fit:'cover'},620,325,130,165);add('image',{dataUrl,crop:[.25,0,.25,0]},775,325,130,165);
 const slide={id:'s',size,background:'#ffffff',elements};
 assert.equal(renderIssues({slides:[slide]}).filter(i=>i.severity==='error').length,0,JSON.stringify(renderIssues({slides:[slide]})));
 fs.writeFileSync(path.join(root,'fixture.svg'),slideSvg(slide));fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify(slide,null,2));
 const aligned=applyRenderContract({...text('',300,100),bounds:{x:400*PT_EMU,y:0,width:300*PT_EMU,height:100*PT_EMU},style:{fontSizePt:18,textAlign:'right'},content:{paragraphs:[{body:'First paragraph.'},{body:'第二段，保留右对齐。'}]}});
 const out=spawnSync(python,['-c',exporter.SCRIPT],{input:JSON.stringify({slides:[{title:'Fixture',bullets:[]},{title:'Paragraph contract',bullets:[]}],renderTree:{slides:[slide,{id:'rich',size,elements:[mixed,aligned]}]},fonts,palette}),env:{...process.env,PPT_OUTPUT:path.join(root,'fixture.pptx')},maxBuffer:4e6});assert.equal(out.status,0,out.stderr.toString());
 const runsCheck=spawnSync(python,['-c',"from pptx import Presentation\nfrom pptx.enum.text import PP_ALIGN\nimport sys\np=Presentation(sys.argv[1]);a=next(x for x in p.slides[1].shapes if x.has_text_frame and '条件' in x.text);b=next(x for x in p.slides[1].shapes if x.has_text_frame and 'First paragraph.' in x.text)\nassert [r.font.size.pt for r in a.text_frame.paragraphs[0].runs]==[24,16]\nassert all(x.alignment==PP_ALIGN.RIGHT for x in b.text_frame.paragraphs)",path.join(root,'fixture.pptx')]);assert.equal(runsCheck.status,0,runsCheck.stderr.toString());
 const inspection=spawnSync(python,['-c',`from pptx import Presentation\nimport json,sys\np=Presentation(sys.argv[1]);s=p.slides[0];c=next(x.chart for x in s.shapes if x.has_chart);pic=[x for x in s.shapes if x.shape_type==13];texts=[x for x in s.shapes if x.has_text_frame and x.text];print(json.dumps({'rows':[[cell.text for cell in row.cells] for row in next(x.table for x in s.shapes if x.has_table).rows],'values':list(c.series[0].values),'min':c.value_axis.minimum_scale,'max':c.value_axis.maximum_scale,'cross':c.value_axis.crosses_at,'wrap':[x.text_frame.word_wrap for x in texts],'auto':[str(x.text_frame.auto_size) for x in texts],'texts':[x.text for x in texts],'crop':[[x.crop_left,x.crop_top,x.crop_right,x.crop_bottom] for x in pic]}))`,path.join(root,'fixture.pptx')]);assert.equal(inspection.status,0,inspection.stderr.toString());
 const result=JSON.parse(inspection.stdout);assert.deepEqual(result.rows,matrix);assert.deepEqual(result.values,[5,-4,0]);assert.equal(result.min,domain.minimum);assert.equal(result.max,domain.maximum);assert.equal(result.cross,0);assert.ok(result.wrap.every(Boolean));assert.ok(result.auto.every(v=>v.startsWith('NONE')));assert.ok(result.texts.includes(code.slice(0,-1)));assert.deepEqual(result.crop[2],[.25,0,.25,0]);
 const nativeCode={type:'text',geometry:{x:45*PT_EMU,y:200*PT_EMU,width:390*PT_EMU,height:180*PT_EMU},content:elements[1].content,style:elements[1].style,textLayout:elements[1].textLayout,sourceArtifact:{sourceUnitId:'code',type:'CodeBlock'}};
 const nativeOut=spawnSync(python,['-c',nativeExporter.EXPORT_SCRIPT],{input:JSON.stringify({original:path.join(root,'data.pptx'),slides:[{nativeSlideIndex:0,nodes:[],sourceArtifacts:[nativeCode]}],fonts}),env:{...process.env,PPT_SOURCE:path.join(root,'data.pptx'),PPT_OUTPUT:path.join(root,'native-code.pptx')},maxBuffer:4e6});assert.equal(nativeOut.status,0,nativeOut.stderr.toString());
 const nativeCheck=spawnSync(python,['-c',"from pptx import Presentation\nimport sys\np=Presentation(sys.argv[1]);s=next(x for x in p.slides[0].shapes if x.name.startswith('AIMate source:'));assert s.text==sys.argv[2];assert s.text_frame.word_wrap and str(s.text_frame.auto_size).startswith('NONE');assert s.text_frame.paragraphs[0].runs[0].font.name in ('Consolas','Noto Sans Mono CJK SC','Noto Sans Mono CJK TC','DejaVu Sans Mono','Liberation Mono','Courier New','Menlo')",path.join(root,'native-code.pptx'),code.slice(0,-1)]);assert.equal(nativeCheck.status,0,nativeCheck.stderr.toString());
 if(process.env.PPT_CONTRACT_PDF==='1'){
  await renderPdf({id:'pdf',publishedArtifactPath:path.join(root,'fixture.pptx'),pdfArtifactPath:path.join(root,'fixture-production.pdf')},runtime.io);
  const checked=spawnSync(python,['-c',`import pdfplumber,sys,json
with pdfplumber.open(sys.argv[1]) as p:
 s=p.pages[0];bars=[r for r in s.rects if 45<r['x0']<435 and r['top']>315 and tuple(round(v,2) for v in (r['non_stroking_color'] or []))==(0.4,0.35,0.78)]
 labels=[w for w in s.extract_words() if w['text']=='-4']
 assert len(bars)==2,str(bars)
 bars.sort(key=lambda r:r['x0']);assert bars[1]['top']>=bars[0]['bottom']-1 and bars[1]['bottom']>bars[0]['bottom']
 assert labels and labels[0]['top']>bars[1]['top']
 assert '保留负号' in s.extract_text().replace(' ','')
 two=next(w for w in s.extract_words() if w['text']=='two');last=next(w for w in s.extract_words() if w['text']=='lines')
 assert abs(two['x0']-last['x0'])<1 and last['top']>two['bottom'] and last['bottom']<305
 ascii=[c for c in s.chars if 105<c['top']<140 and c['x0']<430 and c['text'] in 'defverify']
 assert ascii and max(c['adv'] for c in ascii)-min(c['adv'] for c in ascii)<.1
 print(json.dumps({'signedBars':True,'negativeLabel':True,'chineseGlyphs':True,'codeMonospaceAdvances':True,'tableHardBreaks':True}))`,path.join(root,'fixture-production.pdf')]);
  assert.equal(checked.status,0,checked.stderr.toString());result.pdf=JSON.parse(checked.stdout);
 }
 fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify({inputs:['paste/Markdown','HTML pre/table','CSV','XLSX','DOCX','PPTX'],native:result,visibleGate:true,previewSigned:true,codeIndentation:true},null,2));
 console.log('PPT general render contract: typed input matrices/code, visible-loss hard gate, signed charts, image fit/crop and production PPTX: OK');
} finally {if(!persistent)fs.rmSync(root,{recursive:true,force:true});}

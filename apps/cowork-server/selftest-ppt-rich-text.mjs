import {_internals as commands} from './lib/ppt/command-service.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {sourceRichText,sourceDisplayText,richTextContent,ensureRichContent} from './lib/ppt-rich-text.mjs';
import {compileContentSelection,selectionSource} from './lib/ppt-content-selection.mjs';
import {OFFICE_MATH_SCRIPT} from './lib/ppt-math.mjs';
import {EXPORT_VERIFY_SCRIPT} from './lib/ppt/export-verifier-python.mjs';
import {renderPptx} from './lib/ppt-render.mjs';import {importEditablePptx,renderImportedPptx} from './lib/ppt/import-pptx.mjs';
import {exportManifest} from './lib/ppt-export-integrity.mjs';import {localPptRuntime} from './test/ppt-local-runtime.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';import {ensureProjectV3} from './lib/ppt/ir.mjs';
for(const value of ['$10 and $20','snake_case','a*b','C:\\Users\\name'])assert.equal(sourceDisplayText(value),value);
assert.equal(sourceDisplayText('`a**b $x_i$ snake_case`'),'a**b $x_i$ snake_case');
assert.equal(sourceDisplayText('```python\na**b $x_i$\n```'),'a**b $x_i$');
assert.equal(sourceDisplayText('# Title\n\n- **First**\n- Second'),'Title\n• First\n• Second');
assert.equal(sourceRichText('$\\unknownmacro{x}$').diagnostics[0].code,'math_parse_unsupported');
assert.equal(sourceRichText('r_i^{RMW}').diagnostics[0].code,'math_delimiter_missing');
const text='**Model** $r_{i,t}=\\alpha_i+\\beta_i^{\\top}f+\\epsilon_{i,t}$; price $10 and $20.';
const rich=sourceRichText(text);assert.equal(rich.source,text);assert.equal(rich.runs[0].bold,true);assert.equal(rich.diagnostics.length,0);
assert.ok(rich.runs.find(r=>r.kind==='math').fallbackRuns.some(r=>r.baseline<0));
const root=process.env.PPT_RICH_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ppt-rich-')),python=process.env.PPT_TEST_PYTHON||'python3';fs.mkdirSync(root,{recursive:true});
const runtime=localPptRuntime(root,python),I=914400;
try{
 const rows=[['Term','Meaning'],['Indexed factor','$f_{1},\\ldots,f_{K}$'],['Restriction','$\\alpha\\neq 0$'],['Tail','Complete condition']],cellRich=rows.map(r=>r.map(sourceRichText));
 let p=ensureProjectV3({id:'rich',uid:'rich',template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),pages:1,outline:[{id:'one',title:'Formula fidelity'}],deck:{slides:[{id:'one',title:'Formula fidelity',layoutId:'summary',nodes:[
  {id:'text',type:'text',slotId:'absolute',geometry:{x:I*.5,y:I*.9,width:I*11,height:I*.8},style:{fontSizePt:14.5,color:'#242a3b'},content:richTextContent(text),sourceArtifact:{sourceUnitId:'inline',type:'ExplanationBlock'}},
  {id:'table',type:'table',slotId:'absolute',geometry:{x:I*.5,y:I*2,width:I*11,height:I*3},style:{fontSizePt:14.5,color:'#242a3b'},content:{rows:cellRich.map(r=>r.map(c=>c.plainText)),cellRich,rawRows:rows},sourceArtifact:{sourceUnitId:'cells',type:'TableBlock'}}
 ]}]}});
 p.deck.slides[0].nodes.push({id:'points',type:'list',sourceArtifact:{sourceUnitId:'points',type:'ChecklistBlock'},slotId:'absolute',geometry:{x:I*.5,y:I*5.2,width:I*11,height:I*1.4},style:{fontSizePt:18,color:'#242a3b'},content:ensureRichContent({pointLayout:{fontSizePt:18,boxes:[{x:0,y:0,w:.48,h:1},{x:.52,y:0,w:.48,h:1}]},items:[{id:'p1',text:'**Fraction**\n$\\frac{x_i}{1+y^2}$ and $\\sqrt{x}$'},{id:'p2',text:'Matrix\n$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$'}]})});
 for(const [lang,label] of [['zh','風險與条件'],['zh-HK','風險與條件']]){const slide=structuredClone(p.deck.slides[0]);slide.id=lang;slide.title=label;slide.nodes.forEach(n=>n.id=lang+'-'+n.id);slide.nodes[0].content=richTextContent(label+' **完整保留且*不同*** $\\alpha_i\\neq 0$');p.deck.slides.push(slide);p.outline.push({id:lang,title:label});}p.pages=3;
 p.generationPolicy={content:'overview',details:'notes'};p.pageDecision={mode:'explicit',finalPageCount:3};
 p.source={text:'Complete original notes source',semantic:{inventory:{items:[{id:'main',type:'DefinitionBlock',text:'Core definition'},{id:'detail',type:'ExampleBlock',text:'Full notes: omitted secondary example; price $10 and $20; table tail remains intact.'}],relationships:[]}}};
 p.originalSourceInventory=structuredClone(p.source.semantic.inventory);p.deck.slides[0].sourceUnitIds=['main'];
 p.contentSelection=compileContentSelection(p,{slides:p.deck.slides,selection:[{sourceUnitId:'main',destination:'slides',reason:'Main claim'},{sourceUnitId:'detail',destination:'notes',reason:'Secondary example retained in speaker notes'}]});p.source=selectionSource(p,p.contentSelection);
 p.deck.slides.forEach(s=>s.nodeOrder=s.nodes.map(n=>n.id));delete p.renderTree;
 const exported=await renderPptx(p,runtime.io);assert.equal(exported.exportVerification.status,'passed');fs.copyFileSync(exported.path,path.join(root,'rich.pptx'));fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(exportManifest(p),null,2));
 const reimported=await importEditablePptx({id:'reimport',uid:'rich',title:'Roundtrip'},fs.readFileSync(exported.path),'source',runtime.io);reimported.templateSpec=p.templateSpec;
 assert.ok(reimported.deck.slides[0].nodes.some(n=>n.content.text===rich.plainText&&n.content.nativeMath));
 assert.deepEqual(reimported.deck.slides[0].nodes.find(n=>n.type==='table').content.rows,cellRich.map(r=>r.map(c=>c.plainText)));
 const roundtrip=await renderImportedPptx(reimported,runtime.io);assert.equal(roundtrip.exportVerification.status,'passed');
 const editedNative=structuredClone(reimported),editable=editedNative.deck.slides[0].nodes.find(n=>n.type==='text'&&n.content.nativeMath);
 assert.match(editable.content.rawText,/\\frac|\\alpha|α/);
 const changed=commands.applyToDeck(editedNative.deck,{type:'node.setContent',payload:{slideId:editedNative.deck.slides[0].id,nodeId:editable.id,content:{text:'**Model** $x_1^2$'}}},editedNative);editedNative.deck=changed.deck;delete editedNative.renderTree;
 fs.writeFileSync(path.join(root,'edited-native-project.json'),JSON.stringify(editedNative,null,2));
 const editedExport=await renderImportedPptx(editedNative,runtime.io);assert.equal(editedExport.exportVerification.status,'passed');fs.copyFileSync(editedExport.path,path.join(root,'edited-native-math.pptx'));
 const script='from pptx import Presentation\nfrom pptx.util import Pt\nfrom pptx.oxml.xmlchemy import OxmlElement\nfrom pptx.oxml.ns import qn\nimport sys,json\n'+OFFICE_MATH_SCRIPT+EXPORT_VERIFY_SCRIPT;
 for(const fault of ['omml','baseline','tail','bold','size']){
  const bad=path.join(root,fault+'.pptx');const edit=spawnSync(python,['-c',`from pptx import Presentation\nimport sys\np=Presentation(sys.argv[1]);fault=sys.argv[3]\nfor shape in p.slides[0].shapes:\n if fault=='omml':\n  for v in shape._element.findall('.//{http://schemas.openxmlformats.org/officeDocument/2006/math}sSub'):v.tag='{http://schemas.openxmlformats.org/officeDocument/2006/math}sSup'\n if fault=='baseline':\n  for v in shape._element.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}rPr'):\n   if v.get('baseline')=='-25000':v.set('baseline','30000')\n if fault=='tail' and shape.has_table:shape.table.cell(3,1).text='Lost condition'\n if fault=='size':\n  for v in shape._element.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}rPr'):\n   if v.get('baseline')=='-25000':v.set('sz','940')\n if fault=='bold' and shape.has_text_frame:\n  for v in shape._element.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}rPr'):\n   if v.get('b')=='1':v.set('b','0')\np.save(sys.argv[2])`,exported.path,bad,fault],{encoding:'utf8'});assert.equal(edit.status,0,edit.stderr);
  const check=spawnSync(python,['-c',script+'\nverify_export(sys.argv[1],json.load(sys.stdin))',bad],{input:JSON.stringify(exportManifest(p)),encoding:'utf8'});assert.notEqual(check.status,0,`must detect ${fault}`);
 }
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({parser:'passed',mapped:'passed',nativeRoundtrip:'passed',negative:['omml','baseline','tail','bold','size'],visual:exported.exportVerification.visualEvidence},null,2));
 console.log('rich text parser, real inline/cell OMML, editable fallback, native reimport and corruption checks: passed');
}catch(e){console.error('Evidence:',root);throw e;}

import {_internals as commands} from './lib/ppt/command-service.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {sourceRichText,sourceDisplayText,richTextContent,ensureRichContent,undelimitedMath,plainMath} from './lib/ppt-rich-text.mjs';
// Already-numbered card bodies are inline content, not nested Markdown lists.
{const raw='5. 2007) and information seeking (Schmidhuber et al., 1994;';
 const item=ensureRichContent({items:[{text:'2007) and information seeking (Schmidhuber et al., 1994;',heading:'',body:raw}]}).items[0];
 assert.equal(item.body,raw);assert.equal(item.bodyRich.plainText,raw);
 const rich=ensureRichContent({items:[{text:'**Bold** and $x$',heading:'',body:'1. **Bold** and $x$'}]}).items[0];
 assert.ok(rich.bodyRich.runs.some(run=>run.bold));assert.ok(rich.bodyRich.runs.some(run=>run.kind==='math'));
}
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

{
 const {sourceSentences}=await import('./lib/ppt-source-boundaries.mjs');
 for(const text of ['**Empirical failures.** CAPM was tested extensively. Another complete sentence.','1. **Only beta matters.** Idiosyncratic risk is diversifiable.','**只有贝塔重要。** 特异性风险可以分散。','The condition is *important; preserve its scope*. Next sentence.','Use `first(); second()` before release. Then validate.','Use $x=1; y=2$ as the stated condition. Then validate.']){
  const pieces=sourceSentences(text);assert.equal(pieces.join(''),text,'sentence indexing preserves every exact original character');
  for(const piece of pieces)assert.equal(sourceRichText(piece).plainText.includes('**'),false,'complete bold spans remain renderable after segmentation');
 }
 const bold=sourceSentences('**Empirical failures.** CAPM was tested. Another sentence.');assert.ok(bold[0].startsWith('**Empirical failures.** CAPM'));
 console.log('PASS source boundaries: complete emphasis/code/math spans survive segmentation with exact original text and no leaked bold markup');
}

{// Mathematics outside $...$ (Fable, live fz-r9 page 14): found by one rule shared with the gate, shown as plain Unicode.
 for(const text of ['Total Assets_{t-1}','\\Delta x','β_t','总资产_{t-1}'])assert.ok(undelimitedMath(text).length,text);
 for(const text of ['snake_case','C:\\Users','10^6','$x_{t-1}$','Assetsₜ₋₁','plain words only'])assert.deepEqual(undelimitedMath(text),[],text);
 assert.deepEqual(undelimitedMath('I/A = \\Delta Total Assets / Total Assets_{t-1}, low-minus-high'),['\\Delta Total Assets / Total Assets_{t-1}'],'one fragment per clause');
 const cases=[['I/A = \\Delta Total Assets / Total Assets_{t-1}, low-minus-high','I/A = Δ Total Assets / Total Assetsₜ₋₁, low-minus-high'],
  ['r_i - r_f = \\beta_i^{MKT}\\, MKT + \\epsilon_i','rᵢ - r_(f) = βᵢ^(MKT) MKT + εᵢ'],['\\frac{x+1}{2}','(x+1)/2'],['\\alpha_{i} > 0','αᵢ > 0'],
  ['I/A = \\Delta 总资产 / 总资产_{t-1}，低减高','I/A = Δ 总资产 / 总资产ₜ₋₁，低减高'],['Keep $x_{t-1}$ and \\beta_{i}','Keep $x_{t-1}$ and βᵢ'],
  // A symbol command on its own (world_models 2026-11-01: "1092 \pm 556" was shown as written).
  ['Best actual score is 1092 \\pm 556','Best actual score is 1092 ± 556'],['C:\\Users\\max','C:\\Users\\max']];
 for(const [text,expected] of cases){const plain=plainMath(text);assert.equal(plain,expected);assert.deepEqual(sourceRichText(plain).diagnostics,[],'no diagnostic: '+plain);}
 assert.equal(sourceRichText('I/A = \\Delta Total Assets').diagnostics[0]?.code,'math_delimiter_missing','the gate finds the same mathematics');
 console.log('PASS undelimited math: shared detection and plain-text fallback');}
{// Names spelled as letters are one upright identifier (Fable review fz-r15: "S M B" read as a product).
 const {equationContent}=await import('./lib/ppt-math.mjs');
 const ml=text=>equationContent(text).mathMl.replace(/<annotation[\s\S]*<\/annotation>/u,'');
 assert.match(ml('r_i-r_f=\\beta_i MKT_i+s_i SMB'),/<msub><mi mathvariant="normal">MKT<\/mi><mi>i<\/mi><\/msub>.*<mi mathvariant="normal">SMB<\/mi>/u);
 assert.match(ml('\\frac{Cov(r_i,r_m)}{Var(r_m)}'),/<mi mathvariant="normal">Cov<\/mi>[\s\S]*<mi mathvariant="normal">Var<\/mi>/u);
 assert.match(ml('r_i+ab'),/<msub><mi>r<\/mi><mi>i<\/mi><\/msub><mo>\+<\/mo><mi>a<\/mi><mi>b<\/mi>/u,'single letters and products stay italic');
 assert.match(ml('\\frac{\\mathrm{Cov}(r_i,r_m)}{\\mathrm{Var}(r_m)}'),/<mfrac>[\s\S]*<mi mathvariant="normal">Cov<\/mi>[\s\S]*<mi mathvariant="normal">Var<\/mi>/u,'upright letters inside a fraction (Fable review r16)');
 assert.match(ml('SmallHigh+BigLow'),/<mi mathvariant="normal">SmallHigh<\/mi>/u,'four or more letters in any case');
 assert.match(ml('w_{mkt}'),/<msub><mi>w<\/mi><mi mathvariant="normal">mkt<\/mi><\/msub>/u,'a 3-letter subscript is one upright label (Fable plan T21)');
 assert.match(ml('x_{bm}'),/<mi mathvariant="normal">bm<\/mi>/u,'a known 2-letter name');
 assert.match(ml('w_{ij}'),/<mrow><mi>i<\/mi><mi>j<\/mi><\/mrow>/u,'two index letters stay separate');
 console.log('PASS formula identifiers: letter runs that spell a name are one upright identifier');}
{// Inline code breaks only after . _ , (Fable plan T29, mlq p46 "KFold(shuffle=True"): measured as one token.
 const {measureText,textContract}=await import('./lib/ppt/render-contract.mjs');
 const element=text=>({kind:'text',content:richTextContent(text),style:{fontSizePt:14},bounds:{width:1.6*914400,height:0}});
 const lines=text=>{const e=element(text);return measureText(e,textContract(e)).lines;};
 assert.ok(lines('Use `KFold(shuffle=True)` here')>=lines('Use KFold here'),'the code span is not split at its parenthesis');
 const {sourceRichText:rich}=await import('./lib/ppt-source-text.mjs');assert.ok(rich('Call `KFold(shuffle=True)`').runs.some(run=>run.code&&run.text==='KFold(shuffle=True)'));
 console.log('PASS inline code: one token, joined in export');}
{// \underbrace labels leave the formula for a legend line (Fable r19 H, mlq p2).
 const {equationContent,braceLegend}=await import('./lib/ppt-math.mjs'),{sourceComponentParts}=await import('./lib/ppt-density-capacity.mjs');
 const hero=String.raw`r_{i,t+1} = \underbrace{\alpha_i}_{\text{tiny, forecastable}} + \underbrace{\beta_i' f_{t+1}}_{\text{systematic, not forecastable at }t} + \underbrace{\varepsilon_{i,t+1}}_{\text{idiosyncratic noise, dominant}}`;
 assert.equal(braceLegend(hero).tex,String.raw`r_{i,t+1} = \alpha_i + \beta_i' f_{t+1} + \varepsilon_{i,t+1}`);
 assert.deepEqual(braceLegend(String.raw`ROA = \underbrace{\frac{NI}{REV}}_{\text{Net Margin}} \times \overbrace{x}^{y}`).legend,[{expression:String.raw`\frac{NI}{REV}`,label:'Net Margin'},{expression:'x',label:'y'}]);
 const math=equationContent('$$'+hero+'$$');assert.equal(math.mathStatus,'native_math');assert.ok(!/[⏟⏞]/u.test(math.mathMl),'no brace glyph in the formula');assert.equal(math.mathText,'$$'+hero+'$$','the source text is unchanged');
 const parts=sourceComponentParts({id:'hero',type:'EquationBlock',text:'$$'+hero+'$$'});
 assert.equal(parts.length,2);assert.equal(parts[1].ladderFontPt,12);assert.match(parts[1].content.text,/αi — tiny, forecastable; .* — systematic, not forecastable at t; .* — idiosyncratic noise, dominant/u);
 console.log('PASS brace labels: formula without braces, one legend line');}

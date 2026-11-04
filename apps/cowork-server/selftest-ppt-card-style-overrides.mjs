// Fable Q1(b), merge of main 9e0351cd (2026-10-26): the author's font, weight,
// italic and underline reach every point card in both exporters (rebuilt and
// preserved-template PPTX); cards the author did not format keep their defaults.
// Font/line-height capacity is covered by style-capacity; a fully bold card filled to
// ~95% by the measurer must still pass the rendered (LibreOffice) glyph check;
// it does, so no bold width factor is added (2026-10-26).
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {applyRenderContract,measureText,textContract,CARD_PADDING,PT_EMU} from './lib/ppt/render-contract.mjs';
import {_internals as exporter,renderPptx} from './lib/ppt-render.mjs';
import {_internals as nativeExporter} from './lib/ppt/import-pptx.mjs';
import {localPptRuntime,spawnPythonSync} from './test/ppt-local-runtime.mjs';import {slideSvg} from './lib/ppt/exporters/preview.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';import {ensureProjectV3} from './lib/ppt/ir.mjs';
const python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3',root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-card-style-'));
const size={width:12192000,height:6858000},fonts={title:'Arial',body:'Arial',titleEastAsia:'PingFang SC',bodyEastAsia:'PingFang SC'},palette={background:'#ffffff',accent:'#6758c8',foreground:'#111827',muted:'#222222'};
const items=[{id:'a',text:'Signal\nThe first card body in plain words.'},{id:'b',text:'Noise\nThe second card body, also plain.'}];
const pointLayout={fontSizePt:18,boxes:[{x:0,y:0,w:.48,h:1},{x:.52,y:0,w:.48,h:1}]};
const manual={fontSizePt:22.5,lineHeight:1.55,color:'#242a3b',fontFamily:'Georgia',fontWeight:700,fontStyle:'italic',textDecoration:'underline'};
const overrides=['fontFamily','fontWeight','fontStyle','textDecoration','fontSizePt','lineHeight'];
// Every card run of an element: [text, font, bold, italic, underline].
const cardRuns=String.raw`
import sys,json
from pptx import Presentation
p=Presentation(sys.argv[1]);out={}
for s in p.slides[0].shapes:
    if not s.has_text_frame or 'AIMate instance:' not in s.name: continue
    element=s.name.split('AIMate instance:')[1].rsplit(':',1)[0]
    out.setdefault(element,[]).extend([[r.text,r.font.name,r.font.bold,r.font.italic,r.font.underline] for para in s.text_frame.paragraphs for r in para.runs if r.text.strip()])
print(json.dumps(out))`;
const readRuns=file=>{const r=spawnSync(python,['-c',cardRuns,file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
const assertTypography=file=>{const r=spawnSync(python,['-c',String.raw`
import sys,json
from pptx import Presentation
out=[]
for s in Presentation(sys.argv[1]).slides[0].shapes:
 if s.has_text_frame and 'AIMate instance:manual:' in s.name:
  out.extend([[p.line_spacing,[r.font.size.pt for r in p.runs if r.text.strip()]] for p in s.text_frame.paragraphs if p.text.strip()])
print(json.dumps(out))`,file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const values=JSON.parse(r.stdout);assert.ok(values.length);assert.ok(values.every(([line,sizes])=>Math.abs(line-1.55)<.001&&sizes.length&&sizes.every(pt=>pt===22.5)),'every card paragraph and run exports the measured author typography: '+JSON.stringify(values));};
const assertStyled=(runs,label)=>{assert.ok(runs?.length,label+': card runs exported');
 assert.ok(runs.every(([,font,bold,italic,underline])=>font==='Georgia'&&bold===true&&italic===true&&underline===true),label+': every card run carries the author\'s formatting: '+JSON.stringify(runs));};
const assertDefault=(runs,label)=>{assert.ok(runs?.length,label+': card runs exported');
 assert.ok(runs.every(([,font,,italic,underline])=>font!=='Georgia'&&italic!==true&&underline!==true),label+': an unformatted card keeps its defaults: '+JSON.stringify(runs));
 assert.ok(runs.some(([,,bold])=>bold===true)&&runs.some(([,,bold])=>bold!==true),label+': headings stay bold, bodies regular: '+JSON.stringify(runs));};
try{
 // 1. Rebuilt PPTX (ppt-render).
 const element=(id,y,extra)=>applyRenderContract({id,nodeId:id,kind:'list',bounds:{x:60*PT_EMU,y:y*PT_EMU,width:600*PT_EMU,height:120*PT_EMU},zIndex:1,content:{items,pointLayout:{...pointLayout,...(extra?.textStyleOverrides?{fontSizePt:22.5,lineHeight:1.55}:{})}},...extra});
 const rebuilt=path.join(root,'rebuilt.pptx');
 const out=spawnSync(python,['-c',exporter.SCRIPT],{input:JSON.stringify({slides:[{title:'Cards',bullets:[]}],renderTree:{slides:[{id:'s',size,elements:[
  element('manual',40,{style:manual,textStyleOverrides:overrides}),element('plain',220,{style:{...manual}})]}]},fonts,palette}),env:{...process.env,PPT_OUTPUT:rebuilt},maxBuffer:4e6});
 assert.equal(out.status,0,out.stderr.toString());
 const rebuiltRuns=readRuns(rebuilt);assertStyled(rebuiltRuns.manual,'rebuilt');assertDefault(rebuiltRuns.plain,'rebuilt');assertTypography(rebuilt);
 // 2. Preserved-template PPTX (import-pptx native export of a source-owned card list).
 const original=path.join(root,'original.pptx');
 const blank=spawnSync(python,['-c','from pptx import Presentation\nfrom pptx.util import Emu\nimport sys\np=Presentation();p.slide_width=Emu(12192000);p.slide_height=Emu(6858000);p.slides.add_slide(p.slide_layouts[6]);p.save(sys.argv[1])',original],{encoding:'utf8'});
 assert.equal(blank.status,0,blank.stderr);
 const node=(id,y,extra)=>({id,type:'list',geometry:{x:60*PT_EMU,y:y*PT_EMU,width:600*PT_EMU,height:120*PT_EMU},content:{items,pointLayout:{...pointLayout,...(extra?.textStyleOverrides?{fontSizePt:22.5,lineHeight:1.55}:{})}},sourceArtifact:{sourceUnitId:id,type:'ChecklistBlock'},...extra});
 const preserved=path.join(root,'preserved.pptx');
 const nativeOut=spawnPythonSync(python,nativeExporter.EXPORT_SCRIPT,[],{input:JSON.stringify({original,slides:[{nativeSlideIndex:0,nodes:[],sourceArtifacts:[
  node('manual',40,{style:manual,textStyleOverrides:overrides}),node('plain',220,{style:{...manual}})]}],fonts}),env:{...process.env,PPT_SOURCE:original,PPT_OUTPUT:preserved},maxBuffer:4e6});
 assert.equal(nativeOut.status,0,nativeOut.stderr.toString());
 const preservedRuns=readRuns(preserved);assertStyled(preservedRuns.manual,'preserved');assertDefault(preservedRuns.plain,'preserved');assertTypography(preserved);

 // The preview (and the canvas, same rule) shows a card heading in the author's
 // weight; without an override the heading stays bold.
 const previewOf=extra=>slideSvg({size,elements:[{id:'c',nodeId:'c',kind:'list',bounds:{x:0,y:0,width:600*PT_EMU,height:120*PT_EMU},content:{items,pointLayout:{...pointLayout,...(extra?.textStyleOverrides?{fontSizePt:22.5,lineHeight:1.55}:{})}},...extra}]});
 assert.match(previewOf({style:{fontSizePt:18,fontWeight:400},textStyleOverrides:['fontWeight']}),/font-weight:400;margin-bottom:4px/,'a regular-weight override reaches the card heading in the preview');
 assert.match(previewOf({style:{fontSizePt:18,fontWeight:400}}),/font-weight:700;margin-bottom:4px/,'without an override the heading stays bold');

 // 3. Capacity: bold is not re-measured. Fill two cards to ~95% at regular
 // weight, make them fully bold, and export through the production renderer,
 // whose LibreOffice check fails a glyph outside its card.
 const I=914400,font=16,width=I*11,[,padTop,,padBottom]=CARD_PADDING;
 // Fill is measured in whole lines, so the card height is sized to the text:
 // a fixed body whose measured height is \`target\` of the card's inner height.
 const body='Momentum signals decay when crowded trades unwind and liquidity providers widen their quotes across venues, and the measured lines of this card stay fixed while its height is sized to the target fill.';
 const measure=height=>{const box={width:width*.48,height};const e={kind:'text',bounds:box,style:{fontSizePt:font,lineHeight:1.18,paragraphSpacingEm:0},content:{text:body}};return measureText(e,textContract(e,CARD_PADDING)).estimatedHeightPt;};
 const textPt=measure(I*7);
 const exportBold=async(target,label)=>{
  const height=Math.ceil((textPt/target+padTop+padBottom)*PT_EMU),frame={x:I*.6,y:I*1.4,width,height};
  const fill=measure(height)/(height/PT_EMU-padTop-padBottom);
  const p=ensureProjectV3({id:'bold-'+label,uid:'bold',template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),pages:1,outline:[{id:'one',title:'Bold cards'}],deck:{slides:[{id:'one',title:'Bold cards',layoutId:'summary',nodes:[
   {id:'cards',type:'list',slotId:'absolute',geometry:frame,style:{fontSizePt:font,color:'#242a3b',fontWeight:700},textStyleOverrides:['fontWeight'],
    content:{pointLayout:{fontSizePt:font,boxes:[{x:0,y:0,w:.48,h:1},{x:.52,y:0,w:.48,h:1}]},items:[{id:'p1',text:body},{id:'p2',text:body}]},sourceArtifact:{sourceUnitId:'cards',type:'ChecklistBlock'}}]}]}});
  p.deck.slides.forEach(s=>s.nodeOrder=s.nodes.map(n=>n.id));delete p.renderTree;
  return {fill,result:await renderPptx(p,localPptRuntime(path.join(root,label),python).io).then(r=>({ok:r.exportVerification?.status==='passed',path:r.path,pageFlags:r.exportVerification?.pageFlags||[]}),error=>({ok:false,error:String(error.message).slice(-400)}))};
 };
 fs.mkdirSync(path.join(root,'fit'));fs.mkdirSync(path.join(root,'over'));
 const fit=await exportBold(.95,'fit');
 assert.ok(fit.fill>.94&&fit.fill<=.95,'the bold fixture fills its card to ~95%: '+fit.fill);
 assert.ok(fit.result.ok,'a fully bold card at '+fit.fill.toFixed(3)+' fill passes the rendered glyph check: '+(fit.result.error||''));
 {const runs=readRuns(fit.result.path).cards;assert.ok(runs?.length&&runs.every(run=>run[2]===true),'every exported card run is bold');}
 // Control: the same check does see card text, so a card well past its frame fails.
 // Measured 1.3 still renders inside the card in bold (the measurer keeps >30%
 // slack); 1.6 is past the real edge.
 const over=await exportBold(1.6,'over');
 // User decision 2026-10-31 (D2): the overflow flags its page instead of failing the export.
 assert.ok(over.result.ok&&over.result.pageFlags.some(flag=>flag.page===1&&/loses or overflows rendered instance cards:/u.test(flag.message)),'a card filled to '+over.fill.toFixed(3)+' is flagged by the rendered glyph check: '+JSON.stringify(over.result));assert.deepEqual(fit.result.pageFlags,[],'the card that fits is not flagged');
 
 console.log(`PASS card style overrides: font, bold, italic and underline reach every card in rebuilt and preserved PPTX; a fully bold card at ${(fit.fill*100).toFixed(1)}% fill passes the rendered glyph check (control at ${(over.fill*100).toFixed(0)}% is flagged on its page)`);
}finally{fs.rmSync(root,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { localPptRuntime } from './test/ppt-local-runtime.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-editor-template-'));
process.env.COWORK_STATE_DIR=root;
const { importEditablePptx } = await import('./lib/ppt/import-pptx.mjs');
const { prepareTemplateFidelity, bindTemplateFidelity, renderTemplatePptx, rescheduleTemplateFidelity, inspectTemplateFidelity, templateSlotPrompt } = await import('./lib/ppt-template-fidelity.mjs');
const { normalizePaste } = await import('./lib/ppt-source.mjs');
const { ensureProjectV3 } = await import('./lib/ppt/ir.mjs');
const { applyCommand, undo, redo } = await import('./lib/ppt/command-service.mjs');
const { saveProject, getProject } = await import('./lib/ppt/repository.mjs');
const { buildRenderTree } = await import('./lib/ppt/render-tree.mjs');
const { slideSvg } = await import('./lib/ppt/exporters/preview.mjs');
const { markLanguagePairs } = await import('./lib/ppt-presentation-policy.mjs');
const { sourceDensityPlan } = await import('./lib/ppt-density-packing.mjs');
const { migrateProject } = await import('./lib/ppt/migrations.mjs');
const { dominantInputLanguage } = await import('./lib/ppt-topic-language.mjs');
const python=process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const runtime=localPptRuntime(root,python);
const fixture=path.join(root,'old-report.pptx');
const run=(script,args=[])=>{const r=spawnSync(python,['-c',script,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
 run(String.raw`
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
import sys,io,base64
p=Presentation();p.slide_width=Inches(13.333);p.slide_height=Inches(7.5)
logo=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVKHmEEYCvluBm4PGgNZZ19N8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPr/wBoUlll4sAAAAASUVORK5CYII=')
for i in range(4):
 s=p.slides.add_slide(p.slide_layouts[6])
 for text,x,y,w,h,size in [('OLD_REPORT_2021',.8,.3,11,.6,30),('35',.8,1.1,2,.6,20),('OLD_CLIENT_49M',.8,2,11,1.2,16)]:
  box=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h));box.text=text
  for para in box.text_frame.paragraphs:
   for r in para.runs:r.font.size=Pt(size);r.font.name='Arial'
 table=s.shapes.add_table(2,2,Inches(.8),Inches(4),Inches(5),Inches(1)).table
 table.cell(0,0).text='OLD_REVENUE';table.cell(1,1).text='OLD_99000'
 data=CategoryChartData();data.categories=['OLD_CHART_A','OLD_CHART_B'];data.add_series('OLD_DATA', [91,29])
 s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,Inches(6.3),Inches(4),Inches(5),Inches(2),data)
 pic=s.shapes.add_picture(io.BytesIO(logo),Inches(11.5),Inches(.15),width=Inches(.6));pic.name='Brand logo'
 s.notes_slide.notes_text_frame.text='OLD_NOTES_SECRET'
p.save(sys.argv[1])
`,[fixture]);
 const bytes=fs.readFileSync(fixture),originalHash=hash(bytes);
 let project=ensureProjectV3({uid:'editor-test',id:'a'.repeat(32),title:'Current source',prompt:'',pages:4,revision:1,publishedRevision:0,status:'paused',templateMode:'preserve',templateContentMode:'design_only',templateSpec:{fonts:{title:'Arial',body:'Arial',titleEastAsia:'Arial',bodyEastAsia:'Arial'}},
  source:normalizePaste('# New mechanism\n24 current records are validated before release.\n当前记录在发布前进行核验。'),outline:Array.from({length:4},(_,i)=>({id:`page_${i}`,title:`New topic ${i}`,section:'New section'})),deck:{slides:Array.from({length:4},(_,i)=>({id:`page_${i}`,title:`New topic ${i}`,section:'New section',nodes:[]}))}});
 project.templateFidelity=await prepareTemplateFidelity(project,bytes,originalHash,null,{writeFile:runtime.writeFile,importPptx:(p,b,h)=>importEditablePptx(p,b,h,runtime.io)});
 project.deck.slides.forEach((slide,i)=>{slide.templateSlotTexts=Object.fromEntries(project.templateFidelity.slides[i].slots.filter(slot=>slot.role!=='static').map(slot=>[String(slot.shapeId),slot.example==='35' ? '24' : `Current source explanation ${i} ${slot.shapeId}`]));});
 // Design-only clears unselected report images, including previously inferred brands.
 assert.ok(project.templateFidelity.slides.every(s=>s.nodes.filter(n=>n.type==='image').every(n=>n.content.templateSample&&!n.content.mustPreserve)));
 const fixedLogos=project.templateFidelity.slides.flatMap(s=>s.nodes).filter(n=>n.type==='image'&&n.nativeRef.name==='Brand logo').map(n=>n.id);assert.equal(fixedLogos.length,4);
 project.templateContentMode='keep_fixed';project.templateFixedObjectIds=fixedLogos;
 project.templateFidelity=await prepareTemplateFidelity(project,bytes,originalHash,null,{writeFile:runtime.writeFile,importPptx:(p,b,h)=>importEditablePptx(p,b,h,runtime.io)});
 const repeated=structuredClone(project);repeated.pages=8;repeated.outline=Array.from({length:8},(_,i)=>({...structuredClone(project.outline[i%4]),id:'repeat-'+i,title:'Repeat topic '+i}));repeated.deck.slides=repeated.outline.map(slide=>({...slide,nodes:[]}));
 repeated.templateFidelity=await prepareTemplateFidelity(repeated,bytes,originalHash,null,{writeFile:runtime.writeFile,importPptx:(p,b,h)=>importEditablePptx(p,b,h,runtime.io)});
 assert.ok(repeated.templateFidelity.slideMap.some((source,index,map)=>map.indexOf(source)!==index));
 for(const mapped of repeated.templateFidelity.slides)for(const node of mapped.nodes.filter(n=>n.content?.mustPreserve)){
  const original=repeated.templateFidelity.sourceCatalog[mapped.sourceIndex].nodes.find(n=>n.nativeRef.shapeId===node.nativeRef.shapeId);assert.deepEqual(node.geometry,original.geometry,'selected fixed geometry is never mirrored by automatic reuse');assert.deepEqual(node.content.crop,original.content.crop,'selected fixed logo is never cropped by a reuse variant');
 }
 repeated.deck.slides.forEach((slide,index)=>{slide.templateSlotTexts=Object.fromEntries(repeated.templateFidelity.slides[index].slots.filter(slot=>slot.role!=='static').map(slot=>[String(slot.shapeId),slot.role==='title'?slide.title:slot.role==='section'?'Current scope':slot.capacity<25?'New':'The current source describes approved scope and required review.']));});
 bindTemplateFidelity(repeated);
 const repeatedVariantIssues=inspectTemplateFidelity(repeated).filter(issue=>['template_variant_unchanged','template_variant_duplicate','template_variant_media'].includes(issue.code));
 if(repeatedVariantIssues.length)console.error(JSON.stringify(repeated.deck.slides.map((slide,index)=>({index,source:repeated.templateFidelity.slides[index].sourceIndex,variant:repeated.templateFidelity.slides[index].variant,protected:slide.nodes.filter(node=>node.content?.mustPreserve).map(node=>{const base=repeated.templateFidelity.sourceCatalog[repeated.templateFidelity.slides[index].sourceIndex].nodes.find(base=>base.nativeRef.shapeId===node.nativeRef.shapeId);return {id:node.id,baseId:base?.id,selected:repeated.templateFixedObjectIds.includes(base?.id),geometry:node.geometry,baseGeometry:base?.geometry,crop:node.content.crop,baseCrop:base?.content.crop};})})),null,2));
 assert.ok(!inspectTemplateFidelity(repeated).some(issue=>['template_variant_unchanged','template_variant_duplicate','template_variant_media'].includes(issue.code)),'honest fixed-layout reuse does not require moving or cropping protected brand objects: '+JSON.stringify(inspectTemplateFidelity(repeated).filter(issue=>['template_variant_unchanged','template_variant_duplicate','template_variant_media'].includes(issue.code))));
 const repeatedExport=await renderTemplatePptx(repeated,runtime.io);assert.ok(repeatedExport.bytes>0,'actual eight-page editable native export preserves repeated fixed logos');
 const smaller=structuredClone(project);smaller.pages=3;smaller.outline=smaller.outline.slice(0,3);smaller.deck.slides=smaller.deck.slides.slice(0,3);
 const middleLogo=smaller.templateFidelity.sourceCatalog[2].nodes.find(n=>n.type==='image'&&n.nativeRef.name==='Brand logo');assert.ok(middleLogo);
 smaller.templateFixedObjectIds=[middleLogo.id];rescheduleTemplateFidelity(smaller,{scoreSlide:()=>0});assert.ok(smaller.templateFidelity.slideMap.includes(2),'a selected fixed object constrains native assignment before confirmation even when N < original pages');
 const impossible=structuredClone(smaller);impossible.templateFixedObjectIds=project.templateFidelity.sourceCatalog.flatMap(s=>s.nodes.filter(n=>n.type==='image'&&n.nativeRef.name==='Brand logo').map(n=>n.id));
 assert.throws(()=>rescheduleTemplateFidelity(impossible,{scoreSlide:()=>0}),/selected fixed objects.*Increase the page budget/,'four distinct selected source layouts cannot silently disappear inside a three-page budget');
 bindTemplateFidelity(project);
 assert.ok(project.deck.slides.every(slide=>slide.templateOmissions.length===2),'old chart and table receive a recorded disposition: '+JSON.stringify(project.deck.slides.map(s=>({omissions:s.templateOmissions,nodes:s.nodes.map(n=>({id:n.id,type:n.type,role:n.content?.mediaRole,name:n.nativeRef?.name}))}))));
 assert.ok(project.deck.slides.every(slide=>!slide.nodes.some(node=>['chart','table'].includes(node.type))));
 assert.ok(project.deck.slides.every(slide=>slide.nodes.some(node=>node.content?.mediaRole==='brand')),'brand retained');
 assert.ok(!templateSlotPrompt(project,0).includes('OLD_CLIENT_49M'),'sample copy cannot enter the writer prompt');
 assert.ok(!project.deck.slides.flatMap(s=>s.nodes).some(n=>n.content?.text==='35'),'standalone sample number is not an ordinal');
 for(const slide of project.deck.slides)for(const node of slide.nodes.filter(node=>node.nativeRef&&node.type==='text'))node.style.eastAsiaFontFamily='Arial';
 project.nodes=Object.fromEntries(project.deck.slides.map((slide,i)=>[slide.id,{status:i===3?'pending':'done',slide:structuredClone(slide)}]));
 project.renderTree=buildRenderTree(project);saveProject(project);
 const legacy=structuredClone(project);legacy.renderTree.renderContractVersion=2;
 const oldTitle=legacy.deck.slides[0].nodes.find(node=>node.nativeRef&&node.semanticRole==='template-title');oldTitle.geometry.height=120000;
 const updated=migrateProject(legacy);assert.equal(updated.changed,true);assert.equal(updated.project.renderTree.renderContractVersion,(await import("./lib/ppt/render-contract.mjs")).RENDER_CONTRACT_VERSION);
 assert.ok(updated.project.renderTree.slides[0].elements.find(element=>element.id===oldTitle.id).bounds.height>120000,'old cached frames receive refreshed preview geometry');
 const uid=project.uid,id=project.id,slide=project.deck.slides[1],text=slide.nodes.filter(node=>node.nativeRef&&node.type==='text'&&!node.locked);
 const command=async(type,payload)=>{const p=getProject(uid,id);return (await applyCommand(uid,id,{type,baseRevision:p.revision,payload})).project;};
 // Choosing the same outer size/weight still means overriding mixed native runs.
 project=await command('node.setStyle',{slideId:slide.id,nodeId:text[0].id,style:{fontWeight:text[0].style.fontWeight || 400},merge:true});
 assert.ok(project.deck.slides[1].nodes.find(node=>node.id===text[0].id).textStyleOverrides.includes('fontWeight'));
 project=(await undo(uid,id)).project;
 const brand=slide.nodes.find(node=>node.content?.mediaRole==='brand');
 const beforeAtomic=getProject(uid,id);
 await assert.rejects(()=>command('nodes.setStyle',{slideId:slide.id,changes:[{nodeId:text[0].id,style:{fontSizePt:48}},{nodeId:brand.id,style:{fontSizePt:48}}]}),/native text and shapes|locked/);
 assert.equal(getProject(uid,id).revision,beforeAtomic.revision);assert.deepEqual(getProject(uid,id).deck.slides[1].nodes.find(node=>node.id===text[0].id).style,text[0].style,'failed batch cannot partly change the first text');
 project=await command('nodes.setStyle',{slideId:slide.id,changes:text.slice(0,2).map(node=>({nodeId:node.id,style:{...node.style,fontFamily:'Georgia',fontSizePt:24,fontWeight:700,fontStyle:'italic',textDecoration:'underline',lineHeight:1.4,textAlign:'center'}}))});
 const styled=project.deck.slides[1].nodes.find(n=>n.id===text[0].id);
 assert.equal(styled.style.fontSizePt,24);assert.equal(styled.userStyle,true);
 const rendered=project.renderTree.slides[1].elements.find(e=>e.id===styled.id);
 assert.ok(rendered.textLayout.paragraphs.every(p=>p.lineHeight===1.4));
 assert.ok(rendered.textLayout.paragraphs.flatMap(p=>p.runs||[]).every(r=>r.fontSizePt===24&&r.bold));
 assert.match(slideSvg(project.renderTree.slides[1]),/text-decoration:underline/);
 project=(await undo(uid,id)).project;assert.notEqual(project.deck.slides[1].nodes.find(n=>n.id===text[0].id).style.fontSizePt,24);
 project=(await redo(uid,id)).project;assert.equal(project.deck.slides[1].nodes.find(n=>n.id===text[0].id).style.fontSizePt,24);
 assert.ok(project.deck.slides[1].nodes.find(n=>n.id===text[0].id).textStyleOverrides.includes('textDecoration'),'a redone underline keeps its override');
 // A colour change undone and redone: the schema accepts the overrides the service records.
 project=await command('node.setStyle',{slideId:slide.id,nodeId:text[1].id,style:{color:'#123456'},merge:true});
 project=(await undo(uid,id)).project;project=(await redo(uid,id)).project;
 assert.equal(project.deck.slides[1].nodes.find(n=>n.id===text[1].id).style.color,'#123456');assert.ok(project.deck.slides[1].nodes.find(n=>n.id===text[1].id).textStyleOverrides.includes('color'));
 project=await command('nodes.setGeometry',{slideId:slide.id,changes:[{nodeId:text[0].id,geometry:{...styled.geometry,x:1000000}}]});
 project=await command('node.setContent',{slideId:slide.id,nodeId:text[0].id,content:{text:'Manually preserved current heading'}});
 bindTemplateFidelity(project);
 const rebound=project.deck.slides[1].nodes.find(n=>n.id===text[0].id);
 assert.equal(rebound.style.fontSizePt,24);assert.equal(rebound.geometry.x,1000000);assert.equal(rebound.content.text,'Manually preserved current heading','resume/rebinding keeps manual edits');
 assert.equal(getProject(uid,id).nodes.page_3.status,'pending','editing finished pages never completes a future page');
 const pending=project.deck.slides[3].nodes.find(n=>n.nativeRef&&n.type==='text');
 await assert.rejects(()=>command('node.setStyle',{slideId:'page_3',nodeId:pending.id,style:{fontSizePt:24}}),/finish before editing/);
 project.status='completed';saveProject(project);
 project=await command('node.setStyle',{slideId:slide.id,nodeId:text[0].id,style:rebound.style});
 let output;try {output=await renderTemplatePptx(project,runtime.io);}catch(error){const failed=new Set(error.message.match(/node_[a-z0-9]+/g)||[]);console.error(JSON.stringify(project.renderTree.slides.flatMap(slide=>slide.elements).filter(element=>failed.has(element.id)),null,2));throw error;}
 assert.ok(output.bytes>0);
 const audit=JSON.parse(run(String.raw`
from zipfile import ZipFile
from lxml import etree as E
import sys,json
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
with ZipFile(sys.argv[1]) as z:
 visible=' '.join(z.read(n).decode(errors='ignore') for n in z.namelist() if n.startswith(('ppt/slides/','ppt/notesSlides/','ppt/charts/')) and n.endswith('.xml'))
 assert 'OLD_' not in visible,visible[:400]
 xml=E.fromstring(z.read('ppt/slides/slide2.xml'));runs=xml.xpath('//a:r[a:t="Manually preserved current heading"]/a:rPr',namespaces=ns)
 assert runs and all(r.find('a:latin',ns).get('typeface')=='Georgia' for r in runs),[E.tostring(r).decode() for r in runs]
 assert runs and all(r.get('sz')=='2400' and r.get('i')=='1' and r.get('u')=='sng' and r.get('b')=='1' for r in runs)
 print(json.dumps({'oldContentAbsent':True,'fontRunsVerified':len(runs),'notesAbsent':not any(n.startswith('ppt/notesSlides/notesSlide') and n.endswith('.xml') for n in z.namelist())}))
`,[runtime.host(project,'/workspace/presentation.pptx')]));
 assert.equal(audit.oldContentAbsent,true);assert.equal(audit.notesAbsent,true);assert.equal(hash(fs.readFileSync(fixture)),originalHash);
 const evidenceDirectory=process.env.PPT_TEST_OUTPUT;
 if(evidenceDirectory) {
   fs.mkdirSync(evidenceDirectory,{recursive:true});
   fs.copyFileSync(runtime.host(project,'/workspace/presentation.pptx'),path.join(evidenceDirectory,'native-edited-template.pptx'));
   fs.writeFileSync(path.join(evidenceDirectory,'native-edited-template.json'),JSON.stringify({...audit,originalTemplateUnchanged:true,
     pendingPageRemainsPending:true,manualHeading:rebound.content.text,manualFont:rebound.style.fontFamily,fontSizePt:rebound.style.fontSizePt,
     previewGeometry:project.renderTree.slides[1].elements.find(element=>element.id===rebound.id).bounds},null,2));
 }
 const unrelated=markLanguagePairs([{id:'a',type:'MechanismBlock',sectionPath:['Data'],text:'Release approvals are stored in an audit log for traceability.'},{id:'b',type:'MechanismBlock',sectionPath:['Data'],text:'天气变化影响仓库湿度和物料储存条件，应该记录每日观察结果。'}]);
 assert.ok(unrelated.every(item=>!item.languagePairId));
 const source=normalizePaste('# Shared mechanism\n\nA 50 bps cost threshold limits alpha turnover.\n\n50 bps 成本阈值限制 alpha 换手。');
 const density=sourceDensityPlan(source,{});assert.equal(density.languagePairs,1);assert.ok(density.groups.some(group=>group.sourceUnitIds.length===2));
 assert.equal(dominantInputLanguage({source:{text:'An English explanation about mechanisms and operating conditions. '.repeat(10)+'中文注释'}}),'en');
 console.log('PPT editor: paused/completed styles, native runs, batch atomicity, undo/redo/rebinding; design-only template/numeric/table/chart/notes/brand/export; multilingual grouping: OK');
} finally {fs.rmSync(root,{recursive:true,force:true});}

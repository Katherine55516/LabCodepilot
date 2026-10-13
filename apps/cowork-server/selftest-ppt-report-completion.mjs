import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {nativeComponentSpecs} from './lib/ppt-native-components.mjs';
import {variableNativeCardFit} from './lib/ppt-media-preserving-layout.mjs';
import {fitComponents} from './lib/ppt-density-capacity.mjs';
import {componentLeaseToken,commitSourceComponents} from './lib/ppt/component-commit.mjs';
import {sourceSpanRepairCandidate} from './lib/ppt-source-span-repair.mjs';
import {normalizePaste} from './lib/ppt-source.mjs';
import {richTextContent} from './lib/ppt-source-text.mjs';
import {codeOperationScopes,claimSemanticsChecklist} from './lib/ppt-claim-semantics.mjs';
import {acceptExportVerification,exportManifest} from './lib/ppt-export-integrity.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {bindTemplateFidelity,fidelityFromImported,inspectTemplateFidelity} from './lib/ppt-template-fidelity.mjs';
import {importEditablePptx,renderImportedPptx} from './lib/ppt/import-pptx.mjs';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
const E=914400,geometry=(x,y,w,h)=>({x:x*E,y:y*E,width:w*E,height:h*E}),text=t=>({type:'text',content:richTextContent(t)});
const root=process.env.PPT_REPORT_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ppt-report-')),python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';fs.mkdirSync(root,{recursive:true});
const fixture=root+'/components.pptx';
const built=spawnSync(python,['-c',`from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from PIL import Image,ImageDraw
import sys,io
p=Presentation();p.slide_width=Inches(13.333);p.slide_height=Inches(7.5)
s=p.slides.add_slide(p.slide_layouts[6]);s.shapes.add_textbox(Inches(.7),Inches(1),Inches(11),Inches(.6)).text='Native components'
s=p.slides.add_slide(p.slide_layouts[6]);t=s.shapes.add_textbox(Inches(.7),Inches(.7),Inches(11),Inches(.7));t.text='Whole component layout';t.text_frame.paragraphs[0].runs[0].font.size=Pt(32)
img=Image.new('RGBA',(80,80),(0,0,0,0));ImageDraw.Draw(img).line((20,40,60,40),fill='white',width=6);b=io.BytesIO();img.save(b,format='PNG')
for x,y in [(.7,2),(6.9,2),(.7,4.3),(6.9,4.3)]:
 q=s.shapes.add_shape(MSO_SHAPE.OVAL,Inches(x),Inches(y),Inches(.7),Inches(.7));q.fill.solid();q.fill.fore_color.rgb=RGBColor.from_string('1E2A44')
 s.shapes.add_picture(io.BytesIO(b.getvalue()),Inches(x+.1),Inches(y+.1),width=Inches(.5),height=Inches(.5))
 q=s.shapes.add_textbox(Inches(x+1),Inches(y),Inches(4.4),Inches(1.4));q.text='Original point description remains editable';q.text_frame.paragraphs[0].runs[0].font.size=Pt(16)
s=p.slides.add_slide(p.slide_layouts[6]);t=s.shapes.add_textbox(Inches(.7),Inches(.7),Inches(11),Inches(.7));t.text='Native color panels';t.text_frame.paragraphs[0].runs[0].font.size=Pt(32)
for (x,y),color in zip([(.7,2),(6.9,2),(.7,4.3),(6.9,4.3)],['0D6A58','1E3563','7E4024','5D316A']):
 im=Image.new('RGB',(260,70),'#'+color);b=io.BytesIO();im.save(b,format='PNG');s.shapes.add_picture(io.BytesIO(b.getvalue()),Inches(x),Inches(y),width=Inches(5.2),height=Inches(1.4))
 q=s.shapes.add_textbox(Inches(x+.15),Inches(y+.15),Inches(4.8),Inches(1));q.text='Original panel description remains editable';q.text_frame.paragraphs[0].runs[0].font.size=Pt(16)
b=io.BytesIO();img.save(b,format='PNG')
s=p.slides.add_slide(p.slide_layouts[6]);t=s.shapes.add_textbox(Inches(.7),Inches(.7),Inches(11),Inches(.7));t.text='Native role cards';t.text_frame.paragraphs[0].runs[0].font.size=Pt(32)
for x,y in [(.7,2),(6.9,2),(.7,4.3),(6.9,4.3)]:
 q=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(y),Inches(5.2),Inches(2));q.fill.solid();q.fill.fore_color.rgb=RGBColor.from_string('1E2A44')
 q=s.shapes.add_shape(MSO_SHAPE.OVAL,Inches(x+.15),Inches(y+.15),Inches(.6),Inches(.6));q.fill.solid();q.fill.fore_color.rgb=RGBColor.from_string('6F7680')
 s.shapes.add_picture(io.BytesIO(b.getvalue()),Inches(x+.25),Inches(y+.25),width=Inches(.4),height=Inches(.4))
 q=s.shapes.add_textbox(Inches(x+1),Inches(y+.15),Inches(4),Inches(1.5));q.text='Original role description';q.text_frame.paragraphs[0].runs[0].font.size=Pt(16)
p.save(sys.argv[1])`,fixture],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
const io=localPptRuntime(root,python),p=await importEditablePptx({id:'components',uid:'test',title:'Whole components',pages:2,revision:3},fs.readFileSync(fixture),'fixture',io.io);
p.templateSpec=snapshotTemplate(BUILT_INS.find(x=>x.id==='light'));p.templateFidelity=fidelityFromImported(p,p,'fixture');p.outline=p.deck.slides.map(s=>({id:s.id,title:s.title,sourceUnitIds:[],refs:[]}));p.planning={slidePlan:p.outline.map(s=>({slideId:s.id,sourceArtifacts:[]}))};
const specs=nativeComponentSpecs(p.templateFidelity.slides[1],p.templateFidelity);assert.equal(specs.length,4);assert.ok(specs.every(s=>s.nativeMembers.some(m=>m.type==='shape')),'carrier stays part of each white icon');
const cases=[];
for(const count of [1,2,3,4,6,8]){
 const components=Array.from({length:count},(_,i)=>text(`Point ${i+1}: preserve the stated limitation.`));const base=fitComponents(components,p,1),fit=variableNativeCardFit(p,1,components,base);
 assert.ok(fit?.capacity_ok,'measured count '+count);assert.equal(new Set(fit.componentInstances.map(n=>n.templateComponentBinding.unitIndex)).size,count);
 assert.equal(new Set(fit.componentInstances.map(n=>n.nativeRef.shapeId)).size,fit.componentInstances.length);
 assert.ok(fit.componentInstances.filter(n=>n.type==='image').every(n=>fit.componentInstances.some(c=>c.type==='shape'&&c.templateComponentBinding.unitIndex===n.templateComponentBinding.unitIndex)));
 cases.push({count,columns:fit.columns,instances:fit.componentInstances.length,font:fit.fontSizePt});
}
const matrix=[];
for(const locale of ['en','zh','zh-HK'])for(const scale of [.5,1,2])for(const count of [1,2,3,4,6,8]){
 const phrase=locale==='en'?'Preserve the measured condition and its limitation.':locale==='zh'?'保留实测条件、适用范围和样本限制。':'保留實測條件、適用範圍及樣本限制。';
 const body=scale===.5?(locale==='en'?'Measured condition remains.':locale==='zh'?'实测条件保持。':'實測條件保持。'):phrase.repeat(scale);
 const components=Array.from({length:count},(_,i)=>text(`${i+1}. ${body}`)),base=fitComponents(components,p,1),fit=variableNativeCardFit(p,1,components,base);
 if(fit?.capacity_ok){assert.equal(new Set(fit.componentInstances.map(n=>n.templateComponentBinding.unitIndex)).size,count);assert.equal(fit.fontSizePt,base.fontSizePt,'card adaptation never shrinks the source font');assert.equal(new Set(fit.componentInstances.map(n=>n.nativeRef.shapeId)).size,fit.componentInstances.length);assert.ok(fit.boxes.every(b=>b.x>=0&&b.y>=0&&b.x+b.width<=p.templateFidelity.width&&b.y+b.height<=p.templateFidelity.height));}
 matrix.push({locale,scale,count,status:fit?.capacity_ok?'fits':'blocked_no_variant',font:base.fontSizePt,characters:body.length});
}
assert.equal(matrix.length,54);
const source=normalizePaste('# Contract\n\nThe source preserves a stated condition.\n\nFormula $\\alpha_i^2$ remains exact.'),item=source.semantic.inventory.items.find(i=>i.type!=='EquationBlock'&&i.text.includes('condition'));
item.must_preserve_structure=true;
const live={...structuredClone(p),status:'generating',currentRunId:'run',source,nodes:{},runtime:{slides:{}},editing:{epochs:{}}};const sid=live.outline[1].id;live.nodes[sid]={status:'running'};live.planning.slidePlan[1].sourceArtifacts=[{sourceUnitId:item.id}];
const envelope={slideId:sid,runId:'run',epoch:0,baseRevision:3,sourceHash:source.sha256,lease:'owned',refs:[{sourceUnitId:item.id}]};
assert.equal(commitSourceComponents({...live,revision:4},envelope,{leaseToken:()=> 'owned'}).reason,'user_revision_or_epoch_changed');
assert.equal(commitSourceComponents({...live,status:'cancelled'},envelope,{leaseToken:()=> 'owned'}).status,'rejected');
assert.equal(commitSourceComponents(live,envelope,{leaseToken:()=> 'other'}).status,'rejected');
const sealed=commitSourceComponents(live,envelope,{leaseToken:()=> 'owned'});assert.equal(sealed.status,'committed',sealed.reason);assert.equal(live.runtime.slides[sid].phase,'writing');
const first=structuredClone(live.runtime.slides[sid].componentCommit);assert.equal(commitSourceComponents(live,envelope,{leaseToken:()=> 'owned'}).status,'unchanged');assert.deepEqual(live.runtime.slides[sid].componentCommit,first);
const raw='Formula \\alpha_i^2 remains exact.',node={id:'span',type:'text',sourceArtifact:{sourceUnitId:'formula'},geometry:geometry(.5,.5,8,2),style:{fontSizePt:16},content:richTextContent(raw)};
const sp={revision:2,source:{sha256:'source',semantic:{inventory:{items:[{id:'formula',text:raw}]}}},deck:{slides:[{id:'s',nodes:[node]}]}},start=raw.indexOf('\\alpha'),patch={slideId:'s',nodeId:'span',sourceUnitId:'formula',baseRevision:2,sourceHash:'source',start,end:start+10,expectedRaw:'\\alpha_i^2',replacement:'$\\alpha_i^2$'};
assert.equal(sourceSpanRepairCandidate(sp,patch).status,'validated');assert.equal(sourceSpanRepairCandidate(sp,{...patch,replacement:'$\\beta_i^2$'}).status,'candidate_only');assert.equal(sourceSpanRepairCandidate(sp,{...patch,baseRevision:1}).status,'candidate_only');
const ast=codeOperationScopes('x = df["x"].rank(pct=True)',python);assert.equal(ast.status,'parsed');assert.equal(ast.calls[0].receiver,"df['x']");assert.ok(!ast.calls.some(c=>c.operation==='groupby'));
bindSourceArtifacts(p,p.deck.slides[1],[],1,Array.from({length:6},(_,i)=>({type:'definition',text:`Point ${i+1}: preserve the stated condition.`})).slice(0,4));
// Six independent semantic units in <=4 typed entries, separated by paragraphs.
bindSourceArtifacts(p,p.deck.slides[1],[],1,[{type:'definition',text:Array.from({length:6},(_,i)=>`Point ${i+1}: preserve the stated condition.`).join('\n\n')}]);
bindTemplateFidelity(p);assert.equal(p.deck.slides[1].templateComponentClones.filter(n=>n.type==='image').length,2);
p.source={text:'Rich source context. '.repeat(500)};
const panels=nativeComponentSpecs(p.templateFidelity.slides[2],p.templateFidelity);assert.equal(panels.length,4);assert.ok(panels.every(x=>x.family==='card-panel'&&x.panelColor));bindSourceArtifacts(p,p.deck.slides[2],[],2,[{type:'definition',text:Array.from({length:6},(_,i)=>`Panel ${i+1}: preserve its original condition.`).join('\n\n')}]);assert.ok(p.deck.slides[2].sourceArtifactFit.panelFamily);assert.equal(p.deck.slides[2].templateComponentClones.filter(n=>n.type==='image').length,2);assert.ok(p.deck.slides[2].sourceArtifactNodes.every(n=>n.style.fill!=='#ffffff'&&n.style.color==='#ffffff'));
const roleItems=[{id:'lead-en',type:'TextBlock',text:'Shared ownership is divided into the following roles.',languagePairId:'lead',must_preserve_structure:true},{id:'lead-zh',type:'TextBlock',text:'共享工作按以下角色分配。',languagePairId:'lead',must_preserve_structure:true},{id:'roles',type:'WarningBlock',text:Array.from({length:6},(_,i)=>`- Role ${i+1}: preserve its original responsibility.`).join('\n'),must_preserve_structure:true},{id:'tail-en',type:'TextBlock',text:'Every accepted object retains its provenance.',languagePairId:'tail',must_preserve_structure:true},{id:'tail-zh',type:'TextBlock',text:'所有接受的对象均保留其来源。',languagePairId:'tail',must_preserve_structure:true}];p.source={text:'Rich source context. '.repeat(500),semantic:{inventory:{items:roleItems}}};p.outline[3].sourceUnitIds=roleItems.map(i=>i.id);p.planning.slidePlan[3].sourceArtifacts=roleItems.map(i=>({sourceUnitId:i.id}));bindSourceArtifacts(p,p.deck.slides[3],roleItems.map(i=>({sourceUnitId:i.id})),3);assert.equal(p.deck.slides[3].sourceArtifactFit.semanticPointCount,6);assert.equal(p.deck.slides[3].sourceArtifactFit.proseBandCount,2);assert.equal(p.deck.slides[3].templateComponentClones.filter(n=>n.type==='image').length,2);assert.ok(p.deck.slides[3].sourceArtifactNodes.filter(n=>n.sourceArtifact?.sourceUnitId==='roles').every(n=>n.style.color==='#ffffff'));
bindTemplateFidelity(p);
assert.ok(!inspectTemplateFidelity(p).some(i=>['template_asset_loss','template_component_clone_invalid'].includes(i.code)), 'legal component additions are not missing original template objects');
const exported=await renderImportedPptx(p,io.io);assert.equal(exported.exportVerification.status,'passed');acceptExportVerification(p,exported);assert.equal(p.quality.acceptanceAxes.nativeExport.status,'verified');assert.equal(p.quality.visualVerified,false);
assert.throws(()=>acceptExportVerification({...p,revision:4},exported),/current instance contract/);
fs.copyFileSync(exported.path,root+'/verified-components.pptx');fs.writeFileSync(root+'/report.json',JSON.stringify({cases,matrix,sourceCommits:'passed',staleRevisionEpochLeaseCancel:'passed',sourceSpan:'passed',ast:'passed',nativeExport:exported.exportVerification},null,2));console.log('Report regressions: variable whole components, source commit races, source-bound span repair, AST and real native export passed');

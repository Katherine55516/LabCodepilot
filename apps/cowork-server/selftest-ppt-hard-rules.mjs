import { withSemanticIndex } from './lib/ppt-semantic.mjs';
import { buildPlanning } from './lib/ppt-planning.mjs';
import { importEditablePptx, renderImportedPptx } from './lib/ppt/import-pptx.mjs';
import { BUILT_INS, snapshotTemplate } from './lib/ppt-template.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {renderIssues} from './lib/ppt/render-audit.mjs';
import {slidePlan} from './lib/ppt-planning.mjs';
import {obligationRegistry,visibleEvidenceQuoteId} from './lib/ppt-obligations.mjs';
import {normalizeModelReview,finalQualityReport,deckReviewPrompt,reviewWithContractRepair} from './lib/ppt-quality.mjs';
import {scopeReview,simulatedExport} from './ppt-scope-test-helpers.mjs';
import {assertCandidateScope} from './lib/ppt/input-scope-service.mjs';
import {replaceTemplateSourceRegion} from './lib/ppt-source-artifacts.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {autoTemplateMediaOmissions} from './lib/ppt-template-fidelity.mjs';
import {exportManifest,acceptExportVerification} from './lib/ppt-export-integrity.mjs';
import {EXPORT_VERIFY_SCRIPT} from './lib/ppt/export-verifier-python.mjs';
import {OFFICE_MATH_SCRIPT} from './lib/ppt-math.mjs';
import {renderPptx} from './lib/ppt-render.mjs';import {ensureProjectV3} from './lib/ppt/ir.mjs';import {localPptRuntime} from './test/ppt-local-runtime.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-hard-rules-')),python=process.env.PPT_TEST_PYTHON||'python3';process.env.COWORK_STATE_DIR=root;
const repo=await import('./lib/ppt/repository.mjs'),store=await import('./lib/ppt-store.mjs'),{publishProject}=await import('./lib/ppt/publish-service.mjs');
const negativeFiles=[];
const checks=[],test=async(name,fn)=>{await fn();checks.push(name);},noop=()=>{};
const box={x:1000000,y:2000000,width:3000000,height:1500000},size={width:12192000,height:6858000};
const text=(id,locked=false)=>({id,nodeId:id,kind:'text',bounds:box,style:{fontSizePt:18},content:{text:'Visible mechanism'},locked,zIndex:1});
const tree=elements=>({slides:[{id:'s',size,elements}]});
function fixture(external=false){
 const p=ensureProjectV3({id:store.newId(),uid:'hard-rule-test',prompt:'Explain validation',title:'Validation',template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),pages:3,revision:5,publishedRevision:4,status:'completed',model:'protocol-double',configId:'protocol-double',source:{text:'Validate before release. Unless validation succeeds, do not release.'},outline:[{id:'s0',title:'Validation'},{id:'s1',title:'Mechanism'},{id:'s2',title:'Conditions'}],deck:{slides:[{id:'s0',title:'Validation',layoutId:'cover',bullets:[]},{id:'s1',title:'Mechanism',layoutId:'editorial',bullets:['Validate before release.']},{id:'s2',title:'Conditions',layoutId:'conclusion',bullets:['Validation failure prevents release.']}]}});
 if(external){p.externalPptx={mode:'preserve',...size,slides:[{},{},{}]};p.deck.slides.forEach((s,i)=>{s.nativeSlideIndex=i;s.nodes=[{id:'native-'+i,type:'text',semanticRole:i?'body':'title',nativeRef:{slideIndex:i,shapeId:1},geometry:box,style:{fontSizePt:18},content:{text:s.title}}];});}
 return p;
}
try{
 await test('explicit visible quote references bind exact current text; stale references and conflicting literals still fail',()=>{
  const p=fixture(),raw=scopeReview(p);
  for(const check of raw.obligationAudit.checks)for(const evidence of check.evidence){
    const node=p.deck.slides.find(s=>s.id===evidence.slideId).nodes.find(n=>n.id===evidence.nodeId);
    evidence.quoteId=visibleEvidenceQuoteId(evidence.slideId,node);delete evidence.excerpt;
  }
  const original=structuredClone(raw),valid=normalizeModelReview(raw,p.deck.slides.map(s=>s.id),p);
  assert(valid.obligationAudit.checks.every(check=>check.evidence.every(ref=>typeof ref.excerpt==='string')));assert.deepEqual(raw,original);
  const stale=structuredClone(raw);stale.obligationAudit.checks[0].evidence[0].quoteId='quote-expired';
  assert.throws(()=>normalizeModelReview(stale,p.deck.slides.map(s=>s.id),p),/quote reference/);
  const conflicting=structuredClone(raw);conflicting.obligationAudit.checks[0].evidence[0].excerpt='Invented relation';
  assert.throws(()=>normalizeModelReview(conflicting,p.deck.slides.map(s=>s.id),p),/conflicts/);
  const missing=structuredClone(raw);missing.obligationAudit.checks[0].status='missing';missing.obligationAudit.checks[0].evidence=[];
  assert.equal(finalQualityReport({issues:[],hardErrors:0},[],normalizeModelReview(missing,p.deck.slides.map(s=>s.id),p)).publishEligible,false);
 });
 await test('legal background containment passes; locked collisions and foreground occlusion block',()=>{
  assert(!renderIssues(tree([{id:'bg',nodeId:'bg',kind:'shape',bounds:box,style:{fill:'#eee'},zIndex:0},text('fg')])).some(i=>i.severity==='error'));
  assert(renderIssues(tree([text('one',true),text('two',true)])).some(i=>i.code==='render_overlap'&&i.severity==='error'));
  assert(renderIssues(tree([text('one'),{id:'image',kind:'image',bounds:box,zIndex:5}])).some(i=>i.code==='render_overlap'));
 });
 for(const native of [false,true])await test(`publication ${native?'native':'generic'} keeps errors and prior publication`,async()=>{
  const p=fixture(native),s=p.deck.slides[1],n=s.nodes[0];n.type='text';n.geometry=box;n.content={text:'Validation must succeed.'};n.locked=true;const copy=structuredClone(n);copy.id='colliding';copy.content.text='Failure prevents release.';if(copy.nativeRef)copy.nativeRef.shapeId=2;s.nodes.push(copy);repo.saveProject(p);
  let renders=0;const render=async q=>{renders++;return simulatedExport(q);};const result=await publishProject(p.uid,p.id,{modelCall:async q=>scopeReview(q),renderPptx:render,renderImportedPptx:render},noop,noop);
  assert.equal(result.published,false);assert.equal(renders,0);assert.equal(result.project.publishedRevision,4);assert(result.project.quality.deterministic.issues.some(i=>i.code==='render_overlap'));
 });
 for(const native of [false,true])await test(`required evidence ${native?'native':'generic'} cannot be filtered at publish`,async()=>{
  const p=fixture(native);p.source=withSemanticIndex({kind:'text',text:'At the stated 1k/1k load, GB200 delivers 10,000 TPS/GPU and 50 TPS/user, roughly 4× H200.',segments:[{id:'r1',text:'At the stated 1k/1k load, GB200 delivers 10,000 TPS/GPU and 50 TPS/user, roughly 4× H200.'}]});
  const atom=p.source.semantic.evidenceAtoms.find(a=>a.exactText.includes('10,000'));assert(atom);
  p.outline[1]={...p.outline[1],role:'metric',chunkRefs:[atom.chunkId],refs:['r1'],requiredEvidenceIds:[atom.id]};p.planning=buildPlanning(p,{},p.outline);repo.saveProject(p);
  let calls=0;const render=async q=>{calls++;return simulatedExport(q);};const result=await publishProject(p.uid,p.id,{modelCall:async q=>scopeReview(q),renderPptx:render,renderImportedPptx:render},noop,noop);
  assert.equal(result.published,false);assert.equal(calls,0);assert(result.project.quality.deterministic.hardErrors>0);
 });
 await test('render verification failure retains prior publication and enters repair',async()=>{
  const p=fixture();repo.saveProject(p);
  const result=await publishProject(p.uid,p.id,{modelCall:async q=>scopeReview(q),renderPptx:async()=>{throw new Error('PPTX rendered visibility: test loss');}},noop,noop);
  assert.equal(result.published,false);assert.equal(result.project.publishedRevision,4);assert.equal(result.project.status,'quality_blocked');assert.equal(result.project.quality.exportable,false);assert.match(result.project.error,/export verification/,JSON.stringify(result.project.quality));
 });
 const detail='Preserve the mechanism and its assumptions. '+ 'Compare each result to its source record before taking any action. '.repeat(5)+'Critical condition: do not apply this method unless validation succeeds, except under the explicitly documented exception.';
 await test('mandatory detail tail and more than ten requirements survive planning',()=>{
  const required=[detail,...Array.from({length:12},(_,i)=>`Mandatory condition ${i}: preserve input scope.`)];
  const result=slidePlan([{id:'s1',title:'Mechanism',requiredDetails:required}],{}, {text:required.join('\n')});assert.deepEqual(result[0].requiredDetails,required);
  const p=fixture();p.planning={slidePlan:result};const registry=obligationRegistry(p);assert(registry.entries.some(e=>e.text===detail));assert.match(deckReviewPrompt(p),/explicitly documented exception/);
 });
 for(const status of ['missing','altered','not_evaluated'])await test(`mandatory ${status} blocks non-strict publish and local shortening`,async()=>{
  const p=fixture(),r=scopeReview(p);r.obligationAudit.checks[0].status=status;r.obligationAudit.checks[0].evidence=[];
  const normalized=normalizeModelReview(r,p.deck.slides.map(s=>s.id),p);assert.equal(finalQualityReport({issues:[],hardErrors:0,strictCoverage:false},[],normalized).publishEligible,false);
  const after=structuredClone(p);after.deck.slides[1].nodes[0].content.text='Changed expression';
  await assert.rejects(()=>assertCandidateScope(p,after,{modelCall:async q=>{const r=scopeReview(q);r.obligationAudit.checks[0].status=status;r.obligationAudit.checks[0].evidence=[];return r;}},noop),/original input framework/);
 });
 await test('obligation audit refuses stale registry, missing IDs and invisible evidence; correct paraphrase protocol passes',()=>{
  const p=fixture(),good=scopeReview(p);for(const mutation of [r=>r.obligationAudit.registryHash='old',r=>r.obligationAudit.checks=[],r=>r.obligationAudit.checks[0].evidence=[{slideId:'s1',nodeId:'invisible'}],r=>r.obligationAudit.checks[0].evidence[0].excerpt='invented quote']){const r=structuredClone(good);mutation(r);assert.throws(()=>normalizeModelReview(r,p.deck.slides.map(s=>s.id),p),/obligation/);}
  assert(finalQualityReport({issues:[],hardErrors:0},[],normalizeModelReview(good,p.deck.slides.map(s=>s.id),p)).publishEligible);
 });
 await test('self-negating findings require fresh bounded model review instead of an invented writer repair',async()=>{
  const p=fixture(),good=scopeReview(p),bad=structuredClone(good);bad.conflicts=[{slideIds:[p.deck.slides[0].id],detail:'\u6b64\u975e\u51b2\u7a81'}];
  assert.throws(()=>normalizeModelReview(bad,p.deck.slides.map(s=>s.id),p),/explicitly denies/);
  for(const detail of ['不构成缺失','已包含，不再报','不构成问题']){const positive=structuredClone(good);positive.missing=[{slideIds:[p.deck.slides[0].id],detail}];assert.throws(()=>normalizeModelReview(positive,p.deck.slides.map(s=>s.id),p),/explicitly denies/);}
  let calls=0;const result=await reviewWithContractRepair(p,async(prompt,key)=>{calls++;if(calls===1)return bad;assert.match(key,/:contract:1$/);assert.match(prompt,/explicitly denies/);return good;});
  assert.equal(calls,2);assert.equal(result.conflicts.length,0);assert.equal(bad.conflicts.length,1);
 });
 await test('malformed evidence gets bounded model correction; no quote or verdict is silently repaired',async()=>{
  const p=fixture(),good=scopeReview(p),bad=structuredClone(good);bad.obligationAudit.checks[0].evidence[0].excerpt='invented quote';
  const before=JSON.stringify(p);let calls=0;
  const fixed=await reviewWithContractRepair(p,async(prompt,key)=>{calls++;if(calls===1)return bad;assert.match(key,/:contract:1$/);assert.match(prompt,/invented quote/);assert.match(prompt,/actualInstanceText/);return good;});
  assert.equal(calls,2);assert.deepEqual(fixed.obligationAudit,good.obligationAudit);assert.equal(JSON.stringify(p),before);assert.equal(bad.obligationAudit.checks[0].evidence[0].excerpt,'invented quote');
  calls=0;await assert.rejects(()=>reviewWithContractRepair(p,async()=>{calls++;return bad;}),/obligation evidence/);assert.equal(calls,3);
  calls=0;await assert.rejects(()=>reviewWithContractRepair(p,async()=>{calls++;throw new Error('Desktop model request failed; check local API settings');}),/Desktop model request failed/);assert.equal(calls,1);
  const missing=structuredClone(good);missing.obligationAudit.checks[0].status='missing';missing.obligationAudit.checks[0].evidence=[];
  const result=await reviewWithContractRepair(p,async()=>missing);assert.equal(finalQualityReport({issues:[],hardErrors:0},[],result).publishEligible,false);
 });
 await test('incomplete audit feedback names missing, duplicate and foreign IDs without completing verdicts',async()=>{
  const p=fixture(),good=scopeReview(p),bad=structuredClone(good),id=good.obligationAudit.checks[0].obligationId;
  bad.obligationAudit.checks=[{...good.obligationAudit.checks[0],obligationId:'foreign'},{...good.obligationAudit.checks[0],obligationId:'foreign'}];
  const before=JSON.stringify(bad);let calls=0;
  const fixed=await reviewWithContractRepair(p,async(prompt)=>{calls++;const list=JSON.parse(prompt.match(/<required_audit_checklist>(.*?)<\/required_audit_checklist>/s)[1]);assert.equal(list.expectedCheckCount,good.obligationAudit.checks.length);assert.ok(list.requiredEntries.some(entry=>entry.obligationId===id));if(calls===1)return bad;
   const diagnostic=JSON.parse(prompt.match(/<review_contract_repair>(.*?)<\/review_contract_repair>/s)[1]).completeness;
   assert.ok(diagnostic.missingObligationIds.includes(id));assert.deepEqual(diagnostic.duplicateObligationIds,['foreign']);assert.deepEqual(diagnostic.unknownObligationIds,['foreign','foreign']);return good;});
  assert.equal(calls,2);assert.deepEqual(fixed.obligationAudit,good.obligationAudit);assert.equal(JSON.stringify(bad),before);
  calls=0;await assert.rejects(()=>reviewWithContractRepair(p,async()=>{calls++;return bad;}),/every obligation exactly once/);assert.equal(calls,3);
 });
 await test('critic receives exact table instance text in addition to structured cells',()=>{
  const p=fixture();p.deck.slides[1].nodes=[{id:'table-proof',type:'table',content:{headers:['Term','Value'],rows:[['Alpha','7']]}}];
  const pages=JSON.parse(deckReviewPrompt(p).match(/页面：([^\n]+)\n来源/u)[1]);
  const component=pages[1].semanticComponents.find(node=>node.nodeId==='table-proof');
  assert.equal(component.type,'table');assert.equal(component.text,'Alpha 7');assert.match(component.quoteId,/^quote-/u);
 });
 await test('repeated claim and deleted-page mandatory loss block local candidates',async()=>{
  const p=fixture(),after=structuredClone(p);after.deck.slides[1].nodes[0].content.text='Duplicated title';
  await assert.rejects(()=>assertCandidateScope(p,after,{modelCall:async q=>scopeReview(q,{repeated:[{slideIds:['s1','s2'],detail:'Same primary claim on both pages'}]})},noop),/original input framework/);
  after.deck.slides.splice(1,1);await assert.rejects(()=>assertCandidateScope(p,after,{modelCall:async q=>{const r=scopeReview(q);r.obligationAudit.checks[0].status='missing';r.obligationAudit.checks[0].evidence=[];return r;}},noop),/original input framework/);
 });
 const asset={id:'diagram',type:'image',nativeRef:{slideIndex:0,shapeId:7},geometry:box,content:{caption:'Three-step relationship'},style:{}};
 const mp={source:{text:'New source',sha256:'new'},templateFidelity:{...size,slides:[{nodes:[asset],slots:[]}]}},summary={id:'s1',nodes:[{id:'summary',type:'text',sourceArtifact:{sourceUnitId:'summary'},content:{text:'Unrelated prose'},geometry:box}]};
 await test('unknown image retained by source-region replacement; prose and reason cannot prove equivalence or approval',()=>{
  replaceTemplateSourceRegion(mp,summary,0,box);assert(!summary.templateOmissions?.some(o=>o.shapeId===7));
  for(const omission of [undefined,{shapeId:7,reason:'Need writing space'},{shapeId:7,disposition:'replaced_equivalent',reason:'Equivalent source ID'}]){
   const s={...summary,templateOmissions:omission?[omission]:[]};const ledger=inspectObjectIntegrity(mp,[s]);assert(ledger.issues.some(i=>i.code==='template_media_unaccounted'));assert.equal(ledger.ledger.templateAssets[0].status,'unresolved');
  }
 });
 await test('honest explicit old-example retirement binds source/template/asset hashes',()=>{
  const old=structuredClone(mp);old.templateFidelity.slides[0].nodes[0].content.mediaRole='old_template_content';old.templateFidelity.slides[0].nodes[0].geometry={...box,width:4000000,height:2500000};old.templateFidelity.slides[0].nodes.push({id:'sample-text',type:'text',geometry:box,content:{text:'Manufacturing throughput factory renovation prototype'}});
  const omissions=autoTemplateMediaOmissions(old,0);assert.equal(omissions.length,1);assert.equal(omissions[0].disposition,'retired_by_adaptation');
  const s={id:'s',nodes:[],templateOmissions:omissions};assert.equal(inspectObjectIntegrity(old,[s]).ledger.templateAssets[0].status,'retired_by_adaptation');
  old.source.text='Changed source';assert(inspectObjectIntegrity(old,[s]).issues.length);
 });
 await test('legacy export certificate and stale current-contract certificate cannot publish',()=>{
  const p=fixture();assert.throws(()=>acceptExportVerification(p,{exportVerification:{status:'passed'}}),/publication blocked/);
  const good=simulatedExport(p);p.revision++;assert.throws(()=>acceptExportVerification(p,good),/publication blocked/);
 });
 const runtime=localPptRuntime(root,python),png=spawnSync(python,['-c',"from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGB',(40,20),'blue').save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())"],{encoding:'utf8'});assert.equal(png.status,0,png.stderr);
 const p=fixture();p.id='actual-contract';const s=p.deck.slides[1];s.nodes=[
 {id:'first',type:'text',semanticRole:'source-explanation',geometry:{x:1000000,y:1800000,width:4200000,height:1500000},content:{text:'First mechanism retains complete conditions.'},style:{fontSizePt:18}},
 {id:'second',type:'text',semanticRole:'source-explanation',geometry:{x:1000000,y:3500000,width:4200000,height:1500000},content:{text:'Second explanation covers a different supported relationship.'},style:{fontSizePt:18}},
 ...[0,1].map(i=>({id:'picture'+i,type:'image',geometry:{x:6500000,y:1800000+i*1800000,width:2500000,height:1250000},content:{dataUrl:'data:image/png;base64,'+png.stdout.trim(),fit:'crop',crop:[.1,0,.1,0]}}))];
 let exported;await test('production generic export reopens actual file and checks actual converted PDF',async()=>{exported=await renderPptx(p,runtime.io);assert.equal(exported.exportVerification.version,2);assert.equal(exported.exportVerification.renderedVisibility.status,'passed');acceptExportVerification(p,exported);assert.equal(p.quality.visualVerified,false);assert.equal(p.quality.renderedTextVerified,true);});
 const verifier="import json,sys\nfrom pptx import Presentation\nfrom pptx.oxml.xmlchemy import OxmlElement\nfrom pptx.oxml.ns import qn\n"+OFFICE_MATH_SCRIPT+EXPORT_VERIFY_SCRIPT;
 for(const fault of ['offslide','collapsed','crop','missing-instance','font-size','paragraph-order'])await test(`actual file rejects ${fault}`,()=>{
  const target=path.join(root,fault+'.pptx');
  const mutation=spawnSync(python,['-c',`from pptx import Presentation\nfrom pptx.util import Pt\nimport sys\np=Presentation(sys.argv[1]);s=p.slides[1];kind=sys.argv[3]\na=next(x for x in s.shapes if 'AIMate instance:first:' in x.name)\nb=next(x for x in s.shapes if 'AIMate instance:second:' in x.name)\nif kind=='offslide':a.left=p.slide_width+100000\nif kind=='collapsed':\n a.text=a.text+' '+b.text;b.text=''\nif kind=='crop':next(x for x in s.shapes if hasattr(x,'image')).crop_left=.45\nif kind=='missing-instance':\n x=next(x for x in s.shapes if 'AIMate instance:picture1:' in x.name);x._element.getparent().remove(x._element)\nif kind=='font-size':\n for paragraph in a.text_frame.paragraphs:\n  for run in paragraph.runs:run.font.size=Pt(90)\nif kind=='paragraph-order':a.text='conditions. complete retains mechanism First'\np.save(sys.argv[2])`,exported.path,target,fault],{encoding:'utf8'});assert.equal(mutation.status,0,mutation.stderr);
  const result=spawnSync(python,['-c',verifier+'\nverify_export(sys.argv[1],json.load(sys.stdin))',target],{input:JSON.stringify(exportManifest(p)),encoding:'utf8'});assert.notEqual(result.status,0,fault+' must be rejected');assert.match(result.stderr,/PPTX (?:export integrity|rendered visibility)/);negativeFiles.push({fault,error:result.stderr.trim().split('\n').at(-1)});if(process.env.PPT_TEST_OUTPUT)fs.copyFileSync(target,path.join(process.env.PPT_TEST_OUTPUT,fault+'.pptx'));
 });
 await test('actual rendered loss blocks even without a caller preflight',async()=>{
  const dense=structuredClone(p);dense.id='too-dense';dense.deck.slides[1].nodes[0].content.text='Distinct complete explanation with conditions and exceptions. '.repeat(180);
  await assert.rejects(()=>renderPptx(dense,runtime.io),/PPTX rendered visibility/);
 });
 await test('timeline and metric multi-instance bodies satisfy the same export contract',async()=>{
  const q=fixture();q.id='timeline-metric';q.deck.slides[1].layoutId='timeline';q.deck.slides[2].layoutId='big-number';
  await renderPptx(q,runtime.io);
  const e=exportManifest(q).slides[2];assert.equal(new Set(e.nodes.map(n=>n.id)).size,e.nodes.length);
 });
 await test('native signed chart, rotated text, grouped media and ellipse mask preserve their contracts',async()=>{
  const file=path.join(root,'native-input.pptx');const made=spawnSync(python,['-c',`from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
import base64,io,sys
p=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);
t=s.shapes.add_textbox(Inches(.5),Inches(.4),Inches(5),Inches(1));t.text='Native object contract';t.rotation=8
for para in t.text_frame.paragraphs:
 for run in para.runs:run.font.size=Pt(22)
image=s.shapes.add_picture(io.BytesIO(base64.b64decode(sys.argv[2])),Inches(7),Inches(.4),Inches(2),Inches(1));image._element.spPr.prstGeom.set('prst','ellipse')
g=s.shapes.add_group_shape();g.shapes.add_picture(io.BytesIO(base64.b64decode(sys.argv[2])),Inches(7),Inches(2),Inches(2),Inches(1))
d=CategoryChartData();d.categories=['Loss','Gain'];d.add_series('Change',[-5,7]);s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,Inches(.5),Inches(2),Inches(5),Inches(3),d)
p.save(sys.argv[1])`,file,png.stdout.trim()],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
  const imported=await importEditablePptx({id:'native-contract',uid:'hard-rule-test',templateSpec:p.templateSpec},fs.readFileSync(file),'native-source',runtime.io);
  const native=await renderImportedPptx(imported,runtime.io);assert.equal(native.exportVerification.status,'passed');assert.equal(native.exportVerification.renderedVisibility.mixedSignColumnChartsChecked,1);
  const bad=path.join(root,'native-wrong-sign.pptx');
  const inverted=spawnSync(python,['-c',"from pptx import Presentation\nimport sys\np=Presentation(sys.argv[1]);c=next(s.chart for s in p.slides[0].shapes if s.has_chart);c.series[0].invert_if_negative=True;p.save(sys.argv[2])",native.path,bad],{encoding:'utf8'});assert.equal(inverted.status,0,inverted.stderr);
  const invalid=spawnSync(python,['-c',verifier+'\nverify_export(sys.argv[1],json.load(sys.stdin))',bad],{input:JSON.stringify(exportManifest(imported)),encoding:'utf8'});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/negative chart rendering flag/);
  if(process.env.PPT_TEST_OUTPUT){fs.copyFileSync(native.path,path.join(process.env.PPT_TEST_OUTPUT,'valid-native-contract.pptx'));fs.copyFileSync(native.exportVerification.renderedVisibility.pdfPath,path.join(process.env.PPT_TEST_OUTPUT,'valid-native-contract.pdf'));}
 });
 const report={status:'passed',checks,negativeFiles,scenarioCount:checks.length,semanticModel:'simulated protocol, not live semantic accuracy',export:exported.exportVerification};
 if(process.env.PPT_TEST_OUTPUT){fs.mkdirSync(process.env.PPT_TEST_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.PPT_TEST_OUTPUT,'hard-rules.json'),JSON.stringify(report,null,2)+'\n');fs.copyFileSync(exported.path,path.join(process.env.PPT_TEST_OUTPUT,'valid-instance-contract.pptx'));fs.copyFileSync(exported.exportVerification.renderedVisibility.pdfPath,path.join(process.env.PPT_TEST_OUTPUT,'valid-instance-contract.pdf'));fs.writeFileSync(path.join(process.env.PPT_TEST_OUTPUT,'instance-manifest.json'),JSON.stringify(exportManifest(p),null,2)+'\n');}
 console.log(JSON.stringify(report,null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}

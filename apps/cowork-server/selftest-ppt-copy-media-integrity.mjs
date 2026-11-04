import assert from 'node:assert/strict';
import { materializeCopy } from './lib/ppt-presentation-writing.mjs';
import { normalizeSlideCopy, inspectVisibleCopy } from './lib/ppt-copy-integrity.mjs';
import { inspectObjectIntegrity } from './lib/ppt-object-integrity.mjs';
import { inspectDensity } from './lib/ppt-density-qa.mjs';
import { repairProject, finalQualityReport } from './lib/ppt-quality.mjs';
import { normalizePaste } from './lib/ppt-source.mjs';
import { bindSourceArtifacts } from './lib/ppt-source-artifacts.mjs';
import { BUILT_INS, snapshotTemplate } from './lib/ppt-template.mjs';
import {adaptationDisposition,validAdaptation} from './lib/ppt-template-dispositions.mjs';
const claim='Portfolio turnover changes trading costs and therefore affects net strategy returns.';
const planning={brief:{depth:'detailed'},slidePlan:[{slideId:'body',depth:'detailed',role:'evidence',message:'Measure net returns'}]};
const materialized=materializeCopy({title:'Measure net returns',subtitle:claim,contentBlocks:[{heading:'Same heading',body:claim},{heading:'Same heading',body:claim}],takeaway:claim},{id:'body'},planning);
assert.equal(materialized.copy.takeaway,''); assert.equal(materialized.copy.subtitle,'');assert.equal(materialized.copy.blocks.length,1);
const project={source:{text:'',segments:[]},outline:[],planning,templateSpec:snapshotTemplate(BUILT_INS[0]),templateFidelity:{mode:'mapped'},deck:{slides:[
 {id:'cover',title:'Example',layoutId:'cover',bullets:[],blocks:[]},
 {id:'body',title:materialized.title.title,layoutId:'editorial',bullets:materialized.bullets,copy:materialized.copy,blocks:[],nodes:[],factSynthesis:{implications:[claim]}},
 {id:'end',title:'Summary',layoutId:'conclusion',bullets:['Review all conditions before publishing.'],blocks:[]}]}};
const repaired=repairProject(project,{issues:[]});assert.equal(repaired.project.deck.slides[1].copy.takeaway,'');
assert.deepEqual(repairProject(repaired.project,{issues:[]}).project.deck,repaired.project.deck,'repair must be idempotent');
const repeated={id:'repeat',nodes:[{id:'one',type:'text',semanticRole:'subtitle',content:{text:claim}},{id:'two',type:'text',semanticRole:'takeaway',content:{text:claim}}]};
assert.equal(inspectVisibleCopy([repeated])[0].severity,'error');
assert.equal(inspectVisibleCopy([{...repeated,nodes:repeated.nodes.map(n=>({...n,hidden:true}))}]).length,0);
assert.equal(inspectVisibleCopy([{id:'vars',nodes:[{id:'a',type:'text',content:{text:'alpha beta'}},{id:'b',type:'text',content:{text:'alpha beta'}}]}]).length,0);
const languages=materializeCopy({title:'Returns',contentBlocks:[{body:'The model explains returns through measured exposures.'},{body:'模型通过测得的风险暴露解释收益。'}]},{id:'body'},planning);
assert.equal(languages.copy.blocks.length,2,'different language claims must not be blindly removed');
const opposite=materializeCopy({title:'Risk',contentBlocks:[{body:'The measured risk is not evidence of a profitable strategy.'},{body:'The measured risk is evidence of a profitable strategy.'}]},{id:'body'},planning);
assert.equal(opposite.copy.blocks.length,2,'word overlap cannot remove negation');
const recap={id:'recap',repeatPurpose:'apply_to_new_case',nodes:[{id:'new',type:'text',content:{text:claim}}]};
assert.equal(inspectVisibleCopy([repeated,recap]).filter(i=>i.code==='visible_copy_repeated_across_pages').length,0);
const source=normalizePaste('# Research\n\n| Factor | Mechanism |\n|---|---|\n| Value | Risk or extrapolation |\n| Momentum | Slow diffusion |\n\n$$r_i=\\alpha_i+\\beta_i f+\\epsilon_i$$\n\n## Practical Checklist\n\n- Check timing.\n- Check costs.');
const items=source.semantic.inventory.items.filter(item=>item.must_preserve_structure);
const p={...project,source,planning:{slidePlan:items.map((item,index)=>({slideId:`object${index}`,sourceArtifacts:[{sourceUnitId:item.id}]}))}};
const slides=items.map((item,index)=>bindSourceArtifacts(p,{id:`object${index}`,nodes:[],sourceRefs:item.source_ref},[{sourceUnitId:item.id}],index+1));
assert.equal(inspectObjectIntegrity(p,slides).issues.length,0);
assert.ok(inspectObjectIntegrity(p,[]).issues.every(i=>i.severity==='error'));
const damaged=structuredClone(slides);damaged.find(s=>s.nodes.some(n=>n.type==='table')).nodes.find(n=>n.type==='table').content.rows[1][1]='';
assert.ok(inspectObjectIntegrity(p,damaged).issues.some(i=>i.code==='required_source_object_missing'));
const hidden=slides.map(s=>({...s,nodes:s.nodes.map(n=>({...n,hidden:true}))}));assert.ok(inspectObjectIntegrity(p,hidden).issues.length);
const final=finalQualityReport({issues:inspectObjectIntegrity(p,[]).issues,hardErrors:items.length},{}, {missing:[],repeated:[],conflicts:[],unsupported:[]});
assert.equal(final.publishEligible,false);assert.equal(final.editorialReady,false);
const q=inspectDensity({...project,source:{text:'x'.repeat(9000)}},[{id:'cover'},repeated]).metrics.visibleDensityPerSlide[1];
assert.ok(q.uniqueInformationUnits<q.rawVisibleUnits);
const locked={title:'Test',copy:{blocks:[{body:claim}],takeaway:claim},nodes:[{type:'text',nativeRef:{shapeId:1},content:{text:claim}}]};
assert.deepEqual(normalizeSlideCopy(locked),[]);
console.log('PPT copy/media integrity: exact duplication, recap/language/negation, repair idempotency, objects/cells/visibility and unique density: OK');
const {acceptExportVerification}=await import('./lib/ppt-export-integrity.mjs');
assert.throws(()=>acceptExportVerification({},{}),/not verified/);
assert.equal(finalQualityReport({issues:[],hardErrors:0},{},{evaluation:'not_evaluated',missing:[],repeated:[],conflicts:[],unsupported:[]}).publishEligible,false);
const requiredImage={id:'small-formula-image',required:true,dataUrl:'data:image/png;base64,AA==',width:10,height:4};
assert.equal(inspectObjectIntegrity({source:{images:[requiredImage]}},[]).issues[0].severity,'error');
assert.equal(inspectObjectIntegrity({source:{images:[requiredImage]}},[{id:'image-page',nodes:[{id:'img',type:'image',content:{sourceImageId:requiredImage.id,dataUrl:'data:image/png;base64,AQ=='}}]}]).issues.length,1,'same ID cannot substitute incorrect image bytes');
const oldSample={id:'old-sample',type:'image',nativeRef:{shapeId:2},geometry:{x:0,y:0,width:100,height:100},content:{dataUrl:'data:image/png;base64,AA==',mediaRole:'old_template_content',mustPreserve:false}};
const designProject={source:{text:'New source'},templateContentMode:'design_only',templateFidelity:{sha256:'template-hash',slides:[{nodes:[oldSample]}]}};
const retirement=adaptationDisposition(designProject,oldSample,'old_template_content','design_only_template','Design-only reuse omits unrelated old sample content.');
assert.ok(validAdaptation(designProject,oldSample,retirement,'old_template_content'));
assert.equal(inspectObjectIntegrity(designProject,[{id:'design',nodes:[],templateOmissions:[retirement]}]).issues.length,0);
assert.equal(validAdaptation({...designProject,templateContentMode:'preserve'},oldSample,retirement,'old_template_content'),false);
assert.equal(validAdaptation({...designProject,source:{text:'Changed source'}},oldSample,retirement,'old_template_content'),false);
assert.ok(inspectObjectIntegrity(designProject,[{id:'design',nodes:[],templateOmissions:[]}]).issues.some(i=>i.code==='template_media_unaccounted'));
const requiredOld={...oldSample,locked:true,content:{...oldSample.content,mustPreserve:true}};const requiredRetirement=adaptationDisposition(designProject,requiredOld,'old_template_content','design_only_template','Not permission to remove an explicitly selected fixed asset.');
assert.ok(inspectObjectIntegrity({...designProject,templateFidelity:{...designProject.templateFidelity,slides:[{nodes:[requiredOld]}]}},[{id:'design',nodes:[],templateOmissions:[requiredRetirement]}]).issues.some(i=>i.code==='template_media_unaccounted'));
const withCommentary=bindSourceArtifacts(p,{id:'object0',nodes:[],sourceRefs:items[0].source_ref},[{sourceUnitId:items[0].id}],1,[items[0].type==='TableBlock'?items[0].rows.map(row=>row.join(' | ')).join('\n'):items[0].text]);
assert.equal(withCommentary.nodes.length,1,'do not repeat full table in visible commentary');
const {normalizeModelReview}=await import('./lib/ppt-quality.mjs');
assert.throws(()=>normalizeModelReview({missing:[{slideId:'a',reason:'Missing relation'}],repeated:[],conflicts:[],unsupported:[]},['a']),/valid slideIds/,'malformed findings must not become a false empty review');
const many=Array.from({length:25},(_,i)=>({slideIds:['a'],detail:'Missing relation '+i}));
assert.equal(normalizeModelReview({missing:many,repeated:[],conflicts:[],unsupported:[]},['a']).missing.length,25,'systemic findings must not be silently truncated');
assert.equal(finalQualityReport({issues:[],hardErrors:0},{},{evaluation:'not_evaluated',missing:[],repeated:[],conflicts:[],unsupported:[]}).status,'blocked');
const {equationContent}=await import('./lib/ppt-math.mjs');
const math=equationContent('\\frac{\\alpha_i+\\beta_i f}{\\sigma_i^2}');assert.equal(math.mathStatus,'native_math');assert.ok(math.mathMl.includes('<mfrac>'));assert.ok(!math.displayText.includes('\\frac'));
console.log('PPT delivery gates: not evaluated/export verification, image content identity, structure/commentary duplication and native math: OK');
const {replaceTemplateSourceRegion}=await import('./lib/ppt-source-artifacts.mjs');
const regionProject={templateFidelity:{width:1000,height:1000,slides:[{slots:[{shapeId:1,role:'title'}],nodes:[
 {type:'text',nativeRef:{shapeId:1},geometry:{x:100,y:160,width:500,height:100}},
 {type:'image',nativeRef:{shapeId:2},geometry:{x:0,y:0,width:1000,height:1000}},
 {type:'shape',nativeRef:{shapeId:3},geometry:{x:200,y:400,width:300,height:100}},
 {type:'image',nativeRef:{shapeId:4},geometry:{x:0,y:200,width:80,height:500}},
 {type:'text',nativeRef:{shapeId:5},geometry:{x:300,y:450,width:200,height:50}}
]}]}};
const regionSlide={};replaceTemplateSourceRegion(regionProject,regionSlide,0,{x:100,y:300,width:800,height:600});
assert.deepEqual(regionSlide.templateOmissions.map(o=>o.shapeId),[3,5],'replace old diagram foreground/labels while preserving title, background and side photo');
const {equationDimensions}=await import('./lib/ppt-math.mjs');
assert.ok(equationDimensions(math,18).widthPt<300,'a fraction must use its intrinsic width instead of stretching across the slide');
assert.ok(equationDimensions(math,18).heightPt>18);
const {contentCanvas,INCH}=await import('./lib/ppt-density-capacity.mjs');
const header={nativeRef:{shapeId:1},geometry:{x:INCH,y:INCH*2.7,width:INCH*10,height:INCH*.43},style:{fontSizePt:30.5},nativeTextFrame:{margins:[91440,91440,91440,91440],paragraphs:[{}]}};
const headerProject={source:{text:'x'.repeat(8000)},templateFidelity:{width:INCH*13.33,height:INCH*7.5,slides:[{slots:[{role:'title',shapeId:1},{role:'content',shapeId:2}],nodes:[header,{nativeRef:{shapeId:2},geometry:{x:INCH,y:INCH*3,width:INCH*10,height:INCH*3}}]}]}};
assert.ok(contentCanvas(headerProject,0).geometry.y>=header.geometry.y+INCH*(30.5*1.25/72+.2+.08),'source table must clear native title glyphs and padding, not just the undersized box');
for(const [kind,text] of [
 ['research','# Research\n\n$$y=\\alpha+\\beta x$$\n\n| Condition | Test |\n|---|---|\n| Timing | Before outcome |\n\n## Summary\n\nInterpret the model only within the measured sample.'],
 ['business','# Business\n\n| Metric | Result | Condition |\n|---|---|---|\n| Revenue | 12% | Same period |\n| Costs | 4% | Same scope |\n\nInput → Validate costs → Review decision\n\n## Checklist\n\n- Confirm scope.\n- Confirm measurement.\n\n## Summary\n\nCompare revenue and costs under consistent reporting conditions.'],
 ['architecture','# Architecture\n\nRequest → Validate identity → Schedule job → Store output\n\n| Interface | Constraint |\n|---|---|\n| Queue | Idempotent request key |\n\n## Checklist\n\n- Verify recovery.\n- Verify bounded retries.\n\n## Summary\n\nRecover the persisted job without repeating committed effects.']
]){
 const input=normalizePaste(text),required=input.semantic.inventory.items.filter(i=>i.must_preserve_structure||i.type==='SummaryBlock');
 const deckProject={...p,source:input,planning:{slidePlan:required.map((item,index)=>({slideId:`${kind}${index}`,sourceArtifacts:[{sourceUnitId:item.id}]}))}};
 const rendered=required.map((item,index)=>bindSourceArtifacts(deckProject,{id:`${kind}${index}`,nodes:[]},[{sourceUnitId:item.id}],index+1));
 assert.equal(inspectObjectIntegrity(deckProject,rendered).ledger.fulfilledCount,required.length);
 assert.ok(required.some(i=>i.type==='SummaryBlock'),`${kind}: final summary is a mandatory object`);
 if(kind==='research')assert.ok(inspectObjectIntegrity(deckProject,[...rendered,{...structuredClone(rendered[0]),id:'duplicate-primary'}]).issues.some(i=>i.code==='required_source_object_duplicate'));
}
console.log('PPT general sources: research, business and architecture full structures/tail summaries, ownership, formula dimensions and template region replacement: OK');
const unresolved=normalizePaste('# Architecture\n\n![System diagram](relative-diagram.svg)');
assert.equal(unresolved.mediaWarnings[0].required,true);
assert.ok(inspectObjectIntegrity({source:unresolved},[]).issues.some(i=>i.code==='required_source_media_decode'));
assert.ok(!unresolved.text.includes('relative-diagram.svg'),'asset references must not become body prose');
const reorderedMathSource=normalizePaste('# Equations\n\n$$\\tfrac{1}{3}x$$');
const reorderedMathItem=reorderedMathSource.semantic.inventory.items.find(i=>i.type==='EquationBlock');
const reorderedMathExpected=equationContent(reorderedMathItem.text);
const reorderedMathNode={id:'formula',type:'text',sourceArtifact:{sourceUnitId:reorderedMathItem.id},content:{...reorderedMathExpected,mathMl:reorderedMathExpected.mathMl.replace(/displaystyle="false" scriptlevel="0"/gu,'scriptlevel="0" displaystyle="false"')}};
assert.equal(inspectObjectIntegrity({source:reorderedMathSource},[{id:'s',nodes:[reorderedMathNode]}]).ledger.fulfilledCount,1,'equivalent XML attribute order must preserve formula identity');
const changedMath=structuredClone(reorderedMathNode);changedMath.content.mathMl=changedMath.content.mathMl.replace('<mn>3</mn>','<mn>4</mn>');
assert.ok(inspectObjectIntegrity({source:reorderedMathSource},[{id:'s',nodes:[changedMath]}]).issues.some(i=>i.code==='required_source_object_missing'),'changed denominator must still fail');

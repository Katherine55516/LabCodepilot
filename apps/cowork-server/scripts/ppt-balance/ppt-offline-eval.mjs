import {equationContent} from '../../lib/ppt-math.mjs';
/** No provider calls. Replay saved writer IR, compare old/new numeric checks,
 * profile two local templates and exercise the production shared exporters. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from '../../test/ppt-local-runtime.mjs';
import {importEditablePptx} from '../../lib/ppt/import-pptx.mjs';
import {templateComponentProfile,bindMappedTemplateMedia} from '../../lib/ppt-template-components.mjs';
import {templateMediaRole,_internals} from '../../lib/ppt-template-fidelity.mjs';
import {normalizePaste} from '../../lib/ppt-source.mjs';
import {inspectSourceNumbers} from '../../lib/ppt-source-numbers.mjs';
import {deterministicReview} from '../../lib/ppt-quality.mjs';
import {buildRenderTree} from '../../lib/ppt/render-tree.mjs';
import {renderIssues} from '../../lib/ppt/render-audit.mjs';
import {renderPptx} from '../../lib/ppt-render.mjs';import {renderPdf} from '../../lib/ppt-pdf.mjs';
import {snapshotTemplate,BUILT_INS} from '../../lib/ppt-template.mjs';
import {ensureProjectV3} from '../../lib/ppt/ir.mjs';
import {estimatePageRecommendation} from '../../lib/ppt-planning.mjs';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const output=path.resolve(process.argv[2]||path.join(repo,'outputs/ppt-offline-contract-template-20261009'));
fs.mkdirSync(output,{recursive:true});const runtime=localPptRuntime(output),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2));
const report={kind:'offline_no_model_calls',baseline:'988dfd2',numeric:[],templates:[],replays:[],estimates:[],components:[]};
const old=spawnSync('git',['show','988dfd2:apps/cowork-server/lib/ppt-source-numbers.mjs'],{cwd:repo,encoding:'utf8'});if(old.status!==0)throw new Error(old.stderr);
const moduleOrigin=new URL('../../lib/ppt-source-numbers.mjs',import.meta.url);
const oldPath=path.join(output,'baseline-source-numbers.mjs');fs.writeFileSync(oldPath,old.stdout.replace(/from '(\.[^']+)'/gu,(_,ref)=>`from '${new URL(ref,moduleOrigin).href}'`));
const baseline=await import(pathToFileURL(oldPath));
const cases=[['single_digit','There are 5 funds.','There are 7 funds.'],['sign','Return is -12%.','Return is +12%.'],['unit','Revenue is 10 million. Growth is 20%.','Revenue is 20 million.'],['attribution','Revenue is 10 million. Costs are 20 million.','Revenue is 20 million.'],['decimal_positive','Rate is 0.50%.','Rate is 0.5%.'],['ordinal_positive','No measurements supplied.','Step 2'],['template_authority','No forecast supplied.','Revenue is 777 million.']];
for(const [id,input,copy] of cases){const p={source:{text:input},generationPolicy:{knowledge:'source_only'},templateFidelity:{slides:[{nodes:[{type:'text',content:{text:'Revenue is 777 million.'}}]}]}};
const slides=[{id:'s',nodes:[{id:'n',type:'text',content:{text:copy}}]}];report.numeric.push({id,expected:id.endsWith('positive')?'allow':'block',baseline:baseline.inspectSourceNumbers(p,slides),current:inspectSourceNumbers(p,slides)});}
for(const example of report.numeric)assert.equal(example.current.some(x=>x.severity==='error'),example.expected==='block',example.id);
for(const name of ['04_factor_zoo_overview.md','09_factor_testing.md']){
 const filename=`/Users/dongli/Documents/quant_research/quant_3.0/${name}`;if(!fs.existsSync(filename)){report.estimates.push({filename,status:'missing'});continue;}
 const bytes=fs.readFileSync(filename),source=normalizePaste(bytes.toString());report.estimates.push({filename,sha256:sha(bytes),recommendation:estimatePageRecommendation({source,generationPolicy:{detail:'balanced'}})});
}
for(const [id,filename] of [['process-improvement','/Users/dongli/Downloads/Copy-of-Process-Improvement-Proposal.pptx'],['deal-review','/Users/dongli/Downloads/Copy-of-Deal-Review (1).pptx']]){
 if(!fs.existsSync(filename)){report.templates.push({id,filename,status:'missing'});continue;}
 const bytes=fs.readFileSync(filename),imported=await importEditablePptx({id:`profile-${id}`,uid:'offline',title:id},bytes,sha(bytes),runtime.io);
 const slides=imported.deck.slides.map(slide=>({...slide,slots:_internals.slotsFor(slide)}));
 const profile=templateComponentProfile(slides,imported.externalPptx,sha(bytes),templateMediaRole);write(`${id}-profile.json`,profile);
 report.templates.push({id,filename,sha256:sha(bytes),pages:profile.pages.length,picturePlacements:profile.pages.reduce((n,p)=>n+p.media.length,0),uniqueAssets:profile.assets.length,roles:Object.fromEntries([...new Set(profile.assets.map(x=>x.role))].map(role=>[role,profile.pages.reduce((n,p)=>n+p.media.filter(x=>x.role===role).length,0)])),profileHash:profile.profileHash});
 if(id==='process-improvement')report.processProfile=profile;
}
// Frozen historical writer IR: explicitly simulated, not a live-model baseline.
const replayDir=path.join(repo,'outputs/alpha-mining-deal-review-simulation-20261008/workflow-state/ppt/alpha-mining-deal-review-sim');
if(fs.existsSync(replayDir))for(const filename of fs.readdirSync(replayDir).filter(x=>x.endsWith('.json')&&!x.startsWith('_'))){
 const bytes=fs.readFileSync(path.join(replayDir,filename)),stored=JSON.parse(bytes),project=stored.project;
 const revive=value=>{if(!value||typeof value!=='object')return value;if(Object.keys(value).length===1&&value.__pptStoredMediaRef){const hash=value.__pptStoredMediaRef;const text=stored.assets?.[hash]||fs.readFileSync(path.join(replayDir,'assets',`${hash}.txt`),'utf8');if(sha(text)!==hash)throw new Error('Replay media hash mismatch');return text;}for(const key of Object.keys(value))value[key]=revive(value[key]);return value;};
 if(project)revive(project);
 if(project?.status!=='completed'||!project.deck)continue;
 const review=deterministicReview(project);
 report.replays.push({filename,sha256:sha(bytes),sourceHash:sha(project.source?.text||''),origin:'historical_simulated_writer_IR',pages:project.deck.slides.length,issues:review.issues,hardErrors:review.hardErrors,numericBefore:baseline.inspectSourceNumbers(project),numericAfter:inspectSourceNumbers(project)});
}
const templateSpec=snapshotTemplate(BUILT_INS.find(x=>x.id==='light'));
const item=(id,text)=>({id,text});
const slides=[{id:'cover',title:'Offline component evidence',layoutId:'cover',bullets:[],blocks:[]},
 {id:'panels',title:'Methods and conditions',layoutId:'two-panel',bullets:['A ranked portfolio compares signals under a fixed universe.','A neutral portfolio constrains exposures and turnover.','Costs and liquidity determine implementation limits.'],blocks:[]},
 {id:'formula',title:'Model and variables',layoutId:'formula-variables',nodes:[{id:'formula-title',type:'text',semanticRole:'title',content:{text:'Model and variables'}},{id:'eq',type:'text',content:equationContent('y=ax+b')},{id:'variables',type:'text',content:{text:'x is the input variable.\na is the slope coefficient.\nb is the intercept.\nThe expression defines a linear relation.'}}]},
 {id:'items',title:'Distinct research tasks',layoutId:'summary',bullets:['State a testable hypothesis and its economic mechanism.','Preserve conditions and compare alternatives on shared axes.','Measure costs, evaluate results and monitor drift.'],blocks:[]}];
const project=ensureProjectV3({id:'components',uid:'offline',title:'Offline components',template:'light',templateSpec,deck:{slides}});
if(report.processProfile){project.templateFidelity={mode:'mapped',componentProfile:report.processProfile};bindMappedTemplateMedia(project);}else project.deck.slides[3].layoutId=project.deck.slides[3].layoutRef='item-icons';
const tree=buildRenderTree(project);write('component-render-tree.json',tree);write('component-project.json',project);
const problems=renderIssues(tree).filter(x=>x.severity==='error');if(problems.length)throw new Error(JSON.stringify(problems));
const pptx=await renderPptx(project,runtime.io);await renderPdf(project,runtime.io);
const objectChecks=await runtime.io.runPython(project,`
import json,sys
from zipfile import ZipFile
from xml.etree import ElementTree as ET
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
data=json.load(sys.stdin);count=0
with ZipFile(data['path']) as archive:
 for index in (2,4):
  page=ET.fromstring(archive.read(f'ppt/slides/slide{index}.xml'))
  for shape in page.findall('.//p:sp',ns):
   geom=shape.find('p:spPr/a:prstGeom',ns)
   if geom is None or geom.get('prst')!='roundRect':continue
   count+=1
   assert shape.find('p:style',ns) is None,'Unexpected inherited theme effect'
   assert shape.find('p:txBody/a:bodyPr',ns).get('anchor')=='t','Card text must align at top'
   assert all(p.get('algn')=='l' for p in shape.findall('p:txBody/a:p/a:pPr',ns)),'Card paragraphs must align left'
assert count==6,f'Expected 6 full editable point cards, found {count}'
print(json.dumps({'pointCards':count,'topAligned':True,'noInheritedEffects':True}))
`,JSON.stringify({path:pptx.path}));
for(const asset of [...report.templates,...report.estimates].filter(x=>x.sha256))assert.equal(sha(fs.readFileSync(asset.filename)),asset.sha256,'original source/template changed');
report.components={objectChecks,pptx:pptx.path,exportVerification:pptx.exportVerification,renderIssues:renderIssues(tree),layouts:tree.slides.map(x=>x.layoutId)};
delete report.processProfile;write('report.json',report);
const summary=`# PPT 离线验证\n\n无 API、无真实模型调用。基线数字检查取自 ${report.baseline}；使用相同输入比较独立数字检查，不冒充全模块旧版本回放。\n\n## 边界样例\n\n| case | expected | baseline findings | current findings |\n|---|---|---:|---:|\n${report.numeric.map(x=>`| ${x.id} | ${x.expected} | ${x.baseline.length} | ${x.current.length} |`).join('\n')}\n\n## 模板档案\n\n${report.templates.map(x=>`- ${x.id}：${x.pages||0}页，${x.picturePlacements||0}次图片使用，角色 ${JSON.stringify(x.roles)}。`).join('\n')}\n\n## 回放\n\n${report.replays.length}份历史模拟 writer IR，原文件未修改；报告保留现有问题，不把旧稿 blocked 当作回归。所有事实校准仍需人工/真实模型。\n\n## 共享组件\n\n实际导出4页，布局 ${JSON.stringify(report.components.layouts)}；PPTX重新打开及PDF验证 ${report.components.exportVerification.status}。逐页 PNG 见导出证据路径，人工视觉审核另行记录。\n`;
fs.writeFileSync(path.join(output,'README.md'),summary);console.log(JSON.stringify({output,templates:report.templates,numeric:report.numeric.map(x=>({id:x.id,current:x.current.length})),replays:report.replays.length,pptx:pptx.path}));

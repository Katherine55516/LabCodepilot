/** Hand-authored source allocation for gamma.md. The model boundary is a
 * protocol double, not a summary algorithm or a claim about live LLM quality.
 * Complete units/ranges go through the real parser, compiler and renderer. */
import {reviewBatches} from '../lib/ppt-review-batches.mjs';
import {scopeReview} from '../ppt-scope-test-helpers.mjs';
import {pageTopicLanguage} from '../lib/ppt-presentation-contract.mjs';
const id=n=>'b_'+String(n).padStart(4,'0');
// Source IDs are locators in this golden input. No table/code/link is stripped.
const CARDS=[
 ['核心架构判断','Structured content compiler',[1,3,4,6]],
 ['两种生成路径','Generation paths',[7,8,9,10]],
 ['事实与推断边界','Facts and inference boundaries',[14,15,99]],
 ['输入与规划层','Input and planning layers',[17],1,5],
 ['叙事与内容层','Story and content layers',[17],5,9],
 ['设计与媒体层','Design and media layers',[17],9,13],
 ['渲染与基础设施','Rendering and infrastructure',[17,18],13,18],
 ['五种创建模式','Five creation modes',[20,21]],
 ['Agent 工作流','Agent workflow',[23]],
 ['完整路径与快速路径','Full and fast paths',[24,25]],
 ['任务语义归一化','Semantic normalization',[27,29]],
 ['Brief 字段样例','Presentation brief fields',[28]],
 ['卡片与文档层次','Card hierarchy',[31,33]],
 ['语义与坐标的区别','Semantics and geometry',[35,36,38]],
 ['设计执行步骤','Design execution stages',[41]],
 ['内容与布局解耦','Content and layout separation',[40,42,43,46]],
 ['媒体系统与并行职责','Media subsystem',[48,50]],
 ['媒体条件路由','Media conditional routing',[49],1,6],
 ['媒体来源与渲染回合','Media sources and render',[49],6,11],
 ['多模型分工原则','Model routing principles',[52,54]],
 ['模型任务矩阵','Model task matrix',[53]],
 ['可测试的提示工程','Composable prompting',[56,58]],
 ['异步作业与并行 Worker','Asynchronous workers',[60,61,62]],
 ['原生文档与导出','Native document and export',[64,65,66,67,68,69,70]],
 ['创建与导入工作流','Creation workflows',[72],1,5],
 ['变换与编辑工作流','Transformation workflows',[72],5,9],
 ['媒体与协作工作流','Media and collaboration workflows',[72],9,13],
 ['发布与复用工作流','Publishing workflows',[72],13,17],
 ['规划任务分工','Planning responsibilities',[75],1,5],
 ['设计任务分工','Design responsibilities',[75],5,9],
 ['渲染与修复分工','Rendering responsibilities',[75],9,12],
 ['通用 Skill 串行链路','Generic skill sequence',[77]],
 ['并行执行的依赖关系','Parallel execution dependencies',[79]],
 ['概念延迟模型','Conceptual latency model',[80,81,82,83]],
 ['重排与模板约束','Reflow and template constraints',[85,86,88]],
 ['持续进展与感知延迟','Progress and perceived latency',[90,91]],
 ['可复用的架构原则','Reusable architecture principles',[93]],
 ['推荐架构与设计原则','Recommended architecture',[95,96]],
];
export function gammaFixtureOutline(project){
 const items=project.source.semantic.inventory.items;
 const slides=[{title:pageTopicLanguage(project,{})==='en'?'Gamma architecture and workflows':'Gamma 架构与生成链路',focus:'基于来源区分公开事实与架构推断，分析结构化内容、设计和执行链路。',role:'cover',sourceUnitIds:[]}];
 for(const [zh,en,nums,start,end]of CARDS){const ids=nums.map(id),s={sourceUnitIds:ids};const title=pageTopicLanguage(project,s)==='en'?en:zh;
  slides.push({title,focus:zh+'：保留本组来源中的完整定义、关系、条件和推断限定。',role:nums.includes(23)||nums.includes(77)||nums.includes(95)?'workflow':'mechanism',sourceUnitIds:ids,...(start?{sourceArtifactRanges:[{sourceUnitId:id(nums[0]),rowStart:start,rowEnd:end}]}:{})});
 }
 slides.push({title:pageTopicLanguage(project,{})==='en'?'Models decide, software renders':'让模型处理歧义，让软件处理确定性',focus:'归纳已展示的内容编译、职责解耦与来源限定，不增加未经证实的内部实现。',role:'closing',sourceUnitIds:[]});
 return {version:2,slides,selection:items.map(i=>({sourceUnitId:i.id,destination:i.type==='CodeBlock'||i.id===id(98)?'excluded':'slides',reason:i.type==='CodeBlock'?'用户代码展示策略为 omit':i.id===id(98)?'次要链接目录留存于项目原始来源；事实与推断说明在正文保留':'保留完整来源对象和必要条件，不截字'}))};
}
export function gammaModelFixture(){return async(p,prompt,_a,_l,{nodeKey:key}={})=>{
 const outline=gammaFixtureOutline(p);
 if(key.startsWith('input:understand'))return {version:1,subject:'Gamma 架构与生成链路',primaryLanguage:'zh',recommended:outline.slides.length,min:outline.slides.length-2,max:outline.slides.length+2,reason:'受控模拟值：保留全部已选表行、流程、条件与推断边界；不是实时 LLM 的页数建议。',groups:[{question:'输入如何变为可编辑且可验收的文档？',coreMessage:'语义内容、几何设计和异步执行各有职责，未公开实现保留推断限定。',relations:['definition','comparison','sequence','parallel','branch','condition'],sourceUnitIds:p.source.semantic.inventory.items.map(i=>i.id)}]};
 if(key.startsWith('source:graph-audit:'))return {version:1,equivalent:true,missingLabels:[],missingConnections:[],unsupportedConnections:[],reason:'Controlled graph-audit protocol double; deterministic node/edge checks still execute.'};
 if(key.startsWith('planning:topic-title:audit')){const pairs=JSON.parse(prompt.match(/<pairs>(.*?)<\/pairs>/su)[1]);return {version:1,checks:pairs.map(r=>({key:r.key,equivalent:true,targetLanguage:true,reason:'受控测试协议响应'}))};}
 if(key.startsWith('planning:topic-title')){const source=JSON.parse(prompt.match(/<source>(.*?)<\/source>/su)[1]);return {version:1,translations:source.map(r=>({key:r.key,text:'架构与工作流'}))};}
 if(key.startsWith('outline:subject-')){const rows=JSON.parse(prompt.match(/<final_outline_subjects>(.*?)<\/final_outline_subjects>/su)[1]);return {version:1,checks:rows.map(r=>({slideId:r.slideId,status:'aligned',reason:'Controlled semantic audit; no live-model quality claim.',evidenceSourceUnitIds:[...new Set(r.source.map(s=>s.sourceUnitId))]}))};}
 if(key==='outline')return outline;
 if(key.startsWith('review:')){const batch=key.match(/:batch:(\d+)/u);return scopeReview(batch?reviewBatches(p)[Number(batch[1])].project:p);}
 const s=p.outline?.find(s=>key==='content:'+s.id);
 if(s){const plan=p.planning.slidePlan.find(plan=>plan.slideId===s.id),bound=new Set(plan.sourceArtifacts.map(r=>r.sourceUnitId));
  const prose=p.source.semantic.inventory.items.filter(i=>s.sourceUnitIds.includes(i.id)&&!bound.has(i.id));
  return {title:s.title,contentBlocks:[],sourceArtifacts:plan.sourceArtifacts,sourceCommentary:prose.map(i=>({type:'mechanism',text:i.text})),sourceEvidenceIds:[]};
 }
 throw Object.assign(Error('Unregistered gamma simulation stage '+key),{code:'schema_invalid'});
};}

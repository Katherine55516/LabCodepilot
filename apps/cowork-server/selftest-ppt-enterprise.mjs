// Enterprise titles and media (Fable, 2026-11-02; the user: 3200's titles and
// media were not enterprise-grade):
// N1 a template sample icon on a card page becomes a numbered marker;
// N2 a decorated layout (quotes, dated timeline) only for content of its kind;
// N5 the deck title standard, its one retry and the better-title rule;
// N6 a figure page is titled from its caption;
// N7 a title never breaks inside a word.
import assert from 'node:assert/strict';
import {isSampleIcon,numberedMarkers,wordSafeTitle} from './lib/ppt-template-fidelity.mjs';
import {decoratedKind,counterCut} from './lib/ppt-card-pages.mjs';
import {captionLeadTitle} from './lib/ppt-card-outline.mjs';
import {verifiedSampleMarker,verifiedFigurePageMarker} from './lib/ppt-source-numbers.mjs';
import {contrastRatio} from './lib/ppt-template-colors.mjs';
import {removeNativeTitleAlias,stableId} from './lib/ppt/ir.mjs';
import {titleStandardIssues,titleAbbreviations,definesAbbreviation,titleForm} from './lib/ppt-card-title-rules.mjs';
import {deckTitleIssues,titleStandardTask,betterTitles,titleStandardAdvisories,acceptRetitles,acceptStandardTitles} from './lib/ppt-card-retitle.mjs';

// N1: a small template picture below the title band is a sample icon; a protected one, or one in the title band, is not.
const W=12192000,H=6858000,project={templateFidelity:{width:W,height:H},templateSpec:{fonts:{heading:'DM Sans'}}};
const icon=(id,x,y)=>({id,type:'image',geometry:{x,y,width:400000,height:400000},nativeRef:{shapeId:id},content:{}});
const spec={nodes:[icon('a',3000000,3000000),icon('b',1000000,3000000),icon('c',1000000,500000),{...icon('d',5000000,3000000),content:{mustPreserve:true}},
 {id:'s',type:'shape',geometry:{x:900000,y:2900000,width:600000,height:600000},style:{fill:'#1e3a5f'}}]};
assert.deepEqual(spec.nodes.filter(node=>isSampleIcon(project,spec,node)).map(node=>node.id),['a','b']);
assert.equal(isSampleIcon(project,spec,{...icon('h',2000000,3000000),geometry:{x:2000000,y:3000000,width:6082,height:400000}}),false,'a hairline is no icon');
// A repeat layout's rotated icon is still a sample icon; a real replacement is not (live Portfolio, 2026-11-02).
assert.equal(isSampleIcon(project,spec,{...icon('r',2000000,3000000),content:{mediaReplacement:true,iconRotation:true}}),true);
assert.equal(isSampleIcon(project,spec,{...icon('u',2000000,3000000),content:{mediaReplacement:true}}),false);
// The markers number the icons in reading order, at their place, readable on the shape under them.
const markers=numberedMarkers(project,1,spec,{id:'slide_1'},[spec.nodes[0],spec.nodes[1]]);
assert.deepEqual(markers.map(marker=>marker.content.markerFor).sort(),['a','b'],'each marker names the icon it replaces (the media ledger checks it)');
assert.deepEqual(markers.map(marker=>[marker.content.text,marker.geometry.x]),[['1',1000000],['2',3000000]]);
assert.ok(markers.every(marker=>marker.semanticRole==='template-marker'&&marker.style.fontSizePt>=10&&marker.style.fontWeight===700));
// A badge moved above its card is read on the shape where it now sits (live
// Deal-Review p9: digits stayed in the template's old row, one at 1:1): the
// carrier comes from the page's live shapes, not the template's.
{const moved={...spec.nodes[1],geometry:{x:1000000,y:1500000,width:400000,height:400000}},liveBadge={id:'m',type:'shape',geometry:{x:900000,y:1400000,width:600000,height:600000},style:{fill:'#f5f0e6'}};
 const [marker]=numberedMarkers(project,1,spec,{id:'slide_1'},[moved],[liveBadge]);
 assert.equal(marker.geometry.y,1500000,'at the badge');assert.ok(contrastRatio(marker.style.color,'#f5f0e6')>=4.5,'readable on the live badge: '+marker.style.color);}

// The markers are navigation for the number gate when they read 1..n; a gap or another node is checked.
assert.ok(markers.every(marker=>verifiedSampleMarker({nodes:markers},marker)));
assert.ok(!verifiedSampleMarker({nodes:[markers[1]]},markers[1]),'a lone "2" is not a sequence');
assert.ok(!verifiedSampleMarker({nodes:markers},{type:'text',semanticRole:'template-text',content:{text:'1'}}));

// N2: a testimonial layout reads as quotes, a dated layout as a timeline; a plain layout has no kind.
const texts=list=>({nodes:list.map((text,k)=>({id:'t'+k,type:'text',content:{text}}))});
assert.equal(decoratedKind({...texts(['“Great service” — Ana','“Fast and kind” — Bo']),name:'Testimonials'}),'quote');
assert.equal(decoratedKind(texts(['2019 Founded','2021 Series A','2023 Global launch'])),'timeline');
assert.equal(decoratedKind(texts(['Our approach','Three pillars of delivery'])),null);

// N5: the per-title rules.
assert.deepEqual(titleStandardIssues('渲染导出质量门禁','zh'),['no_predicate'],'a verb that modifies a label head is no predicate');
assert.deepEqual(titleStandardIssues('代码统一提取并转化输入来源','zh'),[]);
assert.deepEqual(titleStandardIssues('对比度低则阻断重建','zh'),[]);
assert.deepEqual(titleStandardIssues('页面实例化分支','zh'),['short','no_predicate']);
assert.deepEqual(titleStandardIssues('编辑命令须保持版本一致性','zh'),[],'a modal marks the predicate');
assert.deepEqual(titleStandardIssues('代理转发调用业务接口','zh'),[],'a verb after its subject is a predicate before a noun');
assert.deepEqual(titleStandardIssues('来源表示的逐层转化','zh'),['no_predicate'],'a verb only after 的 heads a noun phrase');
assert.deepEqual(titleStandardIssues('Car Racing Experiment Procedure'),['no_verb']);
assert.deepEqual(titleStandardIssues('Temperature Effects on Transfer Scores'),['no_verb'],'a plural noun is no verb');
assert.deepEqual(titleStandardIssues('A Small Controller Acts on the World Model Features'),[]);
assert.deepEqual(titleStandardIssues('The VAE Compresses Each Frame Into z'),['bare_symbol']);
assert.deepEqual(titleStandardIssues('Agent Model'),['short','no_verb']);
assert.deepEqual(titleStandardIssues('An Eleven Word Title That Simply Keeps Going On And On'),['long']);
assert.deepEqual(titleStandardIssues('Use CMA-ES to Train the Controller'),[],'an imperative has its verb first');
assert.deepEqual(titleStandardIssues('C 端用户需要即时得到答复','zh'),[],'"C 端" is no bare symbol');
assert.deepEqual(titleStandardIssues('JEPAs Predict Embeddings'),[],'a plural subject and a base verb');
assert.deepEqual(titleStandardIssues('I-JEPA Finetuning on ImageNet'),['no_verb'],'a gerund is no predicate');
assert.deepEqual(titleStandardIssues('The Use of Masks'),['no_verb'],'a noun after a determiner is no verb');
assert.deepEqual(titleAbbreviations('I-JEPA and CMA-ES Beat PPT Baselines in Q4'),['I-JEPA','CMA-ES']);
assert.ok(definesAbbreviation('The Model Context Protocol (MCP) connects tools','MCP'));
assert.ok(definesAbbreviation('MCP（模型上下文协议）统一接入','MCP'));
assert.ok(!definesAbbreviation('MCP servers connect tools','MCP'));
assert.deepEqual(['为何分离交互与生成？','结论：分离交互','系统分离交互与生成'].map(title=>titleForm(title,'zh')),['question','colon','statement']);

// N5 on a deck: an undefined abbreviation on its first page only, a minority form in its chapter.
const page=(title,points,section='A',extra={})=>({id:title,title,section,keyPoints:points.map(text=>({text})),...extra});
const deck={slides:[page('World Models',[]),
 page('A Small Controller Acts on Compressed Features',['the controller reads z and h'],'A'),
 page('The MDN-RNN Predicts the Next Latent Vector',['an MDN-RNN predicts the next z'],'A'),
 page('MDN-RNN Samples Let the Agent Dream',['the MDN-RNN samples futures'],'A'),
 page('Why Does Temperature Change Transfer?',['higher temperature makes dreams harder'],'A'),
 page('The Agent Model Has Three Components',['vision, memory and controller'],'B'),
 page('Diagram Labels',[],'B',{figurePage:true}),
 page('Contents',[],'X',{cardFrame:'contents'})]};
const p={inputUnderstanding:{primaryLanguage:'en'},source:{semantic:{inventory:{items:[{id:'u1',text:'a mixture density network (MDN) feeds an RNN'}]}}}};
const issues=deckTitleIssues(p,deck);
assert.deepEqual(issues.get(2),['abbreviation:MDN-RNN']);
assert.equal(issues.get(3),undefined,'an abbreviation is checked on its first page only');
assert.deepEqual(issues.get(4),['form:statement']);
assert.deepEqual(issues.get(6),['short','no_verb'],'a figure page is held to the standard');
assert.equal(issues.has(7),false,'a frame page is not checked');
// A repeated title, or one with a repeat's " · 2", is restated; a split card's parts and the closing page are not.
{const raw={slides:[page('Deck',[]),page('Loss Beats Pixels',['a']),page('Loss Beats Pixels · 2',[],'A',{figurePage:true,titleRepeat:2}),
  page('Masking Guides · 2',[],'A',{figurePage:true,titleRepeat:2}),page('Models Learn Fast · 1/2',['b'],'A',{logicalCardId:'k'}),page('Models Learn Fast · 2/2',['c'],'A',{logicalCardId:'k'}),page('Thanks for watching!',[],'Z',{role:'closing'})]};
 const found=deckTitleIssues({...p,source:{}},raw);
 assert.deepEqual([...found].map(([index,reasons])=>[index,reasons.filter(reason=>reason==='repeat')]).filter(([,r])=>r.length),[[2,['repeat']],[3,['repeat']]],'a figure page numbered as a repeat is restated even when its stem is no other title');
 assert.equal(found.has(6),false,'the closing page is not checked');
 // The repeat's number is navigation for the number gate only as recorded.
 const outline={outline:raw.slides};const titleNode=text=>({type:'text',semanticRole:'template-title',content:{text}});
 assert.ok(verifiedFigurePageMarker(outline,{id:raw.slides[2].id},titleNode('Loss Beats Pixels · 2')));
 assert.equal(verifiedFigurePageMarker(outline,{id:raw.slides[2].id},titleNode('Loss Beats Pixels · 3')),null);}

// One more call lists each missing title with its problems in words.
const items=[{indexes:[2],points:['an MDN-RNN predicts the next z']},{indexes:[4],points:['higher temperature makes dreams harder']},{indexes:[6],figure:true,captions:['Flow diagram of the agent']}];
const task=titleStandardTask(p,deck,items,issues),sent=JSON.parse(task.prompt.slice(task.prompt.indexOf('{"slides"'),task.prompt.indexOf('\nJSON schema=')));
assert.deepEqual(sent.slides.map(slide=>slide.item),[1,2,3]);
assert.match(sent.slides[0].problems[0],/MDN-RNN is not defined/u);
assert.deepEqual(sent.slides[2].figures,['Flow diagram of the agent']);
assert.equal(titleStandardTask(p,deck,items,new Map()),null);
// A rewrite stays only when it has fewer problems; the rest are flagged.
const better=betterTitles(p,deck,new Map([[4,'Higher Temperature Makes Dreams Harder'],[6,'Labels']]),issues);
assert.deepEqual([...better.titles.keys()],[4]);
// One call, up to three candidates: a miscounted first one gives way to the next that passes.
{const picked=acceptStandardTitles(p,deck,items,{titles:[{item:2,titles:['Higher Temperature Makes Every Single Dream Much Harder For The Agent To Exploit Again','Higher Temperature Makes Dreams Harder']},{item:3,titles:['Labels']}]},'',issues);
 assert.deepEqual([...picked.titles],[[4,'Higher Temperature Makes Dreams Harder']]);assert.equal(picked.count,1);}
const fixed={slides:deck.slides.map((slide,index)=>better.titles.has(index)?{...slide,title:better.titles.get(index)}:slide)};
assert.deepEqual(titleStandardAdvisories(p,fixed).map(entry=>entry.pageIndex),[2,6]);

// N5: a title may add a generic verb ("Finds") to state its point; a new noun is still refused.
{const raw={slides:[page('World Models',[]),page('Controller Training',['CMA-ES evolves the controller weights in the dream.'])]},list=[{indexes:[1],points:['CMA-ES evolves the controller weights in the dream.'],headings:[]}];
 const ok=acceptRetitles(p,raw,list,{titles:[{item:1,title:'CMA-ES Finds the Controller Weights'}]});
 assert.equal(ok.titles.get(1),'CMA-ES Finds the Controller Weights',JSON.stringify(ok.refused));
 const no=acceptRetitles(p,raw,list,{titles:[{item:1,title:'CMA-ES Finds Quantum Weights'}]});
 assert.equal(no.refused[0]?.reason,'words:Quantum');}

// N6: the caption's opening clause, without its "Figure 2:" label, titles the page.
assert.equal(captionLeadTitle('Figure 2: Flow diagram of a Variational Autoencoder (VAE). The encoder maps'),'Flow Diagram of a Variational Autoencoder (VAE)');
assert.equal(captionLeadTitle('图 3：世界模型的整体结构示意。其中',true),'世界模型的整体结构示意');
assert.equal(captionLeadTitle('Figure 1. Results'),'','a caption too short to read as a title is not used');

// N7: a Chinese title breaks between words, a Latin word is never split; one that fits stays one line.
const frame=width=>({geometry:{x:0,y:0,width,height:900000},style:{fontSizePt:40,fontFamily:'DM Sans'}});
const broken=wordSafeTitle(frame(3600000),'客户支持知识库试点方案');
assert.ok(broken.includes('\n'),'a long Chinese title is broken');
assert.ok(!/知\n识|试\n点|方\n案/u.test(broken),'not inside a word: '+broken);
assert.ok(!/Code\S*\n\S*Pilot|C\nodePilot/u.test(wordSafeTitle(frame(3600000),'CodePilot PPT 模块')),'a Latin word stays whole');
assert.equal(wordSafeTitle(frame(11000000),'客户支持知识库试点方案'),'客户支持知识库试点方案');
// The Professional-Portfolio cover frame (live 3197: "客户支持知识库试 / 点方案"): ICU misses "知识库" and "试点",
// so a break before a lone character ranks last; a line never starts with closing punctuation.
const cover={geometry:{x:661475,y:3573859,width:5770220,height:1878330},style:{color:'#ffffff',fontFamily:'DM Sans SemiBold',fontSizePt:51}};
assert.equal(wordSafeTitle(cover,'客户支持知识库试点方案'),'客户支持\n知识库试点方案');
assert.equal(wordSafeTitle(cover,'MCP 完整链路图（含分支原因）'),'MCP 完整链路图\n（含分支原因）');
assert.ok(!/\n[，。：；、）)]/u.test(wordSafeTitle({...cover,style:{...cover.style,fontSizePt:40}},'CodePilot PPT 模块：架构 工作流与实现逻辑',3)));
assert.equal(wordSafeTitle(frame(3600000),'An English Title Stays As It Is'),'An English Title Stays As It Is','only CJK titles are re-broken');
// The broken native title still replaces the code title it aliases (live 3197: the cover's title node had no render mapping).
{const alias={id:stableId('node','s1','title'),type:'text',semanticRole:'title',content:{text:'客户支持知识库试点方案'}};
 const native={id:'n',type:'text',semanticRole:'template-title',nativeRef:{shapeId:2},geometry:{x:0,y:0,width:1,height:1},content:{text:'客户支持知识库\n试点方案'}};
 assert.deepEqual(removeNativeTitleAlias('s1',[alias,native]).map(node=>node.id),['n']);}
assert.equal(wordSafeTitle(frame(3600000),'附录 A · 主要业务接口清单与说明 · 1/4'),'附录 A · 主要业务接口清单与说明 · 1/4','a part counter is never re-broken');
// Split cards always show their counter (Fable 2026-11-02): the base is cut at a word boundary to make room.
assert.equal(counterCut('客户支持与知识库试点方案',text=>[...text].length<=7),'客户支持','a Chinese cut before a conjunction, never inside 知识库 or 试点');
assert.equal(counterCut('客户支持知识库试点方案',text=>[...text].length<=7),'','a Chinese cut only at punctuation or a conjunction (Fable 2026-11-02 Q1)');
assert.equal(counterCut('检索增强：知识库试点方案',text=>[...text].length<=7),'检索增强','or before a colon');
// Phrase boundaries only (Fable 2026-11-02 Q1; 3222 portfolio p6-8, deal-review p9).
assert.equal(counterCut('Full World Model Results',text=>text.length<=17),'','a cut never drops the head noun ("Full World")');
assert.equal(counterCut('Full World Model Results and CarRacing-v0 Scores',text=>text.length<=30),'Full World Model Results','a cut before a conjunction');
assert.equal(counterCut('Driving Is More Stable If We Give Our Controller Access',text=>text.length<=40),'Driving Is More Stable','never on a pronoun or a possessive');
// A discourse opener names nothing (3222 mood-board p4 "In This Work, We Build Probabilistic").
assert.equal(counterCut('In This Work, We Build Probabilistic Generative Models of OpenAI Gym Environment',text=>text.length<=40),'','a leading adverbial alone is no cut');
{const {captionLeadTitle}=await import('./lib/ppt-outline-cards.mjs');
 assert.equal(captionLeadTitle('Figure 3. In this work, we build probabilistic generative models of OpenAI Gym environments. The RNN-based models'),'We Build Probabilistic Generative Models of OpenAI Gym Environments');}
assert.equal(counterCut('Iterative Loop Refines Model',text=>text.length<=24),'Iterative Loop','a cut does not end on its verb');
assert.equal(counterCut('Factor Tests on Sorted Size',text=>text.length<=16),'Factor Tests','nor on a preposition');
assert.equal(counterCut('Agent Model',text=>text.length<=4),'','at least two words, else no cut');
// A title not in the deck's language is a title-standard issue, and the last
// resort replaces it from the page's own words, one base per split card (3197 8293a91a).
{const {foreignTitleFallbacks,deckTitleIssues:issuesOf}=await import('./lib/ppt-card-retitle.mjs');
 const zh={generationPolicy:{language:{mode:'output',locale:'zh-CN'}},inputUnderstanding:{primaryLanguage:'en'},planningContract:{},source:{semantic:{inventory:{items:[]}}}};
 const raw={slides:[{id:'c',title:'世界模型'},{id:'a',logicalCardId:'L',title:'Related Work · 1/2',section:'训练流程与讨论',keyPoints:[{text:'早期前馈与循环网络为后续研究奠定基础。'}]},{id:'b',logicalCardId:'L',title:'Related Work · 2/2',section:'训练流程与讨论',keyPoints:[{text:'后续研究不断扩展。'}]},{id:'d',title:'迭代训练改进世界模型',keyPoints:[{text:'x'}]}]};
 assert.ok(issuesOf(zh,raw).get(1)?.includes('language'));assert.ok(!issuesOf(zh,raw).get(3)?.includes('language'));
 assert.deepEqual([...foreignTitleFallbacks(zh,raw)],[[1,'早期前馈与循环网络为后续研究奠定基础 · 1/2'],[2,'早期前馈与循环网络为后续研究奠定基础 · 2/2']]);
 // A figure page takes its figure's short caption; a cover the author named is never refused (3197 85a2621c).
 const figured={...zh,planningContract:{figureCaptions:{f4:'编码器压缩每帧图像'}}};
 const withFigure={slides:[raw.slides[0],{id:'f',title:'The Vision Model Encodes Each Frame',figurePage:true,sourceImageIds:['f4'],keyPoints:[]}]};
 assert.deepEqual([...foreignTitleFallbacks(figured,withFigure)],[[1,'编码器压缩每帧图像']]);
 const {inspectOutlineTopicLanguages}=await import('./lib/ppt-topic-title-validation.mjs');
 const named={...zh,title:'Self-Supervised Learning with I-JEPA',titleSource:'user',deckTitle:{source:'agent'}};
 assert.deepEqual(inspectOutlineTopicLanguages(named,[{id:'c',title:'Self-Supervised Learning with I-JEPA'}]),[],'the author named the deck');}
console.log('PASS enterprise: sample-icon markers, decorated layouts by kind, deck title standard, caption figure titles, word-safe title breaks');

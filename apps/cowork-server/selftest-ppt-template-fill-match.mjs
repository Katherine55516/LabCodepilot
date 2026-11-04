// Fill the template's own pages first (the user, 2026-11-03; Fable's design):
// a written card that is one repeated structure takes the first free template
// page whose profile accepts its kind and block count exactly; blocks over a
// page's text boxes get one shortening call; a card still over, or one no page
// takes, keeps today's page with its reason. Filled pages are never split or
// merged, and a card the author rewrites leaves its page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {writtenCardShape,matchTemplatePages,fillShortenTask,acceptFillShorten,applyTemplateFill,capChars,fillOffer} from './lib/ppt-template-fill-match.mjs';
import {fillOfferRule,stepHeadings,componentCounts} from './lib/ppt-card-blocks.mjs';
import {fillUnits} from './lib/ppt-template-fill-profile.mjs';

const mood=JSON.parse(fs.readFileSync(new URL('./test/fixtures/fill-profiles/mood-board.json',import.meta.url)));
const project=outline=>({templateFidelity:{mode:'preserve',width:mood.width,height:mood.height,sourceCatalog:mood.catalog},generationPolicy:{language:{mode:'output',locale:'zh-CN'}},inputUnderstanding:{primaryLanguage:'en'},planningContract:{flow:'cards'},outline});
const point=(label,text)=>({...(label?{label}:{}),text,sourceUnitIds:['b_1']});
const card=(title,points,extra={})=>({id:title,title,keyPoints:points,visualIntent:{type:'text'},...extra});
// Bodies long enough to fill at least half of each page's text box (the user's 50%, 2026-11-03).
const FILLER='并在整个训练与评估流程中保持稳定可靠的表现以便他人复现实验结论';
const say=(text,n)=>(String(text).replace(/。$/u,'')+'，'+FILLER+FILLER).slice(0,n-1)+'。';
const padded=(item,n)=>({...item,keyPoints:item.keyPoints.map(entry=>({...entry,text:say(entry.text,n)}))});
// Mood-Board: t3 compare-2 (2 figures), t4 steps-4 (stack, lead), t5 cards-4 (lead), t7 cards-3 (3 figures), t8 cards-2 (last page).
const outline=[{id:'c',role:'cover',title:'世界模型',keyPoints:[]},
 padded(card('四个部件',[point('视觉','编码器压缩每帧图像。'),point('记忆','循环网络预测下一状态。'),point('控制','线性控制器输出动作。'),point('训练','进化策略优化参数。')],{lead:'智能体由四部分组成。'}),40),
 padded(card('迭代训练',[point('初始化','初始化模型参数。'),point('收集','在环境中收集数据。'),point('训练','训练世界模型。'),point('迭代','若未完成则返回。')],{numberedPoints:true,visualIntent:{type:'process'}}),30),
 card('五步流程',Array.from({length:5},(_,k)=>point('',`第${'一二三四五'[k]}步执行一项操作。`)),{numberedPoints:true}),
 padded(card('三点结论',[point('压缩','潜在向量保留本质。'),point('预测','网络预测未来。'),point('迁移','策略迁移到现实。')]),23),
 card('另三点',[point('一','其一。'),point('二','其二。'),point('三','其三。')]),
 card('对象页',[point('','一点。'),point('','两点。')],{cardObjects:['b_9']}),
 {id:'z',title:'感谢观看',cardFrame:'closing',keyPoints:[]}];

// The writer is offered the template's own page shapes with their limits.
{const offer=fillOffer(project([]));
 assert.deepEqual(offer.map(entry=>`${entry.kind}-${entry.blocks}`),['compare-2','steps-4','cards-4','cards-3','cards-2']);
 const rule=fillOfferRule(offer,{han:true});
 assert.match(rule,/two named sides compared side by side.*never for aspects/u);assert.match(rule,/4 \(or 3\) numbered steps/u);assert.match(rule,/Never pad, merge or split/u);
 assert.equal(fillOfferRule([]),'');
 const offered=project([]);offered.planningContract={...offered.planningContract,fillOffer:offer};
 assert.deepEqual(componentCounts(offered),[2,3,4],'the writer\'s block counts are the fillable pages\' (Capabilities: 2 and 3, not its 4-5 block pages)');
 const {splitCounts}=await import('./lib/ppt-card-blocks.mjs');
 assert.deepEqual(splitCounts(offered),[2,3,4],'cuts and merges use the template\'s layouts and its fill pages together (3197 0b5a7f1b: 2 + 2 on Capabilities)');
 assert.equal(stepHeadings(offer),true,'Mood t4 has step heading slots: each step gets a short name');assert.equal(stepHeadings([]),false);}

// The shape a written card fills.
assert.deepEqual(writtenCardShape(outline[1]),{kind:'cards',blocks:4,figures:0});
assert.deepEqual(writtenCardShape(outline[2]),{kind:'steps',blocks:4,figures:0});
assert.equal(writtenCardShape(outline[6]),null,'a card with source objects keeps today\'s page');
assert.equal(writtenCardShape(outline[7]),null);

// Matching: first free page in template order, exact, the last page last.
{const p=project(outline),matches=matchTemplatePages(p);
 const page=index=>matches.find(match=>match.index===index)?.profile?.page??null;
 assert.equal(page(1),4,'cards-4 → t5 (never the steps page t4: Fable, the rail claims a sequence)');
 assert.equal(page(2),3,'procedure-4 → t4');
 assert.equal(page(3),null,'a 5-step procedure takes no 4-step page');
 assert.equal(page(4),6,'cards-3 → t7');
 assert.equal(page(5),null,'t7 is taken: the second cards-3 keeps today\'s page');
 assert.ok(matches.filter(match=>match.profile).every(match=>match.fit.ok),JSON.stringify(matches.map(match=>match.fit)));
 const {outline:filled,notes}=applyTemplateFill(p,outline,matches);
 assert.deepEqual(filled[1].templateFill,{page:4,profileId:'fill-4',kind:'cards',blocks:4,figures:0,citedFigures:0,sticky:true,status:'filled'});
 assert.deepEqual(filled[1].fillBlocks[0],{heading:'视觉',body:say('编码器压缩每帧图像。',40)});
 assert.equal(filled[1].fillLead,'智能体由四部分组成。','t5 has a lead holder');
 assert.deepEqual(filled[2].fillBlocks.map(block=>block.heading),['初始化','收集','训练','迭代'],'each step under its heading (heading_missing otherwise)');
 assert.deepEqual(filled[3].templateFill,{page:null,profileId:null,kind:'steps',blocks:5,figures:0,citedFigures:0,sticky:false,status:'fill_fallback',reason:'no_matching_page'},'the reason is recorded');
 assert.equal(filled[6].templateFill,undefined,'an object card is not a fill candidate');
 assert.deepEqual(notes,[]);}

// A page fills several cards (the user, 2026-11-03): up to max(2, floor(N/5)),
// never two cards in a row.
{const three=k=>padded(card('三点'+k,[point('压缩','潜在向量保留本质。'),point('预测','网络预测未来。'),point('迁移','策略迁移到现实。')]),23);
 const four=padded(card('四个部件',[point('视觉','编码器压缩每帧图像。'),point('记忆','循环网络预测下一状态。'),point('控制','线性控制器输出动作。'),point('训练','进化策略优化参数。')]),40);
 const deck=[outline[0],three('甲'),four,three('乙'),three('丙'),{id:'z',title:'感谢观看',cardFrame:'closing',keyPoints:[]}];
 const pages=matchTemplatePages(project(deck)).map(match=>match.profile?.page??null);
 assert.deepEqual(pages,[6,4,6,null],'t7, t5, t7 again; the fourth card is t7\'s third use and follows it: today\'s page');
 const inRow=matchTemplatePages(project([outline[0],three('甲'),three('乙'),{id:'z',title:'感谢观看',cardFrame:'closing',keyPoints:[]}])).map(match=>match.profile?.page??null);
 assert.deepEqual(inRow,[6,null],'never the same page twice in a row');}

// Figures: a filled page with picture slots shows the figures its units name;
// their own figure pages go, so no figure appears twice.
{const p={...project([]),source:{images:[{id:'fig4',caption:'Figure 4. The vision model.'},{id:'fig9',caption:'Figure 9. Another figure.'}],semantic:{inventory:{items:[{id:'b_1',text:'The encoder (Figure 4) compresses frames.'}]}}}};
 const figure=id=>({id:'f_'+id,title:'图',figurePage:true,sourceImageIds:[id],keyPoints:[]});
 const cards3=padded(card('三点结论',[point('压缩','潜在向量保留本质。'),point('预测','网络预测未来。'),point('迁移','策略迁移到现实。')]),23);
 const outline=[{id:'c',role:'cover',title:'世界模型',keyPoints:[]},cards3,figure('fig4'),figure('fig9'),{id:'z',title:'感谢观看',cardFrame:'closing',keyPoints:[]}];
 const matches=matchTemplatePages(p,outline);
 assert.equal(matches[0].profile.page,6,'cards-3 with one figure → t7 (3 slots)');assert.deepEqual(matches[0].figureIds,['fig4']);
 const {outline:filled}=applyTemplateFill(p,outline,matches);
 assert.deepEqual(filled[1].sourceImageIds,['fig4']);assert.equal(filled[1].templateFill.figures,1);assert.equal(filled[1].cardFigureLayout,undefined);
 assert.deepEqual(filled.filter(item=>item.figurePage).map(item=>item.sourceImageIds),[['fig9']],'fig4 left its figure page; fig9 keeps its own');
 // A card naming more figures than any free page holds still takes a page, its figures staying on their pages.
 const four=padded(card('四个部件',[point('视觉','编码器压缩每帧图像。'),point('记忆','循环网络预测下一状态。'),point('控制','线性控制器输出动作。'),point('训练','进化策略优化参数。')]),40);
 const m4=matchTemplatePages(p,[outline[0],four,figure('fig4'),outline[4]]);
 assert.equal(m4[0].profile,null,'t5 has no picture slot: a card citing a figure keeps its page (Fable 2026-11-03)');assert.equal(m4[0].reason,'figures_exceed_slots');
 const {outline:kept}=applyTemplateFill(p,[outline[0],four,figure('fig4'),outline[4]],m4);
 assert.deepEqual([kept[1].templateFill.status,kept[1].templateFill.reason,kept[1].templateFill.citedFigures],['fill_fallback','figures_exceed_slots',1]);
 assert.ok(kept.some(item=>item.figurePage&&item.sourceImageIds[0]==='fig4'),'its figure page stays for pairing');
 // Two compared points fill a compare page only from a two-sided table.
 const two=padded(card('两种模型',[point('V模型','仅用视觉模型时驾驶不稳定。'),point('完整模型','加入记忆模型后驾驶平稳。')],{visualIntent:{type:'comparison'}}),46);
 assert.equal(matchTemplatePages(p,[outline[0],two,outline[4]])[0].shape.kind,'cards','prose is two parallel cards');
 const tabled={...p,source:{...p.source,semantic:{inventory:{items:[{id:'b_1',text:'| MODEL | V ONLY | FULL |\n| --- | --- | --- |\n| Score | 632 | 906 |'}]}}}};
 assert.equal(matchTemplatePages(tabled,[outline[0],two,outline[4]])[0].shape.kind,'cards','a table cited, but neither point states a side\'s values (3197 85a2621c p7)');
 const sides=padded(card('两种模型',[point('V模型','仅用视觉模型时得分为632。'),point('完整模型','加入记忆模型后得分为906。')],{visualIntent:{type:'comparison'}}),46);
 // Each point states its own side, but Mood's compare page has two figure
 // slots and takes exactly that many figures (Fable 2026-11-03): without them
 // the card is two parallel cards, the reason recorded.
 const sided=matchTemplatePages(tabled,[outline[0],sides,outline[4]])[0];
 assert.equal(sided.shape.kind,'cards');assert.ok([sided.reason,sided.note].includes('compare_requires_figures'),JSON.stringify(sided.reason||sided.note));}

// Bare headings never fill a page: today's page, with its reason.
{const bare=card('两面',[point('','梦境训练的优势'),point('','独立VAE的局限')],{visualIntent:{type:'comparison'}});
 const p=project([outline[0],bare]),matches=matchTemplatePages(p);
 assert.equal(matches[0].profile,null);const {outline:kept}=applyTemplateFill(p,p.outline,matches);
 assert.deepEqual([kept[1].templateFill.status,kept[1].templateFill.reason],['fill_fallback','bare_points']);}

// A card that says almost nothing of a long cited unit never fills a page.
{const thin=card('四个部件',[point('视觉','编码器。'),point('记忆','循环网络。'),point('控制','控制器。'),point('训练','进化策略。')]);
 const p={...project([outline[0],thin]),source:{semantic:{inventory:{items:[{id:'b_1',text:'x'.repeat(3000)}]}}}};
 const matches=matchTemplatePages(p);assert.equal(matches[0].reason,'thin_for_sources');}

// A card filling under half of a page's boxes takes no page (the user's 50%; 3197 85a2621c p9).
{const sparse=card('三点结论',[point('压缩','潜在向量保留本质。'),point('预测','网络预测未来。'),point('迁移','策略迁移到现实。')]);
 const matches=matchTemplatePages(project([outline[0],sparse]));assert.equal(matches[0].profile,null);assert.equal(matches[0].reason,'too_sparse');}

// Over a cap: one shortening call; a reply within the caps fills, else today's page.
{const long=card('三点结论',[point('压缩','潜在向量在有损压缩之后仍然保留了每一帧图像中最本质的信息内容并可用于预测'),point('预测',say('网络预测未来。',23)),point('迁移',say('策略迁移到现实。',23))]);
 const p=project([outline[0],long]),matches=matchTemplatePages(p);
 assert.equal(matches[0].fit.reason,'body_over_cap');
 const task=fillShortenTask(p,matches);
 assert.deepEqual(task.cards,[1]);assert.match(task.prompt,/Simplified Chinese/u);
 const limit=JSON.parse(task.prompt.split('\n').at(-1)).cards[0].blocks[0].bodyMaxChars;
 assert.equal(limit,capChars(matches[0].profile.blockSlots[0].body.cap,true));assert.ok(fillUnits('字'.repeat(limit))<=matches[0].profile.blockSlots[0].body.cap);
 const short={cards:[{card:1,lead:'',blocks:[{heading:'压缩',body:'潜在向量保留每帧本质。'},{heading:'预测',body:'网络预测未来。'},{heading:'迁移',body:'策略迁移到现实。'}]}]};
 const accepted=acceptFillShorten(p,matches,short);
 assert.ok(accepted.has(1));
 const {outline:filled}=applyTemplateFill(p,p.outline,matches,accepted);
 assert.equal(filled[1].templateFill.status,'filled');assert.equal(filled[1].keyPoints[0].text,'潜在向量保留每帧本质。','the outline shows what the page shows');
 assert.equal(acceptFillShorten(p,matches,{cards:[{card:1,lead:'',blocks:short.cards[0].blocks.slice(0,2)}]}).size,0,'never fewer blocks');
 // A first reply still over: kept as the attempt; the one retry shows its counts.
 const still={cards:[{card:1,lead:'',blocks:[{heading:'压缩',body:'潜在向量在有损压缩之后仍然保留了每一帧图像中最本质的信息内容'},{heading:'预测',body:'网络预测未来。'},{heading:'迁移',body:'策略迁移到现实。'}]}]};
 const first=acceptFillShorten(p,matches,still);assert.equal(first.size,0);assert.equal(first.attempts.get(1).blocks[0].body,still.cards[0].blocks[0].body);
 const retry=fillShortenTask(p,matches.map(match=>({...match,blocks:first.attempts.get(1).blocks})),{retry:true});
 assert.match(retry.prompt,/still over its limits/u);assert.equal(JSON.parse(retry.prompt.split('\n').at(-1)).cards[0].blocks[0].bodyChars,[...still.cards[0].blocks[0].body].length);
 const english=structuredClone(short);english.cards[0].blocks[0].body='Latent vectors keep the essence.';
 assert.equal(acceptFillShorten(p,matches,english).size,0,'never another language');
 assert.equal(acceptFillShorten(p,matches,english).refused.get(1),'language','the reason is logged');assert.equal(acceptFillShorten(p,matches,{cards:[]}).refused.get(1),'no_reply');
 const {outline:fallback,notes}=applyTemplateFill(p,p.outline,matches,new Map());
 assert.deepEqual([fallback[1].templateFill.status,fallback[1].templateFill.reason],['fill_fallback','writer_cap']);assert.equal(fallback[1].fillBlocks,undefined);
 assert.equal(fallback[1].keyPoints[0].text,long.keyPoints[0].text,'all content kept');assert.ok(notes.some(note=>note.code==='template_fill_fallback'));}

// No pass splits or merges a filled page; an author's rewrite leaves its page.
{const {preflightCardCapacity}=await import('./lib/ppt-card-capacity-preflight.mjs');
 const {applyCardEdits}=await import('./lib/ppt-outline-cards.mjs');
 const p=project(outline),{outline:filled}=applyTemplateFill(p,outline,matchTemplatePages(p));
 const thin={...filled[4],id:'thin',keyPoints:filled[4].keyPoints.slice(0,1),templateFill:undefined};
 const slides=[...filled.slice(0,5),{...thin,logicalCardId:'L'},filled[7]].map(slide=>({...slide,logicalCardId:slide.logicalCardId||'L'}));
 const checked=preflightCardCapacity({...p,outline:slides},{slides},{});
 assert.deepEqual(checked.raw.slides.find(slide=>slide.id==='三点结论').keyPoints.length,3,'a filled page takes no merged point');
 const edit=slide=>({id:slide.id,title:slide.title,points:slide.keyPoints.map(point=>point.text),labels:slide.keyPoints.map(point=>point.label||''),numbered:Boolean(slide.numberedPoints)});
 const edited=edits=>applyCardEdits({...p,outline:filled},edits).slides.find(slide=>slide.id==='四个部件');
 assert.equal(edited(filled.map(edit)).templateFill?.status,'filled','unchanged cards keep their page');
 assert.equal(edited(filled.map((slide,index)=>index===1?{...edit(slide),title:'四个部件组成智能体'}:edit(slide))).templateFill?.status,'filled','a new title keeps the page');
 const rewritten=edited(filled.map((slide,index)=>index===1?{...edit(slide),points:[...edit(slide).points.slice(0,3),'作者改写的一点。']}:edit(slide)));
 assert.equal(rewritten.templateFill,undefined,'a rewritten point leaves the page');assert.equal(rewritten.fillBlocks,undefined);}
// The outline keeps the fill through its normalization (live 3197 2daf3572: the fields were dropped and every page bound as a theme page).
{const {_internals}=await import('./lib/ppt-api.mjs');
 if(_internals.normalizeOutline){const p=project(outline),{outline:filled}=applyTemplateFill(p,outline,matchTemplatePages(p));
  const source={semantic:{inventory:{items:[{id:'b_1',text:'x'}]}},images:[]};
  const kept=_internals.normalizeOutline({slides:filled},filled.length,source);
  const page=kept.find(slide=>slide.title==='四个部件');
  assert.equal(page?.templateFill?.status,'filled',JSON.stringify(page?.templateFill));assert.equal(page.templateFill.page,4);assert.equal(page.fillBlocks.length,4);assert.equal(page.fillLead,'智能体由四部分组成。');}}
// A page the fill reader cannot classify (Mood t6, a layered ring) never takes native points (3197 85a2621c p6).
{const {nativeCardSlots}=await import('./lib/ppt-card-pages.mjs');
 const p={...project([outline[0],outline[1]]),templateFidelity:{mode:'preserve',width:mood.width,height:mood.height,sourceCatalog:mood.catalog,slides:[{...mood.catalog[0],sourceIndex:0},{...mood.catalog[5],sourceIndex:5}],slideMap:[0,5]}};
 assert.equal(nativeCardSlots(p,1,outline[1]),null,'the ring page is a plain frame');}
// A card left with nothing to show leaves the deck; its notes go to a neighbour of its card (3197 57347ca7 p6).
{const {dropEmptyCardPages}=await import('./lib/ppt-card-outline.mjs');
 const raw={slides:[{id:'c',role:'cover'},{id:'a',logicalCardId:'L',title:'方法 · 1/2',keyPoints:[],notePoints:[{text:'| 表 |'}]},{id:'b',logicalCardId:'L',title:'方法 · 2/2',keyPoints:[{text:'一点。'}]},{id:'z',cardFrame:'closing',keyPoints:[]}]};
 const {raw:kept,moved}=dropEmptyCardPages(raw);
 assert.deepEqual(kept.slides.map(slide=>slide.id),['c','b','z']);assert.deepEqual(kept.slides[1].notePoints.map(note=>note.text),['| 表 |']);assert.equal(moved[0].to,'方法 · 2/2');
 // A topic whose pages are all empty keeps its first page, flagged, with every note: never removed.
 const all={slides:[{id:'c',role:'cover'},{id:'a',logicalCardId:'R',title:'相关 · 1/2',keyPoints:[],notePoints:[{text:'x'}]},{id:'b',logicalCardId:'R',title:'相关 · 2/2',keyPoints:[],notePoints:[{text:'y'}]},{id:'z',cardFrame:'closing',keyPoints:[]}]};
 const one=dropEmptyCardPages(all).raw;
 assert.deepEqual(one.slides.map(slide=>slide.id),['c','a','z']);assert.ok(one.slides[1].fallbackEmpty);assert.deepEqual(one.slides[1].notePoints.map(note=>note.text),['x','y']);}
console.log('PASS template fill match: first free exact page in template order, one-way steps→cards, recorded fallbacks, one shortening call within caps, filled pages fixed, author rewrites leave their page');
// A picture slot that would show a cited figure as a thumbnail is not the card's page (Fable Q6 d, live f7f0f000 p4).
{
 const {figuresReadable,FIGURE_MIN_AREA}=await import('./lib/ppt-template-fill-match.mjs');
 const p={templateFidelity:{width:12192000,height:6858000},source:{images:[{id:'wide',width:1600,height:550},{id:'square',width:800,height:800}]}};
 const small={figureSlots:[{geometry:{x:0,y:0,width:Math.round(.29*12192000),height:Math.round(.25*6858000)}}]};
 const large={figureSlots:[{geometry:{x:0,y:0,width:Math.round(.45*12192000),height:Math.round(.55*6858000)}}]};
 assert.equal(figuresReadable(p,small,['wide']),false,'a wide diagram in a 29% slot is a thumbnail');
 assert.equal(figuresReadable(p,large,['wide']),true);
 assert.equal(figuresReadable(p,small,[]),true,'no figure, no test');
 assert.equal(figuresReadable(p,large,['square','wide']),true);
 assert.ok(FIGURE_MIN_AREA>0&&FIGURE_MIN_AREA<.2);
 console.log('PASS figures readable in their picture slots');
}
// A card too short for the page it would fill is lengthened once from its sources (the user, 2026-11-03).
{
 const {fillExtendTask,acceptFillExtend}=await import('./lib/ppt-template-fill-match.mjs');
 const short=[outline[0],card('三点短句',[point('压缩','潜在向量保留本质。'),point('预测','网络预测未来。'),point('迁移','策略迁移到现实。')]),outline.at(-1)];
 const p={...project(short),source:{semantic:{inventory:{items:[{id:'b_1',text:'潜在向量以 32 维保留每帧图像的本质信息，记忆网络据此预测下一时刻的分布，控制器策略可在梦境中训练后迁移到真实环境。'}]}}}};
 const matches=matchTemplatePages(p,short),sparse=matches.find(match=>match.index===1);
 assert.equal(sparse.reason,'too_sparse');assert.ok(sparse.sparse?.profile,'the page it would fill is kept');
 const task=fillExtendTask(p,matches,short);
 assert.deepEqual(task.cards,[1]);assert.match(task.prompt,/source/u);assert.match(task.prompt,/Never pad/u);
 const asked=JSON.parse(task.prompt.slice(task.prompt.lastIndexOf('\n{')+1));
 const long=asked.cards[0].points.map(entry=>'甲'.repeat(entry.minChars+1)+'。');
 const ok=acceptFillExtend(p,matches,{cards:[{card:1,points:long}]},short);
 assert.deepEqual(ok.taken,[1]);assert.equal(ok.outline[1].keyPoints[0].text,long[0]);
 assert.equal(matchTemplatePages(p,ok.outline).find(match=>match.index===1).profile?.page,sparse.sparse.profile.page,'matched again, it fills the page');
 const invented=acceptFillExtend(p,matches,{cards:[{card:1,points:long.map((text,k)=>k?text:text.replace('甲','99 个'))}]},short);
 assert.equal(invented.refused.get(1),'numbers','a number the sources do not state is refused');
 const sourced=acceptFillExtend(p,matches,{cards:[{card:1,points:long.map((text,k)=>k?text:'潜在向量以 32 维'+text)}]},short);
 assert.deepEqual(sourced.taken,[1],'a number its cited unit states is kept');
 assert.equal(acceptFillExtend(p,matches,{cards:[{card:1,points:['短。','短。','短。']}]},short).refused.get(1),'still_short');
 console.log('PASS too-short cards lengthened once from their sources, then matched again');
}

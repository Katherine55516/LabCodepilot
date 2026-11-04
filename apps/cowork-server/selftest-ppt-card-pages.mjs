// Option D card pages (ppt-card-pages.mjs) and the D-4 card text rules
// (labels from a point's own words, per-language length budgets).
import assert from 'node:assert/strict';
import {pointLines,cardShape,themeComponents,keyNumber,deterministicCoverDraft,fitObjectPage,objectContinuation,cardObjectPageDraft,objectPageScore,fitThemePage} from './lib/ppt-card-pages.mjs';
import {labelProblem,pointBudgetRatio,cardTitleBudget,POINT_BUDGET} from './lib/ppt-outline-cards.mjs';

// A bilingual point is two lines, primary language first; one language stays as written.
assert.equal(pointLines('Clean, point-in-time fields first | 先用干净、时点正确的字段','en'),'Clean, point-in-time fields first\n先用干净、时点正确的字段');
assert.equal(pointLines('Clean fields first | 先用干净的字段','zh'),'先用干净的字段\nClean fields first');
assert.equal(pointLines('Search is cheap, validation is everything.','en'),'Search is cheap, validation is everything.');

// The component follows the card: steps, a statement, a labelled grid, or points.
const card=(points,extra={})=>({keyPoints:points.map(p=>typeof p==='string'?{text:p}:p),cardObjects:[],...extra});
assert.equal(cardShape(card(['a','b','c'],{numberedPoints:true})),'steps');
assert.equal(cardShape(card(['One strong statement.'])),'statement');
assert.equal(cardShape(card([{text:'Source, frequency, lag',label:'Data dictionary'},{text:'Broad, stable fields',label:'Good fields'}])),'grid');
assert.equal(cardShape(card([{text:'Source, frequency, lag',label:'Data dictionary'},{text:'Broad, stable fields'}])),'points','a grid needs every point labelled');
// Emphasis (④): two compared points side by side; measured numbers as large tiles.
assert.equal(cardShape(card(['Formulaic alphas are transparent','Machine-learned alphas are opaque'],{visualIntent:{type:'comparison'}})),'compare');
assert.equal(cardShape(card(['Average IC of 0.05','Turnover near 30%','2,000 candidates a day'])),'kpi');
// Seven scores stay one page of tiles (Fable M2, 2026-11-02); nine do not.
assert.equal(cardShape(card(['DQN scores 343','A3C scores 591','A3C discrete 652','Gym leader 838','V alone 632','V with hidden 788','Full model 906'])),'kpi');
assert.notEqual(cardShape(card(Array.from({length:9},(_,k)=>`Run ${k+1} scores ${300+k}`))),'kpi');
// A tile's number never breaks (live Mood-Board: "4,348,547" became "4,348,5 / 47"): fewer columns instead.
{const {diagramCardPlan,DIAGRAM_VERSION}=await import('./lib/ppt-diagram-cards.mjs'),IN=914400;
 const tiles={diagram:{version:DIAGRAM_VERSION,kind:'kpi'},items:['4,348,547','422,368','867','343','591'].map(heading=>({heading,body:'A model or a score'}))};
 assert.equal(diagramCardPlan(tiles,{width:7.5*IN,height:3*IN},14).columns,3,'three columns keep each number whole');
 assert.equal(diagramCardPlan(tiles,{width:4.5*IN,height:3*IN},14).overflow,true,'too narrow for whole numbers: another frame');}
assert.equal(cardShape(card(['Average IC of 0.05','Turnover is moderate'])),'points','every point needs its number');
assert.equal(cardShape(card(['Step 2 of 5','Tutorial 10 in 2019'])),'points','list and section numbers and years are not measures');
{const [tiles]=themeComponents({inputUnderstanding:{primaryLanguage:'en'}},card(['Average IC of 0.05','Turnover near 30%']));
 assert.equal(tiles.content.diagram.kind,'kpi');assert.deepEqual(tiles.content.items.map(item=>item.heading),['0.05','30%']);assert.equal(tiles.content.items[0].body,'Average IC of 0.05','the point keeps its full text');}
assert.equal(keyNumber('Sharpe 1.8× the baseline'),'1.8×');assert.equal(keyNumber('Year 2019 data'),'');
assert.equal(cardShape(card([])),null);
// Inline math and code ride in the items' rich fields (Fable 2026-11-02): a
// labelled grid, numbered steps and code keep their component; tiles stay plain.
assert.equal(cardShape(card([{text:'Field library $\\mathcal{F}$',label:'Fields'},{text:'Operators',label:'Operators'}])),'grid');
assert.equal(cardShape(card(['Compute $IC_t$','Rank'],{numberedPoints:true})),'steps');assert.equal(cardShape(card(['Only $R^2$ matters'])),'statement');
assert.equal(cardShape(card([{text:'Ops: `ts_mean(x, n)`',label:'Time series'},{text:'Ranks',label:'Cross-section'}])),'grid','inline code too');
{const [grid]=themeComponents({inputUnderstanding:{primaryLanguage:'en'}},card([{text:'Field library $\\mathcal{F}$',label:'Fields'},{text:'Operators',label:'Operators'}]));
 assert.ok(grid.content.items[0].bodyRich?.runs.some(run=>run.kind==='math'),'the grid item carries its formula as rich text');
 assert.equal(grid.content.items[1].bodyRich,undefined,'plain items stay plain');}
assert.notEqual(cardShape(card(['Ratio $x$ of 0.05','Turnover near 30%'])),'kpi','a formula is no tile number');
const project={inputUnderstanding:{primaryLanguage:'en'}};
const steps=themeComponents(project,card(['Generate | 生成','Mask | 掩码'],{numberedPoints:true}));
assert.equal(steps.length,1);assert.equal(steps[0].type,'timeline');assert.equal(steps[0].content.processCardsEnabled,true);assert.equal(steps[0].content.items[0].text,'Generate\n生成');
const grid=themeComponents(project,card([{text:'Source, frequency, lag',label:'Data dictionary'},{text:'Broad, stable fields',label:'Good fields'}]));
assert.equal(grid[0].content.diagram.kind,'card-grid');assert.deepEqual(grid[0].content.items.map(i=>i.heading),['Data Dictionary','Good Fields'],'labels in Title Case (Fable review r16)');
const statement=themeComponents(project,card(['One strong statement.']));
assert.equal(statement[0].type,'text');assert.ok(statement[0].fontSizePt>18,'a statement reads larger than body copy');
assert.equal(themeComponents(project,card(['a','b','c'])).length,3,'plain points are one measured text each');
// A sub/superscript is rich text too (Codex, JEPA "g~φ~"): grid items carry
// bodyRich, so the export verifier compares the rendered text, not the markup.
{const [sub]=themeComponents(project,card([{text:'Water is H~2~O.',label:'Water'},{text:'Energy is E = mc^2^.',label:'Energy'}]));
 assert.ok(sub.content.items.every(item=>item.bodyRich?.runs?.some(run=>Number(run.baseline||0)!==0)),'sub- and superscripts make bodyRich');}
// Uploaded templates (Fable P3, 2026-11-02): three to six unlabelled parallel
// points are numbered body-only cards; never beside a figure; a "process" card
// the writer did not number is parallel (no steps, no rail); numbered steps keep the rail.
{const kept={...project,templateFidelity:{mode:'preserve'}},four=['Dreams avoid rendering costs','A standalone VAE encodes noise','The LSTM forgets','Bigger models may help'];
 const [cards]=themeComponents(kept,card(four,{visualIntent:{type:'process'}}));
 assert.equal(cards.content.diagram.kind,'card-grid');assert.equal(cards.content.bodyOnly,true);assert.deepEqual(cards.content.markers,['1','2','3','4']);assert.ok(cards.content.items.every(item=>item.heading===''));
 assert.equal(themeComponents(kept,card(four,{visualIntent:{type:'process'},sourceImageIds:['img'],cardFigureLayout:true})).every(c=>c.type==='text'),true,'beside a figure: points, never steps');
 assert.equal(themeComponents(kept,card(four.slice(0,2))).length,2,'two points stay text');
 assert.equal(themeComponents(kept,card(four,{cardShapeOverride:'points'})).length,4,'a chosen points shape stays text');
 const numbered=themeComponents(kept,card(four,{numberedPoints:true}))[0];assert.equal(numbered.type,'timeline');assert.equal(numbered.content.rail,true);
 assert.equal(themeComponents(project,card(four,{visualIntent:{type:'process'}}))[0].type,'timeline','built-in templates keep their step cards');
 // A procedure the writer did not number: three or more consecutive points
 // citing one source ProcessBlock are steps on the rail, the rest text (live
 // Deal-Review p10); a written "name：number" row citing a table joins the tile row (p6).
 {const inventory={source:{semantic:{inventory:{items:[{id:'proc',type:'ProcessBlock'},{id:'tab',type:'TableBlock',rows:[['Model','Parameters'],['VAE','4,348,547'],['MDN-RNN','422,368'],['Controller','867']]},{id:'def',type:'DefinitionBlock'}]}}}},cite=(text,id)=>({text,sourceUnitIds:[id]});
  const mixed=themeComponents({...kept,...inventory},card([cite('Initialize M and C.','proc'),cite('Roll out N times.','proc'),cite('Train M and C.','proc'),cite('Go back to step 2.','proc'),cite('Flip the sign of the loss to explore.','def')],{visualIntent:{type:'process'}}));
  assert.deepEqual(mixed.map(c=>c.type),['timeline','text']);
  // The source's step order wins over the writer's (Fable).
  const ordered={source:{semantic:{inventory:{items:[{id:'proc',type:'ProcessBlock',text:'1. Initialize M and C. 2. Roll out N times. 3. Train M and C.'}]}}}};
  assert.deepEqual(themeComponents({...kept,...ordered},card([cite('Train M and C.','proc'),cite('Initialize M and C.','proc'),cite('Roll out N times.','proc')],{visualIntent:{type:'process'}}))[0].content.items.map(item=>item.text),['Initialize M and C.','Roll out N times.','Train M and C.']);
  // One point joining the steps with ";" is those steps, in the source's order (Fable, live Mood-Board p7).
  const joined=themeComponents({...kept,...ordered},card([cite('Roll out N times; initialize M and C; train M and C.','proc')]));
  assert.equal(joined[0].type,'timeline');assert.deepEqual(joined[0].content.items.map(item=>item.text),['Initialize M and C.','Roll out N times.','Train M and C.']);
  assert.equal(themeComponents({...kept,...ordered},card([cite('One idea; another idea.','proc')]))[0].type,'text','two clauses stay a statement');
  const listed={source:{semantic:{inventory:{items:[{id:'list',type:'TaxonomyBlock',text:'1. Collect rollouts.\n2. Train V.\n3. Train M.'}]}}}};
  assert.equal(themeComponents({...kept,...listed},card([cite('Collect rollouts; train V; train M.','list')]))[0].type,'timeline','an ordered source list is a procedure');
  // A number that matches no cell of the cited table stays a point.
  assert.ok(themeComponents({...kept,...inventory},card([cite('VAE：4,348,547','tab'),cite('MDN-RNN：999','tab'),cite('Note：12','tab'),cite('The full model scores best.','def')])).every(c=>c.content?.diagram?.kind!=='kpi'),'only one row matches: no tile row');assert.equal(mixed[0].content.rail,true);assert.equal(mixed[0].content.items.length,4);
  assert.equal(themeComponents({...kept,...inventory},card([cite('A.','def'),cite('B.','def'),cite('C.','def')],{visualIntent:{type:'process'}}))[0].content.bodyOnly,true,'no procedure: marker cards');
  const counts=themeComponents({...kept,...inventory},card([cite('VAE：4,348,547','tab'),cite('MDN-RNN：422,368','tab'),cite('CONTROLLER：867','tab'),cite('The full model scores best over 100 trials.','def')]));
  assert.equal(counts.at(-1).content.diagram.kind,'kpi');assert.equal(counts.at(-1).content.items.length,3);}
 // A balanced grid, never one-line strips (live Mood-Board p2).
 const {diagramCardPlan}=await import('./lib/ppt-diagram-cards.mjs'),EMU=914400;
 {const five=diagramCardPlan({...cards.content,items:Array.from({length:5},(_,k)=>({heading:'',body:'A short parallel point number '+k})),markers:['1','2','3','4','5']},{width:11.9*EMU,height:3.5*EMU},14);
  assert.ok(five.boxes[3].x>0.1&&Math.abs(five.boxes[3].x-(1-five.boxes[4].x-five.boxes[4].w))<.01,'the second row of 3 + 2 is centred');}
 for(const [n,columns] of [[3,3],[4,2],[5,3],[6,3]])assert.equal(diagramCardPlan({...cards.content,items:Array.from({length:n},(_,k)=>({heading:'',body:'A short parallel point number '+k})),markers:Array.from({length:n},(_,k)=>String(k+1))},{width:11.9*EMU,height:3.5*EMU},14).columns,columns,n+' cards');}

// A label is taken from its own point (light plural stems), at most five words.
assert.equal(labelProblem('Data dictionary','Data dictionary: source, frequency, lag'),null);
assert.equal(labelProblem('Good fields','Good field: broad and stable'),null);
// A glossary label takes its words from the cited row, not its point (Fable Q2, live 04e04491 p12).
assert.match(labelProblem('MCP','即模型上下文协议'),/not in its point/u);
assert.equal(labelProblem('MCP','即模型上下文协议','| MCP | Model Context Protocol，模型上下文协议。 |'),null);
assert.match(labelProblem('Foo','即模型上下文协议','| MCP | 模型上下文协议 |'),/not in its point/u,'an unsourced label is still dropped');
assert.equal(labelProblem('','anything'),null,'no label is allowed');
assert.match(labelProblem('Field hygiene','Clean, point-in-time fields first'),/hygiene/u);
// A label from a clause that denies it says the opposite of its point (the user, 2026-11-01, MCP xlsx).
assert.match(labelProblem('无限授权','用户提出目标并授权，但意图不是任意外部操作的无限授权。'),/negated/u);
assert.match(labelProblem('资源内容','URI用于定位资源，不是资源内容本身。'),/negated/u);
assert.equal(labelProblem('连接应用与服务','它连接应用与服务，不替代模型、业务API或数据库。'),null,'a negation after the label does not count');
assert.match(labelProblem('Step 4','Turnover, costs and capacity'),/4/u,'a number the point does not have is not a label');
assert.match(labelProblem('one two three four five six','one two three four five six seven'),/5 words/u);
// A label names the subject, never the point's opening words running into it (Fable review, alpha-r9).
assert.match(labelProblem('GP represents formulas','GP represents formulas as expression trees'),/opening words/u);
assert.equal(labelProblem('Data dictionary','Data dictionary: source, frequency, lag'),null,'a heading before a colon names the point');
assert.match(labelProblem('Expression trees','GP represents formulas as expression trees'),/lifted from inside/u,'a phrase lifted from inside its point (Fable review r16)');
assert.equal(labelProblem('Formula trees','GP represents formulas as expression trees'),null,'own words, not one lifted phrase');
assert.match(labelProblem('数据字典','数据字典定义了来源和频率'),/opening words/u);assert.equal(labelProblem('数据字典','数据字典：来源、频率'),null);
assert.match(labelProblem('IC decay','IC decay'),/most of its point/u);
assert.equal(labelProblem('数据字典','数据字典：来源、频率、滞后'),null);

// Budgets are per language: an English half of 90 characters is exactly at budget.
assert.equal(pointBudgetRatio('x'.repeat(POINT_BUDGET.latin)),1);
assert.equal(pointBudgetRatio('x'.repeat(45)+' | '+'字'.repeat(POINT_BUDGET.han)),1);
assert.ok(pointBudgetRatio('x'.repeat(45)+' | '+'字'.repeat(60))>1.3,'a long Chinese half is over budget even when the English half is short');
// Without a template the title budget falls back to 60 characters.
assert.equal(cardTitleBudget({inputUnderstanding:{primaryLanguage:'en'}}),60);
// A cover headline that replaced a long title keeps the full title beneath it (Fable).
{const frame={wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}},node=(id,shapeId,size)=>({id,type:'text',nativeRef:{shapeId,contractVersion:2},nativeTextFrame:frame,geometry:{x:0,y:0,width:6200000,height:800000},style:{fontSizePt:size,fontFamily:'Arial',lineHeight:1},content:{text:'x'}});
 const spec={slots:[{role:'title',shapeId:5,maxLines:1,lineVisualUnits:9,fontSizePt:44.5},{role:'content',shapeId:6,maxLines:2,lineVisualUnits:60,fontSizePt:18}],nodes:[node('t',5,44.5),node('b',6,18)]};
 const cover=deterministicCoverDraft({templateFidelity:{slides:[spec]},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},source:{text:'# Machine Learning for Quantitative Finance\n\nBody.'}},{title:'Machine Learning',description:'Machine Learning for Quantitative Finance',section:'Overview'});
 assert.equal(cover.slotTexts['5'],'Machine Learning');assert.equal(cover.slotTexts['6'],'Machine Learning for Quantitative Finance','the full title is printed beneath');}
// An object card page fits by measurement (Fable, 2026-10-23; mlq-r2 page 3, fz-r2 page 2):
// the points that fit stay as one explanation, the rest continue; objects too tall split.
{const IN=914400,frame=h=>({slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:60},{role:'content',shapeId:10}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},geometry:{x:.6*IN,y:.3*IN,width:11.9*IN,height:.8*IN},style:{fontSizePt:28}},{id:'c',type:'text',nativeRef:{shapeId:10,contractVersion:2},geometry:{x:.6*IN,y:1.4*IN,width:11.9*IN,height:h*IN},style:{fontSizePt:14}}]});
 const point=k=>({text:`Out-of-sample R squared of half a percent on monthly returns is genuinely good for point ${k} | 月度收益的样本外 R 平方达到千分之五已经很好，第 ${k} 点`,sourceUnitIds:['eq']});
 const rows=[['Factor','Definition','Horizon'],...Array.from({length:6},(_,k)=>[`Factor ${k+1}`,'A long definition of this factor that wraps over two or three lines in a narrow column of the table so that each row is tall enough to matter for the measurement '.repeat(2),`${k+1} months`])];
 const items=[{id:'eq',type:'EquationBlock',text:'R^2_{oos} = 1 - \\sum (r - \\hat r)^2 / \\sum r^2',source_ref:['s1'],chunkRefs:['c1']},{id:'tb',type:'TableBlock',text:rows.map(r=>r.join(' | ')).join('\n'),rows,source_ref:['s2'],chunkRefs:['c2']}];
 const make=(h,objects,n)=>{const page={id:'page_obj',title:'Signal to noise',section:'Evaluation',cardObjects:objects,keyPoints:Array.from({length:n},(_,k)=>point(k+1)),sourceUnitIds:objects};
  return{page,project:{templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[frame(h),frame(h)]},source:{text:'',semantic:{inventory:{items,relationships:[]}}},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'source',body:'both'}},outline:[{id:'cover',title:'Cover'},page],planning:{slidePlan:[{slideId:'page_obj',sourceArtifacts:objects.map(sourceUnitId=>({sourceUnitId}))}]}}};};
 // Every point fits beside the formula: one explanation entry (padding is paid once).
 {const {project,page}=make(4.91,['eq'],5);assert.equal(fitObjectPage(project,1,page).kept,5);assert.ok(objectPageScore(project,1,page)<=200,'a page that fits costs only its media terms (no template picture here)');
  const draft=cardObjectPageDraft(project,1,page);assert.equal(draft.sourceCommentary.length,1,'one entry for all points');assert.equal(draft.sourceCommentary[0].text.split('\n').length,10,'two lines per bilingual point');}
 // A short frame keeps the points that fit; the page continues by code, never cut.
 {const {project,page}=make(2.6,['eq'],8),kept=fitObjectPage(project,1,page).kept;assert.ok(kept>0&&kept<8);assert.deepEqual(objectContinuation(project,1),{kept});
  assert.throws(()=>cardObjectPageDraft(project,1,page),error=>error.code==='capacity_invalid'&&/source_artifact_capacity/.test(error.message));assert.ok(objectPageScore(project,1,page)>0);}
 // Planning uses the same combined object/commentary fit, then remeasures children.
 {const {preflightCardCapacity,cardCapacityHint}=await import('./lib/ppt-card-capacity-preflight.mjs');
  const {project,page}=make(2.6,['eq'],8);const raw={slides:project.outline};
  assert.ok(cardCapacityHint(project,1),'an object that fits alone must not hide overflowing commentary');
  const schedule=p=>{p.templateFidelity.slides=p.outline.map(()=>frame(2.6));};
  const checked=preflightCardCapacity(project,raw,{schedule});
  assert.ok(checked.changes.length);assert.deepEqual(checked.unresolved,[]);
  assert.deepEqual(checked.raw.slides.slice(1).flatMap(s=>s.keyPoints),page.keyPoints,'no point is dropped, rewritten, or reordered');
  assert.equal(preflightCardCapacity(project,checked.raw,{schedule}).changes.length,0,'stable measured plan');
 }
 // A sparse object page grows its explanation to 16/15 pt; the object keeps the page font (Fable plan T16, fz p9/p16/p22).
 {const made=make(4.91,['eq'],2),project={...made.project,planningContract:{version:3,flow:'cards'}},page=made.page,fitted=fitObjectPage(project,1,page);
  const explanation=fitted.fit.measurements.filter(m=>m.fontBasis==='explanation_growth');
  assert.ok(explanation.length&&explanation.every(m=>[16,15].includes(m.fontSizePt)),JSON.stringify(fitted.fit.measurements.map(m=>[m.fontSizePt,m.fontBasis])));
  assert.ok(fitted.fit.measurements.some(m=>!m.fontBasis),'the formula keeps the page font');}
 // A continuation never holds a single point (Fable r19 D, fz-r19 p12): 13/12 pt keeps them all, else two move on.
 {let laddered=0,moved=0;
  for(let h=1.6;h<=4.9;h+=.05){const {project,page}=make(h,['eq'],5),fitted=fitObjectPage(project,1,page);if(!fitted)continue;
   assert.notEqual(fitted.kept,4,`never one point left at ${h.toFixed(2)} in`);
   if(fitted.kept===5&&fitted.commentary.some(entry=>entry.fontSizePt)){laddered++;assert.ok(fitted.fit.measurements.some(m=>m.fontBasis==='continuation_font_ladder'&&[13,12].includes(m.fontSizePt)),'measured and styled at the ladder size');}
   const draftable=fitted.kept===5;if(draftable)assert.deepEqual(cardObjectPageDraft(project,1,page).sourceCommentary,fitted.commentary,'the draft binds at the fitted font');}
  assert.ok(laddered>0,'the 13/12 pt ladder keeps every point on some frame');}
 // A row taller than every frame at the body font: the whole table steps down to 13 or 12 pt (Fable review r16, live mlq-r16 p49).
 {const {planTableFonts}=await import('./lib/ppt-card-pages.mjs');const {project,page}=make(.75,['tb'],0);project.outline[1]={...page,cardObjects:['tb']};
  planTableFonts(project);const font=project.tableTypography?.tb?.fontPt;
  if(font){assert.ok([13,12,11].includes(font));assert.ok(objectsFitPage(project,1,{...page,id:'other_obj'})||objectContinuation(project,1,page,{planned:false}),'the table now fits or splits by rows');}
  else assert.ok(!project.tableTypography?.tb,'no font is recorded when no size helps');}
 // A stage that lacks the plan derives the same font where it measures (live mlq-r17: generation measured at 14 pt).
 {const {planTableFonts}=await import('./lib/ppt-card-pages.mjs');const planned=make(.75,['tb'],0),later=make(.75,['tb'],0);
  for(const made of [planned,later])made.project.outline[1]={...made.page,cardObjects:['tb']};
  planTableFonts(planned.project);fitObjectPage(later.project,1,later.project.outline[1]);
  assert.deepEqual(later.project.tableTypography?.tb,planned.project.tableTypography?.tb);
  const fits=make(4.91,['tb'],0);fits.project.outline[1]={...fits.page,cardObjects:['tb']};planTableFonts(fits.project);
  assert.equal(fits.project.tableTypography?.tb?.fontPt,0,'a table that fits at the body font is recorded once');}
 // A table that reads whole on one page only at 11 pt is set at 11 pt and never split
 // (the user and Fable, 2026-10-25: fz b_0016 split over two pages at 14/13/12 pt).
 {const {planTableFonts,TABLE_FONT_FLOOR_PT}=await import('./lib/ppt-card-pages.mjs');let found=null;
  const {composeSourcePage}=await import('./lib/ppt-source-artifacts.mjs');
  const whole=(made,fontPt)=>{made.project.tableTypography={tb:{fontPt}};const fit=composeSourcePage(made.project,made.page.id,[{sourceUnitId:'tb',rowStart:1,rowEnd:7}],1,[],[],{planned:false}).fit.capacity_ok;delete made.project.tableTypography;return fit;};
  for(let h=1.5;h<=8&&!found;h+=.05){const made=make(h,['tb'],0);made.project.outline[1]={...made.page,cardObjects:['tb']};
   if(whole(made,TABLE_FONT_FLOOR_PT)&&!whole(made,12)){planTableFonts(made.project);found=made;}}
  assert.ok(found,'some frame height holds the table whole only at 11 pt');
  assert.equal(found.project.tableTypography.tb.reason,'one page at the smallest readable size');
  const continued=objectContinuation(found.project,1,found.project.outline[1],{planned:false});assert.ok(!continued?.ranges,'the table is not split: '+JSON.stringify(continued));}
 // The render audit refuses a table below 11 pt and accepts 11 pt.
 {const {renderIssues}=await import('./lib/ppt/render-audit.mjs');
  const tree=pt=>({schemaVersion:3,units:'emu',size:{width:12192000,height:6858000},slides:[{id:'r',slideId:'s',index:0,size:{width:12192000,height:6858000},elements:[{id:'t',nodeId:'t',kind:'table',bounds:{x:500000,y:500000,width:9000000,height:3000000},content:{rows:[['A','B'],['1','2']]},style:{fontSizePt:pt},zIndex:1}]}]});
  const small=issues=>issues.some(issue=>issue.code==='minimum_font_size'&&/表格/u.test(issue.message));
  assert.ok(small(renderIssues(tree(10))));assert.ok(!small(renderIssues(tree(11))));}
 // A row taller than this frame is its own range when another template frame of the deck holds it (live mlq-r12 p44).
 {const {project,page}=make(.75,['tb'],0);
  assert.equal(objectContinuation(project,1,page,{planned:false}),null,'no frame holds a row: no split');
  project.templateFidelity.slides.push({...frame(4.91),sourceIndex:9,variantId:'tall'});project.outline.push({id:'other'});
  // Ranges are planned on the deck's tall frame, where scheduling places them (Fable plan T24): fewer pages than one row each.
  const hint=objectContinuation(project,1,page,{planned:false});assert.ok(hint?.ranges?.length>1&&hint.ranges.length<6&&hint.ranges.every(range=>range.rowEnd>range.rowStart),'ranges on the tall frame: '+JSON.stringify(hint));
  const {objectPageScore}=await import('./lib/ppt-card-pages.mjs');project.outline[1]={...page,sourceArtifactRanges:[hint.ranges[0]]};assert.ok(objectPageScore(project,1,project.outline[1])>=1e9,'a range on the short frame costs more than any overflow');}
 // A table taller than the frame: measured row ranges with the header repeated, each one fitting.
 {const {project,page}=make(4.91,['tb'],0),hint=objectContinuation(project,1);assert.equal(fitObjectPage(project,1,page),null);
  assert.ok(hint.ranges.length>1&&hint.ranges[0].rowStart===1&&hint.ranges.at(-1).rowEnd===7,'every row, in order: '+JSON.stringify(hint));
  for(let k=1;k<hint.ranges.length;k++)assert.equal(hint.ranges[k].rowStart,hint.ranges[k-1].rowEnd);
  // The fewest pages, rows spread evenly (live mlq-r38: 90%-fill stops made 3 pages of a 2-page table).
  const {composeSourcePage}=await import('./lib/ppt-source-artifacts.mjs'),fits=(a,b)=>composeSourcePage(project,page.id,[{sourceUnitId:'tb',rowStart:a,rowEnd:b}],1,[],[],{planned:false}).fit.capacity_ok;
  let fewest=0;for(let at=1;at<7;fewest++){let stop=at+1;while(stop<7&&fits(at,stop+1))stop++;at=stop;}
  assert.equal(hint.ranges.length,fewest,'no more pages than the fewest: '+JSON.stringify(hint));
  const sizes=hint.ranges.map(r=>r.rowEnd-r.rowStart);assert.ok(Math.max(...sizes)-Math.min(...sizes)<=1,'rows spread evenly: '+sizes);
  // The font's frame is recorded by template identity, so a later schedule plans on the same frame.
  assert.equal(project.tableTypography?.tb?.frameKey,undefined,'no identity without a template source page');
  project.templateFidelity.slides.forEach((spec,k)=>{spec.sourceIndex=k;spec.variantId='original';});delete project.tableTypography;
  const again=objectContinuation(project,1);assert.match(String(project.tableTypography?.tb?.frameKey||''),/^\d+:original$/u,'frame identity recorded: '+JSON.stringify(project.tableTypography?.tb));
  assert.deepEqual(again.ranges,hint.ranges,'the same ranges on the recorded frame');}
 // Two objects that do not fit together: one per page.
 {const {project}=make(4.91,['eq','tb'],3);assert.deepEqual(objectContinuation(project,1),{groups:[['eq'],['tb']]});}}
// A native layout reads as the card only with one slot purpose and size, in
// reading order, and no chart of the template's own to remove (Fable review,
// alpha-r9 page 13); a static numeral leaves with its step (page 7).
{const {_cardPageInternals}=await import('./lib/ppt-card-pages.mjs'),{_cardLayoutInternals}=await import('./lib/ppt-outline-cards.mjs');
 const IN=914400,box=(x,y,w=6,h=.4)=>({x:x*IN,y:y*IN,width:w*IN,height:h*IN});
 const make=({purposes=['body','body','body'],sizes=[14,14,14],at=[[1,2],[1,3],[1,4]],media=null}={})=>({
  slots:[0,1,2].map(k=>({role:'content',shapeId:10+k,purpose:purposes[k],fontSizePt:sizes[k]})),
  nodes:[...[0,1,2].map(k=>({id:'n'+k,type:'text',nativeRef:{shapeId:10+k},geometry:box(...at[k])})),...(media?[{id:'m',type:'image',nativeRef:{shapeId:20},geometry:box(7,2,5,3),content:{mediaRole:media}}]:[])]});
 const list=[{text:'A'},{text:'B'},{text:'C'}],plan=[0,1,2].map(k=>({kind:'point',shapeId:10+k,full:list[k].text}));
 const reads=spec=>_cardPageInternals.nativeReadsAsCard({templateFidelity:{width:13.333*IN,height:7.5*IN}},spec,plan,list);
 assert.equal(reads(make()),true,'one purpose, one size, top to bottom');
 assert.equal(reads(make({at:[[1,4],[1,3],[1,2]]})),false,'points read bottom to top');
 assert.equal(reads(make({at:[[1,2],[4,2],[7,2]]})),true,'a row read left to right');
 assert.equal(reads(make({at:[[7,2],[4,2],[1,2]]})),false,'a row read right to left');
 assert.equal(reads(make({purposes:['body','point-heading','point-description']})),false,'mixed slot purposes');
 assert.equal(reads(make({sizes:[17.5,11.5,11.5]})),false,'mixed font sizes');
 assert.equal(reads(make({media:'old_template_content'})),false,'a template chart to remove');
 assert.equal(reads(make({media:'template_decoration'})),true,'decoration stays');
 // The third step's numeral (a static slot) leaves with its step.
 const spec={slots:[{role:'static',shapeId:15},{role:'content',shapeId:16,purpose:'point-heading',groupId:'g3'},{role:'content',shapeId:17,purpose:'point-description',groupId:'g3'}],
  nodes:[{id:'bar',type:'shape',nativeRef:{shapeId:14},geometry:box(5.7,5.33,6.9,.43)},{id:'n15',type:'text',semanticRole:'native-text',nativeRef:{shapeId:15},geometry:box(9.06,5.44,.22,.22)},
   {id:'n16',type:'text',nativeRef:{shapeId:16},geometry:box(5.87,5.88,6.6,.22)},{id:'n17',type:'text',nativeRef:{shapeId:17},geometry:box(5.87,6.16,6.6,.39)}]};
 assert.deepEqual(_cardLayoutInternals.leftOutDecorations({templateFidelity:{slides:[spec],width:13.333*IN,height:7.5*IN}},0,new Set(['16','17'])).map(node=>node.id).sort(),['bar','n15']);}
// A card page's label is its outline section on every page (Fable review, alpha-r9 p3/p4/p9/p11).
{const {normalizeDeckEyebrows}=await import('./lib/ppt-section-eyebrow.mjs'),IN=914400;
 const spec={slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:40},{role:'section',shapeId:3,maxLines:1,lineVisualUnits:40,capacity:40}],
  nodes:[{id:'t',type:'text',nativeRef:{shapeId:2},geometry:{x:.6*IN,y:.9*IN,width:11*IN,height:.6*IN},style:{fontSizePt:28}},{id:'s',type:'text',nativeRef:{shapeId:3},geometry:{x:.6*IN,y:.4*IN,width:4*IN,height:.3*IN},style:{fontSizePt:11}}]};
 const project={planningContract:{version:3,flow:'cards'},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[spec,spec]},generationPolicy:{version:2,language:{mode:'output',locale:'en'}},inputUnderstanding:{primaryLanguage:'en'},
  source:{text:'# Deck\n\n## 3.1 Leaf heading\n\nBody.',semantic:{inventory:{items:[{id:'u1',text:'Body.',sectionPath:['Deck','3.1 Leaf heading']}]}}},
  outline:[{id:'c',title:'Deck'},{id:'p',title:'Signals',section:'Search Foundations',sourceUnitIds:['u1']}],deck:{slides:[{id:'c',nodes:[]},{id:'p',nodes:[],templateSlotTexts:{}}]}};
 normalizeDeckEyebrows(project);
 assert.equal(project.deck.slides[1].section,'Search Foundations','the chapter, not the source leaf heading');}
// Template card icons never stay on a card deck's object or theme page:
// rotated icons and their badges retire too, and a visible one is an
// integrity error (Fable, live fz-r10 slides 3/5/10/16).
{const {replaceTemplateSourceRegion}=await import('./lib/ppt-source-artifacts.mjs'),{inspectCardPageMedia}=await import('./lib/ppt-card-pages.mjs'),{mediaPreservingFit}=await import('./lib/ppt-media-preserving-layout.mjs');
 const IN=914400,frame={wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}};
 const text=(id,shapeId,x,y,w,h,pt)=>({id,type:'text',nativeRef:{shapeId,slideIndex:1,contractVersion:2},nativeTextFrame:frame,geometry:{x:x*IN,y:y*IN,width:w*IN,height:h*IN},style:{fontSizePt:pt,fontFamily:'Arial',lineHeight:1.1},content:{text:'Template text'},zIndex:5});
 const icon=(shapeId,x,y,extra={})=>({id:'i'+shapeId,type:'image',nativeRef:{shapeId,slideIndex:1},geometry:{x:x*IN,y:y*IN,width:.23*IN,height:.23*IN},content:{mediaRole:'template_icon',...extra},zIndex:4});
 const badge=(shapeId,x,y)=>({id:'b'+shapeId,type:'shape',nativeRef:{shapeId,slideIndex:1},geometry:{x:(x-.09)*IN,y:(y-.09)*IN,width:.41*IN,height:.41*IN},style:{fill:'#cc5500'},zIndex:3});
 const spec={slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:50,fontSizePt:26},{role:'content',shapeId:10,purpose:'point-description',fontSizePt:12,maxLines:3,lineVisualUnits:40},{role:'content',shapeId:11,purpose:'point-description',fontSizePt:12,maxLines:3,lineVisualUnits:40}],
  nodes:[text('t',2,.7,.6,11.9,.5,26),text('c10',10,1.2,2.4,3.5,.8,12),text('c11',11,5.2,2.4,3.5,.8,12),badge(24,.84,2.61),icon(25,.84,2.61),badge(26,4.84,2.38),icon(27,4.84,2.38),badge(28,8.85,2.15),icon(29,8.85,2.15,{mediaReplacement:true})]};
 const project={planningContract:{version:3,flow:'cards'},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[spec,spec]},templateSpec:{fonts:{title:'Arial',body:'Arial'}},source:{text:'Body.'},outline:[{id:'c'},{id:'p'}]};
 const canvas={x:.72*IN,y:1.44*IN,width:11.89*IN,height:5.54*IN};
 const slide={id:'p',nodes:[],templateOmissions:[]};
 replaceTemplateSourceRegion(project,slide,1,canvas);
 const omitted=slide.templateOmissions.map(item=>item.shapeId);
 for(const id of [24,25,26,27,28,29])assert.ok(omitted.includes(id),'retired with its card set: '+id);
 assert.equal(slide.templateOmissions.find(item=>item.shapeId===29).approvalBasis,'source_region_card_icon_avoidance','a rotated icon retires like the original');
 assert.equal(mediaPreservingFit(project,1,[{type:'table',content:{rows:[['a','b'],['1','2']]}}],{capacity_ok:true,canvas,fontSizePt:14,boxes:[],measurements:[]}),null,'no icon band or re-anchoring on a card deck');
 const deckSlide=(nodes,omissions=[])=>({id:'p',cardPage:{mode:'objects'},nodes,templateOmissions:omissions});
 const check=deck=>inspectCardPageMedia({...project,deck:{slides:[{id:'c',nodes:[]},deck]}}).map(issue=>[issue.code,issue.details.kind]);
 assert.deepEqual(check(deckSlide([icon(25,.84,2.61)])),[['orphan_template_icon','icon']],'a visible icon on an object page');
 assert.deepEqual(check(deckSlide([badge(24,.84,2.61)],[{shapeId:25}])),[['orphan_template_icon','carrier']],'a badge left without its icon');
 assert.deepEqual(check({...deckSlide([icon(25,.84,2.61)]),cardPage:{mode:'native'}}),[],'native pages keep their icons beside filled slots');}
// Fable review r11: the section label keeps its slot (the title translation
// goes beside it), a page without its label is blocked, a wide banner does not
// cut a card page's canvas, and a label is a capitalised bold line.
{const {bindTitleHierarchy}=await import('./lib/ppt-title-hierarchy.mjs'),{inspectCardPageLabels,labelledPoint}=await import('./lib/ppt-card-pages.mjs'),{contentCanvas}=await import('./lib/ppt-density-capacity.mjs');
 const IN=914400,text=(id,role,slotRole,x,y,w,h,pt,value)=>({id,type:'text',semanticRole:role,templateSlot:slotRole?{role:slotRole}:undefined,nativeRef:{shapeId:id==='t'?2:3},geometry:{x:x*IN,y:y*IN,width:w*IN,height:h*IN},style:{fontSizePt:pt,fontFamily:'Arial'},content:{text:value}});
 const project={planningContract:{version:3,flow:'cards'},generationPolicy:{version:2,language:{mode:'source',body:'both',title:'both'}},templateSpec:{palette:{accent:'#cc5500',background:'#ffffff'}},
  outline:[{id:'c'},{id:'p',title:'Signals',section:'Search Foundations',titlePair:{primary:'Signals',secondary:'信号',primaryLanguage:'en'}}]};
 const pill={id:'pill',type:'shape',nativeRef:{shapeId:9},geometry:{x:.72*IN,y:.6*IN,width:.6*IN,height:.22*IN},content:{}};
 const slide={id:'p',nodes:[text('t','template-title',null,.72,.88,11.89,.38,26,'Signals'),text('s','template-section','section',.82,.64,1.22,.14,8,'Search Foundations'),pill]};
 slide.nodes[1].geometry.width=11.79*IN;slide.nodes[1].templateTitleFrameAdaptation={status:'adapted',geometry:{...slide.nodes[1].geometry}};
 bindTitleHierarchy(project,slide,1);
 assert.equal(slide.nodes.find(node=>node.id==='s').content.text,'Search Foundations','the label keeps its slot');
 {const a=slide.nodes[1].geometry;assert.ok(a.width<11.79*IN,'the widened label box shrinks to its ink');assert.equal(slide.nodes[1].templateTitleFrameAdaptation,undefined,'and its stale glyph record goes');}
 const translation=slide.nodes.find(node=>node.semanticRole==='title-translation');
 assert.ok(pill.geometry.width>.6*IN&&slide.templateAdaptations.some(item=>item.shapeId===9&&item.action==='section_label_carrier_fit'),'the pill widens to the label');
 assert.ok(translation&&translation.content.text==='信号'&&translation.geometry.x===slide.nodes[0].geometry.x&&translation.geometry.y>=slide.nodes[0].geometry.y+.38*IN,'the translation sits under the title (Fable review fz-r15)');
 const deck=nodes=>({...project,outline:[{id:'c'},{id:'p',section:'Search Foundations'}],deck:{slides:[{id:'c',nodes:[]},{id:'p',cardPage:{mode:'theme'},nodes}]}});
 assert.deepEqual(inspectCardPageLabels(deck(slide.nodes)),[]);
 assert.deepEqual(inspectCardPageLabels(deck([slide.nodes[0]])).map(issue=>issue.code),['section_label_missing']);
 {const marked=deck(slide.nodes);marked.deck.slides[1].titlePair={primary:'Summary',secondary:'总结 (cont.)'};assert.deepEqual(inspectCardPageLabels(marked).map(issue=>issue.code),['continuation_marker_language'],'a Chinese title never carries (cont.) (Fable r19 B)');}
 const spec={slots:[{role:'content',shapeId:5}],nodes:[{id:'b',type:'text',nativeRef:{shapeId:5},geometry:{x:.72*IN,y:1.57*IN,width:11.89*IN,height:5.4*IN},style:{fontSizePt:14}},{id:'banner',type:'image',nativeRef:{shapeId:22},geometry:{x:.72*IN,y:4.57*IN,width:11.89*IN,height:1.39*IN},content:{mediaRole:'template_decoration'}}]};
 const canvasOf=flow=>contentCanvas({planningContract:flow,templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[spec,spec]}},1).geometry.height/IN;
 assert.ok(canvasOf({version:3,flow:'cards'})>5,'a card page keeps its full canvas (the banner retires)');assert.ok(canvasOf(undefined)<3.1,'a legacy page keeps the banner');
 assert.deepEqual(labelledPoint({label:'pool',text:'Pool: candidates kept after the gauntlet'},'en'),{label:'Pool',body:'Candidates kept after the gauntlet'});
 assert.equal(labelledPoint({label:'q5',text:'q5 adds EG'},'en').label,'q5');}
// A bilingual body cell reads as two lines; short or one-language cells stay (Fable review fz-r15 p3/p4/p23).
{const {pairedCell}=await import('./lib/ppt-source-artifacts.mjs');
 assert.equal(pairedCell('Book-to-market ratio $B/M$ 账面市值比 $B/M$'),'Book-to-market ratio $B/M$\n账面市值比 $B/M$');
 assert.equal(pairedCell('Characteristic 特征'),'Characteristic 特征','a short half stays on one line');
 assert.equal(pairedCell('Market, size, value'),'Market, size, value');
 // A short Latin token before the Han boundary belongs to the Chinese half (Fable r16, fz p24).
 assert.equal(pairedCell('q-theory + forward-looking expected growth q 理论 + 前瞻性预期增长'),'q-theory + forward-looking expected growth\nq 理论 + 前瞻性预期增长');}
// Every title fits its own page's slot (Fable decision r18, fz p22: a 54-character heading in a ~29-character slot).
{const {cardTitleFits,unfitCardTitles,acceptShortTitles,fallbackCardTitle}=await import('./lib/ppt-card-pages.mjs');const IN=914400;
 const spec={slots:[{role:'title',shapeId:2,maxLines:1}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},nativeTextFrame:{wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}},geometry:{x:IN,y:IN/2,width:6*IN,height:.6*IN},style:{fontSizePt:26,fontFamily:'Arial',lineHeight:1},content:{text:'x'}}]};
 const long='Worked Example: A 2×3 Sort on a 12-Stock Toy Universe | 算例：12 只股票玩具宇宙上的 2×3 分组';
 const deck={templateFidelity:{mode:'preserve',slides:[spec,spec,spec]},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'source',body:'both'}},outline:[{id:'c',title:'Cover'},{id:'p',title:long},{id:'q',title:'Size Sorts | 规模分组'}]};
 assert.ok(cardTitleFits(deck,2,{title:'Size Sorts | 一个相当长的中文翻译标题放在下方的译文带里'}),'only the primary half is measured');
 const unfit=unfitCardTitles(deck);assert.deepEqual(unfit.map(item=>item.index),[1]);assert.ok(unfit[0].maxCharacters<40);
 const reply=title=>acceptShortTitles(deck,unfit,{titles:[{page:2,title}]}).get(1);
 assert.equal(reply('A 2×3 Sort Example | 2×3 分组算例'),'A 2×3 Sort Example | 2×3 分组算例');
 assert.equal(reply('A 2×3 Sort Example'),undefined,'a bilingual title keeps its translation');
 assert.equal(reply(long),undefined,'still too long');assert.equal(reply('Size Sorts | 规模分组'),undefined,'repeats another title');
 assert.equal(fallbackCardTitle(deck,1,deck.outline[1],'Factor Testing | 因子检验'),'Factor Testing | 因子检验','the topic title first');
 const cut=fallbackCardTitle(deck,1,deck.outline[1],'');assert.ok(cardTitleFits(deck,1,{title:cut})&&cut.startsWith('Worked Example')&&/ \| 算例/u.test(cut),cut);
 // The title's own lead, the topic title or the source heading come before any cut, and a cut never dangles (Fable plan T32).
 const {preferredShortTitle}=await import('./lib/ppt-card-pages.mjs');
 assert.equal(preferredShortTitle(deck,1,deck.outline[1],''),'Worked Example | 算例','the lead before ":" in both halves');
 const noLead={...deck,outline:[deck.outline[0],{id:'p',title:'A Two by Three Sort Across Twelve Stocks in One Toy Universe of Names | 一个玩具宇宙'},deck.outline[2]]};
 assert.equal(preferredShortTitle(noLead,1,noLead.outline[1],'Factor Testing | 因子检验'),'Factor Testing | 因子检验','then the topic title');
 // A Chinese deck never takes an English source heading as a short title (3197 2daf3572: "Related Work (cont.)").
 {const zhDeck={...deck,generationPolicy:{language:{mode:'output',locale:'zh-CN'}},outline:[deck.outline[0],{id:'p',title:'相关工作探索了动力学模型与进化策略在强化学习中的多种应用方式（续）'},deck.outline[2]]};
  assert.equal(preferredShortTitle(zhDeck,1,zhDeck.outline[1],'Related Work'),null,'the English topic title is skipped');
  const short=fallbackCardTitle(zhDeck,1,zhDeck.outline[1],'Related Work');
  assert.ok(/\p{Script=Han}/u.test(short)&&!/Related/u.test(short),short);
  // Cut between words, never inside one (3197 85a2621c p9: "…并超越视").
  const base=short.replace(/（续）$/u,''),ends=new Set([...new Intl.Segmenter('zh',{granularity:'word'}).segment(zhDeck.outline[1].title)].map(part=>part.index+part.segment.length));
  assert.ok(ends.has(base.length),'a word boundary: '+short);
  assert.equal(preferredShortTitle(zhDeck,1,zhDeck.outline[1],'Method'),null,'a single English word is no Chinese title either');}
 // One batch gives a topic title to one page only (3197 mood-board: four pages became "Car Racing Experiment").
 {const chosen=new Set();assert.equal(preferredShortTitle(noLead,1,noLead.outline[1],'Factor Testing | 因子检验',chosen),'Factor Testing | 因子检验');
  assert.equal(preferredShortTitle(noLead,1,noLead.outline[1],'Factor Testing | 因子检验',chosen),null,'the second page of the batch does not take it');
  assert.notEqual(fallbackCardTitle(noLead,1,noLead.outline[1],'Factor Testing | 因子检验',chosen),'Factor Testing | 因子检验');}
 // A continued card keeps "(cont.)" through shortening when it fits (Fable plan T34).
 const continued={...deck,outline:[deck.outline[0],{id:'p',title:'Worked Example: A 2×3 Sort on a 12-Stock Toy Universe (cont.) | 算例：12 只股票玩具宇宙上的 2×3 分组（续）'},deck.outline[2]]};
 assert.equal(preferredShortTitle(continued,1,continued.outline[1],''),'Worked Example (cont.) | 算例（续）');
 const keptMarker=fallbackCardTitle(continued,1,continued.outline[1],'');assert.ok(/\(cont\.\) \| .*（续）$/u.test(keptMarker)&&cardTitleFits(continued,1,{title:keptMarker}),keptMarker);
 const cutTitle=fallbackCardTitle(noLead,1,noLead.outline[1],''),cutPrimary=cutTitle.split(' | ')[0];
 assert.ok(cardTitleFits(noLead,1,{title:cutTitle})&&!/(?:^|\s)(?:a|an|the|of|on|in|across|to|for|with|by|and|\S*\d\S*)$/iu.test(cutPrimary),cutTitle);
 // Titles are measured as they render: " / " around slashes (live mlq-r33 p10).
 {const {normalizeTypography}=await import('./lib/ppt-presentation-writing.mjs');
  for(let n=2;n<=14;n++){const title=Array.from({length:n},(_,k)=>'Beta'+k).join('/');assert.equal(cardTitleFits(deck,2,{title}),cardTitleFits(deck,2,{title:normalizeTypography(title)}),title);}
  // A cut never ends inside an open bracket.
  const bracket={...deck,outline:[deck.outline[0],{id:'p',title:'Sector/beta-neutral Residual Return Across Industries (usually the Best Choice) | 行业中性残差收益（通常最优）'},deck.outline[2]]};
  const short=fallbackCardTitle(bracket,1,bracket.outline[1],''),lead=short.split(' | ')[0];
  assert.ok(cardTitleFits(bracket,1,{title:short})&&lead.split('(').length===lead.split(')').length,short);}
 // A page a card continues on during generation is marked on its final frame (live fz-r31 p3).
 {const {continuedPageTitle}=await import('./lib/ppt-card-pages.mjs');
  assert.equal(continuedPageTitle(deck,1,{id:'p',title:'Factor Definitions'}),'Factor Definitions (cont.)');
  const long=continuedPageTitle(continued,1,{id:'p',title:'Worked Example: A 2×3 Sort on a 12-Stock Toy Universe | 算例：12 只股票玩具宇宙上的 2×3 分组'});
  assert.ok(/\(cont\.\)/u.test(long)&&cardTitleFits(continued,1,{title:long}),'a long title keeps the marker by shortening: '+long);
  // Adjacent pages that still share a title after the outline passes: the later one continues (live fz-r33 p3).
  const {repeatedTitlePages}=await import('./lib/ppt-card-pages.mjs');
  const twice={...deck,outline:[deck.outline[0],{id:'a',title:'Factor Definitions'},{id:'b',title:'Factor Definitions'},{id:'c',title:'Factor Definitions (cont.)'}]};
  assert.deepEqual(repeatedTitlePages(twice),[2],'only the unmarked repeat');}}
// A card deck's formula keeps its slot width (Fable r19 J: a measured frame ran short and soffice shrank the math).
{const {fitSourceMathFrames}=await import('./lib/ppt-native-text-fit.mjs'),{equationContent}=await import('./lib/ppt-math.mjs');const IN=914400;
 const math=()=>({id:'eq',type:'text',sourceArtifact:{sourceUnitId:'e',type:'EquationBlock'},geometry:{x:IN,y:IN,width:9*IN,height:2*IN},style:{fontSizePt:18},content:equationContent('r_i-r_f=\\alpha_i+\\beta_i MKT')});
 const card={nodes:[math()]},legacy={nodes:[math()]};fitSourceMathFrames(card,{planningContract:{version:3,flow:'cards'}});fitSourceMathFrames(legacy,{});
 assert.equal(card.nodes[0].geometry.width,9*IN,'full slot width');assert.ok(card.nodes[0].geometry.height<2*IN,'natural height');
 assert.ok(legacy.nodes[0].geometry.width<9*IN,'other decks keep the natural frame');}
// A one-point statement card is the 24 pt theme statement, never a native slot (Fable plan T33, mlq p41).
{const {nativeCardSlots}=await import('./lib/ppt-card-pages.mjs');const IN=914400;
 const slot=(id,x)=>({id,type:'text',nativeRef:{shapeId:id,contractVersion:2},geometry:{x:x*IN,y:2*IN,width:3.8*IN,height:3*IN},style:{fontSizePt:14},content:{text:'Body'}});
 const spec={slots:[{role:'title',shapeId:1},{role:'content',shapeId:2},{role:'content',shapeId:3}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:1,contractVersion:2},geometry:{x:.6*IN,y:.4*IN,width:11*IN,height:.8*IN},style:{fontSizePt:28},content:{text:'Title'}},slot(2,.6),slot(3,4.8)]};
 const project={planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[spec,spec]},outline:[{id:'c',title:'Cover'},{id:'s',title:'One Strong Claim',keyPoints:[{text:'Rigor beats flexibility in every backtest we ran'}]}]};
 assert.equal(nativeCardSlots(project,1,project.outline[1]),null);
 assert.equal(fitThemePage(project,1,project.outline[1]).components[0].fontSizePt,24,'the theme statement at 24 pt');}
// One template layout on at most max(2, floor(N/5)) pages (the user, 2026-10-25):
// earlier pages keep it, per template page (any variant); the draft agrees.
{const {nativeCardSlots,cardPageDraft,cardLayoutCap,setCardLayoutCap}=await import('./lib/ppt-card-pages.mjs');const IN=914400;
 assert.deepEqual([4,9,10,11,14,15,16,21,24,48].map(cardLayoutCap),[2,2,2,2,2,3,3,4,4,9]);
 const slot=(id,x)=>({id:'n'+id,type:'text',nativeRef:{shapeId:id,contractVersion:2},nativeTextFrame:{wordWrap:true},geometry:{x:x*IN,y:2*IN,width:3.8*IN,height:3*IN},style:{fontSizePt:14},content:{text:'Body'}});
 const spec=(k,variant='original')=>({sourceIndex:k,variantId:variant,slots:[{role:'title',shapeId:1,capacity:40,maxLines:1},{role:'content',shapeId:2,purpose:'body',capacity:200},{role:'content',shapeId:3,purpose:'body',capacity:200}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:1,contractVersion:2},nativeTextFrame:{wordWrap:true},geometry:{x:.6*IN,y:.4*IN,width:11*IN,height:.8*IN},style:{fontSizePt:28},content:{text:'Title'}},slot(2,.6),slot(3,4.8)]});
 const card=k=>({id:'p'+k,title:'Page '+(k+1),keyPoints:[{text:'Validation must precede any live allocation step'},{text:'Costs decide which signals survive in practice'}]});
 const deck=sources=>({pages:sources.length+1,planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[spec(0),...sources.map(([k,v],i)=>spec(k,v))]},outline:[{id:'c',title:'Cover'},...sources.map((_,i)=>card(i))]});
 const pattern=project=>project.outline.slice(1).map((_,k)=>nativeCardSlots(project,k+1)?1:0).join('');
 const one=deck(Array.from({length:11},()=>[1,'original']));
 setCardLayoutCap(Infinity);assert.equal(pattern(one),'11111111111','without the cap every page is native');
 setCardLayoutCap(null);assert.equal(pattern(one),'11000000000','cap 2 on 12 pages: the first two keep the layout');
 one.outline.forEach((page,i)=>{if(i)assert.equal(cardPageDraft(one,i,page).cardPage?.mode==='theme',!nativeCardSlots(one,i),'the draft agrees on page '+(i+1));});
 // Per template page, any variant: two template pages, variants mixed.
 const two=deck(Array.from({length:11},(_,i)=>[1+i%2,i%4<2?'original':'media-focus-a']));
 assert.equal(pattern(two),'11110000000','two uses of each template page, variants counted together');
 // An earlier page that changes is re-decided: a one-point statement is never native, so its use goes to a later page.
 one.outline[1]={id:'s',title:'One Strong Claim',keyPoints:[{text:'Rigor beats flexibility in every backtest we ran'}]};
 assert.equal(pattern(one),'01100000000','the freed use goes to the next page');}
// A table of paragraph rows is a record table (Fable plan T17); a table of short cells is not.
{const {recordTable}=await import('./lib/ppt-card-pages.mjs');
 const rows=n=>[['Trap','Mechanism','Fix'],...Array.from({length:3},(_,k)=>[`Trap ${k}`,'A long mechanism sentence that keeps explaining the leak. '.repeat(n),'A long fix sentence that keeps explaining the remedy. '.repeat(n)])];
 assert.equal(recordTable({type:'TableBlock',rows:rows(5)}),true);assert.equal(recordTable({type:'TableBlock',rows:rows(1)}),false);}
// Theme page titles share the deck's usual title top (Fable plan T12).
{const {deckTitleTop}=await import('./lib/ppt-card-pages.mjs');const IN=914400;
 const page=y=>({slots:[{role:'title',shapeId:1}],nodes:[{nativeRef:{shapeId:1},geometry:{x:IN,y:y*IN,width:10*IN,height:IN}}]});
 assert.equal(deckTitleTop({templateFidelity:{slides:[page(2),page(.5),page(.5),page(.8)]}}),Math.round(.5*IN),'the most common top; the cover does not count');}
// A translated title keeps the band under the title: a native layout whose slots start inside it is not used (Fable plan T25).
{const {translationBandClash}=await import('./lib/ppt-card-pages.mjs');const IN=914400;
 const spec=y=>({slots:[{role:'title',shapeId:1},{role:'content',shapeId:2}],nodes:[{id:'t',nativeRef:{shapeId:1},geometry:{x:.6*IN,y:.4*IN,width:11*IN,height:.8*IN},style:{fontSizePt:28}},{id:'b',nativeRef:{shapeId:2},geometry:{x:.6*IN,y:y*IN,width:11*IN,height:3*IN}}]});
 assert.equal(translationBandClash(spec(1.35),[{shapeId:2}]),true,'a slot right under the title');
 assert.equal(translationBandClash(spec(2.2),[{shapeId:2}]),false,'room for the band');}
// A divider with more than six items is a numbered two-column agenda at 14-18 pt (Fable plan T15, fz p6/p15).
{const {fitThemePage}=await import('./lib/ppt-card-pages.mjs');const IN=914400;
 const frame={slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:60},{role:'content',shapeId:10}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},geometry:{x:.6*IN,y:.3*IN,width:11.9*IN,height:.8*IN},style:{fontSizePt:28}},{id:'c',type:'text',nativeRef:{shapeId:10,contractVersion:2},geometry:{x:.6*IN,y:1.4*IN,width:11.9*IN,height:5.4*IN},style:{fontSizePt:14}}]};
 const divider=n=>({id:'div',title:'Factor Testing and Practice | 因子检验与实践',cardFrame:'divider',keyPoints:Array.from({length:n},(_,k)=>({text:`Topic number ${String.fromCharCode(65+k)} of the chapter | 本章第${k+1}个主题`,navigation:true}))});
 const project={planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'source',body:'both'}},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[frame,frame]},outline:[{id:'cover',title:'Cover'},divider(12)]};
 const agenda=fitThemePage(project,1,project.outline[1]);
 assert.equal(agenda.components.length,2,'two columns');assert.ok(agenda.components.every(component=>component.fontSizePt>=14&&component.content.agenda));
 assert.match(agenda.components[0].content.text,/^1\. Topic number A of the chapter · 本章第1个主题/u);assert.match(agenda.components[1].content.text,/^7\. /u);
 assert.ok(new Set(agenda.fit.boxes.map(box=>box.x)).size===2,'side by side');
 project.outline[1]=divider(5);const short=fitThemePage(project,1,project.outline[1]);assert.ok(!short.components.some(component=>component.content.agenda),'six or fewer stay one column');}
// Page numbers (user decision 2026-10-24): every page but the cover, bottom right, 10 pt, digits only; renumbered after any page change.
{const {syncPageNumbers,inspectPageNumbers,pageNumberRegion}=await import('./lib/ppt-page-numbers.mjs');const IN=914400;
 const deck=n=>({planningContract:{version:3,flow:'cards'},templateFidelity:{mode:'preserve',width:12192000,height:6858000},templateSpec:{fonts:{body:'DM Sans'}},deck:{slides:Array.from({length:n},(_,k)=>({id:'s'+k,nodes:[]}))}});
 const p=syncPageNumbers(deck(4)),numbers=p.deck.slides.map(slide=>slide.nodes.find(node=>node.semanticRole==='page-number'));
 // The exporter reads a hex colour (live fz-r26: the colour record crashed the writer).
 for(const node of numbers.filter(Boolean))assert.match(node.style.color,/^#[0-9a-f]{6}$/iu);
 assert.equal(numbers[0],undefined,'the cover has no number');
 assert.deepEqual(numbers.slice(1).map(node=>node.content.text),['2','3','4']);
 assert.ok(numbers.slice(1).every(node=>node.style.fontSizePt===10&&node.style.textAlign==='right'&&node.locked&&node.style.fontFamily==='DM Sans'));
 assert.deepEqual(numbers[1].geometry,pageNumberRegion({width:12192000,height:6858000}));assert.ok(Math.abs(numbers[1].geometry.x+numbers[1].geometry.width-(12192000-.5*IN))<2,'right edge 0.5 in from the page edge');
 assert.deepEqual(inspectPageNumbers(p),[]);
 p.deck.slides.splice(2,0,{id:'inserted',nodes:[]});syncPageNumbers(p);
 assert.deepEqual(p.deck.slides.map(slide=>slide.nodes.filter(node=>node.semanticRole==='page-number').map(node=>node.content.text).join()),['','2','3','4','5'],'renumbered after a continuation page, one node per page');
 p.deck.slides[3].nodes=[];assert.deepEqual(inspectPageNumbers(p).map(issue=>issue.code),['page_number_missing']);
 const slotted=deck(2);slotted.deck.slides[1].nodes=[{id:'n',type:'text',nativeRef:{shapeId:9},geometry:{x:11*IN,y:7*IN,width:IN,height:.3*IN},content:{text:'#'}}];syncPageNumbers(slotted);
 assert.deepEqual(slotted.deck.slides[1].nodes.map(node=>[node.id,node.content.text]),[['n','2']],'the template slot takes the number, no second node');}
// Theme page items carry stable ids where they are born (Fable: the canvas keys point cards by item id).
{const base={inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'source',body:'both'}},outline:[]};
 for(const [shape,page] of [['steps',{id:'pg_steps',title:'Steps',numberedPoints:true,keyPoints:['Collect data','Clean it','Fit the model','Test out of sample'].map(text=>({text,sourceUnitIds:['u']}))}],
  ['points',{id:'pg_points',title:'Points',keyPoints:['Momentum persists for months','Value earns a premium','Size matters less now'].map(text=>({text,sourceUnitIds:['u']}))}]]){
  const items=themeComponents(base,page).flatMap(component=>component.content?.items||[]);
  assert.ok((shape!=='steps'||items.length)&&items.every(item=>typeof item.id==='string'&&item.id.startsWith('item_')),shape);
  assert.equal(new Set(items.map(item=>item.id)).size,items.length,'unique ids: '+shape);
  assert.deepEqual(themeComponents(base,page).flatMap(component=>component.content?.items||[]).map(item=>item.id),items.map(item=>item.id),'stable across builds');}}
// The title band reads every form of a translation (live mlq-r17: planned before titlePair existed).
{const {translatedTitle}=await import('./lib/ppt-density-capacity.mjs');
 assert.ok(translatedTitle({title:'Core Principle',titlePair:{secondary:'核心原则'}})&&translatedTitle({title:'Core Principle',titleSecondary:'核心原则'})&&translatedTitle({title:'Core Principle | 核心原则'}));
 assert.ok(!translatedTitle({title:'Core Principle'})&&!translatedTitle({title:'Risk | Return'}));
 // The band is reserved only when titles show both languages (the user, 2026-10-24).
 const {titleBandReserved}=await import('./lib/ppt-density-capacity.mjs'),paired={title:'Core Principle',titlePair:{secondary:'核心原则'}};
 assert.equal(titleBandReserved({generationPolicy:{version:2,language:{mode:'source',body:'both',title:'primary'}}},paired),false,'primary titles: no band');
 assert.equal(titleBandReserved({generationPolicy:{version:2,language:{mode:'source',body:'both'}}},paired),false,'an older policy reads as primary');
 assert.equal(titleBandReserved({generationPolicy:{version:2,language:{mode:'source',body:'both',title:'both'}}},paired),true,'both: the band stays');}
// The section badge of a bilingual card deck carries the chapter's translation (Fable r16 M6).
{const {bilingualSection}=await import('./lib/ppt-section-eyebrow.mjs');
 const deck={generationPolicy:{language:{mode:'source',body:'both'}},outline:[{cardFrame:'divider',title:'Theoretical Lineage',titleSecondary:'理论谱系'}]};
 assert.equal(bilingualSection(deck,'Theoretical Lineage'),'Theoretical Lineage | 理论谱系');
 assert.equal(bilingualSection(deck,'Introduction'),'Introduction | 导言');
 assert.equal(bilingualSection(deck,'Other'),'Other','no translation known');
 assert.equal(bilingualSection({...deck,generationPolicy:{language:{mode:'source',body:'primary'}}},'Theoretical Lineage'),'Theoretical Lineage','one-language deck');}
// Native card slots share the deck's type scale (Fable review r16: 10/8 pt slots beside 14 pt pages).
{const {_cardLayoutInternals:{cardSlotFont,slotFit}}=await import('./lib/ppt-outline-cards.mjs'),IN=914400;
 const node=(shapeId,pt)=>({id:'n'+shapeId,type:'text',nativeRef:{shapeId},geometry:{x:IN,y:IN,width:4*IN,height:1*IN},style:{fontSizePt:pt,fontFamily:'Arial'},nativeTextFrame:{wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}}});
 const spec={slots:[{role:'content',shapeId:1,purpose:'point-description',fontSizePt:10,lineVisualUnits:40,maxLines:3,capacity:120},{role:'content',shapeId:2,purpose:'point-heading',fontSizePt:15.5,lineVisualUnits:26,maxLines:1,capacity:26},{role:'content',shapeId:3,purpose:'body',fontSizePt:16,lineVisualUnits:30,maxLines:3,capacity:90}],nodes:[node(1,10),node(2,15.5),node(3,16)]};
 const cards={planningContract:{version:3,flow:'cards'}};
 assert.deepEqual(spec.slots.map(slot=>cardSlotFont(cards,spec,slot)),[12,16,14],'description 10 -> 12, heading -> body+2, body 16 -> 14');
 assert.equal(cardSlotFont({},spec,spec.slots[0]),null,'legacy decks keep template sizes');
 assert.ok(slotFit(spec,spec.slots[0],12).room<slotFit(spec,spec.slots[0]).room,'a larger size holds fewer units');}
// Fable plan T30: inline \\underbrace labels read as one 12 pt legend line under the points.
{const page=card(['Returns split as $r=\\underbrace{\\alpha}_{\\text{skill}}+\\underbrace{\\beta f}_{\\text{market}}$ each month','Only $\\alpha$ is forecastable']);
 const parts=themeComponents(project,page),legend=parts.at(-1);
 assert.equal(parts.length,3,'two points and one legend');
 assert.equal(legend.ladderFontPt,12);assert.equal(legend.braceLegendOf,page.id);
 assert.match(legend.content.text,/skill/u);assert.match(legend.content.text,/market/u);
 assert.ok(!/⏟|underbrace/u.test(parts[0].content.text),'the point draws its formula without braces');
 assert.equal(themeComponents(project,card(['No braces $x+y$'])).length,1,'no legend without braces');
 assert.equal(themeComponents(project,{...page,cardShape:'divider',dividerOf:['x']}).some(part=>part.braceLegendOf),false);}
// Template media on card pages (Fable media decision S1–S4, S6; mlq-r25: 8 of
// 140 template pictures survived). Fixture frames after the Gamma template.
{const IN=914400,cp=await import('./lib/ppt-card-pages.mjs');
 const text=(id,x,y,w,h,pt=14,extra={})=>({id:'n'+id,type:'text',nativeRef:{shapeId:id,contractVersion:2,slideIndex:1},geometry:{x:x*IN,y:y*IN,width:w*IN,height:h*IN},style:{fontSizePt:pt,color:'#222222'},content:{text:'Sample'},...extra});
 const image=(id,x,y,w,h,content)=>({id:'n'+id,type:'image',nativeRef:{shapeId:id,slideIndex:1},geometry:{x:x*IN,y:y*IN,width:w*IN,height:h*IN},zIndex:20+id,content:{imageSha256:'sha'+id,...content}});
 const circle=(id,x,y)=>({id:'n'+id,type:'shape',nativeRef:{shapeId:id,autoShapeType:'ELLIPSE',slideIndex:1},geometry:{x:x*IN,y:y*IN,width:.46*IN,height:.46*IN},zIndex:id,style:{fill:'#cc5500'},content:{}});
 const frame=(extra,slots=[[.72,2.3,11.89,4.4]])=>({background:'#ffffff',slots:[{role:'title',shapeId:1},...slots.map((_,k)=>({role:'content',shapeId:2+k}))],
  nodes:[text(1,.72,.9,11.89,.5,28),...slots.map(([x,y,w,h],k)=>text(2+k,x,y,w,h)),...extra]});
 const plain=frame([]);
 const icons=frame([0,1,2].flatMap(k=>[circle(10+2*k,.72+4*k,2.3),image(11+2*k,.84+4*k,2.41,.23,.23,{mediaRole:'template_icon',foregroundColor:'#ffffff',monochromePanel:true})]),[[.72,2.9,3.6,2],[4.72,2.9,3.6,2],[8.72,2.9,3.6,2]]);
 const column=frame([image(30,0,0,5.5,7.5,{mediaRole:'template_decoration'})],[[5.72,2.3,6.89,4.4]]);
 const corner=frame([image(31,7.16,3.52,5.17,2.91,{mediaRole:'template_decoration'}),image(32,.72,1.8,5.4,3.3,{mediaRole:'old_template_content'})],[[.72,2.3,11.89,4.4]]);
 const banner=frame([image(33,.72,4.57,11.89,1.39,{mediaRole:'template_decoration',monochromePanel:true,foregroundColor:'#cc5500'}),text(34,.89,4.73,11.56,.87,14.5,{style:{fontSizePt:14.5,color:'#ffffff'}})],[[.72,2.3,11.89,4.4]]);
 const deck=(spec,page)=>({planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{version:2,language:{mode:'output',locale:'en'}},templateSpec:{palette:{background:'#ffffff',accent:'#cc5500'}},
  templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slideMap:[0,1],slides:[plain,spec]},outline:[{id:'c',title:'Cover'},{id:'p',title:'Card Title',cardObjects:[],...page}]});
 const pts=(n,label)=>({keyPoints:Array.from({length:n},(_,k)=>({text:`Point ${k+1} explains one mechanism of the model in a sentence.`,...(label?{label:'Label '+(k+1)}:{})}))});
 const grid=pts(3,true),points=pts(3);
 // Fable 2026-11-02 (replacing S1/S3): an uploaded template's badge pictures
 // never mark cards; the grid takes code markers in one colour instead.
 assert.deepEqual(cp.badgePrototypes(deck(icons,grid),1),[],'no template badges on an uploaded template');
 // The user, 2026-11-02 (slot rule, replacing 2026-10-31): a half-bleed painting is a
 // chrome slot, the frame's style on every page, so a content card prefers it to a
 // frame with no visual; a photo in a content slot (the corner photo below) still never shows.
// The painting is certified (a text reader and the pixel check, 2026-11-02);
// an uncertified picture in the same slot keeps the old cost.
const certified=frame([image(30,0,0,5.5,7.5,{mediaRole:'template_decoration',ocr:{status:'ok',engine:'tesseract.js',outcome:'no_text'},pixels:{continuousTone:true,flat:0,top4:.17,edges:0}})],[[5.72,2.3,6.89,4.4]]);
assert.ok(cp.cardPageScore(deck(certified,points),1)<cp.cardPageScore(deck(plain,points),1),'a content card prefers the certified chrome painting column to a frame without any visual');
assert.ok(cp.cardPageScore(deck(plain,points),1)<cp.cardPageScore(deck(column,points),1),'an uncertified photo column still loses to the plain frame');
// A numbered template assembly (Fable M3, 2026-11-02; the hand deck's petals):
// four pieces in one box, a number on each, a label slot beside each. Four
// short points keep it (number k takes point k); a long point or three points
// retire it whole.
{const piece=id=>image(id,7.96,3.37,2.41,2.41,{mediaRole:'old_template_content'});
 const digit=(id,n,x,y)=>text(id,x,y,.25,.25,18,{content:{text:String(n)}});
 const label=(id,x,y)=>text(id,x,y,2.24,.45,16,{content:{text:'Captures intangible ideas visually'}});
 const petals={background:'#ecf0db',slots:[{role:'content',shapeId:4,purpose:'body'},{role:'content',shapeId:7,purpose:'label'},{role:'content',shapeId:10,purpose:'label'},{role:'content',shapeId:13,purpose:'point-heading'},{role:'content',shapeId:16,purpose:'label'},...[9,12,15,18].map(shapeId=>({role:'static',shapeId}))],
  nodes:[text(1,5.72,.58,6.89,.6,28),text(4,5.72,1.3,6.89,.94,13),piece(8),piece(11),piece(14),piece(17),digit(9,1,8.6,4.01),digit(12,2,9.48,4.01),digit(15,3,9.48,4.89),digit(18,4,8.6,4.89),label(7,5.72,3.68),label(10,10.37,3.68),label(13,10.37,5.02),label(16,5.72,5.02)]};
 const on=list=>deck(petals,{keyPoints:list.map(text=>({text}))});
 const plan=cp.assemblyPlan(on(['World models','The V·M·C agent','Dream racing','VizDoom']),1);
 assert.deepEqual(plan?.texts,{'7':'World models','10':'The V·M·C agent','13':'Dream racing','16':'VizDoom'},'number k takes point k: '+JSON.stringify(plan?.texts));
 assert.deepEqual(plan.assembly.pieces,['8','11','14','17']);assert.deepEqual(plan.leaveOut,[4]);
 assert.equal(cp.assemblyPlan(on(['The world model idea, a compressed predictive model of the whole environment the agent lives in','b','c','d']),1),null,'a point longer than its label retires the whole group');
 assert.equal(cp.assemblyPlan(on(['a','b','c']),1),null,'three points never fill four pieces');}
// Template artwork in a content slot follows the painting rule (Fable B,
// 2026-11-02; Codex: Portfolio's arrow pictures on five docx pages): offered
// on its first page, again five or more pages later, never a third time.
{const {repeatedArtwork,regionArtwork}=await import('./lib/ppt-media-preserving-layout.mjs'),{contentCanvas}=await import('./lib/ppt-density-capacity.mjs');
 const arrows=frame([image(40,.72,5.2,6,.8,{mediaRole:'template_artwork'})]),pages=12;
 const many={...deck(plain,points),templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slideMap:Array.from({length:pages},(_,k)=>k?1:0),slides:Array.from({length:pages},(_,k)=>k?structuredClone(arrows):plain)},outline:Array.from({length:pages},(_,k)=>k?{id:'p'+k,title:'Card Title',cardObjects:[],...points}:{id:'c',title:'Cover'})};
 const offered=Array.from({length:pages},(_,k)=>k&&regionArtwork(many,k,contentCanvas(many,k).geometry).artwork.length?k:0).filter(Boolean);
 assert.deepEqual(offered,[1,6],'offered on pages 1 and 6 only: '+JSON.stringify(offered));
 assert.equal(repeatedArtwork(many,2).size,1,'page 2 would repeat it');}
// Markers before card headings on uploaded templates with a dark panel (Fable
// M2, 2026-11-02): numbers, or letters when every label opens with a distinct
// short abbreviation (V, M, C); built-in palettes (no panel) get none.
{const dark=project=>({...project,templateSpec:{...project.templateSpec,palette:{...project.templateSpec.palette,panel:'#2e2f23',onPanel:'#ecf0db'}}});
 const labelled=labels=>({keyPoints:labels.map(label=>({label,text:`${label}: one mechanism of the model in a sentence.`}))});
 const markersOf=(project,page)=>cp.themeComponents(project,{...project.outline[1],...page}).find(c=>c.content?.diagram)?.content.markers;
 assert.deepEqual(markersOf(dark(deck(plain,grid)),grid),['1','2','3']);
 assert.deepEqual(markersOf(dark(deck(plain,grid)),labelled(['V (Vision)','M (Memory)','C (Controller)'])),['V','M','C']);
 // The content chooses the component, the template its look (the user's review):
 // a light uploaded template gets markers too; a built-in template keeps its own cards.
 assert.deepEqual(markersOf(deck(plain,grid),grid),['1','2','3'],'a light template marks its cards too');
 const builtin=deck(plain,grid);builtin.templateFidelity={...builtin.templateFidelity,mode:'builtin'};
 assert.equal(markersOf(builtin,grid),undefined,'built-in templates unchanged');}
// A point that is one formula is an equation card on a template with a dark
// panel (Fable M5, 2026-11-02): one text, filled with the panel, light text.
{const dark=project=>({...project,templateSpec:{...project.templateSpec,palette:{...project.templateSpec.palette,panel:'#2e2f23',onPanel:'#ecf0db'}}});
 const page={keyPoints:[{text:'The controller is a single linear layer over $z$ and $h$.'},{text:'C: $a_t = W_c [z_t\\; h_t] + b_c$'}]};
 const parts=cp.themeComponents(dark(deck(plain,page)),{...deck(plain,page).outline[1]});
 assert.deepEqual(parts.map(part=>Boolean(part.equationCard)),[false,true]);
 assert.equal(cp.themeComponents(deck(plain,page),deck(plain,page).outline[1]).some(part=>part.equationCard),true,'a light template gets the card in its accent');
 const {componentSurface}=await import('./lib/ppt-template-palette.mjs');
 assert.deepEqual(componentSurface({accent:'#cc5500'}),{fill:'#cc5500',text:'#111111'},'text that reads on the accent');
 assert.deepEqual(componentSurface({accent:'#1a3353'}),{fill:'#1a3353',text:'#ffffff'});}
// Two or three numeric table rows among the points are a row of tiles under
// them (Fable 2026-11-02: the hand deck's parameter counts).
{const page={keyPoints:[{text:'The world model is large and the controller tiny.'},{text:'Most complexity sits in V and M.'},{label:'VAE',text:'4,348,547',rowLabel:true},{label:'MDN-RNN',text:'422,368',rowLabel:true},{label:'Controller',text:'867',rowLabel:true}]};
 const parts=cp.themeComponents(deck(plain,page),{...deck(plain,page).outline[1]});
 const tiles=parts.find(part=>part.content?.diagram?.kind==='kpi');
 assert.ok(tiles&&tiles.content.items.length===3,'one row of three tiles');
 assert.deepEqual(tiles.content.items.map(item=>item.heading),['4,348,547','422,368','867']);
 assert.equal(parts.filter(part=>part.type==='text').length,2,'the two prose points stay text');}
// A sparse page grows at most 2 pt above the body size (the user, 2026-11-02,
// on Fable's recommendation; World Models p3 had grown to 22 pt).
{const sparse=deck(plain,pts(2)),{contentCanvas}=await import('./lib/ppt-density-capacity.mjs'),body=contentCanvas(sparse,1).fontSizePt,grown=cp.fitThemePage(sparse,1,sparse.outline[1]).fit.fontSizePt;
 assert.ok(grown>body&&grown<=body+cp.SPARSE_GROWTH_PT,`grows from ${body} to at most ${body+2} pt, got ${grown}`);}
// Flat panels (Fable 2026-11-02): a frame whose painting would repeat on the
// next page shows a panel and costs more than a frame with an unused painting;
// a panel beside another panel costs an overflow.
{const paint=(sha,x=0)=>frame([image(30,x,0,5.5,7.5,{mediaRole:'template_decoration',imageSha256:sha,ocr:{status:'ok',engine:'tesseract.js',outcome:'no_text'},pixels:{continuousTone:true,flat:0,top4:.17,edges:0}})],[[5.72,2.3,6.89,4.4]]);
 const run=specs=>({...deck(plain,points),templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slideMap:specs.map((_,k)=>k),slides:specs},outline:specs.map((_,k)=>k?{id:'p'+k,title:'Card Title',cardObjects:[],...points}:{id:'c',title:'Cover'})});
 const fresh=cp.cardPageScore(run([plain,paint('A'),paint('B')]),2),panel=cp.cardPageScore(run([plain,paint('A'),paint('A')]),2);
 assert.ok(fresh<panel,`an unused painting beats a panel frame (${fresh} < ${panel})`);
 const second=cp.cardPageScore(run([plain,paint('A'),paint('A'),paint('A')]),3);
 // Since 2026-11-03 a painting repeats instead of a panel (the user): a third use costs no panel overflow.
 assert.ok(second-panel<cp.THEME_OVERFLOW_COST,`no panel, so no panel overflow (${second} vs ${panel})`);}
 // No template badge band and no badge clones; the grid carries code markers.
 {const project=deck(icons,grid),slide={id:'p',nodes:structuredClone(icons.nodes)};project.deck={slides:[{id:'c',nodes:[]},slide]};
  cp.bindThemeCardPage(project,slide,1,project.outline[1]);
  const list=slide.nodes.find(node=>node.content?.pointLayout);
  assert.equal(slide.nodes.filter(node=>node.templateComponentBinding?.badge).length,0,'no badge clones');
  assert.ok(!list.content.badgeInsetPt,'no badge band above the cards');
  assert.deepEqual(list.content.pointLayout.markers,['1','2','3'],'one marker per card');
  assert.deepEqual(cp.inspectCardPageMedia(project,project.deck.slides),[]);}
 // The user, 2026-10-31: a content card retires the template photo (frame pages keep it).
 {const project=deck(corner,points),fit=cp.fitThemePage(project,1,project.outline[1]).fit;
  assert.ok(!(fit.keptMediaShapeIds||[]).includes(31),'a content card does not keep the corner photo');
  assert.ok(!cp.pageVisuals(project,1,fit).some(node=>node.nativeRef.shapeId===31),'no template photo beside the points');}
 // S2: on a frame page the corner photo stays where the template put it; S6: the old report chart never shows.
 const frameOf=page=>({...page,cardFrame:'takeaway'});
 {const project=deck(corner,frameOf(points)),fit=cp.fitThemePage(project,1,project.outline[1]).fit;
  assert.ok(fit.keptMediaShapeIds.includes(31),'corner photo kept');assert.ok(!fit.keptMediaShapeIds.includes(32),'old report chart retired');
  const photo=corner.nodes.find(node=>node.nativeRef.shapeId===31).geometry;
  assert.ok(fit.boxes.every(b=>b.x+b.width<=photo.x||b.y+b.height<=photo.y||b.x>=photo.x+photo.width),'no point box over the photo');
  assert.deepEqual(cp.pageVisuals(project,1,fit).map(node=>node.nativeRef.shapeId),[31]);
  // A re-bound page brings the kept photo back on this page, whatever index the spec carried (live fz-r28 p18).
  const stale=structuredClone(corner);for(const node of stale.nodes)node.nativeRef.slideIndex=5;
  const again=deck(stale,frameOf(points)),slide={id:'p',nodes:structuredClone(stale.nodes).filter(node=>node.nativeRef.shapeId!==31)};again.deck={slides:[{id:'c',nodes:[]},slide]};
  cp.bindThemeCardPage(again,slide,1,again.outline[1]);
  const photoNode=slide.nodes.find(node=>node.nativeRef?.shapeId===31);assert.ok(photoNode,'photo back');assert.equal(photoNode.nativeRef.slideIndex,1);
  assert.ok(!(slide.templateOmissions||[]).some(item=>String(item.shapeId)==='31'),'and not recorded as left out');}
 // S4: a short one-point statement sits in the quote banner in the template's own text colour; a points card does not.
 {const project=deck(banner,{keyPoints:[{text:'Rigor beats flexibility.'}]}),theme=cp.fitThemePage(project,1,project.outline[1]);
  assert.equal(theme.fit.layoutId,'banner-statement');assert.deepEqual(theme.fit.keptMediaShapeIds,[33]);assert.equal(theme.components[0].textColor,'#ffffff');
  const b=banner.nodes.find(node=>node.nativeRef.shapeId===33).geometry,box=theme.fit.boxes[0];assert.ok(box.y>=b.y&&box.y+box.height<=b.y+b.height);
  assert.notEqual(cp.fitThemePage(deck(banner,points),1).fit.layoutId,'banner-statement');}
 // Photo reuse (Fable 2026-10-25): each earlier use of the same photo costs more; the frame's later uses too.
 {const plainPage={id:'x',title:'Card Title',cardObjects:[],...points};
  const deckOf=n=>({planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{version:2,language:{mode:'output',locale:'en'}},templateSpec:{palette:{background:'#ffffff',accent:'#cc5500'}},
   templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slideMap:[0,...Array.from({length:n},(_,k)=>k%2?2:1)],slides:[plain,...Array.from({length:n},(_,k)=>k%2?plain:column)]},
   outline:[{id:'c',title:'Cover'},...Array.from({length:n},(_,k)=>({...plainPage,id:'p'+k}))]});
  const project=deckOf(9),scores=[1,3,5,7,9].map(k=>cp.cardPageScore(project,k));
  assert.ok(scores.every((score,k)=>k===0||score>scores[k-1]),'the same photo costs more with each earlier use: '+scores);
  assert.ok(scores[4]-scores[3]>=300,'a fifth use is the last resort');}
 // A page inserted before a finished page avoids that page's photo (live mlq-r42
 // p8/p9, Fable 2026-10-26): page 3 is bound to photo P; page 2 picks Q over P.
 {const other=frame([image(35,0,0,5.5,7.5,{mediaRole:'template_decoration'})],[[5.72,2.3,6.89,4.4]]);
  const page=k=>({id:'q'+k,title:'Card Title '+k,cardObjects:[],...points});
  const deckWith=(second,bound)=>{const project={id:'insert-'+second+bound,planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{version:2,language:{mode:'output',locale:'en'}},templateSpec:{palette:{background:'#ffffff',accent:'#cc5500'}},
   templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slideMap:[0,1,second==='P'?2:3,2],slides:[plain,plain,second==='P'?column:other,column]},
   outline:[{id:'c',title:'Cover'},page(1),page(2),page(3)]};
   project.deck={slides:[{id:'c'},{id:'q1'},{id:'q2'},bound?{id:'q3',sourceArtifactFit:cp.fitThemePage(project,3,project.outline[3]).fit}:{id:'other'}]};return project;};
  const onP=cp.cardPageScore(deckWith('P',true),2),onQ=cp.cardPageScore(deckWith('Q',true),2);
  assert.ok(onQ<onP&&onP-onQ>=60,'the inserted page avoids the next page\'s photo: '+onP+' vs '+onQ);
  assert.equal(cp.cardPageScore(deckWith('P',false),2),cp.cardPageScore(deckWith('Q',false),2),'an unbound next page does not count (it looks back itself)');}}
// A row of cards keeps its measured height, centred in its canvas (Fable 2026-11-03, Q6 (a)).
{const {centreRow}=await import('./lib/ppt-card-pages.mjs');
 const list={type:'list',content:{items:[{text:'a'},{text:'b'},{text:'c'}]}};
 const fit={capacity_ok:true,availableHeight:2800000,usedHeight:850000,canvas:{x:0,y:3400000,width:10000000,height:2800000},boxes:[{x:0,y:4400000,width:10000000,height:850000}],measurements:[{processCards:true}],fontSizePt:14};
 const centred=centreRow({components:[list],fit});
 assert.equal(centred.fit.boxes[0].height,850000,'the cards keep their measured height');assert.equal(centred.fit.fontSizePt,14);
 assert.equal(centred.fit.boxes[0].y,Math.round(3400000+(2800000-850000)/2),'centred');
 assert.equal(centreRow({components:[list],fit:{...fit,measurements:[{}]}}).fit.boxes[0].y,4400000,'plain points keep their place');}
console.log('PASS option D card pages: measured object pages and their continuation, cover headline keeps the full title, two-line bilingual points, component by card shape (comparison and large-number tiles included), labels from own words, per-language budgets, title budget fallback.');
// Result tiles take distinct measured numbers, never training settings (Fable Q3, live f7f0f000 p13).
{
 const {measuredNumbers}=await import('./lib/ppt-key-number.mjs');
 assert.equal(measuredNumbers([{text:'ViT-B/16 训练 300 epochs 消融：预测较大目标块'},{text:'ViT-H/16 300 epochs 目标编码器输出'},{text:'500 epochs 预测器 Top-1 为 66.9'}]),false);
 assert.equal(measuredNumbers([{text:'81.1% 线性探测超过 MAE'},{text:'1200 GPU 小时完成预训练'}]),true);
 assert.equal(measuredNumbers([{text:'81.1% 线性探测'},{text:'81.1% 微调'}]),false,'a repeated number is not two results');
 console.log('PASS result tiles: distinct measured numbers only');
}
// A summary cover title replaces a file-like source title on the cover and in the library (the user, 2026-11-03).
{
 const {displayedDocumentTitle}=await import('./lib/ppt-deck-coherence.mjs');
 const source={text:'# 09-MCP 完整链路图(含分支原因,单图版)\n\n正文'};
 assert.ok(displayedDocumentTitle({source,generationPolicy:{language:{mode:'output',locale:'zh'}},outline:[{title:'x'}]}));
 assert.equal(displayedDocumentTitle({source,generationPolicy:{language:{mode:'output',locale:'zh'}},outline:[{title:'MCP 调用决策链路',coverSummarized:true}]}),null);
 assert.ok(displayedDocumentTitle({source,deckTitle:{source:'user'},generationPolicy:{language:{mode:'output',locale:'zh'}},outline:[{title:'x',coverSummarized:true}]}),"the author's title wins");
 console.log('PASS summary cover title replaces a file-like source title');
}

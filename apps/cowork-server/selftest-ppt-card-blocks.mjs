// Card blocks sized to the template's components (the hand deck, Fable
// 2026-11-02 G4): the writer writes k "short heading + one sentence" blocks,
// k one of the uploaded template's component counts, plus a lead; a card with
// more blocks than the largest layout is cut evenly into "· k/n" cards, the
// lead on part 1 only. Built-in themes keep the point mode.
import assert from 'node:assert/strict';
import {pageComponents,componentCounts,componentParts,componentRule,bareHeading} from './lib/ppt-card-blocks.mjs';
import {cardTopicTask,sanitizeCardTopic,acceptCardTopic,foldExtraCards,rescueForeignExcerpts,mixedLatin} from './lib/ppt-outline-cards.mjs';
import {normalizePaste} from './lib/ppt-source.mjs';
import {defaultGenerationPolicy} from './lib/ppt-generation-policy.mjs';

const slot=role=>({role});
const page=(role,...roles)=>({pageRole:{role},textSlots:[slot('title'),...roles.map(slot)]});
const pair=n=>Array.from({length:n},()=>['point-heading','point-description']).flat();
// Mood-Board-like pages: 2, 4, 4, 2 (+ a sub-title body), 3 components; a cover and an 8-part agenda count nothing.
const profile={pages:[page('cover','body'),page('content',...pair(8)),page('content',...pair(2)),page('content','body',...pair(4)),page('content','body',...pair(4)),page('content',...pair(2),'body'),page('content',...pair(3))]};
assert.equal(pageComponents(profile.pages[3]),4,'a sub-title body is no component');
assert.equal(pageComponents(page('content','list','list','list')),3,'list slots count when there are no heading pairs');
const deck=(extra={})=>({templateFidelity:{mode:'preserve',componentProfile:profile},...extra});
assert.deepEqual(componentCounts(deck()),[2,3,4],'S: distinct counts 2..6 of content pages');
assert.deepEqual(componentCounts({templateFidelity:{mode:'theme'}}),[],'a built-in theme keeps the point mode');

assert.deepEqual(componentParts(4,[2,3,4]),[4]);
assert.deepEqual(componentParts(7,[2,3,4]),[4,3],'Fable: 7 parts on {2,3,4} are 4+3');
assert.deepEqual(componentParts(5,[2,3,4]),[3,2],'never 4+1');
assert.deepEqual(componentParts(9,[3,4,6]),[5,4]);

assert.match(componentRule([2,3,4],{han:true}),/k one of 2, 3, 4/u);
assert.match(componentRule([2,3,4],{han:true}),/at most 10 Chinese characters/u);
assert.match(componentRule([3,4,6]),/at most 5 English words.*ONE sentence \(at most 20 English words\)/u);
assert.equal(componentRule([]),'');

// The writer task: the rule and a lead field on an uploaded template only.
const source=normalizePaste('# Doc\n\n## Parts\n\nThe agent has a vision model, a memory model and a controller.\n\nVision compresses frames.\n\nMemory predicts the next code.\n\nThe controller acts.\n\nTraining runs in a dream.\n\nTransfer works.\n');
const ids=source.semantic.inventory.items.map(item=>item.id);
const p={...deck(),source,generationPolicy:defaultGenerationPolicy(),inputUnderstanding:{primaryLanguage:'en',sections:[]},planningContract:{contentMode:'concise',logicalCards:[]}};
const card={id:'c1',title:'Parts',intent:'',points:[]};
{const task=cardTopicTask(p,card,1);
 assert.match(task.prompt,/content layouts hold 2, 3, 4 parallel components/u);
 assert.ok(task.schema.properties.pages.items.properties.lead,'pages carry a lead');
 const plain=cardTopicTask({...p,templateFidelity:undefined},card,1);
 assert.ok(!/parallel components/u.test(plain.prompt)&&!plain.schema.properties.pages.items.properties.lead,'no rule, no lead without a template');}

// Six parallel blocks on {2,3,4}: two cards of 3, the lead on part 1 only.
const task={card,ids,objectIds:[],requiredIds:[],quota:1};
const six=ids.slice(0,6).map((id,k)=>({label:'Part '+(k+1),text:'Part '+(k+1)+' does one thing.',sourceUnitIds:[id]}));
{const {reply:{pages},advisories}=sanitizeCardTopic(p,task,{pages:[{title:'The Agent Has Six Parts',lead:'Each part is trained on its own.',visualIntent:'text',points:six,objects:[]}]});
 assert.deepEqual(pages.map(item=>item.points.length),[3,3]);
 assert.equal(pages[0].lead,'Each part is trained on its own.');assert.equal(pages[1].lead,undefined,'parts 2..n carry no lead');
 assert.match(pages[1].title,/\(cont\.\)$/u,'the later part is marked continued, numbered later');
 assert.ok(advisories.some(note=>note.code==='card_component_split'));}
{const accepted=acceptCardTopic(p,task,{pages:[{title:'The Agent Has Six Parts',lead:'Each part is trained on its own.',numbered:false,visualIntent:'text',points:six,objects:[]}]});
 assert.deepEqual(accepted.pages.map(item=>item.points.length),[3,3],'the accepted path too');}
// A numbered list keeps its own cap; four blocks stay one card.
{const {reply:{pages}}=sanitizeCardTopic(p,task,{pages:[{title:'Steps',numbered:true,visualIntent:'process',points:six,objects:[]}]});
 assert.equal(pages.length,1,'a numbered list is not cut by components');
 const {reply:{pages:four}}=sanitizeCardTopic(p,task,{pages:[{title:'Four Parts',visualIntent:'text',points:six.slice(0,4),objects:[]}]});
 assert.equal(four.length,1);}
// A two-point card never merges back past the largest component layout (live
// 3197: a 3+2 split on {2,3,4} was merged into five by D3).
{const {cardIntegrity}=await import('./lib/ppt-card-outline.mjs');
 const pt=id=>({text:'Point '+id+' says one thing.',sourceUnitIds:[id]}),slide=(id,points)=>({id,logicalCardId:'L',title:'Six Parts'+(id==='b'?' (cont.)':''),keyPoints:points,cardObjects:[],sourceUnitIds:points.flatMap(x=>x.sourceUnitIds)});
 const raw={slides:[{id:'c',title:'Cover'},slide('a',[pt(ids[0]),pt(ids[1]),pt(ids[2])]),slide('b',[pt(ids[3]),pt(ids[4])])]};
 cardIntegrity(p,raw,{logicalCards:[{id:'cover'},{id:'L',sourceUnitIds:ids}]});
 assert.deepEqual(raw.slides.slice(1).map(item=>item.keyPoints.length),[3,2],'3+2 stays: five would pass the largest layout (4)');
 const plainRaw={slides:[{id:'c',title:'Cover'},slide('a',[pt(ids[0]),pt(ids[1]),pt(ids[2])]),slide('b',[pt(ids[3]),pt(ids[4])])]};
 cardIntegrity({...p,templateFidelity:undefined},plainRaw,{logicalCards:[{id:'cover'},{id:'L',sourceUnitIds:ids}]});
 assert.deepEqual(plainRaw.slides.slice(1).map(item=>item.keyPoints.length),[5],'a built-in theme keeps D3');}
// The lead: a template sub-title slot shows it; else one line under the title
// when nothing there clashes; else the first line of the notes.
{const {subtitleSlot}=await import('./lib/ppt-card-pages.mjs');
 const {bindCardLead}=await import('./lib/ppt-title-hierarchy.mjs');
 const {leadNotes}=await import('./lib/ppt-card-language.mjs');
 const IN=914400,text=(id,x,y,w,h)=>({type:'text',nativeRef:{shapeId:id},geometry:{x,y,width:w*IN,height:h*IN},style:{fontSizePt:12},content:{text:'x'}});
 const spec={slots:[{role:'title',shapeId:1},{role:'content',purpose:'body',shapeId:2},{role:'content',purpose:'point-heading',shapeId:3},{role:'content',purpose:'point-description',shapeId:4},{role:'content',purpose:'point-heading',shapeId:5}],
  nodes:[text(1,.7*IN,.5*IN,11,.6),text(2,.7*IN,1.2*IN,11,.4),text(3,.7*IN,2.2*IN,5,.3),text(4,.7*IN,2.6*IN,5,.8),text(5,6.5*IN,2.2*IN,5,.3)]};
 assert.equal(subtitleSlot(spec)?.shapeId,2,'the wide body slot under the title is the sub-title slot');
 assert.equal(subtitleSlot({...spec,nodes:spec.nodes.map(n=>n.nativeRef.shapeId===2?{...n,geometry:{...n.geometry,width:4*IN}}:n)}),null,'a narrow box is a component');
 const project=(lead,extra=[])=>({planningContract:{flow:'cards'},templateFidelity:{width:12192000,height:6858000},outline:[{id:'c'},{id:'p',lead}],deck:{slides:[{id:'c',nodes:[]},{id:'p',nodes:[{id:'t',type:'text',semanticRole:'title',geometry:{x:.7*IN,y:.5*IN,width:11*IN,height:.6*IN},style:{fontSizePt:28,color:'#222222'},content:{text:'Title'}},...extra]}]}});
 const free=project('One sentence that sets the context.');bindCardLead(free,free.deck.slides[1],1);
 assert.ok(free.deck.slides[1].nodes.some(n=>n.semanticRole==='card-lead'),'drawn in the free band');
 assert.deepEqual(leadNotes(free),[],'a drawn lead is not in the notes');
 const busy=project('One sentence that sets the context.',[{id:'b',type:'text',geometry:{x:.7*IN,y:1.15*IN,width:11*IN,height:1*IN},content:{text:'component'}}]);bindCardLead(busy,busy.deck.slides[1],1);
 assert.ok(!busy.deck.slides[1].nodes.some(n=>n.semanticRole==='card-lead'),'a component in the band: the lead never moves it');
 assert.deepEqual(leadNotes(busy).map(note=>note.text),['One sentence that sets the context.'],'the lead goes to the notes');}
// More cards than the quota are folded into the quota's last card, never sent
// back for their count (Fable 2026-11-03, Q1); blocks past eight go to the notes.
{assert.match(cardTopicTask(p,card,1).prompt,/one card may carry up to 8 blocks/u);
 const L='ABCDEFGHI',block=(k,id)=>({label:'Part '+L[k-1],text:'Part '+L[k-1]+' does one thing.',sourceUnitIds:[id]});
 const cards=[0,1,2].map(c=>({title:'Card '+L[c],lead:c?'':'The parts.',numbered:false,visualIntent:'text',points:[0,1,2].map(j=>block(c*3+j+1,ids[(c*3+j)%ids.length])),objects:[]}));
 const notes=[],folded=foldExtraCards(p,task,cards,notes);
 assert.equal(folded.length,1);assert.equal(folded[0].title,'Card A','the first card\'s title');
 assert.equal(folded[0].points.length,8);assert.deepEqual(folded[0].notePoints.map(note=>note.text),['Part I：Part I does one thing.']);
 assert.ok(notes.some(note=>note.code==='card_cards_folded'));
 assert.equal(foldExtraCards({...p,templateFidelity:undefined},task,cards),cards,'a built-in theme keeps the count check');
 const accepted=acceptCardTopic(p,task,{pages:cards});
 assert.deepEqual(accepted.pages.map(item=>item.points.length),[4,4],'accepted, then cut 4+4');}
// Source excerpts not in the deck's language (Fable 2026-11-03, Q2 A): one slim
// call writes them in the deck's language; else they go to the notes, flagged.
{const zh={...p,generationPolicy:{...p.generationPolicy,language:{mode:'output',locale:'zh-CN'}}};
 const sanitized=sanitizeCardTopic(zh,task,null);
 assert.ok(sanitized.advisories.some(note=>note.code==='card_topic_excerpts'));
 const shown=sanitized.reply.pages.flatMap(item=>item.points);
 assert.ok(shown.length&&shown.every(point=>point.excerpt),'the fallback marks its excerpts');
 let asked=null;
 const rescued=await rescueForeignExcerpts(zh,task,sanitized,async(prompt,schema)=>{asked={prompt,schema};return{points:shown.map(point=>({text:'这一部分说明一个要点。',sourceUnitIds:point.sourceUnitIds}))};});
 assert.match(asked.prompt,/Simplified Chinese/u);assert.equal(asked.schema.properties.points.minItems,shown.length);
 const written=rescued.reply.pages.flatMap(item=>item.points);
 assert.ok(written.every(point=>point.text==='这一部分说明一个要点。'&&!('excerpt' in point)),'rewritten, marks removed');
 assert.ok(rescued.advisories.some(note=>note.code==='card_excerpts_rewritten'));
 const english=await rescueForeignExcerpts(zh,task,sanitized,async()=>({points:shown.map(point=>({text:'Still English text here.',sourceUnitIds:point.sourceUnitIds}))}));
 assert.ok(english.reply.pages.every(item=>!item.points.length&&item.excerptNotes),'a reply still in English: the slides show no excerpt');
 assert.deepEqual(english.reply.pages.flatMap(item=>item.notePoints.map(note=>note.text)),shown.map(point=>point.text),'every excerpt is in the notes');
 assert.ok(english.advisories.some(note=>note.code==='card_excerpts_to_notes'&&note.severity==='warning'));
 const failed=await rescueForeignExcerpts(zh,task,sanitized,async()=>{throw Object.assign(new Error('timeout'),{code:'timeout'});});
 assert.ok(failed.advisories.some(note=>note.code==='card_excerpts_to_notes'),'a failed call: the notes');
 const same=await rescueForeignExcerpts(p,task,sanitizeCardTopic(p,task,null),async()=>{throw new Error('never called');});
 assert.ok(same.reply.pages.flatMap(item=>item.points).every(point=>!('excerpt' in point))&&same.reply.pages.some(item=>item.points.length),'same-language excerpts stay, unmarked');}
// An English clause in a Chinese deck's point takes the same slim call (Fable Q4, live f7f0f000 p14).
{const zh={...p,generationPolicy:{...p.generationPolicy,language:{mode:'output',locale:'zh-CN'}}};
 assert.equal(mixedLatin(zh,'距 MAE 不足 1%，trained for 5.3 times less epochs'),'trained for 5.3 times less epochs');
 for(const kept of ['ViT-H/16 top-1 达 87.1','采用 Joint Embedding Predictive Architecture','微调 50 epochs，用 AdamW'])assert.equal(mixedLatin(zh,kept),'',kept);
 assert.equal(mixedLatin(p,'trained for 5.3 times less epochs'),'','an English deck');
 const ids=task.ids.slice(0,1),mixed={reply:{pages:[{title:'微调',points:[{text:'与 MAE 相当，trained with far fewer epochs overall',sourceUnitIds:ids},{text:'中文要点保持不变。',sourceUnitIds:ids}]}]},advisories:[]};
 let passage='';
 const fixed=await rescueForeignExcerpts(zh,task,mixed,async prompt=>{passage=prompt;return{points:[{text:'与 MAE 相当，训练轮数少得多',sourceUnitIds:ids}]};});
 assert.match(passage,/trained with far fewer epochs/u,'the passage is the point itself');
 assert.deepEqual(fixed.reply.pages[0].points.map(point=>point.text),['与 MAE 相当，训练轮数少得多','中文要点保持不变。']);
 const kept=await rescueForeignExcerpts(zh,task,mixed,async()=>({points:[{text:'still trained with far fewer epochs',sourceUnitIds:ids}]}));
 assert.deepEqual(kept.reply.pages[0].points.map(point=>point.text),['中文要点保持不变。']);
 assert.equal(kept.reply.pages[0].notePoints[0].text,'与 MAE 相当，trained with far fewer epochs overall','still mixed: the notes, flagged');
 assert.ok(kept.advisories.some(note=>note.severity==='warning'));}
// A card of bare headings is sent back on an uploaded template (3197 1d8eb0d2 p15).
{assert.equal(bareHeading('梦境训练的优势'),true);assert.equal(bareHeading('独立VAE的局限'),true);
 assert.equal(bareHeading('智能体可在潜在空间梦境中训练，避免渲染开销。'),false);assert.equal(bareHeading('Training in the dream'),true);
 assert.equal(bareHeading('The agent trains inside its own dream and transfers the policy.'),false);
 const bare=[{text:'Dream training upsides',sourceUnitIds:[ids[0]]},{text:'Independent VAE limits',sourceUnitIds:[ids[1]]}];
 assert.throws(()=>acceptCardTopic(p,task,{pages:[{title:'Dreams Have Upsides and Limits',numbered:false,visualIntent:'comparison',points:bare,objects:[]}]}),/headings without a sentence/u);
 const labelled=bare.map((point,k)=>({...point,label:['Upside','Limit'][k],text:k?'An independently trained VAE may encode features the task does not need.':'Training in the dream avoids rendering the game state.'}));
 assert.doesNotThrow(()=>acceptCardTopic(p,task,{pages:[{title:'Dreams Have Upsides and Limits',numbered:false,visualIntent:'comparison',points:labelled,objects:[]}]}));
 assert.doesNotThrow(()=>acceptCardTopic({...p,templateFidelity:undefined},task,{pages:[{title:'Dreams Have Upsides and Limits',numbered:false,visualIntent:'comparison',points:bare,objects:[]}]}),'a built-in theme keeps the point mode');}
console.log('PASS card blocks: component counts from the template, k blocks with a lead, even k/n splits, lead in the sub-title slot, the band or the notes, built-in themes unchanged');

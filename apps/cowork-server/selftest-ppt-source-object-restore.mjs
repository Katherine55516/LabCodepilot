// A required source object that no card shows is restored by code (Fable
// 2026-10-26; mlq i1: three tables and a taxonomy on no card, published
// without them): on its section's card, else on a card of its own after the
// nearest earlier unit; what cannot be placed within the page limit blocks
// confirmation until the author places it. A policy-excluded object stays out.
// Since the hand deck (2026-11-02 evening) a table goes to its card's notes.
import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {restoreSourceObjects,unplacedSourceObjects} from './lib/ppt-card-outline.mjs';
import {recordTable} from './lib/ppt-card-pages.mjs';
import {defaultGenerationPolicy} from './lib/ppt-generation-policy.mjs';
const long=k=>`Trap ${k} explained at length: `+'the model sees tomorrow in today\'s features and the backtest looks better than any live run could. '.repeat(5);
const source=normalizePaste(`# Doc\n\n## Traps\n\nTraps are common in financial ML.\n\n| Trap | Fix |\n|---|---|\n| ${long(1)} | Purge |\n| ${long(2)} | Embargo |\n| ${long(3)} | Lag |\n\n## Other\n\nOther text about validation.\n\n## Code\n\n\`\`\`python\nprint(1)\n\`\`\`\n\n## Lone\n\nA short note.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |`);
const items=source.semantic.inventory.items,unit=pred=>items.find(pred);
const traps=unit(item=>item.type==='TableBlock'&&String(item.text).includes('Purge')),lone=unit(item=>item.type==='TableBlock'&&String(item.text).includes('| 1 |'));
const code=unit(item=>item.type==='CodeBlock'),trapsText=unit(item=>/Traps are common/.test(item.text)),other=unit(item=>/Other text/.test(item.text));
const p={source,generationPolicy:{...defaultGenerationPolicy(),code:{presentation:'omit'}},planningContract:{}};
const card=(id,title,ids)=>({id,logicalCardId:'logical_'+id,title,focus:title,section:title,keyPoints:ids.map(i=>({text:'Point from '+i,sourceUnitIds:[i]})),sourceUnitIds:ids,cardObjects:[]});
const raw={slides:[{id:'cover',title:'Doc',keyPoints:[]},card('a','Traps',[trapsText.id]),card('b','Other',[other.id])]};
const notes=restoreSourceObjects(p,raw,{logicalCards:[]});
// A table no card cites goes whole into the speaker notes of its section's
// card, else the card citing the nearest earlier unit; never a card or page
// of its own (the hand deck, 2026-11-02 evening).
const noted=(slide,id)=>(slide.notePoints||[]).filter(note=>note.sourceUnitIds?.[0]===id);
assert.ok(!raw.slides[1].cardObjects.includes(traps.id)&&noted(raw.slides[1],traps.id).length===1+traps.rows.length-1,'the table is in its section card\'s notes, header and every row');
assert.ok(recordTable(traps),'it is still a record table by shape');
assert.ok(!raw.slides.some(slide=>slide.restoredObject),'no card of its own');
assert.ok(noted(raw.slides[2],lone.id).length>1,'a section with no card: the card citing the nearest earlier unit ("Other") holds it');
assert.ok(!raw.slides.some(slide=>(slide.cardObjects||[]).includes(code.id)),'a policy-excluded object stays out');
assert.deepEqual(notes.map(note=>note.code),['source_table_to_notes','source_table_to_notes']);
assert.equal(raw.unplacedObjects,undefined);
// At the page limit and with an exact page count alike: notes, never a page, never blocking.
const filled=()=>({slides:[{id:'cover',title:'Doc',keyPoints:[]},card('a','Traps',[trapsText.id]),...Array.from({length:38},(_,k)=>card('x'+k,'Filler '+k,[other.id]))]});
for(const q of [p,{...p,planningContract:{settings:{length:{exact:40}}}}]){const atCap=filled();restoreSourceObjects(q,atCap,{logicalCards:[]});
 assert.equal(atCap.unplacedObjects,undefined,'nothing is left unplaced');assert.equal(atCap.slides.length,40,'no page is added');
 assert.ok(atCap.slides.some(slide=>noted(slide,lone.id).length),'it is in a card\'s notes');}
// What code could not place blocks confirmation until the author places it.
{const full={slides:filled().slides,unplacedObjects:[lone.id]},project={...p,outline:full.slides,planningContract:{cardOutline:{raw:full}}};
 assert.deepEqual(unplacedSourceObjects(project),[lone.id],'confirmation refuses while it is on no card');
 assert.deepEqual(unplacedSourceObjects({...project,outline:[...full.slides,{id:'z',cardObjects:[lone.id]}]}),[],'placed by the author: no longer blocking');}
// Text never makes a card of its own, and a new card's title is in the deck's language (gamma-http).
{const zh=normalizePaste('# Doc\n\n## Intro\n\nAn English opening paragraph about the deck.\n\n## 核心结论\n\n- 第一条结论\n- 第二条结论\n- 第三条结论\n\n## 数据表\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
 const list=zh.semantic.inventory.items,intro=list.find(item=>/English opening/.test(item.text)),summary=list.find(item=>item.must_preserve_structure&&!item.rows),table=list.find(item=>item.rows);
 const q={source:zh,generationPolicy:{...defaultGenerationPolicy(),language:{mode:'output',locale:'en'}},inputUnderstanding:{primaryLanguage:'en'},planningContract:{}};
 const deck={slides:[{id:'cover',title:'Doc',keyPoints:[]},card('i','Opening',[intro.id])]};
 restoreSourceObjects(q,deck,{logicalCards:[]});
 // A Chinese list in an English deck is never drawn untranslated: it goes to the nearest earlier card's notes (live 3197, 2026-11-02).
 if(summary)assert.ok(!deck.slides.some(slide=>(slide.keyPoints||[]).some(point=>point.sourceUnitIds.includes(summary.id)))&&deck.slides[1].notePoints.some(note=>note.sourceUnitIds.includes(summary.id))&&!deck.slides.some(slide=>slide.restoredObject&&slide.keyPoints.length),'a foreign-language list goes to the notes');
 assert.ok(!deck.slides.some(slide=>slide.restoredObject)&&(deck.slides[1].notePoints||[]).some(note=>note.sourceUnitIds?.[0]===table.id),'a table goes to the notes, no card titled by its heading');
 assert.ok(deck.slides[1].notePoints.find(note=>note.tableHeader).text.startsWith('Table'),'notes in the deck\'s output language');}
// A full card gets a continuation card for restored text, never more than five points (gamma-http).
{const zh=normalizePaste('# Doc\n\n## Intro\n\nOpening paragraph one.\n\n## Lists\n\n- alpha item\n- beta item\n- gamma item');
 const list=zh.semantic.inventory.items,intro=list.find(item=>/Opening/.test(item.text)),summary=list.find(item=>item.must_preserve_structure);
 if(summary){const q={source:zh,generationPolicy:defaultGenerationPolicy(),inputUnderstanding:{primaryLanguage:'en'},planningContract:{}};
  const full={...card('f','Opening',[intro.id]),keyPoints:Array.from({length:5},(_,k)=>({text:'Point '+k,sourceUnitIds:[intro.id]}))};
  const deck={slides:[{id:'cover',title:'Doc',keyPoints:[]},full]};restoreSourceObjects(q,deck,{logicalCards:[]});
  assert.equal(deck.slides[1].keyPoints.length,5,'the full card stays at five points');
  assert.ok(deck.slides[2]?.restoredFrom==='f'&&/\(cont\.\)/.test(deck.slides[2].title)&&deck.slides[2].keyPoints[0].sourceUnitIds.includes(summary.id),'the list goes to a continuation card: '+JSON.stringify(deck.slides[2]?.title));}}
console.log('PASS source object restore: a missed table goes to its card\'s notes, policy exclusion, unplaced objects block confirmation');

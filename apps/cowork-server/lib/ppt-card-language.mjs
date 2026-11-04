/** Card deck language (D7, 2026-10-23): the author picks bilingual, English or
 * Chinese in the settings form; a bilingual source (60%+ of its units paired)
 * defaults to bilingual, any other source to its primary language. With
 * "notes in the other language", each slide's speaker notes carry the source's
 * own text in the language the slides leave out: the paired units of what the
 * slide cites, verbatim, so the notes add no model-written text. A leaf module:
 * the outline, the planning command and the export manifest all use it. */
import {richTextContent} from './ppt-rich-text.mjs';
// 繁體中文 (the user, 2026-10-31) is the existing zh-HK output locale, labelled generically.
export const LANGUAGE_CHOICES=Object.freeze(['bilingual','en','zh','zh-Hant']);
/** Chinese, simplified or traditional. */
export const chineseChoice=choice=>choice==='zh'||choice==='zh-Hant';
const hantLocale=locale=>/^zh-(?:HK|TW|Hant)/iu.test(String(locale||''));
/** Text for the deck's language: simplified, traditional or English. */
const textFor=(p,zh,hant,en)=>{const choice=languageChoice(p);return choice==='zh-Hant'?hant:choice==='zh'?zh:en;};
const HAN=/\p{Script=Han}/gu;
const hanShare=text=>{const t=String(text||''),han=(t.match(HAN)||[]).length,latin=(t.match(/[A-Za-z]/gu)||[]).length;return han+latin?han/(han+latin/2):0;};
const items=p=>p?.originalSourceInventory?.items||p?.source?.semantic?.inventory?.items||[];

export function defaultLanguageChoice(structure){
 return structure?.bilingual?'bilingual':hantLocale(structure?.primaryLanguage)?'zh-Hant':String(structure?.primaryLanguage||'en').startsWith('zh')?'zh':'en';
}
/** The generation policy's language for a choice. */
export function languagePolicy(choice){
 if(!LANGUAGE_CHOICES.includes(choice))throw Object.assign(new Error('Choose bilingual, English, Simplified or Traditional Chinese.'),{statusCode:400});
 return choice==='bilingual'?{mode:'source',body:'both'}:{mode:'output',locale:choice==='zh-Hant'?'zh-HK':choice};
}
/** The choice a project's policy stands for (the settings form shows it). */
export function languageChoice(p){
 const language=p?.generationPolicy?.language||{};
 if(language.mode==='output')return hantLocale(language.locale)?'zh-Hant':String(language.locale||'en').startsWith('zh')?'zh':'en';
 if(language.body==='both')return 'bilingual';
 const primary=p?.inputUnderstanding?.primaryLanguage;
 return hantLocale(primary)?'zh-Hant':String(primary||'en').startsWith('zh')?'zh':'en';
}
export const localeName=locale=>({en:'English',zh:'Simplified Chinese','zh-HK':'Traditional Chinese','zh-Hant':'Traditional Chinese'})[locale]||'English';

/** Speaker notes in the other language, one entry per slide that cites a
 * paired unit: [{index,sourceUnitIds,text}]. Empty unless the author asked
 * for them on a single-language card deck. */
export function cardLanguageNotes(p){
 const choice=languageChoice(p);
 if(!p?.planningContract?.notesOther||choice==='bilingual')return [];
 const list=items(p),byId=new Map(list.map(item=>[item.id,item])),order=new Map(list.map((item,index)=>[item.id,index]));
 const pairs=new Map();for(const item of list)if(item.languagePairId)pairs.set(item.languagePairId,[...(pairs.get(item.languagePairId)||[]),item]);
 const other=item=>(hanShare(item.text)>.5)!==chineseChoice(choice);
 const outline=new Map((p.outline||[]).map(slide=>[slide.id,slide]));
 return (p.deck?.slides||[]).flatMap((slide,index)=>{
  const plan=outline.get(slide.id)||slide;
  const cited=[...new Set([...(plan.sourceUnitIds||[]),...(plan.keyPoints||[]).flatMap(point=>point.sourceUnitIds||[])])];
  const units=[...new Set(cited.flatMap(id=>{const item=byId.get(id);if(!item)return [];const group=item.languagePairId?pairs.get(item.languagePairId)||[item]:[item];return group.filter(unit=>!unit.rows&&String(unit.text||'').trim()&&other(unit)).map(unit=>unit.id);}))].sort((a,b)=>order.get(a)-order.get(b));
  if(!units.length)return [];
  let text='';for(const id of units){const next=String(byId.get(id).text).trim();if(text.length+next.length>4000)break;text+=(text?'\n\n':'')+next;}
  return text?[{index,sourceUnitIds:units,text}]:[];
 });
}
/** Two note lists merged per slide (texts joined, sources concatenated). */
/** Units read from PDF pages with typeset math, which the user confirmed are
 * read as approximate text (Fable 2026-10-26): unit id -> those page numbers. */
export function approximateFormulaUnits(p){
 const warnings=p?.source?.mediaWarnings||[];
 const pages=new Set(warnings.filter(w=>w.code==='source_pdf_math_requires_confirmation').flatMap(w=>w.pages||[]));
 const pdfMath=warnings.some(w=>['source_pdf_math_text','source_pdf_math_requires_confirmation'].includes(w.code));
 if(!pages.size&&!pdfMath)return new Map();
 const pageOf=new Map((p.source?.segments||[]).map(segment=>[String(segment.id),Number(String(segment.location||'').match(/第\s*(\d+)\s*页/u)?.[1])]));
 // A unit whose own extracted text does not typeset is approximate too
 // (CodePilot PDF on Blue, 2026-11-01: its page 41 was missing from the warning's pages).
 const garbled=item=>pdfMath&&!item.rows&&richTextContent(String(item.text||'')).richText.diagnostics.some(diagnostic=>/^math_/u.test(diagnostic.code));
 return new Map(items(p).map(item=>{const own=[...new Set((item.source_ref||[]).map(ref=>pageOf.get(String(ref))).filter(Number.isFinite))];return[item.id,garbled(item)?own:own.filter(n=>pages.has(n))];}).filter(([,list])=>list.length));
}
/** The math pages a page's cited units come from. */
export function approximateFormulaPages(slide,units){
 const cited=[...new Set([...(slide?.sourceUnitIds||[]),...(slide?.cardObjects||[]),...(slide?.keyPoints||[]).flatMap(point=>point.sourceUnitIds||[])])];
 return [...new Set(cited.flatMap(id=>units.get(id)||[]))].sort((a,b)=>a-b);
}
/** Speaker notes on those deck pages: the formulas are approximate text. */
export function approximateFormulaNotes(p){
 const units=approximateFormulaUnits(p);if(!units.size)return [];
 const outline=new Map((p.outline||[]).map(slide=>[slide.id,slide]));
 return (p.deck?.slides||[]).flatMap((slide,index)=>{const pages=approximateFormulaPages(outline.get(slide.id)||slide,units);
  return pages.length?[{index,sourceUnitIds:[],text:textFor(p,`本页公式从排版 PDF（第 ${pages.join('、')} 页）按文本读取，可能与原式不完全一致。`,`本頁公式從排版 PDF（第 ${pages.join('、')} 頁）按文字讀取，可能與原式不完全一致。`,`Formulas on this page were read as text from a typeset PDF (page ${pages.join(', ')}) and may differ from the original.`)}]:[];});
}
/** A figure beside its points shows its caption's first sentence; the page's
 * notes carry the full caption (Fable 2026-11-02, P2). */
export function shortenedCaptionNotes(p){
 const images=new Map((p.source?.images||[]).map(image=>[image.id,image]));
 return (p.deck?.slides||[]).flatMap((slide,index)=>{
  const full=(slide.nodes||[]).filter(node=>node.content?.captionShortened&&images.get(node.content.sourceImageCaptionId)?.caption).map(node=>String(images.get(node.content.sourceImageCaptionId).caption).trim());
  return full.length?[{index,sourceUnitIds:[],text:full.join('\n\n')}]:[];});
}
/** Optional figures the card outline left out (appendix below the full
 * length, Fable F3; uncited figures below the full length, the user
 * 2026-10-31) are named on the closing page's speaker notes. */
export function optionalFigureNotes(p){
 const ids=p?.planningContract?.cardOutline?.raw?.optionalFigures||[],slides=p?.deck?.slides||[];
 if(!ids.length||!slides.length)return [];
 const captions=ids.map(id=>String((p.source?.images||[]).find(image=>image.id===id)?.caption||id).split('\n')[0].slice(0,80));
 return [{index:slides.length-1,sourceUnitIds:[],text:textFor(p,'未在幻灯片中展示的图：','未在投影片中展示的圖：','Figures not shown on the slides: ')+captions.join('; ')}];
}
/** What a length-capped card deck leaves unexpanded (Fable D5, 2026-11-01):
 * source chapters with no page and high-priority topics no page covers. They
 * are named on the closing page's speaker notes, so the cut is stated. */
export function omittedCoverage(p){
 const coverage=p?.planning?.coverage||[];if(!coverage.length||!p?.planningContract?.cardOutline)return{chapters:[],topics:[]};
 const included=new Set(coverage.filter(item=>item.action==='included').map(item=>item.chunkId));
 const chapters=(p.planning?.sourceCapacity?.sections||[]).filter(chapter=>Number(chapter.sourceTokens)>=200&&!(chapter.chunkIds||[]).some(id=>included.has(id))).map(chapter=>String(chapter.title||'').trim()).filter(Boolean);
 const topics=coverage.filter(item=>item.priority==='high'&&item.action==='unmapped').map(item=>String(item.topic||'').trim()).filter(Boolean);
 return{chapters,topics};
}
export function omittedCoverageNotes(p){
 const slides=p?.deck?.slides||[],{chapters,topics}=omittedCoverage(p),bare=name=>name.replace(/^(?:[A-Z]?\d+(?:[ .]\d+)*[.)]?\s+)/u,'').trim()||name,names=[...new Set([...chapters,...topics].map(bare))];
 if(!names.length||!slides.length)return[];
 // Shown without the source's section numbers ("13 1 单位换算…").
 return[{index:slides.length-1,sourceUnitIds:[],text:textFor(p,'篇幅所限未展开的内容：','篇幅所限未展開的內容：','Not expanded within this length: ')+names.slice(0,40).join('; ')}];
}
/** Tables a quick or standard deck leaves out (a card's second table no point
 * cites, the user 2026-10-31) are named on the closing page's speaker notes. */
export function optionalTableNotes(p){
 const ids=p?.planningContract?.cardOutline?.raw?.optionalTables||[],slides=p?.deck?.slides||[];
 if(!ids.length||!slides.length)return [];
 const byId=new Map(items(p).map(item=>[item.id,item]));
 const names=ids.map(id=>String(byId.get(id)?.sectionPath?.at(-1)||id).replace(/^(?:(?:[A-Z][.)]?)?\d+(?:\.\d+)*(?:[.)]\s*|\s+))+/u,'').slice(0,80));
 return [{index:slides.length-1,sourceUnitIds:[],text:textFor(p,'未在幻灯片中展示的表格：','未在投影片中展示的表格：','Tables not shown on the slides: ')+names.join('; ')}];
}
/** A cover shown as the translation of a foreign source title keeps the
 * original in its speaker notes (Fable 2026-10-26: provenance, never on the slide). */
/** The source's full cover title when the cover shows a headline cut from it
 * (Fable option Q, 2026-11-01: the last resort when no size or frame growth
 * fits); '' otherwise. */
export function shortenedCoverTitle(p){
 const cover=(p?.outline||[])[0],raw=p?.planningContract?.cardOutline?.raw?.slides?.[0];
 // Only a headline the model cut from the title is marked (a generic "Sheet1" renamed by the model is not; Fable).
 const original=String(cover?.coverSourceTitle||raw?.coverSourceTitle||'').trim(),shown=String(cover?.title||'').trim();
 return cover&&(cover.coverShortened||raw?.coverShortened)&&!cover.coverTranslation&&original&&shown&&original!==shown?original:'';
}
export function coverSourceNotes(p){
 const cover=(p.outline||[])[0],original=String(cover?.coverSourceTitle||'').trim();
 if(!(p.deck?.slides||[]).length)return [];
 // A shortened headline keeps the full title in the cover's notes.
 const full=shortenedCoverTitle(p);
 if(full)return [{index:0,sourceUnitIds:[],text:(/\p{Script=Han}/u.test(full)?'完整标题：':'Full title: ')+full}];
 if(!cover?.coverTranslation||!original||original===cover.coverTranslation)return [];
 return [{index:0,sourceUnitIds:[],text:(/\p{Script=Han}/u.test(cover.coverTranslation)?'原标题：':'Original title: ')+original}];
}
/** Points of a table card that did not fit beside its table, below the full
 * length (the user, 2026-10-31), are the speaker notes of that page. */
export function tableCardPointNotes(p){
 // The outline the author confirms does not carry notePoints; the card plan does (docx 2026-10-31: no notes exported).
 const outline=new Map((p?.outline||[]).map(slide=>[slide.id,slide])),planned=new Map((p?.planningContract?.cardOutline?.raw?.slides||[]).map(slide=>[slide.id,slide]));
 return (p?.deck?.slides||[]).flatMap((slide,index)=>{const points=outline.get(slide.id)?.notePoints||planned.get(slide.id)?.notePoints||[];if(!points.length)return [];
  return [{index,sourceUnitIds:[...new Set(points.flatMap(point=>point.sourceUnitIds||[]))],text:points.map(point=>'• '+String(point.text||point)).join('\n')}];});
}
/** A card's lead that no page shows (no sub-title slot and no free band under
 * the title) is the first line of its speaker notes (Fable G4, 2026-11-02). */
export function leadNotes(p){
 const outline=new Map((p?.outline||[]).map(slide=>[slide.id,slide]));
 return (p?.deck?.slides||[]).flatMap((slide,index)=>{const lead=outline.get(slide.id)?.lead;
  if(!lead||(slide.nodes||[]).some(node=>node.semanticRole==='card-lead'||String(node.content?.text||'').trim()===String(lead).trim()))return [];
  return [{index,sourceUnitIds:[],text:String(lead)}];});
}
export function mergeNotes(...lists){
 const merged=new Map();
 for(const note of lists.flat()){const old=merged.get(note.index);merged.set(note.index,old?{index:note.index,sourceUnitIds:[...old.sourceUnitIds,...note.sourceUnitIds],text:old.text+'\n\n'+note.text}:{...note});}
 return [...merged.values()].sort((a,b)=>a.index-b.index);
}
/** Speaker notes for the card points a slide does not show (3197 85a2621c
 * p5, the user 2026-11-03: every outline point is on its slide or in its
 * notes): points the number guard moved off the slide, and, as a last net,
 * any outline point whose words the slide's visible text does not hold. */
export function unshownPointNotes(project){
 const slides=project.deck?.slides||[],outline=project.outline||[];
 const key=text=>String(text||'').replace(/\$[^$]*\$/gu,'').replace(/[\s\p{P}\p{S}]+/gu,'').toLocaleLowerCase();
 return slides.flatMap((slide,index)=>{
  const page=outline.find(item=>item.id===slide.id)||outline[index];
  const moved=Array.isArray(slide.guardNotePoints)?slide.guardNotePoints:[];
  const shown=key((slide.nodes||[]).filter(node=>!node.hidden).flatMap(node=>[node.content?.text,...(node.content?.items||[]).map(item=>[item.heading,item.body,item.text].join(' '))]).join(' '));
  const missing=page&&!page.figurePage?(page.keyPoints||[]).filter(point=>{const words=key(point.text).slice(0,16);return words&&!shown.includes(words)&&!moved.some(item=>key(item.text).includes(words));}):[];
  const notes=[...moved,...missing.map(point=>({text:String(point.label?`${point.label}：${point.text}`:point.text),sourceUnitIds:point.sourceUnitIds||[]}))];
  return notes.length?[{index,sourceUnitIds:[...new Set(notes.flatMap(note=>note.sourceUnitIds||[]))],text:notes.map(note=>note.text).join('\n')}]:[];
 });
}

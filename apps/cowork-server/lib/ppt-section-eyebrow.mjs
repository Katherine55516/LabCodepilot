import {allowsEditorialSelection} from './ppt-generation-policy.mjs';
import {richTextContent} from './ppt-source-text.mjs';
/** F-P1-11: eyebrow / section-label normalization. The navigation label above
 * a page title is derived from the source heading the page's units come from
 * ("section number + section name" in the deck language), and the whole deck uses one format tier, so pages never
 * mix "1.3 核心张力" with "研究范式" or an English chapter line. */
import {projectedSourceHeading} from './ppt-topic-title-projection.mjs';
import {stableId} from './ppt/ir.mjs';
import {deckLanguage as contractDeckLanguage,topicLanguageRule,pageTopicLanguage} from './ppt-presentation-contract.mjs';
import {templateTextColor,templateBackdrop} from './ppt-template-colors.mjs';
import {visibleNodes} from './ppt-visible-content.mjs';
import {derivedSectionLabelFrame} from './ppt-density-capacity.mjs';
import {unmarkedContinuation} from './ppt-continuation-marker.mjs';
import { visualUnits, compileSectionLabel } from './ppt-presentation-writing.mjs';

const EMU_PT = 12700, CJK = /[㐀-鿿豈-﫿]/u;
const TIERS = ['primary', 'short'];

/** Mermaid branch syntax and arrow counters are provenance, not navigation.
 * A merged page must not advertise just its first branch as the whole page. */
export function diagramEyebrow(project,outlineSlide,value){
 const text=String(value||'');
 if(!project.source?.segments?.some(s=>s.diagram?.kind==='sequence')||!/^\s*(?:alt\s*)?\[\s*\d+[A-Z]?\)/u.test(text))return text;
 const owned=new Set(outlineSlide?.sourceUnitIds||[]);
 const paths=(project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).filter(i=>owned.has(i.id)).map(i=>i.sectionPath?.at(-1)).filter(Boolean);
 if(new Set(paths).size>1)return '';
 return text.replace(/^\s*(?:alt\s*)?\[\s*\d+[A-Z]?\)\s*/u,'').replace(/\]\s*\d*\s*$/u,'').trim();
}

/** `1.3 The central tension: mining power vs. overfitting | 核心张力：…` */
export function parseSourceHeading(value) {
  const raw = String(value || '').replace(/^#+\s*/u, '').trim();
  const match = raw.match(/^((?:\d+\.)*\d+)\.?\s+(.+)$/u);
  const number = match?.[1] || '', rest = match ? match[2] : raw;
  const names = rest.split(/\s+\|\s+|\s*｜\s*/u).map(item => item.trim()).filter(Boolean);
  return { number, names };
}

const shortName = name => {
  const head = String(name).split(/\s*[：:]\s*/u)[0].trim();
  const usable = CJK.test(head) ? visualUnits(head) >= 2 : head.split(/\s+/u).length >= 2 || head.length >= 6;
  return usable ? head : String(name).trim();
};
const isCjk = name => CJK.test(name);

/** Eyebrow language: the deck language only (round 7, B1). The bilingual
 * eyebrow tier of round 5 is withdrawn: topics never pair two languages. */
export function deckLanguage(project) {
  const language = contractDeckLanguage(project);
  return { locale: language === 'zh-Hant' ? 'zh-HK' : language === 'en' ? 'en' : language, bilingual: false };
}

/** Frozen source pages use a heading shared by every owned unit. Legacy
 * outline contracts retain their earlier majority projection. */
export function slideSourceHeading(project, outlineSlide) {
  const semantic = project.source?.semantic || {};
  const items = new Map((semantic.inventory?.items || []).map(item => [item.id, item]));
  const chunks = new Map((semantic.chunks || []).map(chunk => [chunk.id, chunk]));
  const paths = (outlineSlide?.sourceUnitIds || []).map(id => items.get(id)?.sectionPath).filter(Boolean);
  if (!paths.length) for (const id of outlineSlide?.chunkRefs || []) if (chunks.get(id)?.sectionPath) paths.push(chunks.get(id).sectionPath);
  if(outlineSlide?.planningProtocolVersion===2&&paths.length){
    const common=[];
    for(let index=0;index<Math.min(...paths.map(p=>p.length));index++){if(!paths.every(path=>path[index]===paths[0][index]))break;common.push(paths[0][index]);}
    // A page spanning sibling sections belongs to their common parent, or to
    // the source document. Naming only the most frequent child mislabels the
    // other complete sections rendered on that page.
    // A numbered source chapter is stable across physical subpages. A bare
    // example heading (e.g. Traditional PPT Geometry) must not label the next
    // semantic-IR explanation as though it described that example's subject.
    const chapter=project.generationPolicy?.version===2?common.filter(h=>parseSourceHeading(h).number).at(-1):null;
    return chapter||common.at(-1)||null;
  }
  const counts = new Map();
  for (const path of paths) {
    if (path.length < 2) continue; // the document title (H1) is the cover, not a section
    const heading = path[path.length - 1];
    counts.set(heading, (counts.get(heading) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** Semantic overviews can combine source chapters. Use their actual common
 * ancestor rather than labelling the whole page as its first source chapter. */
export function sharedSourceHeading(project,outlineSlide,fallback){
 if(![1,2].includes(project.semanticGrouping?.version)||project.requestedOutline||project.generationPolicy?.content!=='overview'||!allowsEditorialSelection(project))return fallback;
 const owned=new Set([...(outlineSlide?.sourceUnitIds||[]),...(outlineSlide?.sourceArtifactRanges||[]).map(r=>r.sourceUnitId)]);
 const paths=(project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).filter(i=>owned.has(i.id)&&i.sectionPath?.length).map(i=>i.sectionPath);
 if(new Set(paths.map(p=>JSON.stringify(p))).size<2)return fallback;
 const common=[];for(let index=0;index<Math.min(...paths.map(p=>p.length));index++){if(paths.every(p=>p[index]===paths[0][index]))common.push(paths[0][index]);else break;}
 if(common.length>1)return common.at(-1);
 const language=project.generationPolicy?.language,han=/\p{Script=Han}/u.test(project.source?.text||'');
 if(language?.mode==='output')return language.locale==='en'?'Overview':language.locale==='zh-HK'?'綜合概覽':'综合概览';
 return !han?'Overview':/[A-Za-z]/u.test(project.source?.text||'')?'综合概览 | Overview':'综合概览';
}

export function eyebrowCandidates(heading, { locale = 'zh', bilingual = true } = {}, fallbackName = '') {
  const { number, names } = parseSourceHeading(heading);
  const wantCjk = locale !== 'en';
  // The writer may receive a previously derived label on a checkpoint rebind.
  // Strip complete repeated section prefixes before adding the source number once.
  for(let i=0;i<8&&/^\d+(?:\.\d+)*(?:[.)、])?\s+/u.test(fallbackName);i++)fallbackName=fallbackName.replace(/^\d+(?:\.\d+)*(?:[.)、])?\s+/u,'');
  // zh-HK output: the source CJK name may be simplified; keep the writer's
  // localized label behind the source number instead of mixing scripts.
  const primary = locale === 'zh-HK' && !bilingual ? fallbackName : names.find(name => isCjk(name) === wantCjk) || (bilingual ? names[0] : fallbackName);
  if (!primary) return null;
  const secondary = bilingual ? names.find(name => name !== primary && isCjk(name) !== isCjk(primary)) : null;
  const label = (...parts) => [number, ...parts].filter(Boolean).join(' ');
  return {
    bilingual: secondary ? label(shortName(primary), '·', shortName(secondary)) : null,
    primary: label(shortName(primary)),
    short: label(compileSectionLabel(shortName(primary))),
  };
}

/** Single-line capacity of a section slot; an unwrapped label may run to the
 * title's right edge when nothing else occupies that band. */
export function sectionSlotCapacity(project, index, slot) {
  const spec = project.templateFidelity?.slides?.[index];
  const node = spec?.nodes?.find(item => item.nativeRef?.shapeId === slot.shapeId);
  if (!node) return {capacity:slot.capacity};
  const fontSizePt=Number(slot.fontSizePt||node.style?.fontSizePt||11),margins=node.nativeTextFrame?.margins||[0,0,0,0];
  const titleNode=spec.nodes.find(item=>item.nativeRef?.shapeId===spec.slots.find(s=>s.role==='title')?.shapeId);
  const neededHeight=Math.ceil(fontSizePt*1.5*EMU_PT+Number(margins[1]||0)+Number(margins[3]||0));
  const maxHeight=titleNode?.geometry?.y>node.geometry.y?titleNode.geometry.y-node.geometry.y-4*EMU_PT:node.geometry.height;
  const extensionBlocked=(spec.nodes||[]).some(other=>{
    const a=other.geometry,g=node.geometry;if(other===node||!a||a.width*a.height>=project.templateFidelity.width*project.templateFidelity.height*.5)return false;
    return a.x<g.x+g.width&&a.x+a.width>g.x&&a.y<g.y+neededHeight&&a.y+a.height>g.y+g.height;
  });
  const height=neededHeight<=maxHeight&&!extensionBlocked?Math.max(node.geometry.height,neededHeight):node.geometry.height;
  if (node.nativeTextFrame?.wordWrap !== false) return { capacity: slot.capacity, width: node.geometry.width,height };
  const g = node.geometry, title = spec.nodes.find(item => item.nativeRef?.shapeId === spec.slots.find(s => s.role === 'title')?.shapeId)?.geometry;
  let right = Math.max(g.x + g.width, title ? title.x + title.width : g.x + g.width);
  for (const other of spec.nodes) {
    const o = other.geometry;
    if (other === node || !o || o.x <= g.x || o.y >= g.y + g.height || o.y + o.height <= g.y) continue;
    if (o.width * o.height >= (project.templateFidelity.width || 0) * (project.templateFidelity.height || 0) * .5) continue; // full-page backdrop
    right = Math.min(right, o.x);
  }
  const width = Math.max(g.width, right - g.x);
  return { capacity: Math.max(slot.capacity, Math.floor(width / EMU_PT / fontSizePt * .88)), width,height };
}

/** A confirmed navigation-only finding must survive template rebinding. Use
 * the already approved page topic, never a new fact or a source-body rewrite. */
export function repairDiagnosedEyebrow(project, outlineSlide, draft, findings = []) {
  if (!findings.length || draft.sectionLabel?.basis === 'user') return null;
  const labels = (draft.nodes || []).filter(node => node.type === 'text' &&
    (node.templateSlot?.role === 'section' || node.content?.derivedFrom === 'source-navigation') &&
    !node.locked && !node.userGeometry && !node.content?.mustPreserve && !node.sourceArtifact);
  const matches = finding => labels.some(node => {
    const detail = String(finding.detail || finding.message || '');
    return finding.nodeIds?.length && finding.nodeIds.every(id=>labels.some(label=>label.id===id)) ||
      detail.includes(node.id) || String(node.content?.text || '').length >= 4 && detail.includes(node.content.text);
  });
  if (!labels.length || !findings.every(matches)) return null;
  const heading = sharedSourceHeading(project, outlineSlide, slideSourceHeading(project, outlineSlide));
  const text = compileSectionLabel(outlineSlide.title);
  const locale = project.generationPolicy?.version === 2 && project.generationPolicy.language?.mode === 'source'
    ? pageTopicLanguage(project, outlineSlide) : deckLanguage(project).locale;
  if (!heading || !text || CJK.test(text) !== (locale !== 'en')) return null;
  const slide = structuredClone(draft);
  slide.sectionLabel = { ...slide.sectionLabel, navigationRepair: {
    heading, sourceUnitIds: [...(outlineSlide.sourceUnitIds || [])].sort(), text,
    basis: 'confirmed_navigation_finding_and_approved_page_topic'
  } };
  const index = project.outline.findIndex(item => item.id === draft.id);
  const candidate = { ...project, deck: { slides: project.deck.slides.map((item, i) => i === index ? slide : item) } };
  normalizeDeckEyebrows(candidate, { onlySlideId: slide.id });
  return JSON.stringify(slide) === JSON.stringify(draft) ? null : { slide,
    navigationNodeIds: labels.map(node => node.id), operations: ['repair_generated_navigation'] };
}

const labelKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
/** A label that is only its page title is not navigation (real run
 * 2026-10-22: a one-page outline card's section equals its title; the final
 * repair re-derived the label after copy normalization had cleared it). A
 * numbered label ("1.3 核心张力") still places the page and stays. */
const repeatsTitle = (label, title) => Boolean(labelKey(label)) && labelKey(label) === labelKey(title);

/** Deck-wide: pick the richest tier every labelled page can show on one line. */
/** A bilingual card deck's section label with its second language: the
 * chapter divider's own translation, else a fixed pair for the frame labels
 * (Fable review r16: the badge was English-only). */
const FRAME_PAIRS={Introduction:'导言',Takeaway:'小结'};
export function bilingualSection(project,section){
 if(!section||/\s\|\s/u.test(section)||project.generationPolicy?.language?.mode!=='source'||project.generationPolicy?.language?.body!=='both')return section;
 const divider=(project.outline||[]).find(slide=>slide.cardFrame==='divider'&&String(slide.title||'').trim()===section);
 const other=divider?.titleSecondary||divider?.titlePair?.secondary||FRAME_PAIRS[section];
 return other?`${section} | ${other}`:section;
}
export function normalizeDeckEyebrows(project,{onlySlideId}={}) {
  const slides = project.deck?.slides || [], language = deckLanguage(project), preserve = project.templateFidelity?.mode === 'preserve';
  const rows = [];
  slides.forEach((slide, index) => {
    if (index === 0 || onlySlideId&&slide.id!==onlySlideId || slide.sectionLabel?.basis === 'user') return;
    const outlineSlide = (project.outline || []).find(item => item.id === slide.id) || project.outline?.[index];
    // A frame page of a card deck (the closing, the contents) shows no eyebrow
    // (Fable C1, 2026-11-01: "结束" above "感谢观看" said nothing).
    if (project.planningContract?.version === 3 && (outlineSlide?.role === 'closing' || outlineSlide?.cardFrame)) {
      slide.section = '';
      slide.nodes = (slide.nodes || []).filter(node => node.content?.derivedFrom !== 'source-navigation' && node.semanticRole !== 'eyebrow');
      slide.nodeOrder = slide.nodes.map(node => node.id);
      if (slide.copy?.eyebrow) slide.copy = { ...slide.copy, eyebrow: '' };
      return;
    }
    const sourceHeading=slideSourceHeading(project, outlineSlide);
    // The approved editorial outline owns presentation navigation. Original
    // chapter headings remain provenance when a source unit moves to a new task.
    // A card deck's page label is its outline section (its chapter), on every
    // page (Fable review, alpha-r9 p3/p4/p9/p11 had none: the source's leaf
    // heading was looked up instead).
    const cards=project.planningContract?.flow==='cards';
    const presentationHeading=cards?bilingualSection(project,String(outlineSlide?.section||'').trim()):outlineSlide?.planningProtocolVersion===2&&project.planning?.editorialBlueprint&&outlineSlide.section?.trim();
    let heading = cards?presentationHeading:presentationHeading || sharedSourceHeading(project,outlineSlide,sourceHeading);
    // A card deck's figure page says what it is (Fable 2026-11-02, N6).
    if(cards&&outlineSlide?.figurePage){const locale=String(language?.locale||language||'');heading=locale.startsWith('zh')?/hant|tw|hk|mo/iu.test(locale)?'圖':'图':'Figure';}
    if (!heading) return;
    if(!preserve&&!cards){
      const cleaned=diagramEyebrow(project,outlineSlide,heading);
      if(cleaned!==heading&&!cleaned){
        slide.copy={...slide.copy,eyebrow:''};
        for(const n of slide.nodes||[])if(n.semanticRole==='eyebrow'&&!n.locked)n.content={...n.content,...richTextContent('')};
        slide.sectionLabel={basis:'diagram-navigation',heading,reason:'merged branches cannot inherit one source alt-frame label'};
        return;
      }
      heading=cleaned;
    }
    let slot = preserve ? project.templateFidelity.slides[index]?.slots?.find(item => item.role === 'section') : null;
    // A card page on a built-in layout always has its label (the takeaway page's writer gives none).
    const eyebrow = !preserve && (slide.copy?.eyebrow || (cards ? heading : ''));
    let derived=null,numberSlot=null;
    const perPage=project.generationPolicy?.version===2&&project.generationPolicy.language?.mode==='source';
    const rowLanguage=perPage?{locale:pageTopicLanguage(project,outlineSlide),bilingual:false}:language;
    let projected=presentationHeading?heading:projectedSourceHeading(project,heading)||heading;
    if(!cards&&perPage&&(rowLanguage.locale==='en'?!CJK.test(heading)&&CJK.test(projected):CJK.test(heading)&&!CJK.test(projected)))projected=heading;
    const navigationRepair=slide.sectionLabel?.navigationRepair;
    const repairCurrent=navigationRepair?.heading===heading &&
      JSON.stringify(navigationRepair.sourceUnitIds)===JSON.stringify([...(outlineSlide?.sourceUnitIds||[])].sort()) &&
      CJK.test(navigationRepair.text)===(rowLanguage.locale!=='en');
    if(repairCurrent&&!cards)projected=[parseSourceHeading(heading).number,compileSectionLabel(navigationRepair.text)].filter(Boolean).join(' ');
    // A source chapter may be Chinese while this page owns an English table.
    // Do not feed a mismatching writer label back into the language gate.
    // Approved outline metadata is a safe fallback; body/source text is untouched.
    const fallbackOptions=[slide.templateSlotTexts?.[String(slot?.shapeId)],slide.sectionLabel?.canonicalName,slide.section,outlineSlide?.section,outlineSlide?.title].filter(value=>typeof value==='string'&&value.trim());
    const fallback=perPage?fallbackOptions.find(value=>CJK.test(value)===(rowLanguage.locale!=='en'))||'':fallbackOptions[0]||'';
    const proposed=eyebrowCandidates(projected,rowLanguage,compileSectionLabel(fallback)),number=parseSourceHeading(heading).number;
    if(!cards&&slot&&number&&proposed&&Object.values(proposed).filter(Boolean).every(label=>visualUnits(label)>sectionSlotCapacity(project,index,slot).capacity)&&visualUnits(number)<=slot.capacity){numberSlot=slot;slot=null;}
    if(!slot&&!eyebrow&&preserve){
      // Above the title, else (Fable 2026-10-26) in the band under it.
      const frame=derivedSectionLabelFrame(project,index);
      if(frame)derived={geometry:frame.geometry,fontSizePt:frame.fontSizePt,position:frame.position};
      if(!derived){slide.sectionLabelDiagnostic={status:'blocked',reason:'no safe measured navigation band'};return;}
    }
    if(!slot&&!eyebrow&&!derived)return;
    // A bilingual chapter badge shows both languages when they fit ("Introduction · 导言"), else the primary (Fable review fz-r15).
    const pairLabel=cards&&/\s\|\s/u.test(heading)?(()=>{const halves=heading.split(/\s+\|\s+/u),joined=halves.join(' · ');return [...joined].length<=28?joined:halves[0];})():heading;
    // A continuation whose title marker would cut its title says so here (Fable 2026-10-26).
    const continuing=cards&&unmarkedContinuation(project,index)?(String(project.inputUnderstanding?.primaryLanguage||'en').startsWith('zh')?' · 续':' · cont.'):'';
    const candidates = cards?{primary:pairLabel+continuing,short:pairLabel+continuing}:eyebrowCandidates(projected, rowLanguage, compileSectionLabel(fallback));
    if (!candidates) return;
    rows.push({ slide, slot,numberSlot, derived, heading, sourceHeading, presentationHeading, projected, candidates, navigationRepair:repairCurrent?navigationRepair:null, capacity: slot ? sectionSlotCapacity(project, index, slot) : { capacity: derived?Math.floor(derived.geometry.width/EMU_PT/derived.fontSizePt*.88):64 } });
  });
  if (!rows.length) { delete project.titlePolicy; return { tier: null, pages: 0 }; }
  const tier = TIERS.find(name => rows.every(row => row.candidates[name] && visualUnits(row.candidates[name]) <= row.capacity.capacity))
    || TIERS.find(name => name !== 'bilingual' && rows.every(row => row.candidates[name])) || 'short';
  for (const row of rows) {
    const chosen = row.candidates[tier] || row.candidates.short, text = repeatsTitle(chosen, row.slide.title) ? '' : chosen;
    if (row.slot) {
      row.slide.section = text;
      row.slide.sectionLabel = { basis: 'source-heading', tier, heading: row.heading,canonicalName:parseSourceHeading(row.projected).names.join(' '),projectedHeading:row.projected, shapeId: row.slot.shapeId,
        ...(row.navigationRepair?{navigationRepair:row.navigationRepair}:{}),
        ...(row.capacity.height?{height:row.capacity.height,heightBasis:'original font plus CJK line box and native vertical margins; below title safety gap'}:{}),
        ...(visualUnits(text) > row.slot.capacity ? { width: row.capacity.width, capacity: row.capacity.capacity } : {}) };
    } else {
      row.slide.section = text;
      row.slide.copy = { ...row.slide.copy, eyebrow: text };
      if(row.derived&&!text){row.slide.nodes=(row.slide.nodes||[]).filter(n=>n.content?.derivedFrom!=='source-navigation');row.slide.nodeOrder=row.slide.nodes.map(n=>n.id);}
      else if(row.derived){
        // A card deck's derived label looks like the template's slot labels (Fable review fz-r15: plain text on templates 5/8),
        // never larger than the size its band was measured for (world_models on tpl 38b66a7c: 16 pt in an 11 pt band on every page).
        const slotLabel=project.planningContract?.flow==='cards'?(project.templateFidelity?.slides||[]).flatMap(spec=>(spec?.nodes||[]).filter(n=>spec.slots?.some(slot=>slot.role==='section'&&slot.shapeId===n.nativeRef?.shapeId))).find(n=>n.style?.color&&n.style?.fontSizePt):null;
        const index=slides.indexOf(row.slide),background=project.templateFidelity?.slides?.[index]?.background||project.templateSpec?.palette?.background||'#ffffff';
        const probe={geometry:row.derived.geometry},backdrop=templateBackdrop({nodes:[...visibleNodes(row.slide),probe]},probe,background);
        // Reusing the typography of a white-on-purple native badge does not
        // authorize white text in this newly derived band on a white slide.
        const color=templateTextColor(project,index,'caption',backdrop);
        const id=stableId('node',row.slide.id,'derived-navigation'),node={id,type:'text',semanticRole:'eyebrow',slotId:'absolute',geometry:row.derived.geometry,
          content:{text,derivedFrom:'source-navigation'},style:{fontSizePt:Math.min(Number(slotLabel?.style.fontSizePt)||Infinity,row.derived.fontSizePt),fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,color:color.color,colorBasis:color.basis},zIndex:501};
        if(row.numberSlot){row.slide.section=parseSourceHeading(row.heading).number;row.slide.templateSlotTexts={...row.slide.templateSlotTexts,[String(row.numberSlot.shapeId)]:row.slide.section};}
        row.slide.nodes=[...(row.slide.nodes||[]).filter(n=>n.content?.derivedFrom!=='source-navigation'),node];row.slide.nodeOrder=row.slide.nodes.map(n=>n.id);
      }
      if(!preserve&&project.planningContract?.flow==='cards'&&!row.derived&&!(row.slide.nodes||[]).some(node=>node.semanticRole==='eyebrow'))
        row.slide.nodes=[...(row.slide.nodes||[]),{id:stableId('node',row.slide.id,'eyebrow'),type:'text',semanticRole:'eyebrow',slotId:'eyebrow',styleRef:'typography.eyebrow',content:{text}}];
      for (const node of row.slide.nodes || []) if (node.semanticRole === 'eyebrow') node.content = { ...(node.content || {}), text };
      row.slide.sectionLabel = { basis: 'source-heading', tier, heading: row.heading,canonicalName:parseSourceHeading(row.projected).names.join(' '),projectedHeading:row.projected,...(row.navigationRepair?{navigationRepair:row.navigationRepair}:{}),...(row.numberSlot?{numberSlotShapeId:row.numberSlot.shapeId,layout:'number_slot_plus_complete_derived_label'}:{}) };
    }
    if(row.presentationHeading)row.slide.sectionLabel={...row.slide.sectionLabel,basis:'presentation-outline',sourceHeading:row.sourceHeading};
  }
  delete project.titlePolicy;
  return { tier, pages: rows.length };
}

/** Writer rule: topics use the deck language only (round 7, B1). */
export function bilingualTitleRule(project) {
  const items = project.source?.semantic?.inventory?.items || [];
  const scripts = new Set(items.map(item => /\p{Script=Han}/u.test(item.text || '') ? 'han' : 'latin'));
  return scripts.size > 1 || project.generationPolicy?.language?.mode === 'output' ? topicLanguageRule(project) : '';
}

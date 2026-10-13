/** F-P1-11: eyebrow / section-label normalization. The navigation label above
 * a page title is derived from the source heading the page's units come from
 * ("section number + section name", both languages when the deck keeps the
 * source languages), and the whole deck uses one format tier, so pages never
 * mix "1.3 核心张力" with "研究范式" or an English chapter line. */
import {stableId} from './ppt/ir.mjs';
import {templateTextColor} from './ppt-template-colors.mjs';
import { visualUnits, compileSectionLabel } from './ppt-presentation-writing.mjs';

const EMU_PT = 12700, CJK = /[㐀-鿿豈-﫿]/u;
const TIERS = ['bilingual', 'primary', 'short'];

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

export function deckLanguage(project) {
  const policy = project.generationPolicy?.language;
  if (policy?.mode === 'output') return { locale: policy.locale, bilingual: false };
  const titles = (project.deck?.slides || project.outline || []).map(slide => slide.title || '');
  const cjk = titles.filter(title => CJK.test(title)).length;
  return { locale: cjk * 2 >= titles.length ? 'zh' : 'en', bilingual: true };
}

/** The deepest non-root heading shared by most of the page's source units. */
export function slideSourceHeading(project, outlineSlide) {
  const semantic = project.source?.semantic || {};
  const items = new Map((semantic.inventory?.items || []).map(item => [item.id, item]));
  const chunks = new Map((semantic.chunks || []).map(chunk => [chunk.id, chunk]));
  const paths = (outlineSlide?.sourceUnitIds || []).map(id => items.get(id)?.sectionPath).filter(Boolean);
  if (!paths.length) for (const id of outlineSlide?.chunkRefs || []) if (chunks.get(id)?.sectionPath) paths.push(chunks.get(id).sectionPath);
  const counts = new Map();
  for (const path of paths) {
    if (path.length < 2) continue; // the document title (H1) is the cover, not a section
    const heading = path[path.length - 1];
    counts.set(heading, (counts.get(heading) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function eyebrowCandidates(heading, { locale = 'zh', bilingual = true } = {}, fallbackName = '') {
  const { number, names } = parseSourceHeading(heading);
  const wantCjk = locale !== 'en';
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

/** Deck-wide: pick the richest tier every labelled page can show on one line. */
export function normalizeDeckEyebrows(project,{onlySlideId}={}) {
  const slides = project.deck?.slides || [], language = deckLanguage(project), preserve = project.templateFidelity?.mode === 'preserve';
  const rows = [];
  slides.forEach((slide, index) => {
    if (index === 0 || onlySlideId&&slide.id!==onlySlideId || slide.sectionLabel?.basis === 'user') return;
    const outlineSlide = (project.outline || []).find(item => item.id === slide.id) || project.outline?.[index];
    const heading = slideSourceHeading(project, outlineSlide);
    if (!heading) return;
    let slot = preserve ? project.templateFidelity.slides[index]?.slots?.find(item => item.role === 'section') : null;
    const eyebrow = !preserve && slide.copy?.eyebrow;
    let derived=null,numberSlot=null;
    const proposed=eyebrowCandidates(heading,language,compileSectionLabel(slide.section||'')),number=parseSourceHeading(heading).number;
    if(slot&&number&&proposed&&Object.values(proposed).filter(Boolean).every(label=>visualUnits(label)>sectionSlotCapacity(project,index,slot).capacity)&&visualUnits(number)<=slot.capacity){numberSlot=slot;slot=null;}
    if(!slot&&!eyebrow&&preserve){
      const spec=project.templateFidelity.slides[index],title=spec?.nodes?.find(n=>spec.slots?.some(s=>s.role==='title'&&s.shapeId===n.nativeRef?.shapeId));
      if(title?.geometry){
        const pt=Number(project.templateSpec?.fonts?.sectionSizePt)||11,g=title.geometry,height=Math.round((pt*1.18+7.2+1)*EMU_PT),y=g.y-height-Math.round(EMU_PT*4);
        const frame={x:g.x,y,width:g.width,height};
        const blocked=y<0||(spec.nodes||[]).some(n=>n!==title&&n.geometry&&n.geometry.width*n.geometry.height<project.templateFidelity.width*project.templateFidelity.height*.5&&n.type!=='text'&&n.geometry.x<frame.x+frame.width&&n.geometry.x+n.geometry.width>frame.x&&n.geometry.y<frame.y+frame.height&&n.geometry.y+n.geometry.height>frame.y);
        if(!blocked)derived={geometry:frame,fontSizePt:pt};
      }
      if(!derived){slide.sectionLabelDiagnostic={status:'blocked',reason:'no safe measured navigation band'};return;}
    }
    if(!slot&&!eyebrow&&!derived)return;
    const candidates = eyebrowCandidates(heading, language, compileSectionLabel(slide.section || ''));
    if (!candidates) return;
    rows.push({ slide, slot,numberSlot, derived, heading, candidates, capacity: slot ? sectionSlotCapacity(project, index, slot) : { capacity: derived?Math.floor(derived.geometry.width/EMU_PT/derived.fontSizePt*.88):64 } });
  });
  if (!rows.length) { delete project.titlePolicy; return { tier: null, pages: 0 }; }
  const tier = TIERS.find(name => rows.every(row => row.candidates[name] && visualUnits(row.candidates[name]) <= row.capacity.capacity))
    || TIERS.find(name => name !== 'bilingual' && rows.every(row => row.candidates[name])) || 'short';
  for (const row of rows) {
    const text = row.candidates[tier] || row.candidates.short;
    if (row.slot) {
      row.slide.section = text;
      row.slide.sectionLabel = { basis: 'source-heading', tier, heading: row.heading, shapeId: row.slot.shapeId,
        ...(row.capacity.height?{height:row.capacity.height,heightBasis:'original font plus CJK line box and native vertical margins; below title safety gap'}:{}),
        ...(visualUnits(text) > row.slot.capacity ? { width: row.capacity.width, capacity: row.capacity.capacity } : {}) };
    } else {
      row.slide.copy = { ...row.slide.copy, eyebrow: text };
      if(row.derived){
        const id=stableId('node',row.slide.id,'derived-navigation'),node={id,type:'text',semanticRole:'eyebrow',slotId:'absolute',geometry:row.derived.geometry,
          content:{text,derivedFrom:'source-navigation'},style:{fontSizePt:row.derived.fontSizePt,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,color:templateTextColor(project,slides.indexOf(row.slide),'label').color},zIndex:501};
        if(row.numberSlot){row.slide.section=parseSourceHeading(row.heading).number;row.slide.templateSlotTexts={...row.slide.templateSlotTexts,[String(row.numberSlot.shapeId)]:row.slide.section};}
        row.slide.nodes=[...(row.slide.nodes||[]).filter(n=>n.content?.derivedFrom!=='source-navigation'),node];row.slide.nodeOrder=row.slide.nodes.map(n=>n.id);
      }
      for (const node of row.slide.nodes || []) if (node.semanticRole === 'eyebrow') node.content = { ...(node.content || {}), text };
      row.slide.sectionLabel = { basis: 'source-heading', tier, heading: row.heading,...(row.numberSlot?{numberSlotShapeId:row.numberSlot.shapeId,layout:'number_slot_plus_complete_derived_label'}:{}) };
    }
  }
  // F-P1-5: with both source languages kept, titles use one primary language
  // and the other language is carried by the bilingual eyebrow on every page.
  if (tier === 'bilingual' && language.bilingual) project.titlePolicy = { version: 1, primary: language.locale === 'en' ? 'en' : 'zh', otherLanguage: 'eyebrow' };
  else delete project.titlePolicy;
  return { tier, pages: rows.length };
}

/** F-P1-5 writer rule: one title language when the deck keeps both source languages. */
export function bilingualTitleRule(project) {
  const items = project.source?.semantic?.inventory?.items || [];
  const paired = items.filter(item => item.languagePairId).length;
  if (project.generationPolicy?.language?.mode === 'output' || paired < Math.max(4, items.length * .3)) return '';
  const primary = deckLanguage(project).locale === 'en' ? 'English' : '中文';
  return `来源为双语：所有内容页标题统一使用${primary}，不在标题里混排两种语言；另一语言的章节名由系统放在 eyebrow。`;
}

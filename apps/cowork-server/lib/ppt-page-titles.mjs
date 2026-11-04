import {copyBudgetFor,visualUnits}from './ppt-presentation-writing.mjs';
import {sourceSentences}from './ppt-source-boundaries.mjs';
import {diagramTopicLabel} from './ppt-ascii-graph.mjs';
/** Round 7 (A6): every page has its own title. A split page is not titled
 * "… (续)", "（上）/（下）" or "continued", and it does not repeat its
 * neighbour's title: it adds what that page covers (its own source heading, or
 * the first clause of its first point). Locked user titles never change. */
import {projectedSourceHeading,topicTitleProjectionGroup} from './ppt-topic-title-projection.mjs';
import { stripContinuationSuffix, keepCardContinuation } from './ppt-topic-language.mjs';
import { cardsFlow } from './ppt-flow.mjs';
import { deckScript,deckLanguage } from './ppt-presentation-contract.mjs';
import { sourceDisplayText } from './ppt-source-text.mjs';

const HALVES = /\s*[（(]\s*(?:上|中|下|一|二|三|四|[0-9]+|part\s*[0-9]+|[0-9]+\s*\/\s*[0-9]+)\s*[）)]\s*$|\s*(?:[·|｜:-]\s*)?(?:part|第)\s*[0-9一二三四]+\s*(?:部分)?\s*$/iu;
const key = value => String(value || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

/** Remove continuation/part markers from a title. */
export function stripPartMarkers(title) {
  let value = stripContinuationSuffix(String(title || ''));
  for (let i = 0; i < 2; i++) value = value.replace(HALVES, '').trim();
  value = value.replace(/[：:·|｜\-–—\s]+$/u, '').trim();
  return value || String(title || '').trim();
}

// Topic prefixes may omit prose, but must not invent a different number by
// cutting a decimal, thousands separator, scientific literal or numeric range.
function topicPrefix(text,han){
 if(!han)return text.split(/\s+/u).slice(0,6).join(' ').replace(/\s+(?:via|with|and|or|at|to|of|for|in|under|from|by|the|a|an)$/iu,'');
 let end=[...text].slice(0,14).join('').length;
 for(const match of text.matchAll(/[+-]?\d+(?:[,.]\d+)*(?:[eE][+-]?\d+)?(?:\s*[–—-]\s*[+-]?\d+(?:[,.]\d+)*)?(?:%|％|bps?)?/gu))if(match.index<end&&match.index+match[0].length>end)end=match.index+match[0].length;
 return text.slice(0,end).trim();
}

function qualifiersFor(project, slide, base) {
  const items = new Map((project.originalSourceInventory?.items || project.source?.semantic?.inventory?.items || []).map(item => [item.id, item]));
  const han = deckScript(project) === 'han', options = [];
  const owned = (slide.sourceUnitIds || []).map(id => items.get(id)).filter(Boolean);
  const inLanguage = text => han ? /\p{Script=Han}/u.test(text) : !/\p{Script=Han}/u.test(text);
  // 1) The page's own source heading, in the deck language, if it adds something.
  for (const item of owned) {
    if((item.sectionPath||[]).length<2&&key(item.sectionPath?.[0])===key(String(project.source?.text||'').match(/^#\s+(.+)$/mu)?.[1]))continue;
    const rawHeading=item.sectionPath?.at(-1)||'';
    const heading = String(projectedSourceHeading(project,rawHeading)||rawHeading).replace(/^#+\s*/u, '').replace(/^(?:\d+\.)*\d+\.?\s+/u, '');
    const name = heading.split(/\s+\|\s+|\s*｜\s*/u).map(part => part.trim()).filter(Boolean).find(inLanguage) || '';
    if (name && !key(base).includes(key(name)) && !key(name).includes(key(base))){const short=name.split(/[:：]/u)[0].trim();options.push(han?[...short].slice(0,14).join(''):short.split(/\s+/u).slice(0,6).join(' '));}
  }
  // A diagram's first branches are not an exhaustive topic assertion. Use
  // its complete source header plus an explicit visual-kind label instead.
  for(const item of owned.filter(item=>item.diagramSource)){
    const header=String(item.diagramSource.text||'').split('\n').map(line=>line.trim()).find(Boolean)||'';
    const completeHeader=/^[\p{L}\p{N} _-]{2,60}$/u.test(header)&&inLanguage(header)?header:'';
    options.push(completeHeader?(han?completeHeader+'图示':completeHeader+' diagram'):(han?'图示':'Diagram'));
  }
  // 2) The first clause of prose, never the first branches of a diagram.
  for (const text of [...owned.filter(item=>!item.diagramSource).map(item=>item.text),slide.focus].filter(text=>inLanguage(text||''))) {
    const clause = sourceSentences(sourceDisplayText(text || '')).map(part => part.trim()).find(part => part.length >= 2) || '';
    if (clause) options.push(topicPrefix(clause,han));
  }
  if(!han)for(const text of [...owned.map(item=>item.text),slide.focus]){
    if(!/\p{Script=Han}/u.test(text||''))continue;
    // Source-authored English topic phrases can name a mixed-language page;
    // do not add a Chinese qualifier and later strip it to a dangling colon.
    for(const match of sourceDisplayText(text||'').matchAll(/[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*)+/gu))
      options.push(match[0].split(/\s+/u).slice(0,6).join(' '));
  }
  return [...new Set(options)].filter(option=>inLanguage(option)&&key(option)&&!key(base).includes(key(option))&&!key(option).includes(key(base)));

}

/** Distinct page titles; returns { slides, corrections }. */
export function distinctPageTitles(project, slides) {
  const corrections = [], seen = new Map();
  const han = deckScript(project) === 'han';
  const next = slides.map((slide, index) => {
    if (!slide || slide.titleLocked || slide.title_locked || typeof slide.title !== 'string') return slide;
    let title = slide.title;
    // A native title fallback may use the source chapter verbatim. Resolve its
    // audited topic projection before confirmation, retaining any row range.
    for(const heading of new Set([...(project.source?.semantic?.inventory?.items||[]).flatMap(item=>item.sectionPath||[]),...(topicTitleProjectionGroup(project)?.segments||[]).map(segment=>segment.text)].filter(heading=>typeof heading==='string'&&heading))){
      const bare=heading.replace(/^(?:\d+\.)*\d+\.?\s+/u,''),translated=projectedSourceHeading(project,heading);
      if(translated&&(title===heading||title===bare||title.startsWith(bare+' (')||title.startsWith(bare+'（'))){title=translated.replace(/^(?:\d+\.)*\d+\.?\s+/u,'')+title.slice(title.startsWith(bare)?bare.length:heading.length);corrections.push({code:'topic_heading_projected',pageIndex:index,from:slide.title,title});break;}
    }
    const inventory=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
    for(const ref of slide.sourceArtifactRanges||[]){
      const item=inventory.find(item=>item.id===ref.sourceUnitId);if(!item?.rows)continue;
      const start=ref.rowStart??1,end=ref.rowEnd??item.rows.length,actual=item.rows.slice(start,end).map(row=>String(row[0]||''));
      const absent=item.rows.slice(1).map(row=>String(row[0]||'')).filter(label=>key(label).length>=3&&key(title).includes(key(label))&&!actual.some(a=>key(a)===key(label)));
      if(!absent.length)continue;
      const labels=actual.map(label=>diagramTopicLabel(item,sourceDisplayText(label)).replace(/_/gu,' ').trim()).filter(Boolean),english=labels.every(label=>!/[\p{Script=Han}]/u.test(label));
      if(labels.length&&labels.length<=3&&(han||english)&&(slide.sourceUnitIds||[]).every(id=>id===item.id)){const from=title;title=labels.map(label=>label.replace(/^./u,c=>c.toUpperCase())).join(han?'与':' & ');corrections.push({code:'fragment_title_matched_to_rows',pageIndex:index,from,title});}
    }
    const stripped = keepCardContinuation(cardsFlow(project), title, stripPartMarkers(title));
    if (stripped !== title.trim()) { corrections.push({ code: 'continuation_marker_removed', pageIndex: index, from: title }); title = stripped; }
    const k = key(title);
    if (index > 0 && k && seen.has(k)) {
      const candidate = qualifiersFor(project, slide, title).map(qualifier => han ? `${title}：${qualifier}` : `${title}: ${qualifier}`).find(option => option.length<=160&&visualUnits(option)<=copyBudgetFor(slide.role,slide.layoutId,deckLanguage(project)).titleHardUnits&&!seen.has(key(option)));
      if (candidate) { corrections.push({ code: 'duplicate_title_distinguished', pageIndex: index, firstPageIndex: seen.get(k), title: candidate }); title = candidate; }
    }
    if (!seen.has(key(title))) seen.set(key(title), index);
    return title === slide.title ? slide : { ...slide, title };
  });
  return { slides: next, corrections };
}

/** Deck check: content pages with the same title, or a continuation marker. */
export function inspectDuplicatePageTitles(slides = []) {
  const seen = new Map(), issues = [];
  slides.forEach((slide, index) => {
    if (!index || !slide?.title || slide.closingGreeting) return;
    if (stripPartMarkers(slide.title) !== slide.title.trim()) issues.push({ code: 'continuation_title', severity: 'warning', repairable: true, slideId: slide.id, message: `Page ${index + 1} title carries a continuation marker; give the page its own title.` });
    const k = key(slide.title);
    if (seen.has(k)) issues.push({ code: 'duplicate_page_title', severity: 'warning', repairable: true, slideId: slide.id, message: `Page ${index + 1} repeats the title of page ${seen.get(k) + 1}; each page names what it covers.` });
    else seen.set(k, index);
  });
  return issues;
}

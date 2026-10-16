import {deckLanguage,deckLanguageName}from './ppt-presentation-contract.mjs';
export function topicHasSubject(value){
 const text=String(value||'').trim().replace(/\s*[（(](?:(?:lines?|rows?|pages?)\s*)?(?:第\s*)?\d+(?:\s*[–—-]\s*\d+)?\s*(?:行|页|頁)?[）)]\s*$/iu,'').replace(/^(?:(?:lines?|rows?|pages?)\s*|第\s*)\d+(?:\s*[–—-]\s*\d+)?\s*(?:行|页|頁)?$/iu,'');
 return /\p{L}/u.test(text);
}
/** Recheck generated topics after source/table/diagram capacity partitioning.
 * Source evidence is immutable; repairs use the existing metadata-only path. */
export function topicLanguageMismatch(value,language){
 const text=String(value||''),han=(text.match(/\p{Script=Han}/gu)||[]).length;
 if(['en','de','fr','es'].includes(language))return han>0;
 if(['zh','zh-Hant'].includes(language)&&!han){
  if(/^(?:overview|summary|review|introduction|conclusion|recommendations?|agenda|comparison|mechanism|conditions|limitations|navigation)$/iu.test(text.trim()))return true;
  // Keep single technical names and acronym-only topics; multiword prose
  // topics must follow the dominant language, including native template pages.
  const words=text.replace(/\((?:lines? |rows? |pages? )?\d+\s*[–—-]\s*\d+\)$/iu,'').match(/[A-Za-z][A-Za-z0-9_-]*/g)||[];
  return words.length>1&&!words.every(word=>/^[A-Z0-9_+-]+$/u.test(word));
 }
 return false;
}
/** Keep a fragment locator as metadata even while its subject is translated. */
export function topicRangeConstraint(slide){
 const refs=slide.sourceArtifactRanges||[],literal=String(slide.title||'').match(/\((?:lines? |rows? |pages? |第 )?(\d+)\s*[–—-]\s*(\d+)(?: 行)?\)$/iu);
 if(!refs.length||!literal)return {};
 const lines=refs.filter(r=>Number.isSafeInteger(r.lineStart)&&Number.isSafeInteger(r.lineEnd)),rows=refs.filter(r=>Number.isSafeInteger(r.rowStart)&&Number.isSafeInteger(r.rowEnd));
 const line=lines.length===1&&(!rows.length||/\(lines? /iu.test(literal[0])),row=rows.length===1&&!line;
 return line?{requiredTopicRange:[String(lines[0].lineStart+1),String(lines[0].lineEnd)],topicRangeKind:'line'}:row?{requiredTopicRange:[String(rows[0].rowStart),String(rows[0].rowEnd-1)],topicRangeKind:'row'}:{requiredTopicRange:literal.slice(1)};
}
/** Planning control vocabulary may be a real source topic, but cannot become
 * a source-only audience claim merely because it occurred in our prompt. */
export function planningMetadataTitleLeak(project,title){
 const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,' ');
 const source=normalize(project.source?.text||project.prompt||'');
 const pairControl=String(title||'').match(/(?:translation|language) pairs? (?:are|represent) one claim with two display costs?|(?:翻译|翻譯|语言|語言)对.{0,8}(?:一项|一項|一个|一個|一条|一條)主[张張].{0,8}(?:两个|兩個|两份|兩份|2).{0,4}(?:显示|顯示)成本/iu)?.[0];
 if(pairControl&&!/(?:显示|顯示)成本|display costs?/iu.test(source))return pairControl;
 const identifier=String(title||'').match(/projected_display_visual_units/iu)?.[0];
 return identifier&&!source.includes(normalize(identifier))?identifier:null;
}
export function inspectOutlineTopicLanguages(project,outline=project.outline||[]){
 if(project.requestedOutline||project.confirmedOutline)return [];
 const language=deckLanguage(project),name=deckLanguageName(project);
 return outline.flatMap((slide,pageIndex)=>{
  if(slide.titleLocked||slide.title_locked||pageIndex===0&&(project.deckTitle?.source==='user'||project.deckTitle?.locked))return [];
  const leaked=planningMetadataTitleLeak(project,slide.title);
  if(leaked)return [{code:'planned_topic_control_leak',severity:'error',pageIndex,field:'title',reason:'planning_metadata_leak',maxLength:160,requiredLanguages:[name],topicLanguage:language,...topicRangeConstraint(slide),message:`Page ${pageIndex+1} copied internal planning vocabulary "${leaked}" absent from the source. Replace only this title with the actual owned source subject. Planning/display budgets are not audience facts; preserve all source IDs, body, languages and page count.`}];
  const missing=!topicHasSubject(slide.title),mismatch=topicLanguageMismatch(slide.title,language),range=topicRangeConstraint(slide);
  const literal=String(slide.title||'').match(/\((?:lines? |rows? |pages? |第 )?(\d+)\s*[–—-]\s*(\d+)(?: 行)?\)$/iu);
  const rangeMismatch=literal&&range.requiredTopicRange&&(JSON.stringify(literal.slice(1))!==JSON.stringify(range.requiredTopicRange)||range.topicRangeKind==='line'&&/\(rows? /iu.test(literal[0])||range.topicRangeKind==='row'&&/\(lines? /iu.test(literal[0]));
  if(!missing&&!mismatch&&!rangeMismatch)return [];
  return [{code:missing?'planned_topic_subject_missing':rangeMismatch?'planned_topic_range_mismatch':'planned_topic_language_mismatch',severity:'error',pageIndex,field:'title',reason:missing?'topic_subject_missing':rangeMismatch?'topic_range_mismatch':'topic_language_mismatch',maxLength:160,requiredLanguages:[name],topicLanguage:language,...topicRangeConstraint(slide),message:rangeMismatch?`Page ${pageIndex+1} topic locator must match the actual one-based inclusive source interval ${range.requiredTopicRange.join('–')} (${range.topicRangeKind||'source'}); internal zero-based starts and exclusive ends are not audience labels.`:missing?`Page ${pageIndex+1} topic must retain a concise source-supported subject before its fragment locator. A row/line range alone is not a topic.`:`Page ${pageIndex+1} generated topic must use ${name}. Translate only its concise source-supported title; preserve exact source, body languages, ownership and fragment scope.`}];
 });
}

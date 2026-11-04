/** Versioned, optional policy. Missing fields deliberately preserve legacy decks. */
export const PPT_PROMPT_CONTRACT_VERSION = 50;
/** Only an explicit presentation-generation request overrides source languages.
 * Ignore fenced code, quotations and ordinary bilingual subject headings. */
export function explicitLanguageRequest(value){
 const text=String(value||'').replace(/```[\s\S]*?```/gu,'');
 const language='(?:繁体中文(?:（香港）)?|繁體中文(?:（香港）)?|Traditional Chinese|简体中文|簡體中文|Simplified Chinese|中文|英文|英语|英語|English|Chinese)';
 /** @type {'en'|'zh'|'zh-HK'|undefined} */
 let locale;
 for(const raw of text.split('\n')){
  if(/^\s*>/u.test(raw))continue;
  const line=raw.trim().replace(/^[*-]\s+/u,'');
  const direct=line.match(new RegExp('^(?:输出语言|輸出語言|生成语言|生成語言|语言|語言|language)\\s*[:：]\\s*('+language+')(.*)$','iu'));
  const command=line.match(new RegExp('^(?:(?:输出要求|輸出要求|生成要求)\\s*[:：]\\s*)?(?:请|請|please\\s+)?(?:仅|僅|只|全部|全篇|全稿|only\\s+)?(?:用|使用|以|use\\s+|write\\s+(?:the\\s+)?(?:slides?|presentation|ppt)\\s+in\\s+|generate\\s+(?:the\\s+)?(?:slides?|presentation|ppt)\\s+in\\s+|output\\s+in\\s+)('+language+')(.*)$','iu'));
  const match=direct||command;if(!match)continue;
  const rest=match[2].trim();
  // A source sentence about English training data is not a slide-language request.
  if(!direct&&rest&&!/^(?:only|即可|就好|[,，。.!！;；]|生成|制作|製作|撰写|撰寫|输出|輸出|写|寫|表达|表達)|ppt|powerpoint|演示|简报|簡報|slides?|presentation/iu.test(rest))continue;
  if(/^(?:和|及|与|與|\/|and\b)/iu.test(rest))continue;
  locale=/繁体|繁體|Traditional/iu.test(match[1])?'zh-HK':/英文|英语|英語|English/iu.test(match[1])?'en':'zh';
 }
 return locale;
}

export function defaultGenerationPolicy(request=''){
 const locale=explicitLanguageRequest(request);
 return {version:2,detail:'standard',content:'overview',selection:'editorial',archive:'none',sourceTypography:'bounded',language:locale?{mode:'output',locale}:{mode:'source',body:'both',title:'primary'},knowledge:'source_only',code:{presentation:'omit'}};
}
/** Titles show the deck's primary language only unless the policy asks for
 * both (the user, 2026-10-24: a second-language subtitle was often a summary,
 * not a translation). A normalized source policy always states the mode; an
 * older stored policy without it reads as 'primary'. */
export const titleLanguageMode = project => project?.generationPolicy?.language?.title === 'both' ? 'both' : 'primary';
export function normalizeGenerationPolicy(value) {
  if (value === undefined) return undefined;
  const code = value?.code?.presentation;
  if (!value || ![1,2].includes(value.version) || !(value.version===2?['concise','standard','detailed']:['balanced','detailed']).includes(value.detail)
    || value.sourceTypography!==undefined&&(value.version!==2||value.sourceTypography!=='bounded')
    || value.version===2&&(value.details!==undefined||value.archive!==undefined&&value.archive!=='none'||value.selection!==undefined&&value.selection!=='editorial')
    || !['source','output'].includes(value.language?.mode) || value.language?.mode === 'output' && !['zh','en','zh-HK','zh-Hant','zh-TW'].includes(value.language?.locale)
    || value.details!==undefined&&!['slides','notes'].includes(value.details) || value.content==='full_source'&&value.details==='notes'
    || value.content !== undefined && !['overview','course','full_source'].includes(value.content) || !['source_only', 'source_plus_explanation'].includes(value.knowledge)
    || value.code !== undefined && !['auto', 'keep', 'omit'].includes(code)
    || value.language?.body !== undefined && (value.language.mode !== 'source' || !['primary', 'both'].includes(value.language.body))
    || value.language?.title !== undefined && (value.language.mode !== 'source' || !['primary', 'both'].includes(value.language.title))) {
    const error = new Error('invalid generation policy'); error.statusCode = 400; throw error;
  }
  // code.presentation: auto derives from the request and template; keep/omit
  // is the user's explicit choice from the Syllabus assumptions.
  // Follow the user's source-language contract in visible titles AND body.
  // Retain an explicitly selected legacy primary-only policy unchanged.
  const body = value.language.body ?? (value.content === 'overview' && value.details === 'notes' ? 'both' : undefined);
  return { version: value.version, detail: value.detail, ...(value.version===2?{selection:'editorial',archive:'none'}:{}), language: value.language.mode === 'source' ? { mode: 'source', ...(body ? { body } : {}), title: value.language.title || 'primary' } : { mode: 'output', locale: ['zh-Hant','zh-TW'].includes(value.language.locale) ? 'zh-HK' : value.language.locale },
    ...(value.content ? {content:value.content} : {}),...(value.details?{details:value.details}:{}),...(value.sourceTypography?{sourceTypography:value.sourceTypography}:{}), knowledge: value.knowledge,
    ...(code && code !== 'auto' ? { code: { presentation: code } } : {}) };
}
export function effectiveKnowledge(project) {
  return project.generationPolicy?.knowledge || (project.source?.segments?.length || project.update ? 'source_only' : 'source_plus_explanation');
}
export function requestedPageCount(...inputs) {
  for (const input of inputs) {
    const match = String(input || '').match(/(?:^|[^第\d])(\d{1,3})\s*(?:页|slides?)(?!\w)/iu);
    if (match) return Math.max(3, Math.min(100, Number(match[1])));
  }
}

/** Editorial selection is independent of archival storage. Legacy decks retain
 * their explicit notes authorization; new v2 decks never archive full input. */
export function allowsEditorialSelection(project){const p=project?.generationPolicy;return Boolean(p&&p.content!=='full_source'&&(p.version===2&&p.selection==='editorial'||p.version!==2&&p.details==='notes'));}
export function archivesOriginalSource(project){return project?.generationPolicy?.version!==2&&project?.generationPolicy?.details==='notes';}
export function detailProfile(project){if(project?.planningContract?.version===3){const mode=project.planningContract.contentMode||'standard';return{mode,assumption:!project.planningContract.contentMode,instruction:mode==='concise'?'Minimum sufficient mechanism, representative evidence and every necessary condition; no slogans.':mode==='detailed'?'Expand source-supported methods, derivations, examples and limitations; distinct continuation tasks, never invented data.':'Explain what, why/how and when, with evidence and limitations. No retention or word-count quota.'};}const mode=project?.generationPolicy?.detail||'balanced';return mode==='concise'?{mode:'concise',supportBlocks:[2,3],retention:.42,examples:1,instruction:'One core claim with the minimum sufficient mechanism, representative example and all necessary conditions. Merge related short units; no slogan or field-only pages.'}:mode==='detailed'?{mode:'detailed',supportBlocks:[4,6],retention:.8,examples:2,instruction:'Explain the complete source-supported mechanism, worked example, derivation and limitations. Continuations have distinct incremental purposes. Prefer legal layout/region reflow; only bounded typography adjustment above the declared readable floor is permitted.'}:{mode:'standard',supportBlocks:[3,4],retention:.6,examples:1,instruction:'Explain what, why and when: one core claim, mechanism, representative example and boundary. Combine related short sections and retain evidence qualifiers.'};}

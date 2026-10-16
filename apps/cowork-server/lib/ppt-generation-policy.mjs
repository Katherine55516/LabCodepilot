/** Versioned, optional policy. Missing fields deliberately preserve legacy decks. */
export const PPT_PROMPT_CONTRACT_VERSION = 44;
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
 return {version:1,detail:'balanced',content:'overview',details:'notes',language:locale?{mode:'output',locale}:{mode:'source',body:'primary'},knowledge:'source_only',code:{presentation:'omit'}};
}
export function normalizeGenerationPolicy(value) {
  if (value === undefined) return undefined;
  const code = value?.code?.presentation;
  if (!value || value.version !== 1 || !['balanced', 'detailed'].includes(value.detail)
    || !['source','output'].includes(value.language?.mode) || value.language?.mode === 'output' && !['zh','en','zh-HK','zh-Hant','zh-TW'].includes(value.language?.locale)
    || value.details!==undefined&&!['slides','notes'].includes(value.details) || value.content==='full_source'&&value.details==='notes'
    || value.content !== undefined && !['overview','course','full_source'].includes(value.content) || !['source_only', 'source_plus_explanation'].includes(value.knowledge)
    || value.code !== undefined && !['auto', 'keep', 'omit'].includes(code)
    || value.language?.body !== undefined && (value.language.mode !== 'source' || !['primary', 'both'].includes(value.language.body))) {
    const error = new Error('invalid generation policy'); error.statusCode = 400; throw error;
  }
  // code.presentation: auto derives from the request and template; keep/omit
  // is the user's explicit choice from the Syllabus assumptions.
  // Follow the user's source-language contract in visible titles AND body.
  // Retain an explicitly selected legacy primary-only policy unchanged.
  const body = value.language.body ?? (value.content === 'overview' && value.details === 'notes' ? 'both' : undefined);
  return { version: 1, detail: value.detail, language: value.language.mode === 'source' ? { mode: 'source', ...(body ? { body } : {}) } : { mode: 'output', locale: ['zh-Hant','zh-TW'].includes(value.language.locale) ? 'zh-HK' : value.language.locale },
    ...(value.content ? {content:value.content} : {}),...(value.details?{details:value.details}:{}), knowledge: value.knowledge,
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

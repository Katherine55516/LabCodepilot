/** Planning text is written in the deck language (2026-10-19: qwen3.8-max
 * returned every group title/question/message in English for a Chinese source,
 * and the English leaked into the Chinese outline). */
export function planningLanguageRule(project){
 const language=project?.generationPolicy?.language;
 const target=language?.mode==='output'&&language.locale?language.locale:/\p{Script=Han}/u.test(String(project?.source?.text||project?.prompt||'').slice(0,4000))&&(String(project?.source?.text||project?.prompt||'').slice(0,4000).match(/\p{Script=Han}/gu)||[]).length>40?'Simplified Chinese (the source\'s primary language)':'the source\'s primary language';
 return `\n<planning_language>Write every title, readerQuestion and coreMessage in ${target}; keep product names, code identifiers and source terms as written. Each coreMessage is one or two sentences, target at most 240 characters (hard limit 320).</planning_language>`;
}

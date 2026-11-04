/** Domain terms in a bilingual card point (Fable plan T11): when the English
 * half uses a glossary term and the Chinese half renders it with a known
 * literal mistranslation (universe → 宇宙), the Chinese half takes the field's
 * standard term (股票池). A match inside an accepted rendering of another term
 * (能力 in 盈利能力) is never touched; nothing else is rewritten. */
import fs from 'node:fs';
const GLOSSARY=JSON.parse(fs.readFileSync(new URL('./ppt-domain-glossary.json',import.meta.url),'utf8')).terms.sort((a,b)=>b.en.length-a.en.length);
const ACCEPTED=[...new Set(GLOSSARY.flatMap(term=>term.zh))].filter(zh=>/\p{Script=Han}/u.test(zh));
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
export function fixTerminology(text){
 const halves=String(text||'').split(/(\s+\|\s+)/u);
 if(halves.length<3)return{text:String(text||''),fixes:[]};
 const english=halves.find(half=>/[A-Za-z]{3}/u.test(half)&&!/\p{Script=Han}/u.test(half)),zhIndex=halves.findIndex(half=>/\p{Script=Han}/u.test(half));
 if(!english||zhIndex<0)return{text:String(text),fixes:[]};
 let zh=halves[zhIndex];const fixes=[];
 for(const term of GLOSSARY){
  if(!term.avoid?.length||!new RegExp(`(?<![A-Za-z-])${escape(term.en)}s?(?![A-Za-z-])`,'iu').test(english))continue;
  if(term.zh.some(rendering=>zh.includes(rendering)))continue;
  const protectedSpans=ACCEPTED.flatMap(rendering=>[...zh.matchAll(new RegExp(escape(rendering),'gu'))].map(match=>[match.index,match.index+rendering.length]));
  for(const wrong of term.avoid){
   const at=[...zh.matchAll(new RegExp(escape(wrong),'gu'))].find(match=>!protectedSpans.some(([a,b])=>match.index<b&&match.index+wrong.length>a));
   if(!at)continue;
   zh=zh.slice(0,at.index)+term.zh[0]+zh.slice(at.index+wrong.length);fixes.push({en:term.en,from:wrong,to:term.zh[0]});break;
  }
 }
 if(!fixes.length)return{text:String(text),fixes};
 halves[zhIndex]=zh;return{text:halves.join(''),fixes};
}

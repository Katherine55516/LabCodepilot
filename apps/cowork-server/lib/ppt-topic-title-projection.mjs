/** A source-mode deck may have a heading in the minority language. Project
 * that heading only; the body and immutable original source stay unchanged. */
import crypto from 'node:crypto';
import {deckLanguage} from './ppt-presentation-contract.mjs';
import {languageProjectionPrompt,validateLanguageProjection,languageProjectionAuditPrompt,validateLanguageProjectionAudit} from './ppt-language-projection.mjs';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const headingGroups=new Map();let headingBytes=0;
export function topicTitleProjectionGroup(project){
 if(project.generationPolicy?.version===2||project.generationPolicy?.language?.mode==='output')return null;
 const language=deckLanguage(project);if(!['en','zh','zh-Hant'].includes(language))return null;
 const source=String(project.source?.text||''),cacheKey=language+'\0'+Boolean(project.deckTitle?.source==='user')+'\0'+source;
 if(headingGroups.has(cacheKey))return headingGroups.get(cacheKey).group;
 const remember=group=>{const bytes=Buffer.byteLength(cacheKey,'utf8');if(bytes<=8*1024*1024){headingGroups.set(cacheKey,{group,bytes});headingBytes+=bytes;while(headingGroups.size>16||headingBytes>8*1024*1024){const key=headingGroups.keys().next().value;headingBytes-=headingGroups.get(key).bytes;headingGroups.delete(key);}}return group;};
 const han=language!=='en',segments=[];let fenced=false;
 for(const [line,raw]of source.split('\n').entries()){
  if(/^\s*(```|~~~)/u.test(raw)){fenced=!fenced;continue;}if(fenced)continue;
  const match=raw.match(/^(#{1,6})\s+(.+)$/u);if(!match)continue;
  const document=match[1]==='#',heading=match[2].trim();if(document&&project.deckTitle?.source==='user')continue;
  const variants=heading.split(/\s+\|\s+|\s*｜\s*/u);
  if(variants.some(text=>han?/\p{Script=Han}/u.test(text):! /\p{Script=Han}/u.test(text)))continue;
  segments.push({key:document?'document-title/line/0':'source-heading/line/'+line,sourceUnitId:document?'$document-title':'$source-heading-'+line,role:document?'document-title':'section-title',text:heading,line});
 }
 if(!segments.length)return remember(null);const locale=language==='zh-Hant'?'zh-HK':language;
 return remember({index:0,locale,segments,hash:hash({locale,segments})});
}
function currentProjection(project){
 const group=topicTitleProjectionGroup(project),saved=project.topicTitleProjection;
 return group&&saved&&saved.groupHash===group.hash&&saved.locale===group.locale&&saved.audit?.status==='passed'&&saved.hash===hash(saved.translations)?saved:null;
}
export function projectedTopicTitleText(project){
 const saved=currentProjection(project);return saved?.translations.find(value=>value.key==='document-title/line/0')?.translated||null;
}
export function projectedSourceHeading(project,heading){
 const raw=String(heading||'').replace(/^#+\s*/u,'').trim();return currentProjection(project)?.translations.find(value=>value.text===raw)?.translated||null;
}
export async function prepareTopicTitleProjection(project,call,save=async()=>{}){
 const group=topicTitleProjectionGroup(project);if(!group||currentProjection(project))return;
 const translations=[],audits=[];
 for(let start=0;start<group.segments.length;start+=24){
 const segments=group.segments.slice(start,start+24),batch={...group,segments,hash:hash({locale:group.locale,segments})};
 const prefix=start?'planning:topic-title:group-'+start/24:'planning:topic-title';
 let repair='',candidate;
 for(let attempt=0;attempt<3;attempt++){
  try{
   if(!candidate){const raw=await call(languageProjectionPrompt(batch)+repair,prefix+':'+attempt);candidate=validateLanguageProjection(batch,raw);}
   const accepted=validateLanguageProjectionAudit(candidate,await call(languageProjectionAuditPrompt(candidate),prefix+':audit:'+attempt));
   translations.push(...accepted.translations);audits.push(accepted.audit);break;
  }catch(error){
   if(attempt===2)throw error;
   if(['timeout','network','transport','model_unavailable'].includes(error.code)){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
   if(error.code!=='coverage_invalid')throw error;
   candidate=undefined;repair='\nCorrect only the source heading projections; preserve its subject, numbers and names. Diagnostic='+error.message;
  }
 }
 }
 project.topicTitleProjection={groupHash:group.hash,locale:group.locale,translations,hash:hash(translations),audit:{status:'passed',groups:audits}};await save(project);
}

import {textParagraphs} from './render-contract.mjs';
import {sourceRichText} from '../ppt-source-text.mjs';

/** Splice the CURRENT rendered native runs, not the old template string.
 * Every run outside the target retains its formatting and link identity. */
export function spliceNativeRange(node,target,replacement){
 if(!node.nativeRef||node.type!=='text'||target.text!==node.content?.text)return null;
 const paragraphs=textParagraphs({...node,kind:'text'});
 const runs=paragraphs.flatMap((p,i)=>[...(i?[{kind:'text',text:'\n'}]:[]),...(p.runs||[{kind:'text',text:p.text}])]);
 if(runs.map(r=>r.text).join('')!==target.text)return null;
 let at=0,inserted=false;const result=[];
 for(const run of runs){
  const start=at,end=at+run.text.length;at=end;
  if(end<=target.start){result.push({...run});continue;}
  if(!inserted){
   if(start<target.start)result.push({...run,text:run.text.slice(0,target.start-start)});
   const rich=sourceRichText(replacement);
   result.push(...rich.runs.map(r=>({...run,...r,bold:Boolean(run.bold||r.bold),italic:Boolean(run.italic||r.italic),fontFamily:r.fontFamily||run.fontFamily,fontSizePt:r.fontSizePt||run.fontSizePt})));
   inserted=true;
  }
  if(end>target.end)result.push({...run,text:run.text.slice(Math.max(0,target.end-start))});
 }
 const next=[{text:'',runs:[]}];
 for(const run of result)for(const [i,part]of run.text.split('\n').entries()){
  if(i)next.push({text:'',runs:[]});
  if(part){next.at(-1).text+=part;next.at(-1).runs.push({...run,text:part});}
 }
 if(next.length!==paragraphs.length)return null;
 return {version:1,paragraphs:next.map((p,i)=>({...paragraphs[i],...p})),plainText:next.map(p=>p.text).join('\n')};
}

import {sourceLineRange} from '../ppt-source-line-ranges.mjs';
/** Streaming writer drafts (V-P0-3). A draft is a non-authoritative preview of
 * what the model is writing for a page: only closed JSON strings are shown,
 * snapshots are persisted separately for recovery, never editable or exportable, and render_ready replaces them.
 * Drafts travel on a transient bus channel, never in the durable event log. */
import { publishTransient } from './event-store.mjs';
import {sourceRichText} from '../ppt-rich-text.mjs';
import {saveDraft,readDraft} from '../ppt-store.mjs';

const drafts = new Map(), lastSent = new Map();
const key = (projectId, slideId) => `${projectId}:${slideId}`;
const TEXT_KEYS = new Set(['title', 'heading', 'body', 'text', 'subtitle', 'takeaway', 'caption', 'label', 'message', 'focus']);
const unescape = value => { try { return JSON.parse(`"${value}"`); } catch { return value.replace(/\\n/gu, '\n').replace(/\\"/gu, '"'); } };

/** Scan JSON tokens, respecting escaped strings. Only complete objects are
 * parsed as incremental blocks; a root title can arrive before its object closes.
 * This validates transport shape, not final page semantics or export eligibility. */
export function draftFromPartialJson(text, inventory = []) {
  const source=String(text||''), blocks=[], stack=[];let title='',typing='';
  const copyTypes=new Set(['definition','mechanism','evidence','example','contrast','constraint','implication','stage','decision','next_step','support']);
  const add=block=>{if(block.text&&!blocks.some(old=>old.sourceUnitId===block.sourceUnitId&&old.text===block.text))blocks.push(block);};
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(c==='"'){
      const start=i;let closed=false;
      for(i++;i<source.length;i++){if(source[i]==='\\'){i++;continue;}if(source[i]==='"'){closed=true;break;}}
      if(!closed)break;
      let field;try{field=JSON.parse(source.slice(start,i+1));}catch{continue;}
      let j=i+1;while(/\s/u.test(source[j]||'')&&j<source.length)j++;
      if(source[j]!==':')continue;j++;while(/\s/u.test(source[j]||'')&&j<source.length)j++;
      if(source[j]!=='"')continue;
      let end=j+1;for(;end<source.length;end++){if(source[end]==='\\'){end++;continue;}if(source[end]==='"')break;}
      const slotText=/^\d+$/u.test(field)&&stack.length>0&&/"slotTexts"\s*:\s*$/u.test(source.slice(0,stack.at(-1)));
      if(end>=source.length){if(TEXT_KEYS.has(field)||slotText)typing=unescape(source.slice(j+1).replace(/\\$/u,''));break;}
      // A closed string is already visible text even while its containing
      // point is incomplete. Keep it until the parsed block replaces it.
      if(TEXT_KEYS.has(field)&&field!=='title')try{typing=JSON.parse(source.slice(j,end+1));}catch{}
      if(slotText){try{add({field:'slotText',text:JSON.parse(source.slice(j,end+1))});}catch{}}
      if(field==='title'&&stack.length===1&&!title){try{title=JSON.parse(source.slice(j,end+1));}catch{}}
      i=end;
    }else if(c==='{')stack.push(i);
    else if(c==='}'&&stack.length){
      const start=stack.pop();let value;try{value=JSON.parse(source.slice(start,i+1));}catch{continue;}
      if(typeof value.sourceUnitId==='string'){
        const item=inventory.find(entry=>entry.id===value.sourceUnitId);
        let lineRange=null;try{if(value.lineStart!==undefined||value.lineEnd!==undefined)lineRange=sourceLineRange(item,value);}catch{continue;}
        const validRange=value.rowStart===undefined&&value.rowEnd===undefined||Number.isInteger(value.rowStart)&&Number.isInteger(value.rowEnd)&&value.rowStart>=1&&value.rowEnd>value.rowStart&&value.rowEnd<=(item?.rows?.length||0);
        if(item&&validRange){const text=lineRange?String(item.text).split('\n').slice(lineRange.lineStart,lineRange.lineEnd).join('\n'):item.rows?.length?[item.rows[0],...item.rows.slice(value.rowStart??1,value.rowEnd??item.rows.length)].map(row=>row.join(' | ')).join('\n'):item.text;if(text)add({sourceUnitId:item.id,sourceRef:{sourceUnitId:item.id,...(lineRange||{}),...(value.rowStart!==undefined?{rowStart:value.rowStart,rowEnd:value.rowEnd}:{})},type:item.type,text:String(text)});}
      }else if(copyTypes.has(value.type)&&typeof value.text==='string'&&value.text.length<=2000){add({field:'text',text:value.text});}
      // A point streams as its short heading, then its body (round 7, A7).
      else if(typeof value.body==='string'&&value.body.length<=2000&&(typeof value.id==='string'&&/^[A-Za-z0-9_-]{1,40}$/u.test(value.id)||typeof value.heading==='string'||typeof value.label==='string'||copyTypes.has(value.type))){add({field:'body',text:value.body,...(typeof value.heading==='string'&&value.heading.trim()?{heading:value.heading.trim().slice(0,200)}:{})});}
    }
  }
  // Keep the page's points in order (bounded); the draft grows like the page.
  if(typing&&blocks.some(block=>block.text===typing||block.heading===typing))typing='';
  return {title,blocks:blocks.slice(0,12),typing};
}

export function updateDraft(project, slideId, { text, chars, seq, jobId, runId=project.currentRunId, epoch=Number(project.editing?.epochs?.[slideId]||0), sourceHash=project.source?.sha256||'' }, { throttleMs = 700 } = {}) {
  if(runId!==project.currentRunId||epoch!==Number(project.editing?.epochs?.[slideId]||0)||sourceHash!==(project.source?.sha256||''))return null;
  const previousDraft=drafts.get(key(project.id,slideId));
  if(seq&&previousDraft?.runId===runId&&previousDraft?.jobId===jobId&&seq<=previousDraft.seq)return null;
  const draft = { ...draftFromPartialJson(text, (project.source?.semantic?.inventory?.items || []).filter(item=>!project.planning?.slidePlan?.length||project.planning.slidePlan.find(plan=>plan.slideId===slideId)?.sourceArtifacts?.some(ref=>ref.sourceUnitId===item.id))), chars, seq, jobId, runId, epoch, sourceHash, updatedAt: new Date().toISOString() };
  const assigned=project.planning?.slidePlan?.find(plan=>plan.slideId===slideId)?.sourceArtifacts;
  if(assigned)draft.blocks=draft.blocks.filter(block=>!block.sourceRef||assigned.some(ref=>['sourceUnitId','rowStart','rowEnd','lineStart','lineEnd'].every(key=>ref[key]===block.sourceRef[key])));
  draft.blocks=draft.blocks.map(block=>({...block,...(block.type==='CodeBlock'?{}:{richText:sourceRichText(block.text)})}));
  drafts.set(key(project.id, slideId), draft);
  const now = Date.now(), previous = lastSent.get(key(project.id, slideId)) || 0;
  if (now - previous < throttleMs || !project.currentRunId) return draft;
  lastSent.set(key(project.id, slideId), now);
  // A recoverable, non-authoritative snapshot. Run/source/epoch checks below
  // prevent a restarted bridge from reviving a superseded draft.
  if(project.uid)saveDraft(project.uid,project.id,slideId,draft);
  publishTransient(project.currentRunId, 'slide.draft', { slideId, draft });
  return draft;
}
export function clearDraft(projectId, slideId) { drafts.delete(key(projectId, slideId)); lastSent.delete(key(projectId, slideId)); }
export function draftsFor(projectId, slideIds = [], project) {
  return Object.fromEntries(slideIds.map(id => [id, drafts.get(key(projectId, id))||(project?.uid?readDraft(project.uid,projectId,id):null)]).filter(([id, value]) => value&&(!project||value.runId===project.currentRunId&&value.epoch===Number(project.editing?.epochs?.[id]||0)&&value.sourceHash===(project.source?.sha256||''))));
}

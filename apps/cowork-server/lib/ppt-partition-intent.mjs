import {diagramTopicLabel} from './ppt-ascii-graph.mjs';
import {projectedSourceHeading} from './ppt-topic-title-projection.mjs';
import {deckScript} from './ppt-presentation-contract.mjs';
const changed=(project,origin,part)=>project.generationPolicy?.version===2&&!project.confirmedOutline&&!project.requestedOutline&&!origin.titleLocked&&!origin.title_locked&&JSON.stringify([origin.sourceUnitIds||[],origin.sourceArtifactRanges||[]])!==JSON.stringify([part.sourceUnitIds||[],part.sourceArtifactRanges||[]]);
/** A generated title must follow the complete new ownership, not the first
 * branch label of one table or an unrelated original parent section. */
export function partitionTitle(project,origin,part){
 if(!changed(project,origin,part))return origin.title;
 const headings=(project.source?.semantic?.inventory?.items||[]).filter(i=>part.sourceUnitIds?.includes(i.id)).map(item=>{
  const raw=item.sectionPath?.filter(Boolean).at(-1)||'';
  const heading=String(projectedSourceHeading(project,raw)||raw).replace(/^(?:\d+\.)*\d+\.?\s+/u,'');
  const alternatives=heading.split(/\s+[|｜]\s+/u).map(s=>s.trim()).filter(Boolean);
  return alternatives.find(s=>deckScript(project)==='han'?/\p{Script=Han}/u.test(s):!/\p{Script=Han}/u.test(s))||alternatives[0]||'';
 }).filter(Boolean);
 const names=[...new Set(headings)];
 if(!names.length)return origin.title;
 const title=names.join(' / ');
 // Metadata overflow is handled by the existing local title-fit repair.
 // Never cut a source topic or a number halfway to fit a heading here.
 return title.length<=160?title:origin.title;
}
/** A parent's claim is not factual authority for each physical child. Reset
 * only generated intent when ownership changes; preserve source and user locks. */
export function partitionIntent(project,origin,part){
 if(!changed(project,origin,part))return {focus:origin.focus,question:origin.question};
 const items=project.source?.semantic?.inventory?.items||[];
 const labels=(part.sourceUnitIds||[]).flatMap(id=>{
  const item=items.find(i=>i.id===id);if(!item)return [];
  const refs=(part.sourceArtifactRanges||[]).filter(r=>r.sourceUnitId===id);
  if(item.rows){const rows=(refs.length?refs:[{}]).flatMap(r=>item.rows.slice(r.rowStart??1,r.rowEnd??item.rows.length));return rows.map(row=>diagramTopicLabel(item,row[0])).filter(Boolean);}
  return [item.sectionPath?.at(-1)||origin.title||'Overview'];
 });
 const scope=[...new Set(labels)].map(s=>String(s).replace(/\s+/gu,' ').trim()).filter(Boolean);
 const sample=((scope.length>3?[...scope.slice(0,2),scope.at(-1)]:scope).join(' / ')||origin.title||origin.section||'Illustration').slice(0,160);
 const han=/\p{Script=Han}/u.test(sample);
 return {focus:sample,question:(han?`${sample}分别说明了什么？`:`What do ${sample} show?`).slice(0,240)};
}

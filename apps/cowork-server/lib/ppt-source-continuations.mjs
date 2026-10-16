import {sourceDisplayText}from './ppt-source-text.mjs';
import {readingUnits} from './ppt-semantic-relations.mjs';
/** A source lead-in may open content too large for one page. Reserve a small
 * measured navigation band before confirmation; bind a handoff only when
 * following frozen pages actually own the consecutive source content. */
export function sourceReadingContinuation(project,index) {
 if(project.generationPolicy?.content!=='full_source')return null;
 const inventory=project.source?.semantic?.inventory?.items||[],page=project.outline?.[index],owned=new Set(page?.sourceUnitIds||[]);
 if(!owned.size)return null;
 const byId=new Map(inventory.map(item=>[item.id,item]));
 const lead=item=>/[:：]\s*$/u.test(sourceDisplayText(item?.text||'').trim());
 const groups=readingUnits(inventory,inventory.map(item=>item.id)).filter(ids=>ids.some(id=>owned.has(id)&&lead(byId.get(id)))&&ids.some(id=>!owned.has(id)&&Boolean(byId.get(id))));
 if(!groups.length)return null;
 const remaining=new Set(groups.flat().filter(id=>!owned.has(id)&&Boolean(byId.get(id))));
 const targets=(project.outline||[]).flatMap((slide,i)=>{const sourceUnitIds=(slide.sourceUnitIds||[]).filter(id=>remaining.has(id));return i>index&&sourceUnitIds.length?[{slideId:slide.id,page:i+1,sourceUnitIds}]:[];});
 if(!targets.length)return null;
 const english=project.generationPolicy?.language?.locale==='en'||project.generationPolicy?.language?.mode==='source'&&!groups.flat().some(id=>owned.has(id)&&/\p{Script=Han}/u.test(byId.get(id)?.text||''));
 return {sourceUnitIds:[...new Set(groups.flat().filter(id=>owned.has(id)))],targets,text:english?'The related source content continues on the following pages.':'相关内容续见后续页面。'};
}

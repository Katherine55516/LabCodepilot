/** Semantic icons on code-placed card pages (Fable S2, 2026-11-01). A point's
 * icon is the one its label names (its text only when exactly one icon's
 * words occur there); a word after a negation (不安全, "not secure") names
 * nothing. A card of 3-6 items shows icons on all of them or none, never the
 * same icon twice; across the deck an icon serves at most two cards. Native
 * template pages keep their own markers (Codex N1): only theme pages plan here. */
import {ICON_CATALOG} from './ppt-icon-catalog.mjs';
import {iconPng} from './ppt-icon-raster.mjs';

const BY_NAME=new Map(ICON_CATALOG.map(icon=>[icon.name,icon]));
const NEGATED=/(?:不|非|无|未|没有|没|缺乏|并非|not\s+|no\s+|non-?|without\s+)$/iu;
const han=word=>/\p{Script=Han}/u.test(word);
/** The icons whose words occur in a text, each with its longest matched word
 * and where its last match ends. */
function found(text){
 const value=String(text||''),hits=new Map();
 for(const icon of ICON_CATALOG)for(const word of icon.keywords){
  const pattern=han(word)?new RegExp(word.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'gu'):new RegExp(`(?<![A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')}(?![A-Za-z])`,'giu');
  for(const match of value.matchAll(pattern)){
   if(NEGATED.test(value.slice(Math.max(0,match.index-8),match.index)))continue;
   const end=match.index+match[0].length,prior=hits.get(icon.name);
   hits.set(icon.name,{length:Math.max(prior?.length||0,[...word].length),end:Math.max(prior?.end||0,end)});
  }
 }
 return hits;
}
export const ICON_NAMES=ICON_CATALOG.map(icon=>icon.name);
/** Whether a label negates every word of an icon it contains ("不安全的默认值"
 * is no shield): a word it holds only after a negation. */
function negatedIn(label,icon){
 const value=String(label||''),plain=new Set(found(value).keys());
 return !plain.has(icon.name)&&icon.keywords.some(word=>value.toLowerCase().includes(word.toLowerCase()));
}
/** One icon for a point, or null when no single icon is clearly named. The
 * writer's own pick from the catalogue comes first (Fable, 2026-11-01), unless
 * its label holds that icon's words only negated; the label's words otherwise. */
export function iconForPoint(point){
 const picked=BY_NAME.get(point?.icon);
 if(picked&&!negatedIn(point?.label,picked))return picked.name;
 const label=found(point?.label);
 // The longest word wins; between equals, the one ending last, as a compound's
 // head word comes last ("模型推理" is reasoning, "data storage" is storage).
 if(label.size){const ranked=[...label].sort((a,b)=>b[1].length-a[1].length||b[1].end-a[1].end);return ranked.length===1||ranked[0][1].length>ranked[1][1].length||ranked[0][1].end>ranked[1][1].end?ranked[0][0]:null;}
 const body=found(point?.text);
 return body.size===1?[...body.keys()][0]:null;
}
// Card grids for now; the arrowed flow (S1a) adds its own icon places.
export const ICON_SHAPES=new Set(['grid']);
/** Each eligible card page's icons, decided once for the deck: pages get
 * cardIcons (one name per point) or none. `shapeOf` gives a page's shape. */
export function planCardIcons(pages,shapeOf){
 const uses=new Map();
 return pages.map((page,index)=>{
  const {cardIcons,...rest}=page;
  const points=page.keyPoints||[];
  if(!index||page.cardFrame||page.role==='closing'||page.figurePage||(page.cardObjects||[]).length||!ICON_SHAPES.has(shapeOf(page))||points.length<3||points.length>6)return rest;
  const icons=points.map(iconForPoint);
  if(icons.some(icon=>!icon)||new Set(icons).size!==icons.length||icons.some(icon=>(uses.get(icon)||0)>=2))return rest;
  for(const icon of icons)uses.set(icon,(uses.get(icon)||0)+1);
  return {...rest,cardIcons:icons};
 });
}
/** The PNG of an icon in a colour. */
export function cardIconImage(name,color){
 const icon=BY_NAME.get(name);
 return icon?iconPng(icon.paths,{color}):null;
}

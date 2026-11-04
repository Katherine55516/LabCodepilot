import {digest, editError} from './edit-context.mjs';
import {spliceNativeRange} from './native-range-edit.mjs';

export const sourceText = value => String(value?.richText?.source ?? value?.rawText ?? value?.text ?? '');
const boundary=(text,at)=>at===0||at===text.length||[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].some(part=>part.index===at);

/** Offsets address immutable source text, not a substring search in rendered text. */
export function resolveEditTarget(node, target) {
  if (!target) return null;
  if (!['range','paragraph','item','graph-node'].includes(target.kind)) throw editError('unsupported text target',400);
  let field=node.content, itemIndex;
  if (['item','graph-node'].includes(target.kind)) {
    itemIndex=node.content?.items?.findIndex(item=>item.id===target.itemId);
    if (!(itemIndex>=0)) throw editError('selected member no longer exists',409);
    field=node.content.items[itemIndex];
    if (target.field && !['text','heading','body'].includes(target.field)) throw editError('invalid member field',400);
    if (target.field) field={text:field[target.field]};
  } else if (node.type!=='text') throw editError('range targets require a text object',400);
  const text=sourceText(field);
  let start=target.start??0,end=target.end??text.length;
  if(target.kind==='paragraph') {
    if(!Number.isInteger(target.paragraphIndex)||target.paragraphIndex<0)throw editError('invalid paragraph index',400);
    const lines=text.split('\n');if(target.paragraphIndex>=lines.length)throw editError('paragraph no longer exists',409);
    start=lines.slice(0,target.paragraphIndex).reduce((n,line)=>n+line.length+1,0);end=start+lines[target.paragraphIndex].length;
  }
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length||!boundary(text,start)||!boundary(text,end))throw editError('invalid UTF-16 source range',400);
  if(target.expectedText!==text.slice(start,end))throw editError('selected source text changed; select again',409);
  // Formula tokens are atomic. Editing their interior would corrupt the rich-text source.
  for(const match of text.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/gu))if(start<match.index+match[0].length&&end>match.index&&(start>match.index||end<match.index+match[0].length))throw editError('select the complete formula',422);
  return {...target,start,end,itemIndex,sourceHash:digest(text),expectedText:text.slice(start,end),text};
}

export function patchEditTarget(node,target,replacement) {
  const current=resolveEditTarget(node,target);
  if(typeof replacement!=='string'||!replacement.trim()||replacement.length>10000)throw editError('replacement must contain readable text',422);
  const content=structuredClone(node.content),next=current.text.slice(0,current.start)+replacement+current.text.slice(current.end);
  if(node.nativeRef&&next.split('\n').length!==current.text.split('\n').length)throw editError('native paragraph structure must be preserved',422);
  if(current.itemIndex!==undefined) {
    const item=content.items[current.itemIndex],field=current.field||'text';item[field]=next;
    if(field==='body'||field==='heading')item.text=[item.heading,item.body].filter(Boolean).join('\n');
    else if(item.heading||item.body){delete item.heading;delete item.body;}
    delete item.richText;delete item.rawText;
  } else {
    const projection=spliceNativeRange(node,current,replacement);
    if(node.nativeRef&&node.nativeTextFrame?.paragraphs?.length&&!projection)throw editError('native range formatting cannot be projected safely; reselect an editable text run',422);
    content.text=projection?.plainText||next;delete content.richText;delete content.rawText;delete content.paragraphs;
    if(projection)content.nativeRunProjection=projection;else delete content.nativeRunProjection;
  }
  return content;
}

/** A word-set equality cannot establish a table's row/column identity. */
export function assertTableTextIdentity(before,after) {
  const rows=before.rows, next=after.rows;
  if(next.length!==rows.length||next.some((row,i)=>row.length!==rows[i].length))throw editError('table projection dimensions changed',422);
  const positions=new Map();rows.forEach((row,r)=>row.forEach((cell,c)=>{const key=String(cell);if(key.trim())positions.set(key,[...(positions.get(key)||[]),`${r}:${c}`]);}));
  next.forEach((row,r)=>row.forEach((cell,c)=>{
    const prior=String(rows[r][c]);
    if((r===0||c===0||/[0-9%％]/u.test(prior))&&cell!==rows[r][c])throw editError('table headers, row identities and numeric cells are immutable in a text edit',422);
    const old=positions.get(String(cell));if(old&&!old.includes(`${r}:${c}`))throw editError('table cell moved to another row or column; use a sourced data proposal',422);
  }));
}

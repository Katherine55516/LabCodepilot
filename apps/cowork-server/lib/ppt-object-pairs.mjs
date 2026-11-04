/** Source objects given once per language. A leaf module: the outline folds
 * the pair into one card object and the page composer merges paired tables. */
const originals=p=>p.originalSourceInventory?.items||p.source?.semantic?.inventory?.items||[];
const isObject=item=>Boolean(item?.rows||item?.diagramSource||['EquationBlock','CodeBlock'].includes(item?.type));
/** Objects the source gives once per language (Fable plan T26, mlq p30/p31:
 * the purge/embargo diagram as an English and a Chinese code block): one
 * language pair id, or consecutive objects of one kind in one section with the
 * same shape (rows or lines within one) and opposite scripts. Maps the copy in
 * the deck's other language to the one in its primary language. */
const pairCache=new WeakMap();
const hanMajority=text=>{const t=String(text||''),han=(t.match(/\p{Script=Han}/gu)||[]).length,latin=(t.match(/[A-Za-z]/gu)||[]).length;return han>latin/2;};
const objectShape=item=>item.rows?[item.rows.length,item.rows[0]?.length||0]:[String(item.text||'').split('\n').length,0];
export function objectPairs(p){
 const list=originals(p);if(pairCache.has(list))return pairCache.get(list);
 const zhDeck=String(p.inputUnderstanding?.primaryLanguage||'en').startsWith('zh'),pairs=new Map(),objects=list.filter(isObject);
 const join=(a,b)=>{if(hanMajority(a.text)===hanMajority(b.text))return;const [primary,other]=hanMajority(a.text)===zhDeck?[a,b]:[b,a];if(!pairs.has(other.id)&&!pairs.has(primary.id))pairs.set(other.id,primary.id);};
 for(const a of objects)for(const b of objects)if(a!==b&&a.languagePairId&&a.languagePairId===b.languagePairId)join(a,b);
 for(let k=0;k+1<objects.length;k++){
  const a=objects[k],b=objects[k+1];
  if(a.type!==b.type||String(a.sectionPath?.at(-1))!==String(b.sectionPath?.at(-1)))continue;
  const [ra,ca]=objectShape(a),[rb,cb]=objectShape(b);
  if(Math.abs(ra-rb)<=1&&ca===cb)join(a,b);
 }
 pairCache.set(list,pairs);return pairs;
}

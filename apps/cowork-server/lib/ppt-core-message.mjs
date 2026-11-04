/** A narrow near-copy guard, not a semantic verdict or source acceptance. */
export function repeatsCoreMessage(left,right){
 const normalize=value=>String(value||'').toLowerCase().replace(/[\s\p{P}]+/gu,'');
 const a=normalize(left),b=normalize(right);if(a===b)return Boolean(a);
 const [short,long]=a.length<=b.length?[a,b]:[b,a];
 if(short.length<80||short.length/long.length<.65)return false;
 const grams=value=>new Set(Array.from({length:value.length-11},(_,i)=>value.slice(i,i+12)));
 const source=grams(short),target=grams(long);
 return [...source].filter(part=>target.has(part)).length/source.size>=.82;
}

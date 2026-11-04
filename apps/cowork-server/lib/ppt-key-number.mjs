/** A point's key number: a decimal, a percentage, a multiple, basis points
 * or a figure of three or more digits, as the source writes it (never a list
 * or section number). The tile repeats it; the point keeps its full text.
 * The number a point leads with (within its first 12 visual units), else ''
 * (Fable F2, 2026-11-01: a number from mid-text became a KPI headline cut off
 * from its words). A leaf module: the card outline and the card pages read it. */
export function keyNumber(text){
 const lead=String(text||'').trim(),match=lead.match(/(?<![\w.])[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:%|‰|×|x(?![a-z])|bps?|倍)|(?<![\w.])[-+−]?\d+\.\d+(?![\w.])|(?<![\w.])\d{1,3}(?:,\d{3})+(?![\w.])|(?<![\w.])\d{3,}(?![\w.])/iu);
 // The words before it weigh at most 12 visual units (a Chinese character 1,
 // a Latin one 0.55): "Average IC of 0.05" leads, "机制的当前行为是…400" does not.
 const before=match?[...lead.slice(0,match.index)].reduce((sum,char)=>sum+(/[\u2e80-\u9fff\uf900-\ufaff]/u.test(char)?1:.55),0):Infinity;
 const token=match&&before<=12?match[0].trim():'';
 // A year is a date, not a measure.
 return /^(?:19|20)\d{2}$/u.test(token)?'':token;
}
/** The number a point's text sets rather than measures (Fable Q3, 2026-11-03,
 * Mood × JEPA p13: "300 / 300 / 500" training epochs as result tiles): a
 * hyperparameter or size word right beside it. */
const SETTING=/^(?:\s*(?:个|次|轮|层|维|步))?\s*(?:epochs?|iterations?|iters?|steps?|warm-?up|batch(?:\s*size)?|batches|layers?|heads?|dims?|dimensions?|channels?|tokens?\s+per|patch(?:es)?|stride|resolution|hidden|轮次?|迭代|批(?:大小|量)?|层|维|头|通道|步长|分辨率)|(?:epochs?|batch\s*size|batch|learning\s*rate|lr|dim(?:ension)?s?|layers?|heads?|patch\s*size|resolution|学习率|批大小|批量|维度|层数|头数|分辨率|训练轮数|轮数)\s*(?:of|为|是|=|:|：)?\s*$/iu;
export function settingNumber(text,number=keyNumber(text)){
 const value=String(text||''),at=number?value.indexOf(number):-1;if(at<0)return false;
 return SETTING.test(value.slice(at+number.length,at+number.length+14))||SETTING.test(value.slice(Math.max(0,at-16),at));
}
/** Whether points' lead numbers may stand as result tiles (Fable Q3): two or
 * more, all distinct, none a setting. */
export function measuredNumbers(points){
 const numbers=points.map(point=>keyNumber(point?.text));
 return numbers.length>=2&&numbers.every(Boolean)&&new Set(numbers.map(n=>n.replace(/[\s,]/gu,''))).size===numbers.length&&points.every((point,k)=>!settingNumber(point?.text,numbers[k]));
}

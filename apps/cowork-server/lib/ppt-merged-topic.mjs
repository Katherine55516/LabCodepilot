/** A merged topic must retain both complete subjects. A long label is measured
 * by the existing title gates; never silently discard the second topic. */
export function mergedTopicTitle(project, first, second) {
  const headings=String(project.source?.text||'').split('\n').flatMap(line=>{
    const match=line.match(/^\s*#{1,6}\s+(.+?)\s*$/u);return match?[match[1].replace(/^\d+(?:\.\d+)*[.)、]?\s+/u,'')]:[];
  }).sort((a,b)=>b.length-a.length);
  const topic=title=>{
    const clean=title.replace(/^\d+(?:\.\d+)*[.)、]?\s+/u,'');
    const original=headings.find(heading=>clean===heading||clean.startsWith(heading+'：')||clean.startsWith(heading+':'));
    return original?original.replace(/^\d+(?:\.\d+)*[.)、]?\s+/u,''):title;
  };
  const topics=[...new Set([topic(first),topic(second)])].filter((value,index,all)=>!all.some((other,j)=>j!==index&&(other.startsWith(value+':')||other.startsWith(value+'：'))));
  const joined=topics.join(/\p{Script=Han}/u.test(topics.join(''))?'、':' & ');
  return joined.length<=160?joined:null;
}

/** Explicit chapter references are navigation, not financial measurements.
 * Still require the same exact reference in the original input (including
 * unresolved references supplied by the author); a bare matching number is
 * never authority for a new citation. */
export function sectionReferenceRanges(value) {
 const text=String(value||''),out=[];
 const pattern=/(?:§\s*|\b(?:sections?|chapters?)\s+)(\d+(?:\.\d+)*)|第\s*(\d+(?:\.\d+)*)\s*[节章]/giu;
 for(const m of text.matchAll(pattern)){const id=m[1]||m[2],start=m.index+m[0].indexOf(id);out.push({id,start,end:start+id.length});}
 return out;
}
export function sourceSectionReferenceIds(values) {
 const ids=new Set();
 for(const value of values){for(const r of sectionReferenceRanges(value))ids.add(r.id);for(const m of String(value||'').matchAll(/^\s*#{1,6}\s+(\d+(?:\.\d+)*)(?=[.)、]?\s)/gmu))ids.add(m[1]);}
 return ids;
}
export function isSectionReferenceList(value) {
 // Require a complete argument made only of explicit references. Arithmetic,
 // arbitrary function arguments and text around a citation remain checked.
 const ref='(?:(?:§\\s*|sections?\\s+|chapters?\\s+)\\d+(?:\\.\\d+)*|第\\s*\\d+(?:\\.\\d+)*\\s*[节章])';
 const locator='(?:'+ref+'|(?:traps?|figures?|tables?|examples?)\\s+\\d+)';
 return new RegExp('^\\s*'+ref+'(?:\\s*(?:[,;/、]|and|与)\\s*'+locator+')*\\s*$','iu').test(String(value||''));
}

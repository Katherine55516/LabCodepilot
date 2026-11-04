import assert from 'node:assert/strict';
import {sourceDisplayText,sourceRichText}from './lib/ppt-rich-text.mjs';
// Capacity scans need the same typed-parser projection without cloning its
// complete mutable math/run tree for a string-only read.
for(const input of [null,undefined,0,false,'','**Gamma architecture:**','**架构如下：**','[Reference](https://example.com)','Inline $x_i^2$ and **conditions**','```python\nprint("a:b")\n```']){
 const expected=sourceRichText(input).plainText.trim();
 for(let repeat=0;repeat<3;repeat++)assert.equal(sourceDisplayText(input),expected);
 const rich=sourceRichText(input);rich.plainText='Changed by caller';if(rich.runs[0])rich.runs[0].text='Mutated run';
 assert.equal(sourceDisplayText(input),expected,'mutable rich payloads must never corrupt the shared string projection');
}
const source='**Complete condition:** $x_i\\neq 0$';const before=sourceDisplayText(source);
for(let index=0;index<600;index++)sourceDisplayText('Distinct cache entry '+index);
assert.equal(sourceDisplayText(source),before,'eviction and reparsing retain the exact typed-parser semantics');
console.log('Immutable display projection, caller mutation isolation and bounded-cache eviction: OK');

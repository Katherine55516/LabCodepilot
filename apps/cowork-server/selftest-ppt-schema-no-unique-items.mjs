// Model response schemas never declare uniqueItems: the qwen gateway rejects
// the keyword with HTTP 400, which failed every v2 input read (full review
// F7, 2026-10-21). Uniqueness is validated locally after the reply (see
// ppt-explanation-obligations.mjs and ppt-reply-normalize.mjs, which only
// reads the keyword of a schema it is given).
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=new URL('./lib/',import.meta.url).pathname,found=[];
const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);
 if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.mjs'))fs.readFileSync(file,'utf8').split('\n').forEach((line,index)=>{if(/["']?uniqueItems["']?\s*:\s*true/u.test(line))found.push(`${path.relative(root,file)}:${index+1}`);});}};
walk(root);
assert.deepEqual(found,[],'a schema declares uniqueItems: '+found.join(', '));
// The emitted obligations schema stays free of it.
const {obligationSchema}=await import('./lib/ppt-explanation-obligations.mjs');
assert.ok(!JSON.stringify(obligationSchema('b_0001')).includes('uniqueItems'));
console.log('PASS model schemas: no uniqueItems anywhere in lib (validated locally instead)');

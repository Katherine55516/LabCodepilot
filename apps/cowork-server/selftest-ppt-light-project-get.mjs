// A full project read summarises the template's fidelity (Fable D5, 2026-11-01:
// a 3186 GET was 31-35 MB, 20 MB of it template slides, source catalog and
// component profile); ?include=templateFidelity returns it whole.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
process.env.COWORK_STATE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-light-get-'));
const {templateFidelitySummary}=await import('./lib/ppt/project-view.mjs');
const {handlePpt}=await import('./lib/ppt-api.mjs'),store=await import('./lib/ppt-store.mjs');
const fidelity={mode:'preserve',sha256:'a'.repeat(64),width:12192000,height:6858000,slideMap:[0,1],slides:[{nodes:[{id:'n',content:{dataUrl:'data:image/png;base64,'+'A'.repeat(50000)}}]},{nodes:[]}],sourceCatalog:{s1:{},s2:{},s3:{}},componentProfile:{x:{}}};
const summary=templateFidelitySummary(fidelity);
assert.deepEqual(Object.keys(summary).sort(),['counts','height','mode','sha256','slideMap','summary','width']);
assert.deepEqual(summary.counts,{slides:2,sourceCatalog:3,componentProfile:1});
assert.equal(templateFidelitySummary(undefined),undefined);
const uid='light-get',id='f'.repeat(32);
store.save({uid,id,title:'Light read',status:'completed',stage:'publish',outline:[],nodes:{},revision:1,templateFidelity:fidelity,generationPolicy:{}});
const get=async query=>{const req=Readable.from([]);req.method='GET';let out;await handlePpt(req,new URL(`http://test/ppt/projects/${id}${query}`),{uid,activity:()=>{},log:()=>{},send:(status,body)=>{out={status,body};return true;},res:{writeHead(){},on(){}}});return out;};
const light=await get(''),full=await get('?include=templateFidelity');
assert.equal(light.status,200,JSON.stringify(light.body).slice(0,200));
assert.equal(light.body.project.templateFidelity.summary,true);
assert.equal(light.body.project.templateFidelity.slides,undefined,'no template slides by default');
assert.equal(full.body.project.templateFidelity.slides.length,2,'everything when asked');
assert.ok(JSON.stringify(light.body).length<JSON.stringify(full.body).length-40000);
console.log('PASS light project read: template fidelity summarised by default, whole on ?include=templateFidelity');

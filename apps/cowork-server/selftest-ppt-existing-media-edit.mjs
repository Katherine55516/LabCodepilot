import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-existing-media-'));process.env.COWORK_STATE_DIR=root;
const {enrichAssetRefs}=await import('./lib/ppt/assets.mjs');
try{
 // Treat existing opaque native bytes as an already-owned fixture asset.
 // They may exceed NEW insert limits; native import/export has its own checks.
 const large='data:image/png;base64,'+Buffer.alloc(600*1024,12).toString('base64'),small='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c3ioAAAAASUVORK5CYII=';
 const p={uid:'media-edit',id:'a'.repeat(32),deck:{slides:[{id:'native',nodes:[{id:'art',type:'image',nativeRef:{shapeId:1},content:{dataUrl:large}}],blocks:[{type:'image',dataUrl:large}]}]}};
 const before=JSON.stringify(p);enrichAssetRefs(p,{strict:true,unchangedDataUrls:new Set([large])});assert.equal(JSON.stringify(p),before,'unchanged existing image bytes and metadata stay untouched');
 assert.throws(()=>enrichAssetRefs(structuredClone(p),{strict:true}),/512 KB/,'absence of before-deck proof keeps the new upload guard');
 const changed=structuredClone(p);changed.deck.slides[0].nodes[0].content.dataUrl=large.slice(0,-8)+'AQIDBAU=';
 assert.throws(()=>enrichAssetRefs(changed,{strict:true,unchangedDataUrls:new Set([large])}),/512 KB/,'forged native identity does not exempt replacement bytes');
 const inserted=structuredClone(p);inserted.deck.slides[0].nodes.push({id:'new',type:'image',content:{dataUrl:small}});enrichAssetRefs(inserted,{strict:true,unchangedDataUrls:new Set([large])});assert.ok(inserted.deck.slides[0].nodes[1].content.assetId);assert.equal(inserted.deck.slides[0].nodes[0].content.assetId,undefined);
 console.log('PASS text/native edits preserve existing large artwork without metadata churn; new/replaced bytes retain insertion limits');
}finally{fs.rmSync(root,{recursive:true,force:true});}

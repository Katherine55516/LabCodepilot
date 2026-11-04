// Template picture readers (Fable + user, 2026-11-02; template media plan,
// phase 2). Without a system tesseract the server reads template pictures
// with tesseract.js; the import's PIL check says whether a picture is
// continuous tone. A picture both find free of text and charts is kept as the
// template's style (L1); pixels alone never certify; brushstroke noise is not
// text; a single strong word among noise is uncertain and fails closed.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.COWORK_STATE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'picture-read-'));
const {pictureTextOutcome,pictureCertificate,readPictureText,readTemplatePictures}=await import('./lib/ppt-template-picture-read.mjs');

const w=(text,confidence)=>({text,confidence});
// Real drawn text (template buttons, captions) and brushstroke noise (Mood-Board paintings).
assert.equal(pictureTextOutcome([w('EXPLORE',96),w('OUR',96),w('SERVICES',96)]).outcome,'text');
assert.equal(pictureTextOutcome([w('contact@company.com',90)]).outcome,'text','one strong word in a small picture is text');
assert.equal(pictureTextOutcome([w('季度营收',80),w('增长',78)]).outcome,'text','Chinese at 75+');
assert.equal(pictureTextOutcome([w('ESS',64),...Array.from({length:150},()=>w('~',20))]).outcome,'no_text','noise below 85 is no word');
assert.equal(pictureTextOutcome([w('7),',82),w('777',71),w('4',95),w('=',94)]).outcome,'no_text','symbols and digits are no letter words');
// The user's review (2026-11-02): OCR not reading a word is no proof there is
// none. Two or more letters in any script at 70+ make a picture uncertain,
// never certified: a logo's "HP", Arabic, "Revenue" read at 84.
for(const [word,conf] of [['HP',95],['مرحبا',80],['Revenue',84]])assert.equal(pictureTextOutcome([w(word,conf),...Array.from({length:12},()=>w('~',20))]).outcome,'uncertain',word);
assert.equal(pictureCertificate({ocr:{status:'ok',words:0,digitRun:false,lettered:1},pixels:{continuousTone:true}}),null,'the system reader\'s two-letter word blocks it too');
assert.equal(pictureTextOutcome([w('AY',60),w('agli',46),w('y',90)]).outcome,'no_text','brushstroke noise stays no text');
assert.equal(pictureTextOutcome([w('of',75),w('三三',72),...Array.from({length:70},()=>w('|',85))]).outcome,'no_text','a busy painting\'s few chance two-letter strings stay below the share');
const uncertain=pictureTextOutcome([w('LOGO',90),...Array.from({length:40},()=>w('x',20))]);
assert.equal(uncertain.outcome,'uncertain','one strong word among noise fails closed');
assert.ok(uncertain.words>=3,'uncertain keeps the picture out like text');
assert.equal(pictureTextOutcome([w('1',95),w('2',94)]).outcome,'numbers_only');
assert.deepEqual(pictureTextOutcome([w('EXPLORE',96),w('a',10)]).top,[['EXPLORE',96],['a',10]],'the strongest words are recorded');

// L1 certificate: no text by a reader and continuous-tone pixels; never pixels alone.
const tone={continuousTone:true,flat:0,top4:.17,edges:0};
assert.deepEqual(pictureCertificate({ocr:{status:'ok',engine:'tesseract.js',outcome:'no_text'},pixels:tone}),{level:'L1',by:['tesseract.js','pil']});
assert.equal(pictureCertificate({ocr:{status:'unavailable'},pixels:tone}),null,'pixels alone never certify');
assert.equal(pictureCertificate({ocr:{status:'ok',outcome:'no_text'},pixels:{...tone,continuousTone:false}}),null,'a chart or flat artwork is not continuous tone');
assert.equal(pictureCertificate({ocr:{status:'ok',outcome:'uncertain'},pixels:tone}),null);
assert.equal(pictureCertificate({ocr:{status:'ok',outcome:'no_text'},pixels:tone,href:'https://gamma.app'}),null,'a linked picture is never style');

// Reads are cached by hash: a second read costs nothing; the downscaled copy is dropped.
let calls=0;const read=async()=>{calls++;return [w('Made',96),w('with',95),w('GAMMA',78)];};
const first=await readPictureText('data:image/png;base64,AAAA','hash-1',{read});
const second=await readPictureText('data:image/png;base64,AAAA','hash-1',{read});
assert.equal(first.outcome,'text');assert.ok(second.cached);assert.equal(calls,1,'cached by hash');
const project={deck:{slides:[{nodes:[{id:'p',type:'image',content:{imageSha256:'hash-2',ocr:{status:'unavailable'},pixels:{...tone,ocrImage:'data:image/png;base64,BBBB'}}}]}]},externalPptx:{inherited:[{kind:'image',imageSha256:'hash-1',ocr:{status:'unavailable'},pixels:{continuousTone:false,ocrImage:'data:image/png;base64,AAAA'}}]}};
const noText=async()=>{calls++;return [w('4',95),w('~',20)];};
const counts=await readTemplatePictures(project,{read:noText});
assert.deepEqual(counts,{read:1,fromCache:1});
const node=project.deck.slides[0].nodes[0];
assert.equal(node.content.ocr.outcome,'numbers_only');assert.equal(node.content.pixels.ocrImage,undefined,'the copy is not kept');
assert.ok(pictureCertificate(node.content),'a lone digit in a continuous-tone picture is brushstroke noise');
assert.equal(project.externalPptx.inherited[0].ocr.outcome,'text','the layout badge reads as text');
// Source diagram text (the legibility floor, Fable 2026-11-02): the 10th
// percentile word box height as a share of the OCR copy's width; fewer than 3
// words leave no share; read once by hash, copies dropped, hashes known to ingest.
{const {figureTextShare,measureFigureText,knownFigureHashes,solidCopy}={...await import('./lib/ppt-template-picture-read.mjs'),solidCopy:(await import('./lib/ppt-chrome-slots.mjs')).solidPng};
 const box=(text,h,confidence=90)=>({text,confidence,bbox:{x0:0,y0:0,x1:10,y1:h}});
 assert.deepEqual(figureTextShare([box('Vision',20),box('Memory',22),box('Controller',24),box('x',2),box('noise',30,40)],1000),{status:'ok',words:3,share:.02},'words of 2+ characters at ≥70 confidence');
 assert.equal(figureTextShare([box('Vision',20),box('Memory',22)],1000).share,null,'fewer than 3 words: no share');
 let reads=0;const read=async()=>{reads++;return [box('Vision',20),box('Memory',22),box('Controller',24)];};
 const copy=solidCopy('#ffffff',200,50),images=[{id:'f',imageSha256:'ab'.repeat(32),figureText:{source:'pending',boxWidthPt:100},ocrImage:copy},{id:'p',ocrImage:'x'}];
 await measureFigureText(images,{read});
 assert.deepEqual(images[0].figureText,{source:'ocr',boxWidthPt:100,words:3,share:.1},'share of the 200 px copy');
 assert.ok(images.every(image=>!('ocrImage' in image)),'copies are never kept');
 const again=[{id:'f',imageSha256:'ab'.repeat(32),figureText:{source:'pending',boxWidthPt:100}}];await measureFigureText(again,{read});
 assert.equal(reads,1,'a known figure is not read again, even without a copy');assert.equal(again[0].figureText.share,.1);
 assert.ok(knownFigureHashes().includes('ab'.repeat(8)),'ingest learns the hash');
 const unread=[{id:'g',imageSha256:'cd'.repeat(32),figureText:{source:'pending',boxWidthPt:100},ocrImage:copy}];await measureFigureText(unread,{read:async()=>[box('Vision',20)]});
 assert.equal(unread[0].figureText.source,'ocr_unread');assert.equal(unread[0].figureText.share,undefined);}
console.log('PASS template picture readers: text vs brushstroke noise, uncertain fails closed, L1 needs both readers, cached by hash; diagram text share by OCR');

/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures intentionally exercise dynamic or malformed model/API payloads. */
import {it} from 'node:test';
import assert from 'node:assert/strict';
const m=(n:string)=>import(process.cwd()+'/apps/cowork-server/lib/'+n+'.mjs');
it('diagram navigation drops Mermaid markers and does not mislabel a merged branch page',async()=>{
 const {diagramEyebrow}=await m('ppt-section-eyebrow');
 const items=[{id:'a',sectionPath:['Root','alt [5A) Tool]']},{id:'b',sectionPath:['Root','[5B) Resource]']}];
 const p={source:{segments:[{diagram:{kind:'sequence'}}],semantic:{inventory:{items}}}};
 assert.equal(diagramEyebrow(p,{sourceUnitIds:['a','b']},'alt [5A) Tool]'),'');
 assert.equal(diagramEyebrow(p,{sourceUnitIds:['a']},'alt [5A) Tool] 10'),'Tool');
 assert.equal(diagramEyebrow({},{} ,'Chapter 10'),'Chapter 10');
});
it('a source figure cover reserves a real media region without reducing its title or font',async()=>{
 const {regionsFor,layoutFor}=await m('ppt-layout');
 const plain=regionsFor({layoutId:'cover'}),figure=regionsFor({layoutId:'cover',sourceImageIds:['original']});
 assert.ok(figure.find((r:any)=>r.id==='body').h>plain.find((r:any)=>r.id==='body').h*4);
 assert.equal(figure.find((r:any)=>r.id==='title').h,plain.find((r:any)=>r.id==='title').h);
 assert.ok(layoutFor('cover').allowedBlocks.includes('image'));assert.ok(!layoutFor('cover').allowedBlocks.includes('table'));
 const title=figure.find((r:any)=>r.id==='title'),body=figure.find((r:any)=>r.id==='body');assert.ok(title.y+title.h<body.y);
});
it('rebinding a source image preserves its bytes and keeps exactly one image and caption',async()=>{
 const {bindSourceMedia}=await m('ppt-source-artifacts');
 const p:any={pages:3,outline:[{id:'s',role:'cover',sourceImageIds:['original']}],source:{images:[{id:'original',type:'image',width:400,height:600,dataUrl:'data:image/png;base64,AA==',imageSha256:'original-hash',caption:'Original visual'}]},templateSpec:{fonts:{body:'Arial'}},deck:{slides:[]}};
 const s:any={id:'s',title:'Subject',layoutId:'cover',nodes:[],copy:{blocks:[]}};p.deck.slides=[s];
 bindSourceMedia(p,s,['original'],0);const first=structuredClone(s.sourceArtifactNodes);bindSourceMedia(p,s,['original'],0);
 assert.equal(s.nodes.filter((n:any)=>n.content?.sourceImageId).length,1);assert.equal(s.nodes.filter((n:any)=>n.content?.sourceImageCaptionId).length,1);assert.equal(s.nodes.find((n:any)=>n.content?.sourceImageId).content.dataUrl,first.find((n:any)=>n.content?.sourceImageId).content.dataUrl);
});

it('deck navigation does not reintroduce a first-branch alt marker after local copy normalization',async()=>{const {normalizeDeckEyebrows}=await m('ppt-section-eyebrow');const p:any={generationPolicy:{language:{mode:'source'}},source:{segments:[{diagram:{kind:'sequence'}}],semantic:{inventory:{items:[{id:'a',sectionPath:['Root','alt [3) No external] 10']},{id:'b',sectionPath:['Root','[4B) MCP]']}]}}},outline:[{id:'cover'},{id:'route',sourceUnitIds:['a','b']}],deck:{slides:[{id:'cover'},{id:'route',copy:{eyebrow:'alt [3) No external] 10'},nodes:[{id:'label',type:'text',semanticRole:'eyebrow',content:{text:'alt [3) No external] 10'}}]}]}};normalizeDeckEyebrows(p);assert.equal(p.deck.slides[1].copy.eyebrow,'');assert.equal(p.deck.slides[1].nodes[0].content.text,'');normalizeDeckEyebrows(p);assert.equal(p.deck.slides[1].nodes[0].content.text,'');assert.equal(p.source.semantic.inventory.items[0].sectionPath[1],'alt [3) No external] 10');});

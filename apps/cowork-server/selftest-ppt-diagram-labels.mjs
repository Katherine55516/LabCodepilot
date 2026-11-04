// Diagram-derived labels and the source's one diagram (Fable D4, 2026-11-01):
// "alt [3) 不需要外部能力] 10" reads as its branch name; a source with one
// diagram shows it on a full figure page after the first content card.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.COWORK_STATE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-diagram-labels-'));
const {headingText,diagramBranchLabel,assignSourceImages}=await import('./lib/ppt-card-outline.mjs');
const {placeCardFigures}=await import('./lib/ppt-card-figure-layout.mjs');
for(const [heading,label] of [['alt [3) 不需要外部能力] 10','不需要外部能力'],['[3) 需要外部能力]','需要外部能力'],['alt [5A) 只用Tool]','只用Tool'],['[5C) Prompt 工作流 + Resource + Tool + Prompt','Prompt 工作流 + Resource + Tool + Prompt'],['loop [每个请求]','每个请求'],['alt [ ] 7','']])
 assert.equal(headingText(heading,'zh'),label,heading);
for(const heading of ['[Draft] Plan','Python 3','Alternatives','3.2 Method'])assert.equal(diagramBranchLabel(heading),heading,'an ordinary heading is unchanged');
assert.equal(headingText('3.2 Method','en'),'Method','section numbers still go');

// One source diagram: a figure page right after the first content card, never moved beside points.
const image={id:'img1',width:2448,height:3168,caption:'原始时序图（箭头、参与者与分支关系）',sourceRefs:['2'],required:true};
const p={source:{images:[image],semantic:{inventory:{items:[{id:'u1',text:'模型按需求选择调用路径',source_ref:['2'],sectionPath:['MCP','alt [3) 不需要外部能力] 10']}]}},segments:[]},generationPolicy:{language:{mode:'source'}},planningContract:{pagePreference:{preset:'standard'}},inputUnderstanding:{primaryLanguage:'zh'}};
const raw={slides:[{id:'cover',title:'MCP 完整链路图',keyPoints:[]},{id:'c1',logicalCardId:'l1',title:'模型按需求选择调用路径',section:'不需要外部能力',keyPoints:[{text:'模型先判断是否需要外部能力。',sourceUnitIds:['u1'],refs:['2']}]},{id:'c2',logicalCardId:'l2',title:'内置能力更快时优先执行',keyPoints:[{text:'内置能力更稳时直接执行。',sourceUnitIds:['u1'],refs:['2']}]},{id:'end',title:'感谢观看',role:'closing',keyPoints:[]}]};
const out=assignSourceImages(p,raw);
const at=out.slides.findIndex(slide=>slide.figurePage);
assert.equal(at,2,'the figure page follows the first content card');
assert.deepEqual(out.slides[at].sourceImageIds,['img1']);
assert.equal(out.slides[at].soleFigure,true);
assert.ok(!out.slides[1].sourceImageIds?.length,'the card itself holds no thumbnail');
const placed=placeCardFigures({templateFidelity:{mode:'preserve',slides:[]},outline:out.slides},out,{reschedule:()=>{},isNative:()=>false,fits:()=>true});
// Nothing moves; the figure page only gains its reason (Fable 2026-11-03).
const strip=({figureOnlyReason,figureOnlyDetail,...page})=>page;
assert.deepEqual(placed.slides.map(strip),out.slides,'the sole diagram is never moved beside points');
assert.equal(placed.slides[at].figureOnlyReason,'no_points','a sole figure has no points of its own');
// A single figure that one card cites stays with that card.
{const one=structuredClone(raw);one.slides[2].keyPoints[0].refs=['9'];one.slides[1].keyPoints[0].refs=['1'];
 const imageOne={...image,sourceRefs:['1']},q={...p,source:{...p.source,images:[imageOne]}};
 const res=assignSourceImages(q,one);assert.ok(!res.slides.some(slide=>slide.soleFigure),'cited by one card: no sole figure page');}
console.log('PASS diagram labels read as branch names; the one source diagram has its own figure page after the first card');

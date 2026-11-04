import assert from 'node:assert/strict';
import {fitComponents,sourceComponent} from './lib/ppt-density-capacity.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
const I=914400,project={template:'violet',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='violet'))};
const components=[{type:'table',content:{rows:[[''],...Array.from({length:8},(_,i)=>['Branch '+i])]}},{type:'text',content:{text:'这种解耦意味着 text generation、media generation、research 可以并行或部分并行，\n而不是完全串行等待。'}},{type:'text',content:{text:'Gamma 公开表示会使用多个 AI models，并持续评估不同 frontier models 的 quality、latency 和 cost。\n这意味着它更接近一个 model router，而不是单模型系统。'}}];
const untouched=JSON.stringify(components),fit=fitComponents(components,project,1);assert.equal(fit.capacity_ok,true);assert.equal(fit.fontSizePt,18);assert.equal(JSON.stringify(components),untouched);
const overlaps=(a,b)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+1&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+1;
for(let i=0;i<fit.boxes.length;i++)for(let j=i+1;j<fit.boxes.length;j++)assert.equal(overlaps(fit.boxes[i],fit.boxes[j]),false,'centering must preserve every column stack gap');
for(const b of fit.boxes){assert.ok(b.y>=fit.canvas.y-1);assert.ok(b.y+b.height<=fit.canvas.y+fit.canvas.height+1);}
const right=fit.boxes.slice(1);if(Math.abs(right[0].x-right[1].x)<2)assert.ok(right[1].y>=right[0].y+right[0].height,'right-column paragraphs remain sequential');
const raw=Array.from({length:17},(_,i)=>i===8?'  ├─ No → render':'  │ stage '+i).join('\n'),rows=[[''],...raw.split('\n').map(s=>[s])],item={id:'diagram',type:'TableBlock',rows,text:'summary',must_preserve_structure:true,diagramSource:{kind:'ascii',relation:'branching',text:raw}};
const c=sourceComponent(item),p={source:{semantic:{inventory:{items:[item]}}},planning:{slidePlan:[{slideId:'body',sourceArtifacts:[{sourceUnitId:item.id}]}]},deck:{slides:[{id:'body',nodes:[{id:'graph',...c,sourceArtifact:{sourceUnitId:item.id,rowStart:1,rowEnd:rows.length},geometry:{x:I,y:I,width:I*10,height:I*5}}]}]}};
assert.deepEqual(inspectObjectIntegrity(p).issues,[]);const bad=structuredClone(p);bad.deck.slides[0].nodes[0].content.rows[9][0]='├─ No → render';assert.ok(inspectObjectIntegrity(bad).issues.some(i=>i.sourceUnitId==='diagram'),'ASCII indentation conveys branch structure and cannot be normalized away');
console.log('Table plus two prose components preserve column gaps, body bounds and 18pt; raw diagram indentation corruption is rejected.');

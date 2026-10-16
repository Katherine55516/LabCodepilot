import assert from 'node:assert/strict';
import {inspectSourceNumbers}from './lib/ppt-source-numbers.mjs';

const rows=[['Object','Meaning'],...Array.from({length:8},()=>['Original','Condition']),['Workers','Actual source condition']];
const ref={sourceUnitId:'table',rowStart:9,rowEnd:10};
const slide={id:'one',title:'Workers (Row 9)',sourceArtifactRanges:[ref],nodes:[
 {id:'title',type:'text',semanticRole:'title',content:{text:'Workers (Row 9)'}},
 {id:'table',type:'table',sourceArtifact:{...ref},content:{rows:structuredClone([rows[0],rows[9]])}},
]};
const project={source:{text:'Original workers and their exact source conditions.',semantic:{inventory:{items:[{id:'table',type:'TableBlock',rows}]}}},generationPolicy:{knowledge:'source_only'},outline:[{id:'one',sourceArtifactRanges:[ref]}],deck:{slides:[slide]}};
const original=JSON.stringify(project);
for(const title of ['Workers (Row 9)','Workers (Rows 9–9)','Workers (9–9)','Workers（第 9 行）']){
 const value=structuredClone(project);value.deck.slides[0].title=title;value.deck.slides[0].nodes[0].content.text=title;
 assert.deepEqual(inspectSourceNumbers(value),[],title);
}
for(const fault of ['cells','header','artifact','plan','role','hidden','body']){
 const value=structuredClone(project),page=value.deck.slides[0];
 if(fault==='cells')page.nodes[1].content.rows[1][1]='Changed source condition';
 if(fault==='header')page.nodes[1].content.rows[0][1]='Revenue';
 if(fault==='artifact')page.nodes[1].sourceArtifact={...ref,rowStart:8,rowEnd:9};
 if(fault==='plan')page.sourceArtifactRanges=[{...ref,rowStart:8,rowEnd:9}];
 if(fault==='role')page.nodes[0].semanticRole='body';
 if(fault==='hidden')page.nodes[1].hidden=true;
 if(fault==='body')page.nodes.push({id:'unsupported',type:'text',semanticRole:'body',content:{text:'Workers process 9 jobs.'}});
 assert.ok(inspectSourceNumbers(value).some(issue=>issue.severity==='error'&&issue.values.includes('9')),fault);
}
assert.equal(JSON.stringify(project),original);
console.log('Single-row topic locators require the exact visible original header/cells and planned interval; unsupported body numbers remain blocked: OK');

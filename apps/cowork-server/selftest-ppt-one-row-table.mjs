// A source table of one row (a header and no data rows, as PDF extraction left
// "ViT-H/14 | 87.5 | 58.4 | 47.6" and "A ∩ B") is never drawn as a table: it
// rendered as a lone blue header strip (Fable 2026-10-31, JEPA p9/10/12/16/17,
// CodePilot PDF p17). Its cells go to the page's speaker notes; a page left
// with nothing else shows them as one plain line.
import assert from 'node:assert/strict';
import {oneRowTablesOff} from './lib/ppt-table-appendix.mjs';
import {tableCardPointNotes} from './lib/ppt-card-language.mjs';

const table=(id,rows)=>({id,type:'TableBlock',source_ref:['11'],chunkRefs:['c_1'],sectionPath:['Results'],rows});
const items=[table('one',[['ViT-H/14','87.5','58.4','47.6']]),table('formula',[['A ∩ B']]),table('real',[['Model','Top-1'],['I-JEPA','87.1']])];
const project={source:{semantic:{inventory:{items}}}};
const page=(id,objects,points=[],extra={})=>({id,logicalCardId:id,title:id,cardObjects:objects,sourceUnitIds:[...objects,'b_1'],keyPoints:points.map(text=>({text,sourceUnitIds:['b_1']})),...extra});
const raw={slides:[{id:'cover',title:'Cover'},page('probe',['one'],['ViT-H/14 linear probe reaches 87.5 on CIFAR100.']),page('alone',['formula']),page('both',['real','one'],['Fine-tuning reaches 87.1.']),
 page('ranged',['one'],['A point.'],{sourceArtifactRanges:[{sourceUnitId:'one',rowStart:0,rowEnd:1}]}),{id:'end',title:'Thanks',cardFrame:'closing',cardObjects:['one'],keyPoints:[]}]};
const {raw:out,moved}=oneRowTablesOff(project,raw);
const by=id=>out.slides.find(slide=>slide.id===id);

assert.deepEqual(moved.map(m=>[m.tableId,m.pageId,m.to]),[['one','probe','notes'],['formula','alone','line'],['one','both','notes'],['one','ranged','notes']]);
assert.deepEqual(by('probe').cardObjects,[],'the one-row table is not drawn');
assert.ok(!by('probe').sourceUnitIds.includes('one'),'nor owned by the page');
assert.deepEqual(by('probe').keyPoints.map(p=>p.text),['ViT-H/14 linear probe reaches 87.5 on CIFAR100.'],'the points stay');
assert.deepEqual(by('probe').notePoints.map(p=>[p.text,p.sourceUnitIds]),[['ViT-H/14 · 87.5 · 58.4 · 47.6',['one']]],'its cells are one line in the notes');
assert.deepEqual(by('alone').keyPoints.map(p=>[p.text,p.sourceUnitIds,p.refs]),[['A ∩ B',['formula'],['11']]],'a page left empty shows the row as one plain line');
assert.ok(!by('alone').notePoints,'and not in the notes too');
assert.deepEqual(by('both').cardObjects,['real'],'a table with a data row stays a table');
assert.deepEqual(by('ranged').sourceArtifactRanges,[],'row ranges of the one-row table go too');
assert.deepEqual(by('end').cardObjects,['one'],'frame pages are untouched');
assert.ok(!out.slides.some(s=>s.cardObjects?.includes('real')&&s.id!=='both'));
assert.equal(oneRowTablesOff(project,{slides:[{id:'cover'},page('x',['real'],['p'])]}).moved.length,0,'nothing moves without a one-row table');

// The notes reach the export: the closing-notes reader takes the planned page's notePoints.
const deck={outline:out.slides.map(({notePoints,...slide})=>slide),planningContract:{cardOutline:{raw:out}},deck:{slides:out.slides.map(slide=>({id:slide.id}))}};
const notes=tableCardPointNotes(deck);
assert.deepEqual(notes.map(n=>[n.index,n.text]),[[1,'• ViT-H/14 · 87.5 · 58.4 · 47.6'],[3,'• ViT-H/14 · 87.5 · 58.4 · 47.6'],[4,'• ViT-H/14 · 87.5 · 58.4 · 47.6']]);
console.log('PASS one-row source tables: notes beside points, one plain line on an empty page, real tables and frames untouched');

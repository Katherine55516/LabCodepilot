// Cover titles keep their full text (the user and Fable, 2026-11-01): a title
// split over the source's opening headings is joined; on an uploaded template
// the cover title wraps to the lines its frame holds and steps down to 28 pt,
// then grows into free cover space; only when nothing fits is it shortened.
import assert from 'node:assert/strict';
import {leadingTitleHeading,sourceDocumentTitle} from './lib/ppt-deck-coherence.mjs';
import {coverTitleSizes,coverTitleFitsFrame,coverTitleGrowth,nativeTitleFitsFrame} from './lib/ppt-template-fidelity.mjs';
import {shortenedCoverTitle,coverSourceNotes} from './lib/ppt-card-language.mjs';
const IN=914400,size={width:12192000,height:6858000};
// The docx: "# CodePilot PPT 模块" then "# 架构 工作流与实现逻辑", nothing between.
assert.equal(leadingTitleHeading('# CodePilot PPT 模块\n\n# 架构 工作流与实现逻辑\n\n中文版技术手册'),'CodePilot PPT 模块：架构 工作流与实现逻辑');
assert.deepEqual(sourceDocumentTitle({source:{text:'# CodePilot PPT 模块\n\n# 架构 工作流与实现逻辑\n\n正文'}}).variants[0].subtitle,'架构 工作流与实现逻辑');
assert.equal(leadingTitleHeading('# World Models\n\nIntro'),'World Models','one heading stays as it is');
assert.equal(leadingTitleHeading('# Title\n## Section\ntext'),'Title','a subheading is not part of the title');
assert.equal(leadingTitleHeading('# Intro\n# Method\n# Results\ntext'),'Intro','three headings are sections, not a split title');
// Sizes: the slot's own, then 36/32/28 pt, with no 70% floor.
assert.deepEqual(coverTitleSizes({style:{fontSizePt:74}}),[74,36,32,28]);
assert.deepEqual(coverTitleSizes({style:{fontSizePt:30}}),[30,28]);
// A Deal-Review-like frame: 5.22 × 0.86 in at 51 pt, one declared line.
const node=(height,extra=[])=>({nodes:[{id:'t',type:'text',nativeRef:{slideIndex:0,shapeId:3},geometry:{x:Math.round(.6*IN),y:Math.round(2*IN),width:Math.round(5.22*IN),height:Math.round(height*IN)},style:{fontSizePt:51,fontFamily:'Arial'},nativeTextFrame:{margins:[91440,45720,91440,45720]},content:{text:'Title'}},...extra],slots:[{role:'title',shapeId:3,maxLines:1}]});
const spec=node(.86),slot=spec.slots[0];
const title='客户支持知识库试点方案';
assert.equal(nativeTitleFitsFrame(spec,slot,title),false,'at 51 pt on one line it does not fit');
assert.equal(coverTitleFitsFrame(spec,slot,title,size),true,'it fits on the ladder or by growing: never shortened');
// The JEPA title needs a taller frame: it grows into free space below the frame.
const jepa='Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture';
const grown=coverTitleGrowth(spec,slot,jepa,size);
assert.ok(grown&&grown.fontSizePt===28&&grown.geometry.height>spec.nodes[0].geometry.height,'the frame grows at 28 pt');
assert.ok(grown.geometry.y+grown.geometry.height<=size.height-.25*IN,'inside the bottom margin');
// A template shape right under the frame leaves no room: the last resort (a headline) applies.
const blocked=node(.86,[{id:'s',type:'shape',geometry:{x:Math.round(.6*IN),y:Math.round(2.9*IN),width:Math.round(4*IN),height:Math.round(.3*IN)}}]);
assert.equal(coverTitleGrowth(blocked,blocked.slots[0],jepa,size),null,'no new overlap is allowed');
assert.equal(coverTitleFitsFrame(blocked,blocked.slots[0],jepa,size),false);
// Only a cut headline is flagged and noted; a generic sheet name renamed by the model is not (Fable).
assert.equal(shortenedCoverTitle({outline:[{title:'销售数据概览',coverSourceTitle:'Sheet1'}],deck:{slides:[{}]}}),'');
const cut={outline:[{title:'Self-Supervised Learning',coverSourceTitle:jepa,coverShortened:true}],deck:{slides:[{}]}};
assert.equal(shortenedCoverTitle(cut),jepa);
assert.deepEqual(coverSourceNotes(cut).map(note=>note.text),['Full title: '+jepa]);
console.log('PASS cover titles: split titles joined; wrap, 28 pt and frame growth before any shortening');

// Figure pages are titled by what their figures show (Fable 2026-11-02, N6;
// before, World Models p6 and p8 were both "VizDoom Experiment · Figures"):
// the first caption's opening clause when it names something, a short one
// before the card's title; no "· Figures" marker, the eyebrow says "Figure";
// a title still taken is numbered "· 2".
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.COWORK_STATE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-figure-titles-'));
const {assignSourceImages}=await import('./lib/ppt-card-outline.mjs');
const image=(id,ref,caption)=>({id,width:1600,height:1200,caption,sourceRefs:[ref],required:true});
const card=(id,title,ref)=>({id,logicalCardId:'l-'+id,title,section:'VizDoom Experiment',keyPoints:[{text:`Figure ${ref} shows the agent.`,sourceUnitIds:['u'+ref],refs:[ref]}]});
const p=captions=>({source:{images:[image('img1','1',captions[0]),image('img2','2',captions[1])],semantic:{inventory:{items:[{id:'u1',text:'Figure 1 shows the agent.',source_ref:['1']},{id:'u2',text:'Figure 2 shows the agent.',source_ref:['2']}]}},segments:[]},
 templateFidelity:{mode:'preserve',slides:[]},generationPolicy:{language:{mode:'source'}},inputUnderstanding:{primaryLanguage:'en'},planningContract:{pagePreference:{preset:'full'},logicalCards:[{id:'l-c1',title:'VizDoom Experiment'},{id:'l-c2',title:'VizDoom Experiment'}]}});
const deck=titles=>({slides:[{id:'cover',title:'World Models',keyPoints:[]},card('c1',titles[0],'1'),card('c2',titles[1],'2'),{id:'end',title:'Thanks',role:'closing',keyPoints:[]}]});
const figures=(captions,titles)=>assignSourceImages(p(captions),deck(titles)).slides.filter(slide=>slide.figurePage).map(slide=>slide.title);
assert.deepEqual(figures(['Figure 1: The agent learns to dodge fireballs inside its dream. Frames from','Figure 2. Dream policies survive 1,100 steps in the real game.'],['Agents Learn Inside the Dream','Dream Policies Transfer to VizDoom']),
 ['The Agent Learns to Dodge Fireballs Inside Its Dream','Dream Policies Survive 1,100 Steps in the Real Game'],'each figure page states what its figure shows');
assert.deepEqual(figures(['Figure 1. VizDoom results.','Figure 2. VizDoom results.'],['Agents Learn Inside the Dream','Dream Policies Transfer to VizDoom']),
 ['VizDoom Results','VizDoom Results · 2'],'a short caption names the page; a repeat is numbered');
assert.deepEqual(figures(['Figure 1. A figure.','Figure 2. A figure.'],['VizDoom Experiment','VizDoom Experiment']),
 ['VizDoom Experiment · 2','VizDoom Experiment · 3'],'a caption that names nothing leaves the card title, numbered');
{const out=assignSourceImages(p(['Figure 1. A figure.','Figure 2. A figure.']),deck(['VizDoom Experiment','VizDoom Experiment']));
 assert.deepEqual(out.slides.filter(slide=>slide.figurePage).map(slide=>slide.titleRepeat),[2,3],'each repeat number is recorded for the number gate');}
console.log('PASS figure pages: titled from their captions, no "· Figures" marker, a repeat numbered "· 2"');

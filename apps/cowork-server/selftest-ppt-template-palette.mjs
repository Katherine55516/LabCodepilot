// An uploaded template's colours come from what its slides use (Fable M1,
// 2026-11-02; the hand-made world_models × Mood-Board deck as the standard).
// An unused theme accent (Gamma leaves Office's #4472c4) is never taken; a
// dark fill becomes the card panel only when it is part of the design (≥1% of
// all slide area); the panel's text reads at 4.5:1; components without a panel
// take the accent with readable text (the user's review, 2026-11-02).
import assert from 'node:assert/strict';
import {usedTemplatePalette,applyUsedTemplatePalette,componentSurface} from './lib/ppt-template-palette.mjs';
import {contrastRatio} from './lib/ppt-template-colors.mjs';

const IN=914400,shape=(fill,w,h)=>({type:'shape',geometry:{x:0,y:0,width:w*IN,height:h*IN},style:{fill}}),text=(color,value)=>({type:'text',geometry:{x:0,y:0,width:IN,height:IN},style:{color},content:{text:value}});
// Mood-Board: olive panels and olive text; the theme's Office blue appears nowhere.
const mood=[{nodes:[shape('#2e2f23',5,7.5),text('#2e2f23','Body text in the template colour'),text('#ecf0db','Light text')]},{nodes:[shape('#2e2f23',13.3,2)]}];
const palette=usedTemplatePalette(mood,{background:'#ecf0db',accent:'#4472c4',foreground:'#242a3b'});
assert.equal(palette.accent,'#2e2f23','the unused Office accent is replaced by the template\'s own dark fill');
assert.equal(palette.panel,'#2e2f23');assert.equal(palette.foreground,'#2e2f23','the dominant text colour');
assert.ok(contrastRatio(palette.onPanel,palette.panel)>=4.5,'panel text reads at 4.5:1: '+palette.onPanel);
// A used accent stays (Deal-Review's wine on its lines and headings).
assert.equal(usedTemplatePalette([{nodes:[{...shape('#ffffff',1,1),style:{fill:'#ffffff',stroke:'#722f37'}},text('#722f37','Heading')]}],{accent:'#722f37'}).accent,'#722f37');
// A light template's tiny near-black detail is no panel: light cards in its own accent.
const light=usedTemplatePalette([{nodes:[shape('#0e0e10',.3,.3),text('#0e0e10','Body text on a cream page')]}],{background:'#fff8ee',accent:'#722f37'});
assert.equal(light.panel,undefined,'a 0.1% dark detail is not the card colour');
// Components take the panel, else the accent with readable text.
assert.deepEqual(componentSurface(palette),{fill:'#2e2f23',text:palette.onPanel});
assert.equal(componentSurface({accent:'#ffd400'}).text,'#111111','dark text on a light accent');
// Uploaded templates only; a built-in palette is left as defined (Fable (b)).
const builtin={templateSpec:{kind:'builtin',palette:{accent:'#55ade2'}}};applyUsedTemplatePalette(builtin,mood);
assert.equal(builtin.templateSpec.palette.accent,'#55ade2');
const uploaded={templateSpec:{kind:'uploaded',palette:{accent:'#4472c4'}}};applyUsedTemplatePalette(uploaded,mood);
assert.equal(uploaded.templateSpec.palette.accent,'#2e2f23');
// A chart takes the template's accent where it reads, never the theme's Office blue.
{const {chartSeriesColors}=await import('./lib/ppt-template-palette.mjs');
 assert.equal(chartSeriesColors({accent:'#2e2f23',foreground:'#2e2f23',background:'#ecf0db'})[0],'#2e2f23');
 assert.equal(chartSeriesColors({accent:'#1a3353',foreground:'#e5e0df',background:'#000000'})[0],'#e5e0df','a dark accent on a black page gives way to the text colour');}
console.log('PASS template palette: used colours, no unused theme accent, panel only when designed, readable component surfaces, uploaded templates only');

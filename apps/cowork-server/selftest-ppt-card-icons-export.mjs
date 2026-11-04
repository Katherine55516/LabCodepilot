// Card icons end to end (Fable S2 review, 2026-11-01): a grid page bound with
// cardIcons carries one icon picture per card above its box, source-owned, so
// the preserved-template exporter writes them as PNG pictures, and the media
// ledger raises nothing for them.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {spawnPythonSync} from './test/ppt-local-runtime.mjs';
import {bindThemeCardPage,cardShape} from './lib/ppt-card-pages.mjs';
import {planCardIcons} from './lib/ppt-card-icons.mjs';
import {isSourceOwnedNode} from './lib/ppt-source-artifacts.mjs';
import {contrastRatio} from './lib/ppt-text-contrast.mjs';
import {buildMediaLedger,inspectMediaLedger} from './lib/ppt-media-ledger.mjs';
import {_internals as nativeExporter} from './lib/ppt/import-pptx.mjs';

const IN=914400,python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3',root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-card-icons-'));
const frame={slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:60},{role:'content',shapeId:10}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},geometry:{x:.6*IN,y:.3*IN,width:11.9*IN,height:.8*IN},style:{fontSizePt:28}},{id:'c',type:'text',nativeRef:{shapeId:10,contractVersion:2},geometry:{x:.6*IN,y:1.4*IN,width:11.9*IN,height:5.4*IN},style:{fontSizePt:14}}]};
const labels=['数据存储','安全隔离','团队协作'];
const raw={id:'p',logicalCardId:'card',title:'平台的三项能力',section:'能力',cardObjects:[],visualIntent:{type:'relation'},keyPoints:labels.map((label,k)=>({label,text:label+'：负责平台中的一项能力，说明它如何服务用户。',sourceUnitIds:['b'+k]})),sourceUnitIds:['b0']};
const [,page]=planCardIcons([{id:'cover'},raw],cardShape);
assert.equal(cardShape(page),'grid');assert.deepEqual(page.cardIcons,['Database','ShieldCheck','UsersThree']);
const project={planningContract:{version:3},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[frame,frame]},templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111',background:'#ffffff',accent:'#6758c8'}},
 source:{text:'',segments:[],semantic:{inventory:{items:[],relationships:[]}}},inputUnderstanding:{primaryLanguage:'zh'},generationPolicy:{language:{mode:'output',locale:'zh-CN'}},outline:[{id:'cover',title:'封面'},page],pages:2};
const slide={id:'p',title:page.title,nodes:[],cardPage:{mode:'theme'},nativeSlideIndex:0};
bindThemeCardPage(project,slide,1,page);
const icons=slide.nodes.filter(node=>node.content?.derivedFrom==='card-icon');
assert.equal(icons.length,3,'one icon per card: '+slide.nodes.map(n=>n.type+':'+(n.content?.derivedFrom||'')).join(','));
const list=slide.nodes.find(node=>node.type==='list'&&node.content?.badgeInsetPt);
assert.ok(list,'the grid reserves the icon band');
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
assert.ok(icons.every((a,i)=>icons.every((b,j)=>i===j||!overlap(a.geometry,b.geometry))),'icons do not overlap each other');
const cards=list.content.pointLayout.boxes.map(box=>({x:list.geometry.x+box.x*list.geometry.width,y:list.geometry.y+box.y*list.geometry.height}));
icons.forEach((icon,k)=>assert.ok(Math.abs(icon.geometry.x-cards[k].x)<=1&&icon.geometry.y<cards[k].y,'icon '+k+' sits above its card'));
assert.ok(icons.every(isSourceOwnedNode),'icons are source-owned, so the template exporter writes them');
project.deck={slides:[{id:'cover',nodes:[]},slide]};
const ledger=buildMediaLedger(project,project.deck.slides,null);
assert.deepEqual(inspectMediaLedger(ledger,{cards:true}).filter(issue=>/icon|media_role/.test(issue.code+issue.message)),[],'icons raise no media issue');
// Export through the preserved-template exporter and read the pictures back.
const original=path.join(root,'original.pptx'),out=path.join(root,'out.pptx');
const blank=spawnSync(python,['-c','from pptx import Presentation\nfrom pptx.util import Emu\nimport sys\np=Presentation();p.slide_width=Emu(12192000);p.slide_height=Emu(6858000);p.slides.add_slide(p.slide_layouts[6]);p.save(sys.argv[1])',original],{encoding:'utf8'});
assert.equal(blank.status,0,blank.stderr);
const run=spawnPythonSync(python,nativeExporter.EXPORT_SCRIPT,[],{input:JSON.stringify({original,slides:[{nativeSlideIndex:0,nodes:[],sourceArtifacts:slide.nodes.filter(isSourceOwnedNode)}],fonts:{title:'Arial',body:'Arial',titleEastAsia:'PingFang SC',bodyEastAsia:'PingFang SC'}}),env:{...process.env,PPT_SOURCE:original,PPT_OUTPUT:out},maxBuffer:2e7});
assert.equal(run.status,0,run.stderr.toString());
const read=spawnSync(python,['-c',String.raw`
import sys,json
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
pics=[[s.image.content_type,s.width,s.height] for s in Presentation(sys.argv[1]).slides[0].shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]
print(json.dumps(pics))`,out],{encoding:'utf8'});
assert.equal(read.status,0,read.stderr);
const pictures=JSON.parse(read.stdout);
assert.equal(pictures.length,3,'three icon pictures exported: '+read.stdout);
assert.ok(pictures.every(([type,w,h])=>type==='image/png'&&w===h&&w>0),'square PNG pictures: '+read.stdout);
// A dark accent on a dark slide is never the heading colour (CodePilot PDF on
// Professional-Portfolio, 2026-11-02: navy #1a3353 terms on a navy slide).
{const dark=structuredClone(project);dark.templateFidelity.slides=dark.templateFidelity.slides.map(slide=>({...slide,background:'#1f2d4a'}));dark.templateSpec.palette={foreground:'#f5f6fc',background:'#1f2d4a',accent:'#1a3353'};
 const darkSlide={id:'p',title:page.title,nodes:[],cardPage:{mode:'theme'},nativeSlideIndex:0};bindThemeCardPage(dark,darkSlide,1,structuredClone(page));
 const grid=darkSlide.nodes.find(node=>node.type==='list'&&node.content?.pointLayout?.accent);
 assert.ok(grid&&contrastRatio(grid.content.pointLayout.accent,grid.content.pointLayout.panelFill||'#1f2d4a')>=3,'headings read on the dark slide: '+grid?.content?.pointLayout?.accent);}
// An uploaded template's dark panel (Fable M1/M2, 2026-11-02): each card is a
// solid panel, no tint transparency left over (live Mood-Board score tiles
// read light on light), with a marker circle before each heading.
{const darkPanel=structuredClone(project);darkPanel.templateSpec.palette={foreground:'#2e2f23',background:'#ecf0db',accent:'#2e2f23',panel:'#2e2f23',onPanel:'#ecf0db'};
 const plainPage=structuredClone(page);delete plainPage.cardIcons;
 const panelSlide={id:'p',title:page.title,nodes:[],cardPage:{mode:'theme'},nativeSlideIndex:0};bindThemeCardPage(darkPanel,panelSlide,1,plainPage);
 const grid=panelSlide.nodes.find(node=>node.type==='list'&&node.content?.pointLayout);
 assert.equal(grid.content.pointLayout.panelFill,'#2e2f23');assert.equal(grid.content.pointLayout.panelText,'#ecf0db');assert.deepEqual(grid.content.pointLayout.markers,['1','2','3']);
 const panelOut=path.join(root,'panel.pptx');
 const exported=spawnPythonSync(python,nativeExporter.EXPORT_SCRIPT,[],{input:JSON.stringify({original,slides:[{nativeSlideIndex:0,nodes:[],sourceArtifacts:panelSlide.nodes.filter(isSourceOwnedNode)}],fonts:{title:'Arial',body:'Arial',titleEastAsia:'PingFang SC',bodyEastAsia:'PingFang SC'}}),env:{...process.env,PPT_SOURCE:original,PPT_OUTPUT:panelOut},maxBuffer:2e7});
 assert.equal(exported.status,0,exported.stderr.toString());
 const fills=spawnSync(python,['-c',String.raw`
import sys,json
from pptx import Presentation
from pptx.oxml.ns import qn
out=[]
for s in Presentation(sys.argv[1]).slides[0].shapes:
    if 'AIMate instance:' in s.name or 'AIMate decor:marker' in s.name:
        clr=s._element.spPr.find(qn('a:solidFill'))
        clr=clr.find(qn('a:srgbClr')) if clr is not None else None
        out.append([s.name.split(':')[1] if 'decor' in s.name else 'card',clr.get('val') if clr is not None else None,len(clr.findall(qn('a:alpha'))) if clr is not None else None])
print(json.dumps(out))`,panelOut],{encoding:'utf8'});
 assert.equal(fills.status,0,fills.stderr);
 const shapes=JSON.parse(fills.stdout),cardsOut=shapes.filter(([kind])=>kind==='card'),markers=shapes.filter(([kind])=>kind==='marker');
 assert.ok(cardsOut.length===3&&cardsOut.every(([,val,alpha])=>val==='2E2F23'&&alpha===0),'three solid dark cards: '+fills.stdout);
 assert.ok(markers.length===3&&markers.every(([,val])=>val==='ECF0DB'),'three light marker circles: '+fills.stdout);}
// Math in step and grid items (Fable 2026-11-02, P2): the native export writes
// it as Office math, never "$...$" text, and the SVG preview draws no dollar
// signs either (the editor canvas draws the same headingRich/bodyRich fields).
{const mathProject=structuredClone(project);mathProject.templateSpec.palette={foreground:'#2e2f23',background:'#ecf0db',accent:'#2e2f23',panel:'#2e2f23',onPanel:'#ecf0db'};
 for(const [shape,mathPage] of [['steps',{...structuredClone(page),cardIcons:undefined,visualIntent:{type:'process'},numberedPoints:true,keyPoints:[{text:'Train V to encode frames into $z$.'},{text:'Train M to model $P(z_{t+1} \\mid a_t, z_t, h_t)$.'},{text:'Evolve C with CMA-ES.'}]}],
                           ['grid',{...structuredClone(page),cardIcons:undefined,keyPoints:[{label:'Vision',text:'Vision: encodes frames into $z$.'},{label:'Memory',text:'Memory: predicts the next $z$.'},{label:'Controller',text:'Controller: maps $z$ and $h$ to actions.'}]}]]){
  assert.equal(cardShape(mathPage),shape,'the '+shape+' keep their component with math');
  const mathSlide={id:'p',title:mathPage.title,nodes:[],cardPage:{mode:'theme'},nativeSlideIndex:0};mathProject.outline=[{id:'cover',title:'Cover'},mathPage];bindThemeCardPage(mathProject,mathSlide,1,mathPage);
  const list=mathSlide.nodes.find(node=>node.type==='list'&&node.content?.pointLayout);
  assert.ok(list.content.items.some(item=>item.bodyRich?.runs?.some(run=>run.kind==='math')),shape+': items carry their math');
  const mathOut=path.join(root,shape+'-math.pptx');
  const exported=spawnPythonSync(python,nativeExporter.EXPORT_SCRIPT,[],{input:JSON.stringify({original,slides:[{nativeSlideIndex:0,nodes:[],sourceArtifacts:mathSlide.nodes.filter(isSourceOwnedNode)}],fonts:{title:'Arial',body:'Arial',titleEastAsia:'PingFang SC',bodyEastAsia:'PingFang SC'}}),env:{...process.env,PPT_SOURCE:original,PPT_OUTPUT:mathOut},maxBuffer:2e7});
  assert.equal(exported.status,0,exported.stderr.toString());
  const read=spawnSync(python,['-c',String.raw`
import sys,json
from pptx import Presentation
out={'math':0,'dollars':0}
for s in Presentation(sys.argv[1]).slides[0].shapes:
    if 'AIMate instance:' not in s.name: continue
    xml=s._element.xml;out['math']+=xml.count('oMath>');out['dollars']+=sum(t.count('$') for t in [s.text_frame.text] if s.has_text_frame)
print(json.dumps(out))`,mathOut],{encoding:'utf8'});
  assert.equal(read.status,0,read.stderr);const counts=JSON.parse(read.stdout);
  assert.ok(counts.math>0&&counts.dollars===0,shape+': Office math in the cards, no dollar signs: '+read.stdout);
  const {buildRenderTree}=await import('./lib/ppt/render-tree.mjs'),{slideSvg}=await import('./lib/ppt/exporters/preview.mjs');
  mathProject.deck={slides:[{id:'cover',nodes:[]},mathSlide]};
  const svg=slideSvg(buildRenderTree(mathProject).slides[1],mathProject);
  assert.ok(!/\$[^$]{1,40}\$/u.test(svg),shape+': the preview draws no raw LaTeX');}}
fs.rmSync(root,{recursive:true,force:true});
console.log('PASS card icons export: grid band, icons above cards, source-owned, PNG pictures in the PPTX, no media issue');

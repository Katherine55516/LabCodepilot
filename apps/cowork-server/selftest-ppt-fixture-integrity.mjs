import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {ensureDeckV3} from './lib/ppt/ir.mjs';
import {inspectCardRedundancy}from './lib/ppt-presentation-writing.mjs';
import {fragmentTitle}from './lib/ppt-outline-protocol.mjs';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';
import {exportManifest} from './lib/ppt-export-integrity.mjs';
import {renderIssues} from './lib/ppt/render-audit.mjs';
import {deterministicReview} from './lib/ppt-quality.mjs';
import {slideMedia,buildMediaLedger} from './lib/ppt-media-ledger.mjs';
import {tableDiagramComponent} from './lib/ppt-diagram-cards.mjs';
// Reuse an actual production-created checkpoint, never invent an accepted deck.
const p=process.argv[2]?JSON.parse(readFileSync(process.argv[2])):{id:'fixture',revision:1,template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),outline:['cover','body','workflow','end'].map(id=>({id})),planning:{slidePlan:[]},deck:ensureDeckV3({deckId:'fixture',slides:['cover','body','workflow','end'].map((id,index)=>({id,title:'Release review',layoutId:index===0?'cover':'summary',bullets:index===0?['Review conditions before release.']:['Records are reviewed before release.']}))})};
const scene=buildRenderTree(p);assert.deepEqual(scene.slides.map(s=>s.id),p.deck.slides.map(s=>s.id));assert.deepEqual(p.outline.map(s=>s.id),p.deck.slides.map(s=>s.id));
assert.equal(exportManifest(p,scene).revision,p.revision);
for(const mutate of [s=>s.slides.pop(),s=>s.slides[1].id='wrong-id',s=>s.slides[1].elements.find(e=>e.nodeId&&e.content?.text).content.text='Topic old fixture']){
 const stale=structuredClone(scene);mutate(stale);assert.throws(()=>exportManifest(p,stale),/render_tree_stale/);
}
const bad=structuredClone(p),page=bad.deck.slides[2];page.nodes=page.nodes.filter(n=>n.semanticRole==='title');page.bullets=['Cached workflow that is no longer visible'];page.blocks=[{type:'image'}];
assert.ok(deterministicReview(bad).issues.some(i=>i.code==='content_empty'&&i.slideId===page.id),'legacy copy cannot hide an empty canonical topic');
const over=structuredClone(scene),body=over.slides[0].elements.find(e=>e.semanticRole==='body');
if(body){body.content={text:'Complete but too long. '.repeat(300)};const issue=renderIssues(over).find(i=>i.code==='typography_capacity'&&i.nodeIds.includes(body.nodeId));assert.equal(issue.details.nodeRole,'body');assert.equal(issue.details.measurement,'render_text_contract');assert.ok(!renderIssues(over).some(i=>i.code==='rendered_title_capacity'));}
const item={id:'comparison',rows:[['Mode','Action'],['Generate','Make cards'],['Paste','Structure text'],['Import','Parse document']]};
const card={id:'cards',...tableDiagramComponent(item,'card-grid'),sourceArtifact:{sourceUnitId:item.id},geometry:{x:914400,y:1800000,width:10000000,height:4000000},style:{fontSizePt:18}};
const mediaProject={source:{semantic:{inventory:{items:[item]}}}},slide={id:'media',nodes:[card]};
assert.equal(slideMedia(mediaProject,slide)[0].meaningful,true);assert.equal(slideMedia(mediaProject,slide)[0].bucket,'source_derived');
const broken=structuredClone(slide);broken.nodes[0].content.items.pop();assert.equal(slideMedia(mediaProject,broken)[0].meaningful,false);
const decorated={id:'decoration',nodes:[{id:'background',type:'image',content:{mediaRole:'template_decoration'}}]};assert.equal(slideMedia({},decorated)[0].meaningful,false);
assert.equal(buildMediaLedger({},[{id:'cover'},decorated,decorated,decorated],{}).longestTextOnlyRun,3);
console.log('PASS canonical scene IDs/content, actual body capacity, empty workflow/cache negative, source-derived cards and decoration classification');

const sourceSlide={title:'Native document and export',nodes:[{id:'literal',type:'text',sourceArtifact:{sourceUnitId:'original'},content:{text:'Native'}}],copy:{blocks:[{sourceNodeId:'literal',body:'Native'}]}};
assert.deepEqual(inspectCardRedundancy(sourceSlide),[]);
sourceSlide.copy.blocks.push({body:'Native'});assert.ok(inspectCardRedundancy(sourceSlide).length,'new generated filler is still checked');
sourceSlide.nodes[0].hidden=true;assert.ok(inspectCardRedundancy(sourceSlide).length,'hidden source cannot grant the literal exemption');
const fragment={title:'Input and planning',sourceUnitIds:['t'],sourceArtifactRanges:[{sourceUnitId:'t',rowStart:1,rowEnd:3}]},src={semantic:{inventory:{items:[{id:'t',type:'TableBlock',sectionPath:['中文长标题'],rows:[['Layer','Job'],['Input','Read'],['Planner','Assign'],['Render','Draw']]}]}}};
const title=fragmentTitle(fragment,src,{preservePlannedTopic:true});assert.equal(title.title,'Input and planning');assert.deepEqual(title.sourceArtifactRanges,fragment.sourceArtifactRanges);assert.equal(fragmentTitle(title,src,{preservePlannedTopic:true}).title,title.title,'idempotent editorial topic without internal row locator');
console.log('PASS literal source labels do not trigger rewrites, generated filler remains checked, planned fragment topics retain language and scope');

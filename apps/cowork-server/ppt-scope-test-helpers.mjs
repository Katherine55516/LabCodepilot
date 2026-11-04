import {claimAuditRegistry} from './lib/ppt-claim-semantics.mjs';
import { obligationRegistry } from './lib/ppt-obligations.mjs';
import { visibleSlideText } from './lib/ppt-evidence.mjs';
import { nodeContentText, visibleNodes } from './lib/ppt-visible-content.mjs';
import { exportManifest,relationSegmentCount } from './lib/ppt-export-integrity.mjs';
// Simulated critic protocol only. This helper does not verify semantic truth.
import { inputFramework } from './lib/ppt-input-scope.mjs';
export function scopeReview(project, findings = {}) {
  const registry=obligationRegistry(project),slide=project.deck.slides[0];
  const node=visibleNodes(slide).find(n=>nodeContentText(n)),excerpt=node?nodeContentText(node):visibleSlideText(slide);
  const obligationAudit={registryHash:registry.registryHash,status:'complete',checks:registry.entries.map(e=>({obligationId:e.id,status:'satisfied',evidence:[{slideId:slide.id,nodeId:node?.id||`slide:${slide.id}`,excerpt}]}))};
  const claimRegistry=claimAuditRegistry(project),items=project.source?.semantic?.inventory?.items||[];
  const claimAudit={version:2,registryHash:claimRegistry.registryHash,status:'complete',checks:claimRegistry.entries.map(e=>{const item=items.find(i=>e.ownedSourceUnitIds.includes(i.id))||items[0];return {claimId:e.id,textHash:e.textHash,status:'entailed',reason:'Explicit test protocol double, not a truth assessment',sourceEvidence:[{sourceUnitId:item?.id||'user_prompt',excerpt:item?.text||project.userRequirements||project.prompt}]};})};
  return { claimAudit, obligationAudit, missing: [], repeated: [], conflicts: [], unsupported: [], ...findings,
    scopeAudit: { frameworkHash: inputFramework(project).frameworkHash,
      checkedSlideIds: project.deck.slides.map(slide => slide.id), status: 'complete' } };
}

// Explicit export protocol double; it never claims actual-file verification.
export function simulatedExport(project,bytes=123){const m=exportManifest(project);return {bytes,exportVerification:{status:'passed',basis:'test_double',version:m.version,renderContractVersion:m.renderContractVersion,manifestHash:m.manifestHash,renderHash:m.renderHash,revision:m.revision,sha256:'simulated-test-only',relationRouteVersion:1,relationSegmentsChecked:relationSegmentCount(m)}};}

/** Model double for the card outline (2026-10-23): answers the deck call
 * (outline:cards:*:deck:*), a per-topic correction (outline:cards:*:topic:*)
 * and the finishing call (outline:finish:*) from the prompt's own JSON, one
 * card per requested card with one point per source unit (its first sentence).
 * Returns undefined for any other step, so a test can chain its own double. */
export function cardDeckReply(_project,prompt,options={}){
 const key=String(options.nodeKey||''),line=start=>JSON.parse(String(prompt).split('\n').find(text=>text.startsWith(start)));
 const sentence=text=>String(text||'').replace(/\s+/gu,' ').split(/(?<=[.。:：])\s*/u)[0].slice(0,88)||'Source point';
 // Tables, code, formulas and diagrams go on the card as objects; prose becomes points.
 const object=unit=>Boolean(unit.rows||unit.diagramSource||['TableBlock','CodeBlock','EquationBlock'].includes(unit.type));
 const cards=(units,n,title)=>Array.from({length:Math.max(1,n)},(_,i)=>{const own=units.slice(Math.floor(i*units.length/n),Math.floor((i+1)*units.length/n)),mine=own.length?own:units.slice(0,1);
  const prose=mine.filter(unit=>!object(unit));
  // Titles carry no numbers the source does not state (the number gate would block them),
  // and state a point rather than repeat the section heading (a label goes back once).
  return{title:(i?`${title||'Card'} in detail`:title?`${title} explained`:'Card').replace(/\d+\.?\s*/gu,'').trim().slice(0,38)||'Card',numbered:false,visualIntent:mine.some(unit=>unit.rows)?'table':'text',points:prose.slice(0,5).map(unit=>({text:sentence(unit.text),sourceUnitIds:[unit.id]})),objects:mine.filter(object).map(unit=>unit.id)};});
 // Brief mode: exactly the requested number of cards, with no figures.
 if(/^outline:cards:[^:]+:brief/u.test(key)){const n=options.jsonSchema?.properties?.cards?.minItems||3,zh=/Write in (?:Simplified|Traditional) Chinese/u.test(prompt);
  const titles=zh?['概览','整体架构','核心组件','数据流转','部署方式','运维要点','安全设计','成本考量','主要风险','实施路线','团队分工','衡量指标','经验教训','下一步','总结','附录']:['Overview','Architecture','Components','Data flow','Deployment','Operations','Security','Costs','Risks','Roadmap','Team','Metrics','Lessons','Next steps','Summary','Appendix'];
  const points=zh?[{text:'描述中要求说明的要点。'},{text:'用平实语言写的第二个观点。'}]:[{text:'A point the brief asks for.'},{text:'A second idea in plain words.'}];
  return{cards:Array.from({length:n},(_,i)=>({title:titles[i%titles.length],numbered:false,visualIntent:'text',points:structuredClone(points)}))};}
 // Titles follow the deck language the prompt asks for (an English deck gets no Chinese heading).
 const english=/Write titles and points in English only/u.test(String(prompt)),titled=(title,k)=>english&&/\p{Script=Han}/u.test(title)?`Topic ${String.fromCharCode(65+k%26)}`:title;
 if(/^outline:cards:[^:]+:deck:\d+$/u.test(key)){const {topics}=line('{"topics":');return{topics:topics.map((topic,k)=>({topicId:topic.topicId,cards:cards(topic.sourceUnits,topic.cards,titled(topic.title,k))}))};}
 if(/^outline:cards:[^:]+:topic:\d+/u.test(key)){const {topic,cards:n,sourceUnits}=line('{"topic":');return{pages:cards(sourceUnits,n,titled(topic.title,Number(key.split(':').at(-1))||0))};}
 // The final titling pass keeps every title.
 if(/^outline:retitle:/u.test(key))return{titles:[]};
 if(/^outline:finish:/u.test(key)){const task=line('{"chapters":');return{chapters:task.chapters.map(chapter=>({title:chapter.headings[0]})),takeaway:/at most 40 characters, zh/u.test(String(prompt))?{title:'机制要连同限制理解',text:'每个机制都要连同限制它的条件一起理解。',sourceUnitIds:task.citedSourceUnitIds.slice(-1)}:{title:'Mechanisms need their limits',text:'Read each mechanism together with the conditions that limit it.',sourceUnitIds:task.citedSourceUnitIds.slice(-1)},labels:[]};}
 return undefined;
}

/** Writer double for a card deck: a card page is written as its own points
 * (and its planned source objects), as the writer contract asks. Returns
 * undefined for a step that is not a card page's writer call. */
export function cardWriterReply(project,_prompt,options={}){
 const key=String(options.nodeKey||''),slide=(project.outline||[]).find(item=>key==='content:'+item.id||key.startsWith('content:'+item.id+':'));
 if(!slide||!/^content:/u.test(key))return undefined;
 const plan=project.planning?.slidePlan?.find(item=>item.slideId===slide.id);
 return{title:slide.title,contentBlocks:(slide.keyPoints||[]).map(point=>({type:'mechanism',heading:point.label||'',body:point.text,sourceRefs:point.refs||[]})),sourceArtifacts:plan?.sourceArtifacts||[],sourceCommentary:[],sourceEvidenceIds:[]};
}
/** The card outline and writer doubles in one model call; anything else goes to `rest`. */
export const cardModel=rest=>async(project,prompt,activity,log,options={})=>cardDeckReply(project,prompt,options)??cardWriterReply(project,prompt,options)??rest(project,prompt,activity,log,options);

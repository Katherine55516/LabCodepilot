import {cardStructureCommands} from './card-structure.mjs';
import {nativeContentLayout,cardPageRelayout}from'./native-content-layout.mjs';
import {LAYOUT_IDS} from '../ppt-layout.mjs';
import { newId, ensureSlideV3, ensureDeckV3 } from './ir.mjs';
import { normalizeCommand, validateNodeContent } from './command-schema.mjs';
import { _internals as commands } from './command-service.mjs';
import { editableCapabilities, editError, codeLaidPage, nativeCardPage } from './edit-context.mjs';
import { evidenceVisible, visibleSlideText } from '../ppt-evidence.mjs';
import { refreshPlanning } from '../ppt-planning.mjs';
import { promptPolicy, writingGuide, sourcePacket, narrativeContext, cardEditPolicy } from '../ppt-prompt-contracts.mjs';
import { cardsFlow } from '../ppt-flow.mjs';

const layoutIds = LAYOUT_IDS;
const valuesIn = text => String(text).match(/[-+]?\d+(?:[.,]\d+)*(?:%|％)?/gu) || [];

function editable(project, data) {
  const slide = project.deck.slides.find(item => item.id === data.slideId);
  if (!slide) throw editError('slide not found', 404);
  if (project.runtime?.slides?.[slide.id]?.accepted && ['title', 'content', 'data', 'structure'].includes(data.type)) throw editError('this page is accepted; unlock it before changing its content', 409);
  return { slide, nodes: slide.nodes.filter(node => !node.locked && (!project.externalPptx && project.templateFidelity?.mode !== 'preserve' || (node.nativeRef && ['text', 'shape'].includes(node.type))) && (data.scope !== 'object' || node.id === data.nodeId)) };
}

export async function typedCommands(project, data, deps, activity, log) {
  if(data.type==='structure'&&project.templateFidelity?.mode==='preserve')return cardStructureCommands(project,data);
  const { slide, nodes } = editable(project, data);
  const writingProject = project;
  // A card deck's command sees the card policy, not the editorial one (Fable 2026-10-25).
  const cards = cardsFlow(project), localPolicy = cards ? cardEditPolicy(writingProject) : promptPolicy(writingProject);
  const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
  const call = async (prompt, task) => deps.modelCall(project, `${localPolicy}\n${!cards && ['insert', 'data'].includes(task) ? writingGuide(writingProject, contract) : ''}\n${prompt}`, activity, log, { nodeKey: `ai:${data.proposalId}:${task}` });
  const instruction = data.instruction;
  const result = [];
  const command = (type, payload) => ({ type, payload });
  // An uploaded template's card page is laid out again by code, also after a
  // drag; a page in the template's text slots becomes a theme page (Fable 2026-11-01).
  if(data.type==='layout'&&project.templateFidelity?.mode==='preserve'&&(data.mode!=='native-content'||codeLaidPage(project,data.slideId)||nativeCardPage(project,data.slideId)))return cardPageRelayout(project,data);
  if(data.type==='layout'&&data.mode==='native-content')return nativeContentLayout(project,data);
  if (data.type === 'layout') {
    if (!editableCapabilities(project).relayout) throw editError('native templates do not support relayout', 409);
    const allowed = layoutIds.filter(id => !(['chart', 'table', 'image-text'].includes(id)) || slide.nodes.some(node => node.type === ({ chart: 'chart', table: 'table', 'image-text': 'image' }[id])));
    const answer = await call(`Select one registered layout for this slide. Return only {"layoutId":"registered ID"}. IDs: ${allowed.join(',')}. Original role: ${slide.copy?.role || slide.role}. Content: ${JSON.stringify(slide.nodes.map(node => ({ type: node.type, content: node.content })))}. Instruction: ${instruction}. Never return coordinates or rewritten content.`, 'layout');
    if (answer && Object.keys(answer).some(key => key !== 'layoutId')) throw editError('layout optimization must return only a registered layout ID', 422);
    if (!allowed.includes(answer?.layoutId)) throw editError('unsupported layout', 422);
    result.push(command('slide.setLayout', { slideId: slide.id, layoutId: answer.layoutId }));
    for (const node of nodes) if (node.geometry && node.type !== 'foreign') result.push(command('node.setGeometry', { slideId: slide.id, nodeId: node.id, geometry: null }));
  } else if (data.type === 'style') {
    const answer = await call(`Change styles only. Preserve all content, IDs and geometry. Use only template fonts ${JSON.stringify(project.templateSpec?.fonts)}. Return {"styles":[{"nodeId":"existing ID","style":{"color":"#rrggbb","fontWeight":700}}]}${data.scope === 'deck' ? ' and optional palette {background,foreground,muted,accent}, tokens {titleScale,bodyScale,spacingScale}' : ''}. Objects: ${JSON.stringify(nodes.map(node => ({ nodeId: node.id, type: node.type, style: node.style })))}. Instruction: ${instruction}.`, 'style');
    if (!Array.isArray(answer?.styles)) throw editError('AI returned no style changes', 422);
    const seen = new Set();
    for (const item of answer.styles) {
      if (!nodes.some(node => node.id === item.nodeId && ['text', 'list', 'shape', 'chart', 'table', 'image'].includes(node.type)) || seen.has(item.nodeId)) throw editError('unknown or repeated style target', 422);
      seen.add(item.nodeId); result.push(command('node.setStyle', { slideId: slide.id, nodeId: item.nodeId, style: item.style }));
    }
    if (answer.palette || answer.tokens) {
      if (data.scope !== 'deck' || !editableCapabilities(project).relayout) throw editError('theme changes require a deck scope on a reflowable template', 409);
      if (answer.palette) result.push(command('theme.setPalette', { palette: answer.palette }));
      if (answer.tokens) result.push(command('theme.setTokens', { tokens: answer.tokens }));
    }
  } else if (data.type === 'asset') {
    const node = nodes.find(item => item.id === data.nodeId && item.type === 'image');
    if (!node || project.templateFidelity?.mode === 'preserve') throw editError('select an editable image', 409);
    const content = validateNodeContent('image', data.content);
    result.push(command('node.setContent', { slideId: slide.id, nodeId: node.id, content }));
  } else if (data.type === 'data') {
    const node = nodes.find(item => item.id === data.nodeId && ['chart', 'table'].includes(item.type));
    if (!node || project.templateFidelity?.mode === 'preserve') throw editError('select an editable chart or table', 409);
    const refs = data.sourceRefs || slide.sourceRefs || [];
    const sources = (project.source?.segments || []).filter(source => refs.includes(source.id));
    if (!sources.length || refs.some(ref => !project.source.segments.some(source => source.id === ref))) throw editError('data edits require valid supplied sources', 422);
    const answer = data.content ? { content: data.content } : await call(`Edit this ${node.type} from these sources only: ${JSON.stringify(sources)}. Preserve units and conditions. Original: ${JSON.stringify(node.content)}. Instruction: ${instruction}. Return {"content":{...}}.`, 'data');
    const content = validateNodeContent(node.type, answer.content);
    const sourceText = sources.map(source => source.text).join('\n'); const numericKey = value => String(value).replace(/,/g, '').replace(/[%％]$/u, ''); const supported = new Set(valuesIn(sourceText).map(numericKey));
    const values = node.type === 'chart' ? content.values.map(String) : valuesIn(JSON.stringify(content.rows));
    if (values.some(value => !supported.has(numericKey(value)))) throw editError('new numeric values are not supported by the selected sources', 422);
    if (node.type === 'chart' && content.unit && !sourceText.includes(content.unit)) throw editError('chart unit is not supported by the sources', 422);
    result.push(command('node.setContent', { slideId: slide.id, nodeId: node.id, content }));
  } else if (data.type === 'structure') {
    if (!editableCapabilities(project).insertSlide) throw editError('native templates preserve slide structure', 409);
    const body = slide.nodes.find(node => node.type === 'list' && node.semanticRole === 'body');
    const action = data.action || (/合并|merge/iu.test(instruction) ? 'merge' : /删除|delete/iu.test(instruction) ? 'delete' : /新增|insert|add/iu.test(instruction) ? 'insert' : 'split');
    if (slide.nodes.some(node => node.locked && !['eyebrow', 'subtitle', 'takeaway'].includes(node.semanticRole))) throw editError('unlock protected objects before restructuring the page', 409);
    const pageIndex = project.deck.slides.findIndex(item => item.id === slide.id);
    if (['merge', 'delete'].includes(action) && (pageIndex === 0 || pageIndex === project.deck.slides.length - 1)) throw editError('keep the opening and closing pages in the narrative', 409);
    if (action === 'split') {
      if (!body || body.locked || body.content.items.length < 2) throw editError('split requires at least two editable semantic points', 422);
      const count = Math.max(2, Math.min(5, Number(data.count) || 2));
      if (count > body.content.items.length || project.deck.slides.length + count - 1 > 100) throw editError('split exceeds the available points or page budget', 422);
      const answer = await call(`Partition these semantic points into exactly ${count} coherent slides without rewriting or dropping them. Preserve each item ID exactly once. Return {"groups":[{"title":"short source-supported headline","itemIds":["existing ID"]}]}. Points: ${JSON.stringify(body.content.items)}. Instruction: ${instruction}.`, 'split');
      if (!Array.isArray(answer?.groups) || answer.groups.length !== count) throw editError('invalid split plan', 422);
      const itemIds = answer.groups.flatMap(group => group.itemIds || []); const items = new Map(body.content.items.map(item => [item.id, item]));
      if (itemIds.length !== items.size || new Set(itemIds).size !== items.size || itemIds.some(id => !items.has(id)) || answer.groups.some(group => !group.itemIds?.length || typeof group.title !== 'string' || !group.title.trim() || group.title.length > 160)) throw editError('split must preserve every semantic point exactly once', 422);
      const index = project.deck.slides.findIndex(item => item.id === slide.id);
      for (const [offset, group] of answer.groups.entries()) {
        if (offset === 0) {
          result.push(command('node.setContent', { slideId: slide.id, nodeId: body.id, content: { items: group.itemIds.map(id => items.get(id)) } }));
          const title = slide.nodes.find(node => node.semanticRole === 'title');
          if (title) result.push(command('node.setContent', { slideId: slide.id, nodeId: title.id, content: { text: group.title } }));
        } else {
          const added = ensureSlideV3({ id: newId('slide'), title: group.title, bullets: group.itemIds.map(id => items.get(id).text), sourceRefs: slide.sourceRefs || [], layoutId: 'editorial', role: slide.role || 'evidence', copy: { ...slide.copy, blocks: group.itemIds.map(id => ({ heading: items.get(id).heading || '', body: items.get(id).body || items.get(id).text })) } });
          const list = added.nodes.find(node => node.semanticRole === 'body'); list.content.items = group.itemIds.map(id => structuredClone(items.get(id)));
          result.push(command('slide.insert', { index: index + offset, slide: added }));
        }
      }
    } else if (action === 'merge') {
      const index = project.deck.slides.findIndex(item => item.id === slide.id);
      const next = project.deck.slides.find(item => item.id === data.mergeSlideId) || project.deck.slides[index + 1];
      const nextBody = next?.nodes.find(node => node.type === 'list' && node.semanticRole === 'body');
      if (!body || !nextBody || !next || project.deck.slides.indexOf(next) === project.deck.slides.length - 1 || project.deck.slides.indexOf(next) === 0 || next.id === slide.id || next.nodes.some(node => node.locked) || project.runtime?.slides?.[next.id]?.accepted || next.nodes.some(node => ['chart', 'image', 'table', 'shape', 'foreign'].includes(node.type) || (node.type === 'text' && !['title', 'eyebrow'].includes(node.semanticRole) && node.content?.text))) throw editError('merge requires two unprotected text pages; visual components must be preserved separately', 409);
      result.push(command('node.setContent', { slideId: slide.id, nodeId: body.id, content: { items: [...body.content.items, ...nextBody.content.items] } }));
      result.push(command('slide.delete', { slideId: next.id }));
    } else if (action === 'delete') {
      if (project.deck.slides.length <= 3) throw editError('keep at least three slides', 409);
      result.push(command('slide.delete', { slideId: slide.id }));
    } else if (action === 'insert') {
      const sources = project.source?.segments || [];
      if (!sources.length) throw editError('adding sourced content requires supplied material', 422);
      const answer = await call(`Create one substantive new slide from supplied sources only, avoiding repetition of ${JSON.stringify(narrativeContext(project))}. Sources: ${JSON.stringify(sourcePacket({ segments: sources }, 24000))}. Instruction: ${instruction}. Return {"title":"headline","points":["mechanism, evidence or condition"],"sourceRefs":["valid source ID"]}.`, 'insert');
      if (!Array.isArray(answer.points) || !answer.points.length || !Array.isArray(answer.sourceRefs) || !answer.sourceRefs.length || answer.sourceRefs.some(id => !sources.some(source => source.id === id))) throw editError('the new slide needs content and valid sources', 422);
      const sourceText = sources.filter(source => answer.sourceRefs.includes(source.id)).map(source => source.text).join('\n');
      if (valuesIn(JSON.stringify([answer.title, answer.points])).some(value => !valuesIn(sourceText).includes(value))) throw editError('new slide contains an unsupported number', 422);
      result.push(command('slide.insert', { index: project.deck.slides.findIndex(item => item.id === slide.id) + 1, slide: { id: newId('slide'), title: answer.title, bullets: answer.points, sourceRefs: answer.sourceRefs, layoutId: 'editorial' } }));
    } else throw editError('unknown structure operation', 400);
  }
  if (!result.length) throw editError('AI returned no applicable changes', 422);
  return result;
}

export function materializeTypedCandidate(project, proposal) {
  const layout=proposal.commands?.length===1&&proposal.mode==='native-content'?proposal.commands[0].payload?.smartLayout:null;
  if(layout){
    const next=structuredClone(project),index=next.deck.slides.findIndex(s=>s.id===proposal.slideId);
    if(index<0||layout.slideId!==proposal.slideId||layout.slide?.id!==proposal.slideId)throw editError('smart layout target changed',409);
    next.deck.slides[index]=structuredClone(layout.slide);next.deck=ensureDeckV3(next.deck);return next;
  }
  const fill=proposal.commands?.length===1&&proposal.mode==='fill-component'?proposal.commands[0].payload?.componentFill:null;
  if(fill){
    const next=structuredClone(project),index=next.deck.slides.findIndex(s=>s.id===proposal.slideId);
    if(index<0||fill.slideId!==proposal.slideId||fill.slide?.id!==proposal.slideId)throw editError('component fill target changed',409);
    next.deck.slides[index]=structuredClone(fill.slide);next.deck=ensureDeckV3(next.deck);return next;
  }
  const replacement=proposal.commands?.length===1&&proposal.commands[0].payload?.cardStructure?proposal.commands[0].payload:null;
  if(replacement)return {...structuredClone(project),...structuredClone(replacement.projectState),deck:structuredClone(replacement.deck)};
  const next = structuredClone(project);
  for (const input of proposal.commands) {
    const command = normalizeCommand({ ...input, baseRevision: project.revision }, next);
    const before = next.deck;
    next.deck = commands.applyToDeck(next.deck, command, next).deck;
    if (command.type === 'theme.setPalette') next.templateSpec = { ...next.templateSpec, palette: command.payload.palette };
    if (command.type === 'theme.setTokens') next.deck.themeTokens = command.payload.tokens;
    if (command.type === 'slide.insert' && !command.payload.slide.sourceRefs) command.payload.slide.sourceRefs = [];
    if (command.type === 'slide.delete' && proposal.type === 'structure' && /合并|merge/iu.test(proposal.action || proposal.instruction)) {
      const removed = before.slides.find(slide => slide.id === command.payload.slideId);
      const target = next.deck.slides.find(slide => slide.id === proposal.slideId);
      target.sourceRefs = [...new Set([...(target.sourceRefs || []), ...(removed?.sourceRefs || [])])];
    }
  }
  if (proposal.type === 'structure') {
    const oldOutline = new Map(project.outline.map(item => [item.id, item]));
    next.outline = next.deck.slides.map(slide => ({ ...(oldOutline.get(slide.id) || { role: slide.role, section: project.outline.find(item => item.id === proposal.slideId)?.section }), id: slide.id, title: slide.title, focus: oldOutline.get(slide.id)?.focus || slide.title, refs: slide.sourceRefs || [] }));
    next.pages = next.deck.slides.length;
    next.pageDecision = { ...next.pageDecision, finalPageCount: next.pages, source: 'user' };
    // Redistribute locked evidence across the visible child pages; never drop it.
    const affectedIds = [proposal.slideId, ...next.deck.slides.filter(slide => !project.deck.slides.some(old => old.id === slide.id)).map(slide => slide.id)];
    const deletedIds = project.deck.slides.filter(slide => !next.deck.slides.some(item => item.id === slide.id)).map(slide => slide.id);
    const required = [...new Set((project.planning?.slidePlan || []).filter(contract => [...affectedIds, ...deletedIds].includes(contract.slideId)).flatMap(contract => contract.requiredEvidenceIds || []))];
    const atoms = new Map((project.source?.semantic?.evidenceAtoms || []).map(atom => [atom.id, atom]));
    for (const id of required) {
      const atom = atoms.get(id); if (!atom) continue;
      const target = next.deck.slides.find(slide => (!next.deck.slides.some(item => item.id === proposal.slideId) || affectedIds.includes(slide.id)) && evidenceVisible(atom, visibleSlideText(slide)));
      if (!target) throw editError('structure change would remove required evidence', 422, { evidenceId: id });
    }
    for (const outline of next.outline) if (affectedIds.includes(outline.id)) {
      const visible = next.deck.slides.find(slide => slide.id === outline.id);
      outline.requiredEvidenceIds = required.filter(id => atoms.has(id) && evidenceVisible(atoms.get(id), visibleSlideText(visible)));
    }
    next.planning = refreshPlanning(next);
    // Empty child evidence is intentional; refreshPlanning's automatic selection must not duplicate its parent's contract.
    for (const contract of next.planning.slidePlan || []) if (affectedIds.includes(contract.slideId)) contract.requiredEvidenceIds = next.outline.find(item => item.id === contract.slideId).requiredEvidenceIds;
    next.planning.storyArc = { ...next.planning.storyArc, slideSequence: next.outline.map(item => item.id) };
    next.outline.forEach((item, index) => { item.transitionFromPrevious = next.outline[index - 1]?.title || ''; item.transitionToNext = next.outline[index + 1]?.title || ''; });
  }
  next.deck = ensureDeckV3(next.deck);
  return next;
}

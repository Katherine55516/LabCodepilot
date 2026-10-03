import crypto from 'node:crypto';
import { digest, planKey, templateCapabilities } from './edit-context.mjs';

const ID = /^[a-zA-Z0-9_-]{1,80}$/;

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

export function stableId(prefix, ...parts) {
  const hash = crypto.createHash('sha256').update(parts.map(String).join('\0')).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
}

function validId(value) { return typeof value === 'string' && ID.test(value); }

function clone(value) { return structuredClone(value); }

function contentOfBlock(block) {
  const content = { ...block };
  delete content.id;
  delete content.type;
  return content;
}

function blockOfNode(node) {
  return { id: node.id, type: node.type, ...(node.content || {}) };
}

function ensureListItems(slideId, bullets, existing = [], blocks = []) {
  return bullets.map((text, index) => ({
    ...existing[index],
    id: validId(existing[index]?.id) ? existing[index].id : stableId('item', slideId, 'body', index),
    text: String(text || ''),
    ...(blocks[index] && !existing[index]?.heading && !existing[index]?.body ? {
      heading: String(blocks[index].heading || ''), body: String(blocks[index].body || ''),
      pointType: String(blocks[index].type || 'support'),
    } : {}),
  }));
}

function copyTextNode(slideId, role, value) {
  const text = String(value || '').trim();
  return text ? { id: stableId('node', slideId, role), type: 'text', semanticRole: role, slotId: role, styleRef: `typography.${role}`, content: { text } } : null;
}

/**
 * IR v3 keeps legacy title/bullets/blocks materialized during migration. Nodes
 * are canonical for commands; legacy fields keep M1-M5 clients/export fixtures
 * readable until all callers have moved to the node model.
 */
export function ensureSlideV3(input, index = 0) {
  const slide = clone(input || {});
  slide.id = validId(slide.id) ? slide.id : newId('slide');
  // nodeOrder marks a slide that has already migrated to IR v3. An empty or
  // partial canonical node list is intentional after object deletion and must
  // not silently recreate the legacy title/body nodes.
  const canonical = Array.isArray(slide.nodes) && (slide.nodes.length > 0 || Array.isArray(slide.nodeOrder));
  const nodes = canonical ? slide.nodes.map(clone) : [];
  let title = nodes.find(node => node?.type === 'text' && node.semanticRole === 'title');
  if (!title && !canonical) {
    title = { id: stableId('node', slide.id, 'title'), type: 'text', semanticRole: 'title', slotId: 'title', styleRef: 'typography.title', content: { text: String(slide.title || '') } };
    nodes.unshift(title);
  } else if (title) title.content = { ...(title.content || {}), text: String(title.content?.text ?? slide.title ?? '') };

  let body = nodes.find(node => node?.type === 'list' && node.semanticRole === 'body');
  const bullets = body ? (body.content?.items || []).map(item => String(item.text || '')) : (Array.isArray(slide.bullets) ? slide.bullets.map(String) : []);
  if (!body && !canonical) {
    body = { id: stableId('node', slide.id, 'body'), type: 'list', semanticRole: 'body', slotId: 'body', styleRef: 'typography.body', content: { items: [] } };
    nodes.push(body);
  }
  if (body) body.content = { ...(body.content || {}), items: ensureListItems(slide.id, bullets, body.content?.items || [], slide.copy?.blocks || []) };

  if (!canonical && slide.copy) {
    for (const [role, value] of [['eyebrow', slide.copy.eyebrow], ['subtitle', slide.copy.subtitle], ['takeaway', slide.copy.takeaway]]) {
      const node = copyTextNode(slide.id, role, value);
      if (node) nodes.push(node);
    }
  }

  const visualIds = new Set();
  for (const block of canonical ? [] : (Array.isArray(slide.blocks) ? slide.blocks : [])) {
    const id = validId(block.id) ? block.id : newId('node');
    visualIds.add(id);
    const existing = nodes.find(node => node.id === id);
    if (existing) {
      existing.type = block.type;
      existing.semanticRole ||= 'visual';
      existing.slotId ||= 'visual';
      existing.styleRef ||= `${block.type}.default`;
      existing.content = contentOfBlock({ ...block, id });
    } else {
      nodes.push({ id, type: block.type, semanticRole: 'visual', slotId: 'visual', styleRef: `${block.type}.default`, content: contentOfBlock({ ...block, id }) });
    }
  }

  slide.nodes = nodes.filter(node => node && validId(node.id) && (canonical ||
    node.semanticRole === 'title' || node.semanticRole === 'body' || visualIds.has(node.id) || !['image', 'chart', 'table', 'shape'].includes(node.type)
  ));
  slide.nodeOrder = slide.nodes.map(node => node.id);
  slide.componentGraph = { schemaVersion: 1, readingOrder: slide.nodeOrder,
    nodes: slide.nodes.map(node => ({ id: node.id, role: node.semanticRole || node.type, groupId: node.groupId || null,
      styleRef: node.styleRef || `${node.type}.default`, sourceRefs: node.sourceRefs || slide.sourceRefs || [], nativeRef: node.nativeRef || null })),
    edges: slide.nodes.flatMap(node => node.type === 'list' ? (node.content?.items || []).map(item => ({ from: node.id, to: item.id, relation: 'contains-point', role: item.pointType || 'support' })) : []) };
  slide.role ||= slide.layoutId || (index === 0 ? 'cover' : 'content');
  slide.layoutRef ||= slide.layoutId || 'summary';
  return materializeLegacySlide(slide);
}

export function materializeLegacySlide(input) {
  const slide = clone(input);
  const nodes = Array.isArray(slide.nodes) ? slide.nodes : [];
  const title = nodes.find(node => node.type === 'text' && node.semanticRole === 'title');
  const body = nodes.find(node => node.type === 'list' && node.semanticRole === 'body');
  slide.title = String(title?.content?.text ?? slide.title ?? '');
  slide.bullets = (body?.content?.items || []).map(item => String(item.text || '')).filter(Boolean);
  slide.blocks = nodes.filter(node => ['image', 'chart', 'table', 'shape'].includes(node.type)).map(blockOfNode);
  slide.layoutId = slide.layoutRef || slide.layoutId || 'summary';
  return slide;
}

export function ensureDeckV3(input) {
  const deck = clone(input || {});
  deck.deckId = validId(deck.deckId) ? deck.deckId : newId('deck');
  deck.schemaVersion = 3;
  deck.slides = (Array.isArray(deck.slides) ? deck.slides : []).map(ensureSlideV3);
  return deck;
}

export function ensureProjectV3(input) {
  if (!input) return input;
  const project = clone(input);
  project.schemaVersion = 3;
  project.outline = (Array.isArray(project.outline) ? project.outline : []).map((slide) => ({ ...slide, id: validId(slide.id) ? slide.id : newId('slide') }));
  if (project.deck) {
    const byIndex = new Map(project.outline.map((slide, index) => [index, slide.id]));
    project.deck = ensureDeckV3({ ...project.deck, slides: project.deck.slides.map((slide, index) => ({ ...slide, id: validId(slide.id) ? slide.id : byIndex.get(index) })) });
  }
  project.revision = Number.isInteger(project.revision) ? project.revision : 0;
  project.draftRevision = Number.isInteger(project.draftRevision) ? project.draftRevision : project.revision;
  project.publishedRevision = Number.isInteger(project.publishedRevision)
    ? project.publishedRevision
    : (project.status === 'completed' ? project.revision : 0);
  project.creationContext = {
    schemaVersion: 1, draftId: project.id, generationPolicy: project.generationPolicy, promptContractVersion: project.promptContractVersion, sourceRevision: project.sourceRevision || 0,
    sourceHash: project.source?.sha256 || digest(project.source?.text || project.prompt),
    modelRef: { configId: project.configId, model: project.model },
    templateRef: { id: project.template, versionOrHash: project.templateSpec?.sha256 || digest(project.templateSpec), capabilities: templateCapabilities(project.templateSpec) },
    outlineRevision: project.outlineRevision || 0,
    pageBudget: { ...project.pageDecision, recommended: project.planning?.pageRecommendation?.recommended || null, requested: project.pageDecision?.source === 'user' ? project.pages : null, compressionApproved: Boolean(project.compressionApproved), confirmed: project.outline.length ? project.outline.filter(slide => !slide.manualBlank).length : project.pages },
    planKey: planKey(project),
  };
  return project;
}

export function findNode(deck, slideId, nodeId) {
  const slide = deck?.slides?.find(item => item.id === slideId);
  return { slide, node: slide?.nodes?.find(item => item.id === nodeId) };
}

export function deckFingerprint(deck) {
  return crypto.createHash('sha256').update(JSON.stringify(ensureDeckV3(deck))).digest('hex');
}

export const _internals = { validId, ensureListItems, blockOfNode, contentOfBlock };

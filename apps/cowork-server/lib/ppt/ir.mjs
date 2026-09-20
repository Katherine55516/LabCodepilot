import crypto from 'node:crypto';

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

function ensureListItems(slideId, bullets, existing = []) {
  return bullets.map((text, index) => ({
    id: validId(existing[index]?.id) ? existing[index].id : stableId('item', slideId, 'body', index),
    text: String(text || ''),
  }));
}

/**
 * IR v3 keeps legacy title/bullets/blocks materialized during migration. Nodes
 * are canonical for commands; legacy fields keep M1-M5 clients/export fixtures
 * readable until all callers have moved to the node model.
 */
export function ensureSlideV3(input, index = 0) {
  const slide = clone(input || {});
  slide.id = validId(slide.id) ? slide.id : newId('slide');
  const canonical = Array.isArray(slide.nodes) && slide.nodes.length > 0;
  const nodes = canonical ? slide.nodes.map(clone) : [];
  let title = nodes.find(node => node?.type === 'text' && node.semanticRole === 'title');
  if (!title) {
    title = { id: stableId('node', slide.id, 'title'), type: 'text', semanticRole: 'title', slotId: 'title', styleRef: 'typography.title', content: { text: String(slide.title || '') } };
    nodes.unshift(title);
  } else title.content = { ...(title.content || {}), text: String(title.content?.text ?? slide.title ?? '') };

  let body = nodes.find(node => node?.type === 'list' && node.semanticRole === 'body');
  const bullets = body ? (body.content?.items || []).map(item => String(item.text || '')) : (Array.isArray(slide.bullets) ? slide.bullets.map(String) : []);
  if (!body) {
    body = { id: stableId('node', slide.id, 'body'), type: 'list', semanticRole: 'body', slotId: 'body', styleRef: 'typography.body', content: { items: [] } };
    nodes.push(body);
  }
  body.content = { ...(body.content || {}), items: ensureListItems(slide.id, bullets, body.content?.items || []) };

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

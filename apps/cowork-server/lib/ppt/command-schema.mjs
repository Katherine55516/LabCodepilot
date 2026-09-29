import { ensureSlideV3, newId } from './ir.mjs';

const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const LAYOUTS = new Set(['cover', 'summary', 'editorial', 'big-number', 'comparison', 'chart', 'table', 'image-text', 'timeline', 'conclusion']);
const NODE_TYPES = new Set(['text', 'list', 'image', 'chart', 'table', 'shape', 'foreign']);
const SLIDE = Object.freeze({ width: Math.round(13.333 * 914400), height: Math.round(7.5 * 914400) });
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_IMAGE_EDGE = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_NODES_PER_SLIDE = 200;

export const COMMAND_TYPES = new Set([
  'slide.insert', 'slide.delete', 'slide.duplicate', 'slide.reorder', 'slide.setLayout',
  'node.insert', 'node.delete', 'node.duplicate', 'node.setContent', 'node.setStyle', 'node.setGeometry', 'node.setZIndex', 'node.setRotation', 'node.setLocked',
  'nodes.delete', 'nodes.duplicate', 'nodes.restore', 'nodes.setGeometry', 'nodes.group', 'nodes.ungroup', 'nodes.setGroup',
  'theme.setPalette', 'theme.setTokens', 'deck.replace', 'ai.objectPatch', 'ai.slidePatch',
]);

function fail(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }
function record(value, field) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`); return value; }
function id(value, field) { if (typeof value !== 'string' || !ID.test(value)) fail(`${field} is invalid`); return value; }
function string(value, field, max, { empty = true } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${field} is invalid`);
  return value;
}
function number(value, field, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${field} is invalid`);
  return value;
}
function boolean(value, field) { if (typeof value !== 'boolean') fail(`${field} must be a boolean`); return value; }

function imageDimensions(kind, bytes) {
  if (kind === 'png') {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || !bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2); if (length < 2) return null; offset += 2 + length;
  }
  return null;
}

export function validateImageDataUrl(value) {
  const match = typeof value === 'string' && value.match(DATA_URL);
  if (!match || match[2].length > 700000) fail('image must be PNG/JPEG under 512 KB');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('image must be PNG/JPEG under 512 KB');
  const dimensions = imageDimensions(match[1], bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) fail('image dimensions are invalid');
  return { bytes: bytes.length, ...dimensions };
}

function geometry(value, field = 'geometry') {
  const input = record(value, field); const result = {};
  for (const key of ['x', 'y', 'width', 'height']) result[key] = number(input[key], `${field}.${key}`, 0, key === 'x' || key === 'width' ? SLIDE.width : SLIDE.height, true);
  if (result.width < 91440 || result.height < 91440 || result.x + result.width > SLIDE.width || result.y + result.height > SLIDE.height) fail(`${field} must stay inside the slide`);
  return result;
}

function style(value, project) {
  const input = record(value, 'style');
  const allowed = new Set(['color', 'fill', 'fontFamily', 'eastAsiaFontFamily', 'fontSizePt', 'fontWeight', 'fontStyle', 'textAlign', 'lineHeight', 'letterSpacing', 'opacity', 'shape']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('style contains unsupported fields');
  const result = {};
  for (const key of ['color', 'fill']) if (input[key] !== undefined) { if (!COLOR.test(input[key])) fail(`style.${key} is invalid`); result[key] = input[key].toLowerCase(); }
  const templateFonts = new Set(Object.values(project?.templateSpec?.fonts || {}).filter(value => typeof value === 'string'));
  if (project?.templateFidelity?.mode === 'preserve') for (const slide of project.templateFidelity.slides || []) {
    for (const node of slide.nodes || []) {
      if (node.style?.fontFamily) templateFonts.add(node.style.fontFamily);
      if (node.style?.eastAsiaFontFamily) templateFonts.add(node.style.eastAsiaFontFamily);
    }
  }
  for (const key of ['fontFamily', 'eastAsiaFontFamily']) if (input[key] !== undefined) { const font = string(input[key], `style.${key}`, 120, { empty: false }); if (!templateFonts.has(font)) fail(`style.${key} must use a template font`); result[key] = font; }
  if (input.fontSizePt !== undefined) result.fontSizePt = number(input.fontSizePt, 'style.fontSizePt', project?.templateFidelity?.mode === 'preserve' ? 8 : 10, 96);
  if (input.fontWeight !== undefined) result.fontWeight = number(input.fontWeight, 'style.fontWeight', 100, 900, true);
  if (input.fontStyle !== undefined) { if (!['normal', 'italic'].includes(input.fontStyle)) fail('style.fontStyle is invalid'); result.fontStyle = input.fontStyle; }
  if (input.textAlign !== undefined) { if (!['left', 'center', 'right'].includes(input.textAlign)) fail('style.textAlign is invalid'); result.textAlign = input.textAlign; }
  if (input.lineHeight !== undefined) result.lineHeight = number(input.lineHeight, 'style.lineHeight', .8, 3);
  if (input.letterSpacing !== undefined) result.letterSpacing = number(input.letterSpacing, 'style.letterSpacing', -5, 30);
  if (input.opacity !== undefined) result.opacity = number(input.opacity, 'style.opacity', 0, 1);
  if (input.shape !== undefined) { if (!['rect', 'ellipse'].includes(input.shape)) fail('style.shape is invalid'); result.shape = input.shape; }
  return result;
}

function listItems(value) {
  if (!Array.isArray(value) || value.length > 20) fail('content.items is invalid');
  return value.map((item, index) => {
    const row = record(item, `content.items[${index}]`);
    const heading = row.heading === undefined ? undefined : string(row.heading, `content.items[${index}].heading`, 300);
    const body = row.body === undefined ? undefined : string(row.body, `content.items[${index}].body`, 4000);
    const text = string(row.text ?? [heading, body].filter(Boolean).join('\n'), `content.items[${index}].text`, 4300);
    return { id: row.id === undefined ? newId('item') : id(row.id, `content.items[${index}].id`), text,
      ...(heading !== undefined ? { heading } : {}), ...(body !== undefined ? { body } : {}),
      ...(typeof row.pointType === 'string' ? { pointType: string(row.pointType, `content.items[${index}].pointType`, 40) } : {}) };
  });
}

export function validateNodeContent(type, value) {
  const input = record(value, 'content');
  if (type === 'text') {
    const text = string(input.text ?? '', 'content.text', 10000);
    if (input.paragraphs === undefined) return { text };
    if (!Array.isArray(input.paragraphs) || input.paragraphs.length > 30) fail('content.paragraphs is invalid');
    return { text, paragraphs: input.paragraphs.map((item, index) => {
      const row = record(item, `content.paragraphs[${index}]`);
      return { label: string(row.label || '', `content.paragraphs[${index}].label`, 300),
        body: string(row.body || '', `content.paragraphs[${index}].body`, 1000, { empty: false }) };
    }) };
  }
  if (type === 'list') return { items: listItems(input.items || []) };
  if (type === 'image') {
    const result = { dataUrl: string(input.dataUrl, 'content.dataUrl', 700000, { empty: false }), text: string(input.text || '', 'content.text', 200) };
    validateImageDataUrl(result.dataUrl); return result;
  }
  if (type === 'chart') {
    if (!['bar', 'pie', 'line'].includes(input.chartType || 'bar')) fail('content.chartType is invalid');
    if (!Array.isArray(input.labels) || !Array.isArray(input.values) || input.labels.length < 2 || input.labels.length > 12 || input.labels.length !== input.values.length) fail('chart data is invalid');
    const values = input.values.map((item, index) => number(Number(item), `content.values[${index}]`, -1e9, 1e9));
    return { chartType: input.chartType || 'bar', labels: input.labels.map((item, index) => string(item, `content.labels[${index}]`, 64, { empty: false })), values, unit: string(input.unit || '', 'content.unit', 32) };
  }
  if (type === 'table') {
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 20 || !Array.isArray(input.rows[0]) || input.rows[0].length < 1 || input.rows[0].length > 12) fail('table dimensions are invalid');
    const columns = input.rows[0].length;
    return { rows: input.rows.map((row, rowIndex) => { if (!Array.isArray(row) || row.length !== columns) fail('table rows must have equal columns'); return row.map((cell, columnIndex) => string(cell, `content.rows[${rowIndex}][${columnIndex}]`, 200)); }) };
  }
  if (type === 'shape') return { text: string(input.text || '', 'content.text', 500), shape: ['rect', 'ellipse'].includes(input.shape) ? input.shape : 'rect' };
  if (type === 'foreign') fail('foreign objects cannot be edited');
  fail(`unsupported node type: ${type}`);
}

function nodeById(project, slideId, nodeId) {
  const slide = project.deck?.slides?.find(item => item.id === slideId); if (!slide) fail('slide not found');
  const node = slide.nodes?.find(item => item.id === nodeId); if (!node) fail('node not found');
  return node;
}

function nodeInput(value, project) {
  const input = record(value, 'node'); const type = String(input.type || '');
  if (!NODE_TYPES.has(type) || type === 'foreign') fail('node.type is invalid');
  return {
    ...(input.id ? { id: id(input.id, 'node.id') } : {}), type,
    semanticRole: string(input.semanticRole || 'visual', 'node.semanticRole', 80), slotId: string(input.slotId || 'freeform', 'node.slotId', 80),
    content: validateNodeContent(type, input.content || {}), ...(input.geometry ? { geometry: geometry(input.geometry) } : {}), style: style(input.style || {}, project),
    zIndex: input.zIndex === undefined ? 30 : number(input.zIndex, 'node.zIndex', 0, 1000, true),
    rotation: input.rotation === undefined ? 0 : number(input.rotation, 'node.rotation', -360, 360),
    locked: input.locked === undefined ? false : boolean(input.locked, 'node.locked'), groupId: input.groupId ? id(input.groupId, 'node.groupId') : null,
  };
}

function slideInput(value, project) {
  const input = record(value, 'payload.slide');
  const normalized = ensureSlideV3(input);
  const layoutId = normalized.layoutRef || normalized.layoutId || 'summary';
  if (!LAYOUTS.has(layoutId)) fail('payload.slide.layoutId is invalid');
  if (!Array.isArray(normalized.nodes) || normalized.nodes.length > MAX_NODES_PER_SLIDE) fail(`a slide can contain at most ${MAX_NODES_PER_SLIDE} objects`);
  normalized.nodes = normalized.nodes.map(node => ({
    ...nodeInput(node, project),
    ...(node.styleRef ? { styleRef: string(node.styleRef, 'node.styleRef', 120, { empty: false }) } : {}),
  }));
  normalized.layoutId = layoutId;
  normalized.layoutRef = layoutId;
  return normalized;
}

function nodeIds(value, field, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > 50) fail(`${field} is invalid`);
  const result = value.map((item, index) => id(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${field} must contain unique IDs`);
  return result;
}

function validatePayload(command, project) {
  const p = record(command.payload, 'payload');
  if (command.type === 'slide.insert') {
    if ((project.deck?.slides?.length || 0) >= 100) fail('a deck can contain at most 100 slides');
    if (p.index !== undefined) number(p.index, 'payload.index', 0, 100, true); p.slide = slideInput(p.slide || {}, project);
  } else if (['slide.delete', 'slide.duplicate', 'slide.setLayout'].includes(command.type)) {
    id(p.slideId, 'payload.slideId'); if (command.type === 'slide.duplicate' && (project.deck?.slides?.length || 0) >= 100) fail('a deck can contain at most 100 slides'); if (command.type === 'slide.setLayout' && !LAYOUTS.has(p.layoutId)) fail('payload.layoutId is invalid');
  } else if (command.type === 'slide.reorder') {
    if (!Array.isArray(p.slideIds) || p.slideIds.some(value => typeof value !== 'string' || !ID.test(value))) fail('payload.slideIds is invalid');
  } else if (command.type === 'node.insert') {
    id(p.slideId, 'payload.slideId'); const target = project.deck?.slides?.find(item => item.id === p.slideId); if (!target) fail('slide not found'); if ((target.nodes?.length || 0) >= MAX_NODES_PER_SLIDE) fail(`a slide can contain at most ${MAX_NODES_PER_SLIDE} objects`); p.node = nodeInput(p.node, project);
  } else if (command.type === 'node.duplicate' || command.type === 'node.delete') {
    id(p.slideId, 'payload.slideId'); id(p.nodeId, 'payload.nodeId');
  } else if (['node.setContent', 'node.setStyle', 'node.setGeometry', 'node.setZIndex', 'node.setRotation', 'node.setLocked'].includes(command.type)) {
    id(p.slideId, 'payload.slideId'); id(p.nodeId, 'payload.nodeId'); const node = nodeById(project, p.slideId, p.nodeId);
    if (command.type === 'node.setContent') p.content = validateNodeContent(node.type, p.content);
    if (command.type === 'node.setStyle') p.style = p.style === null ? null : style(p.style, project);
    if (command.type === 'node.setGeometry') p.geometry = p.geometry === null ? null : geometry(p.geometry);
    if (command.type === 'node.setZIndex') p.zIndex = p.zIndex === null ? null : number(p.zIndex, 'payload.zIndex', 0, 1000, true);
    if (command.type === 'node.setRotation') { p.rotation = p.rotation === null ? null : number(p.rotation, 'payload.rotation', -360, 360); if (['chart', 'table'].includes(node.type) && p.rotation !== null && p.rotation !== 0) fail('chart and table rotation is not supported'); }
    if (command.type === 'node.setLocked') p.locked = boolean(p.locked, 'payload.locked');
  } else if (command.type === 'nodes.delete' || command.type === 'nodes.duplicate') {
    id(p.slideId, 'payload.slideId'); p.nodeIds = nodeIds(p.nodeIds, 'payload.nodeIds');
    if (command.type === 'nodes.duplicate') { const target = project.deck?.slides?.find(item => item.id === p.slideId); if (!target) fail('slide not found'); if ((target.nodes?.length || 0) + p.nodeIds.length > MAX_NODES_PER_SLIDE) fail(`a slide can contain at most ${MAX_NODES_PER_SLIDE} objects`); }
  } else if (command.type === 'nodes.restore') {
    id(p.slideId, 'payload.slideId'); if (!Array.isArray(p.entries) || !p.entries.length || p.entries.length > 50) fail('payload.entries is invalid');
    p.entries = p.entries.map((entry, index) => ({ index: number(entry?.index, `payload.entries[${index}].index`, 0, 200, true), node: nodeInput(entry?.node, project) }));
  } else if (command.type === 'nodes.setGeometry') {
    id(p.slideId, 'payload.slideId'); if (!Array.isArray(p.changes) || !p.changes.length || p.changes.length > 50) fail('payload.changes is invalid');
    p.changes = p.changes.map((change, index) => ({ nodeId: id(change?.nodeId, `payload.changes[${index}].nodeId`), geometry: geometry(change?.geometry, `payload.changes[${index}].geometry`) }));
  } else if (command.type === 'nodes.group' || command.type === 'nodes.ungroup') {
    id(p.slideId, 'payload.slideId'); p.nodeIds = nodeIds(p.nodeIds, 'payload.nodeIds', { min: command.type === 'nodes.group' ? 2 : 1 });
  } else if (command.type === 'nodes.setGroup') {
    id(p.slideId, 'payload.slideId'); if (!Array.isArray(p.entries) || !p.entries.length || p.entries.length > 50) fail('payload.entries is invalid');
    p.entries = p.entries.map((entry, index) => ({ nodeId: id(entry?.nodeId, `payload.entries[${index}].nodeId`), groupId: entry?.groupId === null ? null : id(entry?.groupId, `payload.entries[${index}].groupId`) }));
  } else if (command.type === 'theme.setPalette') {
    const palette = record(p.palette, 'payload.palette'); p.palette = Object.fromEntries(['background', 'foreground', 'muted', 'accent'].map(key => { if (!COLOR.test(palette[key])) fail(`payload.palette.${key} is invalid`); return [key, palette[key].toLowerCase()]; }));
  } else if (command.type === 'theme.setTokens') {
    const tokens = record(p.tokens, 'payload.tokens');
    p.tokens = {
      titleScale: number(tokens.titleScale, 'payload.tokens.titleScale', 1, 1.12),
      bodyScale: number(tokens.bodyScale, 'payload.tokens.bodyScale', 1, 1.12),
      spacingScale: number(tokens.spacingScale, 'payload.tokens.spacingScale', .95, 1.2),
    };
  } else if (command.type === 'ai.objectPatch') {
    id(p.slideId, 'payload.slideId'); id(p.nodeId, 'payload.nodeId'); const node = nodeById(project, p.slideId, p.nodeId);
    const patch = record(p.patch, 'payload.patch'); if (patch.content === undefined || Object.keys(patch).some(key => key !== 'content')) fail('AI patch may only change content');
    p.patch = { content: validateNodeContent(node.type, patch.content) };
  } else if (command.type === 'ai.slidePatch') {
    id(p.slideId, 'payload.slideId'); if (!Array.isArray(p.patches) || !p.patches.length || p.patches.length > 30) fail('payload.patches is invalid');
    p.patches = p.patches.map((patch, index) => { const nodeId = id(patch?.nodeId, `payload.patches[${index}].nodeId`); const node = nodeById(project, p.slideId, nodeId); return { nodeId, content: validateNodeContent(node.type, patch.content) }; });
    if (p.layoutId !== undefined && !LAYOUTS.has(p.layoutId)) fail('payload.layoutId is invalid');
  } else if (command.type === 'deck.replace') record(p.deck, 'payload.deck');
  command.payload = p; return command;
}

export function normalizeCommand(input, project) {
  if (!input || typeof input !== 'object') fail('command body is required');
  const type = String(input.type || ''); if (!COMMAND_TYPES.has(type)) fail(`unsupported command: ${type}`);
  const baseRevision = Number(input.baseRevision); if (!Number.isInteger(baseRevision) || baseRevision < 0) fail('baseRevision must be a non-negative integer');
  return validatePayload({ id: typeof input.id === 'string' && ID.test(input.id) ? input.id : newId('cmd'), type, baseRevision,
    payload: input.payload && typeof input.payload === 'object' ? structuredClone(input.payload) : {}, actor: String(input.actor || project.uid || 'user').slice(0, 120), createdAt: new Date().toISOString() }, project);
}

export function commandTargets(command) {
  const p = command.payload || {}; const targets = [];
  if (p.slideId) targets.push(`slide:${p.slideId}`); if (p.nodeId) targets.push(`node:${p.slideId || '*'}:${p.nodeId}`);
  for (const nodeId of p.nodeIds || []) targets.push(`node:${p.slideId || '*'}:${nodeId}`);
  for (const change of p.changes || []) targets.push(`node:${p.slideId || '*'}:${change.nodeId}`);
  for (const patch of p.patches || []) targets.push(`node:${p.slideId || '*'}:${patch.nodeId}`);
  for (const entry of p.entries || []) if (entry.nodeId) targets.push(`node:${p.slideId || '*'}:${entry.nodeId}`);
  for (const entry of p.entries || []) if (entry.node?.id) targets.push(`node:${p.slideId || '*'}:${entry.node.id}`);
  if (command.type === 'slide.reorder' || command.type === 'deck.replace' || command.type === 'theme.setPalette' || command.type === 'theme.setTokens') targets.push('deck:*');
  if (!targets.length && command.type.startsWith('slide.')) targets.push('deck:slides'); return [...new Set(targets)];
}

export function commandsConflict(left, right) {
  const a = commandTargets(left); const b = commandTargets(right);
  return a.some(one => b.some(two => one === two || one === 'deck:*' || two === 'deck:*' ||
    (one.startsWith('slide:') && two.startsWith(`${one.replace('slide:', 'node:')}:`)) || (two.startsWith('slide:') && one.startsWith(`${two.replace('slide:', 'node:')}:`))));
}

export const limits = Object.freeze({ MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, MAX_NODES_PER_SLIDE, SLIDE });

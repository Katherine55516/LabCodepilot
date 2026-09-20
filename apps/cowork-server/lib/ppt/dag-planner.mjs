const NODE_ORDER = [
  ['source', []],
  ['outline', ['source']],
  ['content', ['outline']],
  ['media', ['outline']],
  ['layout', ['content', 'media']],
  ['preview', ['layout']],
  ['quality', ['preview']],
  ['review', ['quality']],
  ['repair', ['review']],
  ['publish', ['repair']],
];

export function planGenerationDag(project, previous = {}) {
  const now = new Date().toISOString();
  return Object.fromEntries(NODE_ORDER.map(([id, dependsOn]) => [id, {
    id,
    dependsOn,
    status: previous[id]?.status === 'completed' ? 'completed' : 'pending',
    attempts: Number(previous[id]?.attempts || 0),
    startedAt: previous[id]?.startedAt || null,
    completedAt: previous[id]?.completedAt || null,
    error: null,
    updatedAt: now,
    projectRevision: Number(project.revision || 0),
  }]));
}

export function readyNodes(nodes) {
  return Object.values(nodes || {}).filter(node => node.status === 'pending' && node.dependsOn.every(id => nodes[id]?.status === 'completed'));
}

export const GENERATION_NODE_ORDER = Object.freeze(NODE_ORDER.map(([id]) => id));

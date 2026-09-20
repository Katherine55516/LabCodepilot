/** Small bounded worker pool used by durable PPT nodes. The caller owns node
 * persistence so recovery can rerun only unfinished items. */
export async function boundedAll(items, concurrency, worker) {
  if (!Array.isArray(items)) throw new Error('items must be an array');
  const limit = Math.max(1, Math.min(8, Number(concurrency) || 1));
  const results = new Array(items.length);
  const errors = [];
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); }
      catch (error) { errors.push({ index, error }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  if (errors.length) {
    const failure = new Error(errors.map(item => `node ${item.index + 1}: ${item.error?.message || item.error}`).join('; '));
    failure.causes = errors;
    throw failure;
  }
  return results;
}

export function dagNodeId(kind, slideId) { return `${kind}:${slideId}`; }

export function nodeRecord(status, previous = {}, patch = {}) {
  const now = new Date().toISOString();
  return {
    ...previous,
    status,
    attempts: status === 'running' ? (previous.attempts || 0) + 1 : (previous.attempts || 0),
    ...(status === 'running' ? { startedAt: now } : {}),
    ...(['done', 'failed'].includes(status) ? { finishedAt: now } : {}),
    ...patch,
  };
}

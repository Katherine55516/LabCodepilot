/** FIFO reservations shared by interactive PPT nodes and scheduled routines. */
export function createCapacity(limit) {
  let active = 0;
  const queue = [];
  const release = () => {
    const next = queue.shift();
    if (next) next(makeRelease()); else active--;
  };
  const makeRelease = () => { let done = false; return () => { if (!done) { done = true; release(); } }; };
  return {
    tryAcquire() { if (active >= limit || queue.length) return null; active++; return makeRelease(); },
    acquire() { const slot = this.tryAcquire(); return slot ? Promise.resolve(slot) : new Promise(resolve => queue.push(resolve)); },
    snapshot() { return { active, queued: queue.length, limit }; },
  };
}

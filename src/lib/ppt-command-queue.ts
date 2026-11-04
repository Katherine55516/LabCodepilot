/**
 * Serial editor command queue.
 * - One request at a time; each command's baseRevision is the revision the
 *   previous one returned, so a burst of local edits never conflicts with
 *   itself (the server only rejects edits that race a different writer).
 * - Optimistic patches show an edit at once and are dropped when the server
 *   answers (its project now contains the edit) or rejects it (rollback).
 * - A geometry command waiting behind an in-flight one is replaced by a newer
 *   geometry command for the same objects: positions are absolute, so only
 *   the latest one needs to be sent.
 */
export type PptBounds = { x: number; y: number; width: number; height: number };
export type OptimisticPatch = { nodeId: string; bounds?: PptBounds; rotation?: number; content?: Record<string, unknown> };
export type QueueError = Error & { status?: number; code?: string; details?: unknown };
type Command = { type: string; payload: Record<string, unknown> };
type Item<P> = {
  seq: number; command?: Command; task?: () => Promise<P | null | undefined>; patches: OptimisticPatch[];
  waiters: { resolve: (value: P | null) => void }[];
};

const GEOMETRY = new Set(['nodes.setGeometry', 'node.setGeometry']);
const geometryKey = (command: Command) => {
  const p = command.payload as { slideId?: string; nodeId?: string; changes?: { nodeId: string }[] };
  return GEOMETRY.has(command.type) ? JSON.stringify([command.type, p.slideId, p.nodeId ?? null, (p.changes || []).map(change => change.nodeId).sort()]) : null;
};

/** A rejected edit vs. a write that raced another device or tab. */
export function isRevisionConflict(error: QueueError) {
  return error.code ? error.code === 'revision_conflict' : error.status === 409 && /conflict/i.test(error.message);
}

export class PptCommandQueue<P extends { revision: number }> {
  private items: Item<P>[] = [];
  private running = false;
  private seq = 0;
  revision: number;

  constructor(revision: number, private options: {
    send: (body: { id: string; type: string; baseRevision: number; payload: unknown }) => Promise<{ project: P }>;
    onProject: (project: P) => void;
    onError: (error: QueueError, command: Command | null) => void;
    onOverlay?: () => void;
    newId?: () => string;
  }) { this.revision = revision; }

  /** A newer revision seen elsewhere (live updates, another tab's reload). */
  observe(revision: number) { if (revision > this.revision) this.revision = revision; }

  get idle() { return !this.running && !this.items.length; }

  /** Latest optimistic state per node, over every command not yet answered. */
  overlay() {
    const merged = new Map<string, OptimisticPatch>();
    for (const item of this.items) for (const patch of item.patches) merged.set(patch.nodeId, { ...merged.get(patch.nodeId), ...patch });
    return merged;
  }

  enqueue(type: string, payload: Record<string, unknown>, patches: OptimisticPatch[] = []): Promise<P | null> {
    const command = { type, payload }, key = geometryKey(command);
    // Item 0 is in flight while the queue runs; only waiting items may be replaced.
    const waiting = key ? this.items.slice(this.running ? 1 : 0).reverse().find(item => item.command && geometryKey(item.command) === key) : undefined;
    const promise = new Promise<P | null>(resolve => {
      if (waiting) { waiting.command = command; waiting.patches = patches; waiting.waiters.push({ resolve }); }
      else this.items.push({ seq: ++this.seq, command, patches, waiters: [{ resolve }] });
    });
    if (patches.length) this.options.onOverlay?.();
    void this.drain();
    return promise;
  }

  /** Runs a request that changes the revision (undo, publish…) in order with commands. */
  run(task: () => Promise<P | null | undefined>): Promise<P | null> {
    const promise = new Promise<P | null>(resolve => this.items.push({ seq: ++this.seq, task, patches: [], waiters: [{ resolve }] }));
    void this.drain();
    return promise;
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.items.length) {
        const item = this.items[0];
        let result: P | null = null;
        try {
          if (item.command) {
            const { project } = await this.options.send({ id: (this.options.newId || defaultId)(), type: item.command.type, baseRevision: this.revision, payload: item.command.payload });
            result = project;
          } else result = (await item.task!()) || null;
          if (result) { this.observe(result.revision); this.options.onProject(result); }
        } catch (reason) {
          const error = (reason instanceof Error ? reason : new Error(String(reason))) as QueueError;
          // Later local edits were based on state another writer replaced.
          const dropped = isRevisionConflict(error) ? this.items.splice(1) : [];
          dropped.forEach(other => other.waiters.forEach(waiter => waiter.resolve(null)));
          if (dropped.some(other => other.patches.length)) this.options.onOverlay?.();
          this.options.onError(error, item.command || null);
        }
        this.items.shift();
        if (item.patches.length) this.options.onOverlay?.();
        item.waiters.forEach(waiter => waiter.resolve(result));
      }
    } finally { this.running = false; }
  }
}

function defaultId() { return crypto.randomUUID().replaceAll('-', ''); }

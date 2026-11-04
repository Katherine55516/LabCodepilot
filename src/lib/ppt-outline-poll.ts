type Polled = { status: string; error?: string };

export function pptAbortError() {
  return new DOMException('Outline polling was cancelled', 'AbortError');
}

export function isPptAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(pptAbortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(pptAbortError()); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/**
 * Polls a project until its input reading or outline is ready. An aborted
 * signal stops the loop before the next read and suppresses progress from a
 * read that was already in flight, so a superseded analysis can never update
 * the wizard with another project's outline.
 */
export async function pollOutlineProject<T extends Polled>({ read, initial = null, signal, onProgress, failedMessage, timeoutMessage, intervalMs = 1000, maxAttempts = 1800, wait = sleep, settled }: {
  read: () => Promise<T>;
  /** Hands the project over earlier, e.g. once its outline is forming in view. */
  settled?: (project: T) => boolean;
  /** Last project known before polling; attached to errors for the failure dialog. */
  initial?: T | null;
  signal?: AbortSignal;
  onProgress?: (project: T) => void;
  failedMessage: string;
  timeoutMessage: string;
  intervalMs?: number;
  maxAttempts?: number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<T> {
  let lastKnown: T | null = initial;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) throw pptAbortError();
      const project = await read();
      if (signal?.aborted) throw pptAbortError();
      lastKnown = project; onProgress?.(project);
      if (project.status === 'input_ready' || project.status === 'outline_ready' || settled?.(project)) return project;
      if (['failed', 'cancelled'].includes(project.status)) throw Object.assign(new Error(project.error || failedMessage), { project });
      await wait(intervalMs, signal);
    }
    throw new Error(timeoutMessage);
  } catch (error) {
    if (!isPptAbort(error) && error instanceof Error && lastKnown && !('project' in error)) Object.assign(error, { project: lastKnown });
    throw error;
  }
}

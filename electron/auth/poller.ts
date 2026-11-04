/**
 * Background polling for managed-account login.
 *
 * Polls /api/v1/configs/hash every 10 minutes; on hash change, fetches the
 * full /api/v1/configs and notifies the caller via the onConfigsChanged
 * callback. Application updates are intentionally NOT polled here — the
 * electron-updater module owns that channel.
 *
 * Only runs while online. Network errors are swallowed silently — the next
 * tick gets a fresh shot.
 */

import { getConfigs } from './client';
import { logInfo } from './log';
import type { ModelConfig } from './types';

const CONFIG_POLL_INTERVAL_MS = 10 * 60 * 1000;

export interface PollerCallbacks {
  onConfigsChanged?: (configs: ModelConfig[]) => void;
}

let timers: NodeJS.Timeout[] = [];

export function startBackgroundPolling(cb: PollerCallbacks): void {
  if (timers.length > 0) {
    // Already running — avoid double-scheduling
    return;
  }
  const tickConfigs = async (): Promise<void> => {
    try {
      const configs = await getConfigs();
      cb.onConfigsChanged?.(configs);
    } catch {
      // Already logged inside client.ts at the warn level; swallow here.
    }
  };
  timers.push(setInterval(tickConfigs, CONFIG_POLL_INTERVAL_MS));
  logInfo('background polling started (configs hash every', CONFIG_POLL_INTERVAL_MS / 1000, 's)');
}

export function stopBackgroundPolling(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
}

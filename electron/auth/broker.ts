/**
 * Bridge between the Electron main process and the embedded Next.js
 * standalone server for DB mutations the main process needs to make.
 *
 * The main process never opens better-sqlite3 directly — its ABI is
 * pinned to the Electron runtime via after-pack.js, and the Next.js
 * server is the only process that should be writing to codepilot.db.
 * So when main has new managed providers to persist (or to wipe on
 * logout), it POSTs them to the server's /api/auth/managed-providers/*
 * routes.
 *
 * The server port is injected by main once the standalone server is
 * up; calls made before that resolve to a sentinel error.
 */

import * as http from 'http';
import { logWarn } from './log';
import type { ManagedProviderRow } from './managed-providers';
import type { ImageProviderConfig } from './types';

let serverPort: number | null = null;

export function setBrokerServerPort(port: number): void {
  serverPort = port;
}

export function getBrokerServerPort(): number | null {
  return serverPort;
}

interface BrokerResponse<T> {
  status: number;
  body: T | undefined;
  ok: boolean;
}

function postJson<T>(path: string, payload: unknown): Promise<BrokerResponse<T>> {
  return new Promise((resolve, reject) => {
    if (serverPort === null) {
      reject(new Error('broker: server port not set yet'));
      return;
    }
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10_000,
      },
      (res) => {
        let chunks = '';
        res.on('data', (c: Buffer) => { chunks += c.toString(); });
        res.on('end', () => {
          let parsed: T | undefined;
          try { parsed = JSON.parse(chunks) as T; } catch { /* non-json */ }
          resolve({
            status: res.statusCode ?? 0,
            body: parsed,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('broker: request timeout'));
    });
    req.write(body);
    req.end();
  });
}

function getJson<T>(path: string): Promise<BrokerResponse<T>> {
  return new Promise((resolve, reject) => {
    if (serverPort === null) {
      reject(new Error('broker: server port not set yet'));
      return;
    }
    const req = http.get(
      { hostname: '127.0.0.1', port: serverPort, path, timeout: 5_000 },
      (res) => {
        let chunks = '';
        res.on('data', (c: Buffer) => { chunks += c.toString(); });
        res.on('end', () => {
          let parsed: T | undefined;
          try { parsed = JSON.parse(chunks) as T; } catch { /* non-json */ }
          resolve({
            status: res.statusCode ?? 0,
            body: parsed,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('broker: request timeout'));
    });
  });
}

/** Push the full ManagedProviderRow list. Returns {upserted, pruned}. */
export async function syncManagedProvidersToServer(
  rows: ManagedProviderRow[],
): Promise<{ upserted: number; pruned: number }> {
  const r = await postJson<{ ok: boolean; upserted: number; pruned: number; error?: string }>(
    '/api/auth/managed-providers/sync',
    { rows },
  );
  if (!r.ok) {
    throw new Error(`sync failed: status=${r.status} body=${JSON.stringify(r.body)}`);
  }
  return { upserted: r.body?.upserted ?? 0, pruned: r.body?.pruned ?? 0 };
}

/** Delete every managed-source row. Returns count removed. */
export async function purgeManagedProvidersOnServer(): Promise<number> {
  const r = await postJson<{ ok: boolean; removed: number; error?: string }>(
    '/api/auth/managed-providers/purge',
    {},
  );
  if (!r.ok) {
    throw new Error(`purge failed: status=${r.status} body=${JSON.stringify(r.body)}`);
  }
  return r.body?.removed ?? 0;
}

/** Cheap query for renderer-facing AuthSnapshot.managedConfigCount. */
export async function getManagedProviderCountFromServer(): Promise<number> {
  try {
    const r = await getJson<{ count: number }>('/api/auth/managed-providers/count');
    return r.body?.count ?? 0;
  } catch (e) {
    logWarn('broker: managed provider count fetch failed:', (e as Error).message);
    return 0;
  }
}

/**
 * Push the global Bailian image config to the embedded server so it writes the
 * `bailian_image_config` settings row (SENSITIVE → sealed at rest). The apiKey
 * travels plaintext only over 127.0.0.1 loopback, same model as the managed
 * provider api_key in /managed-providers/sync.
 */
export async function syncImageConfigToServer(config: ImageProviderConfig): Promise<void> {
  const r = await postJson<{ ok: boolean; error?: string }>(
    '/api/auth/image-config/sync',
    { config },
  );
  if (!r.ok) {
    throw new Error(`image-config sync failed: status=${r.status} body=${JSON.stringify(r.body)}`);
  }
}

/** Clear the delivered image config (logout / 401). */
export async function purgeImageConfigOnServer(): Promise<void> {
  const r = await postJson<{ ok: boolean; error?: string }>(
    '/api/auth/image-config/purge',
    {},
  );
  if (!r.ok) {
    throw new Error(`image-config purge failed: status=${r.status} body=${JSON.stringify(r.body)}`);
  }
}

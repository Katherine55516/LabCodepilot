/**
 * Temporary loopback HTTP server that receives the OAuth callback.
 *
 * Binds 127.0.0.1:0 (OS-assigned port) so it never conflicts with another
 * service (including the OpenAI OAuth callback fixed at 1455). Strictly
 * loopback — never bind 0.0.0.0.
 *
 * Lifecycle:
 *   1. Caller invokes startCallbackServer(expectedState) → returns handle
 *      with port + waitForCallback + close.
 *   2. Caller opens browser to ${BACKEND_BASE}/auth/cli/start with the
 *      handle.port baked into the callback URL.
 *   3. Browser hits /cb with ?session_token + ?state (or ?error).
 *   4. Server validates state, decodes token, resolves the pending promise.
 *   5. Caller MUST call close() in a finally to release the port.
 */

import * as http from 'http';
import type { AddressInfo } from 'net';

export interface CallbackResult {
  session_token: string;
  state: string;
}

export interface CallbackServerHandle {
  port: number;
  /** Wait for the browser to hit /cb. Rejects on state mismatch / OAuth error / timeout. */
  waitForCallback(timeoutMs: number): Promise<CallbackResult>;
  close(): void;
}

export function startCallbackServer(expectedState: string): Promise<CallbackServerHandle> {
  return new Promise((resolveStart, rejectStart) => {
    let resolver: ((r: CallbackResult) => void) | null = null;
    let rejecter: ((e: Error) => void) | null = null;
    let resolved = false;

    const settleResolve = (r: CallbackResult): void => {
      if (resolved || !resolver) return;
      resolved = true;
      resolver(r);
    };
    const settleReject = (e: Error): void => {
      if (resolved || !rejecter) return;
      resolved = true;
      rejecter(e);
    };

    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/cb')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const reqUrl = new URL(req.url, 'http://127.0.0.1');
      const session_token = reqUrl.searchParams.get('session_token') ?? '';
      const state = reqUrl.searchParams.get('state') ?? '';
      const error = reqUrl.searchParams.get('error') ?? '';
      const error_description = reqUrl.searchParams.get('error_description') ?? '';

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

      if (error) {
        res.end(renderErrorHtml(error_description || error));
        settleReject(new Error(error_description || error));
        return;
      }
      if (state !== expectedState) {
        res.end(renderErrorHtml('登录校验失败（state mismatch），请重试'));
        settleReject(new Error('state mismatch (possible CSRF)'));
        return;
      }
      if (!session_token) {
        res.end(renderErrorHtml('未拿到登录凭据，请重试'));
        settleReject(new Error('no session_token in callback'));
        return;
      }
      res.end(renderSuccessHtml());
      settleResolve({ session_token, state });
    });

    server.on('error', (err) => {
      if (!resolved) rejectStart(err);
    });

    // listen(0, '127.0.0.1') — OS picks a free port, never binds public.
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolveStart({
        port,
        waitForCallback: (timeoutMs: number) =>
          new Promise<CallbackResult>((resolve, reject) => {
            resolver = resolve;
            rejecter = reject;
            const t = setTimeout(() => {
              if (!resolved) {
                settleReject(new Error('callback server timed out'));
              }
            }, timeoutMs);
            // Make sure the timer doesn't keep Node alive after close().
            t.unref?.();
          }),
        close: () => {
          try {
            server.close();
          } catch {
            /* ignore */
          }
        },
      });
    });
  });
}

function renderSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>登录成功</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center;
    background: #0a0a0a; color: #ececec; }
  .card { text-align: center; padding: 40px; }
  .check { font-size: 48px; color: #4ec9b0; margin-bottom: 16px; }
  h2 { font-weight: 500; margin: 0 0 12px; }
  p { opacity: 0.7; margin: 0; font-size: 14px; }
</style></head>
<body><div class="card">
  <div class="check">✓</div>
  <h2>登录成功</h2>
  <p>可以关闭此页面，应用窗口正在打开</p>
</div></body></html>`;
}

function renderErrorHtml(message: string): string {
  const safe = String(message).replace(/[<>&"]/g, (ch) => {
    switch (ch) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      default: return ch;
    }
  });
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>登录失败</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center;
    background: #0a0a0a; color: #ececec; }
  .card { text-align: center; padding: 40px; max-width: 480px; }
  .x { font-size: 48px; color: #f14c4c; margin-bottom: 16px; }
  h2 { font-weight: 500; margin: 0 0 12px; }
  p { opacity: 0.8; margin: 0; font-size: 14px; word-break: break-word; }
</style></head>
<body><div class="card">
  <div class="x">✕</div>
  <h2>登录失败</h2>
  <p>${safe}</p>
</div></body></html>`;
}

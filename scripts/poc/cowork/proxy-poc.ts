#!/usr/bin/env tsx
/**
 * Cowork P3-B-0 — 宿主代理 POC(宿主本地层,不碰 VM)。
 *
 * 验证宿主代理注入 token 方案的三个假设里的两个半:
 *   ① claude 二进制接受本地明文 http:// base_url(会不会强制 https?)
 *   ③ 一次性 token 校验 + 剥离 + 注入真凭证的闭环
 *   ②(部分)HTTP/SSE 流经代理转发不破坏流(此处是宿主本地转发,vsock 跳留给 Layer 2)
 *
 * 拓扑:
 *   darwin claude ──http──▶ 127.0.0.1:8788(本 POC 代理)──https──▶ 真 base_url
 *     base_url=http://127.0.0.1:8788          校验+剥一次性token+注入真key
 *     ANTHROPIC_API_KEY=<一次性token>          (真 key 只在本进程内存)
 *
 * 用法:CLAUDE_GUI_SECRET_KEY=<hex> npx tsx scripts/poc/cowork/proxy-poc.ts [providerId]
 * 真 key 经 resolveProvider 从 DB 密文解出(需带 secret key);绝不打印真 key。
 */
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveProvider, toClaudeCodeEnv } from '../../../src/lib/provider-resolver';

const PROVIDER_ID = process.argv[2] || 'managed-3373ece4-c8c0-4cf5-b6cb-d18aa3bba53c';
const PROXY_PORT = 8788;
const ONESHOT = 'oneshot-poc-' + '0'.repeat(24); // 固定值即可(POC);产品化会按会话签发

// 真凭证:经完整 managed env 组装(含 role models),只取 base_url + key 给代理注入
const resolved = resolveProvider({ providerId: PROVIDER_ID });
const fullEnv = toClaudeCodeEnv(process.env as Record<string, string>, resolved);
const REAL_KEY = fullEnv.ANTHROPIC_API_KEY || fullEnv.ANTHROPIC_AUTH_TOKEN || '';
const REAL_BASE = fullEnv.ANTHROPIC_BASE_URL || '';
const AUTH_STYLE = fullEnv.ANTHROPIC_AUTH_TOKEN ? 'auth_token' : 'api_key';

if (!REAL_KEY || !REAL_BASE) {
  console.error(`[poc] no real credentials resolved for ${PROVIDER_ID} (base=${REAL_BASE || 'empty'}, key=${REAL_KEY ? 'present' : 'EMPTY'}). Need CLAUDE_GUI_SECRET_KEY to decrypt.`);
  process.exit(2);
}
console.log(`[poc] resolved provider ${PROVIDER_ID}: base=${REAL_BASE}, authStyle=${AUTH_STYLE}, key=***(${REAL_KEY.length} chars)`);

let proxySawRequest = false;
let proxyInjected = false;

const server = http.createServer((req, res) => {
  // ── 校验一次性 token(证明请求来自我们注入的 claude)──
  const xApiKey = req.headers['x-api-key'];
  const auth = req.headers['authorization'];
  const tokenOk = xApiKey === ONESHOT || auth === `Bearer ${ONESHOT}`;
  proxySawRequest = true;
  if (!tokenOk) {
    console.error(`[poc-proxy] REJECT: request without valid one-shot token (x-api-key=${xApiKey ? 'set' : 'unset'}, auth=${auth ? 'set' : 'unset'})`);
    res.writeHead(401); res.end('invalid one-shot token'); return;
  }

  // ── 剥一次性 token,注入真凭证 ──
  const target = new URL(req.url || '/', REAL_BASE);
  const headers: Record<string, string | string[]> = { ...req.headers } as Record<string, string | string[]>;
  if (headers['x-api-key'] === ONESHOT) headers['x-api-key'] = REAL_KEY;
  if (headers['authorization'] === `Bearer ${ONESHOT}`) headers['authorization'] = `Bearer ${REAL_KEY}`;
  headers['host'] = target.host;
  proxyInjected = true;
  console.log(`[poc-proxy] ${req.method} ${target.pathname} → ${target.host}  (one-shot token → real key injected)`);

  const preq = https.request(
    { hostname: target.hostname, port: 443, path: target.pathname + target.search, method: req.method, headers },
    (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res); // SSE 流式回传(不缓冲)
    },
  );
  preq.on('error', (e) => { console.error('[poc-proxy] upstream error:', e.message); res.writeHead(502); res.end(String(e)); });
  req.pipe(preq);
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[poc-proxy] listening on http://127.0.0.1:${PROXY_PORT} → ${REAL_BASE}`);
  void runClaude();
});

async function runClaude(): Promise<void> {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-poc-ws-'));
  // claude 的 env:真 base_url/key 换成代理版 + 一次性 token(真 key 不进 claude 环境)
  const claudeEnv: Record<string, string> = {
    ...fullEnv,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PROXY_PORT}`,
  };
  if (AUTH_STYLE === 'auth_token') { claudeEnv.ANTHROPIC_AUTH_TOKEN = ONESHOT; }
  else { claudeEnv.ANTHROPIC_API_KEY = ONESHOT; }

  console.log(`[poc] spawning darwin claude with base_url=http://127.0.0.1:${PROXY_PORT}, token=<one-shot>`);
  let replyText = '';
  let sawResult = false;
  let isError = false;
  try {
    for await (const msg of query({
      prompt: 'Reply with exactly the token BRIDGE_OK and nothing else.',
      options: {
        model: resolved.roleModels.default || 'sonnet',
        cwd: ws,
        env: claudeEnv,
        permissionMode: 'bypassPermissions',
        maxTurns: 1,
      },
    })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') replyText += block.text;
        }
      } else if (msg.type === 'result') {
        sawResult = true;
        isError = (msg as { is_error?: boolean }).is_error === true;
      }
    }
  } catch (e) {
    console.error('[poc] query threw:', e instanceof Error ? e.message : e);
  }

  console.log('\n════════ POC RESULT ════════');
  console.log(`assumption ① claude accepts http:// base_url : ${proxySawRequest ? 'PASS (claude reached the http proxy)' : 'FAIL (proxy saw no request — claude rejected http base_url?)'}`);
  console.log(`assumption ③ one-shot token → real key inject : ${proxyInjected ? 'PASS (token validated, real key injected)' : 'FAIL'}`);
  console.log(`assumption ② HTTP/SSE stream through proxy    : ${sawResult && !isError ? 'PASS (full turn completed via proxy)' : 'FAIL/PARTIAL'}`);
  console.log(`claude reply: ${JSON.stringify(replyText.trim())}  | result=${sawResult} is_error=${isError}`);
  console.log('════════════════════════════');
  fs.rmSync(ws, { recursive: true, force: true });
  server.close();
  process.exit(sawResult && !isError && proxyInjected ? 0 : 1);
}

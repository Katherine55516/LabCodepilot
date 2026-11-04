#!/usr/bin/env python3
"""本地「换临时 token」mock + 选择性代理，供客户端语音输入功能在 dev 下联调。

真实服务端实现规格见 docs/handover/voice-input-server.md。

dev 模式 getBackendBase() = http://localhost:8080，登录/账号体系也走这个地址。
为避免 mock 霸占 8080 把登录截断，本服务做「选择性代理」：
  - POST /api/v1/asr/token            → 本地用真 DASHSCOPE_API_KEY 向百炼换 token（30min）
  - GET  /auth/...（浏览器登录入口）  → 302 跳到真实后端（浏览器去真后端做 OAuth，回调仍到 127.0.0.1）
  - 其余一切（/api/v1/me、/configs、logout…）→ 服务端转发到真实后端，原样带回（含 Authorization）
这样 dev 里「登录 + 语音」可同时正常工作，客户端零改动。

⚠️ 仅本地开发使用，切勿提交真实 key。
用法：
    DASHSCOPE_API_KEY=sk-xxx python3 scripts/dev/mock-asr-token-server.py
监听（默认）http://localhost:8080。真实后端默认 https://code-agent.ai-native-lab.com，
可用 REAL_BACKEND 覆盖。纯测语音可不登录，直接点麦克风即可。
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_KEY = os.environ.get('DASHSCOPE_API_KEY')
PORT = int(os.environ.get('MOCK_PORT', '8080'))
REAL_BACKEND = os.environ.get('REAL_BACKEND', 'https://code-agent.ai-native-lab.com').rstrip('/')
TTL = 1800  # ⚠️ 必须走 query string，放 body 会被忽略只给 60s
DASHSCOPE_TOKENS_URL = f'https://dashscope.aliyuncs.com/api/v1/tokens?expire_in_seconds={TTL}'
# 服务端下发给客户端的「模型名 + WS 地址」（真实服务端同样应从自己的配置下发，客户端不硬编码）
ASR_MODEL = os.environ.get('ASR_MODEL', 'qwen3-asr-flash-realtime-2026-02-10')
ASR_WS_URL = os.environ.get('ASR_WS_URL', 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime')

# 不转发的逐跳 / 由 urllib 自行管理的头
HOP_BY_HOP = {'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding',
              'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'accept-encoding'}


def mint_token():
    req = urllib.request.Request(
        DASHSCOPE_TOKENS_URL,
        method='POST',
        headers={'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    return {'token': data['token'], 'expiresAt': data['expires_at'], 'model': ASR_MODEL, 'wsUrl': ASR_WS_URL}


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self, method):
        """把请求服务端转发到真实后端，原样带回响应（保留 Authorization 等头）。"""
        target = REAL_BACKEND + self.path
        length = int(self.headers.get('Content-Length', 0) or 0)
        body = self.rfile.read(length) if length else None
        fwd_headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        req = urllib.request.Request(target, data=body, method=method, headers=fwd_headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                self._relay(resp)
        except urllib.error.HTTPError as e:   # 4xx/5xx：把真后端的状态码 + body 原样带回
            self._relay(e)
        except Exception as e:                # noqa: BLE001
            print(f'[mock][proxy] {method} {self.path} → {REAL_BACKEND} error: {e}', flush=True)
            self._json(502, {'error': 'mock_proxy_upstream_error', 'detail': str(e)})

    def _relay(self, resp):
        data = resp.read()
        self.send_response(resp.status if hasattr(resp, 'status') else resp.code)
        ct = resp.headers.get('Content-Type')
        if ct:
            self.send_header('Content-Type', ct)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.split('?')[0] == '/api/v1/asr/token':
            try:
                out = mint_token()
                print(f'[mock] minted ASR token, ttl≈{out["expiresAt"] - int(time.time())}s', flush=True)
                self._json(200, out)
            except urllib.error.HTTPError as e:
                print(f'[mock] dashscope HTTPError {e.code}: {e.read()[:200]!r}', flush=True)
                self._json(502, {'error': 'upstream_error'})
            except Exception as e:  # noqa: BLE001
                print(f'[mock] error: {e}', flush=True)
                self._json(503, {'error': 'upstream_error'})
            return
        self._proxy('POST')

    def do_GET(self):
        # 浏览器登录入口：302 跳真实后端（OAuth 在真后端完成，回调仍到 127.0.0.1 本地）
        if self.path.startswith('/auth/'):
            self.send_response(302)
            self.send_header('Location', REAL_BACKEND + self.path)
            self.end_headers()
            print(f'[mock] redirect login {self.path} → {REAL_BACKEND}', flush=True)
            return
        self._proxy('GET')

    def do_PUT(self):
        self._proxy('PUT')

    def do_DELETE(self):
        self._proxy('DELETE')

    def log_message(self, *args):  # 静默 http.server 默认行日志
        pass


if __name__ == '__main__':
    if not API_KEY:
        print('ERROR: 请设置环境变量 DASHSCOPE_API_KEY', file=sys.stderr)
        sys.exit(1)
    print(f'[mock] ASR token + 代理服务 → http://localhost:{PORT}', flush=True)
    print(f'[mock]   /api/v1/asr/token 本地换百炼 token(TTL={TTL}s)；其余转发到 {REAL_BACKEND}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

#!/usr/bin/env python3
"""本地模拟「自建服务端」的换临时 token 接口，供客户端语音输入功能联调用。

真实服务端实现规格见 docs/handover/voice-input-server.md。
本脚本只做一件事：收到 POST /api/v1/asr/token → 用真 DASHSCOPE_API_KEY 向百炼
换一个 30 分钟临时 token → 返回 {token, expiresAt}。客户端拿它直连百炼。

⚠️ 仅本地开发使用，切勿提交真实 key。
用法：
    DASHSCOPE_API_KEY=sk-xxx python3 scripts/dev/mock-asr-token-server.py
监听（默认）http://localhost:8080 —— 与 electron dev 的 getBackendBase() 默认一致。
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
TTL = 1800  # ⚠️ 必须走 query string，放 body 会被忽略只给 60s
DASHSCOPE_TOKENS_URL = f'https://dashscope.aliyuncs.com/api/v1/tokens?expire_in_seconds={TTL}'


def mint_token():
    req = urllib.request.Request(
        DASHSCOPE_TOKENS_URL,
        method='POST',
        headers={'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    return {'token': data['token'], 'expiresAt': data['expires_at']}


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.split('?')[0] != '/api/v1/asr/token':
            return self._json(404, {'error': 'not_found'})
        try:
            out = mint_token()
            print(f'[mock] minted token, ttl≈{out["expiresAt"] - int(time.time())}s', flush=True)
            self._json(200, out)
        except urllib.error.HTTPError as e:
            print(f'[mock] dashscope HTTPError {e.code}: {e.read()[:200]!r}', flush=True)
            self._json(502, {'error': 'upstream_error'})
        except Exception as e:  # noqa: BLE001
            print(f'[mock] error: {e}', flush=True)
            self._json(503, {'error': 'upstream_error'})

    # 客户端无登录态时 apiRequest 仍可能探活其它 /api 路径，返回 401 让其优雅降级。
    def do_GET(self):
        self._json(401, {'error': 'unauthorized'})

    def log_message(self, *args):  # 静默 http.server 默认行日志
        pass


if __name__ == '__main__':
    if not API_KEY:
        print('ERROR: 请设置环境变量 DASHSCOPE_API_KEY', file=sys.stderr)
        sys.exit(1)
    print(f'[mock] ASR token server → http://localhost:{PORT}/api/v1/asr/token (POST, TTL={TTL}s)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

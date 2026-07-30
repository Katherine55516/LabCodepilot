#!/usr/bin/env python3
"""
凭证注入代理(R3,方案 A)—— docker 场景的 sidecar 容器版(替代 P3-B 的宿主代理)。

为什么是 sidecar 容器而非宿主进程(RD6):docker 里"容器→宿主网关"的可达性
不可靠(企业防火墙、k8s/kube-router 残留 iptables 都可能堵死;验证 VM 实测
容器→宿主任何 IP 全超时)。容器↔容器(同 docker 网络)是 docker 自身保证的
稳定路径。故代理下沉为一个可信 sidecar 容器,与会话容器同处专用网络 cowork-net。

威胁模型不变(与 P3-B 等价):真 key 只在本代理容器(可信,不跑 agent、不碰
不可信文件)的 tmpfs;会话容器里的 claude 只拿按会话签发的一次性 cwk_ token。
提示注入让 agent 读自己 env 也只偷到 token;token 随会话删除废止。

拓扑:
  会话容器 claude ──http──▶ cowork-proxy:8791(本代理)──http(s)──▶ 真 base_url
    ANTHROPIC_BASE_URL=http://cowork-proxy:8791     校验 token→剥→注入真 key→转发
    ANTHROPIC_API_KEY=cwk_<随机>                     (真 key 只在本容器 tmpfs)

凭证注入路径(不走网络、不落宿主盘):cowork-server(宿主进程)收到 /cred REST
→ docker exec 本容器,把 {token,realKey,realBase,authStyle} 经 stdin 写进
/creds/<token>.json(容器 tmpfs)。本代理每请求读对应 token 文件(tmpfs,快)。
revoke = docker exec rm 该文件。

隔离:只有 cowork-net 内的容器能访问本代理(网络隔离)+ token 校验(主闸)。
R4 出网禁内网的 DOCKER-USER 规则针对会话容器,须放行会话容器→本代理。
"""
import json
import os
import http.server
import socketserver
import urllib.request
import urllib.error

PORT = int(os.environ.get("COWORK_PROXY_PORT", "8791"))
CREDS_DIR = os.environ.get("COWORK_CREDS_DIR", "/creds")


def load_cred(token):
    # token 直接当文件名会有路径穿越风险 → 只接受 cwk_ 十六进制,杜绝 ../。
    if not token or not token.startswith("cwk_") or not token[4:].isalnum():
        return None
    path = os.path.join(CREDS_DIR, token + ".json")
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # 不打日志:URL/头可能带敏感信息;审计在宿主侧 cowork-audit 做

    def _reject(self, code, msg):
        body = msg.encode()
        self.send_response(code)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self):
        # 一次性 token:claude 按 env 放 x-api-key 或 Authorization: Bearer
        presented = self.headers.get("x-api-key")
        if not presented:
            auth = self.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                presented = auth[7:]
        cred = load_cred(presented) if presented else None
        if not cred:
            # claude 会发个别无 auth 的预检 → 401 容错重试(P3-B-0 已验)
            self._reject(401, "invalid or missing one-shot token")
            return

        length = int(self.headers.get("content-length", 0) or 0)
        body = self.rfile.read(length) if length else b""

        real_base = cred["realBase"].rstrip("/")
        target = real_base + self.path
        # 剥一次性 token,注入真凭证,转发真 base_url
        fwd_headers = {}
        for k, v in self.headers.items():
            lk = k.lower()
            if lk in ("x-api-key", "authorization", "host", "content-length", "connection"):
                continue
            fwd_headers[k] = v
        if cred.get("authStyle") == "auth_token":
            fwd_headers["authorization"] = "Bearer " + cred["realKey"]
        else:
            fwd_headers["x-api-key"] = cred["realKey"]

        req = urllib.request.Request(target, data=body, method=self.command, headers=fwd_headers)
        try:
            with urllib.request.urlopen(req, timeout=600) as up:
                self.send_response(up.status)
                hop = ("transfer-encoding", "connection", "keep-alive")
                sent_len = False
                for k, v in up.headers.items():
                    if k.lower() in hop:
                        continue
                    if k.lower() == "content-length":
                        sent_len = True
                    self.send_header(k, v)
                # 上游分块(SSE 无 content-length)时用 chunked 回给客户端
                if not sent_len:
                    self.send_header("transfer-encoding", "chunked")
                self.end_headers()
                self._pump(up, chunked=not sent_len)
        except urllib.error.HTTPError as e:
            # 把上游错误状态/体透传(claude 依赖 429/400 语义)
            body = e.read()
            self.send_response(e.code)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:  # noqa: BLE001 上游不可达
            self._reject(502, "upstream error: " + str(e)[:100])

    def _pump(self, up, chunked):
        while True:
            chunk = up.read(65536)
            if not chunk:
                break
            if chunked:
                self.wfile.write(b"%X\r\n%s\r\n" % (len(chunk), chunk))
            else:
                self.wfile.write(chunk)
            self.wfile.flush()
        if chunked:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()

    def do_GET(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()


class ThreadingHTTP(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    os.makedirs(CREDS_DIR, exist_ok=True)
    ThreadingHTTP(("0.0.0.0", PORT), Handler).serve_forever()

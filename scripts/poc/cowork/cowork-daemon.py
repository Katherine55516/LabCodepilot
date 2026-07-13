#!/usr/bin/env python3
"""
cowork-daemon — guest 侧 vsock RPC 守护进程(Cowork 沙箱 P1-C)。

在 VM 内监听 AF_VSOCK 端口(默认 1024),取代 SSH 成为宿主↔guest 的
唯一运行时通道。每条宿主连接 = 一个请求:首行 `\n` 结尾的 JSON 头声明
op,之后按 op 语义收发。vfkit 是透明字节代理(无握手、无魔数),协议
完全由本文件与宿主客户端约定。

依赖:仅 Python3 标准库(Debian 云镜像自带,socket.AF_VSOCK 见 3.7+)。
安全:sessionId 强制 hex 校验;readFile 经 realpath + workspace 前缀判定
防逃逸;写入文件名 basename + 白名单清洗。

协议(每连接首行 JSON header + 换行):
  {"op":"health"}                                  -> {"ok":true}\n
  {"op":"mkdirWorkspace","sessionId":"..."}        -> {"ok":true,"path":"..."}\n
  {"op":"writeFile","sessionId","name","size":N}   -> 读 N 字节 -> {"ok":true,"path":"..."}\n
  {"op":"listFiles","sessionId","since":ms}        -> {"ok":true,"files":[{path,name,size,mtime}]}\n
  {"op":"readFile","sessionId","path":"..."}       -> {"ok":true,"size":N}\n + N 字节
  {"op":"archive","sessionId"}                     -> {"ok":true,"size":N}\n + N 字节(tar.gz)
  {"op":"removeSession","sessionId"}               -> {"ok":true}\n
  {"op":"exec","sessionId","argv":[...],"env":{}}  -> 裸双向管道(stdin<->stdout),无 header 响应
  错误一律 -> {"ok":false,"error":"..."}\n
"""
import json
import os
import re
import shlex
import socket
import subprocess
import sys
import threading
import time

PORT = int(os.environ.get("COWORK_VSOCK_PORT", "1024"))
SESSIONS_ROOT = "/home/agent/sessions"
CLAUDE_BIN = os.path.expanduser("~/bin/claude")
HEX_RE = re.compile(r"^[a-fA-F0-9]{8,64}$")
SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._一-鿿-]")


def workspace(session_id):
    if not HEX_RE.match(session_id or ""):
        raise ValueError("invalid sessionId")
    return os.path.join(SESSIONS_ROOT, session_id, "workspace")


def read_header(conn):
    """读到第一个换行为止,返回解析后的 dict 与剩余已读字节(exec 用不到)。"""
    buf = bytearray()
    while b"\n" not in buf:
        chunk = conn.recv(4096)
        if not chunk:
            raise EOFError("connection closed before header")
        buf.extend(chunk)
    line, _, rest = bytes(buf).partition(b"\n")
    return json.loads(line.decode("utf-8")), rest


def send_json(conn, obj):
    conn.sendall((json.dumps(obj) + "\n").encode("utf-8"))


def recv_exact(conn, n, prefix=b""):
    buf = bytearray(prefix)
    while len(buf) < n:
        chunk = conn.recv(min(65536, n - len(buf)))
        if not chunk:
            raise EOFError("connection closed mid-body")
        buf.extend(chunk)
    return bytes(buf[:n]), bytes(buf[n:])


def op_health(conn, req, rest):
    send_json(conn, {"ok": True})


def op_mkdir(conn, req, rest):
    ws = workspace(req["sessionId"])
    os.makedirs(ws, exist_ok=True)
    send_json(conn, {"ok": True, "path": ws})


def op_write_file(conn, req, rest):
    ws = workspace(req["sessionId"])
    os.makedirs(ws, exist_ok=True)
    safe = SAFE_NAME_RE.sub("_", os.path.basename(req["name"]))
    dest = os.path.join(ws, safe)
    size = int(req["size"])
    data, _ = recv_exact(conn, size, rest)
    with open(dest, "wb") as f:
        f.write(data)
    send_json(conn, {"ok": True, "path": dest})


def op_list_files(conn, req, rest):
    ws = workspace(req["sessionId"])
    since_ms = int(req.get("since", 0))
    files = []
    if os.path.isdir(ws):
        for root, _dirs, names in os.walk(ws):
            for name in names:
                p = os.path.join(root, name)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                mtime_ms = int(st.st_mtime * 1000)
                if mtime_ms >= since_ms:
                    files.append({"path": p, "name": name, "size": st.st_size, "mtime": mtime_ms})
    files.sort(key=lambda f: f["name"])
    send_json(conn, {"ok": True, "files": files})


def _assert_in_ws(session_id, path):
    ws = workspace(session_id)
    real = os.path.realpath(path)
    if real != ws and not real.startswith(ws + os.sep):
        raise ValueError("path escapes session workspace")
    if not os.path.isfile(real):
        raise FileNotFoundError(real)
    return real


def op_read_file(conn, req, rest):
    real = _assert_in_ws(req["sessionId"], req["path"])
    size = os.path.getsize(real)
    send_json(conn, {"ok": True, "size": size})
    with open(real, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            conn.sendall(chunk)


def op_archive(conn, req, rest):
    ws = workspace(req["sessionId"])
    tmp = "/tmp/cowork-archive-%s.tgz" % req["sessionId"]
    subprocess.run(["tar", "czf", tmp, "-C", ws, "."], check=True)
    try:
        size = os.path.getsize(tmp)
        send_json(conn, {"ok": True, "size": size})
        with open(tmp, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                conn.sendall(chunk)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def op_remove_session(conn, req, rest):
    session_id = req["sessionId"]
    if not HEX_RE.match(session_id or ""):
        raise ValueError("invalid sessionId")
    subprocess.run(["rm", "-rf", os.path.join(SESSIONS_ROOT, session_id)], check=False)
    send_json(conn, {"ok": True})


def op_exec(conn, req, rest):
    """spawn claude,裸双向管道:conn<->stdin/stdout。stderr 落 guest 日志(保 stream-json 纯净)。"""
    ws = workspace(req["sessionId"])
    os.makedirs(ws, exist_ok=True)
    argv = req.get("argv", [])
    env = dict(os.environ)
    env.update(req.get("env", {}))
    err_log = open("/tmp/cowork-exec-%s.err" % req["sessionId"], "ab")
    proc = subprocess.Popen(
        [CLAUDE_BIN] + argv, cwd=ws, env=env,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err_log,
    )
    err_log.close()

    alive = {"v": True}

    def pump_in():
        # 首帧 header 之后可能已带少量 stdin 字节(rest),先灌进去
        try:
            if rest:
                proc.stdin.write(rest)
                proc.stdin.flush()
            while alive["v"]:
                data = conn.recv(65536)
                if not data:
                    break
                proc.stdin.write(data)
                proc.stdin.flush()
        except (OSError, ValueError):
            pass
        finally:
            try:
                proc.stdin.close()
            except OSError:
                pass

    def pump_out():
        # 关键:必须用 os.read(fd) 增量读 —— proc.stdout.read(N) 会阻塞到攒够 N
        # 字节或进程退出,把 stream-json 的小块增量全缓冲住,SDK 等不到 init
        # 响应 → claude 挂死。os.read 返回当前可用字节,真正流式转发。
        fd = proc.stdout.fileno()
        try:
            while True:
                data = os.read(fd, 65536)
                if not data:
                    break
                conn.sendall(data)
        except (OSError, ValueError):
            pass

    t_in = threading.Thread(target=pump_in, daemon=True)
    t_out = threading.Thread(target=pump_out, daemon=True)
    t_in.start()
    t_out.start()
    proc.wait()
    alive["v"] = False
    t_out.join(timeout=2)
    try:
        conn.shutdown(socket.SHUT_WR)
    except OSError:
        pass


OPS = {
    "health": op_health,
    "mkdirWorkspace": op_mkdir,
    "writeFile": op_write_file,
    "listFiles": op_list_files,
    "readFile": op_read_file,
    "archive": op_archive,
    "removeSession": op_remove_session,
    "exec": op_exec,
}


def handle(conn):
    try:
        req, rest = read_header(conn)
        op = OPS.get(req.get("op"))
        if op is None:
            send_json(conn, {"ok": False, "error": "unknown op: %s" % req.get("op")})
            return
        op(conn, req, rest)
    except Exception as e:  # noqa: BLE001 — 任何异常都回一条错误,别把连接吊死
        try:
            send_json(conn, {"ok": False, "error": str(e)[:200]})
        except OSError:
            pass
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main():
    s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((socket.VMADDR_CID_ANY, PORT))
    s.listen(128)
    sys.stderr.write("cowork-daemon listening on vsock:%d\n" % PORT)
    sys.stderr.flush()
    while True:
        conn, _ = s.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    main()

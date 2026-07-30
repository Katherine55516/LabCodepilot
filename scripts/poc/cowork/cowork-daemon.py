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
  {"op":"health"}                                  -> {"ok":true,"version":N,"claude":bool}\n
  {"op":"mkdirWorkspace","sessionId":"..."}        -> {"ok":true,"path":"..."}\n
  {"op":"writeFile","sessionId","name","size":N}   -> 读 N 字节 -> {"ok":true,"path":"..."}\n
  {"op":"installBinary","name","size":N}           -> 读 N 字节 -> {"ok":true,"path":"..."}\n
  {"op":"listFiles","sessionId","since":ms}        -> {"ok":true,"files":[{path,name,size,mtime}]}\n
  {"op":"readFile","sessionId","path":"..."}       -> {"ok":true,"size":N}\n + N 字节
  {"op":"archive","sessionId"}                     -> {"ok":true,"size":N}\n + N 字节(tar.gz)
  {"op":"removeSession","sessionId"}               -> {"ok":true}\n
  {"op":"exec","sessionId","argv":[...],"env":{}}  -> 裸双向管道(stdin<->stdout),无 header 响应
  错误一律 -> {"ok":false,"error":"..."}\n

版本纪律(镜像流水线 M1):本文件经 cloud-init seed 首启注入(write_files 是
per-instance 语义)。**改本文件必须同步 bump DAEMON_VERSION,并 bump 宿主侧
cowork-seed.ts 的 SEED_TEMPLATE_VERSION**(instance-id 变化才会让已有磁盘重跑
cloud-init 拿到新版)。宿主 EXPECTED_DAEMON_VERSION 有跨层单测锁定。
"""
import json
import os
import re
import shlex
import socket
import pwd
import subprocess
import sys
import threading
import time

DAEMON_VERSION = 4

PORT = int(os.environ.get("COWORK_VSOCK_PORT", "1024"))
SESSIONS_ROOT = "/home/agent/sessions"
CLAUDE_BIN = os.path.expanduser("~/bin/claude")
# installBinary 的 name 白名单:只认逻辑名,绝不接受路径
INSTALL_TARGETS = {"claude": CLAUDE_BIN}
HEX_RE = re.compile(r"^[a-fA-F0-9]{8,64}$")
SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._一-鿿-]")


# ── P3-A 每会话非特权用户 ─────────────────────────────────────────────
# daemon 以 root 跑(seed v3 systemd User=root);exec claude 时降权到会话
# 专属 Linux 用户 cw_<id[:12]>,workspace/home 目录 chown 给它 + chmod 700 —
# 会话 B 的 claude 从文件系统权限层面就穿不过会话 A 的目录(<id> 700 属 A)。
# 文件 op(mkdir/write/list/read/archive)仍由 daemon(root)执行,root 无视
# 权限,上传下载/对账不受影响。daemon 非 root 时 Popen(user=) 会抛错 —— 这是
# fail-secure:绝不静默降级到不隔离(daemon v4 只随 seed v3 root 出现)。

def session_user(session_id):
    if not HEX_RE.match(session_id or ""):
        raise ValueError("invalid sessionId")
    return "cw_" + session_id[:12]


def ensure_session_user(session_id):
    """幂等建会话专属系统账号(无家目录、nologin),返回用户名。"""
    name = session_user(session_id)
    try:
        pwd.getpwnam(name)
        return name
    except KeyError:
        pass
    subprocess.run(["useradd", "-M", "-r", "-s", "/usr/sbin/nologin", name], check=False)
    pwd.getpwnam(name)  # 确认建成;失败抛 KeyError → 上层回错误
    return name


def prepare_session_fs(session_id, name):
    """建会话目录树(workspace + home),归会话用户,700 阻断兄弟会话穿越。"""
    base = os.path.join(SESSIONS_ROOT, session_id)
    ws = os.path.join(base, "workspace")
    home = os.path.join(base, "home")
    os.makedirs(ws, exist_ok=True)
    os.makedirs(home, exist_ok=True)
    subprocess.run(["chown", "-R", "%s:%s" % (name, name), base], check=False)
    os.chmod(base, 0o700)   # <id> 700 → 兄弟会话用户无 x,穿不过
    os.chmod(ws, 0o700)
    os.chmod(home, 0o700)
    return ws, home


def delete_session_user(session_id):
    try:
        subprocess.run(["userdel", session_user(session_id)], check=False)
    except ValueError:
        pass


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
    # version:宿主一致性哨兵;claude:执行面就绪(缺则宿主 installBinary 推入);
    # claudeSize(v3):宿主比对自家 binary 大小,不符则重推 —— app 升级 SDK 后
    # guest 旧 binary 的版本偏斜自愈。一次探测拿全就绪信息,省一轮 RPC。
    claude_ready = os.path.isfile(CLAUDE_BIN) and os.access(CLAUDE_BIN, os.X_OK)
    claude_size = os.path.getsize(CLAUDE_BIN) if claude_ready else 0
    # uid(v4):宿主据此确认 daemon 已提权 root —— 升级重灌时 daemon 可能先以
    # 旧 unit(User=agent)开机自启,cloud-init runcmd 的 restart 才提权到 root。
    # 宿主必须等 uid==0 才开跑回合(否则 exec setuid 降权失败,claude 秒退)。
    send_json(conn, {"ok": True, "version": DAEMON_VERSION, "claude": claude_ready, "claudeSize": claude_size, "uid": os.geteuid()})


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


def op_install_binary(conn, req, rest):
    """宿主推可执行资产(M1:claude binary,~250MB)。与 op_write_file 的区别:
    流式 recv 直写 .part 文件(大文件不进内存,VM 只有 2GB RAM),完成后
    chmod + os.replace 原子替换 —— exec 并发读到半个 binary 的窗口不存在。"""
    target = INSTALL_TARGETS.get(req.get("name") or "")
    if not target:
        raise ValueError("unknown binary name")
    size = int(req["size"])
    os.makedirs(os.path.dirname(target), exist_ok=True)
    tmp = target + ".part"
    remaining = size
    head = bytes(rest[:size]) if rest else b""
    with open(tmp, "wb") as f:
        if head:
            f.write(head)
            remaining -= len(head)
        while remaining > 0:
            chunk = conn.recv(min(65536, remaining))
            if not chunk:
                raise EOFError("connection closed mid-body")
            f.write(chunk)
            remaining -= len(chunk)
    os.chmod(tmp, 0o755)
    os.replace(tmp, target)
    send_json(conn, {"ok": True, "path": target})


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
    delete_session_user(session_id)  # P3-A:会话用户随会话删(best-effort)
    send_json(conn, {"ok": True})


def op_reconcile_sessions(conn, req, rest):
    """删除 SESSIONS_ROOT 下不在 keep 名单里的孤儿会话目录(E4.1 存储对账)。

    宿主删除会话时的 removeSession 是 best-effort:VM 休眠期间删除的会话
    会留下孤儿目录,长期累积会占满 guest 磁盘。宿主在 VM 每次就绪后带全量
    现存会话 id 调用本 op。只动名字匹配 HEX_RE 的目录 —— 非会话形状的路径
    (调试残留等)一律不碰;keep 为空集合时同样照删(表示 DB 里已无会话)。
    """
    keep = set(req.get("keep") or [])
    removed = []
    if os.path.isdir(SESSIONS_ROOT):
        for name in os.listdir(SESSIONS_ROOT):
            if not HEX_RE.match(name):
                continue
            if name in keep:
                continue
            subprocess.run(["rm", "-rf", os.path.join(SESSIONS_ROOT, name)], check=False)
            delete_session_user(name)  # P3-A:孤儿会话用户随目录清(防 uid 累积)
            removed.append(name)
    send_json(conn, {"ok": True, "removed": removed})


def op_exec(conn, req, rest):
    """
    spawn claude,双向管道。stdin 方向做 [uint32 BE 长度][字节] 帧封装 + 长度 0
    的 EOF 标记 —— 因为 vfkit 透明代理不可靠地传播 TCP 半关闭(host `sock.end()`
    的 FIN 到不了 guest),不能靠 recv 返回空来判定 stdin 结束。SDK 单轮结束时
    关掉 forwarder stdin → forwarder 发长度 0 帧 → 这里关 claude stdin → claude
    见 EOF 退出 → SDK 迭代器结束 → done。stdout 方向保持裸流(量大、要纯净)。
    连接被非正常断开(abort:host 强杀 forwarder)→ 帧读到中途 EOF → 杀 claude。

    P3-A:claude 以会话专属用户降权跑(user=/group=,需 daemon 为 root)。
    HOME 指向会话私有目录(claude 会往 ~ 写配置/会话状态,须可写且隔离)。
    """
    session_id = req["sessionId"]
    name = ensure_session_user(session_id)
    ws, home = prepare_session_fs(session_id, name)
    argv = req.get("argv", [])
    env = dict(os.environ)
    env.update(req.get("env", {}))
    env["HOME"] = home  # 每会话私有 HOME(claude 配置/状态随会话隔离)
    err_log = open("/tmp/cowork-exec-%s.err" % session_id, "ab")
    proc = subprocess.Popen(
        [CLAUDE_BIN] + argv, cwd=ws, env=env, user=name, group=name,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err_log,
    )
    err_log.close()

    state = {"aborted": False, "graceful_eof": False}

    def recv_into(buf, need):
        """确保 buf 至少 need 字节,返回 True;连接断则 False。"""
        while len(buf) < need:
            d = conn.recv(65536)
            if not d:
                return False
            buf.extend(d)
        return True

    def pump_in():
        buf = bytearray(rest)  # header 之后已到达的字节 = 帧流起点
        try:
            while True:
                if not recv_into(buf, 4):
                    state["aborted"] = True
                    return
                length = int.from_bytes(buf[:4], "big")
                del buf[:4]
                if length == 0:
                    state["graceful_eof"] = True  # SDK 关了输入 → 优雅结束
                    return
                if not recv_into(buf, length):
                    state["aborted"] = True
                    return
                proc.stdin.write(bytes(buf[:length]))
                proc.stdin.flush()
                del buf[:length]
        except (OSError, ValueError):
            pass
        finally:
            try:
                proc.stdin.close()  # → claude 见 stdin EOF → 单轮结束后退出
            except OSError:
                pass

    def pump_out():
        # os.read 增量读,真正流式转发(proc.stdout.read(N) 会缓冲住小块增量)
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

    # 若是 abort(连接断,非优雅 EOF),别干等 claude —— 直接杀
    def watch_abort():
        while proc.poll() is None:
            if state["aborted"]:
                try:
                    proc.terminate()
                except OSError:
                    pass
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    try:
                        proc.kill()
                    except OSError:
                        pass
                return
            time.sleep(0.2)

    threading.Thread(target=watch_abort, daemon=True).start()
    proc.wait()
    t_out.join(timeout=2)
    try:
        conn.shutdown(socket.SHUT_WR)
    except OSError:
        pass


OPS = {
    "health": op_health,
    "mkdirWorkspace": op_mkdir,
    "writeFile": op_write_file,
    "installBinary": op_install_binary,
    "listFiles": op_list_files,
    "readFile": op_read_file,
    "archive": op_archive,
    "removeSession": op_remove_session,
    "reconcileSessions": op_reconcile_sessions,
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

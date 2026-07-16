#!/usr/bin/env python3
"""
Cowork 远程容器 POC — 容器内 stdio shim。

server 经  docker exec -i <c> python3 cowork-shim.py -- <claude-argv...>  起本进程。
本进程 stdin 收的是 forwarder 端到端发来的帧流([uint32 BE 长度][字节] + 长度0=EOF),
解帧后喂给容器内 claude 的 stdin;claude stdout 裸流写回本进程 stdout
(→ docker exec → server → TCP → forwarder → SDK)。

为什么容器内要解帧、而不靠 docker exec 的半关闭传 EOF:docker exec/attach 流协议的
stdin EOF 只能靠"关连接写侧"表达,moby 维护者自认该协议 fundamentally flawed
(moby/moby discussions#45414),且要穿 TCP→server→docker API 多层翻译不可信。
零长度帧是应用层带内 EOF 信号(与 Kubernetes 1.31 exec v5 子协议的带内 CLOSE 同构),
可穿过所有中间层可靠传播。这与 cowork-daemon.py 的 op_exec 是同一套机制 —— 本 shim
即其容器版最小子集(去掉 vsock 监听与 setuid:容器边界已做隔离,claude 直接跑)。
"""
import os
import sys
import time
import subprocess
import threading

CLAUDE_BIN = os.environ.get("COWORK_CLAUDE_BIN", "/opt/cowork/claude")


def main():
    # argv:'--' 之后的一切透传给 claude(与 forwarder process.argv.slice(2) 对齐)
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1:]
    else:
        argv = sys.argv[1:]

    proc = subprocess.Popen(
        [CLAUDE_BIN] + argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        env=os.environ.copy(),
    )

    state = {"aborted": False, "graceful_eof": False}
    inb = sys.stdin.buffer

    def read_exact(n):
        buf = bytearray()
        while len(buf) < n:
            d = inb.read(n - len(buf))
            if not d:
                return None  # stdin EOF
            buf += d
        return bytes(buf)

    def pump_in():
        try:
            while True:
                hdr = read_exact(4)
                if hdr is None:
                    state["aborted"] = True  # 非优雅:server/docker exec 断,无零帧
                    return
                length = int.from_bytes(hdr, "big")
                if length == 0:
                    state["graceful_eof"] = True  # SDK 关输入 → 优雅结束
                    return
                payload = read_exact(length)
                if payload is None:
                    state["aborted"] = True
                    return
                proc.stdin.write(payload)
                proc.stdin.flush()
        except (OSError, ValueError):
            pass
        finally:
            try:
                proc.stdin.close()  # → claude 见 stdin EOF → 单轮后退出
            except OSError:
                pass

    def pump_out():
        # os.read 增量读,真正流式(proc.stdout.read(N) 会缓冲小块增量)
        fd = proc.stdout.fileno()
        out = sys.stdout.buffer
        try:
            while True:
                data = os.read(fd, 65536)
                if not data:
                    break
                out.write(data)
                out.flush()
        except (OSError, ValueError):
            pass

    def watch_abort():
        # abort(stdin 非优雅断)时别干等 claude,主动杀
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

    t_in = threading.Thread(target=pump_in, daemon=True)
    t_out = threading.Thread(target=pump_out, daemon=True)
    t_in.start()
    t_out.start()
    threading.Thread(target=watch_abort, daemon=True).start()

    rc = proc.wait()
    t_out.join(timeout=2)
    sys.stdout.buffer.flush()
    sys.exit(rc if rc is not None else 0)


if __name__ == "__main__":
    main()

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
import re
import sys
import time
import subprocess
import threading

CLAUDE_BIN = os.environ.get("COWORK_CLAUDE_BIN", "/opt/cowork/claude")
# 镜像内预制的 Agent Skills(只读)。刻意不在 /opt/cowork 下 —— 非 bundled 模式
# orchestrator 会把宿主 assets 挂到 /opt/cowork:ro 并遮蔽其内容,见 image/Dockerfile。
SKILLS_SRC = os.environ.get("COWORK_SKILLS_DIR", "/opt/cowork-skills")


def link_preinstalled_skills():
    """把镜像内预制的 skill 软链进 ~/.claude/skills/,让 claude 能发现它们。

    为什么每次启动都要做:HOME(/home/agent)是 orchestrator 挂的**会话状态卷**,
    首次创建时是空的,所以不可能在镜像里把文件写死到 ~/.claude/skills。已存在的链
    直接跳过(见下),所以卷持久化之后重复调用也不做无用功;代价是镜像里删掉某个
    skill 后,老会话的卷里会留一个悬空软链 —— claude 扫到读不出内容,自然忽略。

    为什么逐个软链、而不是把整个 skills 目录软链过去:claude 扫描 skills 目录用的是
    readdir —— 目录内的**条目**是软链能被正常列出;而把 skills 本身做成软链则依赖
    实现是否 follow,不可靠。逐个链也让用户/后续流程仍可往同一目录放自己的 skill。

    软链而非复制:省卷空间,且软链指向镜像只读层,agent 改不动预制内容。

    失败只告警不抛:skill 是增强项,不能因为它挂掉整个回合。
    """
    try:
        if not os.path.isdir(SKILLS_SRC):
            return
        dest = os.path.join(os.environ.get("HOME", "/home/agent"), ".claude", "skills")
        os.makedirs(dest, exist_ok=True)
        linked = 0
        for name in sorted(os.listdir(SKILLS_SRC)):
            src = os.path.join(SKILLS_SRC, name)
            if not os.path.isdir(src):
                continue  # 跳过 LICENSE 等非 skill 文件
            link = os.path.join(dest, name)
            if os.path.lexists(link):
                continue  # 已存在(同容器内多回合)—— 不覆盖用户可能自建的同名 skill
            os.symlink(src, link)
            linked += 1
        if linked:
            print(f"[cowork-shim] 预制 skill 已挂载: {linked} 个 → {dest}", file=sys.stderr)
    except OSError as e:
        print(f"[cowork-shim] 预制 skill 挂载失败(不影响本回合): {e}", file=sys.stderr)


UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def resume_target_exists(session_id):
    """容器内是否还留着这个会话的 transcript。

    claude 把会话写在 $HOME/.claude/projects/<cwd-slug>/<session-id>.jsonl。这里不按
    slug 拼路径、而是把整棵 .claude 走一遍:slug 由 cwd 推导、跨版本可能变,而这棵树
    很小(skills 是软链,os.walk 默认不跟进),多走几个目录的成本可以忽略。
    """
    root = os.path.join(os.environ.get("HOME", "/home/agent"), ".claude")
    target = session_id + ".jsonl"
    for _dirpath, _dirnames, filenames in os.walk(root):
        if target in filenames:
            return True
    return False


def rewrite_stale_resume(argv):
    """--resume <id> 指向容器里已不存在的会话 → 换成 --session-id <id>(或直接去掉)。

    为什么需要:HOME 卷是会话级的,而容器被 TTL 空闲回收(docker stop)再拉起、或会话
    容器被重建时,卷可能还没有(或曾经是 tmpfs、每次 start 都清空)这个 transcript,
    客户端却仍按本地 DB 记着的 sdk_session_id 发 --resume。claude 会打
    "No conversation found with session ID: <id>" 并 exit 1 —— 而 forwarder 把退出码
    抹平成 0(ws close → process.exit(0)),SDK 因此既收不到消息也收不到错误,用户侧
    表现为"消息发出去毫无反应",服务端日志之外无痕(2026-08-05 线上取证:两天内 20 次,
    占同期失败回合的七成;失败回合本身约占全部回合的两成)。

    换成 --session-id(而不是直接删掉 --resume)的好处:本回合以**同一个 id** 新建会话,
    客户端记着的 id 与容器内的对上,下一回合的 --resume 就能命中,只失忆这一轮。
    id 不是合法 UUID 时 --session-id 会被 claude 拒绝,那就退化成直接去掉 --resume。

    只认长选项:唯一的调用方是 Agent SDK,它固定 push("--resume", id) 两个元素;
    --resume= 等价写法一并兼容。--fork-session 依赖 --resume,改写时一起摘掉。
    """
    for i, arg in enumerate(argv):
        if arg == "--resume" and i + 1 < len(argv):
            sid, tail_from = argv[i + 1], i + 2
        elif arg.startswith("--resume="):
            sid, tail_from = arg.split("=", 1)[1], i + 1
        else:
            continue
        # --resume 的值是可选的(claude 允许裸 --resume 进交互选择器):取到的若是
        # 下一个选项或空,说明本来就没带 id,交给 claude 自己处理。
        if not sid or sid.startswith("-"):
            return argv
        if resume_target_exists(sid):
            return argv
        head = argv[:i]
        tail = [a for a in argv[tail_from:] if a != "--fork-session"]
        head = [a for a in head if a != "--fork-session"]
        if UUID_RE.match(sid):
            print(f"[cowork-shim] 会话 {sid} 的记录已不在容器内 → 以同 id 新建", file=sys.stderr)
            return head + ["--session-id", sid] + tail
        print(f"[cowork-shim] 会话 {sid} 的记录已不在容器内且非 UUID → 去掉 --resume", file=sys.stderr)
        return head + tail
    return argv


def main():
    # argv:'--' 之后的一切透传给 claude(与 forwarder process.argv.slice(2) 对齐)
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1:]
    else:
        argv = sys.argv[1:]

    link_preinstalled_skills()  # 必须在起 claude 之前:它启动时就会扫 skills 目录
    argv = rewrite_stale_resume(argv)

    proc = subprocess.Popen(
        [CLAUDE_BIN] + argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        env=os.environ.copy(),
        cwd=os.environ.get("COWORK_WORKSPACE", "/workspace"),  # agent 工作目录(可写 tmpfs/volume)
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
    # os._exit 而非 sys.exit:pump_in daemon 线程可能仍阻塞在 stdin.read,走 Python
    # finalize 会 _enter_buffered_busy 触发 SIGABRT。stdout 已 flush,直接终止。
    os._exit(rc if rc is not None else 0)


if __name__ == "__main__":
    main()

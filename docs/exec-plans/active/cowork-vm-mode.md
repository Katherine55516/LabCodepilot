# Cowork 沙箱模式(本地 VM 隔离)— P1 macOS MVP

> 创建时间:2026-07-10
> 最后更新:2026-07-10
> 调研与 P0 POC 结论:[docs/research/cowork-local-vm-mode.md](../../research/cowork-local-vm-mode.md)(P0 已通过,转发桥拓扑证实)
> POC 脚手架:[scripts/poc/cowork/](../../../scripts/poc/cowork/README.md)

## 目标

把 P0 POC(agent 在本地 VM 内执行、真机文件零接触)推进到**内部可试用的 macOS MVP**:
用户在沙箱会话发送附件 → 自动进 VM → agent 读改建 → 产物卡片下载回真机;VM 生命周期由应用管理,无需手动脚本。

**P1 不做**(留 P2/P3):Windows/WSL2、宿主代理 token 不进 VM、出网白名单、每会话非特权用户/bwrap、镜像 CI 与下载预热的产品化(P1 仍复用 POC 的本地镜像资产)。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| P1-A | **文件通道**:上传进 VM(会话隔离工作区 `/home/agent/sessions/<id>/workspace`)+ 回合产物 diff + 产物卡片下载(单文件/打包) | ✅ 已完成(2026-07-10) | E2E:CSV 附件→VM 内修改→vm_artifacts 事件→卡片下载,内容验证通过;逃逸请求 403/404 且错误脱敏(不泄漏 SSH 命令行);传输走 SSH,P1-C 平替 |
| P1-A+ | **产物持久化**:产物清单落库(`vm_artifacts_json`),历史会话 VM 休眠时仍显示卡片(列表读库不依赖 VM),下载时按需唤醒 VM + 休眠徽标 | ✅ 已完成(2026-07-10) | 修用户反馈"打开旧会话看不到产物";E2E:VM 停机→list 读库返回文件+vmOnline:false 不唤醒→下载自动 ensureRunning(6.5s)→内容正确;旧会话(落库前)VM 在线时懒迁移 |
| P1-B | **VM 生命周期管理器**(server 侧单例):懒启动 / 空闲回收 / 健康检查 / 崩溃重建 / 退出清理;去掉手动 vm-up.sh | ✅ 已完成(2026-07-10) | 落 server 侧(dev 无 main 进程,dev/打包共用);沙箱首条消息 ensureRunning 自动 spawn vfkit;E2E 验证冷启动自动起 VM、kill vfkit 后自愈重建、dev SIGTERM 连带关 VM 无孤儿;UI 状态态留 P1-D |
| P1-C | **通道产品化**:guest-daemon(**Python3**,vsock)替代 SSH;exec/writeFile/readFile/listFiles/archive/removeSession/health RPC | ✅ 已完成(2026-07-13) | vfkit connect 模式 vsock→unix socket(无握手无魔数,已实测);运行时数据流全 vsock,SSH 仅剩一次性 provisioning(推 binary+daemon);E2E:冷机全链路(上传/流式 exec/产物 diff/下载)通过,daemon 崩溃自动 re-provision |
| P1-D | **就绪状态机 + 消息先行入队**:VM 启动窗口(冷启动数秒~数十秒)期间 vm_status 事件贯通 → 前端"沙箱准备中"横幅,就绪自动进入正常流转 | ✅ 已完成(2026-07-13) | P1 镜像手动预置,状态机覆盖 VM 启动窗口(非下载窗口);服务端本已阻塞到就绪=隐式排队,补的是可见反馈;E2E:冷机发消息→starting/booting/provisioning/ready 事件流+横幅显示→ready 清除→正常回复,不再静默"生成中" |
| P1-E | **入口正式化**:沙箱徽标/能力边界提示(外部 stdio MCP 屏蔽说明)、空态入口卡、真机零写入验收(fs 监控) | 📋 待开始 | POC 开关保留为会话内切换;i18n 三语 |

## 决策日志

- 2026-07-10: P1 在 `vm_cowork` 分支开发;POC 的输入条开关保留(用户已确认该交互),空态双卡入口 P1-E 再评估是否需要
- 2026-07-10: P1-A 文件传输先走 SSH 通道(复用 POC 链路),不阻塞在 daemon 上——文件通道的**产品语义**(会话隔离目录/diff/下载 UI/路径校验)与**传输机制**(SSH→vsock)解耦,后者 P1-C 平替
- 2026-07-10: 会话工作区定为 `/home/agent/sessions/<sessionId>/workspace`(uploads 直接放 workspace 内,agent 视角一个目录,简化 prompt 引用;调研文档的 uploads/ 只读分离留给 P3 安全强化配合非特权用户做)
- 2026-07-10: sessionId 经 `COWORK_SESSION_ID` env 传给转发器(SDK 的 argv 不可控,env 白名单是既有过河机制)
- 2026-07-10: 产物 diff 用 `find -newermt @<turnStart>` + `stat`,排除本回合上传的原文件;下载 API 错误统一脱敏(SSH 命令行含 VM IP/密钥路径,绝不回显),仅 403/404/500 通用消息;路径校验用 VM 内 `realpath -e` + workspace 前缀判定(防 `../` 与符号链接逃逸,已 E2E 验证)
- 2026-07-10: P1-B VM 管理器**放 server 侧单例**(globalThis park 抗 Next dev hot-reload),不放 electron main —— `npm run dev`(主要验证环境)根本没有 main 进程,且无 server→main 消息通道;dev 与打包版共用同一套逻辑,claude-client 直接调用。代价:VM 与 next-server 同生命周期(打包版 next-server 长驻,等价于随 app;dev 随 dev server)
- 2026-07-10: `decideCowork` 改 async —— 首条沙箱消息阻塞到 VM 就绪(冷启动数秒),符合"点开就能用";崩溃态(health 双探失败 / vfkit exit)在下条消息的 ensureRunning 里自动重建;活跃会话用 markSessionActive/releaseSession 计数,归零后 15 分钟空闲回收
- 2026-07-10: 排查"疑似双 VM"实为**测量假象** —— `ps|grep "[v]fkit"` 匹配到我自己命令行里的 "vfkit" 字面量;改用 `pgrep -f 'vfkit --cpus'` 精确计数,确认单例守卫(startingPromise + existingVfkitPid 复用)工作正常,全程只有一台 VM
- 2026-07-13: P1-C daemon 改用 **Python3**(guest 云镜像自带 + `socket.AF_VSOCK` 标准库)而非计划里的 Go —— 零工具链、零跨编译、零二进制推送,一个 .py scp 进去即可;POC 级 RPC broker 用 Python 完全够
- 2026-07-13: vfkit vsock 用 **connect 模式**(guest daemon 当 server,宿主连 unix socket);调研+实测确认**无 Firecracker 式 `CONNECT` 握手、无魔数**,连上即裸字节流,应用层协议自定(首行 JSON header + body)
- 2026-07-13: forwarder 从 bash(ssh)换 **bash 包装 + node .mjs**(vsock 客户端);pathToClaudeCodeExecutable 指向 .sh,claude-client 注入 `COWORK_NODE_BIN=process.execPath`+`ELECTRON_RUN_AS_NODE=1`,不依赖 PATH 里有 node(打包版 Electron 无独立 node)
- 2026-07-13: **两个真 bug 在验证中抓出并修复**:① `vsockHealthy` 挂死 —— daemon 未监听时 vfkit accept 后立刻关连接,readJsonHeader 只处理 data/error 不处理 close → 永久挂起 ensureDaemon;修:close/end→reject + 读超时。② daemon `pump_out` 用 `proc.stdout.read(64K)` 阻塞攒满才吐 → stream-json 小块增量全缓冲、SDK 等不到 init 响应 claude 挂死;修:改 `os.read(fd)` 真流式。③ provision 命令 `pkill -f cowork-daemon.py` 自匹配(命令行含 python3 路径)→ 自杀;修:bracket trick `[c]owork-daemon.py` + 拆独立 ssh 调用
- 2026-07-13: SSH 未 100% 退役 —— **运行时数据流(exec/文件/健康)全 vsock**,SSH 仅剩 VM-provision 一次性用途(推 claude binary + 推/启 daemon,与推 binary 同性质);生产形态把 daemon 烘进镜像 systemd 自启即彻底无 SSH(留待镜像流水线)

## 详细设计

### P1-A 文件通道

**上传(对话框 → VM)**
- `src/app/api/chat/route.ts` 沙箱分支:附件除写宿主 `.codepilot-uploads/`(消息气泡预览继续用它)外,经 SSH 推入 `/home/agent/sessions/<id>/workspace/<safeName>`;prompt 中文件路径引用 VM 内路径
- 转发器 `forwarder-ssh.sh`:改为 `cd /home/agent/sessions/$COWORK_SESSION_ID/workspace`(目录 daemon/SSH 侧 mkdir -p 兜底);claude-client 在 cowork 分支给 `queryOptions.env` 注入 `COWORK_SESSION_ID`

**产物(VM → 用户)**
- 回合开始:宿主侧记录时间戳;回合结束(SSE result 后):SSH `find workspace -type f -newermt <ts>` 列新增/修改文件(排除上传的原文件名单)
- SSE 新事件 `vm_artifacts`:`{ files: [{ path, name, size, mtime }] }`,挂在 result 之后、done 之前
- 前端:`useSSEStream` 透传事件 → 消息流末尾渲染产物卡片(文件名/大小/下载按钮/全部下载)
- 下载 API:`GET /api/cowork/artifacts?sessionId=..&path=..`(SSH cat 流式返回,Content-Disposition attachment);`POST /api/cowork/artifacts/archive`(VM 内 tar.gz 后拉出)
- 路径校验:规范化后必须以该会话 workspace 前缀开头,拒绝 `..` 与符号链接逃逸(`realpath` 校验)

### P1-B VM 生命周期管理器

- `electron/cowork-vm-manager.ts`(main 进程):封装 vfkit spawn/stop/health;状态机 idle→starting→running→stopping;`--restful-uri` 探活 + SSH 就绪探测
- next-server 经 IPC(现有 main↔server 通道)请求 ensureVmRunning();沙箱会话首条消息触发
- 空闲回收:无活跃沙箱会话 N 分钟(默认 15)后 stop;应用退出时 stop
- 崩溃恢复:health 探测失败 → 会话 SSE 报错(复用 error 事件)+ 下一条消息自动重建

### P1-C guest-daemon(vsock)

- Go 静态二进制,镜像内随 cloud-init 安装(P1 阶段:宿主 SSH 推入 + systemd unit)
- RPC(长度前缀 JSON over vsock):`exec`(spawn claude,双向流)/ `writeFile` / `readFile` / `listFiles` / `diffSince` / `health`
- vfkit `--device virtio-vsock` 转 unix socket;宿主 node 直连
- 转发器改为薄客户端(或直接由 claude-client 用 node 实现转发,去掉 shell 脚本)

### P1-D / P1-E

见调研文档 §7.1(状态机四态与 UI 文案)与 §"POC 入口设计"讨论;P1-E 验收含"fs 监控证明真机零写入"(fs_usage/监控脚本对照会话期间宿主写入)。

## 验收标准(P1 整体)

1. 全流程:沙箱会话发附件(xlsx/txt)→ agent 在 VM 内修改/新建 → 产物卡片 → 下载到用户自选位置;全程真机(除应用数据目录暂存与用户主动下载外)零写入
2. VM 无手动步骤:冷机打开应用 → 开沙箱会话发消息 → 自动起 VM(1–5s 观感,含 UI 状态)→ 完成任务
3. 中断/崩溃:回合中 abort 即停;kill vfkit 后下一条消息自动重建并明确提示
4. `npm run test` 全绿;新增单测覆盖:路径校验、diff 排除逻辑、状态机迁移
5. 现有非沙箱会话行为零回归(cowork_enabled 关闭时所有新代码不可达)

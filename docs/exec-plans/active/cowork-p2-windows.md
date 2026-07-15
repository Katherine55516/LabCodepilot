# Cowork P2 — Windows/WSL2 移植

> 创建时间:2026-07-15
> 最后更新:2026-07-15
> 调研报告(先读):[docs/research/cowork-p2-windows.md](../../research/cowork-p2-windows.md)(移植面盘点 + WSL2 硬事实 + 通道选型 + 分期)
> 上游:cowork 主线 macOS 侧已收官(P0+P1+E1-E5+镜像流水线 M1-M4+P3 安全强化);当前架构见 [docs/handover/cowork-vm-mode.md](../../handover/cowork-vm-mode.md)

**目标:办公模式在 Windows(全 Win10/11)可用,走 WSL2 私有 distro。** 这是一次"补平台后端"的移植——约半数模块(文件通道契约层 cowork-transfer、guest daemon 业务逻辑、UI、审计、守卫)直接复用,需 Windows 实现的收敛在四个接缝:通道(cowork-vsock)、VM 生命周期(cowork-vm-manager)、分发(cowork-assets)、网络(cowork-proxy)。

## 状态

| Phase | 内容 | 环境 | 状态 | 备注 |
|-------|------|------|------|------|
| W0 | 通道 POC:`wsl.exe -e` stdio 跑通 daemon health/writeFile/exec 双向流 + EOF 半关闭(#4424)压测 + claude linux binary 在 WSL2 跑通 stream-json 一轮 | **Windows** | 📋 待开始 | 最大不确定点,先行;不通过退 mirrored localhost |
| W1 | 平台后端抽象:抽 guest-backend 接口(10 op + 生命周期 + 端点),macOS 现状包装成 vfkit 实现;daemon 加 `--stdio` 模式复用全部 op | **macOS 可做** | 📋 待开始 | 纯重构,macOS 零回归;不阻塞 Windows 环境 |
| W2 | WSL2 后端:vm-manager WSL2 版(wsl --import/启动/wsl --terminate,**绝不 wsl --shutdown**)+ stdio 通道实现 + Windows forwarder | **Windows** | 📋 待开始 | |
| W3 | 分发:cowork-assets 加 WSL2 rootfs tarball 来源 + import + wsl-distribution.conf oobe 定制(daemon/systemd/agent 用户/mask unit) | **Windows** | 📋 待开始 | claude binary 复用 |
| W4 | 网络+代理:cowork-proxy WSL2 网关发现(NAT 查 guest 默认路由拿宿主 IP;来源校验网段参数化) | **Windows** | 📋 待开始 | P3-B 移植 |
| W5 | 降级探测+UI:探测 WSL/VMP/BIOS/GPO,任一不满足→隐藏办公 tab + 引导文案 | **Windows** | 📋 待开始 | 复用 cowork_status gate |
| W6 | 隔离硬化+诚实文案:wsl.conf 硬化组合 + #12443 残余风险产品文案 | **Windows** | 📋 待开始 | |
| W7 | Windows NSIS 打包(CI windows-2022 经验)+ 全新 Win 机裸机验收 + 双文档 | **Windows** | 📋 待开始 | |

## 决策日志

- 2026-07-15 **D1 接受"策略级强隔离 + 诚实文案"先交付**(用户拍板)。WSL2 的"真机文件不可见"弱于 macOS vfkit(#12443 让 automount=false 可被提权 PowerShell 绕过,官方 issue 仍 open)。**不等 WSLC GA(2026 秋,架构级隔离)才出 Win 版**——用硬化组合缓解 + 产品文案诚实标注"策略级强隔离,非架构级 airtight"。stdio 架构未来可平滑迁到 WSLC。
- 2026-07-15 **D2 全 Win10/11,不设版本门槛**(用户拍板)。走 `wsl.exe -e` stdio 通道(全平台 work),**不依赖 mirrored networking**(那要 Win11 22H2+ 会砍用户)。
- 2026-07-15 **D3 通道 = `wsl.exe -e` stdio 模型**(调研 §4)。裸 vsock 在 WSL2 非免 admin(要注册 HKLM GUID);stdio 模型免 admin、生产验证(wsl-vpnkit),且与当前架构天然契合:cowork-vsock 的"一次连接=一个 op"→"一次 wsl.exe -e=一个 op"同构,forwarder 的"spawn 进程做管道"→ spawn wsl.exe -e,daemon op 逻辑(含 P3-A setuid)全复用。
- 2026-07-15 **D4 环境约束:W0 及 W2-W7 的实测必须 Windows 机器**(开发机是 macOS)。W1 抽象重构可在 macOS 做(且 macOS 零回归)。需用户提供 Windows 测试机 或 CI windows-2022 runner;W0 POC 尤其需要一台能装 WSL2 的 Win 机。

## 详细设计

### 通道抽象接口(W1 的核心)

引入 platform guest-backend 接口,claude-client / cowork-transfer 只依赖它:
```
interface CoworkGuestBackend {
  // 生命周期
  ensureRunning(): Promise<VmStatus>; stop(): Promise<void>; getStatus(): VmStatus;
  // 文件/查询 op(现 cowork-vsock 的 10 个 rpc*)
  health(); mkdirWorkspace(sid); writeFile(sid,name,data); listFiles(sid,since);
  readFileStream(sid,path); archiveStream(sid); removeSession(sid);
  reconcileSessions(keep); installBinary(name,path);
  // exec 通道端点(forwarder 用)
  execEndpoint(sid): { command, args, env };  // macOS=forwarder+vsock;Windows=wsl.exe -e
}
```
- **macOS 实现**(现状包装):vfkit 生命周期 + vsock RPC + forwarder-vsock。
- **Windows 实现**:wsl --import/wsl -e 生命周期 + 每 op 一次 `wsl.exe -d <distro> -u root -e python3 daemon.py <op>` + Windows forwarder 包 wsl.exe。
- daemon 加 `--stdio` 入口:argv 解析 op + 读写 stdin/stdout,复用现有全部 op 函数(AF_VSOCK accept 循环仅 macOS 用)。

### 各阶段要点(细节见调研报告 §5)

- **W0** POC 脚手架放 scripts/poc/cowork/(如 wsl-probe.ps1 + daemon --stdio 试跑)。验 exec EOF 语义决定去/留帧封装。
- **W2** vm-manager 抽象后按平台分派;WSL2 的 idle 关机(默认 60s)对 stdio 模型无害(每回合按需 wsl -e 拉起)。
- **W3** rootfs 从 Debian Mini Root FS tar 或 docker export;wsl-distribution.conf `[oobe] command` = seed 首启注入等价;mask systemd-resolved/networkd/NetworkManager/tmp.mount。
- **W4** NAT 模式 WSL2→宿主用宿主 IP(guest `ip route` 默认网关);proxy 绑该 IP,VMNET_PREFIX 网段校验参数化。
- **W5** PowerShell 探测(Get-WindowsOptionalFeature / wsl --status / Get-ComputerInfo Hyper* / GPO AllowWSL);错误码 0x80370102 引导。
- **W6** wsl.conf:automount=false + mountFsTab=false + interop=false + appendWindowsPath=false;agent 非 root 无 sudo;#12443 残余风险文案。

## 明确不做(范围外)

- **不走 Hyper-V HCS**(官方 Cowork 的 Home 版全挂惨案)。
- **不做 mirrored networking 依赖**(D2:会砍 Win10 + Win11 <22H2 用户)。
- **不等 WSLC GA**(D1:2026 秋才 GA,先交付;架构可平滑迁移)。
- **不做弱沙箱冒充**(BIOS 未开/GPO 禁 WSL → 降级探测 + 引导,不假装隔离)。

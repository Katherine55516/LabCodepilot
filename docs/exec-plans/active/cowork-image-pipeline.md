# Cowork 镜像流水线 — 沙箱环境零手动预置

> 创建时间:2026-07-14
> 最后更新:2026-07-14
> 上游:办公模式 E1-E5 已全部交付(见 [completed/cowork-office-mode.md](../completed/cowork-office-mode.md));架构与踩坑全貌见 [docs/handover/cowork-vm-mode.md](../../handover/cowork-vm-mode.md);调研见 [docs/research/cowork-local-vm-mode.md](../../research/cowork-local-vm-mode.md) §7.1

**目标:全新 Mac 装上 DMG 就能用办公模式,零手动预置。** 现状是五项资产全靠手动复刻(`~/.codepilot/cowork-poc/` 的镜像/seed/SSH密钥/claude binary + brew 装 vfkit),换台机器办公模式就是死的——这是内部试用走向真实交付的关键路径。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| M1 | 首启自注入 + SSH 退役:seed 由代码生成(daemon/systemd 烘进 cloud-init),vm-manager 就绪链全 vsock,claude binary 经 vsock 推入 | ✅ 已完成 | 2026-07-14 四项验收全过:①老盘升级(instance-id 变更触发 cloud-init 重跑,daemon v2 systemd active+enabled,回合 43s 产物内容正确)②处女盘首启(中科大新下 raw 校验 sha512 一致,首启自注入+253MB binary vsock 推入,97s 全链路,guest 实测 sshd inactive+masked/growpart 吃满)③二次启动 daemon ~5s 就绪④零 SSH(密钥目录挪走全程无影响);test 1930 绿 + smoke 6/6 |
| M2 | 宿主下载器 + 就绪状态机 + UI 下载引导:底镜走中科大、claude 平台子包走 npmmirror,断点续传+校验+磁盘预检,设置页/办公空态出「下载」按钮+进度,下载中禁发 | ✅ 已完成 | 2026-07-14 全流程实测:①挪走双资产→设置页/落地页下载按钮→3GB 全程下载(USTC ~2.5-5MB/s)→sha512 通过→就绪态翻回(CDP);②取消保留 .part(482MB)→续传从偏移继续→**最终校验通过=前缀重哈希正确性硬证明**;③npmmirror tarball 不支持 Range→200 回退清零重下路径真实触发,integrity 通过、二进制与原件逐位一致;④稀疏扩容 8GiB 落盘(实占 3.2GB),guest 首启 growpart 吃满 df 7.7G;⑤D4 下载中办公 composer disabled+提示行(CDP);⑥新下载盘 41s 办公回合 E2E;test 1936 绿+smoke 6/6 |
| M3 | 打包正式化:vfkit 内置 app 包(签名/entitlement 验证)、daemon/forwarder 脚本随包分发(去仓库绝对路径依赖)、资产目录正式化 + 升级/GC | 📋 待开始 | |
| M4 | 裸机验收 + 失败路径矩阵 + 双文档 | 📋 待开始 | CI 回归验证列为可选项 |

## 决策日志

- 2026-07-14 **D1 分发方案:不自制镜像,"上游底镜 + 首启自注入"**。用户要求避开 GitHub 托管(国内几乎不可用);中科大源只镜像公共开源项目、无法托管自制镜像 → 把定制(daemon/systemd/agent 用户/关 sshd)从"烘进托管镜像"改为"应用本地生成 cloud-init seed,首次开机自注入"。四项资产来源:Debian 底镜=中科大(3GB raw,现镜像同源,锚定版本+官方 sha512);定制=本地 seed(hdiutil makehybrid 造 ISO,macOS 自带零依赖);claude binary=npmmirror 的 `@anthropic-ai/claude-agent-sdk-linux-arm64` **SDK 平台子包**(与宿主 SDK 同版本配对,实测 0.3.203 在 npmmirror:79MB tgz/253MB 解包);vfkit=打进 app 包。零自建托管,SSH 照样彻底退役,CI 角色缩为可选回归验证。代价:底镜 3GB 未压缩(vfkit 只认 raw,qcow2 转换需 qemu-img 不值得);将来嫌大可加公司 OSS 压缩源,manifest 天然多源。
- 2026-07-14 **D2 不做 Intel x64**:应用不再为 Intel 芯片 Mac 提供支持,镜像只做 arm64。
- 2026-07-14 **D3 显式点击才下载**:不做启动后台静默预热,避免不用此功能的用户白耗 ~3GB 流量。调研 §7.1 的 onboarding 预热设计留给将来面向更多用户时再评估。
- 2026-07-14 **D4 下载中禁发 + 进度提示**:消息排队(下载中发消息、就绪后自动跑)不做 v1,留给后续迭代。
- 2026-07-14 **daemon 升级机制 = seed 模板版本号**:cloud-init `write_files` 是 per-instance 语义 → bump `SEED_TEMPLATE_VERSION` → instance-id 变化 → 下次开机 cloud-init 重跑、以 root 重写 `/opt/codepilot/cowork-daemon.py`。不做 vsock 推 daemon 热更新(daemon 跑在 agent 用户下写不了 /opt,绕行方案复杂度不值得;VM 重启本来就便宜,且 app 更新必然重启 next-server → VM 必然重启)。**纪律:改 cowork-daemon.py 必须同步 bump SEED_TEMPLATE_VERSION**。health 响应带 version 作为运行时一致性哨兵。
- 2026-07-14 **claude binary 版本 = 宿主 SDK 版本**:POC 期已确认 binary 来自 `@anthropic-ai/claude-agent-sdk-linux-arm64` 平台子包(非 claude-code 包),与 package.json 的 `@anthropic-ai/claude-agent-sdk` 同版本 → 天然版本配对,无独立 pin;单测断言两处版本常量一致。

## 详细设计

### 资产总表(流水线要消灭的手动预置)

| 资产 | 现状(手动) | 目标态 | 落点 |
|---|---|---|---|
| Debian 底镜 raw 3GB | 手动从中科大下 | M2 应用内下载(断点续传+sha512) | M2 |
| seed.iso(cloud-init) | 手动制作,只注入 ssh key+用户 | M1 代码生成,内嵌 daemon+systemd+关 ssh | M1 |
| SSH 密钥对 | 手动生成 | **退役**(provisioning 链消失) | M1 |
| claude linux binary 253MB | 手动 npm pack 解包 | M2 npmmirror 下载,M1 起经 vsock 推入 VM | M1+M2 |
| vfkit | brew install | 打进 app 包 | M3 |
| daemon/forwarder 脚本 | 打包版靠仓库绝对路径(只在开发机能跑) | 随包分发(extraResources)+ 双路径解析 | M3 |

### M1 首启自注入 + SSH 退役

**核心思路**:现有 seed.iso 已是 cloud-init NoCloud 数据源,把 daemon(334 行,base64 内嵌 user-data 无压力)和 systemd unit 写进 `write_files`,`runcmd` 启用服务并关停 ssh——**provisioning 从"宿主 SSH 推文件"变成"guest 首次开机自己装"**。宿主从头到尾只碰 vsock,连 VM 的 IP 都不再需要知道(DHCP 租约反查、sshOk、scp 全删)。

1. **`src/lib/cowork-seed.ts`(新)**
   - `SEED_TEMPLATE_VERSION = 1`;`buildUserData(daemonSource)` / `buildMetaData()` 纯函数 + `ensureSeedIso()`(临时目录写 user-data/meta-data → `hdiutil makehybrid -iso -joliet -default-volume-name cidata` → `images/seed-codepilot-v{N}-{contentHash8}.iso`,内容寻址,存在即复用)。
   - user-data 要点:agent 用户**无 ssh_authorized_keys**、lock_passwd;growpart 保留;systemd unit `codepilot-daemon.service`(`User=agent`、**`Environment=HOME=/home/agent`**(systemd 不给 system service 设 HOME,claude 子进程需要)、`ExecStartPre=-/sbin/modprobe vsock`×2 兜底模块加载、`Restart=always`);runcmd:`systemctl enable --now codepilot-daemon` + `systemctl disable --now ssh; systemctl mask ssh`(P3 攻击面收缩提前落袋)。
   - meta-data:`instance-id: codepilot-cowork-v1`——与旧 seed 的 `cowork-poc-01` 不同 → **现存开发机老盘下次开机自动重跑 cloud-init 完成升级**,无需重灌。
   - daemon 源解析沿用 hostDaemonPath 双候选(cowork_forwarder_path 同目录 → 仓库路径)。
2. **daemon v2(cowork-daemon.py)**
   - `DAEMON_VERSION = 2`;health 返回 `{ok, version, claude}`(claude = `~/bin/claude` isfile+可执行,一次探测拿全就绪信息)。
   - 新 op `installBinary {name,size}`:name 白名单(`claude` → `~/bin/claude`);**流式 recv 直写 `.part`**(253MB 不进内存,VM 只有 2GB),chmod 0755 + `os.replace` 原子替换;注意 header 后 rest 前缀字节。
3. **宿主侧(cowork-vsock.ts + cowork-vm-manager.ts)**
   - vsock:`vsockHealth()` 富探测(`{ok,version,claude}`,`vsockHealthy` 保留为布尔包装);`rpcInstallBinary(name, filePath)` createReadStream 推流(背压)+ 120s 超时。
   - vm-manager 删除:`sshBaseArgs/sshOk/ensureGuestBinary/ensureDaemon/parseLeaseIp/readLeaseIp` + `SSH_KEY/VM_IP_FILE/GUEST_DAEMON_PATH` 常量 + parseLeaseIp 单测。
   - `ensureRunning` 新链:running 快路径改 `existingVfkitPid() || vsockHealthy`;复用外部 vfkit 判定改 vsockHealthy;spawn 前 `ensureSeedIso()`(SEED 用生成产物);boot 轮询直接探 vsock(**READY_TIMEOUT 120s→240s**,首启含 cloud-init ~60-90s;二次启动 systemd 拉 daemon ~15s);`provisionGuest()`:health.claude 为假 → `emitProgress('provisioning')` + rpcInstallBinary(宿主源仍是 `bin/package/claude`,M2 才接下载)。
   - `isImageProvisioned()` 收敛为仅查 DISK(seed 按需生成,ssh key 不再是前置)。
   - `VmStatus.ip` 清理(排查使用点后删除或恒 null)。
4. **验收**
   - ① 老盘升级:现有 raw + 新 seed → cloud-init 重跑 → systemd daemon v2 健康 → 办公回合 E2E;② 新盘首启:中科大下全新 raw(挪走旧盘+EFI store)→ 首启注入 → installBinary 推 claude → 办公回合 E2E + 产物下载;③ 二次启动快路径;④ 零 SSH:src/lib/cowork-* 无 ssh 引用,验收全程挪走 ssh 密钥目录不受影响;⑤ `npm run test` 全绿。
   - 风险与缓解:masked ssh 后调试只剩串口 console(vm-console.log,足够;git revert 可回老链路);vsock 模块 systemd 早启时序(modprobe 兜底 + Restart=always);hdiutil 造 cidata 卷标(现 seed.iso 同工具链已验)。

### M2 宿主下载器 + 就绪状态机 + UI

1. **`src/lib/cowork-assets.ts`(新,next-server 侧单例,globalThis 抗 hot-reload 同 vm-manager 范式)**
   - manifest 常量:底镜锚定具体 dated build(实现时从 cloud.debian.org/中科大选定当期版本,记录官方 SHA512SUMS 值);URL 列表 = 中科大主源 + cloud.debian.org 兜底;claude 平台子包版本 = 宿主 SDK 版本(运行时/构建时取,单测断言与 package.json 一致),tarball URL 走 npmmirror,integrity 从 registry 元数据校验。
   - 下载引擎:HTTP Range 断点续传(`.part` + 偏移)、sha512 流式校验(crypto)、进度发射器(onVmProgress 同款 globalThis 模式);claude tgz 用系统 `/usr/bin/tar` 解出 `package/claude`(macOS 自带 bsdtar,零依赖);下载前 `fs.statfs` 磁盘预检(≥ 4GB 空闲:3GB raw + tgz + 解包余量);落盘后 `fs.truncate` 把 raw 稀疏扩到 8GiB(APFS 零成本,growpart 自动吃满 → workspace 余量翻倍)。
   - 状态机:`not_downloaded → downloading(pct) → verifying → ready / failed(reason)`,双资产各自跟踪。
2. **API**:`/api/cowork/status` 扩展资产状态;新 `POST /api/cowork/assets`(启动下载)/`DELETE`(取消)。
3. **UI**:设置页开关区 + OfficeEmptyCard(sidebar/landing 两变体)的 imageMissing 死提示 → 「下载沙箱环境(约 3.1GB)」按钮 + 进度条 + 失败重试/磁盘不足指引;**下载中办公 composer 禁发 + 提示**(D4);E1 守卫 `image_not_provisioned` 的 actionHint 演进为下载引导;新增 `claude_binary_missing` reason。i18n 三语(zh-HK 手加)。
4. **验收**:挪走 images/raw + bin/package/claude → 应用内下载全流程 → 办公回合;断网续传、篡改文件校验失败、磁盘不足预检三条失败路径;dev 与打包版各验一遍。

### M3 打包正式化(vfkit 内置 + 脚本随包 + 升级/GC)

1. **vfkit 内置**:构建脚本把 vfkit 二进制放进 extraResources(优先从本机 brew 拷贝,校验 sha);运行时解析 bundled 路径优先、PATH 兜底。**必须 POC**:打包后 `codesign -d --entitlements` 确认 `com.apple.security.virtualization` entitlement 保留、VM 可启动(当前未签名分发,预计直通,但要实测)。
2. **脚本随包**:cowork-daemon.py / forwarder-vsock.sh / forwarder-vsock.mjs 进 extraResources;解析顺序 packaged resources → 仓库路径(dev)。**这是打包版脱离开发机仓库绝对路径的关键**(现状打包版只在有仓库的机器上能跑 cowork)。
3. **资产目录正式化**:`~/.codepilot/cowork-poc/` → `~/.codepilot/cowork-assets/`,一次性迁移(mv)+ 旧路径兜底;installed-manifest.json 记录已装版本。
4. **升级/GC**:manifest 版本 > 已装 → 后台下载新资产 → VM 停机窗口原子切换 → 旧 raw/seed GC;claude binary 版本随 app 更新自然滚动(健康探测 claude=true 但版本需要更新的场景:app 更新后 HOST 侧文件版本变化 → 重推覆盖)。
5. **验收**:无 brew vfkit 的 PATH 环境跑打包版全流程;资产目录迁移幂等;版本 bump 升级路径。

### M4 裸机验收 + 文档

1. 裸机模拟矩阵:全新资产目录 + bundled vfkit + 应用内下载 → 完整办公回合;四条失败路径(断点续传/校验失败/磁盘不足/升级切换)复验。
2. 双文档:handover 更新(资产流水线、seed 机制、daemon v2 协议、新坑)+ insights 更新(零预置的产品意义、显式下载的取舍)。
3. 可选:CI 回归 job(qemu TCG 起上游镜像+seed 探 daemon)——零基础设施决策下非必须,视需要立项。

### 明确不做(本计划范围外)

- 消息排队(下载中发消息就绪后自动跑)——D4 定为后续迭代
- 后台静默预热——D3 排除,将来面向更多用户再评估
- Intel x64 镜像——D2 排除
- P3 其余安全强化(宿主代理 token、出网白名单、每会话非特权用户)、P2 Windows/WSL2——独立立项
